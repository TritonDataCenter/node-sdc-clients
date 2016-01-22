/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */


var assert = require('assert-plus');
var ldapfilter = require('ldap-filter');
var libuuid = require('libuuid');
var bunyan = require('bunyan');
var moray = require('moray');
var util = require('util');
var vasync = require('vasync');

var VMAPI = require('../lib/index').VMAPI;
var NAPI = require('../lib/index').NAPI;
var CNAPI = require('../lib/index').CNAPI;

// --- Globals

var VMAPI_URL = 'http://' + (process.env.VMAPI_IP || '10.99.99.27');
var NAPI_URL = 'http://' + (process.env.NAPI_IP || '10.99.99.10');
var CNAPI_URL = 'http://' + (process.env.CNAPI_IP || '10.99.99.22');

var VMAPI_VMS_BUCKET_NAME = 'vmapi_vms';

var vmapi = null;
var napi = null;
var cnapi = null;
var ZONE = null;
var QUERY = null;
var JOB_UUID = null;
var CUSTOMER = process.env.UFDS_ADMIN_UUID;
var IMAGE_UUID = 'fd2cc906-8938-11e3-beab-4359c665ac99';
var ADMIN_NETWORK = null;
var ADMIN_MAC = null;
var EXTERNAL_NETWORK = null;
var EXTERNAL_MACS = null;
var HEADNODE = null;
var ADD_METADATA = { foo: 'bar' };
var SET_METADATA = { bar: 'baz' };

var CONTEXT = {
    caller: {
        type: 'signature',
        ip: '127.0.0.68',
        keyId: '/foo@joyent.com/keys/id_rsa'
    },
    params: {
        foo: 'bar'
    }
};

// VM Role Tags
var ROLE_TAG_ONE = '17f34b3c-cf2c-11e3-9b4d-5bf35f098486';
var ROLE_TAG_TWO = '25a852d6-cf2c-11e3-a59f-77a5d70ae240';


// In seconds
var TIMEOUT = 90;

var TEST_VMS_ALIAS = 'test-vmapi-node-sdc-clients';


// These constants are used for the pagination tests.
// Create a number of VMs that is large enough to make VMAPI use the pagination
// logic when listing them. Currently, VMAPI sets the limit for the number of
// entries that can be listed in one page to 1000.
var LIST_VMS_PAGINATION_LIMIT = 1000;
var NB_PAGINATION_TEST_VMS_TO_CREATE = LIST_VMS_PAGINATION_LIMIT * 2 + 1;

var testPaginationVms;
var leftoverTestPaginationVms;

// --- Helpers

process.on('uncaughtException', function (err) {
    console.error(err.stack);
    process.exit(1);
});

function checkEqual(value, expected) {
    if ((typeof (value) === 'object') && (typeof (expected) === 'object')) {
        var exkeys = Object.keys(expected);
        for (var i = 0; i < exkeys.length; i++) {
            var key = exkeys[i];
            if (value[key] !== expected[key])
                return false;
        }

        return true;
    } else {
        return (value === expected);
    }
}

var times = 0;

function waitForValue(fn, params, prop, value, callback) {
    function check() {
        return fn.call(vmapi, params, function (err, vm) {
            if (err)
                return callback(err);

            if (checkEqual(vm[prop], value)) {
                times = 0;
                return callback(null);
            }

            times++;

            if (times == TIMEOUT) {
                throw new Error('Timeout after ' + TIMEOUT + ' seconds');
            }

            return setTimeout(check, 1000);
        });
    }

    return check();
}

function connectToMoray(callback) {
    var MORAY_CLIENT_CONFIG = {
        host: process.env.MORAY_IP || '10.99.99.17',
        port: 2020,
        log: bunyan.createLogger({
            name: 'moray',
            level: 'info',
            serializers: bunyan.stdSerializers
        })
    };
    var morayClient = moray.createClient(MORAY_CLIENT_CONFIG);

    morayClient.on('connect', function onConnect() {
        return callback(null, morayClient);
    });
}

/*
 * Creates "nbTestVms" VMs in moray. These test VMs will be created with an
 * alias of TEST_VMS_ALIAS to be able to differentiate test VMs from non-test
 * VMs when, for instance, it's time to clean them up.
 * "vmProperties" is an object that contains properties names and properties
 * values that need to be set for all created VMs.
 * "callback" is called with an error object as its first argument, which is
 * null or undefined if there was no error.
 */
function createTestVms(nbTestVms, vmProperties, callback) {
    assert.number(nbTestVms, 'nbTestVms');
    assert.object(vmProperties, 'vmProperties');
    assert.func(callback, 'callback');

    vasync.waterfall([
        connectToMoray,
        function createVms(morayClient, next) {
            var addVmsQueue = vasync.queue(function createTestVm(vmUuid, done) {
                var vmObject = {
                    uuid: vmUuid,
                    alias: TEST_VMS_ALIAS
                };

                for (var vmPropertyName in vmProperties) {
                    vmObject[vmPropertyName] = vmProperties[vmPropertyName];
                }

                morayClient.putObject(VMAPI_VMS_BUCKET_NAME, vmUuid, vmObject,
                    done);
            }, 10);

            for (var i = 0; i < nbTestVms; ++i) {
                addVmsQueue.push(libuuid.create());
            }

            addVmsQueue.close();
            addVmsQueue.on('end', function testVmsCreationDone() {
                return next(null, morayClient);
            });
        },
        function closeMorayClient(morayClient, next) {
            morayClient.close();
            return next();
        }
    ], function creationDone(err, results) {
        return callback(err);
    });
}

/*
 * Deletes VMs in moray that have the alias TEST_VMS_ALIAS and that have
 * property values that match what is passed as the "vmProperties" parameter.
 * "callback" is called with an error object as its first argument, which is
 * null or undefined if there was no error.
 */
function cleanupTestVms(vmProperties, callback) {
    assert.object(vmProperties, 'vmProperties');
    assert.func(callback, 'callback');

    vasync.waterfall([
        connectToMoray,
        function deleteRunningTestVms(morayClient, next) {
            var filters = [
                new ldapfilter.EqualityFilter({
                    attribute: 'alias',
                    value: TEST_VMS_ALIAS
                })
            ];

            for (var vmPropertyName in vmProperties) {
                filters.push(new ldapfilter.EqualityFilter({
                    attribute: vmPropertyName,
                    value: vmProperties[vmPropertyName]
                }));
            }

            var filter = new ldapfilter.AndFilter({filters: filters});

            morayClient.deleteMany(VMAPI_VMS_BUCKET_NAME, filter.toString(),
                {noLimit: true},
                function onVmsDeleted(err) {
                    return next(err, morayClient);
                });
        },
        function closeMorayClient(morayClient, next) {
            morayClient.close();
            return next();
        }
    ], function cleanupDone(err, results) {
        return callback(err);
    });
}

// --- Tests

exports.setUp = function (callback) {
    var logger = bunyan.createLogger({
            name: 'vmapi_unit_test',
            stream: process.stderr,
            level: (process.env.LOG_LEVEL || 'info'),
            serializers: bunyan.stdSerializers
    });

    vmapi = new VMAPI({
        url: VMAPI_URL,
        retry: {
            retries: 1,
            minTimeout: 1000
        },
        log: logger,
        agent: false
    });

    napi = new NAPI({
        url: NAPI_URL,
        retry: {
            retries: 1,
            minTimeout: 1000
        },
        log: logger,
        agent: false
    });

    cnapi = new CNAPI({
        url: CNAPI_URL,
        retry: {
            retries: 1,
            minTimeout: 1000
        },
        log: logger,
        agent: false
    });

    callback();
};



exports.test_list_networks = function (test) {
    napi.listNetworks({ name: 'admin' }, function (err, nets1) {
        test.ifError(err);
        test.ok(nets1);
        ADMIN_NETWORK = nets1[0].uuid;

        napi.listNetworks({ name: 'external' }, function (err2, nets2) {
            test.ifError(err2);
            test.ok(nets1);
            EXTERNAL_NETWORK = nets1[0].uuid;
            test.done();
        });
    });
};

exports.cleanup_leftover_test_vms = function (test) {
    cleanupTestVms({state: 'running'}, function cleanupDone(err) {
        test.ifError(err);
        test.done();
    });
};

// Create enough fake VMs so that listing them all requires paginating through
// several pages.
exports.create_test_list_pagination_vms = function (test) {
    createTestVms(NB_PAGINATION_TEST_VMS_TO_CREATE, {state: 'running'},
        function onTestVmsCreated(err) {
            test.ifError(err);
            test.done();
        });
};

exports.test_list_pagination_vms = function (test) {
    vmapi.listVms({
        alias: TEST_VMS_ALIAS,
        state: 'running'
    }, function (err, vms) {
        test.ifError(err);
        test.ok(vms);
        // Make sure _all_ vms are returned, not just the first page
        test.equal(vms.length, NB_PAGINATION_TEST_VMS_TO_CREATE,
            'listVms should return ' + NB_PAGINATION_TEST_VMS_TO_CREATE +
            ' VMs, but instead returned ' + vms.length);
        testPaginationVms = vms;
        test.done();
    });
};

exports.remove_test_list_pagination_vms = function (test) {
    cleanupTestVms({state: 'running'}, function cleanupDone(err) {
        test.ifError(err);
        test.done();
    });
};

exports.test_list_vms = function (test) {
    vmapi.listVms(function (err, vms) {
        test.ifError(err);
        test.ok(vms);
        ZONE = vms[0].uuid;
        QUERY = {
            uuid: ZONE,
            owner_uuid: vms[0].owner_uuid
        };
        test.done();
    });
};


exports.test_list_vms_by_owner = function (test) {
    vmapi.listVms({ owner_uuid: CUSTOMER }, function (err, vms) {
        test.ifError(err);
        test.ok(vms);
        test.done();
    });
};


exports.test_count_vms = function (test) {
    vmapi.countVms({ owner_uuid: CUSTOMER }, function (err, counter) {
        test.ifError(err);
        test.ok(counter);
        test.done();
    });
};


exports.test_get_vm = function (test) {
    vmapi.getVm(QUERY, function (err, vm) {
        test.ifError(err);
        test.ok(vm);
        test.done();
    });
};


exports.find_headnode = function (t) {
    cnapi.listServers(function (err, servers) {
        t.ifError(err);
        t.ok(servers);
        t.ok(Array.isArray(servers));
        t.ok(servers.length > 0);
        servers = servers.filter(function (server) {
            return (server.headnode);
        });
        t.ok(servers.length > 0);
        HEADNODE = servers[0];
        t.ok(HEADNODE);
        t.done();
    });
};


exports.test_create_zone = function (test) {
    var opts = {
        owner_uuid: CUSTOMER,
        image_uuid: IMAGE_UUID,
        networks: [ ADMIN_NETWORK ],
        brand: 'joyent-minimal',
        ram: 64,
        server_uuid: HEADNODE.uuid,
        origin: 'sdc-clients-test',
        owner_uuid: CUSTOMER,
        context: CONTEXT,
        alias: 'node-sdc-clients-vmapi-test-zone'
    };

    vmapi.createVm(opts, function (err, job) {
        test.ifError(err);
        test.ok(job);
        ZONE = job.vm_uuid;
        JOB_UUID = job.job_uuid;
        QUERY = {
            uuid: ZONE,
            owner_uuid: CUSTOMER,
            origin: 'sdc-clients-test',
            owner_uuid: CUSTOMER,
            context: CONTEXT
        };
        test.done();
    });
};


exports.test_wait_for_running_job = function (test) {
    waitForValue(vmapi.getJob, JOB_UUID, 'execution', 'succeeded',
      function (err) {
        test.ifError(err);
        test.done();
    });
};


exports.test_wait_for_running = function (test) {
    waitForValue(vmapi.getVm, QUERY, 'state', 'running', function (err) {
        test.ifError(err);
        setTimeout(function () {
            // Try to avoid the reboot after zoneinit so we don't stop the zone
            // too early
            test.done();
        }, 10000);
    });
};


exports.test_get_new_vm = function (test) {
    vmapi.getVm(QUERY, function (err, vm) {
        test.ifError(err);
        test.ok(vm);
        ADMIN_MAC = vm.nics[0].mac;
        test.done();
    });
};


var NEW_ALIAS = 'node-sdc-clients-vmapi-test-zone-newname';
exports.test_update_zone = function (test) {
    var UPDATE_QUERY = {
        uuid: ZONE,
        owner_uuid: CUSTOMER,
        payload: {
            alias: NEW_ALIAS
        },
        origin: 'sdc-clients-test',
        owner_uuid: CUSTOMER,
        context: CONTEXT
    };

    vmapi.updateVm(UPDATE_QUERY, function (err, job) {
        test.ifError(err);
        test.ok(job);
        JOB_UUID = job.job_uuid;
        test.done();
    });
};


exports.test_wait_for_updated_job = function (test) {
    waitForValue(vmapi.getJob, JOB_UUID, 'execution', 'succeeded',
      function (err) {
        test.ifError(err);
        test.done();
    });
};


exports.test_wait_for_updated = function (test) {
    waitForValue(vmapi.getVm, QUERY, 'alias', NEW_ALIAS, function (err) {
        test.ifError(err);
        test.done();
    });
};


exports.test_add_metadata = function (test) {
    var MDATA_QUERY = {
        uuid: ZONE,
        owner_uuid: CUSTOMER,
        metadata: { foo: 'bar' },
        origin: 'sdc-clients-test',
        owner_uuid: CUSTOMER,
        context: CONTEXT
    };

    vmapi.addMetadata('tags', MDATA_QUERY, function (err, job) {
        test.ifError(err);
        test.ok(job);
        JOB_UUID = job.job_uuid;
        test.done();
    });
};


exports.test_wait_for_add_metadata_job = function (test) {
    waitForValue(vmapi.getJob, JOB_UUID, 'execution', 'succeeded',
      function (err) {
        test.ifError(err);
        test.done();
    });
};


exports.test_wait_for_add_metadata = function (test) {
    waitForValue(vmapi.getVm, QUERY, 'tags', ADD_METADATA, function (err) {
        test.ifError(err);
        test.done();
    });
};


exports.test_list_metadata = function (test) {
    vmapi.listMetadata('tags', QUERY, function (err, md) {
        test.ifError(err);
        test.ok(md.foo);
        test.done();
    });
};


exports.test_get_metadata = function (test) {
    vmapi.getMetadata('tags', 'foo', QUERY, function (err, md) {
        test.ifError(err);
        test.ok(md);
        test.done();
    });
};


exports.test_set_metadata = function (test) {
    var MDATA_QUERY = {
        uuid: ZONE,
        owner_uuid: CUSTOMER,
        metadata: { bar: 'baz' },
        origin: 'sdc-clients-test',
        owner_uuid: CUSTOMER,
        context: CONTEXT
    };

    vmapi.setMetadata('tags', MDATA_QUERY, function (err, job) {
        test.ifError(err);
        test.ok(job);
        JOB_UUID = job.job_uuid;
        test.done();
    });
};


exports.test_wait_for_set_metadata_job = function (test) {
    waitForValue(vmapi.getJob, JOB_UUID, 'execution', 'succeeded',
      function (err) {
        test.ifError(err);
        test.done();
    });
};


exports.test_wait_for_set_metadata = function (test) {
    waitForValue(vmapi.getVm, QUERY, 'tags', SET_METADATA, function (err) {
        test.ifError(err);
        test.done();
    });
};


exports.test_delete_metadata = function (test) {
    var MDATA_QUERY = {
        uuid: ZONE,
        owner_uuid: CUSTOMER,
        origin: 'sdc-clients-test',
        owner_uuid: CUSTOMER,
        context: CONTEXT
    };

    vmapi.deleteAllMetadata('tags', MDATA_QUERY, function (err, job) {
        test.ifError(err);
        test.ok(job);
        JOB_UUID = job.job_uuid;
        test.done();
    });
};


exports.test_wait_for_no_metadata_job = function (test) {
    waitForValue(vmapi.getJob, JOB_UUID, 'execution', 'succeeded',
      function (err) {
        test.ifError(err);
        test.done();
    });
};


exports.test_wait_for_no_metadata = function (test) {
    waitForValue(vmapi.getVm, QUERY, 'tags', {}, function (err) {
        test.ifError(err);
        test.done();
    });
};


// VM Role Tags

exports.test_add_role_tags = function (test) {
    var params = {
        uuid: ZONE,
        owner_uuid: CUSTOMER,
        role_tags: [ ROLE_TAG_ONE, ROLE_TAG_TWO ],
        origin: 'sdc-clients-test',
        owner_uuid: CUSTOMER,
        context: CONTEXT
    };

    vmapi.addRoleTags(params, function (err, role_tags) {
        test.ifError(err);
        test.ok(role_tags);
        test.equal(role_tags.length, 2);
        test.equal(role_tags[0], ROLE_TAG_ONE);
        test.done();
    });
};


exports.test_list_role_tags = function (test) {
    var params = {
        uuid: ZONE,
        owner_uuid: CUSTOMER,
        origin: 'sdc-clients-test',
        owner_uuid: CUSTOMER
    };

    vmapi.listRoleTags(params, function (err, role_tags) {
        test.ifError(err);
        test.ok(role_tags);
        test.done();
    });
};


exports.test_set_role_tags = function (test) {
    var params = {
        uuid: ZONE,
        owner_uuid: CUSTOMER,
        role_tags: [ ROLE_TAG_TWO ],
        origin: 'sdc-clients-test',
        owner_uuid: CUSTOMER,
        context: CONTEXT
    };

    vmapi.setRoleTags(params, function (err, role_tags) {
        test.ifError(err);
        test.ok(role_tags);
        test.equal(role_tags.length, 1);
        test.equal(role_tags[0], ROLE_TAG_TWO);
        test.done();
    });
};


exports.test_delete_role_tag = function (test) {
    var params = {
        uuid: ZONE,
        owner_uuid: CUSTOMER,
        origin: 'sdc-clients-test',
        owner_uuid: CUSTOMER,
        context: CONTEXT
    };

    vmapi.deleteRoleTag(params, ROLE_TAG_TWO, function (err, role_tags) {
        test.ifError(err);
        test.ok(role_tags);
        test.done();
    });
};


exports.test_delete_role_tags = function (test) {
    var params = {
        uuid: ZONE,
        owner_uuid: CUSTOMER,
        origin: 'sdc-clients-test',
        owner_uuid: CUSTOMER,
        context: CONTEXT
    };

    vmapi.deleteAllRoleTags(params, function (err, role_tags) {
        test.ifError(err);
        test.ok(role_tags);
        test.done();
    });
};


// END VM Role Tags


exports.test_stop_zone = function (test) {
    vmapi.stopVm(QUERY, function (err, job) {
        test.ifError(err);
        test.ok(job);
        JOB_UUID = job.job_uuid;
        test.done();
    });
};


exports.test_wait_for_stopped_job = function (test) {
    waitForValue(vmapi.getJob, JOB_UUID, 'execution', 'succeeded',
      function (err) {
        test.ifError(err);
        test.done();
    });
};


exports.test_wait_for_stopped = function (test) {
    waitForValue(vmapi.getVm, QUERY, 'state', 'stopped', function (err) {
        test.ifError(err);
        test.done();
    });
};


exports.test_start_zone = function (test) {
    vmapi.startVm(QUERY, function (err, job) {
        test.ifError(err);
        test.ok(job);
        JOB_UUID = job.job_uuid;
        test.done();
    });
};


exports.test_wait_for_started_job = function (test) {
    waitForValue(vmapi.getJob, JOB_UUID, 'execution', 'succeeded',
      function (err) {
        test.ifError(err);
        test.done();
    });
};


exports.test_wait_for_started = function (test) {
    waitForValue(vmapi.getVm, QUERY, 'state', 'running', function (err) {
        test.ifError(err);
        test.done();
    });
};


exports.test_reboot_zone = function (test) {
    vmapi.rebootVm(QUERY, function (err, job) {
        test.ifError(err);
        test.ok(job);
        JOB_UUID = job.job_uuid;
        test.done();
    });
};


exports.test_wait_for_reboot_job = function (test) {
    waitForValue(vmapi.getJob, JOB_UUID, 'execution', 'succeeded',
      function (err) {
        test.ifError(err);
        test.done();
    });
};


exports.test_wait_for_reboot = function (test) {
    waitForValue(vmapi.getVm, QUERY, 'state', 'running', function (err) {
        test.ifError(err);
        test.done();
    });
};


exports.test_add_nics_using_networks = function (test) {
    var NICS_QUERY = {
        uuid: ZONE,
        owner_uuid: CUSTOMER,
        networks: [ { uuid: EXTERNAL_NETWORK, primary: true } ],
        origin: 'sdc-clients-test',
        owner_uuid: CUSTOMER,
        context: CONTEXT
    };

    vmapi.addNics(NICS_QUERY, function (err, job) {
        test.ifError(err);
        test.ok(job);
        JOB_UUID = job.job_uuid;
        test.done();
    });
};


exports.test_wait_for_add_nics_using_networks_job = function (test) {
    waitForValue(vmapi.getJob, JOB_UUID, 'execution', 'succeeded',
      function (err) {
        test.ifError(err);
        test.done();
    });
};


exports.test_wait_for_add_nics_using_networks_running = function (test) {
    waitForValue(vmapi.getVm, QUERY, 'state', 'running', function (err) {
        test.ifError(err);
        test.done();
    });
};


exports.test_add_nics_using_macs = function (test) {
    var napiQuery = {
        belongs_to_type: 'zone',
        belongs_to_uuid: ZONE,
        owner_uuid: CUSTOMER
    };

    napi.provisionNic(EXTERNAL_NETWORK, napiQuery, function (err, nic) {
        test.ifError(err);

        var vmQuery = {
            uuid: ZONE,
            owner_uuid: CUSTOMER,
            macs: [ nic.mac ],
            origin: 'sdc-clients-test',
            owner_uuid: CUSTOMER,
            context: CONTEXT
        };

        vmapi.addNics(vmQuery, function (err2, job) {
            test.ifError(err2);
            test.ok(job);
            JOB_UUID = job.job_uuid;
            test.done();
        });
    });
};


exports.test_wait_for_add_nics_using_macs_job = function (test) {
    waitForValue(vmapi.getJob, JOB_UUID, 'execution', 'succeeded',
      function (err) {
        test.ifError(err);
        test.done();
    });
};


exports.test_wait_for_add_nics_using_macs_running = function (test) {
    waitForValue(vmapi.getVm, QUERY, 'state', 'running', function (err) {
        test.ifError(err);
        test.done();
    });
};


exports.test_get_new_vm_nics = function (test) {
    vmapi.getVm(QUERY, function (err, vm) {
        test.ifError(err);
        test.ok(vm);
        EXTERNAL_MACS = vm.nics.slice(1, 3).map(function (n) { return n.mac; });
        test.done();
    });
};


exports.test_update_nics = function (test) {
    var NICS_QUERY = {
        uuid: ZONE,
        owner_uuid: CUSTOMER,
        nics: [
            {
                mac: ADMIN_MAC,
                primary: true
            }, {
                mac: EXTERNAL_MACS[0]
            }
        ],
        origin: 'sdc-clients-test',
        owner_uuid: CUSTOMER,
        context: CONTEXT
    };

    vmapi.updateNics(NICS_QUERY, function (err, job) {
        test.ifError(err);
        test.ok(job);
        JOB_UUID = job.job_uuid;
        test.done();
    });
};


exports.test_wait_for_update_nics_job = function (test) {
    waitForValue(vmapi.getJob, JOB_UUID, 'execution', 'succeeded',
      function (err) {
        test.ifError(err);
        test.done();
    });
};


exports.test_wait_for_update_nics_running = function (test) {
    waitForValue(vmapi.getVm, QUERY, 'state', 'running', function (err) {
        test.ifError(err);
        test.done();
    });
};


exports.test_remove_nics = function (test) {
    var NICS_QUERY = {
        uuid: ZONE,
        owner_uuid: CUSTOMER,
        macs: EXTERNAL_MACS,
        origin: 'sdc-clients-test',
        owner_uuid: CUSTOMER,
        context: CONTEXT
    };

    vmapi.removeNics(NICS_QUERY, function (err, job) {
        test.ifError(err);
        test.ok(job);
        JOB_UUID = job.job_uuid;
        test.done();
    });
};


exports.test_wait_for_remove_nics_job = function (test) {
    waitForValue(vmapi.getJob, JOB_UUID, 'execution', 'succeeded',
      function (err) {
        test.ifError(err);
        test.done();
    });
};


exports.test_wait_for_remove_nics_running = function (test) {
    waitForValue(vmapi.getVm, QUERY, 'state', 'running', function (err) {
        test.ifError(err);
        test.done();
    });
};


// --- Snapshots before we destroy the zone!.
exports.test_snapshot_zone = function (test) {
    var SNAPSHOT_QUERY = {
        uuid: ZONE,
        owner_uuid: CUSTOMER,
        name: 'backup',
        origin: 'sdc-clients-test',
        owner_uuid: CUSTOMER,
        context: CONTEXT
    };

    vmapi.snapshotVm(SNAPSHOT_QUERY, function (err, job) {
        test.ifError(err);
        test.ok(job);
        JOB_UUID = job.job_uuid;
        test.done();
    });
};


exports.test_wait_for_snapshot_job = function (test) {
    waitForValue(vmapi.getJob, JOB_UUID, 'execution', 'succeeded',
      function (err) {
        test.ifError(err);
        test.done();
    });
};


exports.test_wait_for_snapshotted = function (test) {
    waitForValue(vmapi.getVm, QUERY, 'state', 'running', function (err) {
        test.ifError(err);
        test.done();
    });
};


exports.test_rollback_zone = function (test) {
    var SNAPSHOT_QUERY = {
        uuid: ZONE,
        owner_uuid: CUSTOMER,
        name: 'backup',
        origin: 'sdc-clients-test',
        owner_uuid: CUSTOMER,
        context: CONTEXT
    };

    vmapi.rollbackVm(SNAPSHOT_QUERY, function (err, job) {
        test.ifError(err);
        test.ok(job);
        JOB_UUID = job.job_uuid;
        test.done();
    });
};


exports.test_wait_for_rollback_job = function (test) {
    waitForValue(vmapi.getJob, JOB_UUID, 'execution', 'succeeded',
      function (err) {
        test.ifError(err);
        test.done();
    });
};


exports.test_wait_for_rolled_back = function (test) {
    waitForValue(vmapi.getVm, QUERY, 'state', 'running', function (err) {
        test.ifError(err);
        test.done();
    });
};


exports.test_delete_snapshot = function (test) {
    var SNAPSHOT_QUERY = {
        uuid: ZONE,
        owner_uuid: CUSTOMER,
        name: 'backup',
        origin: 'sdc-clients-test',
        owner_uuid: CUSTOMER,
        context: CONTEXT
    };

    vmapi.deleteSnapshot(SNAPSHOT_QUERY, function (err, job) {
        test.ifError(err);
        test.ok(job);
        JOB_UUID = job.job_uuid;
        test.done();
    });
};


exports.wait_delete_snapshot_job = function (test) {
    waitForValue(vmapi.getJob, JOB_UUID, 'execution', 'succeeded',
      function (err) {
        test.ifError(err);
        test.done();
    });
};

// -- EOSnapshots


exports.test_reprovision_zone = function (test) {
    var REPROVISION_QUERY = {
        uuid: ZONE,
        owner_uuid: CUSTOMER,
        image_uuid: IMAGE_UUID,
        origin: 'sdc-clients-test',
        owner_uuid: CUSTOMER,
        context: CONTEXT
    };

    vmapi.reprovisionVm(REPROVISION_QUERY, function (err, job) {
        test.ifError(err);
        test.ok(job);
        JOB_UUID = job.job_uuid;
        test.done();
    });
};


exports.test_wait_for_reprovision_job = function (test) {
    waitForValue(vmapi.getJob, JOB_UUID, 'execution', 'succeeded',
      function (err) {
        test.ifError(err);
        test.done();
    });
};


exports.test_wait_for_reprovision_running = function (test) {
    waitForValue(vmapi.getVm, QUERY, 'state', 'running', function (err) {
        test.ifError(err);
        test.done();
    });
};


exports.test_destroy_zone = function (test) {
    vmapi.deleteVm(QUERY, function (err, job) {
        test.ifError(err);
        test.ok(job);
        JOB_UUID = job.job_uuid;
        test.done();
    });
};


exports.test_wait_for_destroyed_job = function (test) {
    waitForValue(vmapi.getJob, JOB_UUID, 'execution', 'succeeded',
      function (err) {
        test.ifError(err);
        test.done();
    });
};


exports.test_wait_for_destroyed = function (test) {
    waitForValue(vmapi.getVm, QUERY, 'state', 'destroyed', function (err) {
        test.ifError(err);
        test.done();
    });
};


exports.test_list_jobs = function (test) {
    var query = {
        vm_uuid: ZONE,
        task: 'provision'
    };

    vmapi.listJobs(query, function (err, jobs) {
        test.ifError(err);
        test.ok(jobs);
        JOB_UUID = jobs[0].uuid;
        test.done();
    });
};


exports.test_get_job = function (test) {
    vmapi.getJob(JOB_UUID, function (err, job) {
        test.ifError(err);
        test.ok(job);
        test.done();
    });
};


exports.test_check_expected_jobs = function (test) {
    vmapi.listJobs({ vm_uuid: ZONE }, function (err, jobs) {
        test.ifError(err);

        var expectedJobs = [
            'destroy', 'reprovision', 'delete-snapshot', 'rollback', 'snapshot',
            'remove-nics', 'update-nics', 'add-nics', 'add-nics', 'reboot',
            'start', 'stop', 'update', 'update', 'update', 'update', 'provision'
        ];

        for (var i = 0; i !== expectedJobs.length; i++) {
            var expected = expectedJobs[i];
            var job = jobs[i];

            test.ok(job.name.indexOf(expected) !== -1);
            test.deepEqual(job.params.context, CONTEXT);
        }

        test.done();
    });
};


exports.tearDown = function (callback) {
    vmapi.close();
    callback();
};
