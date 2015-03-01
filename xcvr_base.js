var util = require('util'),
    events = require('events'),
    fifo = require('fifolock'),
    _extend = require('xok');

var DEBUG = require("./logging").log.bind(null, 'debug'),
    _m = require("./magicnums");

// TODO: get rid of this
var async = require('queue-async');
function forEachWithCB(fn, cb) {
    var process = async(1);
    this.forEach(function (d) { process.defer(fn, d); });
    process.awaitAll(cb);
}

function RawTransceiver(hw) {
  this._hw = hw;
  this._T = _extend({}, _m.TIMING, {pd2stby:4500});        // may need local override of pd2stby
  this.blockMicroseconds = hw.blockMicroseconds || RawTransceiver.blockMicroseconds;
  
  this._q = fifo();
  this._SERIAL_ = function (cb, fn) {
    var args = Array.prototype.slice.call(arguments);
    args[0] = cb || function _nop() {};
    args[1] = fn.bind(this);
    return this._q.TRANSACTION_WRAPPER.apply(this, args);
  };
  this._NESTED_ = Object.create(null);     // signal value
}

util.inherits(RawTransceiver, events.EventEmitter);

RawTransceiver.blockMicroseconds = function (us) {
  // NOTE: setImmediate/process.nextTick too slow (especially on Pi) so we just spinloop for µs
  var start = process.hrtime();
  while (1) {
    var diff = process.hrtime(start);
    if (diff[0] * 1e9 + diff[1] >= us*1e3) break;
  }
  DEBUG("blocked for "+us+"µs.");
};

RawTransceiver.prototype.setCE = function (state, block) {
  if (typeof state === 'string') this._hw.ce.mode(state);
  else this._hw.ce.value(state);
  DEBUG("Set CE "+state+".");
  if (block) this.blockMicroseconds(this._T[block]);
};

RawTransceiver.prototype.pulseCE = function (block) {
  this.setCE(true, 'hce');
  this.setCE(false, block);
};

RawTransceiver.prototype.execCommand = function (cmd, data, cb, _n) {
  // NOTE: can omit `data` buffer, or specify numeric `readLen` instead
  if (typeof data === 'function' || typeof data === 'undefined') {
    _n = cb;
    cb = data;
    data = 0;
  }
cb = this._SERIAL_(cb, function () {
  DEBUG('execCommand', cmd, data);
  
  var cmdByte;
  if (typeof cmd === 'string') {
    cmdByte = _m.COMMANDS[cmd];
  } else if (Array.isArray(cmd)) {
    cmdByte = _m.COMMANDS[cmd[0]] | cmd[1];
  } else cmdByte = cmd;
  
  var writeBuf,
      readLen = 0;
  // NOTE: all of these write cmdByte *last*…
  if (Buffer.isBuffer(data)) {
    writeBuf = Buffer(data.length+1);
    writeBuf[data.length] = cmdByte;
    data.copy(writeBuf,0);
  } else if (Array.isArray(data)) {
    data.push(cmdByte);
    writeBuf = Buffer(data);
    data.pop();
  } else {
    writeBuf = Buffer([cmdByte]);
    readLen = data;
  }
  if (writeBuf.length > 1) {
    Array.prototype.reverse.call(writeBuf);   // …so this can handle "LSByte to MSByte" order, datasheet p.50/51
  }
  
  this._hw.spi.transfer(writeBuf, readLen && readLen+1, function (e,d) {
      if (readLen) DEBUG(' - exec read:', d);
      if (e) cb(e);
      else cb(null, d && Array.prototype.reverse.call(d.slice(1)));
  });
}, (_n === this._NESTED_ED_)); };

RawTransceiver.prototype.getStates = function (list, cb, _n) { cb = this._SERIAL_(cb, function () {
  var registersNeeded = _m.registersForMnemonics(list),
      states = Object.create(null),
      self = this;
  function processInquiryForRegister(reg, cb) {
    // TODO: execCommand always reads register 0x07 but we're not optimizing for that
    // TODO: we could probably also eliminate re-fetch of 0x07 during IRQ processing
    var iq = registersNeeded[reg];
    reg = +reg;
    self.execCommand(['R_REGISTER',reg], iq.len, function (e,d) {
      if (e) return cb(e);
      iq.arr.forEach(function (mnem) {
        var m = _m.maskForMnemonic(mnem);
        states[mnem] = (d[0] & m.mask) >> m.rightmostBit;
      });
      if (iq.solo) states[iq.solo] = d;
      cb();
    }, self._NESTED_ED_);
  }
  forEachWithCB.call(Object.keys(registersNeeded), processInquiryForRegister, function (e) {
    DEBUG('gotStates', states, e);
    cb(e,states);
  });
}, (_n === this._NESTED_ED_)); };

var _statusReg = _m.REGISTER_MAP['STATUS'][0];

RawTransceiver.prototype.setStates = function (vals, cb, _n) { cb = this._SERIAL_(cb, function () {
  DEBUG('setStates', vals);
  var self = this,
      registersNeeded = _m.registersForMnemonics(Object.keys(vals));
  function processInquiryForRegister(reg, cb) {
    var iq = registersNeeded[reg];
    reg = +reg;     // was string key, now convert back to number
    // if a register is "full" we can simply overwrite, otherwise we must read+merge
    // NOTE: high bits in RF_CH/PX_PW_Pn are *reserved*, i.e. technically need merging
    if (!iq.arr.length || iq.arr[0]==='RF_CH' || iq.arr[0].indexOf('RX_PW_P')===0) {
      var val = vals[iq.solo || iq.arr[0]],
          buf = (Buffer.isBuffer(val)) ? val : [val];
      self.execCommand(['W_REGISTER', reg], buf, cb, self._NESTED_ED_);
    } else self.execCommand(['R_REGISTER', reg], 1, function (e,d) {
      if (e) return cb(e);
      var val = d[0],
          settlingNeeded = 0;
      if (iq.solo) val = vals[iq.solo];  // TODO: refactor so as not to fetch in the first place!
      iq.arr.forEach(function (mnem) {
        var m = _m.maskForMnemonic(mnem);
        if (mnem === 'PWR_UP') {
          var rising = !(d[0] & m.mask) && vals[mnem];
          if (rising) settlingNeeded = Math.max(settlingNeeded, self._T.pd2stby);
        } else if (mnem === 'PRIM_RX') {    
          var changing = !(d[0] & m.mask) !== !vals[mnem];
          if (changing) settlingNeeded = Math.max(settlingNeeded, self._T.stby2a);
        }
        val &= ~m.mask;        // clear current value
        val |= (vals[mnem] << m.rightmostBit) & m.mask;
      });
      if (val !== d[0] || reg === _statusReg) self.execCommand(['W_REGISTER', reg], [val], function () {
        if (settlingNeeded) self.blockMicroseconds(settlingNeeded);  // see p.24
        cb.apply(this, arguments);
      }, self._NESTED_);
      else cb(null);  // don't bother writing if value hasn't changed (unless status, which clears bits)
    }, self._NESTED_);
  }
  forEachWithCB.call(Object.keys(registersNeeded), processInquiryForRegister, cb);
}, (_n === this._NESTED_)); };

RawTransceiver.prototype._checkStatus = function (irq) {
  // NOTE: relies on `getStates` for serialized-async
  DEBUG("_checkStatus, irq =", irq);
  var self = this;
  self.getStates(['RX_P_NO','TX_DS','MAX_RT','RX_DR'], function (e,d) {
    if (e) self.emit('error', e);
    else if (d.RX_DR && d.RX_P_NO === 0x07) setTimeout(function () {
      // HACK: chip seems to assert RX_DR a while before setting RX_P_NO, so poll if necessary
      // TODO: this may actually just happen until we reset RX_DR (maybe FLUSH_RX or similar unsyncs?)
      // see also note on top of datasheet p.52 about status register updated *during* IRQ transmission
      DEBUG("- weird status, checking again -");
      self._checkStatus(false);
    }, 0);
    else if (irq || d.RX_P_NO !== 0x07 || d.TX_DS || d.MAX_RT) self.emit('interrupt', d);
  });
};

RawTransceiver.prototype.monitorIRQ = function (val) {
  var hw_irq = this._hw.irq;
  if (val) {
    if (this._irqListener) return;
    else if (hw_irq) {
      this._irqListener = this._checkStatus.bind(this);
      hw_irq.mode('in');
      hw_irq.addListener('fall', this._irqListener);
    } else {
      this._irqListener = setInterval(function () {
        // TODO: clear interval when there are no listeners?
        if (this.listeners('interrupt').length) this._checkStatus(false);
      }.bind(this), 0);  // (minimum 4ms is a looong time if hoping to quickly stream data!)
    }
  } else {
    if (!this._irqListener) return;
    else if (hw_irq) hw_irq.removeListener('fall', irqListener);
    else clearInterval(this._irqListener);
  }
};

module.exports = RawTransceiver;