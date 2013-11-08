var NRF24 = require("./index");

var nrf24 = NRF24.connect("/dev/spidev0.0", 24);
nrf24.getStates(function (e,d) {
    console.log(e,d);
});