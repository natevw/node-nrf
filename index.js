var SPI = require('pi-spi');



var REGISTER_MAP = {
    // mnemonic    addr,bit[,width]
/* CONFIG */
    MASK_RX_DR:     [0x00,6],
    MASK_TX_DS:     [0x00,5],
    MASK_MAX_RT:    [0x00,4],
    EN_CRC:         [0x00,3],
    CRCO:           [0x00,2],
    PWR_UP:         [0x00,1],
    PRIM_RX:        [0x00,0],
/* EN_AA */
    ENAA_P5:        [0x01,5],
    ENAA_P4:        [0x01,4],
    ENAA_P3:        [0x01,3],
    ENAA_P2:        [0x01,2],
    ENAA_P1:        [0x01,1],
    ENAA_P0:        [0x01,0],
/* EN_RXADDR */
    ERX_P5:         [0x02,5],
    ERX_P4:         [0x02,4],
    ERX_P3:         [0x02,3],
    ERX_P2:         [0x02,2],
    ERX_P1:         [0x02,1],
    ERX_P0:         [0x02,0],
/* SETUP_AW */
    AW:             [0x03,0,2],
/* SETUP_RETR */
    ARD:            [0x04,4,4],
    ARC:            [0x04,0,4],
/* RF_CH */
    RF_CH:          [0x05,0,7],
/* RF_SETUP */
    CONT_WAVE:      [0x06,7],
    RF_DR_LOW:      [0x06,5],
    PLL_LOCK:       [0x06,4],
    RF_DR_HIGH:     [0x06,3],
    RF_PWR:         [0x06,1,2],
    LNA_HCURR:      [0x06,0],
/* STATUS */
    RX_DR:          [0x07,6],
    TX_DS:          [0x07,5],
    MAX_RT:         [0x07,4],
    RX_P_NO:        [0x07,1,3],
    TX_FULL:        [0x07,0],
/* OBSERVE_TX */
    PLOS_CNT:       [0x08,4,4],
    ARC_CNT:        [0x08,0,4],
/* RPD */
    RPD:            [0x09,0,0],
/* ADDR */
    RX_ADDR_P0:     [0x0A,0,40],
    RX_ADDR_P1:     [0x0B,0,40],
    RX_ADDR_P2:     [0x0C,0,8],
    RX_ADDR_P3:     [0x0D,0,8],
    RX_ADDR_P4:     [0x0E,0,8],
    RX_ADDR_P5:     [0x0F,0,8],
    TX_ADDR:        [0x10,0,40],
/* RX_PW_Pn */
    RX_PW_P0:       [0x11,0,6],
    RX_PW_P1:       [0x12,0,6],
    RX_PW_P2:       [0x13,0,6],
    RX_PW_P3:       [0x14,0,6],
    RX_PW_P4:       [0x15,0,6],
    RX_PW_P5:       [0x16,0,6],
/* FIFO_STATUS */
    TX_REUSE:       [0x17,6],
    TX_FULL:        [0x17,5],
    TX_EMPTY:       [0x17,4],
    RX_FULL:        [0x17,1],
    RX_EMPTY:       [0x17,0],
/* DYNPD */
    DPL_P5:         [0x1C,5],
    DPL_P4:         [0x1C,4],
    DPL_P3:         [0x1C,3],
    DPL_P2:         [0x1C,2],
    DPL_P1:         [0x1C,1],
    DPL_P0:         [0x1C,0],
/* FEATURE */
    EN_DPL:         [0x1D,2],
    EN_ACK_PAY:     [0x1D,1],
    EN_DYN_ACK:     [0x1D,0]
};

exports.connect = function () {
  var nrf = {},
      spi = SPI.initialize.apply(null, arguments);
  
  
  // .on('message')
  
  
  // see "Sysfs Interface for Userspace" in
  // https://www.kernel.org/doc/Documentation/gpio.txt
  
  
  
  // expose:
  // - low level interface (getStates, setStates, etc.)
  // - mid level interface (rx channels and params)
  // - high level PRX (addrs)
  // - high level PTX (addr)
  
  return nrf;
}