var NRF24 = require("./index"),
    spiDev = "/dev/spidev0.1",
    cePin = 24, irqPin = 25;

var nrf = NRF24.connect(spiDev, cePin, irqPin);
nrf.printDetails();
