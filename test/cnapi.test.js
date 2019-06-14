/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2018, Joyent, Inc.
 */

var assert = require('assert-plus');
var bunyan = require('bunyan');
var test = require('tape');
var util = require('util');
var uuid = require('uuid');
var vasync = require('vasync');

var CNAPI = require('../lib/index').CNAPI;



// --- Globals

var CNAPI_URL = 'http://' + (process.env.CNAPI_IP || '10.99.99.22');

var SERVER = null;
var testVmUuid = uuid.v4();
var testVmAlias = 'nodesdcclientstest-cnapi-' + testVmUuid.split('-')[0];
var TASK = null;
var CUSTOMER = process.env.UFDS_ADMIN_UUID;

// --- Helpers

function waitForTaskAndCheckVmState(options, cb) {
    assert.object(options, 'options');
    assert.object(options.cnapiClient, 'options.cnapiClient');
    assert.uuid(options.taskId, 'options.taskId');
    assert.string(options.vmState, 'options.vmState');
    assert.uuid(options.vmUuid, 'options.vmUuid');
    assert.func(cb, 'cb');

    var cnapi = options.cnapiClient;
    var taskId = options.taskId;
    var vmState = options.vmState;
    var vmUuid = options.vmUuid;

    vasync.pipeline({funcs: [
        function waitForTask(_, next) {
            cnapi.waitTask(taskId, {}, next);
        },
        function checkVmState(_, next) {
            cnapi.getVm(SERVER, vmUuid, function (getVmErr, vm) {
                if (getVmErr) {
                    next(getVmErr);
                    return;
                }

                if (!vm || vm.state !== vmState) {
                    next(new Error('Expected state: ' + vmState + ', got: ' +
                        (vm ? vm.state : undefined)));
                } else {
                    next();
                }
            });
        }
    ]}, cb);
}

// --- Tests

test('cnapi', function (tt) {
    var cnapi;

    tt.test(' setup', function (t) {
        cnapi = new CNAPI({
            url: CNAPI_URL,
            retry: {
                retries: 1,
                minTimeout: 1000
            },
            log: new bunyan.createLogger({
                name: 'nodesdcclientstest-cnapi',
                stream: process.stderr,
                level: (process.env.LOG_LEVEL || 'info'),
                serializers: bunyan.stdSerializers
            })
        });
        t.end();
    });

    tt.test(' list servers (paging)', function (t) {
        cnapi.listServers(function (err, servers, req, res) {
            t.ifError(err, err);
            t.ok(Array.isArray(servers), 'got an array of servers');
            t.ok(servers.length > 0, 'got at least one server');
            t.ok(req, 'listServers returned the first req');
            t.ok(res, 'listServers returned the first res');
            t.end();
        });
    });

    tt.test(' list servers (limit=1, one request)', function (t) {
        cnapi.listServers({limit: 1}, function (err, servers, req, res) {
            t.ifError(err, err);
            t.ok(Array.isArray(servers), 'got an array of servers');
            t.equal(servers.length, 1, 'limit=1 returned exactly one server');
            t.ok(req, 'listServers returned the first req');
            t.ok(res, 'listServers returned the first res');
            t.end();
        });
    });

    tt.test(' find server with which to test', function (t) {
        cnapi.listServers({ headnode: true }, function (err, servers) {
            t.ifError(err, err);

            // Choose a running server for subsequent tests.
            SERVER = servers.filter(function (s) {
                return (s.status === 'running');
            })[0].uuid;

            t.end();
        });
    });

    tt.test(' get server', function (t) {
        cnapi.getServer(SERVER, function (err, server) {
            t.ifError(err);
            t.ok(server);
            t.end();
        });
    });

    tt.test(' create vm', function (t) {
        var opts = {
            uuid: testVmUuid,
            alias: testVmAlias,
            owner_uuid: CUSTOMER,
            brand: 'joyent',
            // This is sdc-smartos@1.6.3, which works for as long as it is
            // an origin image used by core Triton zones.
            image_uuid: 'fd2cc906-8938-11e3-beab-4359c665ac99',
            image: {
                uuid: 'fd2cc906-8938-11e3-beab-4359c665ac99',
                files: [
                    {
                        'sha1': '97f20b32c2016782257176fb58a35e5044f05840',
                        'size': 46271847,
                        'compression': 'bzip2'
                    }
                ]
            },
            ram: 128,
            cpu_cap: 100
        };

        cnapi.createVm(SERVER, opts, function (err, task) {
            t.ifError(err);
            t.ok(task);
            TASK = task.id;
            t.end();
        });
    });

    tt.test(' get task', function (t) {
        cnapi.getTask(TASK, function onGetTask(getTaskErr, task) {
            t.ifError(getTaskErr);
            t.end();
        });
    });

    tt.test(' wait for running', function (t) {
        waitForTaskAndCheckVmState({
            taskId: TASK,
            vmUuid: testVmUuid,
            vmState: 'running',
            cnapiClient: cnapi
        }, function waitDone(waitErr) {
            t.ifError(waitErr);
            t.end();
        });
    });

    tt.test(' stop vm', function (t) {
        cnapi.stopVm(SERVER, testVmUuid, function (err, task) {
            t.ifError(err);
            t.ok(task);
            TASK = task.id;
            t.end();
        });
    });

    tt.test(' wait for stopped', function (t) {
        waitForTaskAndCheckVmState({
            taskId: TASK,
            vmUuid: testVmUuid,
            vmState: 'stopped',
            cnapiClient: cnapi
        }, function waitDone(waitErr) {
            t.ifError(waitErr);
            t.end();
        });
    });

    tt.test(' start vm', function (t) {
        cnapi.startVm(SERVER, testVmUuid, function (err, task) {
            t.ifError(err);
            t.ok(task);
            TASK = task.id;
            t.end();
        });
    });

    tt.test(' wait for running', function (t) {
        waitForTaskAndCheckVmState({
            taskId: TASK,
            vmUuid: testVmUuid,
            vmState: 'running',
            cnapiClient: cnapi
        }, function waitDone(waitErr) {
            t.ifError(waitErr);
            t.end();
        });
    });

    tt.test(' reboot vm', function (t) {
        cnapi.rebootVm(SERVER, testVmUuid, function (err, task) {
            t.ifError(err);
            t.ok(task);
            TASK = task.id;
            t.end();
        });
    });

    tt.test(' wait for running', function (t) {
        waitForTaskAndCheckVmState({
            taskId: TASK,
            vmUuid: testVmUuid,
            vmState: 'running',
            cnapiClient: cnapi
        }, function waitDone(waitErr) {
            t.ifError(waitErr);
            t.end();
        });
    });

    tt.test(' delete vm', function (t) {
        cnapi.deleteVm(SERVER, testVmUuid, function (err, task) {
            t.ifError(err);
            t.ok(task);
            TASK = task.id;
            t.end();
        });
    });

    tt.test(' wait for deleted', function (t) {
        cnapi.waitTask(TASK, {}, function onTaskDone(taskErr, task) {
            t.ifError(taskErr);
            t.end();
        });
    });

    tt.test(' command execute', function (t) {
        var script = '#!/usr/bin/bash\n\necho Hello\n';
        cnapi.commandExecute(SERVER, script, function (err) {
            t.ifError(err);
            t.end();
        });
    });

    tt.test(' command execute with env', function (t) {
        var script = '#!/usr/bin/bash\n\necho Hello\n';
        var env = { FOO: 'bar' };

        cnapi.commandExecute(SERVER, script, { env: env }, function (err) {
            t.ifError(err);
            t.end();
        });
    });

    // this test is sadly not ideal -- we'd like to check it picks only one
    // server, and it's the correct server, but that only works if the test is
    // run with a standup containing multiple CNs. With a standup of only COAL,
    // this test is ambiguous.
    tt.test(' capacity 1', function (t) {
        var headers = { 'x-request-id': uuid.v4() };

        cnapi.capacity([SERVER], { headers: headers }, function (err, body) {
            t.ifError(err);
            t.equal(typeof (body), 'object', 'body');
            t.equal(typeof (body.capacities), 'object', 'body.capacities');
            t.equal(Object.keys(body.capacities).length, 1,
                'exactly one body.capacities entry');

            var server = body.capacities[SERVER];
            t.equal(typeof (server.cpu), 'number', 'server.cpu');
            t.equal(typeof (server.ram), 'number', 'server.ram');
            t.equal(typeof (server.disk), 'number', 'server.disk');

            t.end();
        });
    });


    tt.test(' capacity 2', function (t) {
        cnapi.capacity(null, function (err, body) {
            t.ifError(err);
            t.equal(typeof (body), 'object', 'body');
            t.equal(typeof (body.capacities), 'object', 'body.capacities');
            t.ok(Object.keys(body.capacities).length >= 1,
                'at least one body.capacities');

            Object.keys(body.capacities).forEach(function (serverUuid) {
                var server = body.capacities[serverUuid];
                t.equal(typeof (server.cpu), 'number', 'server.cpu');
                t.equal(typeof (server.ram), 'number', 'server.ram');
                t.equal(typeof (server.disk), 'number', 'server.disk');
            });

            t.end();
        });
    });

    tt.test(' teardown', function (t) {
        cnapi.close();
        t.end();
    });
});
