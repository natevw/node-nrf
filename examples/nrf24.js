/* tessel to tessel
 * requires 2 nrf24 modules (and ideally two tessels)
 * put one tessel+nrf on "ping" mode and another one on "pong" mode
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
	setTimeout(function(){
		nrf.printDetails();
	}, 5000);

	if (role === 'ping') {
		console.log("PING out");

		var tx = nrf.openPipe('tx', pipes[0], {autoAck: false}), // transmit address F0F0F0F0D2
			rx = nrf.openPipe('rx', pipes[1], {size: 4}); // receive address F0F0F0F0D2
		tx.on('ready', function () {
			var n = 0;
			setInterval(function () {
				var b = new Buffer(4); // set buff len of 8 for compat with maniac bug's RF24 lib
				b.fill(0);
				b.writeUInt32BE(n++);
				console.log("Sending", n);
				tx.write(b);
			}, 5e3); // transmit every 5 seconds
		});
		rx.on('data', function (d) {
			console.log("Got response back:", d);
		});
	} else {
		console.log("PONG back");
		var rx = nrf.openPipe('rx', pipes[0], {size: 4});  
			tx = nrf.openPipe('tx', pipes[1], {autoAck: false}); 
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