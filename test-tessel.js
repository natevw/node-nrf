var tessel = require('tessel'),
    NRF24 = require("./index"),
    nrf = NRF24.connect(tessel, tessel.port('a'));
//nrf._debug = true;
nrf.printDetails();
