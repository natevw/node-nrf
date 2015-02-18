var SPI = require('pi-spi'),
    GPIO = require('pi-pins'),
    _extend = require('xok');

var DEBUG = require("./logging").log.bind(null, 'debug'),
    Transceiver = require("./xcvr_api"),
    printMixins = require("./xcvr_print_mixins"),
    _m = require("./magicnums");

exports.connect = function (spi,ce,irq) {
  var xcvr = new Transceiver({
    // TODO: greater abstraction for cleaner support of non-Linux hardware APIs
    spi: SPI.initialize(spi),
    ce: GPIO.connect(ce),
    irq: (arguments.length > 2) && GPIO.connect(irq)
  });
  
  xcvr.on('interrupt', function (d) { DEBUG("IRQ.", d); });
  _extend(xcvr, printMixins);
  xcvr._printableHardware = [
    "SPI device:\t"+spi,
    //"SPI speed:\t"+'?',
    "CE GPIO:\t"+ce,
    "IRQ GPIO:\t"+irq
  ].join('\n');
  
  return xcvr;
}
