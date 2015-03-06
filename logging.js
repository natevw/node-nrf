var util = require('util'),
    debuglog = (1) ? _debuglog : util.debuglog('nrf');

var levels = ['error', 'warn', 'info', 'debug'];

exports.level = 'info';

exports.log = function (level, msg) {
  if (levels.indexOf(level) > levels.indexOf(exports.level)) return;
  else debuglog.apply(null, Array.prototype.slice.call(arguments, 1));
};

function _debuglog() {
  var msg = util.format.apply(util, arguments);
  process.stderr.write(msg+"\n");
}
