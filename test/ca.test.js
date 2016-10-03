/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2016 Joyent, Inc.
 */

var bunyan = require('bunyan');
var libuuid = require('libuuid');
var test = require('tape');
var util = require('util');

var CA = require('../lib/index').CA;


// --- Globals

var CA_URL = 'http://' + (process.env.CA_IP || '10.99.99.25') + ':23181';

var ca = null;
var customer = process.env.UFDS_ADMIN_UUID;
var instrumentation = null;


// --- Tests

test('ca', function (tt) {
    tt.test(' setup', function (t) {
        ca = new CA({
            url: CA_URL,
            retry: {
                retries: 1,
                minTimeout: 1000
            }
        });
        t.end();
    });


    tt.test(' list schema', function (t) {
        ca.listSchema(customer, function (err, schema) {
            t.ifError(err);
            t.ok(schema);
            t.end();
        });
    });


    tt.test(' create instrumentation bad params', function (t) {
        ca.createInstrumentation(customer, {}, function (err, inst) {
            t.ok(err);
            t.ok(!inst);
            t.equal(err.statusCode, 409);
            t.equal(err.restCode, 'InvalidArgument');
            t.ok(err.message);
            t.end();
        });
    });


    tt.test(' create instrumentation', function (t) {
        var params = {
            module: 'fs',
            stat: 'logical_ops',
            decomposition: 'latency'
        };
        ca.createInstrumentation(customer, params, function (err, inst) {
            var uri;
            t.ifError(err, err);
            t.ok(inst);
            if (inst) {
                uri = inst.uri;
                instrumentation = uri.substr(uri.lastIndexOf('/') + 1);
            }
            t.end();
        });
    });


    tt.test(' list instrumentations', function (t) {
        ca.listInstrumentations(customer, function (err, instrumentations) {
            t.ifError(err);
            t.ok(instrumentations);
            t.ok(instrumentations.length);
            var i = instrumentations[instrumentations.length - 1];
            t.equal(i.module, 'fs');
            t.equal(i.stat, 'logical_ops');
            t.end();
        });
    });


    tt.test(' list instrumentations bogus customer', function (t) {
        ca.listInstrumentations(libuuid.create(), function (err, insts) {
            t.ifError(err);
            t.ok(insts);
            t.equal(insts.length, 0);
            t.end();
        });
    });


    tt.test(' get instrumentation bad', function (t) {
        ca.getInstrumentation(customer, libuuid.create(), function (err, inst) {
            t.ok(err);
            t.ok(!inst);
            t.equal(err.statusCode, 404);
            t.equal(err.restCode, 'ResourceNotFound');
            t.ok(err.message);
            t.end();
        });
    });


    tt.test(' get instrumentation', function (t) {
        ca.getInstrumentation(customer, instrumentation, function (err, inst) {
            t.ifError(err);
            t.ok(inst);
            t.end();
        });
    });


    tt.test(' get heatmap', function (t) {
        ca.getHeatmap(customer, instrumentation, function (err, heatmap) {
            t.ifError(err);
            t.ok(heatmap);
            t.end();
        });
    });


    tt.test(' get heatmap bad', function (t) {
        ca.getHeatmap(customer, libuuid.create(), function (err, heatmap) {
            t.ok(err);
            t.ok(!heatmap);
            t.equal(err.statusCode, 404);
            t.equal(err.restCode, 'ResourceNotFound');
            t.ok(err.message);

            t.end();
        });
    });


    tt.test(' get heatmap details bad', function (t) {
        ca.getHeatmapDetails(customer, libuuid.create(), {
            x: 10,
            y: 20
        }, function (err, heatmap) {
            t.ok(err);
            t.ok(!heatmap);
            t.equal(err.statusCode, 404);
            t.equal(err.restCode, 'ResourceNotFound');
            t.ok(err.message);
            t.end();
        });
    });


    tt.test(' delete instrumentation bad', function (t) {
        ca.deleteInstrumentation(customer, libuuid.create(), function (err) {
            t.ok(err);
            t.equal(err.statusCode, 404);
            t.equal(err.restCode, 'ResourceNotFound');
            t.ok(err.message);
            t.end();
        });
    });


    tt.test(' clone instrumentation', function (t) {
        ca.cloneInstrumentation(customer, instrumentation,
                function (err, inst) {
            t.ifError(err);
            ca.deleteInstrumentation(customer, inst.id, function (err2) {
                t.ifError(err2);
                t.end();
            });
        });
    });


    tt.test(' delete instrumentation', function (t) {
        ca.deleteInstrumentation(customer, instrumentation, function (err) {
            t.ifError(err);
            t.end();
        });
    });


    tt.test(' teardown', function (t) {
        ca.close();
        t.end();
    });
});
