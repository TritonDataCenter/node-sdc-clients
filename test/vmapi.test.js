/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2016 Joyent, Inc.
 */


var assert = require('assert-plus');
var ldapfilter = require('ldap-filter');
var libuuid = require('libuuid');
var bunyan = require('bunyan');
var moray = require('moray');
var test = require('tape');
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

test('vmapi', function (tt) {
    tt.test(' setup', function (t) {
        var log = bunyan.createLogger({
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
            log: log
        });

        napi = new NAPI({
            url: NAPI_URL,
            retry: {
                retries: 1,
                minTimeout: 1000
            },
            log: log
        });

        cnapi = new CNAPI({
            url: CNAPI_URL,
            retry: {
                retries: 1,
                minTimeout: 1000
            },
            log: log
        });

        t.end();
    });


    tt.test(' list networks', function (t) {
        napi.listNetworks({ name: 'admin' }, function (err, nets1) {
            t.ifError(err);
            t.ok(nets1);
            ADMIN_NETWORK = nets1[0].uuid;

            napi.listNetworks({ name: 'external' }, function (err2, nets2) {
                t.ifError(err2);
                t.ok(nets1);
                EXTERNAL_NETWORK = nets1[0].uuid;
                t.end();
            });
        });
    });

    tt.test(' cleanup leftover test vms', function (t) {
        cleanupTestVms({state: 'running'}, function cleanupDone(err) {
            t.ifError(err);
            t.end();
        });
    });

    // Create enough fake VMs so that listing them all requires paginating
    // through several pages.
    tt.test(' create test list pagination vms', function (t) {
        createTestVms(NB_PAGINATION_TEST_VMS_TO_CREATE, {state: 'running'},
            function onTestVmsCreated(err) {
                t.ifError(err);
                t.end();
            });
    });

    tt.test(' list pagination vms', function (t) {
        vmapi.listVms({
            alias: TEST_VMS_ALIAS,
            state: 'running'
        }, function (err, vms) {
            t.ifError(err);
            t.ok(vms);
            // Make sure _all_ vms are returned, not just the first page
            t.equal(vms.length, NB_PAGINATION_TEST_VMS_TO_CREATE,
                'listVms should return ' + NB_PAGINATION_TEST_VMS_TO_CREATE +
                ' VMs, but instead returned ' + vms.length);
            testPaginationVms = vms;
            t.end();
        });
    });

    tt.test(' test list pagination vms', function (t) {
        cleanupTestVms({state: 'running'}, function cleanupDone(err) {
            t.ifError(err);
            t.end();
        });
    });

    tt.test(' list vms', function (t) {
        vmapi.listVms(function (err, vms) {
            t.ifError(err);
            t.ok(vms);
            ZONE = vms[0].uuid;
            QUERY = {
                uuid: ZONE,
                owner_uuid: vms[0].owner_uuid
            };
            t.end();
        });
    });


    tt.test(' list vms by owner', function (t) {
        t.ok(CUSTOMER, 'CUSTOMER is set');
        vmapi.listVms({ owner_uuid: CUSTOMER }, function (err, vms) {
            t.ifError(err);
            t.ok(vms);
            t.end();
        });
    });


    tt.test(' count vms', function (t) {
        vmapi.countVms({ owner_uuid: CUSTOMER }, function (err, counter) {
            t.ifError(err);
            t.ok(counter);
            t.end();
        });
    });


    tt.test(' get vm', function (t) {
        vmapi.getVm(QUERY, function (err, vm) {
            t.ifError(err);
            t.ok(vm);
            t.end();
        });
    });

    tt.test(' sync vm', function (t) {
        var SYNC_QUERY = {
            uuid: ZONE,
            sync: true
        };
        vmapi.getVm(SYNC_QUERY, function (err, vm) {
            t.ifError(err);
            t.ok(vm);
            t.end();
        });
    });


    tt.test(' find headnode', function (t) {
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
            t.end();
        });
    });


    tt.test(' create zone', function (t) {
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
            t.ifError(err);
            t.ok(job);
            ZONE = job.vm_uuid;
            JOB_UUID = job.job_uuid;
            QUERY = {
                uuid: ZONE,
                owner_uuid: CUSTOMER,
                origin: 'sdc-clients-test',
                owner_uuid: CUSTOMER,
                context: CONTEXT
            };
            t.end();
        });
    });


    tt.test(' wait for running job', function (t) {
        waitForValue(vmapi.getJob, JOB_UUID, 'execution', 'succeeded',
          function (err) {
            t.ifError(err);
            t.end();
        });
    });


    tt.test(' wait for running', function (t) {
        waitForValue(vmapi.getVm, QUERY, 'state', 'running', function (err) {
            t.ifError(err);
            setTimeout(function () {
                // Try to avoid the reboot after zoneinit so we don't stop the
                // zone too early
                t.end();
            }, 10000);
        });
    });


    tt.test(' get new vm', function (t) {
        vmapi.getVm(QUERY, function (err, vm) {
            t.ifError(err);
            t.ok(vm);
            ADMIN_MAC = vm.nics[0].mac;
            t.end();
        });
    });


    var NEW_ALIAS = 'node-sdc-clients-vmapi-test-zone-newname';
    tt.test(' update zone', function (t) {
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
            t.ifError(err);
            t.ok(job);
            JOB_UUID = job.job_uuid;
            t.end();
        });
    });


    tt.test(' wait for updated job', function (t) {
        waitForValue(vmapi.getJob, JOB_UUID, 'execution', 'succeeded',
          function (err) {
            t.ifError(err);
            t.end();
        });
    });


    tt.test(' wait for updated', function (t) {
        waitForValue(vmapi.getVm, QUERY, 'alias', NEW_ALIAS, function (err) {
            t.ifError(err);
            t.end();
        });
    });


    tt.test(' add metadata', function (t) {
        var MDATA_QUERY = {
            uuid: ZONE,
            owner_uuid: CUSTOMER,
            metadata: { foo: 'bar' },
            origin: 'sdc-clients-test',
            owner_uuid: CUSTOMER,
            context: CONTEXT
        };

        vmapi.addMetadata('tags', MDATA_QUERY, function (err, job) {
            t.ifError(err);
            t.ok(job);
            JOB_UUID = job.job_uuid;
            t.end();
        });
    });


    tt.test(' wait for add metadata job', function (t) {
        waitForValue(vmapi.getJob, JOB_UUID, 'execution', 'succeeded',
          function (err) {
            t.ifError(err);
            t.end();
        });
    });


    tt.test(' wait for add metadata', function (t) {
        waitForValue(vmapi.getVm, QUERY, 'tags', ADD_METADATA, function (err) {
            t.ifError(err);
            t.end();
        });
    });


    tt.test(' list metadata', function (t) {
        vmapi.listMetadata('tags', QUERY, function (err, md) {
            t.ifError(err);
            t.ok(md.foo);
            t.end();
        });
    });


    tt.test(' get metadata', function (t) {
        vmapi.getMetadata('tags', 'foo', QUERY, function (err, md) {
            t.ifError(err);
            t.ok(md);
            t.end();
        });
    });


    tt.test(' set metadata', function (t) {
        var MDATA_QUERY = {
            uuid: ZONE,
            owner_uuid: CUSTOMER,
            metadata: { bar: 'baz' },
            origin: 'sdc-clients-test',
            owner_uuid: CUSTOMER,
            context: CONTEXT
        };

        vmapi.setMetadata('tags', MDATA_QUERY, function (err, job) {
            t.ifError(err);
            t.ok(job);
            JOB_UUID = job.job_uuid;
            t.end();
        });
    });


    tt.test(' wait for set metadata job', function (t) {
        waitForValue(vmapi.getJob, JOB_UUID, 'execution', 'succeeded',
          function (err) {
            t.ifError(err);
            t.end();
        });
    });


    tt.test(' wait for set metadata', function (t) {
        waitForValue(vmapi.getVm, QUERY, 'tags', SET_METADATA, function (err) {
            t.ifError(err);
            t.end();
        });
    });


    tt.test(' delete metadata', function (t) {
        var MDATA_QUERY = {
            uuid: ZONE,
            owner_uuid: CUSTOMER,
            origin: 'sdc-clients-test',
            owner_uuid: CUSTOMER,
            context: CONTEXT
        };

        vmapi.deleteAllMetadata('tags', MDATA_QUERY, function (err, job) {
            t.ifError(err);
            t.ok(job);
            JOB_UUID = job.job_uuid;
            t.end();
        });
    });


    tt.test(' wait for no metadata job', function (t) {
        waitForValue(vmapi.getJob, JOB_UUID, 'execution', 'succeeded',
          function (err) {
            t.ifError(err);
            t.end();
        });
    });


    tt.test(' wait for no metadata', function (t) {
        waitForValue(vmapi.getVm, QUERY, 'tags', {}, function (err) {
            t.ifError(err);
            t.end();
        });
    });


    // VM Role Tags

    tt.test(' add role tags', function (t) {
        var params = {
            uuid: ZONE,
            owner_uuid: CUSTOMER,
            role_tags: [ ROLE_TAG_ONE, ROLE_TAG_TWO ],
            origin: 'sdc-clients-test',
            owner_uuid: CUSTOMER,
            context: CONTEXT
        };

        vmapi.addRoleTags(params, function (err, role_tags) {
            t.ifError(err);
            t.ok(role_tags);
            t.equal(role_tags.length, 2);
            t.equal(role_tags[0], ROLE_TAG_ONE);
            t.end();
        });
    });


    tt.test(' list role tags', function (t) {
        var params = {
            uuid: ZONE,
            owner_uuid: CUSTOMER,
            origin: 'sdc-clients-test',
            owner_uuid: CUSTOMER
        };

        vmapi.listRoleTags(params, function (err, role_tags) {
            t.ifError(err);
            t.ok(role_tags);
            t.end();
        });
    });


    tt.test(' set role tags', function (t) {
        var params = {
            uuid: ZONE,
            owner_uuid: CUSTOMER,
            role_tags: [ ROLE_TAG_TWO ],
            origin: 'sdc-clients-test',
            owner_uuid: CUSTOMER,
            context: CONTEXT
        };

        vmapi.setRoleTags(params, function (err, role_tags) {
            t.ifError(err);
            t.ok(role_tags);
            t.equal(role_tags.length, 1);
            t.equal(role_tags[0], ROLE_TAG_TWO);
            t.end();
        });
    });


    tt.test(' delete role tag', function (t) {
        var params = {
            uuid: ZONE,
            owner_uuid: CUSTOMER,
            origin: 'sdc-clients-test',
            owner_uuid: CUSTOMER,
            context: CONTEXT
        };

        vmapi.deleteRoleTag(params, ROLE_TAG_TWO, function (err, role_tags) {
            t.ifError(err);
            t.ok(role_tags);
            t.end();
        });
    });


    tt.test(' delete role tags', function (t) {
        var params = {
            uuid: ZONE,
            owner_uuid: CUSTOMER,
            origin: 'sdc-clients-test',
            owner_uuid: CUSTOMER,
            context: CONTEXT
        };

        vmapi.deleteAllRoleTags(params, function (err, role_tags) {
            t.ifError(err);
            t.ok(role_tags);
            t.end();
        });
    });


    tt.test(' stop zone', function (t) {
        vmapi.stopVm(QUERY, function (err, job) {
            t.ifError(err);
            t.ok(job);
            JOB_UUID = job.job_uuid;
            t.end();
        });
    });


    tt.test(' wait for stopped job', function (t) {
        waitForValue(vmapi.getJob, JOB_UUID, 'execution', 'succeeded',
          function (err) {
            t.ifError(err);
            t.end();
        });
    });


    tt.test(' wait for stopped', function (t) {
        waitForValue(vmapi.getVm, QUERY, 'state', 'stopped', function (err) {
            t.ifError(err);
            t.end();
        });
    });


    tt.test(' start zone', function (t) {
        vmapi.startVm(QUERY, function (err, job) {
            t.ifError(err);
            t.ok(job);
            JOB_UUID = job.job_uuid;
            t.end();
        });
    });


    tt.test(' wait for started job', function (t) {
        waitForValue(vmapi.getJob, JOB_UUID, 'execution', 'succeeded',
          function (err) {
            t.ifError(err);
            t.end();
        });
    });


    tt.test(' wait for started', function (t) {
        waitForValue(vmapi.getVm, QUERY, 'state', 'running', function (err) {
            t.ifError(err);
            t.end();
        });
    });


    tt.test(' reboot zone', function (t) {
        vmapi.rebootVm(QUERY, function (err, job) {
            t.ifError(err);
            t.ok(job);
            JOB_UUID = job.job_uuid;
            t.end();
        });
    });


    tt.test(' wait for reboot job', function (t) {
        waitForValue(vmapi.getJob, JOB_UUID, 'execution', 'succeeded',
          function (err) {
            t.ifError(err);
            t.end();
        });
    });


    tt.test(' wait for reboot', function (t) {
        waitForValue(vmapi.getVm, QUERY, 'state', 'running', function (err) {
            t.ifError(err);
            t.end();
        });
    });


    tt.test(' add nics using networks', function (t) {
        var NICS_QUERY = {
            uuid: ZONE,
            owner_uuid: CUSTOMER,
            networks: [ { uuid: EXTERNAL_NETWORK, primary: true } ],
            origin: 'sdc-clients-test',
            owner_uuid: CUSTOMER,
            context: CONTEXT
        };

        vmapi.addNics(NICS_QUERY, function (err, job) {
            t.ifError(err);
            t.ok(job);
            JOB_UUID = job.job_uuid;
            t.end();
        });
    });


    tt.test(' wait for add nics using networks job', function (t) {
        waitForValue(vmapi.getJob, JOB_UUID, 'execution', 'succeeded',
          function (err) {
            t.ifError(err);
            t.end();
        });
    });


    tt.test(' wait for add nics using networks running', function (t) {
        waitForValue(vmapi.getVm, QUERY, 'state', 'running', function (err) {
            t.ifError(err);
            t.end();
        });
    });


    tt.test(' add nics using macs', function (t) {
        var napiQuery = {
            belongs_to_type: 'zone',
            belongs_to_uuid: ZONE,
            owner_uuid: CUSTOMER
        };

        napi.provisionNic(EXTERNAL_NETWORK, napiQuery, function (err, nic) {
            t.ifError(err);

            var vmQuery = {
                uuid: ZONE,
                owner_uuid: CUSTOMER,
                macs: [ nic.mac ],
                origin: 'sdc-clients-test',
                owner_uuid: CUSTOMER,
                context: CONTEXT
            };

            vmapi.addNics(vmQuery, function (err2, job) {
                t.ifError(err2);
                t.ok(job);
                JOB_UUID = job.job_uuid;
                t.end();
            });
        });
    });


    tt.test(' wait for add nics using macs job', function (t) {
        waitForValue(vmapi.getJob, JOB_UUID, 'execution', 'succeeded',
          function (err) {
            t.ifError(err);
            t.end();
        });
    });


    tt.test(' wait for add nics using macs running', function (t) {
        waitForValue(vmapi.getVm, QUERY, 'state', 'running', function (err) {
            t.ifError(err);
            t.end();
        });
    });


    tt.test(' get new vm nics', function (t) {
        vmapi.getVm(QUERY, function (err, vm) {
            t.ifError(err);
            t.ok(vm);
            EXTERNAL_MACS = vm.nics.slice(1, 3).map(
                function (n) { return n.mac; });
            t.end();
        });
    });


    tt.test(' update nics', function (t) {
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
            t.ifError(err);
            t.ok(job);
            JOB_UUID = job.job_uuid;
            t.end();
        });
    });


    tt.test(' wait for update nics job', function (t) {
        waitForValue(vmapi.getJob, JOB_UUID, 'execution', 'succeeded',
          function (err) {
            t.ifError(err);
            t.end();
        });
    });


    tt.test(' wait for update nics running', function (t) {
        waitForValue(vmapi.getVm, QUERY, 'state', 'running', function (err) {
            t.ifError(err);
            t.end();
        });
    });


    tt.test(' remove nics', function (t) {
        var NICS_QUERY = {
            uuid: ZONE,
            owner_uuid: CUSTOMER,
            macs: EXTERNAL_MACS,
            origin: 'sdc-clients-test',
            owner_uuid: CUSTOMER,
            context: CONTEXT
        };

        vmapi.removeNics(NICS_QUERY, function (err, job) {
            t.ifError(err);
            t.ok(job);
            JOB_UUID = job.job_uuid;
            t.end();
        });
    });


    tt.test(' wait for remove nics job', function (t) {
        waitForValue(vmapi.getJob, JOB_UUID, 'execution', 'succeeded',
          function (err) {
            t.ifError(err);
            t.end();
        });
    });


    tt.test(' wait for remove nics running', function (t) {
        waitForValue(vmapi.getVm, QUERY, 'state', 'running', function (err) {
            t.ifError(err);
            t.end();
        });
    });


    // --- Snapshots before we destroy the zone!.
    tt.test(' snapshot zone', function (t) {
        var SNAPSHOT_QUERY = {
            uuid: ZONE,
            owner_uuid: CUSTOMER,
            name: 'backup',
            origin: 'sdc-clients-test',
            owner_uuid: CUSTOMER,
            context: CONTEXT
        };

        vmapi.snapshotVm(SNAPSHOT_QUERY, function (err, job) {
            t.ifError(err);
            t.ok(job);
            JOB_UUID = job.job_uuid;
            t.end();
        });
    });


    tt.test(' wait for snapshot job', function (t) {
        waitForValue(vmapi.getJob, JOB_UUID, 'execution', 'succeeded',
          function (err) {
            t.ifError(err);
            t.end();
        });
    });


    tt.test(' wait for snapshotted', function (t) {
        waitForValue(vmapi.getVm, QUERY, 'state', 'running', function (err) {
            t.ifError(err);
            t.end();
        });
    });


    tt.test(' rollback zone', function (t) {
        var SNAPSHOT_QUERY = {
            uuid: ZONE,
            owner_uuid: CUSTOMER,
            name: 'backup',
            origin: 'sdc-clients-test',
            owner_uuid: CUSTOMER,
            context: CONTEXT
        };

        vmapi.rollbackVm(SNAPSHOT_QUERY, function (err, job) {
            t.ifError(err);
            t.ok(job);
            JOB_UUID = job.job_uuid;
            t.end();
        });
    });


    tt.test(' wait for rollback job', function (t) {
        waitForValue(vmapi.getJob, JOB_UUID, 'execution', 'succeeded',
          function (err) {
            t.ifError(err);
            t.end();
        });
    });


    tt.test(' wait for rolled back', function (t) {
        waitForValue(vmapi.getVm, QUERY, 'state', 'running', function (err) {
            t.ifError(err);
            t.end();
        });
    });


    tt.test(' delete snapshot', function (t) {
        var SNAPSHOT_QUERY = {
            uuid: ZONE,
            owner_uuid: CUSTOMER,
            name: 'backup',
            origin: 'sdc-clients-test',
            owner_uuid: CUSTOMER,
            context: CONTEXT
        };

        vmapi.deleteSnapshot(SNAPSHOT_QUERY, function (err, job) {
            t.ifError(err);
            t.ok(job);
            JOB_UUID = job.job_uuid;
            t.end();
        });
    });


    tt.test(' delete snapshot job', function (t) {
        waitForValue(vmapi.getJob, JOB_UUID, 'execution', 'succeeded',
          function (err) {
            t.ifError(err);
            t.end();
        });
    });

    // -- EOSnapshots


    tt.test(' reprovision zone', function (t) {
        var REPROVISION_QUERY = {
            uuid: ZONE,
            owner_uuid: CUSTOMER,
            image_uuid: IMAGE_UUID,
            origin: 'sdc-clients-test',
            owner_uuid: CUSTOMER,
            context: CONTEXT
        };

        vmapi.reprovisionVm(REPROVISION_QUERY, function (err, job) {
            t.ifError(err);
            t.ok(job);
            JOB_UUID = job.job_uuid;
            t.end();
        });
    });


    tt.test(' wait for reprovision job', function (t) {
        waitForValue(vmapi.getJob, JOB_UUID, 'execution', 'succeeded',
          function (err) {
            t.ifError(err);
            t.end();
        });
    });


    tt.test(' wait for reprovision running', function (t) {
        waitForValue(vmapi.getVm, QUERY, 'state', 'running', function (err) {
            t.ifError(err);
            t.end();
        });
    });


    tt.test(' destroy zone', function (t) {
        vmapi.deleteVm(QUERY, function (err, job) {
            t.ifError(err);
            t.ok(job);
            JOB_UUID = job.job_uuid;
            t.end();
        });
    });


    tt.test(' wait for destroyed job', function (t) {
        waitForValue(vmapi.getJob, JOB_UUID, 'execution', 'succeeded',
          function (err) {
            t.ifError(err);
            t.end();
        });
    });


    tt.test(' wait for destroyed', function (t) {
        waitForValue(vmapi.getVm, QUERY, 'state', 'destroyed', function (err) {
            t.ifError(err);
            t.end();
        });
    });


    tt.test(' list jobs', function (t) {
        var query = {
            vm_uuid: ZONE,
            task: 'provision'
        };

        vmapi.listJobs(query, function (err, jobs) {
            t.ifError(err);
            t.ok(jobs);
            JOB_UUID = jobs[0].uuid;
            t.end();
        });
    });


    tt.test(' get job', function (t) {
        vmapi.getJob(JOB_UUID, function (err, job) {
            t.ifError(err);
            t.ok(job);
            t.end();
        });
    });


    tt.test(' check expected jobs', function (t) {
        vmapi.listJobs({ vm_uuid: ZONE }, function (err, jobs) {
            t.ifError(err);

            var expectedJobs = [
                'destroy', 'reprovision', 'delete-snapshot', 'rollback',
                'snapshot', 'remove-nics', 'update-nics', 'add-nics',
                'add-nics', 'reboot', 'start', 'stop', 'update', 'update',
                'update', 'update', 'provision'
            ];

            for (var i = 0; i !== expectedJobs.length; i++) {
                var expected = expectedJobs[i];
                var job = jobs[i];

                t.ok(job.name.indexOf(expected) !== -1);
                t.deepEqual(job.params.context, CONTEXT);
            }

            t.end();
        });
    });


    tt.test(' teardown', function (t) {
        vmapi.close();
        cnapi.close();
        napi.close();
        t.end();
    });
});
