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
            console.log("******** Got data ********", d);
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