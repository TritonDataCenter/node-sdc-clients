/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

var Logger = require('bunyan'),
    restify = require('restify'),
    NAPI = require('../lib/index').NAPI;

var libuuid = require('libuuid');
function uuid() {
    return (libuuid.create());
}

// --- Helper
function pseudoRandomMac() {
    var mac = [0, 0x07, 0xe9];

    function randomInt(minVal, maxVal) {
        var diff = maxVal - minVal + 1.0,
            val = Math.random() * diff;
        val += minVal;
        return Math.round(val);
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



// --- Globals

var NAPI_URL = 'http://' + (process.env.NAPI_IP || '10.99.99.10');

var NETWORKS, ADMIN, EXTERNAL, napi, MAC_1, MAC_2, NIC_UUID, IP;

// --- Tests

exports.setUp = function (callback) {
    var logger = new Logger({
            name: 'vmapi_unit_test',
            stream: process.stderr,
            level: (process.env.LOG_LEVEL || 'info'),
            serializers: Logger.stdSerializers
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

    callback();
};


/*
 * Tests listing all networks. As a side-effect, assigns ADMIN and EXTERNAL
 * if they exist. ADMIN is the only network that can be assumed to exist on
 * a simple installation, and is so is used as the exemplar in several other
 * tests.
 */
exports.test_list_networks = function (test) {
    napi.listNetworks({}, function (err, networks) {
        test.ifError(err, 'listNetworks does not error');
        test.ok(networks, 'listNetworks returns results');
        test.ok(networks.length > 0, 'listNetworks non-empty');
        NETWORKS = networks;
        NETWORKS.forEach(function (net) {
            test.ok(net.name, 'NAPI GET /networks name OK');
            if (net.name === 'admin') {
                ADMIN = net;
            } else if (net.name === 'external') {
                EXTERNAL = net;
            }
        });
        test.done();
    });
};


exports.test_get_network_by_uuid = function (test) {
    napi.getNetwork(ADMIN.uuid, function (err, network) {
        test.ifError(err, 'getNetwork does not error');
        test.ok(network, 'getNetwork returns a result');
        test.ok(network.uuid, 'getNetwork result lacks a uuid');
        if (network.uuid) {
            test.strictEqual(network.uuid, ADMIN.uuid);
        }
        test.done();
    });
};


/*
 * Using a random uuid, attempts to get a network (ADMIN) that specifies
 * the `provisionable_by` property, which should return an error.
 */
exports.test_get_unprovisionable_network = function (test) {
    var params = { provisionable_by: uuid() };

    napi.getNetwork(ADMIN.uuid, { params: params },
                    function (err, network) {
        test.ok(err, 'getNetwork should err with invalid provisionable_by');
        if (err) {
            test.strictEqual(err.message, 'owner cannot provision on network',
                'err message as expected');
        }
        test.done();
    });
};


exports.test_ping = function (test) {
    napi.ping(function (err) {
        test.ifError(err);
        test.done();
    });
};


exports.test_list_network_ips = function (test) {
    napi.listIPs(ADMIN.uuid, {}, function (err, ips) {
        test.ifError(err);
        test.ok(ips);
        test.ok(Array.isArray(ips));
        test.ok(ips.length > 0);
        if (ips.length > 0) {
            IP = ips[0];
            test.ok(IP.ip);
            test.ok(IP.owner_uuid);
            test.ok(IP.belongs_to_uuid);
            test.ok(IP.belongs_to_type);
        }
        test.done();
    });
};


exports.test_get_ip = function (test) {
    napi.getIP(ADMIN.uuid, IP.ip, function (err, ip) {
        test.ifError(err);
        test.ok(ip);
        test.deepEqual(IP, ip);
        test.done();
    });
};


exports.test_list_nics = function (test) {
    napi.listNics({}, function (err, nics) {
        test.ifError(err);
        test.ok(nics);
        test.ok(Array.isArray(nics));
        test.ok(nics.length > 0);
        if (nics.length > 0) {
            var aNic = nics[0];
            test.ok(aNic.owner_uuid);
            test.ok(aNic.belongs_to_uuid);
            test.ok(aNic.belongs_to_type);
        }
        test.done();
    });
};


exports.test_provision_nic = function (test) {
    NIC_UUID = uuid();
    napi.provisionNic(ADMIN.uuid, {
        owner_uuid: process.env.UFDS_ADMIN_UUID,
        belongs_to_uuid: NIC_UUID,
        belongs_to_type: 'zone'
    }, function (err, nic) {
        test.ifError(err);
        test.ok(nic);
        if (nic) {
            test.ok(nic.mac);
            MAC_1 = nic.mac;
            test.equal(nic.owner_uuid, process.env.UFDS_ADMIN_UUID);
            test.equal(nic.belongs_to_uuid, NIC_UUID);
            test.equal(nic.belongs_to_type, 'zone');
        }
        test.done();
    });
};


exports.test_create_nic = function (test) {
    var sUUID = uuid(),
        mac = pseudoRandomMac();
    napi.createNic(mac, {
        owner_uuid: process.env.UFDS_ADMIN_UUID,
        belongs_to_uuid: sUUID,
        belongs_to_type: 'server'
    }, function (err, nic) {
        test.ifError(err);
        test.ok(nic);
        if (nic) {
            test.ok(nic.mac);
            MAC_2 = nic.mac;
            test.equal(nic.owner_uuid, process.env.UFDS_ADMIN_UUID);
            test.equal(nic.belongs_to_uuid, sUUID);
            test.equal(nic.belongs_to_type, 'server');
        }
        test.done();
    });
};


exports.test_get_nic = function (test) {
    napi.getNic(MAC_1, function (err, nic) {
        test.ifError(err);
        test.ok(nic);
        test.done();
    });
};


exports.test_update_nic = function (test) {
    napi.updateNic(MAC_2, {
        belongs_to_uuid: NIC_UUID,
        belongs_to_type: 'zone'
    }, function (err, nic) {
        test.ifError(err);
        test.ok(nic);
        test.done();
    });
};


exports.test_get_nics_by_owner = function (test) {
    napi.getNics(NIC_UUID, function (err, nics) {
        test.ifError(err);
        test.ok(nics);
        test.ok(Array.isArray(nics));
        test.ok(nics.length > 0);
        test.done();
    });
};


exports.test_delete_nic = function (test) {
    napi.deleteNic(MAC_1, function (err, nic) {
        test.ifError(err);
        test.done();
    });
};


exports.test_delete_nic_2 = function (test) {
    napi.deleteNic(MAC_2, function (err, nic) {
        test.ifError(err);
        test.done();
    });
};


exports.tearDown = function (callback) {
    napi.close();
    callback();
};
