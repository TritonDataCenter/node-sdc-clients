/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2016, Joyent, Inc.
 */

var VOLAPI = require('../lib/index').VOLAPI;
var bunyan = require('bunyan');
var restify = require('restify');

var VOLAPI_IP = process.env.VOLAPI_IP || '10.99.99.70';
var VOLAPI_URL = 'http://' + VOLAPI_IP;

var volApiClient;

exports.setUp = function (callback) {
    var logger = new bunyan.createLogger({
            name: 'vapi_unit_test',
            stream: process.stderr,
            level: (process.env.LOG_LEVEL || 'info'),
            serializers: restify.bunyan.serializers
    });

    volApiClient = new VOLAPI({
        url: VOLAPI_URL,
        retry: {
            retries: 1,
            minTimeout: 1000
        },
        log: logger
    });

    callback();
};

exports.test_ping = function (t) {
    volApiClient.ping(function (err) {
        t.ifError(err);
        t.done();
    });
};

exports.test_list_volumes = function (t) {
    volApiClient.listVolumes(function (err, objs) {
        t.ifError(err);
        t.ok(objs);
        t.ok(Array.isArray(objs));
        t.ok(objs.length > 0);
        t.ok(objs[0].name);
        t.ok(objs[0].type);
        t.done();
    });
};

exports.tearDown = function (callback) {
    volApiClient.close();
    callback();
};
