// see https://gist.github.com/natevw/5789019 for pins

var NRF24 = require("./index"),
    spiDev = "/dev/spidev0.0",
    cePin = 24, irqPin = 25,            //var ce = require("./gpio").connect(cePin)
    pipes = [0xF0F0F0F0E1, 0xF0F0F0F0D2],
    role = 'ping';

var nrf = NRF24.connect(spiDev, cePin, irqPin);
nrf._debug = true;
nrf.channel(0x4c).transmitPower('PA_MAX').dataRate('1Mbps').crcBytes(2).autoRetransmit({count:15, delay:500}).begin(function () {
    if (role === 'ping') {
        var tx = nrf.openPipe('tx', pipes[0]),
            rx = nrf.openPipe('rx', pipes[1]);
        var count = 0;
        setInterval(function () {
            var read = rx.read(4);
            if (read) {
                console.log("Got response back:", read.readUint32BE(0));
            } else {
                console.warn("No response received.");
            }
            
            var send = new Buffer(4);
            send.writeUInt32BE(this._n++, 0);
            tx.write(send, function (e) {
                if (e) console.warn(e);
            });
        }, 1e3);
    } else {    // pong back
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
