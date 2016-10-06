/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2016, Joyent, Inc.
 */

var bunyan = require('bunyan');
var restifyClients = require('restify-clients');
var test = require('tape');

var CNS = require('../lib/index').CNS;


var CNS_IP = process.env.CNS_IP || '10.99.99.62';
var CNS_URL = 'http://' + CNS_IP;


test('cns', function (tt) {
    var cns;

    tt.test(' setup', function (t) {
        cns = new CNS({
            url: CNS_URL,
            retry: {
                retries: 1,
                minTimeout: 1000
            },
            log: new bunyan.createLogger({
                name: 'cns_unit_test',
                stream: process.stderr,
                level: (process.env.LOG_LEVEL || 'info'),
                serializers: restifyClients.bunyan.serializers
            })
        });

        t.end();
    });


    tt.test(' ping', function (t) {
        cns.ping(function (err) {
            t.ifError(err);
            t.end();
        });
    });

    tt.test(' list zones', function (t) {
        cns.listZones(function (err, objs) {
            t.ifError(err);
            t.ok(objs);
            t.ok(Array.isArray(objs));
            t.ok(objs.length > 0);
            t.ok(objs[0].name);
            t.ok(objs[0].serial);
            t.end();
        });
    });

    tt.test(' teardown', function (t) {
        cns.close();
        t.end();
    });
});
