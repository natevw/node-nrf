// see https://gist.github.com/natevw/5789019 for pins

var pipes = [0xF1F0F0F0E1, 0xF1F0F0F0D2];
var radios = [
    {spiDev:"/dev/spidev0.0", cePin:24, irqPin:25},
    {spiDev:"/dev/spidev0.1", cePin:23}
];


var NRF24 = require("./index"),
    queue = require('queue-async');

var q = queue();
radios.forEach(function (radio) {
    radio._interface = (radio.irqPin) ?
        NRF24.connect(radio.spiDev, radio.cePin, radio.irqPin) :
        NRF24.connect(radio.spiDev, radio.cePin);
    q.defer(setupRadio, radio._interface);
});
function setupRadio(radio, cb) {
    radio.channel(0x4c).dataRate('1Mbps').crcBytes(2);
    radio.transmitPower('PA_MAX').autoRetransmit({count:15, delay:4000});
    radio.begin(function (e) { cb(e, radio); });
}
q.awaitAll(function (e,d) {
    if (e) throw e;
    
    d[0]._debug = true;
    
    var tx = d[1].openPipe('tx', pipes[0]),
        rx = d[0].openPipe('rx', pipes[0]),
        rx2 = d[0].openPipe('rx', pipes[1]);
    
    tx.on('ready', function () {
        tx.write("NARF!");
        tx.write("Hello?");
        tx.write("blah blah blah");
        tx.write("the number 4");
        setInterval(tx.write.bind(tx, "beep"), 2e3);
        //setInterval(tx.write.bind(tx, "boop"), 2e3);
    });
    rx.on('data', function (d) {
        console.log("Got data:", d.toString());
    });
    
    // RX - no ack
    // TX - no ack
    
    // RX - ack payloads
    // TX - ack payloads
});