var q = require('queue-async'),
    stream = require('stream'),
    util = require('util'),
    events = require('events'),
    SPI = require('pi-spi'),
    GPIO = require("./gpio");

var COMMANDS = require("./magicnums").COMMANDS,
    REGISTER_MAP = require("./magicnums").REGISTER_MAP,
    REGISTER_DEFAULTS = require("./magicnums").REGISTER_DEFAULTS;

function forEachWithCB(fn, cb) {
    var arr = this,
        i = 0, len = arr.length;
    (function proceed() {
        if (i === len) cb(null);
        else fn(arr[i++], function (e) {
            if (e) cb(e);
            else proceed();
        });
    })();
};

function _extend(obj) {
    for (var i = 1, len = arguments.length; i < len; i++) {
        var nxt = arguments[i];
        Object.keys(nxt).forEach(function (k) { obj[k] = nxt[k]; });
    }
    return obj;
}

function blockUS(us) {      // NOTE: setImmediate/process.nextTick too slow (especially on Pi) so we just spinloop for µs
    var start = process.hrtime();
    while (1) {
        var diff = process.hrtime(start);
        if (diff[0] * 1e9 + diff[1] >= us*1e3) break;
    }
}

//start = process.hrtime(), setMicrotimeout(function () { console.log(process.hrtime(start)[1]/1e3); }, 10)


exports.connect = function (spi,ce,irq) {
    var nrf = {},
        evt = new events.EventEmitter(),
        spi = SPI.initialize(spi),
        ce = GPIO.connect(ce),
        irq = (arguments.length > 2) && GPIO.connect(irq);
    
    function registersForMnemonics(list) {
        var registersNeeded = Object.create(null);
        list.forEach(function (mnem) {
            var _r = REGISTER_MAP[mnem];
            if (!_r) return console.warn("Skipping uknown mnemonic '"+mnem+"'!");
            if (_r.length === 1) _r.push(0,8);
            
            var reg = _r[0],
                howManyBits = _r[2] || 1,
                iq = registersNeeded[reg] || (registersNeeded[reg] = {arr:[]});
            iq.len = (howManyBits / 8 >> 0) || 1;
            if (howManyBits < 8) iq.arr.push(mnem);
            else iq.solo = mnem;
        });
        return registersNeeded;
    }
    
    function maskForMnemonic(mnem) {
        var _r = REGISTER_MAP[mnem],
            howManyBits = _r[2] || 1,
            rightmostBit = _r[1],
            mask = 0xFF >> (8 - howManyBits) << rightmostBit;
        return {mask:mask, rightmostBit:rightmostBit};
    }
    
    nrf.getStates = function (list, cb) {
        var registersNeeded = registersForMnemonics(list),
            states = Object.create(null);
        function processInquiryForRegister(reg, cb) {
            // TODO: d[0] always has register 0x07 but we're not optimizing for that
            var iq = registersNeeded[reg];
            spi.transfer(Buffer([COMMANDS.R_REGISTER|reg]), 1+iq.len, function (e,d) {
                if (e) return cb(e);
                iq.arr.forEach(function (mnem) {
                    var m = maskForMnemonic(mnem);
                    states[mnem] = (d[1] & m.mask) >> m.rightmostBit;
                });
                if (iq.solo) states[iq.solo] = d.slice(1);
                cb();
            });
        }
        forEachWithCB.call(Object.keys(registersNeeded), processInquiryForRegister, function (e) {
            cb(e,states);
        });
    };
    
    nrf.setStates = function (vals, cb) {
        var registersNeeded = registersForMnemonics(Object.keys(vals));
        function processInquiryForRegister(reg, cb) {
            var iq = registersNeeded[reg];
            // if a register is "full" we can simply overwrite, otherwise we must read+merge
            // NOTE: high bits in RF_CH/PX_PW_Pn are *reserved*, i.e. technically need merging
            if (!iq.arr.length || iq.arr[0]==='RF_CH' || iq.arr[0].indexOf('RX_PW_P')===0) {
                var d = Buffer(1+iq.len),
                    val = vals[iq.solo || iq.arr[0]];
                d[0] = COMMANDS.W_REGISTER|reg;
                if (Buffer.isBuffer(val)) val.copy(d, 1);
                else d[1] = val;
                spi.write(d, cb);
            } else spi.transfer(Buffer([COMMANDS.R_REGISTER|reg]), /*1+iq.len*/2, function (e,d) {
                if (e) return cb(e);
                d[0] = COMMANDS.W_REGISTER|reg;     // we reuse read buffer for writing
                if (iq.solo) d[1] = vals[iq.solo];  // TODO: refactor so as not to fetch in the first place!
                iq.arr.forEach(function (mnem) {
                    var m = maskForMnemonic(mnem);
                    d[1] &= ~m.mask;        // clear current value
                    d[1] |= (vals[mnem] << m.rightmostBit) & m.mask;
                });
                spi.write(d, cb);
            });
        }
        forEachWithCB.call(Object.keys(registersNeeded), processInquiryForRegister, cb);
    };
    
    nrf.pulseCE = function () {
        ce.value(true);     // pulse for at least 10µs
        blockUS(10);
        ce.value(false);
    };
    
    // expose:
    // - low level interface (getStates, setStates, etc.)
    // - mid level interface (channel, datarate, power, …)
    // - high level PRX (addrs)
    // - high level PTX (addr)
    
    function PTX(addr,opts) {
        stream.Duplex.call(this);
        this._addr = addr;
        this._wantsRead = false;
    }
    util.inherits(PTX, stream.Duplex);
    PTX.prototype._write = function (buff, _enc, cb) {
        // TODO: handle shared transmissions (via stack?)
        // TODO: don't set RX_ADDR_P0 if simplex/no-ack
        if (buff.length > 32) return process.nextTick(function () {
            cb(new Error("Maximum packet size exceeded. Smaller writes, Dash!"));
        });
        
        var acking = true,
            states = {TX_ADDR:this._addr, PRIM_RX:false};
        if (acking) states.RX_ADDR_P0 = states.TX_ADDR;
        nrf.setStates(states, function (e) {
            if (e) return cb(e);
            var d = Buffer(1+buff.length);
            d[0] = COMMANDS.W_TX_PAYLOAD;
            buff.copy(d, 1);
            spi.write(d, function (e) {
                if (e) return cb(e);
                nrf.pulseCE();
                if (acking) evt.once('interrupt', function () {
console.log("irq, reading states");
                    nrf.getStates(['RX_DR','TX_DS','MAX_RT','RX_P_NO'], function (e,d) {
console.log("states:",d);
                        if (e) return cb(e);
                        if (d.MAX_RT) finish(new Error("Packet timeout."));
                        else if (d.RX_DR && d.RX_P_NO === 0) {      // got ACK payload
                            // NOTE: we ignore this._wantsRead, prefering to buffer rather than drop
                            nrf.getStates(['RX_PW_P0'], function (e,d) {
                                if (e) return finish(e);
                                spi.transfer(Buffer([COMMANDS.R_RX_PAYLOAD]), 1+d.RX_PW_P0, function (e,d) {
                                    if (e) return finish(e);
                                    this._wantsRead = this.push(d);
                                });
                            });
                        } else finish(null);
                        function finish(e) {        // clear interrupt and call back
console.log("finishing", e);
                            delete d.RX_P_NO;
                            nrf.setStates(d, function () {
                                cb(e);
                            });
                        }
                    });
                }); else cb(null);
            });
        });
    };
    PTX.prototype._read = function () {
        /* just gives okay to read, use this.push when packet received */
        this._wantsRead = true;
    };
    
    nrf.createTransmitStream = function (addr, opts) {
        return new PTX(addr,opts);
    };
    
    //nrf.reserveReceiveStream = function ([pipe, ]addr) {};
    
    
    nrf.begin = function (cb) {
        ce.mode('low');
        q(1)
            .defer(nrf.execCommand, 'FLUSH_TX')
            .defer(nrf.execCommand, 'FLUSH_RX')
            .defer(nrf.setStates, _extend({}, REGISTER_DEFAULTS, {PWR_UP:true}))
        .await(cb);
        
        if (irq) {
            irq.mode('in');
            irq.on('fall', function (v) { console.log("IRQ received"); evt.emit('interrupt'); });
            irq.on('rise', function (v) { console.log("IRQ cleared"); });
        } else {
            // TODO: what? poll status ourselves?
            throw new Error("Must be used with IRQ pin until fallback handling is added.");
        }
    }
    
    nrf.execCommand = function (cmd, cb) {
        spi.write(Buffer([COMMANDS[cmd]]), cb);
    };
    nrf.getStatus = function (cb) {
        nrf.getStates(['RX_DR','TX_DS','MAX_RT','RX_P_NO','TX_FULL'], function (e,d) {
            if (d) d.IRQ = irq.value();
            cb(e,d);
        });
    }
    
    return nrf;
}