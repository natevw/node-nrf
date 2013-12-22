var tessel = require('tessel'),
    NRF24 = require("./index"),
    nrf = NRF24.connect(tessel.port('a')),
    pipes = ['F0F0F0F0E1', 'F0F0F0F0D2'],
    role = 'listen';
//nrf._debug = true;
//nrf.printDetails();

nrf.channel(0x4c).transmitPower('PA_MAX').dataRate('1Mbps').crcBytes(2).autoRetransmit({count:15, delay:4000}).begin(function () {
    if (role === 'listen') {
        // HACK: listen for "ambient" broadcast i.e. https://github.com/natevw/greenhouse/blob/master/config.h#L5
        var rx = nrf.openPipe('rx', pipes[0], {autoAck:false});
        rx.on('data', function (d) {
            Array.prototype.reverse.call(d);     // WORKAROUND: https://github.com/natevw/node-nrf/issues/3
            console.log("******** Got data ********", d);
            
            if (d.slice(0,4).toString() === 'aqua') {
                //printf("Received broadcast: now=%u switchAugerCount=%u remoteAugerCount=%u waterTemp=%u humidity=%u airTemp=%u nc=%u\n", …)
                var info = {
                    now: d.readUInt32LE(1*4),
                    switchAugerCount: d.readUInt32LE(2*4),
                    remoteAugerCount: d.readUInt32LE(3*4),
                    waterTempC: waterTemp(d.readUInt32LE(4*4)),
                    humidity: d.readUInt32LE(5*4),
                    airTempC: airTemp(d.readUInt32LE(6*4)),
                    nc: powerStatus(d.readUInt32LE(7*4))
                };
                info.waterTempF = c2f(info.waterTempC);
                info.airTempF = c2f(info.airTempC);
                console.log(info);
                
                // pinched from https://github.com/natevw/rooflux/blob/greenhouse/display.html#L65
                function c2f(c) { return 1.8 * c + 32; }
                function waterTemp(b) {
                    var sign = (b & 0xf800) ? -1 : 1;
                    return sign * (b & ~0xf800) / (1 << 4);
                }
                function airTemp(b) {
                    return (b/1024*3.3-0.5)*100;
                }
                function powerStatus(b) {
                    if (b === 0) return "Normal";
                    else if (b > 1024) return "Bogus data…";
                    else if (b > 300) return "On battery!";
                    else return "Unknown: "+b;
                }
            }
        });
    } else if (role === 'ping') {
        console.log("PING out");
        var tx = nrf.openPipe('tx', pipes[0]),
            rx = nrf.openPipe('rx', pipes[1]);
        tx.on('ready', function () {    // NOTE: hoping to get rid of need to wait for "ready"
            // (new CountStream).pipe(tx);
            var n = 0;
            setInterval(function () {
                console.log("Sending", n);
                var b = new Buffer(4);
                b.writeUInt32BE(n++, 0);
                tx.write(b);
            }, 1e3);
        });
        rx.on('data', function (d) {
            console.log("Got response back:", d.readUInt32BE(0));
        });
    } else {
        console.log("PONG back");
        var rx = nrf.openPipe('rx', pipes[0]),
            tx = nrf.openPipe('tx', pipes[1]);
        rx.on('data', function (d) {
            console.log("Got data, will respond", d.readUInt32BE(0));
            tx.write(d);
        });
        tx.on('error', function (e) {
            console.warn("Error sending reply.", e);
        });
    }
});