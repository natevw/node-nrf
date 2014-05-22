# node-nrf

nRF24L01+ driver library for node.js on platforms like the [Raspberry Pi](http://en.wikipedia.org/wiki/Raspberry_Pi) and [others](http://tessel.io/).

Making this inexpensive radio chip easy to use from node.js helps bridge the wider Internet with small/cheap "things" — other embedded devices like [Arduino](http://arduino.cc/), [Teensy](http://www.pjrc.com/teensy/), good ol'fashioned [AVR chips](https://www.sparkfun.com/products/11232), … — where the costs of WiFi/Bluetooth/Zigbee radios can quickly add up! This fulfills a critical dependency of my [Microstates](https://github.com/natevw/microstates) idea, for just one example.

## See also?

Not to be confused with [node-rf24](https://github.com/natevw/node-rf24) which was/is an unfinished (and broken by recent V8 and libuv changes) wrapper around the RasPi port of the C++ [RF24 library](https://github.com/stanleyseow/RF24).

In contrast, *this* module is implemented in pure JavaScript on top of native [SPI bindings](https://github.com/natevw/pi-spi). It also provides a cleaner, node-friendly interface.


## Installation

`npm install nrf`


## Usage

[Streams](https://github.com/substack/stream-handbook#readme)!

```js
var radio = require('nrf')
	.channel(0x4c).dataRate('1Mbps')
	.crcBytes(2).autoRetransmit({count:15, delay:4000})
	.use(spiDev, cePin, irqPin);

radio.on('ready', function () {
    var rx = radio.openPipe('rx', 0xF0F0F0F0E1),
        tx = radio.openPipe('tx', 0xF0F0F0F0D2);
    rx.pipe(tx);        // echo back everything
});
```

The nRF24L01+ radios provide "logic pipes" which can be used as node.js streams. These are opened for a given receiver address according to their primary direction. However, since the transceiver hardware supports sending data payloads with its acknowlegement packets, the both primary directions provide duplex streams — acknowlegement payload data can be read from a `'tx'` stream if the `ackPayloads` option is set true, and written to any `'rx'` stream.

> **TBD**: expand this section ["non"-stream usage, pipe options, optional callbacks, buffering and splitting/joining streams from 32-byte chunks, etc.]


## API

### Initialization

* `var radio = nrf.connect(spiDev, cePin, irqPin)` —  Initialize a radio object using the given hardware pinouts. Under Linux, `spiDev` is a device like "/dev/spidev0.0" and must be accessible by your process's user. `cePin` and `irqPin` are GPIO port numbers (`irqPin` is optional but highly recommended — without it the library must resort to polling which is slower and more processor/power intensive) and these GPIO ports must also be accessible by your process's user. This does essentially no communication with (and no configuration of) the radio; use the configuration methods below and `radio.begin()` to set up.

* `radio.reset(cb)` — Resets the transciever to its default settings and flushes its transmit/receive queues. Most of this (i.e. queue flushing and low-level settings) is done by `.begin()` and so calling reset is *not* necessary if the five transceiver configuration options below (channel/dataRate/transmitPower/crcBytes/autoRetransmit) are being written anyway.

### Transceiver configuration

* `radio.channel(num, cb)` — Set (or read, when no value is provided) the radio frequency channel. Callback is optional. This must be the same on all transceivers that wish to communicate. Default is `0x02`.

* `radio.dataRate(rate, cb)` — Set (or read, when no value is provided) the channel data rate. Callback is optional. This must be the same on all transeivers that wish to communicate. Must be one of `['250kbps', '1Mbps','2Mbps']`. Default is `'2Mbps'`.

* `radio.transmitPower(rate, cb)` — Set (or read, when no value is provided) the RF output power. Callback is optional. Must be one of `['PA_MIN', 'PA_LOW', 'PA_HIGH', 'PA_MAX']`. Default is `'PA_MAX'`.

* `radio.crcBytes(numBytes, cb)` — Set (or read, when no rate is provided) the size of packet checksums. Callback is optional. This must be the same on all transeivers that wish to communicate. Choose `1` or `2` bytes, or `0` to disable CRC checksums. Default is `1`.

* `radio.autoRetransmit(opts, cb)` — Set (or read, when no value is provided) the packet retransmission parameters. Callback is optional. Provide a dictionary with one or two keys: `delay` to set the retry spacing in microseconds (will be rounded to a multiple of 250µs) and `count` to set the maximum number of retries. (See the datasheet for the minimum delay necessary based on data rate and packet size.) Default is `{delay:250,count:3}`.

### Sending/receiving

* `radio.begin(cb)` — Powers up the radio, configures its pipes, and prepares the library to handle actual payload transmission/receipt. Callback is optional, but if not provided you should not attempt to open pipes until the 'ready' event is emitted. (The configuration methods above may be called at any time before/after this method.)

* `radio.openPipe(mode, addr, opts)` — Returns a stream representing a "data pipe" on the radio. See pipe details section below.

* `radio.end(cb)` — Closes all pipes and powers down the radio. Callback is optional.

#### Pipe details

The nRF24 radios use "logical channels" for communications within a physical channel. Basically a pipe address is sent ahead of every data transmission on a particular channel (frequency); a receiver of the "same pipe" listens for this address and upon detecting a match attempts to process the data packet which follows. The transceiver hardware can be configured for automatic acknowlegdment/retransmission of received/unacknowleged packets (respectively). The `radio.openPipe(mode, addr, opts)` method returns a standard node.js Duplex stream interface wrapping these hardware features.

* The `mode` parameter to `radio.openPipe` must be `'tx'` or `'rx'` and determines the primary behavior of the radio data pipe. Because acknowlegement packets can include arbitary payloads, a data pipe of either mode can be used for *both* receiving and sending. The main difference is that an `'rx'` pipe is always listening, but can only send data in acknowlegement to incoming packets; conversely [inversely? contrapositively?] a `'tx'` pipe can only receive a single packet of data (sent within a brief window) after each of its own successful transmissions. (See `options` documentation below.)

* The `addr` parameter is simply the aforementioned address of the data pipe, usually as a 5 byte buffer. As a shorthand, you can also pass raw numbers e.g. `0xEF` for addresses, but note that the most significant nibble must have bit(s) set for this to work as expected — a literal `0x0000000A` in your source code will get processed as the invalid `Buffer("a", 'hex')` rather than a 3-byte address.

* For `'rx'` mode pipes things are a little more complicated. The nRF24 chip supports listening simultaneously for up to 6 data channel pipes, *but* four of these logical channel address assignments must differ in only one byte from the first address. Also, the sixth address slot will be temporarily "borrowed" whenever any `'tx'`-mode pipe needs to listen for an acknowlegement packet. Basically for `'rx'` pipes, pass a 3, 4 or 5 byte `Buffer` the first time you call it, and it will be assigned a hardware pipe number automatically. Subsequent calls should ideally be single-byte `Buffers` only, representing the least significant byte in the address of up to four more pipes. If you open another pipe with a 3/4/5-byte address instead (or additionally), be aware that you may miss packets in certain situations. For example if you first open a pipe with address `0x123456`, you could also listen for `0x57`through `0x5A`. You could also open one last `'rx'` pipe with address `0x998877` — but if there were open `'tx'` pipes as well, and any of them needed to listen for acknowlegements, you could end up occasionally missing transmissions to this sixth address. [**TBD** diagram of "slots"?]

* Finally, via the `opts` parameter you can set a fixed payload `size` (in bytes, defaults to `'auto'`) or disable auto-acknowlegement with `autoAck:false` (defaults to `true`). Note that if you want to disable auto-acknowlegment, you *must* also set a payload size — for some reason these are linked in the nRF24 feature set.

* For `'tx'` pipes, the `opts` parameter also lets you provide individual `retryCount`, `retryDelay`, `txPower` options instead of using the `radio.autoRetransmit` and `radio.transmitPower` methods; if you do this you should provide values for *every* `'tx`' pipe you open, to make sure the hardware configuration gets updated between each different transmission. [**TBD**: what is `ackPayloads` option supposed to do for `'tx`` pipes?]

Note that, while you can `.pipe()` to these streams as any other, `node-nrf` will not split data into packets for you, and will get upset if passed more than 32 bytes of data! Make sure all your `write`s to the stream fit the necessary MTU; **TBD** I imagine the common "transfer an arbitrarily large stream of data" case could be handled by a simple [object mode?] transform stream, find or provide a recommended module.


### Low-level methods

Effective use of these methods requires proficiency with both the library internals and the transceiver's data sheet documentation. They are exposed only because What's The Worst That Could Happen™.

* `radio.powerUp(boolState, cb)` — Set (or read, when no value is provided) the power status of the radio. Callback is optional. When the power is off the transceiver hardware uses little power, but takes a little while longer to enter any useful mode. This is set `true` by `radio.begin()` and `false` by `radio.end()` so it is typically not necessary when using the main API. Default is `false`.

* `radio.addressWidth(width, cb)` — Set (or read, when no value is provided) the receiver address width used. Callback is optional. The address width is determined automatically whenever `radio.openPipe()` is used so it is not normally necessary to call this when using the main API. Choose `3`, `4` or `5` bytes (this library also supports setting `2`, at your own risk). Default is `5`.

> **TBD**: `radio.execCommand(cmd,data,cb)` / `radio.getStates(list,cb)` / `radio.setStates(vals, cb)` / `radio.setCE(state, block)` / `radio.pulseCE(block)` / `radio.reset(states, cb)` / `radio.blockMicroseconds(us)` / `radio.readPayload(opts, cb)` / `radio.sendPayload(data, opts, cb)`


## Troubleshooting

### node-nrf (or pi-spi) not working after using C++ RF24 library

The C++ [RF24 library for RasPi](https://github.com/stanleyseow/RF24/) toggles the SPI chip select pin manually, which breaks the Linux SPI driver. Reload it to fix, before using `node-nrf`:

    sudo modprobe -r spi_bcm2708
    sudo modprobe spi_bcm2708

See [this comment](https://github.com/natevw/node-nrf/issues/1#issuecomment-32395546) for a bit more discussion.

### TBD: gather more advice (or link to a wiki page?)

## License

> **TBD**: [BSD-2-Clause template]
