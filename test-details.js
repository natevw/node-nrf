var NRF24 = require("./index"),
    spiDev = process.argv[2] || "/dev/spidev0.0",
    cePin = +process.argv[3] || 24,
    irqPin = +process.argv[4] || 25;

var nrf = (irqPin > 0) ?
    NRF24.connect(spiDev, cePin, irqPin) :
    NRF24.connect(spiDev, cePin);
nrf.printDetails();