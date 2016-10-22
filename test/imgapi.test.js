var bunyan = require('bunyan');
var test = require('tape');

var IMGAPI = require('../lib/index').IMGAPI;

var IMGAPI_URL = 'http://' + (process.env.IMGAPI_IP || '10.99.99.21');

test('imgapi', function (tt) {
    tt.test(' setup', function (t) {
        var log = bunyan.createLogger({
            name: 'imgapi_unit_test',
            stream: process.stderr,
            level: (process.env.LOG_LEVEL || 'info'),
            serializers: bunyan.stdSerializers
        });

        var imgapi = new IMGAPI({
            url: IMGAPI_URL,
            retry: {
                retries: 1,
                minTimeout: 1000
            },
            log: log
        });

        imgapi.close();

        t.end();
    });
});
