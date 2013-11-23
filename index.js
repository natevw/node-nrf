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
    
    // caller must know pipe and provide its params!
    nrf.readPayload = function (params, cb) {
        if (params.width === 'auto') spi.transfer(Buffer([R_RX_PL_WID]), 2, function (e,d) {
            if (e) return finish(e);
            var width = d[1];
            if (width > 32) spi.write(Buffer([FLUSH_RX]), function (e,d) {
                finish(new Error("Invalid dynamic payload size, receive queue flushed."));  // per R_RX_PL_WID details, p.51
            }); else read(width);
        }); else read(params.width);
        
        function read(width) {
            spi.transfer(Buffer[R_RX_PAYLOAD], 1+width, function (e,d) {
                if (e) return finish(e);
                else finish(null, d.slice(1));
            });
        }
        
        function finish(e,d) {  // see footnote c, p.62
            if (params.leaveStatus) cb(e,d);
            else nrf.setStates({RX_DR:true}, function (e2) {    
                cb(e||e2,d);
            });
        }
    };
    
    var mode = 'off',
        pipes = [];
    nrf.setMode = function (newMode) {                     // ('off'), ('tx', addr), ('rx', addrs)
        mode = newMode;
        switch (mode) {
            case 'off':
            case 'tx':
            case 'rx':
            default:
                // TODO: close existing pipes, start any switch over, emit event when complete
        }
    };
    nrf.openPipe = function (addr, opts) {
        var pipe;
        switch (mode) {
            case 'off':
                throw Error("Radio must be in transmit or receive mode to open a pipe.");
            case 'tx':
                pipe = new PTX(addr, opts);
                break;
            case 'rx':
                pipe = new PRX(addr, opts);
                break;
            default:
                throw Error("Unknown mode '"+mode="', cannot open pipe!");
        }
        pipes.push(pipe);
        return pipe;
    };
    // interrupt: TX_DS, RX_DR, MAX_RT
    
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
                    nrf.getStates(['RX_DR','TX_DS','MAX_RT','RX_P_NO'], function (e,d) {
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
                            delete d.RX_P_NO;
                            nrf.setStates(d, function () {
                                cb(e);
                            });
                        }
                    }.bind(this));
                }); else cb(null);
            }.bind(this));
        }.bind(this));
    };
    PTX.prototype._read = function () {
        /* just gives okay to read, use this.push when packet received */
        this._wantsRead = true;
    };
    
    nrf.createTransmitStream = function (addr, opts) {
        return new PTX(addr,opts);
    };
    
    
    function PRX(pipe, addr, opts) {
        stream.Duplex.call(this);
        this._pipe = pipe;
        this._addr = addr;
        this._wantsRead = false;
        this._begin();
    }
    util.inherits(PRX, stream.Duplex);
    PRX.prototype._begin = function () {
        ce.value(true);         // TODO: coordinate to make sure PTX leaves high for us
        evt.on('interrupt', function () {         // TODO: make sure ours don't confuse PTX
            nrf.getStates(['RX_DR','RX_P_NO'], function (e,d) {
                if (e) return this.emit('error', e);
                if (!d.RX_DR || d.RX_P_NO !== this._pipe) return;
                if (!this._wantsRead) return;   // TODO: what are the implications of this? (need to reset IRQ at least!)
                nrf.readPayload(function (e,d) {
                    if (e) this.emit('error', e);
                    else this._wantsRead = this.push(d);
                });
                // TODO: we are ignoring this._wantsRead — we should probably let RX FIFO fill instead so xcvr stops ACKing!
                // TODO, cont'd: …but, how should we detect 
            }.bind(this))
        }.bind(this));
    };
    PRX.prototype._read = function () {
        this._wantsRead = true;
    };
    
    nrf.reserveReceiveStream = function (pipe, addr, opts) {
        return new PRX(pipe, addr, opts);
    };
    
    nrf.begin = function (states, cb) {
        if (arguments.length < 2) {
            cb = states;
            states = {};
        }
        ce.mode('low');
        q(1)
            .defer(nrf.execCommand, 'FLUSH_TX')
            .defer(nrf.execCommand, 'FLUSH_RX')
            .defer(nrf.setStates, _extend({}, REGISTER_DEFAULTS, {PWR_UP:true}, states))
        .await(cb);
        
        if (irq) {
            irq.mode('in');
            irq.on('fall', function (v) { evt.emit('interrupt'); });
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