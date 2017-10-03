/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2017, Joyent, Inc.
 */

var assert = require('assert-plus');
var bunyan = require('bunyan');
var libuuid = require('libuuid');
var restify = require('restify-clients');
var test = require('tape');

assert.ok(typeof (process.env.NAPI_IP) === 'string' &&
    process.env.NAPI_IP !== '', 'NAPI_IP env var must be a non-empty string');
assert.ok(typeof (process.env.VOLAPI_IP) === 'string' &&
    process.env.VOLAPI_IP !== '',
        'VOLAPI_IP env var must be a non-empty string');

var NAPI = require('../lib/index').NAPI;

var ADMIN_UUID = process.env.UFDS_ADMIN_UUID;
var ADMIN_FABRIC_NETWORK_UUID;
var napiClient;
var NAPI_URL = 'http://' + (process.env.NAPI_IP || '10.99.99.10');
var TEST_VOLUME_NAME = 'node-sdc-clients-test-volapi-' + libuuid.create();
var TEST_VOLUME_UUID;

var VOLAPI = require('../lib/index').VOLAPI;

var VOLAPI_IP = process.env.VOLAPI_IP;
var VOLAPI_URL = 'http://' + VOLAPI_IP;

var volApiClient;

test('volapi', function (tt) {
    var volumeResOwnerUuid;
    var volumeResUuid;

    tt.test(' setup', function (t) {
        var log = bunyan.createLogger({
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
        volApiClient.ping(function onPing(err) {
            t.ifErr(err, 'ping should succeed');
            t.end();
        });
    });

    tt.test(' get admin\'s fabric network', function (t) {
        var log = bunyan.createLogger({
            name: 'volapi_unit_test',
            stream: process.stderr,
            level: (process.env.LOG_LEVEL || 'info'),
            serializers: bunyan.stdSerializers
        });

        napiClient = new NAPI({
            url: NAPI_URL,
            retry: {
                retries: 1,
                minTimeout: 1000
            },
            log: log
        });

        napiClient.listNetworks({
            owner_uuid: ADMIN_UUID,
            fabric: true
        }, function (listNetsErr, networks) {
            t.ifError(listNetsErr,
                    'listing fabric networks for the admin user should not ' +
                        'error');
            t.ok(networks,
                'listing fabric networks for the admin user should not ' +
                    'return an empty list of networks');
            if (networks) {
                t.ok(networks.length > 0,
                    'admin user should have at least one fabric network');
                ADMIN_FABRIC_NETWORK_UUID = networks[0].uuid;
            }

            t.end();
        });
    });

    tt.test(' create volume', function (t) {
        var volumeParams = {
            name: TEST_VOLUME_NAME,
            owner_uuid: ADMIN_UUID,
            type: 'tritonnfs',
            networks: [ADMIN_FABRIC_NETWORK_UUID]
        };

        volApiClient.createVolumeAndWait(volumeParams,
            function onVolCreated(volCreateErr, createdVol) {
                var expectedVolState = 'ready';

                t.ifErr(volCreateErr, 'creating volume ' + TEST_VOLUME_NAME +
                    'should not error, got error: ' + volCreateErr);
                t.ok(createdVol, 'createVolumeAndWait should return a volume');

                if (createdVol) {
                    t.ok(createdVol.uuid,
                        'newly created volume should have a non-empty "uuid" ' +
                            'property');
                    TEST_VOLUME_UUID = createdVol.uuid;

                    t.equal(createdVol.state, expectedVolState,
                        'newly created volume\'s state should be ' +
                            expectedVolState);
                }

                t.end();
            });
    });

    tt.test(' list volumes', function (t) {
        var listVolsParams = {
            name: TEST_VOLUME_NAME
        };

        volApiClient.listVolumes(listVolsParams, function (err, objs) {
            t.ifErr(err, 'listVolumes should succeed');
            t.ok(objs, 'listVolumes should return object');
            t.ok(Array.isArray(objs), 'listVolumes object should be an array');
            t.equal(objs.length, 1, 'listing volume with params ' +
                listVolsParams + ' should output exactly one volume');

            if (objs.length > 0) {
                t.equal(objs[0].name, TEST_VOLUME_NAME,
                        'listed volume should have name ' + TEST_VOLUME_NAME);
                t.equal(objs[0].type, 'tritonnfs',
                    'listed volume should have type tritonnfs');
            }

            t.end();
        });
    });

    tt.test(' delete volumes', function (t) {
        var delVolsParams = {
            uuid: TEST_VOLUME_UUID
        };

        assert.optionalUuid(TEST_VOLUME_UUID, 'TEST_VOLUME_UUID');
        if (!TEST_VOLUME_UUID) {
            t.end();
            return;
        }

        volApiClient.deleteVolumeAndWait(delVolsParams,
            function onVolDeleted(delVolErr) {
                t.ifErr(delVolErr, 'deleting volume with params ' +
                    delVolsParams + 'should not error');
                t.end();
            });
    });

    tt.test(' list volume sizes', function (t) {
        volApiClient.listVolumeSizes(function (err, objs) {
            var expectedVolumeType = 'tritonnfs';

            t.ifError(err, 'ListVolumeSizes should succeed');
            t.ok(objs, 'should have received object from ListVolumeSizes');
            t.ok(Array.isArray(objs), 'volume sizes object should be array');
            t.ok(objs.length > 0,
                'volume sizes array should have at least 1 size object');
            t.ok(objs[0].size, 'expected value for size, got: ' + objs[0].size);
            t.equal(objs[0].type, expectedVolumeType,
                'description should be ' + expectedVolumeType + ', got: ' +
                    objs[0].type);
            t.end();
        });
    });

    tt.test(' create volume reservation', function (t) {
        volApiClient.createVolumeReservation({
            volume_name: 'foo',
            vm_uuid: libuuid.create(),
            job_uuid: libuuid.create(),
            owner_uuid: libuuid.create()
        }, function onVolResCreated(resCreatErr, res) {
            t.ifError(resCreatErr,
                'creating volume reservation should not error');

            if (!resCreatErr) {
                t.ok(typeof (res) === 'object' && res !== null,
                    'response should be an object');

                if (res) {
                    volumeResOwnerUuid = res.owner_uuid;
                    volumeResUuid = res.uuid;

                    t.ok(res.uuid,
                        'reservation object should have a uuid property');
                    t.ok(res.volume_name,
                        'reservation object should have a volume_name ' +
                            'property');
                    t.ok(res.vm_uuid,
                        'reservation object should have a vm_uuid property');
                    t.ok(res.job_uuid,
                        'reservation object should have a job_uuid property');
                    t.ok(res.owner_uuid,
                        'reservation object should have a owner_uuid property');
                    t.ok(res.create_timestamp,
                        'reservation object should have a create_timestamp ' +
                            'property');
                }
            }

            t.end();
        });
    });

    tt.test(' delete volume reservation', function (t) {
        if (volumeResOwnerUuid && volumeResUuid) {
            volApiClient.deleteVolumeReservation({
                uuid: volumeResUuid,
                owner_uuid: volumeResOwnerUuid
            }, function onVolResDeleted(resDelErr) {
                t.ifError(resDelErr, 'deleting volume reservation with UUID ' +
                    volumeResUuid + ' should not error');
                t.end();
            });
        } else {
            t.fail('Missing volume reservation uuid or volume reservation ' +
                'owner uuid');
            t.end();
        }
    });

    tt.test(' teardown', function (t) {
        napiClient.close();
        volApiClient.close();
        t.end();
    });
});
