var fs = require('fs');


/*
var pin1 = require("./gpio").connect(17),
    pin2 = require("./gpio").connect(22);
pin2.mode('in');
pin1.mode('high'); pin2.value();
pin1.mode('low'); pin2.value();
*/

exports.connect = function (pin) {        // TODO: sync up compat, split out
    pin = +pin;
    
    var fd,     // faster value access
        pinPath = "/sys/class/gpio/gpio"+pin;
    try {
        fd = fs.openSync(pinPath+"/value",'r+');
    } catch (e) {
        if (e.code === 'ENOENT') {
            // pin hasn't been exported, request and open again
            fs.writeFileSync("/sys/class/gpio/export", ''+pin);
            fd = fs.openSync(pinPath+"/value",'r+');
        } else throw e;
    }
    
    var gpio = {};
    
    gpio.mode = function (mode) {       // 'in','out','low','high'
        fs.writeFileSync(pinPath+"/direction", mode);
    };
    
    // TODO: error handling?
    gpio.value = function (val) {
        var v = Buffer(1);
        if (!arguments.length) {
            fs.readSync(fd, v,0,1, 0);
            return (v[0] === '1'.charCodeAt(0)) ? true : false;
        } else {
            v[0] = (val) ? '1'.charCodeAt(0) : '0'.charCodeAt(0);
            fs.writeSync(fd, v,0,1, 0);
        }
    }
    
    // TODO: IRQ (does fs.watch actually work as Linux poll?)
    /*
    var watching = false;
    gpio.on = function (evt, cb) {      // 'rising','falling','both'
        // TODO: maintain own listeners state and trigger on both?
        if (watching) throw Error("Can only watch once at present, sorry.");
        fs.writeFileSync(pinPath+"/direction", evt);
        fs.watch(pinPath+"/value", {persistent:false}, cb);
    };
    */
    
    return gpio;
}
