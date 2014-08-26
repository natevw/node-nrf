var q = require('queue-async'),
    fifo = require('fifolock'),
    stream = require('stream'),
    util = require('util'),
    events = require('events'),
    SPI = require('pi-spi'),
    GPIO = require('pi-pins'),
    _m = require("./magicnums");

var mutex = fifo();   // HACK: avoid https://github.com/natevw/node-nrf/commit/8d80dabde1026e949f4eb4ea6d25624cbf3c70ec
function forEachWithCB(fn, cb) { cb = mutex.TRANSACTION_WRAPPER(cb, function () {
    var process = q(1);
    this.forEach(function (d) { process.defer(fn, d); });
    process.awaitAll(cb);
}.bind(this)); }

function _extend(obj) {
    for (var i = 1, len = arguments.length; i < len; i++) {
        var nxt = arguments[i];
        Object.keys(nxt).forEach(function (k) { obj[k] = nxt[k]; });
    }
    return obj;
}

function _nop() {}          // used when a cb is not provided


exports.connect = function (spi,ce,irq) {
    var _spi = spi, _ce = ce, _irq = irq;       // only for printDetails!
    var nrf = new events.EventEmitter(),
        spi = SPI.initialize(spi),
        ce = GPIO.connect(ce),
        irq = (arguments.length > 2) && GPIO.connect(irq);
    
    nrf._T = _extend({}, _m.TIMING, {pd2stby:4500});        // may need local override of pd2stby
    
    nrf.blockMicroseconds = function (us) {
        // NOTE: setImmediate/process.nextTick too slow (especially on Pi) so we just spinloop for µs
        var start = process.hrtime();
        while (1) {
            var diff = process.hrtime(start);
            if (diff[0] * 1e9 + diff[1] >= us*1e3) break;
        }
        if (nrf._debug) console.log("blocked for "+us+"µs.");
    };
    
    nrf.execCommand = function (cmd, data, cb) {        // (can omit data, or specify readLen instead)
        if (typeof data === 'function' || typeof data === 'undefined') {
            cb = data || _nop;
            data = 0;
        }
        if (nrf._debug) console.log('execCommand', cmd, data);
        
        var cmdByte;
        if (typeof cmd === 'string') {
            cmdByte = _m.COMMANDS[cmd];
        } else if (Array.isArray(cmd)) {
            cmdByte = _m.COMMANDS[cmd[0]] | cmd[1];
        } else cmdByte = cmd;
        
        var writeBuf,
            readLen = 0;
        if (Buffer.isBuffer(data)) {
            writeBuf = Buffer(data.length+1);
            writeBuf[0] = cmdByte;
            Array.prototype.reverse.call(data);     // data is LSByte to MSByte, see p.50
            data.copy(writeBuf,1);
            Array.prototype.reverse.call(data);     // leave data how caller had.
        } else if (Array.isArray(data)) {
            data.reverse();
            writeBuf = Buffer([cmdByte].concat(data));
            data.reverse();
        } else {
            writeBuf = Buffer([cmdByte]);
            readLen = data;
        }
        
        spi.transfer(writeBuf, readLen && readLen+1, function (e,d) {
            if (nrf._debug && readLen) console.log(' - exec read:', d);
            if (e) return cb(e);
            else return cb(null, d && Array.prototype.reverse.call(d.slice(1)));
        });
    };   
    
    function registersForMnemonics(list) {
        var registersNeeded = Object.create(null);
        list.forEach(function (mnem) {
            var _r = _m.REGISTER_MAP[mnem];
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
        var _r = _m.REGISTER_MAP[mnem],
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
            // TODO: we could probably also eliminate re-fetch of 0x07 during IRQ processing
            var iq = registersNeeded[reg];
            reg = +reg;
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
            if (nrf._debug) console.log('gotStates', states, e);
            cb(e,states);
        });
    };
    
    var _statusReg = _m.REGISTER_MAP['STATUS'][0];
    nrf.setStates = function (vals, cb) {
        if (nrf._debug) console.log('setStates', vals);
        if (!cb) cb = _nop;
        var registersNeeded = registersForMnemonics(Object.keys(vals));
        function processInquiryForRegister(reg, cb) {
            var iq = registersNeeded[reg];
            reg = +reg;     // was string key, now convert back to number
            // if a register is "full" we can simply overwrite, otherwise we must read+merge
            // NOTE: high bits in RF_CH/PX_PW_Pn are *reserved*, i.e. technically need merging
            if (!iq.arr.length || iq.arr[0]==='RF_CH' || iq.arr[0].indexOf('RX_PW_P')===0) {
                var val = vals[iq.solo || iq.arr[0]],
                    buf = (Buffer.isBuffer(val)) ? val : [val];
                nrf.execCommand(['W_REGISTER', reg], buf, cb);
            } else nrf.execCommand(['R_REGISTER', reg], 1, function (e,d) {
                if (e) return cb(e);
                var val = d[0],
                    settlingNeeded = 0;
                if (iq.solo) val = vals[iq.solo];  // TODO: refactor so as not to fetch in the first place!
                iq.arr.forEach(function (mnem) {
                    var m = maskForMnemonic(mnem);
                    if (mnem === 'PWR_UP') {
                        var rising = !(d[0] & m.mask) && vals[mnem];
                        if (rising) settlingNeeded = Math.max(settlingNeeded, nrf._T.pd2stby);
                    } else if (mnem === 'PRIM_RX') {    
                        var changing = !(d[0] & m.mask) !== !vals[mnem];
                        if (changing) settlingNeeded = Math.max(settlingNeeded, nrf._T.stby2a);
                    }
                    val &= ~m.mask;        // clear current value
                    val |= (vals[mnem] << m.rightmostBit) & m.mask;
                });
                if (val !== d[0] || reg === _statusReg) nrf.execCommand(['W_REGISTER', reg], [val], function () {
                    if (settlingNeeded) nrf.blockMicroseconds(settlingNeeded);  // see p.24
                    cb.apply(this, arguments);
                });
                else cb(null);  // don't bother writing if value hasn't changed (unless status, which clears bits)
            });
        }
        forEachWithCB.call(Object.keys(registersNeeded), processInquiryForRegister, cb);
    };
    
    nrf.setCE = function (state, block) {
        if (typeof state === 'string') ce.mode(state);
        else ce.value(state);
        if (nrf._debug) console.log("Set CE "+state+".");
        if (block) nrf.blockMicroseconds(nrf._T[block]);       // (assume ce changed TX/RX mode)
    };
    nrf.pulseCE = function (block) {
        nrf.setCE(true,'hce');
        nrf.setCE(false,block);
    };
    
    // ✓ low level interface (execCommand, getStates, setStates, pulseCE, 'interrupt')
    // ✓ mid level interface (channel, dataRate, power, crcBytes, autoRetransmit{count,delay})
    // ✓ high level PRX (addrs)
    // ✓ high level PTX (addr)
    // - test!
    // - document
    
    
    nrf.powerUp = function (val, cb) {
        if (typeof val === 'function' || typeof val === 'undefined') {
            cb = val || _nop;
            nrf.getStates(['PWR_UP'], function (e,d) { cb(e, d && !!d.PWR_UP); });
        } else nrf.setStates({PWR_UP:val}, cb);
        return this;
    };
    
    nrf.channel = function (val, cb) {
        if (typeof val === 'function' || typeof val === 'undefined') {
            cb = val || _nop;
            nrf.getStates(['RF_CH'], function (e,d) { cb(e, d && d.RF_CH); });
        } else nrf.setStates({RF_CH:val}, cb);
        return this;
    };
    
    nrf.dataRate = function (val, cb) {
        if (typeof val === 'function' || typeof val === 'undefined') {
            cb = val || _nop;
            nrf.getStates(['RF_DR_LOW', 'RF_DR_HIGH'], function (e,d) {
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
    
    nrf.transmitPower = function (val, cb) {
        if (typeof val === 'function' || typeof val === 'undefined') {
            cb = val || _nop;
            nrf.getStates(['RF_PWR'], function (e,d) { cb(e, d && _m.TX_POWER[d.RF_PWR]); });
        } else {
            val = _m.TX_POWER.indexOf(val);
            if (val === -1) throw Error("Radio power must be 'PA_MIN', 'PA_LOW', 'PA_HIGH' or 'PA_MAX'.");
            nrf.setStates({RF_PWR:val}, cb);
        }
        return this;
    };
    
    nrf.crcBytes = function (val, cb) {
        if (typeof val === 'function' || typeof val === 'undefined') {
            cb = val || _nop;
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
    
    nrf.addressWidth = function (val, cb) {
        if (typeof val === 'function' || typeof val === 'undefined') {
            cb = val || _nop;
            nrf.getStates(['AW'], function (e,d) { cb(e, d && d.AW+2); });
        } else nrf.setStates({AW:val-2}, cb);
        return this;
    };
    
    nrf.autoRetransmit = function (val, cb) {
        if (typeof val === 'function' || typeof val === 'undefined') {
            cb = val || _nop;
            nrf.getStates(['ARD, ARC'], function (e,d) { cb(e, d && {count:d.ARC,delay:250*(1+d.ARD)}); });
        } else {
            var states = {};
            if ('count' in val) states['ARC'] = val.count;
            if ('delay' in val) states['ARD'] = val.delay/250 - 1;
            nrf.setStates(states, cb);
        }
        return this;
    };
    
    // caller must know pipe and provide its params!
    nrf.readPayload = function (opts, cb) {
        if (!cb) cb = _nop;
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
            else nrf.setStates({RX_DR:true,TX_DS:false,MAX_RT:false}, function (e2) {    
                cb(e||e2,d);
            });
        }
    };
    
    // caller must set up any prerequisites (i.e. TX addr) and ensure no other send is pending
    nrf.sendPayload = function (data, opts, cb) {
        if (!cb) cb = _nop;
        if (data.length > 32) throw Error("Maximum packet size exceeded. Smaller writes, Dash!");
        nrf._prevSender = null;     // help PxX setup again if user sends data directly
        
        var cmd;
        if ('asAckTo' in opts) {
            cmd = ['W_ACK_PAYLOAD',opts.asAckTo];
        } else if (opts.ack) {
            cmd = 'W_TX_PAYLOAD';
        } else {
            cmd = 'W_TX_PD_NOACK';
        }
        nrf.execCommand(cmd, data, function (e) {
            if (e) return cb(e);
            if (!opts.ceHigh) nrf.pulseCE('pece2csn');
            // TODO: if _sendOpts.asAckTo we won't get MAX_RT interrupt — how to prevent a blocked TX FIFO? (see p.33)
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
        if (typeof states === 'function' || typeof states === 'undefined') {
            cb = states || _nop;
            states = _m.REGISTER_DEFAULTS;
        }
        nrf.setCE('low','stby2a');
        q(1)
            .defer(nrf.execCommand, 'FLUSH_TX')
            .defer(nrf.execCommand, 'FLUSH_RX')
            .defer(nrf.setStates, states)
        .await(cb);
    };
    
    var checking = false;
    nrf._checkStatus = function (irq) {
        if (nrf._debug) console.log("_checkStatus, irq =", irq, "checking =", checking);
        if (checking && !irq) return;       // avoid simultaneous checks unless latest triggered by real IRQ
        else checking = true;
        nrf.getStates(['RX_P_NO','TX_DS','MAX_RT','RX_DR'], function (e,d) {
            checking = false;
            if (e) nrf.emit('error', e);
            else if (d.RX_DR && d.RX_P_NO === 0x07) setTimeout(function () {
                // HACK: chip seems to assert RX_DR a while before setting RX_P_NO, so poll if necessary
                // TODO: this may actually just happen until we reset RX_DR (maybe FLUSH_RX or similar unsyncs?)
                // see also note on top of datasheet p.52 about status register updated *during* IRQ transmission
                if (nrf._debug) console.warn("- weird status, checking again -");
                nrf._checkStatus(false);
            }, 0);
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
            irqListener = setInterval(function () {       // TODO: clear interval when there are no listeners?
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
    
    var ready = false,
        txQ = [],
        txPipes = [],
        rxPipes = []
        rxP0 = null;
    nrf.begin = function (cb) {
        nrf.setCE('low','stby2a');
        var clearIRQ = {RX_DR:true, TX_DS:true, MAX_RT:true},
            features = {EN_DPL:true, EN_ACK_PAY:true, EN_DYN_ACK:true};
        nrf.reset(_extend({PWR_UP:true, PRIM_RX:false, EN_RXADDR:0x00},clearIRQ,features), function (e) {
            if (e) return nrf.emit('error', e);
            nrf._irqOn();           // NOTE: on before any pipes to facilite lower-level sendPayload use
            ready = true;
            nrf.emit('ready');
        });
        if (cb) nrf.once('ready', cb);
    };
    nrf.end = function (cb) {
        var pipes = txPipes.concat(rxPipes);
        pipes.forEach(function (pipe) { pipe.close(); });
        txPipes.length = rxPipes.length = txQ.length = 0;
        ready = false;
        nrf._irqOff();
        nrf.setCE(false,'stby2a');
        nrf.setStates({PWR_UP:false}, function (e) {
            if (e) nrf.emit('error', e);
            else if (cb) cb();
        });
    };
    function slotForAddr(addr) {
        var slot = Array(6), aw = Math.max(3,Math.min(addr.length, 5));
        rxPipes.forEach(function (pipe) { slot[pipe._pipe] = pipe._addr; });
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
    nrf.openPipe = function (rx_tx, addr, opts) {
        if (!ready) throw Error("Radio .begin() must be finished before a pipe can be opened.");
        if (typeof addr === 'number') addr = Buffer(addr.toString(16), 'hex');
        opts || (opts = {});
        
        var pipe;
        if (rx_tx === 'rx') {
            var s = slotForAddr(addr);
            pipe = new PRX(s, addr, opts);
            rxPipes.push(pipe);
        } else if (rx_tx === 'tx') {
            pipe = new PTX(addr, opts);
            txPipes.push(pipe);
        } else {
            throw Error("Unknown pipe mode '"+rx_tx+"', must be 'rx' or 'tx'.");
        }
        return pipe;
    };
    nrf._nudgeTX = function () {
        if (txQ.active || !txQ.length) return;
        var d = txQ.shift(); 
        txQ.active = true;
        d.pipe._tx(d.data, function () {
            try {
                d.cb.apply(this, arguments);
            } finally {
                delete txQ.active;
                nrf._nudgeTX();
            }
        });
    };
    
    function PxX(pipe, addr, opts) {           // base for PTX/PRX
        stream.Duplex.call(this,{highWaterMark:64});
        this.opts = opts;
        this._pipe = pipe;
        this._addr = addr;
        this._size = opts.size;
        this._wantsRead = false;
        this._sendOpts = {};
        
        var s = {},
            n = pipe;           // TODO: what if ack'ed TX already in progress and n=0?
        if (addr.length > 1) s['AW'] = addr.length - 2;
        if (opts._primRX) {
            s['PRIM_RX'] = true;
            if (pipe === 0) rxP0 = this;
            if (opts.autoAck) nrf._prevSender = null;         // make sure TX doesn't skip setup
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
        nrf.setStates(s, function (e) {
            if (opts._primRX) nrf.setCE(true,'stby2a');
            if (e) this.emit('error', e);
            else this.emit('ready');        // TODO: eliminate need to wait for this (setup on first _rx/_tx?)
        }.bind(this));
        
        var irqHandler = this._rx.bind(this);
        nrf.addListener('interrupt', irqHandler);
        this.once('close', function () {
            nrf.removeListener('interrupt', irqHandler);
        });
    }
    util.inherits(PxX, stream.Duplex);
    PxX.prototype._write = function (buff, _enc, cb) {
        txQ.push({pipe:this,data:buff,cb:cb});
        nrf._nudgeTX();
    };
    PxX.prototype._tx = function (data, cb) {      // see p.75
        var s = {};
        if (this._sendOpts.asAckTo) {
            // no config is needed
        } else if (nrf._prevSender === this) {
            if (rxPipes.length) {
                nrf.setCE('low');       // this or PWR_UP:0 are the only ways out of RX mode acc to p.22
                s['PRIM_RX'] = false;
            }
        } else {
            s['TX_ADDR'] = this._addr;
            if (rxPipes.length) {
                nrf.setCE('low');
                s['PRIM_RX'] = false;
            }
            if (this._sendOpts.ack) {
                if (rxP0) rxP0._pipe = -1;          // HACK: avoid the pipe-0 PRX from reading our ack payload
                s['RX_ADDR_P0'] = this._addr;
                if ('retryCount' in this.opts) s['ARC'] = this.opts.retryCount;
                if ('retryDelay' in this.opts) s['ARD'] = this.opts.retryDelay/250 - 1;
                // TODO: shouldn't this be overrideable regardless of _sendOpts.ack??
                if ('txPower' in this.opts) s['RF_PWR'] = _m.TX_POWER.indexOf(this.opts.txPower);
            }
        }
        nrf.setStates(s, function (e) {     // (± fine to call with no keys)
            if (e) return cb(e);
            var sendOpts = _extend({},this._sendOpts);
            //if (rxPipes.length) sendOpts.ceHigh = true;        // PRX will already have CE high
            nrf.sendPayload(data, sendOpts, function (e) {
                if (e) return cb(e);
                var s = {};                 // NOTE: if another TX is waiting, switching to RX is a waste…
                if (rxPipes.length && !this._sendOpts.asAckTo) {
                    nrf.setCE('high');
                    s['PRIM_RX'] = true;
                }
                if (this._sendOpts.ack && rxP0) {
                    s['RX_ADDR_P0'] = rxP0._addr;
                    rxP0._pipe = 0;
                }
                nrf.setStates(s, cb);
            }.bind(this));
            if (!rxPipes.length) nrf._prevSender = this;    // we might avoid setting state next time
        }.bind(this));
    };
    PxX.prototype._rx = function (d) {
        if (d.RX_P_NO !== this._pipe) return;
        if (!this._wantsRead) return;           // NOTE: this could starve other RX pipes!
        
        nrf.readPayload({width:this._size}, function (e,d) {
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
        if (rxP0 === this) rxP0 = null;
        // TODO: also update CE and RX_EN registers accordingly
        this.push(null);
        this.emit('close');
    };
    
    function PTX(addr,opts) {
        opts = _extend({size:'auto',autoAck:true,ackPayloads:false}, opts);
        opts._enableRX = (opts.autoAck || opts.ackPayloads);
        PxX.call(this, 0, addr, opts);
        _extend(this._sendOpts, {ack:opts._enableRX});
    }
    util.inherits(PTX, PxX);
    
    function PRX(pipe, addr, opts) {
        opts = _extend({size:'auto',autoAck:true}, opts);
        opts._primRX = opts._enableRX = true;
        PxX.call(this, pipe, addr, opts);
        _extend(this._sendOpts, {ack:false, asAckTo:pipe});
    }
    util.inherits(PRX, PxX);
    
    
    nrf.printStatus = function () {         // for debugging
        nrf.getStates(['RX_DR','TX_DS','MAX_RT','RX_P_NO','TX_FULL'], function (e,d) {
            if (e) throw e;
            else console.log(irq.value() ? 'no-irq' : '-IRQ-', d);
        });
    };
    
    nrf.printDetails = function (cb) {        // for debugging, mimic e.g. https://github.com/stanleyseow/RF24/blob/master/librf24-rpi/librf24/RF24.cpp#L318
        if (!cb) cb = _nop;
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
                                pwrs = ('compat') ? _m.TX_POWER : ["-18dBm","-12dBm","-6dBm","0dBm"];
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
                            function logFinalDetails() {
                                console.log("Data Rate:\t", (d.RF_DR_LOW) ? "250kbps" : ((d.RF_DR_HIGH) ? "2Mbps" : "1Mbps"));
                                console.log("Model:\t\t", (isPlus) ? "nRF24L01+" : "nRF24L01");
                                console.log("CRC Length:\t", (d.EN_CRC) ? ((d.CRCO) ? "16 bits" : "8 bits") : "Disabled");
                                console.log("PA Power:\t", pwrs[d.RF_PWR]);
                                cb();
                            }
                        });
                    });
                });
            });
        });
        function _h(n) { return (Buffer.isBuffer(n)) ? '0x'+n.toString('hex') : '0x'+n.toString(16); }  
    };
    
    nrf.on('interrupt', function (d) { if (nrf._debug) console.log("IRQ.", d); });
    
    return nrf;
}