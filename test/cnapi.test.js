// Copyright 2012 Joyent, Inc.  All rights reserved.

var Logger = require('bunyan');
var restify = require('restify');
var libuuid = require('libuuid');
var util = require('util');
function uuid() {
    return (libuuid.create());
}

var CNAPI = require('../lib/index').CNAPI;



// --- Globals

var CNAPI_URL = 'http://' + (process.env.CNAPI_IP || '10.99.99.22');

var SERVER = null;
var ZONE = '0777a40e-8b41-11e2-be6f-7f3bf8fcea65';
var TASK = null;
var DATASET_UUID = 'fd2cc906-8938-11e3-beab-4359c665ac99';
var CUSTOMER = process.env.UFDS_ADMIN_UUID;
var cnapi;

// --- Helpers

function waitForVmState(state, callback) {
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
        cnapi.getVm(SERVER, ZONE, function (err, vm) {
            error = err;
            if (err) {
                setTimeout(check, 3000);
                return;
            }
            console.log('vm state was %s', vm.state);

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

function waitForTask(callback) {
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
            callback(new Error('timed out waiting on task'));
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
                console.warn(err.message);
                if (err.message === 'no such task found') {
                    setTimeout(check, 3000);
                    return;
                }
                clearTimeout(timeout);
                finished = true;
                callback(err);
                return;
            }

            console.log('task status %s', task.status);

            if (task.status == 'failure') {
                clearTimeout(timeout);
                finished = true;
                callback(new Error(
                    'Task failed ' + util.inspect(task, { depth: null })));
                return;
            }

            if (task.status == 'complete') {
                console.warn('ALL DONE');
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

exports.setUp = function (callback) {
    cnapi = new CNAPI({
        url: CNAPI_URL,
        retry: {
            retries: 1,
            minTimeout: 1000
        },
        log: new Logger({
            name: 'cnapi_unit_test',
            stream: process.stderr,
            level: (process.env.LOG_LEVEL || 'info'),
            serializers: Logger.stdSerializers
        }),
        agent: false
    });
    callback();
};


exports.test_list_servers = function (test) {
    cnapi.listServers({ headnode: true }, function (err, servers) {
        test.ifError(err);
        test.ok(servers);
        SERVER = servers[0].uuid;
        test.done();
    });
};


exports.test_get_server = function (test) {
    cnapi.getServer(SERVER, function (err, server) {
        test.ifError(err);
        test.ok(server);
        test.done();
    });
};


exports.test_create_vm = function (test) {
    var opts = {
        uuid: ZONE,
        owner_uuid: CUSTOMER,
        dataset_uuid:  'fd2cc906-8938-11e3-beab-4359c665ac99',
        brand: 'joyent',
        image_uuid: 'fd2cc906-8938-11e3-beab-4359c665ac99',
        image: {
            uuid: 'fd2cc906-8938-11e3-beab-4359c665ac99',
            "files": [
                {
                    "sha1": "97f20b32c2016782257176fb58a35e5044f05840",
                    "size": 46271847,
                    "compression": "bzip2"
                }
            ],
        },
        ram: 128
    };

    cnapi.createVm(SERVER, opts, function (err, task) {
        test.ifError(err);
        test.ok(task);
        TASK = task.id;
        test.done();
    });
};


exports.test_wait_for_running = function (test) {
    waitForTask(function (err) {
        test.ifError(err);

        waitForVmState('running', function (err2) {
            test.ifError(err2);
            test.done();
        });
    });
};


exports.test_get_vm = function (test) {
    setTimeout(function () {
        cnapi.getVm(SERVER, ZONE, function (err, vm) {
            test.ifError(err);
            test.ok(vm);
            test.done();
        });
    }, 10000);
};


exports.test_stop_vm = function (test) {
    cnapi.stopVm(SERVER, ZONE, function (err, task) {
        test.ifError(err);
        test.ok(task);
        TASK = task.id;
        test.done();
    });
};


exports.test_wait_for_stopped = function (test) {
    waitForTask(function (err) {
        test.ifError(err);
        waitForVmState('stopped', function (err2) {
            test.ifError(err2);

            test.done();
        });
    });
};


// Wait 3 seconds after the job completes
exports.test_start_vm = function (test) {
    setTimeout(function () {
        cnapi.startVm(SERVER, ZONE, function (err, task) {
            test.ifError(err);
            test.ok(task);
            TASK = task.id;
            test.done();
        });
    }, 6000);
};


exports.test_wait_for_started = function (test) {
    waitForTask(function (err) {
        test.ifError(err);
        waitForVmState('running', function (err2) {
            test.ifError(err2);
            test.done();
        });
    });
};


exports.test_reboot_vm = function (test) {
    setTimeout(function () {
        cnapi.rebootVm(SERVER, ZONE, function (err, task) {
            test.ifError(err);
            test.ok(task);
            TASK = task.id;
            test.done();
        });
    }, 6000);
};


exports.test_wait_for_reboot = function (test) {
    waitForTask(function (err) {
        test.ifError(err);
        waitForVmState('running', function (err2) {
            test.ifError(err2);
            test.done();
        });
    });
};


exports.test_delete_vm = function (test) {
    setTimeout(function () {
        cnapi.deleteVm(SERVER, ZONE, function (err, task) {
            test.ifError(err);
            test.ok(task);
            TASK = task.id;
            test.done();
        });
    }, 3000);
};


exports.test_wait_for_deleted = function (test) {
    waitForTask(function (err) {
        test.ifError(err);
        test.done();
    });
};


exports.test_command_execute = function (test) {
    var script = '#!/usr/bin/bash\n\necho Hello\n';

    cnapi.commandExecute(SERVER, script, function (err) {
        test.ifError(err);
        test.done();
    });
};


exports.test_command_execute_with_env = function (test) {
    var script = '#!/usr/bin/bash\n\necho Hello\n';
    var env = { FOO: 'bar' };

    cnapi.commandExecute(SERVER, script, { env: env }, function (err) {
        test.ifError(err);
        test.done();
    });
};


// this test is sadly not ideal -- we'd like to check it picks only one server,
// and it's the correct server, but that only works if the test is run with
// a standup containing multiple CNs. With a standup of only COAL, this test
// is ambiguous.
exports.test_capacity_1 = function (test) {
    var headers = { 'x-request-id': 12345 };

    cnapi.capacity([SERVER], { headers: headers }, function (err, res) {
        test.ifError(err);
        test.equal(typeof (res), 'object');
        test.equal(typeof (res.capacities), 'object');
        test.equal(typeof (res.errors), 'object');
        test.equal(Object.keys(res.capacities).length, 1);

        var server = res.capacities[SERVER];
        test.equal(typeof (server.cpu), 'number');
        test.equal(typeof (server.ram), 'number');
        test.equal(typeof (server.disk), 'number');

        test.done();
    });
};


exports.test_capacity_2 = function (test) {
    cnapi.capacity(null, function (err, res) {
        test.ifError(err);
        test.equal(typeof (res), 'object');
        test.equal(typeof (res.capacities), 'object');
        test.equal(typeof (res.errors), 'object');
        test.ok(Object.keys(res.capacities).length >= 1);

        Object.keys(res.capacities).forEach(function (serverUuid) {
            var server = res.capacities[serverUuid];
            test.equal(typeof (server.cpu), 'number');
            test.equal(typeof (server.ram), 'number');
            test.equal(typeof (server.disk), 'number');
        });

        test.done();
    });
};
