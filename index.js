var stream = require('stream'),
    util = require('util'),
    SPI = require('pi-spi'),
    GPIO = require("./gpio");

var COMMANDS = require("./magicnums").COMMANDS,
    REGISTER_MAP = require("./magicnums").REGISTER_MAP;

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


exports.connect = function (spi,ce) {
    var nrf = {},
        spi = SPI.initialize(spi),
        ce = GPIO.connect(ce);
    
    ce.mode('low');
    
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
            if (iq.solo || iq.arr[0]==='RF_CH' || iq.arr[0].indexOf('RX_PW_P')===0) {
                var d = Buffer(1+iq.len),
                    val = vals[iq.solo || iq.arr[0]];
                d[0] = COMMANDS.W_REGISTER|reg;
                if (Buffer.isBuffer(val)) val.copy(d, 1);
                else d[1] = val;
                spi.write(d, cb);
            } else spi.transfer(Buffer([COMMANDS.R_REGISTER|reg]), /*1+iq.len*/2, function (e,d) {
                if (e) return cb(e);
                d[0] = COMMANDS.W_REGISTER|reg;     // we reuse read buffer for writing
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
    
    // expose:
    // - low level interface (getStates, setStates, etc.)
    // - mid level interface (channel, datarate, power, …)
    // - high level PRX (addrs)
    // - high level PTX (addr)
    
    function PTX(addr,opts) {
        stream.Duplex.call(this);
        this._addr = addr;
    }
    util.inherits(PTX, stream.Duplex);
    PTX.prototype._write = function (buff, _enc, cb) {
        // TODO: handle shared transmissions (via stack?)
        // TODO: don't set RX_ADDR_P0 if simplex/no-ack
        nrf.setStates({TX_ADDR:this._addr, RX_ADDR_P0:this._addr}, function (e) {
            if (e) return cb(e);
            
        });
    };
    PTX.prototype._read = function () { /* just gives okay to read, use this.push when packet received */ };
    
    nrf.createTransmitStream = function (addr, opts) {
        return new PTX(addr,opts);
    };
    
    //nrf.reserveReceiveStream = function ([pipe, ]addr) {};
    
    return nrf;
}