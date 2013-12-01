function _b(v) { return parseInt(v.replace(' ',''),2); }

exports.COMMANDS = {
    R_REGISTER:     _b('0000 0000'),
    W_REGISTER:     _b('0010 0000'),
    R_RX_PAYLOAD:   _b('0110 0001'),
    W_TX_PAYLOAD:   _b('1010 0000'),
    FLUSH_TX:       _b('1110 0001'),
    FLUSH_RX:       _b('1110 0010'),
    REUSE_TX_PL:    _b('1110 0011'),
    R_RX_PL_WID:    _b('0110 0000'),
    W_ACK_PAYLOAD:  _b('1010 1000'),
    W_TX_PD_NOACK:  _b('1011 0000'),
    NOP:            _b('1111 1111')
};

exports.REGISTER_MAP = {
    // mnemonic    addr,bit[,width]
/* CONFIG */
    CONFIG:         [0x00],
    MASK_RX_DR:     [0x00,6],
    MASK_TX_DS:     [0x00,5],
    MASK_MAX_RT:    [0x00,4],
    EN_CRC:         [0x00,3],
    CRCO:           [0x00,2],
    PWR_UP:         [0x00,1],
    PRIM_RX:        [0x00,0],
/* EN_AA */
    EN_AA:          [0x01],
    ENAA_P5:        [0x01,5],
    ENAA_P4:        [0x01,4],
    ENAA_P3:        [0x01,3],
    ENAA_P2:        [0x01,2],
    ENAA_P1:        [0x01,1],
    ENAA_P0:        [0x01,0],
/* EN_RXADDR */
    EN_RXADDR:      [0x02],
    ERX_P5:         [0x02,5],
    ERX_P4:         [0x02,4],
    ERX_P3:         [0x02,3],
    ERX_P2:         [0x02,2],
    ERX_P1:         [0x02,1],
    ERX_P0:         [0x02,0],
/* SETUP_AW */
    SETUP_AW:       [0x03],
    AW:             [0x03,0,2],
/* SETUP_RETR */
    SETUP_RETR:     [0x04],
    ARD:            [0x04,4,4],
    ARC:            [0x04,0,4],
/* RF_CH */
    RF_CH:          [0x05,0,7],
/* RF_SETUP */
    RF_SETUP:       [0x06],
    CONT_WAVE:      [0x06,7],
    RF_DR_LOW:      [0x06,5],
    PLL_LOCK:       [0x06,4],
    RF_DR_HIGH:     [0x06,3],
    RF_PWR:         [0x06,1,2],
    LNA_HCURR:      [0x06,0],       // NOTE: this is obsolete on the nRF24L01+ model
/* STATUS */
    STATUS:         [0x07],
    RX_DR:          [0x07,6],
    TX_DS:          [0x07,5],
    MAX_RT:         [0x07,4],
    RX_P_NO:        [0x07,1,3],
    TX_FULL:        [0x07,0],
/* OBSERVE_TX */
    OBSERVE_TX:     [0x08],
    PLOS_CNT:       [0x08,4,4],
    ARC_CNT:        [0x08,0,4],
/* RPD */
    RPD:            [0x09,0],
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
    FIFO_STATUS:    [0x17],
    TX_REUSE:       [0x17,6],
    TX_FULL:        [0x17,5],
    TX_EMPTY:       [0x17,4],
    RX_FULL:        [0x17,1],
    RX_EMPTY:       [0x17,0],
/* DYNPD */
    DYNPD:          [0x1C],
    DPL_P5:         [0x1C,5],
    DPL_P4:         [0x1C,4],
    DPL_P3:         [0x1C,3],
    DPL_P2:         [0x1C,2],
    DPL_P1:         [0x1C,1],
    DPL_P0:         [0x1C,0],
/* FEATURE */
    FEATURE:        [0x1D],
    EN_DPL:         [0x1D,2],
    EN_ACK_PAY:     [0x1D,1],
    EN_DYN_ACK:     [0x1D,0]
};

exports.REGISTER_DEFAULTS = {
    CONFIG:     _b('0000 1000'),
    EN_AA:      _b('0011 1111'),
    EN_RXADDR:  _b('0000 0011'),
    SETUP_AW:   _b('0000 0011'),
    SETUP_RETR: _b('0000 0011'),
    RF_CH:      _b('0000 0010'),
    RF_SETUP:   _b('0000 1111'),
    STATUS:     _b('0111 1110'),
    RX_ADDR_P0: Buffer("E7E7E7E7E7", 'hex'),
    RX_ADDR_P1: Buffer("C2C2C2C2C2", 'hex'),
    RX_ADDR_P2: 0xC3,
    RX_ADDR_P3: 0xC4,
    RX_ADDR_P4: 0xC5,
    RX_ADDR_P5: 0xC6,
    TX_ADDR:    Buffer("E7E7E7E7E7", 'hex'),
    DYNPD:      _b('0000 0000'),
    FEATURE:    _b('0000 0000'),
};

exports.TIMING = {
    pd2stby: 150,      // NOTE: varies dep. on crystal configuration, see p.24/p.19
    stby2a: 130,
    hce: 10,
    pece2csn: 4
};

exports.TX_POWER = ['PA_MIN', 'PA_LOW', 'PA_HIGH', 'PA_MAX'];
