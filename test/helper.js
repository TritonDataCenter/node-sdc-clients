// Copyright 2012 Joyent, Inc.  All rights reserved.
//
// Just a simple wrapper over nodeunit's exports syntax. Also exposes
// a common logger for all tests.
//

var Logger = require('bunyan');


// --- Globals

var LOG = new Logger({
    level: (process.env.LOG_LEVEL || 'info'),
    name: process.argv[1],
    stream: process.stderr,
    src: true,
    serializers: Logger.stdSerializers
});


// --- Exports

module.exports = {
    after: function after(callback) {
        module.parent.tearDown = callback;
    },

    before: function before(callback) {
        module.parent.setUp = callback;
    },

    test: function test(name, tester) {
        module.parent.exports[name] = tester;
    }
};

module.exports.__defineGetter__('log', function () {
    return (LOG);
});
