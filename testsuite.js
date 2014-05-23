#!/usr/bin/env node

require('shelljs/global');

var port = process.env.ACCEL_PORT || 'A';
var cmd = './node_modules/.bin/tap --timeout 90 -e "tessel run {} ' + port + '" test/*.js';

// execute
cd(__dirname)
process.exit(exec(cmd).code);
