/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2017 Joyent, Inc.
 */

var bunyan = require('bunyan');
var test = require('tape');
var uuid = require('uuid');

var NAPI = require('../lib/index').NAPI;


// --- Globals

var NAPI_URL = 'http://' + (process.env.NAPI_IP || '10.99.99.10');

var NETWORKS, ADMIN, EXTERNAL, napi, MAC_1, MAC_2, NIC_UUID, IP;


// --- Helper

function pseudoRandomMac() {
    var mac = [0, 0x07, 0xe9];

    function randomInt(minVal, maxVal) {
        var diff = maxVal - minVal + 1.0,
            val = Math.random() * diff;
        val += minVal;
        return Math.floor(val);
    }
    mac[3] = randomInt(0x00, 0x7f);
    mac[4] = randomInt(0x00, 0xff);
    mac[5] = randomInt(0x00, 0xff);

    return mac.map(function (part) {
        part = part.toString(16);
        if (part.length < 2) {
            part = '0' + part;
        }
        return part;
    }).join(':');
}


// --- Tests

test('napi', function (tt) {
    tt.test(' setup', function (t) {
        var log = bunyan.createLogger({
            name: 'vmapi_unit_test',
            stream: process.stderr,
            level: (process.env.LOG_LEVEL || 'info'),
            serializers: bunyan.stdSerializers
        });

        napi = new NAPI({
            url: NAPI_URL,
            retry: {
                retries: 1,
                minTimeout: 1000
            },
            log: log
        });

        t.end();
    });


    /*
     * Tests listing all networks. As a side-effect, assigns ADMIN and EXTERNAL
     * if they exist. ADMIN is the only network that can be assumed to exist on
     * a simple installation, and is so is used as the exemplar in several other
     * tests.
     */
    tt.test(' list networks', function (t) {
        napi.listNetworks({}, function (err, networks) {
            t.ifError(err, 'listNetworks does not error');
            t.ok(networks, 'listNetworks returns results');
            t.ok(networks.length > 0, 'listNetworks non-empty');
            NETWORKS = networks;
            NETWORKS.forEach(function (net) {
                t.ok(net.name, 'NAPI GET /networks name OK');
                if (net.name === 'admin') {
                    ADMIN = net;
                } else if (net.name === 'external') {
                    EXTERNAL = net;
                }
            });
            t.end();
        });
    });


    tt.test(' get network by uuid', function (t) {
        napi.getNetwork(ADMIN.uuid, function (err, network) {
            t.ifError(err, 'getNetwork does not error');
            t.ok(network, 'getNetwork returns a result');
            t.ok(network.uuid, 'getNetwork result lacks a uuid');
            if (network.uuid) {
                t.strictEqual(network.uuid, ADMIN.uuid);
            }
            t.end();
        });
    });


    /*
     * Using a random uuid, attempts to get a network (ADMIN) that specifies
     * the `provisionable_by` property, which should return an error.
     */
    tt.test(' get unprovisionable network', function (t) {
        var params = { provisionable_by: uuid.v4() };

        napi.getNetwork(ADMIN.uuid, { params: params },
                        function (err, network) {
            t.ok(err, 'getNetwork should err with invalid provisionable_by');
            if (err) {
                t.strictEqual(err.message, 'owner cannot provision on network',
                    'err message as expected');
            }
            t.end();
        });
    });


    tt.test(' ping', function (t) {
        napi.ping(function (err) {
            t.ifError(err);
            t.end();
        });
    });


    tt.test(' list network ips', function (t) {
        napi.listIPs(ADMIN.uuid, {}, function (err, ips) {
            t.ifError(err);
            t.ok(ips);
            t.ok(Array.isArray(ips));
            t.ok(ips.length > 0);
            if (ips.length > 0) {
                IP = ips[0];
                t.ok(IP.ip);
                t.ok(IP.owner_uuid);
                t.ok(IP.belongs_to_uuid);
                t.ok(IP.belongs_to_type);
            }
            t.end();
        });
    });


    tt.test(' get ip', function (t) {
        napi.getIP(ADMIN.uuid, IP.ip, function (err, ip) {
            t.ifError(err);
            t.ok(ip);
            t.deepEqual(IP, ip);
            t.end();
        });
    });


    tt.test(' list nics', function (t) {
        napi.listNics({}, function (err, nics) {
            t.ifError(err);
            t.ok(nics);
            t.ok(Array.isArray(nics));
            t.ok(nics.length > 0);
            if (nics.length > 0) {
                var aNic = nics[0];
                t.ok(aNic.owner_uuid);
                t.ok(aNic.belongs_to_uuid);
                t.ok(aNic.belongs_to_type);
            }
            t.end();
        });
    });


    tt.test(' provision nic', function (t) {
        NIC_UUID = uuid.v4();
        napi.provisionNic(ADMIN.uuid, {
            owner_uuid: process.env.UFDS_ADMIN_UUID,
            belongs_to_uuid: NIC_UUID,
            belongs_to_type: 'zone'
        }, function (err, nic) {
            t.ifError(err);
            t.ok(nic);
            if (nic) {
                t.ok(nic.mac);
                MAC_1 = nic.mac;
                t.equal(nic.owner_uuid, process.env.UFDS_ADMIN_UUID);
                t.equal(nic.belongs_to_uuid, NIC_UUID);
                t.equal(nic.belongs_to_type, 'zone');
            }
            t.end();
        });
    });


    tt.test(' create new', function (t) {
        var sUUID = uuid.v4(),
            mac = pseudoRandomMac();
        napi.createNic(mac, {
            owner_uuid: process.env.UFDS_ADMIN_UUID,
            belongs_to_uuid: sUUID,
            belongs_to_type: 'server'
        }, function (err, nic) {
            t.ifError(err);
            t.ok(nic);
            if (nic) {
                t.ok(nic.mac);
                MAC_2 = nic.mac;
                t.equal(nic.owner_uuid, process.env.UFDS_ADMIN_UUID);
                t.equal(nic.belongs_to_uuid, sUUID);
                t.equal(nic.belongs_to_type, 'server');
            }
            t.end();
        });
    });


    tt.test(' get nic', function (t) {
        napi.getNic(MAC_1, function (err, nic) {
            t.ifError(err);
            t.ok(nic);
            t.end();
        });
    });


    tt.test(' update nic', function (t) {
        napi.updateNic(MAC_2, {
            belongs_to_uuid: NIC_UUID,
            belongs_to_type: 'zone'
        }, function (err, nic) {
            t.ifError(err);
            t.ok(nic);
            t.end();
        });
    });


    tt.test(' get nics by owner', function (t) {
        napi.getNics(NIC_UUID, function (err, nics) {
            t.ifError(err);
            t.ok(nics);
            t.ok(Array.isArray(nics));
            t.ok(nics.length > 0);
            t.end();
        });
    });


    tt.test(' delete nic', function (t) {
        napi.deleteNic(MAC_1, function (err, nic) {
            t.ifError(err);
            t.end();
        });
    });


    tt.test(' delete nic 2', function (t) {
        napi.deleteNic(MAC_2, function (err, nic) {
            t.ifError(err);
            t.end();
        });
    });


    tt.test(' teardown', function (t) {
        napi.close();
        t.end();
    });
});