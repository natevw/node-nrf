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
    nrf24.getStates(['STATUS','RX_DR','TX_DS','MAX_RT','RX_P_NO','TX_FULL'], function (e,d) {
        if (e) throw e;
        console.log("STATUS:\t\t",_h(d.STATUS[0]),'RX_DR='+d.RX_DR,'TX_DS='+d.TX_DS,'MAX_RT='+d.MAX_RT,'RX_P_NO='+d.RX_P_NO,'TX_FULL='+d.TX_FULL);
        nrf24.getStates(['RX_ADDR_P0','RX_ADDR_P1','RX_ADDR_P2','RX_ADDR_P3','RX_ADDR_P4','RX_ADDR_P5','TX_ADDR'], function (e,d) {
            
            console.log("RX_ADDR_P0–1:\t",_h(d.RX_ADDR_P0),_h(d.RX_ADDR_P1));
            console.log("RX_ADDR_P2–5:\t",_h(d.RX_ADDR_P2),_h(d.RX_ADDR_P3),_h(d.RX_ADDR_P4),_h(d.RX_ADDR_P5));
            console.log("TX_ADDR:\t",_h(d.TX_ADDR));
            nrf24.getStates(['RX_PW_P0','RX_PW_P1','RX_PW_P2','RX_PW_P3','RX_PW_P4','RX_PW_P5'], function (e,d) {
                console.log("RX_PW_P0–5:\t",
                    _h(d.RX_PW_P0),_h(d.RX_PW_P1),_h(d.RX_PW_P2),
                    _h(d.RX_PW_P3),_h(d.RX_PW_P4),_h(d.RX_PW_P5)
                );
                nrf24.getStates(['EN_AA','EN_RXADDR','RF_CH','RF_SETUP','CONFIG','DYNPD','FEATURE'], function (e,d) {
                    console.log("EN_AA:\t\t",_h(d.EN_AA));
                    console.log("EN_RXADDR:\t",_h(d.EN_RXADDR));
                    console.log("RF_CH:\t\t",_h(d.RF_CH));
                    console.log("RF_SETUP:\t",_h(d.RF_SETUP));
                    console.log("CONFIG:\t\t",_h(d.CONFIG));
                    console.log("DYNPD/FEATURE:\t",_h(d.DYNPD),_h(d.FEATURE));
                    nrf24.getStates(['RF_DR_LOW','RF_DR_HIGH','EN_CRC','CRCO','RF_PWR'], function (e,d) {
                        var isPlus = false,
                            pwrs = ('compat') ? ["PA_MIN", "PA_LOW", "PA_HIGH", "PA_MAX"] : ["-18dBm","-12dBm","-6dBm","0dBm"];
                        function logFinalDetails() {
                            console.log("Data Rate:\t", (d.RF_DR_LOW) ? "250kbps" : ((d.RF_DR_HIGH) ? "2Mbps" : "1Mbps"));
                            console.log("Model:\t\t", (isPlus) ? "nRF24L01+" : "nRF24L01");
                            console.log("CRC Length:\t", (d.EN_CRC) ? ((d.CRCO) ? "16 bits" : "8 bits") : "Disabled");
                            console.log("PA Power:\t", pwrs[d.RF_PWR]);
                        }
                        if (d.RF_DR_LOW) {      // if set, we already know and don't need to check by toggling
                            isPlus = true;
                            logFinalDetails();
                        } else nrf24.setStates({RF_DR_LOW:true}, function () {
                            nrf24.getStates(['RF_DR_LOW'], function (e,d2) {
                                // (non-plus chips hold this bit zero even after settting)
                                if (d2.RF_DR_LOW) isPlus = true;
                                // …then set back to original (false) value again
                                nrf24.setStates({RF_DR_LOW:false}, function () {
                                    logFinalDetails();
                                });
                            });
                        });
                    });
                });
            });
        });
    });
    function _h(n) { return (Buffer.isBuffer(n)) ? '0x'+n.toString('hex') : '0x'+n.toString(16); }  
}
printDetails();

