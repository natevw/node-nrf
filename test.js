// see https://gist.github.com/natevw/5789019 for pins

var NRF24 = require("./index"),
    spiDev = "/dev/spidev0.0",
    cePin = 24, irqPin = 25;

var nrf = NRF24.connect(spiDev, cePin, irqPin);

/*
nrf.setStates({RF_CH:42,PWR_UP:true}, function (e) {
    if (e) console.error("Couldn't set states:",e);
    else nrf.getStates(['EN_CRC','RX_ADDR_P0','RF_CH','PWR_UP','RX_P_NO'], function (e,d) {
        if (e) console.error("Couldn't get states:",e);
        console.log("Current results:",d);
    });
});
*/


nrf.printDetails();


var pipes = [0xF0F0F0F0E1, 0xF0F0F0F0D2];


var stream = require('stream'),
    util = require('util');

function TimeStream(ms) {
    stream.Readable.call(this);
}
util.inherits(TimeStream, stream.Readable);
TimeStream.prototype._read = function () {
console.log("pushing time");
    this.push(new Date().toISOString());
};

nrf.channel(0x4c, function () {}).mode('tx', function () {
    var tx = nrf.openPipe(pipes[0]);
    (new TimeStream).pipe(tx);
});



