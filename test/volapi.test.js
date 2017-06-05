/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2017, Joyent, Inc.
 */

var bunyan = require('bunyan');
var restify = require('restify-clients');
var test = require('tape');

var VOLAPI = require('../lib/index').VOLAPI;

var VOLAPI_IP = process.env.VOLAPI_IP || '10.99.99.70';
var VOLAPI_URL = 'http://' + VOLAPI_IP;

var volApiClient;

test('volapi', function (tt) {
    tt.test(' setup', function (t) {
        var log = new bunyan.createLogger({
            name: 'volapi_unit_test',
            stream: process.stderr,
            level: (process.env.LOG_LEVEL || 'info'),
            serializers: restify.bunyan.serializers
        });

        volApiClient = new VOLAPI({
            url: VOLAPI_URL,
            version: '^1',
            userAgent: 'node-sdc-clients-volapi-tests',
            retry: {
                retries: 1,
                minTimeout: 1000
            },
            log: log
        });

        t.ok(volApiClient, 'created volapi client');

        t.end();
    });

    tt.test(' ping', function (t) {
        volApiClient.ping(function (err) {
            t.ifErr(err, 'ping should succeed');
            t.end();
        });
    });

    tt.test(' list volumes', function (t) {
        volApiClient.listVolumes(function (err, objs) {
            t.ifErr(err, 'listVolumes should succeed');
            t.ok(objs, 'listVolumes should return object');
            t.ok(Array.isArray(objs), 'listVolumes object should be an array');
            if (objs.length > 0) {
                // We can only check the volumes if some have been created and
                // this test does not create any so we cannot (yet) rely on
                // there being any.
                t.ok(objs[0].name, 'volume[0] should have a .name');
                t.equal(objs[0].type, 'tritonnfs',
                    'volume[0] should have type tritonnfs');
            }
            t.end();
        });
    });

    tt.test(' list volume sizes', function (t) {
        volApiClient.listVolumeSizes(function (err, objs) {
            t.ifError(err, 'ListVolumeSizes should succeed');
            t.ok(objs, 'should have received object from ListVolumeSizes');
            t.ok(Array.isArray(objs), 'volume sizes object should be array');
            t.ok(objs.length > 0,
                'volume sizes array should have at least 1 size object');
            t.ok(objs[0].size, 'expected value for size, got: ' + objs[0].size);
            t.ok(objs[0].description, 'expected value for description, got: ' +
                objs[0].description);
            t.end();
        });
    });

    tt.test(' api version needs to be specified', function (t) {
        var apiClient;
        t.throws(function badClient() {
            apiClient = new VOLAPI({
                url: VOLAPI_URL,
                userAgent: 'node-sdc-clients-volapi-tests'
            });
        });

        if (apiClient) {
            apiClient.close();
        }

        t.end();
    });

    tt.test(' api version star not allowed', function (t) {
        var apiClient;
        t.throws(function badClient() {
             apiClient = new VOLAPI({
                url: VOLAPI_URL,
                version: '*',
                userAgent: 'node-sdc-clients-volapi-tests'
            });
        });

        if (apiClient) {
            apiClient.close();
        }

        t.end();
    });

    tt.test(' teardown', function (t) {
        volApiClient.close();
        t.end();
    });
});
