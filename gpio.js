var fs = require('fs'),
    events = require('events');

// see "Sysfs Interface for Userspace" in
// https://www.kernel.org/doc/Documentation/gpio.txt

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
    
    var gpio = new events.EventEmitter();
    
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
    
    // TODO: test if fs.watch actually works as Linux poll
    var watcher = null;
    gpio.on('newListener', updateListening);
    gpio.on('removeListener', updateListening);
    function updateListening() {
        var bl = gpio.listeners('both').length,
            rl = gpio.listeners('rise').length,
            fl = gpio.listeners('fall').length;
        if (bl || (rl && fl)) fs.writeFileSync(pinPath+"/edge", 'both');
        else if (rl) fs.writeFileSync(pinPath+"/edge", 'rising');
        else if (fl) fs.writeFileSync(pinPath+"/edge", 'falling');
        else fs.writeFileSync(pinPath+"/edge", 'none');
        
        if (bl || rl || fl) {
            if (!watcher) watcher = fs.watch(pinPath+"/value", {persistent:false}, function () {
                console.log("CHANGE", arguments, gpio.value());
            });
        } else if (watcher) {
            watcher.close();
            watcher = null;
        }
    }
    
    return gpio;
}
