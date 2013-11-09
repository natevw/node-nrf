var NRF24 = require("./index");

var nrf24 = NRF24.connect("/dev/spidev0.0", 24);

nrf24.setStates({RF_CH:42,PWR_UP:true}, function (e) {
    if (e) console.error("Couldn't set states:",e);
    else nrf24.getStates(['EN_CRC','RX_ADDR_P0','RF_CH','PWR_UP','RX_P_NO'], function (e,d) {
        if (e) console.error("Couldn't get states:",e);
        console.log("Current results:",d);
    });
})