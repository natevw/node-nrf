/* tessel to tessel
 * requires 2 nrf24 modules (and ideally two tessels)
 * put one tessel+nrf on "ping" mode and another one on "pong" mode
 */

var tessel = require('tessel'),
	NRF24 = require("../"),
	pipes = [0xF0F0F0F0E1, 0xF0F0F0F0D2];

console.log('1..3');

function go (port, role) {
	var nrf = NRF24.channel(0x4c) // set the RF channel to 76. Frequency = 2400 + RF_CH [MHz] = 2476MHz
		.transmitPower('PA_MAX') // set the transmit power to max
		.dataRate('1Mbps')
		.crcBytes(2) // 2 byte CRC
		.autoRetransmit({count:15, delay:4000})
		.use(port);

	nrf._debug = false;

	var sendack = false, resack = false;
	nrf.on('ready', function () {
		if (role === 'ping') {
			console.log("# PING out");

			var tx = nrf.openPipe('tx', pipes[0], {autoAck: false}), // transmit address F0F0F0F0D2
				rx = nrf.openPipe('rx', pipes[1], {size: 4}); // receive address F0F0F0F0D2
			tx.on('ready', function () {
				var n = 0;
				setImmediate(function loop () {
					var b = new Buffer(4); // set buff len of 8 for compat with maniac bug's RF24 lib
					b.fill(0);
					b.writeUInt32BE(n++);
					console.log("# sending", n);
					!sendack && console.log('ok - sending');
					sendack = true;
					tx.write(b);
					setTimeout(loop, 5e3)
				}); // transmit every 5 seconds
			});
			rx.on('data', function (d) {
				console.log("# got response back:", d);
				console.log('ok - responded');
				process.exit(0);
			});
		} else {
			console.log("# PONG back");
			var rx = nrf.openPipe('rx', pipes[0], {size: 4});  
				tx = nrf.openPipe('tx', pipes[1], {autoAck: false}); 
			rx.on('data', function (d) {
				console.log("# got data, will respond", d);
				!resack && console.log('ok - responding');
				resack = true;
				tx.write(d);
			});
			tx.on('error', function (e) {
				console.log("not ok - Error sending reply.", e);
				process.exit(1);
			});
		}
	});
}

// hold this process open
process.ref();

go(tessel.port['B'], 'ping');
go(tessel.port['GPIO'], 'pong');