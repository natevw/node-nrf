// see https://gist.github.com/natevw/5789019 for pins

var NRF24 = require("./index"),
    spiDev = "/dev/spidev0.0",
    cePin = 24, irqPin = 25,            //var ce = require("./gpio").connect(cePin)
    pipes = [0xF0F0F0F0E1, 0xF0F0F0F0D2],
    role = 'ping';

var stream = require('stream'),
    util = require('util');
function CountStream(ms) {
    stream.Readable.call(this);
    this._n = 0;
}
util.inherits(CountStream, stream.Readable);
CountStream.prototype._read = function () {
    console.log("Piping out", this._n);
    var b = new Buffer(4);
    b.writeUInt32BE(this._n++, 0);
    this.push(b);
};

var nrf = NRF24.connect(spiDev, cePin, irqPin);
//nrf._debug = true;
nrf.channel(0x4c).transmitPower('PA_MAX').dataRate('1Mbps').crcBytes(2).autoRetransmit({count:15, delay:4000}).begin(function () {
    if (role === 'ping') {
        console.log("PING out");
        var tx = nrf.openPipe('tx', pipes[0]),
            rx = nrf.openPipe('rx', pipes[1]);
        var count = 0;
        rx.on('data', function (d) {
            console.log("Got response back:", d.readUInt32BE(0));
        });
        tx.on('ready', function () {    // NOTE: hoping to get rid of need to wait for "ready"
            (new CountStream).pipe(tx);
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
