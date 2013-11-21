var fs = require('fs'),
    events = require('events'),
    Epoll = require('epoll').Epoll;

// c.f. https://github.com/fivdi/onoff

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
    
    var watcher = new Epoll(function () {
        var v = gpio.value();
        gpio.emit((v) ? 'rise' : 'fall', v);
        gpio.emit('both', v);
    }), watching = false;
    gpio.on('newListener', updateListening.bind(null, '+'));
    gpio.on('removeListener', updateListening.bind(null, '-'));
    function updateListening(which, name, fn) {
        var l = {};
        ['both', 'rise', 'fall'].forEach(function (k) {
            var arr = gpio.listeners(k);
            l[k[0]] = arr.length;
            if (k === name) {           // need this because node.js doesn't specify up-to-date lists
                var present = ~arr.indexOf(fn);
                if (!present && '+') l[k[0]] += 1;
                else if (present && '-') l[k[0]] -= 1;
            }
        });
        
        if (l.b || (l.r && l.f)) fs.writeFileSync(pinPath+"/edge", 'both');
        else if (l.r) fs.writeFileSync(pinPath+"/edge", 'rising');
        else if (l.f) fs.writeFileSync(pinPath+"/edge", 'falling');
        else fs.writeFileSync(pinPath+"/edge", 'none');
        
        if (l.b || l.r || l.f) {
            if (!watching) {
                watcher.add(fd, Epoll.EPOLLPRI);
                watching = true;
            }
        } else if (watching) {
            watcher.remove(fd);
            watching = false;
        }
    }
    
    return gpio;
}
