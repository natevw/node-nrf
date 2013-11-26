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

function blockMicroseconds(us) {      // NOTE: setImmediate/process.nextTick too slow (especially on Pi) so we just spinloop for µs
    var start = process.hrtime();
    while (1) {
        var diff = process.hrtime(start);
        if (diff[0] * 1e9 + diff[1] >= us*1e3) break;
    }
}


exports.connect = function (spi,ce,irq) {
    var _spi = spi, _ce = ce, _irq = irq;       // only for printDetails!
    var nrf = new events.EventEmitter(),
        spi = SPI.initialize(spi),
        ce = GPIO.connect(ce),
        irq = (arguments.length > 2) && GPIO.connect(irq);
    
    nrf.execCommand = function (cmd, data, cb) {        // (can omit data, or specify readLen instead)
        if (typeof data === 'function') {
            cb = data;
            data = 0;
        }
        
        var cmdByte;
        if (typeof cmd === 'string') {
            cmdByte = COMMANDS[cmd];
        } else if (Array.isArray(cmd)) {
            cmdByte = COMMANDS[cmd[0]] | cmd[1];
        } else cmdByte = cmd;
        
        var writeBuf,
            readLen = 0;
        if (Buffer.isBuffer(data)) {
            writeBuf = Buffer(data.length+1);
            writeBuf[0] = cmdByte;
            data.copy(writeBuf,1);
        } else if (Array.isArray(data)) {
            writeBuf = Buffer([cmdByte].concat(data));
        } else {
            writeBuf = Buffer([cmdByte]);
            readLen = data;
        }
        
console.log('spi.transfer', writeBuf, readLen);
        spi.transfer(writeBuf, readLen && readLen+1, function (e,d) {
console.log(' result:', d, e);
            if (e) return cb(e);
            else return cb(null, d && d.slice(1));
        });
    };   
    
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
            // TODO: execCommand always reads register 0x07 but we're not optimizing for that
            var iq = registersNeeded[reg];
            nrf.execCommand(['R_REGISTER',reg], iq.len, function (e,d) {
                if (e) return cb(e);
                iq.arr.forEach(function (mnem) {
                    var m = maskForMnemonic(mnem);
                    states[mnem] = (d[0] & m.mask) >> m.rightmostBit;
                });
                if (iq.solo) states[iq.solo] = d;
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
                var val = vals[iq.solo || iq.arr[0]],
                    buf = (Buffer.isBuffer(val)) ? val : [val];
                nrf.execCommand(['W_REGISTER', reg], buf, cb);
            } else nrf.execCommand(['R_REGISTER', reg], 1, function (e,d) {
                if (e) return cb(e);
                var val = 0;
                if (iq.solo) val = vals[iq.solo];  // TODO: refactor so as not to fetch in the first place!
                iq.arr.forEach(function (mnem) {
                    var m = maskForMnemonic(mnem);
                    val &= ~m.mask;        // clear current value
                    val |= (vals[mnem] << m.rightmostBit) & m.mask;
                });
                nrf.execCommand(['W_REGISTER', reg], [val], cb);
            });
        }
        forEachWithCB.call(Object.keys(registersNeeded), processInquiryForRegister, cb);
    };
    
    nrf.pulseCE = function () {
        ce.value(true);     // pulse for at least 10µs
        blockMicroseconds(10);
        ce.value(false);
    };
    
    // ✓ low level interface (execCommand, getStates, setStates, pulseCE, 'interrupt')
    // ✓ mid level interface (channel, dataRate, power, crcBytes, autoRetransmit{count,delay})
    // ✓ high level PRX (addrs)
    // ✓ high level PTX (addr)
    // - test!
    // - document
    
    nrf.channel = function (val, cb) {
        if (arguments.length < 2) {
            cb = val;
            nrf.getStates(['RF_CH'], function (e,d) { cb(e, d && d.RF_CH); });
        } else nrf.setStates({RF_CH:val}, cb);
        return this;
    };
    
    nrf.dataRate = function (val, cb) {
        if (arguments.length < 2) {
            cb = val;
            nrf.getStates(['RF_DR_LOW, RF_DR_HIGH'], function (e,d) {
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
            nrf.setStates(val, cb);
        }
        return this;
    };
    
    nrf.power = function (val, cb) {
        var vals = ['PA_MIN', 'PA_LOW', 'PA_HIGH', 'PA_MAX'];
        if (arguments.length < 2) {
            cb = val;
            nrf.getStates(['RF_PWR'], function (e,d) { cb(e, d && vals[d.RF_PWR]); });
        } else {
            val = vals.indexOf(val);
            if (val === -1) throw Error("Radio power must be 'PA_MIN', 'PA_LOW', 'PA_HIGH' or 'PA_MAX'.");
            nrf.setStates({RF_PWR:val}, cb);
        }
        return this;
    };
    
    nrf.crcBytes = function (val, cb) {
        if (arguments.length < 2) {
            cb = val;
            nrf.getStates(['EN_CRC, CRCO'], function (e,d) {
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
            nrf.setStates(val, cb);
        }
        return this;
    };
    
    nrf.autoRetransmit = function (val, cb) {
        if (arguments.length < 2) {
            cb = val;
            nrf.getStates(['ARD, ARC'], function (e,d) { cb(e, d && {count:d.ARC,delay:250*(1+d.ARD)}); });
        } else {
            var states = {};
            if ('count' in val) states['ARC'] = val.count;
            if ('delay' in val) states['ARD'] = val.delay/250 - 1;
            nrf.setStates(val, cb);
        }
    };
    
    // caller must know pipe and provide its params!
    nrf.readPayload = function (opts, cb) {
        if (opts.width === 'auto') nrf.execCommand('R_RX_PL_WID', 1, function (e,d) {
            if (e) return finish(e);
            var width = d[0];
            if (width > 32) nrf.execCommand('FLUSH_RX', function (e,d) {
                finish(new Error("Invalid dynamic payload size, receive queue flushed."));  // per R_RX_PL_WID details, p.51
            }); else read(width);
        }); else read(opts.width);
        
        function read(width) {
            nrf.execCommand('R_RX_PAYLOAD', width, finish);
        }
        
        function finish(e,d) {  // see footnote c, p.62
            if (opts.leaveStatus) cb(e,d);
            else nrf.setStates({RX_DR:true}, function (e2) {    
                cb(e||e2,d);
            });
        }
    };
    
    // caller must set up any prerequisites (i.e. TX addr) and ensure no other send is pending
    nrf.sendPayload = function (data, opts, cb) {
        nrf._prevSender = null;     // help PxX setup again if user sends data directly
        if (data.length > 32) throw Error("Maximum packet size exceeded. Smaller writes, Dash!");
        
        var cmd;
        if (opts.ackTo) {
            cmd = ['W_ACK_PAYLOAD',opts.ackTo];
        } else if (opts.noAck) {
            cmd = 'W_TX_PD_NOACK';
        } else {
            cmd = 'W_TX_PAYLOAD';
        }
        nrf.execCommand(cmd, data, function (e) {
            if (e) return cb(e);
            nrf.pulseCE();
            nrf.once('interrupt', function (d) {
                if (d.MAX_RT) nrf.execCommand('FLUSH_TX', function (e) {    // see p.56
                    finish(new Error("Packet timeout, transmit queue flushed."));
                });
                else if (!d.TX_DS) console.warn("Unexpected IRQ during transmit phase!");
                else finish();
                
                function finish(e) {        // clear our interrupts, leaving RX_DR
                    nrf.setStates({TX_DS:true,MAX_RT:true,RX_DR:false}, function () {
                        cb(e||null);
                    });
                }
            });
        });  
    };
    
    nrf.reset = function (states, cb) {
        if (arguments.length < 2) {
            cb = states;
            states = {};
        }
        ce.mode('low');
        q(1)
            .defer(nrf.execCommand, 'FLUSH_TX')
            .defer(nrf.execCommand, 'FLUSH_RX')
            .defer(nrf.setStates, states || REGISTER_DEFAULTS)
        .await(cb);
    };
    
    nrf._checkStatus = function (irq) {
        nrf.getStates(['RX_P_NO','TX_DS','MAX_RT'], function (e,d) {
            if (e) nrf.emit('error', e);
            else if (irq || d.RX_P_NO !== 0x07 || d.TX_DS || d.MAX_RT) nrf.emit('interrupt', d);
        });
    };
    
    var irqListener = nrf._checkStatus.bind(nrf,true),
        irqOn = false;
    nrf._irqOn = function () {
        if (irqOn) return;
        else if (irq) {
            irq.mode('in');
            irq.addListener('fall', irqListener);
        } else {
            console.warn("Recommend use with IRQ pin, fallback handling is suboptimal.");
            irqListener = setInterval(function () {       // TODO: clear interval when there are no listeners
                if (nrf.listeners('interrupt').length) nrf._checkStatus(false);
            }, 0);  // (minimum 4ms is a looong time if hoping to quickly stream data!)
        }
        irqOn = true;
    };
    nrf._irqOff = function () {
        if (!irqOn) return;
        else if (irq) irq.removeListener('fall', irqListener);
        else clearInterval(irqListener);
        irqOn = false;
    };
    
    
    var mode = 'off',
        pipes = [];   
    function slotForAddr(addr) {
        var slots = Array(6), aw = Math.max(3,Math.min(addr.length, 5));
        pipes.forEach(function (pipe) { slot[pipe._pipe] = pipe._addr; });
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
    }
    nrf.mode = function (newMode, cb) {
        if (arguments.length < 1) return mode;
        
        mode = 'pending-'+newMode;
        pipes.forEach(function (pipe) { pipe.close(); });
        pipes.length = 0;
        
        var clearIRQ = {RX_DR:true, TX_DS:true, MAX_RT:true},
            features = {EN_DPL:true, EN_ACK_PAY:true, EN_DYN_ACK:true};
        switch (newMode) {
            case 'reset':
                newMode = 'off';
                nrf._irqOff();
                nrf.reset(ready);
                break;
            case 'off':
                nrf._irqOff();
                ce.mode('low');
                nrf.setStates({PWR_UP:false}, ready);
                break;
            case 'tx':
                ce.mode('low');
                nrf.reset(_extend({PWR_UP:true, PRIM_RX:false},clearIRQ,features), function (e) {
                    if (e) return nrf.emit('error', e);
                    nrf._irqOn();
                    ready();
                });
                break;
            case 'rx':
                nrf.reset(_extend({PWR_UP:true, PRIM_RX:true, EN_RXADDR:0x00},clearIRQ,features), function (e) {
                    if (e) return nrf.emit('error', e);
                    ce.mode('high');
                    nrf._irqOn();
                    ready();
                });
                break;
            default:
                throw Error("Unknown mode '"+newMode+"'!");
        }
        
        function ready() {
            mode = newMode;
            nrf.emit('ready', mode);
        }
        if (cb) nrf.once('ready', cb);
        return this;
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
                var s = slotForAddr(addr);
                pipe = new PRX(s, addr, opts);
                break;
            default:
                throw Error("Unknown mode '"+mode="', cannot open pipe!");
        }
        pipes.push(pipe);
        return pipe;
    };
    
    
    function PxX(pipe, addr, opts) {           // base for PTX/PRX
        stream.Duplex.call(this);
        this._pipe = pipe;
        this._addr = addr;
        this._size = opts.size || 'auto';
        this._wantsRead = false;
        this._sendOpts = {};
        
        var s = {},
            n = pipe;
        if (opts.noRX) {
            s['ERX_P'+n] = false;
        } else {
            if (addr.length > 1) s['AW'] = addr.length;     // slotForAddr ensures consistency with others
            s['RX_ADDR_P'+n] = addr;
            s['ERX_P'+n] = true;
        }
        if (opts.noRX) {
            s['DPL_P'+n] = false;
            s['ENAA_P'+n] = false;
        } else if (this._size === 'auto') {
            s['ENAA_P'+n] = true;   // must be set for DPL (…not sure why)
            s['DPL_P'+n] = true;
        } else {
            s['RX_PW_P'+n] = this._size;
            s['DPL_P'+n] = false;
            s['ENAA_P'+n] = opts.autoAck || false;
        }
        nrf.setStates(s, function (e) {
            if (e) this.emit('error', e);
            else this.emit('ready');
        }.bind(this));
        
        var irqHandler = this._rx.bind(this);
        nrf.addListener('interrupt', irqHandler);
        this.once('close', function () {
            nrf.removeListener('interrupt', irqHandler);
        });
    }
    util.inherits(PxX, stream.Duplex);
    PxX.prototype._write = function (buff, _enc, cb) {
        var s = {};         // see p.75
        if (!this._sendOpts.ackTo) {
            s['TX_ADDR'] = this._addr;
            s['PRIM_RX'] = false;
        }
        if (!this._sendOpts.noAck) {
            s['RX_ADDR_P0'] = this._addr;
        }
        if (nrf._prevSender === this) s = {};
        nrf.setStates(s, function (e) {     // (± fine to call with no keys)
            if (e) return cb(e);
            try {
                nrf.sendPayload(buff, this._sendOpts, cb);
                nrf._prevSender = this;    // maybe we can avoid setting state next time
            } catch (e) {
                cb(e);
            }
        });
    };
    PxX.prototype._rx = function (d) {
        if (d.RX_P_NO !== this._pipe) return;
        if (!this._wantsRead) return;           // NOTE: this could starve other RX pipes!
        
        if (this._wantsRead) nrf.readPayload({width:this._size}, function (e,d) {
            if (e) this.emit('error', e);
            else this._wantsRead = this.push(d);
            nrf._checkStatus(false);         // see footnote c, p.63
        }.bind(this));
    };
    PxX.prototype._read = function () {
        this._wantsRead = true;
        nrf._checkStatus(false);
    };
    PxX.prototype.close = function () {
        this.push(null);
        this.emit('close');
    };
    
    function PTX(addr,opts) {               // opts: size,noRX,noAck
        opts = _extend({}, opts||{}, {size:'auto'});
        PxX.call(this, 0, addr, opts);
        this._sendOpts = {noAck:(opts.noRX||opts.noAck)};
    }
    util.inherits(PTX, PxX);
    
    function PRX(pipe, addr, opts) {        // opts: size,autoAck
        PxX.call(this, pipe, addr, opts);
        this._sendOpts = {ackTo:pipe};
    }
    util.inherits(PRX, PxX);
    
    
    nrf.printStatus = function () {         // for debugging
        nrf.getStates(['RX_DR','TX_DS','MAX_RT','RX_P_NO','TX_FULL'], function (e,d) {
            if (e) throw e;
            else console.log(irq.value() ? 'no-irq' : '-IRQ-', d);
        });
    };
    
    nrf.printDetails = function () {        // for debugging, mimic e.g. https://github.com/stanleyseow/RF24/blob/master/librf24-rpi/librf24/RF24.cpp#L318
        console.log("SPI device:\t",_spi);
        //console.log("SPI speed:\t",'?');
        console.log("CE GPIO:\t",_ce);
        console.log("IRQ GPIO:\t",_irq);
        nrf.getStates(['STATUS','RX_DR','TX_DS','MAX_RT','RX_P_NO','TX_FULL'], function (e,d) {
            if (e) throw e;
            console.log("STATUS:\t\t",_h(d.STATUS[0]),'RX_DR='+d.RX_DR,'TX_DS='+d.TX_DS,'MAX_RT='+d.MAX_RT,'RX_P_NO='+d.RX_P_NO,'TX_FULL='+d.TX_FULL);
            nrf.getStates(['RX_ADDR_P0','RX_ADDR_P1','RX_ADDR_P2','RX_ADDR_P3','RX_ADDR_P4','RX_ADDR_P5','TX_ADDR'], function (e,d) {
                
                console.log("RX_ADDR_P0–1:\t",_h(d.RX_ADDR_P0),_h(d.RX_ADDR_P1));
                console.log("RX_ADDR_P2–5:\t",_h(d.RX_ADDR_P2),_h(d.RX_ADDR_P3),_h(d.RX_ADDR_P4),_h(d.RX_ADDR_P5));
                console.log("TX_ADDR:\t",_h(d.TX_ADDR));
                nrf.getStates(['RX_PW_P0','RX_PW_P1','RX_PW_P2','RX_PW_P3','RX_PW_P4','RX_PW_P5'], function (e,d) {
                    console.log("RX_PW_P0–5:\t",
                        _h(d.RX_PW_P0),_h(d.RX_PW_P1),_h(d.RX_PW_P2),
                        _h(d.RX_PW_P3),_h(d.RX_PW_P4),_h(d.RX_PW_P5)
                    );
                    nrf.getStates(['EN_AA','EN_RXADDR','RF_CH','RF_SETUP','CONFIG','DYNPD','FEATURE'], function (e,d) {
                        console.log("EN_AA:\t\t",_h(d.EN_AA));
                        console.log("EN_RXADDR:\t",_h(d.EN_RXADDR));
                        console.log("RF_CH:\t\t",_h(d.RF_CH));
                        console.log("RF_SETUP:\t",_h(d.RF_SETUP));
                        console.log("CONFIG:\t\t",_h(d.CONFIG));
                        console.log("DYNPD/FEATURE:\t",_h(d.DYNPD),_h(d.FEATURE));
                        nrf.getStates(['RF_DR_LOW','RF_DR_HIGH','EN_CRC','CRCO','RF_PWR'], function (e,d) {
                            var isPlus = false,
                                pwrs = ('compat') ? ["PA_MIN", "PA_LOW", "PA_HIGH", "PA_MAX"] : ["-18dBm","-12dBm","-6dBm","0dBm"];
                            function logFinalDetails() {
                                console.log("Data Rate:\t", (d.RF_DR_LOW) ? "250kbps" : ((d.RF_DR_HIGH) ? "2Mbps" : "1Mbps"));
                                console.log("Model:\t\t", (isPlus) ? "nRF24L01+" : "nRF24L01");
                                console.log("CRC Length:\t", (d.EN_CRC) ? ((d.CRCO) ? "16 bits" : "8 bits") : "Disabled");
                                console.log("PA Power:\t", pwrs[d.RF_PWR]);
                            }
                            if (d.RF_DR_LOW) {      // if set, we already know and don't need to check by toggling
                                isPlus = true;
                                logFinalDetails();
                            } else nrf.setStates({RF_DR_LOW:true}, function () {
                                nrf.getStates(['RF_DR_LOW'], function (e,d2) {
                                    // (non-plus chips hold this bit zero even after settting)
                                    if (d2.RF_DR_LOW) isPlus = true;
                                    // …then set back to original (false) value again
                                    nrf.setStates({RF_DR_LOW:false}, function () {
                                        logFinalDetails();
                                    });
                                });
                            });
                        });
                    });
                });
            });
        });
        function _h(n) { return (Buffer.isBuffer(n)) ? '0x'+n.toString('hex') : '0x'+n.toString(16); }  
    };
    
    return nrf;
}