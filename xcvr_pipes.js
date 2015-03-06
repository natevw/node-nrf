var util = require('util'),
    stream = require('stream'),
    _extend = require('xok');

var DEBUG = require("./logging").log.bind(null, 'debug'),
    _m = require("./magicnums");

function PxX(xcvr, pipe, addr, opts) {           // base for PTX/PRX
    stream.Duplex.call(this, {highWaterMark:64});
    
    this._xcvr = xcvr;
    this._pipe = pipe;
    this._addr = addr;
    this._opts = opts;
    this._size = opts.size;
    this._wantsRead = false;
    this._sendOpts = {};
    
    var s = {},
        n = pipe;           // TODO: what if ack'ed TX already in progress and n=0?
    if (addr.length > 1) s['AW'] = addr.length - 2;
    if (opts._primRX) {
      s['PRIM_RX'] = true;
      if (pipe === 0) this._xcvr._rxP0 = this;
      if (opts.autoAck) this._xcvr._prevSender = null;         // make sure TX doesn't skip setup
    }
    if (opts._enableRX) {
      s['RX_ADDR_P'+n] = addr;            // TODO: AFAICT only opts._primRX should do this
      s['ERX_P'+n] = true;
    } else {
      s['ERX_P'+n] = false;
    }
    if (opts.size === 'auto') {
      s['ENAA_P'+n] = true;   // must be set for DPL (…not sure why)
      s['DPL_P'+n] = true;
    } else {
      s['RX_PW_P'+n] = this._size;
      s['ENAA_P'+n] = opts.autoAck;
      s['DPL_P'+n] = false;
    }
    
    var self = this;
    self._xcvr.setStates(s, function (e) {
      if (opts._primRX) self._xcvr.setCE(true,'stby2a');
      if (e) self.emit('error', e);
      else self.emit('ready');        // TODO: eliminate need to wait for this (setup on first _rx/_tx?)
    });
    
    var irqHandler = self._rx.bind(self);
    self._xcvr.addListener('interrupt', irqHandler);
    self.once('close', function () {
      self._xcvr.removeListener('interrupt', irqHandler);
    });
}

util.inherits(PxX, stream.Duplex);

PxX.prototype._write = function (buf, _enc, cb) {
  this._tx(buf, cb);
};

PxX.prototype._tx = function (data, cb, _n) { cb = this._xcvr._SERIAL_.call(this, cb, function () {
  // see p.75 of datasheet for reference here
  var s = {};
  if (this._sendOpts.asAckTo) {
    // no config is needed
  } else if (this._xcvr._prevSender === this) {
    if (this._xcvr._rxPipes.length) {
      this._xcvr.setCE('low');       // this or PWR_UP:0 are the only ways out of RX mode acc to p.22
      s['PRIM_RX'] = false;
    }
  } else {
    s['TX_ADDR'] = this._addr;
    if (this._xcvr._rxPipes.length) {
      this._xcvr.setCE('low');
      s['PRIM_RX'] = false;
    }
    if (this._sendOpts.ack) {
      if (this._xcvr._rxP0) this._xcvr._rxP0._pipe = -1;          // HACK: avoid the pipe-0 PRX from reading our ack payload
      s['RX_ADDR_P0'] = this._addr;
      if ('retryCount' in this._opts) s['ARC'] = this._opts.retryCount;
      if ('retryDelay' in this._opts) s['ARD'] = this._opts.retryDelay/250 - 1;
      // TODO: shouldn't this be overrideable regardless of _sendOpts.ack??
      if ('txPower' in this._opts) s['RF_PWR'] = _m.TX_POWER.indexOf(this._opts.txPower);
    }
  }
  var self = this;
  if (self._opts.reversePayloads) {
    Array.prototype.reverse.call(data);
  }
  self._xcvr.setStates(s, function (e) {     // (± fine to call with no keys)
    if (e) return cb(e);
    var sendOpts = _extend({}, self._sendOpts);
    //if (self._xcvr._rxPipes.length) sendOpts.ceHigh = true;        // PRX will already have CE high
    self._xcvr.sendPayload(data, sendOpts, function (e) {
      if (e) return cb(e);
      var s = {};                 // NOTE: if another TX is waiting, switching to RX is a waste…
      if (self._xcvr._rxPipes.length && !self._sendOpts.asAckTo) {
        self._xcvr.setCE('high');
        s['PRIM_RX'] = true;
      }
      if (self._sendOpts.ack && self._xcvr._rxP0) {
        s['RX_ADDR_P0'] = self._xcvr._rxP0._addr;
        self._xcvr._rxP0._pipe = 0;
      }
      self._xcvr.setStates(s, cb);
    });
    if (self._opts.reversePayloads && self._opts.reversePayloads !== 'leave') {
      Array.prototype.reverse.call(data);     // put back data the way caller had it
    }
    if (!self._xcvr._rxPipes.length) self._xcvr._prevSender = self;    // we might avoid setting state next time
  });
}, (_n === this._xcvr._NESTED_)); };

PxX.prototype._rx = function (d) {
  if (d.RX_P_NO !== this._pipe) return;
  if (!this._wantsRead) return;           // NOTE: this could starve other RX pipes!
  
  var self = this;
  self._xcvr.readPayload({width:self._size}, function (e,d) {
    if (e) self.emit('error', e);
    else {
      if (self._opts.reversePayloads) Array.prototype.reverse.call(d);
      self._wantsRead = self.push(d);
    }
    self._xcvr._checkStatus(false);         // see footnote c, p.63
  });
};

PxX.prototype._read = function () {
  this._wantsRead = true;
  this._xcvr._checkStatus(false);
};

PxX.prototype.close = function () {
  if (this._xcvr._rxP0 === this) this._xcvr._rxP0 = null;
  // TODO: also update CE and RX_EN registers accordingly
  this.push(null);
  this.emit('close');
};


function PTX(xcvr, addr, opts) {
  opts = _extend({size:'auto',autoAck:true,ackPayloads:false}, opts);
  opts._enableRX = (opts.autoAck || opts.ackPayloads);
  PxX.call(this, xcvr, 0, addr, opts);
  _extend(this._sendOpts, {ack:opts._enableRX});
}

util.inherits(PTX, PxX);


function PRX(xcvr, pipe, addr, opts) {
  opts = _extend({size:'auto',autoAck:true}, opts);
  opts._primRX = opts._enableRX = true;
  PxX.call(this, xcvr, pipe, addr, opts);
  _extend(this._sendOpts, {ack:false, asAckTo:pipe});
}

util.inherits(PRX, PxX);


exports.PTX = PTX;
exports.PRX = PRX;
