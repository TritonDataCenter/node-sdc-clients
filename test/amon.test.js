/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2016 Joyent, Inc.
 */

var libuuid = require('libuuid');
var test = require('tape');

var Amon = require('../lib/index').Amon;


// --- globals

var amon;


// --- fixtures

var AMON_URL = 'http://' + (process.env.AMON_IP || '10.99.99.20');

// We hijack the admin user since it's always going to exist.
// TODO: Should use a test user. Might be *using* 'admin' user.
var ADMIN_UUID = process.env.UFDS_ADMIN_UUID;

var MACHINE_UUID = process.env.MACHINE_UUID;

// Monitor name needs to be 32 chars length max and first char must be
// alpha always:
var MONITOR = {
    'name' : 'p' + libuuid.create().replace(/-/g, '').substring(1),
    'contacts': ['email']
};

var MONITOR_2 = {
    'name': 'p' + libuuid.create().replace(/-/g, '').substring(1),
    'contacts': ['email']
};

var PROBE = {
    'name': 'test-probe',
    'user': ADMIN_UUID,
    'monitor': MONITOR.name,
    'type': 'machine-up',
    'machine': MACHINE_UUID
};

var PROBE_2 = {
    'name': 'test-probe-2',
    'user': ADMIN_UUID,
    'monitor': MONITOR.name,
    'type': 'machine-up',
    'machine': MACHINE_UUID
};


// --- tests

// Skipping Amon tests. They are out of date (using 'monitors' which were
// long ago replaced by 'probegroups').
test.skip('amon', function (tt) {
    tt.test(' setup', function (t) {
        if (typeof (MACHINE_UUID) === 'undefined') {
            throw new Error(
                'MACHINE_UUID env var is required to run amon tests');
        }
        amon = new Amon({
            url: AMON_URL
        });
        t.close();
    });

    tt.test(' put monitor', function (t) {
        amon.putMonitor(ADMIN_UUID, MONITOR.name, MONITOR, function (err, mon) {
            t.ifError(err);
            t.ok(mon);
            t.equal(mon.name, MONITOR.name);
            t.equal(mon.medium, MONITOR.medium);
            t.end();
        });
    });

    tt.test(' put probe', function (t) {
        amon.putProbe(ADMIN_UUID, MONITOR.name, PROBE.name, PROBE,
            function (err, probe) {
            t.ifError(err);
            t.ok(probe);
            t.equal(probe.name, PROBE.name);
            t.equal(probe.user, PROBE.user);
            t.equal(probe.machine, PROBE.machine);
            t.equal(probe.monitor, PROBE.monitor);
            t.equal(probe.type, PROBE.type);
            t.end();
        });
    });

    tt.test(' list probes', function (t) {
        amon.putProbe(ADMIN_UUID, MONITOR.name, PROBE_2.name, PROBE_2,
            function (err, probe) {
            t.ifError(err);
            t.ok(probe);

            amon.listProbes(ADMIN_UUID, MONITOR.name, function (err2, probes) {
                t.ifError(err2);
                t.ok(probes);
                t.equal(probes.length, 2);

                amon.deleteProbe(ADMIN_UUID, MONITOR.name, PROBE_2.name,
                  function (err3) {
                    t.ifError(err3);
                    t.end();
                });
            });
        });
    });

    tt.test(' get probe', function (t) {
        amon.getProbe(ADMIN_UUID, MONITOR.name, PROBE.name,
                function (err, probe) {
            t.ifError(err);
            t.ok(probe);
            t.equal(probe.name, PROBE.name);
            t.equal(probe.user, PROBE.user);
            t.equal(probe.machine, PROBE.machine);
            t.equal(probe.monitor, PROBE.monitor);
            t.equal(probe.type, PROBE.type);
            t.end();
        });
    });

    tt.test(' delete probe', function (t) {
        amon.deleteProbe(ADMIN_UUID, MONITOR.name, PROBE.name, function (err) {
            t.ifError(err);
            amon.getProbe(ADMIN_UUID, MONITOR.name, PROBE.name,
                    function (err2) {
                t.equal(err2.statusCode, 404);
                t.end();
            });
        });
    });

    tt.test(' list monitors', function (t) {
        amon.putMonitor(ADMIN_UUID, MONITOR_2.name, MONITOR_2,
            function (err, monitor) {
            t.ifError(err);
            amon.listMonitors(ADMIN_UUID, function (err2, monitors) {
                t.ifError(err2);
                t.ok(monitors);
                t.ok((monitors.length > 2), 'Found less than 2 monitors');
                amon.deleteMonitor(ADMIN_UUID, MONITOR_2.name, function (err3) {
                    t.ifError(err3);
                    t.end();
                });
            });
        });
    });

    tt.test(' get monitor', function (t) {
        amon.getMonitor(ADMIN_UUID, MONITOR.name, function (err, monitor) {
            t.ifError(err);
            t.ok(monitor);
            t.equal(monitor.name, MONITOR.name);
            t.equal(monitor.medium, MONITOR.medium);
            t.end();
        });
    });

    tt.test(' delete monitor', function (t) {
        amon.deleteMonitor(ADMIN_UUID, MONITOR.name, function (err) {
            t.ifError(err);
            setTimeout(function () {
                amon.getMonitor(ADMIN_UUID, MONITOR.name, function (err2) {
                    t.equal(err2.statusCode, 404);
                    t.end();
                });
            }, 3000);
        });
    });

    tt.test(' teardown', function (t) {
        if (amon)
            amon.close();
        t.end();
    });
});