var SPI = require('pi-spi');

exports.connect = function () {
  var nrf = {},
      spi = SPI.initialize.apply(null, arguments);
  
  return nrf;
}