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

```
var radio = require('nrf').connect(spiDev, cePin, irqPin);
radio.channel(0x4c).dataRate('1Mbps').crcBytes(2).autoRetransmit({count:15, delay:4000});
radio.begin(function () {
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

* `radio.openPipe(mode, addr, opts)` — Returns a stream. **TBD**: …

* `radio.end(cb)` — Closes all pipes and powers down the radio. Callback is optional.

### Low-level methods

Effective use of these methods requires proficiency with both the library internals and the transceiver's data sheet documentation. They are exposed only because What's The Worst That Could Happen™.

* `radio.powerUp(boolState, cb)` — Set (or read, when no value is provided) the power status of the radio. Callback is optional. When the power is off the transceiver hardware uses little power, but takes a little while longer to enter any useful mode. This is set `true` by `radio.begin()` and `false` by `radio.end()` so it is typically not necessary when using the main API. Default is `false`.

* `radio.addressWidth(width, cb)` — Set (or read, when no value is provided) the receiver address width used. Callback is optional. When the power is off the transceiver hardware uses little power, but takes a little while longer to enter any useful mode. This is determined automatically whenever `radio.openPipe()` so it is typically not necessary when using the main API. Choose `3`, `4` or `5` bytes (this library also supports setting `2`, at your own risk). Default is `5`.

> **TBD**: `radio.execCommand(cmd,data,cb)` / `radio.getStates(list,cb)` / `radio.setStates(vals, cb)` / `radio.setCE(state, block)` / `radio.pulseCE(block)` / `radio.reset(states, cb)` / `radio.blockMicroseconds(us)` / `radio.readPayload(opts, cb)` / `radio.sendPayload(data, opts, cb)`


## License

> **TBD**: [BSD-2-Clause template]
