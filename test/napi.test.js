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
    util = require('util'),
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



exports.test_list_networks = function (test) {
    napi.listNetworks({}, function (err, networks) {
        test.ifError(err);
        test.ok(networks);
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


exports.test_get_network = function (test) {
    napi.getNetwork(NETWORKS[0].uuid, function (err, network) {
        test.ifError(err);
        test.ok(network);
        test.equal(network.uuid, NETWORKS[0].uuid);
        test.done();
    });
};


// should fail since network doesn't belong to given owner
exports.test_get_network_with_params = function (test) {
    var params = { provisionable_by: uuid() };

    napi.getNetwork(NETWORKS[0].uuid, { params: params },
                    function (err, network) {
        test.ok(err);
        test.equal(err.message, 'owner cannot provision on network');
        test.done();
    });
};


exports.test_ping = function (t) {
    napi.ping(function (err) {
        t.ifError(err);
        t.done();
    });
};


exports.test_list_network_ips = function (t) {
    napi.listIPs(ADMIN.uuid, {}, function (err, ips) {
        t.ifError(err);
        t.ok(ips);
        t.ok(util.isArray(ips));
        IP = ips[0];
        t.ok(IP.ip);
        t.ok(IP.owner_uuid);
        t.ok(IP.belongs_to_uuid);
        t.ok(IP.belongs_to_type);
        t.done();
    });
};


exports.test_get_ip = function (t) {
    napi.getIP(ADMIN.uuid, IP.ip, function (err, ip) {
        t.ifError(err);
        t.ok(ip);
        t.deepEqual(IP, ip);
        t.done();
    });
};


exports.test_list_nics = function (t) {
    napi.listNics({}, function (err, nics) {
        t.ifError(err);
        t.ok(nics);
        t.ok(util.isArray(nics));
        var aNic = nics[0];
        t.ok(aNic.owner_uuid);
        t.ok(aNic.belongs_to_uuid);
        t.ok(aNic.belongs_to_type);
        t.done();
    });
};


exports.test_provision_nic = function (t) {
    NIC_UUID = uuid();
    napi.provisionNic(ADMIN.uuid, {
        owner_uuid: process.env.UFDS_ADMIN_UUID,
        belongs_to_uuid: NIC_UUID,
        belongs_to_type: 'zone'
    }, function (err, nic) {
        t.ifError(err);
        t.ok(nic);
        t.ok(nic.mac);
        MAC_1 = nic.mac;
        t.equal(nic.owner_uuid, process.env.UFDS_ADMIN_UUID);
        t.equal(nic.belongs_to_uuid, NIC_UUID);
        t.equal(nic.belongs_to_type, 'zone');
        t.done();
    });
};


exports.test_create_nic = function (t) {
    var sUUID = uuid(),
        mac = pseudoRandomMac();
    napi.createNic(mac, {
        owner_uuid: process.env.UFDS_ADMIN_UUID,
        belongs_to_uuid: sUUID,
        belongs_to_type: 'server'
    }, function (err, nic) {
        t.ifError(err);
        t.ok(nic);
        t.ok(nic.mac);
        MAC_2 = nic.mac;
        t.equal(nic.owner_uuid, process.env.UFDS_ADMIN_UUID);
        t.equal(nic.belongs_to_uuid, sUUID);
        t.equal(nic.belongs_to_type, 'server');
        t.done();
    });
};


exports.test_get_nic = function (t) {
    napi.getNic(MAC_1, function (err, nic) {
        t.ifError(err);
        t.ok(nic);
        t.done();
    });
};


exports.test_update_nic = function (t) {
    napi.updateNic(MAC_2, {
        belongs_to_uuid: NIC_UUID,
        belongs_to_type: 'zone'
    }, function (err, nic) {
        t.ifError(err);
        t.ok(nic);
        t.done();
    });
};


exports.test_get_nics_by_owner = function (t) {
    napi.getNics(NIC_UUID, function (err, nics) {
        t.ifError(err);
        t.ok(nics);
        t.ok(util.isArray(nics));
        t.done();
    });
};


exports.test_delete_nic = function (t) {
    napi.deleteNic(MAC_1, function (err, nic) {
        t.ifError(err);
        t.done();
    });
};


exports.test_delete_nic_2 = function (t) {
    napi.deleteNic(MAC_2, function (err, nic) {
        t.ifError(err);
        t.done();
    });
};


exports.tearDown = function (callback) {
    napi.close();
    callback();
};