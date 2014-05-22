/* 
 *  These are settings for Tessel to work out of the box with 
 *  maniacbug's RF24 pingpair example (https://github.com/maniacbug/RF24/blob/07a4bcf425d91c99105dbdbad0226296c7cd3a93/examples/pingpair/pingpair.pde)
 *  Useful for bridging an Arduino + nRF24 to Tessel + nRF24
 */

var tessel = require('tessel'),
    NRF24 = require("../"),
    pipes = [0xF0F0F0F0E1, 0xF0F0F0F0D2],
    role = 'pong'; // swap this to pong if you want to wait for receive

var nrf = NRF24.channel(0x4c) // set the RF channel to 76. Frequency = 2400 + RF_CH [MHz] = 2476MHz
    .transmitPower('PA_MAX') // set the transmit power to max
    .dataRate('1Mbps')
    .crcBytes(2) // 2 byte CRC
    .autoRetransmit({count:15, delay:4000})
    .use(tessel.port['A']);

nrf._debug = false;

nrf.on('ready', function () {
    if (role === 'ping') {
        console.log("PING out");
         /* 
          * The Arduino pong code needs to have its timeout changed. On line #205
          * https://github.com/maniacbug/RF24/blob/07a4bcf425d91c99105dbdbad0226296c7cd3a93/examples/pingpair/pingpair.pde#L205
          * the delay(20) needs to be swapped out with delay(2000)
          */

        var tx = nrf.openPipe('tx', pipes[1]), // transmit address F0F0F0F0D2
            rx = nrf.openPipe('rx', pipes[1], {size: 8}); // receive address F0F0F0F0D2
        tx.on('ready', function () {    // NOTE: hoping to get rid of need to wait for "ready"
            var n = 0;
            setInterval(function () {
                var b = new Buffer(8); // set buff len of 8 for compat with maniac bug's RF24 lib
                b.fill(0);
                b.writeUInt32BE(n++, 4); // offset by 4 because our buffer length is 8 bytes
                console.log("Sending", n);
                tx.write(b);
            }, 5e3); // transmit every 5 seconds
        });
        rx.on('data', function (d) {
            console.log("Got response back:", d.readUInt32BE(4)); //offset by 4 again
        });
    } else {
        console.log("PONG back");
        /* 
          * The Arduino ping code needs to have its timeout changed. On line #161
          * https://github.com/maniacbug/RF24/blob/07a4bcf425d91c99105dbdbad0226296c7cd3a93/examples/pingpair/pingpair.pde#L161
          * instead of "if (millis() - started_waiting_at > 200 )"
          * change to "if (millis() - started_waiting_at > 2000 )"
          */

        var rx = nrf.openPipe('rx', pipes[0], {size: 8});  
            tx = nrf.openPipe('tx', pipes[0], {autoAck: false}); 
        rx.on('data', function (d) {
            console.log("Got data, will respond", d);
            tx.write(d);
        });
        tx.on('error', function (e) {
            console.warn("Error sending reply.", e);
        });
    }
});

// hold this process open
process.ref();