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

var CNAPI = require('../lib/index').CNAPI;



// --- Globals

var CNAPI_URL = 'http://' + (process.env.CNAPI_IP || '10.99.99.22');

var SERVER = null;
var testVmUuid = libuuid.create();
var testVmAlias = 'nodesdcclientstest-cnapi-' + testVmUuid.split('-')[0];
var TASK = null;
var CUSTOMER = process.env.UFDS_ADMIN_UUID;


// --- Helpers

function waitForVmState(t, cnapi, state, callback) {
    var finished = false;
    var error;

    var timeout = setTimeout(function () {
        if (finished) {
            return;
        }

        if (error) {
            callback(error);
            return;
        } else {
            callback(new Error('timed out waiting on vm state'));
            return;
        }
    }, 30000);

    function check() {
        cnapi.getVm(SERVER, testVmUuid, function (err, vm) {
            error = err;
            if (err) {
                setTimeout(check, 3000);
                return;
            }
            t.comment('test VM ' + testVmUuid + ' state: ' + vm.state);

            if (vm.state === state) {
                clearTimeout(timeout);
                callback();
                return;
            }

            setTimeout(check, 3000);
        });
    }

    check();
}

function waitForTask(t, cnapi, callback) {
    var finished = false;
    var error;

    var tasktimeout;

    var timeout = setTimeout(function () {
        clearTimeout(tasktimeout);
        if (finished) {
            return;
        }

        if (error) {
            callback(error);
            return;
        } else {
            callback(new Error('timed out waiting on task at '
                + (new Date()).toISOString()));
            return;
        }
    }, 50000);

    function check() {
        cnapi.getTask(TASK, function (err, task) {
            error = err;
            if (finished) {
                return;
            }
            if (err) {
                t.comment('CNAPI getTask err: ' + err.message);
                if (err.message === 'no such task found') {
                    setTimeout(check, 3000);
                    return;
                }
                clearTimeout(timeout);
                finished = true;
                callback(err);
                return;
            }

            t.comment('[' + (new Date()).toISOString() + '] CNAPI task '
                + TASK + ' status: ' + task.status);

            if (task.status == 'failure') {
                clearTimeout(timeout);
                finished = true;
                callback(new Error(
                    'Task failed ' + util.inspect(task, { depth: null })));
                return;
            }

            if (task.status == 'complete') {
                clearTimeout(timeout);
                finished = true;
                callback(null);
                return;
            }

            tasktimeout = setTimeout(check, 3000);
            return;
        });
    }

    check();
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
                name: 'cnapi_unit_test',
                stream: process.stderr,
                level: (process.env.LOG_LEVEL || 'info'),
                serializers: bunyan.stdSerializers
            })
        });
        t.end();
    });

    tt.test(' list servers', function (t) {
        cnapi.listServers({ headnode: true }, function (err, servers) {
            t.ifError(err);
            t.ok(servers);
            SERVER = servers[0].uuid;
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
            ram: 128
        };

        cnapi.createVm(SERVER, opts, function (err, task) {
            t.ifError(err);
            t.ok(task);
            TASK = task.id;
            t.end();
        });
    });

    tt.test(' wait for running', function (t) {
        waitForTask(t, cnapi, function (err) {
            t.ifError(err);
            waitForVmState(t, cnapi, 'running', function (stateErr) {
                t.ifError(stateErr);
                t.end();
            });
        });
    });

    tt.test(' get vm', function (t) {
        setTimeout(function () {
            cnapi.getVm(SERVER, testVmUuid, function (err, vm) {
                t.ifError(err);
                t.ok(vm);
                t.end();
            });
        }, 10000);
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
        waitForTask(t, cnapi, function (err) {
            t.ifError(err);
            waitForVmState(t, cnapi, 'stopped', function (err2) {
                t.ifError(err2);
                t.end();
            });
        });
    });

    tt.test(' start vm', function (t) {
        setTimeout(function () {
            cnapi.startVm(SERVER, testVmUuid, function (err, task) {
                t.ifError(err);
                t.ok(task);
                TASK = task.id;
                t.end();
            });
        }, 6000);
    });

    tt.test(' wait for started', function (t) {
        waitForTask(t, cnapi, function (err) {
            t.ifError(err);
            waitForVmState(t, cnapi, 'running', function (err2) {
                t.ifError(err2);
                t.end();
            });
        });
    });

    tt.test(' reboot vm', function (t) {
        setTimeout(function () {
            cnapi.rebootVm(SERVER, testVmUuid, function (err, task) {
                t.ifError(err);
                t.ok(task);
                TASK = task.id;
                t.end();
            });
        }, 6000);
    });

    tt.test(' wait for reboot', function (t) {
        waitForTask(t, cnapi, function (err) {
            t.ifError(err);
            waitForVmState(t, cnapi, 'running', function (err2) {
                t.ifError(err2);
                t.end();
            });
        });
    });

    tt.test(' delete vm', function (t) {
        setTimeout(function () {
            cnapi.deleteVm(SERVER, testVmUuid, function (err, task) {
                t.ifError(err);
                t.ok(task);
                TASK = task.id;
                t.end();
            });
        }, 3000);
    });

    tt.test(' wait for deleted', function (t) {
        waitForTask(t, cnapi, function (err) {
            t.ifError(err);
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
        var headers = { 'x-request-id': 12345 };

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