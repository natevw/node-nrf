// see https://gist.github.com/natevw/5789019 for pins

//var pipes = [0xF0F0F0F0E1, 0xF0F0F0F0D2];
var radios = [
    {spiDev:"/dev/spidev0.0", cePin:24, irqPin:25},
    {spiDev:"/dev/spidev0.0", cePin:23}
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
    radio.begin(cb);
}
q.awaitAll(function (e,d) {
    if (e) throw e;
    
    // RX - no ack
    // TX - no ack
    
    // RX - ack payloads
    // TX - ack payloads
    
    
    console.log("It begins.", d);
});