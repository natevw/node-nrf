// these are intended for mixing in to a `Transceiver` instance, mostly for debugging

var _m = require("./magicnums"),
    COMPAT = true;     // stick with RF24::printDetails formatting rather than more readable

function _h(n) {
  return (Buffer.isBuffer(n)) ? '0x'+n.toString('hex') : '0x'+n.toString(16);
}

// mimic e.g. https://github.com/stanleyseow/RF24/blob/master/librf24-rpi/librf24/RF24.cpp#L318
exports.printDetails = function (cb, _n) { cb = this._SERIAL_(cb, function () {
  var self = this;
  console.log(self._printableHardware);
  self.getStates(['STATUS','RX_DR','TX_DS','MAX_RT','RX_P_NO','TX_FULL'], function (e,d) {
    if (e) throw e;
    console.log("STATUS:\t\t",_h(d.STATUS[0]),'RX_DR='+d.RX_DR,'TX_DS='+d.TX_DS,'MAX_RT='+d.MAX_RT,'RX_P_NO='+d.RX_P_NO,'TX_FULL='+d.TX_FULL);
    self.getStates(['RX_ADDR_P0','RX_ADDR_P1','RX_ADDR_P2','RX_ADDR_P3','RX_ADDR_P4','RX_ADDR_P5','TX_ADDR'], function (e,d) {
      console.log("RX_ADDR_P0–1:\t",_h(d.RX_ADDR_P0),_h(d.RX_ADDR_P1));
      console.log("RX_ADDR_P2–5:\t",_h(d.RX_ADDR_P2),_h(d.RX_ADDR_P3),_h(d.RX_ADDR_P4),_h(d.RX_ADDR_P5));
      console.log("TX_ADDR:\t",_h(d.TX_ADDR));
      self.getStates(['RX_PW_P0','RX_PW_P1','RX_PW_P2','RX_PW_P3','RX_PW_P4','RX_PW_P5'], function (e,d) {
        console.log("RX_PW_P0–5:\t",
          _h(d.RX_PW_P0),_h(d.RX_PW_P1),_h(d.RX_PW_P2),
          _h(d.RX_PW_P3),_h(d.RX_PW_P4),_h(d.RX_PW_P5)
        );
        self.getStates(['EN_AA','EN_RXADDR','RF_CH','RF_SETUP','CONFIG','DYNPD','FEATURE'], function (e,d) {
          console.log("EN_AA:\t\t",_h(d.EN_AA));
          console.log("EN_RXADDR:\t",_h(d.EN_RXADDR));
          console.log("RF_CH:\t\t",_h(d.RF_CH));
          console.log("RF_SETUP:\t",_h(d.RF_SETUP));
          console.log("CONFIG:\t\t",_h(d.CONFIG));
          console.log("DYNPD/FEATURE:\t",_h(d.DYNPD),_h(d.FEATURE));
          self.getStates(['RF_DR_LOW','RF_DR_HIGH','EN_CRC','CRCO','RF_PWR'], function (e,d) {
            var isPlus = false,
                pwrs = (COMPAT) ? _m.TX_POWER : ["-18dBm","-12dBm","-6dBm","0dBm"];
            if (d.RF_DR_LOW) {      // if set, we already know and don't need to check by toggling
              isPlus = true;
              logFinalDetails();
            } else self.setStates({RF_DR_LOW:true}, function () {
              self.getStates(['RF_DR_LOW'], function (e,d2) {
                // (non-plus chips hold this bit zero even after settting)
                if (d2.RF_DR_LOW) isPlus = true;
                // …then set back to original (false) value again
                self.setStates({RF_DR_LOW:false}, function () {
                  logFinalDetails();
                }, self._NESTED_);
              }, self._NESTED_);
            }, self._NESTED_);
            function logFinalDetails() {
              console.log("Data Rate:\t", (d.RF_DR_LOW) ? "250kbps" : ((d.RF_DR_HIGH) ? "2Mbps" : "1Mbps"));
              console.log("Model:\t\t", (isPlus) ? "nRF24L01+" : "nRF24L01");
              console.log("CRC Length:\t", (d.EN_CRC) ? ((d.CRCO) ? "16 bits" : "8 bits") : "Disabled");
              console.log("PA Power:\t", pwrs[d.RF_PWR]);
              if (cb) cb();
            }
          }, self._NESTED_);
        }, self._NESTED_);
      }, self._NESTED_);
    }, self._NESTED_);
  }, self._NESTED_);
}, (_n === this._NESTED_)); };

exports.printStatus = function () {
  var self = this;
  self.getStates(['RX_DR','TX_DS','MAX_RT','RX_P_NO','TX_FULL'], function (e,d) {
    if (e) console.error(e.stack);
    else console.log(self._hw.irq.value() ? 'no-irq' : '-IRQ-', d);
  });
};
