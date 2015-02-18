var util = require('util'),
    _extend = require('xok');

var DEBUG = require("./logging").log.bind(null, 'debug'),
    RawTransceiver = require("./xcvr_base"),
    pipes = require("./xcvr_pipes"),
    _m = require("./magicnums");


function Transceiver(hw) {
  RawTransceiver.call(this, hw);
  
  this._ready = false;
  this._txQ = [];       // TODO: is this still needed?
  this._txPipes = [];
  this._rxPipes = [];
  this._rxP0 = null;
}

util.inherits(Transceiver, RawTransceiver);


/* CONFIGURATION WRAPPERS */

// NOTE: these rely on `getStates`/`setStates` for serialized-async

function _nop() {}          // used when a cb is not provided

Transceiver.prototype.powerUp = function (val, cb) {
  if (typeof val === 'function' || typeof val === 'undefined') {
    cb = val || _nop;
    this.getStates(['PWR_UP'], function (e,d) { cb(e, d && !!d.PWR_UP); });
  } else this.setStates({PWR_UP:val}, cb);
  return this;
};

Transceiver.prototype.channel = function (val, cb) {
  if (typeof val === 'function' || typeof val === 'undefined') {
    cb = val || _nop;
    this.getStates(['RF_CH'], function (e,d) { cb(e, d && d.RF_CH); });
  } else this.setStates({RF_CH:val}, cb);
  return this;
};

Transceiver.prototype.dataRate = function (val, cb) {
  if (typeof val === 'function' || typeof val === 'undefined') {
    cb = val || _nop;
    this.getStates(['RF_DR_LOW', 'RF_DR_HIGH'], function (e,d) {
      if (e) return cb(e);
      else if (d.RF_DR_LOW) cb(null, '250kbps');
      else if (d.RF_DR_HIGH) cb(null, '2Mbps');
      else cb(null, '1Mbps');
    });
  } else {
    switch (val) {
      case '1Mbps':
        val = {RF_DR_LOW:false,RF_DR_HIGH:false};
        break;
      case '2Mbps':
        val = {RF_DR_LOW:false,RF_DR_HIGH:true};
        break;
      case '250kbps':
        val = {RF_DR_LOW:true,RF_DR_HIGH:false};
        break;
      default:
        throw Error("dataRate must be one of '1Mbps', '2Mbps', or '250kbps'.");
    }
    this.setStates(val, cb);
  }
  return this;
};

Transceiver.prototype.transmitPower = function (val, cb) {
  if (typeof val === 'function' || typeof val === 'undefined') {
    cb = val || _nop;
    this.getStates(['RF_PWR'], function (e,d) { cb(e, d && _m.TX_POWER[d.RF_PWR]); });
  } else {
    val = _m.TX_POWER.indexOf(val);
    if (val === -1) throw Error("Radio power must be 'PA_MIN', 'PA_LOW', 'PA_HIGH' or 'PA_MAX'.");
    this.setStates({RF_PWR:val}, cb);
  }
  return this;
};

Transceiver.prototype.crcBytes = function (val, cb) {
  if (typeof val === 'function' || typeof val === 'undefined') {
    cb = val || _nop;
    this.getStates(['EN_CRC, CRCO'], function (e,d) {
      if (e) return cb(e);
      else if (!d.EN_CRC) cb(null, 0);
      else if (d.CRCO) cb(null, 2);
      else cb(null, 1);
    });
  } else {
    switch (val) {
      case 0:
        val = {EN_CRC:false,CRCO:0};
        break;
      case 1:
        val = {EN_CRC:true,CRCO:0};
        break;
      case 2:
        val = {EN_CRC:true,CRCO:1};
        break;
      default:
        throw Error("crcBytes must be 1, 2, or 0.");
    }
    this.setStates(val, cb);
  }
  return this;
};

Transceiver.prototype.addressWidth = function (val, cb) {
  if (typeof val === 'function' || typeof val === 'undefined') {
    cb = val || _nop;
    this.getStates(['AW'], function (e,d) { cb(e, d && d.AW+2); });
  } else this.setStates({AW:val-2}, cb);
  return this;
};

Transceiver.prototype.autoRetransmit = function (val, cb) {
  if (typeof val === 'function' || typeof val === 'undefined') {
    cb = val || _nop;
    this.getStates(['ARD, ARC'], function (e,d) { cb(e, d && {count:d.ARC,delay:250*(1+d.ARD)}); });
  } else {
    var states = {};
    if ('count' in val) states['ARC'] = val.count;
    if ('delay' in val) states['ARD'] = val.delay/250 - 1;
    this.setStates(states, cb);
  }
  return this;
};


/* PAYLOAD ROUTINES */

// caller must know pipe and provide its params (e.g. width stuff)
Transceiver.prototype.readPayload = function (opts, cb, _n) { cb = this._SERIAL_(cb, function () {
    var self = this;
    if (opts.width === 'auto') self.execCommand('R_RX_PL_WID', 1, function (e,d) {
      if (e) return finish(e);
      var width = d[0];
      if (width > 32) self.execCommand('FLUSH_RX', function (e,d) {
        finish(new Error("Invalid dynamic payload size, receive queue flushed."));  // per R_RX_PL_WID details, p.51
      }, self._NESTED_); else read(width);
    }, self._NESTED_); else read(opts.width);
    
    function read(width) {
      self.execCommand('R_RX_PAYLOAD', width, finish, self._NESTED_);
    }
    
    function finish(e,d) {  // see footnote c, p.62
      if (opts.leaveStatus) cb(e,d);
      else self.setStates({RX_DR:true,TX_DS:false,MAX_RT:false}, function (e2) {    
        cb(e||e2,d);
      }, self._NESTED_);
    }
}, (_n === this._NESTED_)); };

// caller must set up any prerequisites (i.e. TX addr)
Transceiver.prototype.sendPayload = function (data, opts, cb, _n) { cb = this._SERIAL_(cb, function () {
  if (data.length > 32) throw Error("Maximum packet size exceeded. Smaller writes, Dash!");
  self._prevSender = null;     // help PxX setup again if user sends data directly
  
  var cmd;
  if ('asAckTo' in opts) {
    cmd = ['W_ACK_PAYLOAD',opts.asAckTo];
  } else if (opts.ack) {
    cmd = 'W_TX_PAYLOAD';
  } else {
    cmd = 'W_TX_PD_NOACK';
  }
  
  var self = this;
  self.execCommand(cmd, data, function (e) {
    if (e) return cb(e);
    if (!opts.ceHigh) self.pulseCE('pece2csn');
    // TODO: if _sendOpts.asAckTo we won't get MAX_RT interrupt — how to prevent a blocked TX FIFO? (see p.33)
    self.once('interrupt', function (d) {
      if (d.MAX_RT) self.execCommand('FLUSH_TX', function (e) {    // see p.56
        finish(new Error("Packet timeout, transmit queue flushed."));
      }, self._NESTED_);
      else if (!d.TX_DS) console.warn("Unexpected IRQ during transmit phase!");
      else finish();
      
      function finish(e) {        // clear our interrupts, leaving RX_DR
        self.setStates({TX_DS:true,MAX_RT:true,RX_DR:false}, function () {
          cb(e||null);
        }, self._NESTED_);
      }
    });
  }, self._NESTED_);  
}, (_n === this._NESTED_)); };


/* LIFECYCLE ROUTINES */

Transceiver.prototype.reset = function (states, cb, _n) {
  if (typeof states === 'function' || typeof states === 'undefined') {
    _n = cb;
    cb = states;
    states = _m.REGISTER_DEFAULTS;
  }
cb = this._SERIAL_(cb, function () {
  var self = this;
  self.setCE('low','stby2a');
  self.execCommand('FLUSH_TX', function (e) {
    if (e) cb(e);
    else self.execCommand('FLUSH_RX', function (e) {
      if (e) cb(e);
      else self.setStates(states, cb, self._NESTED_);
    }, self._NESTED_);
  }, self._NESTED_);
}, (_n === this._NESTED_)); };

Transceiver.prototype.begin = function (cb) {
  // NOTE: this relies on `reset` for serialized-async
  var self = this,
      clearIRQ = {RX_DR:true, TX_DS:true, MAX_RT:true},
      features = {EN_DPL:true, EN_ACK_PAY:true, EN_DYN_ACK:true};
  self.setCE('low','stby2a');
  self.reset(_extend({PWR_UP:true, PRIM_RX:false, EN_RXADDR:0x00},clearIRQ,features), function (e) {
    if (e) return self.emit('error', e);
    // TODO: revisit this setting (make advanced users manage themselves?)
    self.monitorIRQ(true);           // NOTE: on before any pipes to facilite lower-level sendPayload use
    self._ready = true;
    self.emit('ready');
  });
  if (cb) self.once('ready', cb);
};

Transceiver.prototype.end = function (cb) {
  var self = this,
      pipes = self._txPipes.concat(self._rxPipes);
  pipes.forEach(function (pipe) { pipe.close(); });
  self._txPipes.length = self._rxPipes.length = self._txQ.length = 0;
  self._ready = false;
  self.monitorIRQ(false);
  self.setCE(false,'stby2a');
  self.setStates({PWR_UP:false}, function (e) {
    if (e) self.emit('error', e);
    if (cb) cb(e);
  });
};

Transceiver.prototype._slotForAddr = function (addr) {
    var slot = Array(6), aw = Math.max(3,Math.min(addr.length, 5));
    this._rxPipes.forEach(function (pipe) { slot[pipe._pipe] = pipe._addr; });
    if (slot[1]) aw = slot[1].length;       // address width already determined
    if (addr.length === 1) {            // find a place in last four pipes
        for (var i = 2; i < 6; ++i) if (!slot[i]) return i;
        throw Error("No more final-byte listener addresses available!");
    } else if (addr.length === aw) {    // use pipe 1 or 0
        if (!slot[1]) return 1;
        else if (!slot[0]) return 0;        // NOTE: using pipe 0 has caveats!
        else throw Error("No more "+aw+"-byte listener addresses available!");
    } else {
        throw Error("Address 0x"+addr.toString(16)+" is of unsuitable width for use.");
    }
};

Transceiver.prototype.openPipe = function (rx_tx, addr, opts) {
  if (!this._ready) throw Error("Radio .begin() must be finished before a pipe can be opened.");
  if (typeof addr === 'number') addr = Buffer(addr.toString(16), 'hex');
  opts || (opts = {});
  
  var pipe;
  if (rx_tx === 'rx') {
      var s = this._slotForAddr(addr);
      pipe = new pipes.PRX(this, s, addr, opts);
      this._rxPipes.push(pipe);
  } else if (rx_tx === 'tx') {
      pipe = new pipes.PTX(this, addr, opts);
      this._txPipes.push(pipe);
  } else {
      throw Error("Unknown pipe mode '"+rx_tx+"', must be 'rx' or 'tx'.");
  }
  return pipe;
};

module.exports = Transceiver;
