// Any copyright is dedicated to the Public Domain.
// http://creativecommons.org/publicdomain/zero/1.0/

/*********************************************
This nRF24 example requires two nRF24 modules
(and ideally two Tessels). Put one Tessel +
nRF24 module on "ping" mode and the other
pair on "pong" mode to make them send
information back and forth.
*********************************************/

var tessel = require('tessel');
var NRF24 = require('../'); // Replace '../' with 'rf-nrf24' in your own code
var pipes = [0xF0F0F0F0E1, 0xF0F0F0F0D2];

var role = 'ping'; // 'ping' to send; 'pong' to receive

// Set up NRF
var nrf = NRF24.channel(0x4c) // set the RF channel to 76. Frequency = 2400 + RF_CH [MHz] = 2476MHz
	.transmitPower('PA_MAX') // set the transmit power to max
	.dataRate('1Mbps')
	.crcBytes(2) // 2 byte CRC
	.autoRetransmit({count:15, delay:4000})
	.use(tessel.port['A']);

nrf._debug = false;

// Wait for the module to connect
nrf.on('ready', function () {
	setTimeout(function(){
		nrf.printDetails();
	}, 5000);

	if (role === 'ping') {
		console.log('PING out');
    // If set to 'ping' mode, send data
		var tx = nrf.openPipe('tx', pipes[0], {autoAck: false}), // transmit address F0F0F0F0D2
			rx = nrf.openPipe('rx', pipes[1], {size: 4}); // receive address F0F0F0F0D2
		tx.on('ready', function () {
			var n = 0;
			setInterval(function () {
				var buff = new Buffer(4); // set buff len of 8 for compat with maniac bug's RF24 lib
				buff.fill(0);
				buff.writeUInt32BE(n++);
				console.log("Sending", n);
				tx.write(buff);
			}, 5e3); // transmit every 5 seconds
		});
		rx.on('data', function (data) {
			console.log("Got response back:", data);
		});
	} else {
		console.log("PONG back");
    // If set to 'pong' mode, receive data
		var rx = nrf.openPipe('rx', pipes[0], {size: 4});
			tx = nrf.openPipe('tx', pipes[1], {autoAck: false});
		rx.on('data', function (data) {
			console.log("Got data, will respond", data);
			tx.write(data);
		});
		tx.on('error', function (err) {
			console.warn("Error sending reply.", err);
		});
	}
});

// hold this process open
process.ref();
