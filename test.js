var NRF24 = require("./index"),
    spiDev = "/dev/spidev0.0",
    cePin = 24;

var nrf24 = NRF24.connect(spiDev, cePin);

/*
nrf24.setStates({RF_CH:42,PWR_UP:true}, function (e) {
    if (e) console.error("Couldn't set states:",e);
    else nrf24.getStates(['EN_CRC','RX_ADDR_P0','RF_CH','PWR_UP','RX_P_NO'], function (e,d) {
        if (e) console.error("Couldn't get states:",e);
        console.log("Current results:",d);
    });
});
*/

// mimic e.g. https://github.com/stanleyseow/RF24/blob/master/librf24-rpi/librf24/RF24.cpp#L318
function printDetails() {
    console.log("SPI device:\t",spiDev);
    console.log("SPI speed:\t",'?');
    console.log("CE GPIO:\t",cePin);
    
    function _h(n) { return (Buffer.isBuffer(n)) ? n.toString('hex') : n.toString(16); }
    
    nrf24.getStates(['RX_ADDR_P0','RX_ADDR_P1','RX_ADDR_P2','RX_ADDR_P3','RX_ADDR_P4','RX_ADDR_P5','TX_ADDR'], function (e,d) {
        if (e) console.error("Error communicating with transceiver:",e);
        
        console.log("RX_ADDR_P0:\t",_h(d.RX_ADDR_P0));
        console.log("RX_ADDR_P1:\t",_h(d.RX_ADDR_P1));
        console.log("RX_ADDR_P2–5:\t",_h(d.RX_ADDR_P2),_h(d.RX_ADDR_P3),_h(d.RX_ADDR_P4),_h(d.RX_ADDR_P5));
        console.log("TX_ADDR:\t",_h(d.TX_ADDR));
    });
}
printDetails();

