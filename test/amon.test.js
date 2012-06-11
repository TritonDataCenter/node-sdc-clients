var sys = require('sys');
var sdcClients = require('../lib/index');
var restify = require('restify');
var Amon = sdcClients.Amon;

var amon = null;


// --- fixtures

var AMON_URL = 'http://' + (process.env.AMON_IP || 'localhost:8080');

// We hijack the admin user since it's always going to exist.
// TODO: Should use a test user. Might be *using* 'admin' user.
var ADMIN_UUID = '930896af-bf8c-48d4-885c-6573a94b1853';

var MONITOR = {
    'name' : 'test-monitor',
    'contacts': ['email']
};

var MONITOR_2 = {
    'name': 'yunong-monitor',
    'contacts': ['email']
};

var PROBE = {
    'name': 'test-probe',
    'user': ADMIN_UUID,
    'monitor': MONITOR.name,
    'zone': 'global',
    'urn': 'amon:logscan',
    'data': {
        'path': '/tmp/whistle.log',
        'regex': 'tweet',
        'threshold': 2,
        'period': 60
    }
};

var PROBE_2 = {
    'name': 'test-probe-2',
    'user': ADMIN_UUID,
    'monitor': MONITOR.name,
    'zone': 'global',
    'urn': 'amon:logscan',
    'data': {
        'path': '/tmp/whistle.log',
        'regex': 'tweet',
        'threshold': 2,
        'period': 60
    }
};



// --- internal support stuff

/**
 * Run async `fn` on each entry in `list`. Call `cb(error)` when all done.
 * `fn` is expected to have `fn(item, callback) -> callback(error)` signature.
 *
 * From Isaac's rimraf.js.
 */
function asyncForEach(list, fn, cb) {
    if (!list.length) cb();
    var c = list.length, errState = null;
    list.forEach(function (item, i, list) {
        fn(item, function (er) {
            if (errState)
                return null;
            if (er)
                return cb(errState = er);
            if (-- c === 0)
                return cb();
            return null;
        });
    });
}



// --- tests

function cleanupAccount(test) {
    function deleteProbe(probe, callback) {
        amon.deleteProbe(ADMIN_UUID, probe.monitor, probe.name, callback);
    }
    function deleteMonitor(monitor, callback) {
        amon.getMonitor(ADMIN_UUID, MONITOR.name, function (err, monitor) {
            // test.ifError(err);   // don't error on 404
            if (!monitor) {
                return callback();
            }
            return amon.listProbes(ADMIN_UUID, monitor.name,
              function (err, probes) {
                test.ifError(err);
                asyncForEach(probes, deleteProbe, function (err) {
                    test.ifError(err);
                    setTimeout(function () {
                        amon.deleteMonitor(ADMIN_UUID, monitor.name,
                          function (err) {
                            setTimeout(function () { callback(err); }, 2000);
                        });
                    }, 2000);
                });
            });
        });
    }

    // Delete all test monitors.
    asyncForEach([MONITOR, MONITOR_2], deleteMonitor, function (err) {
        test.done();
    });
}

exports.setUp = function (test) {
    sdcClients.setLogLevel('trace');
    amon = new Amon({
        url: AMON_URL
    });

    cleanupAccount(test);
};

exports.test_put_monitor = function (test) {
    amon.putMonitor(ADMIN_UUID, MONITOR, function (err, monitor) {
        test.ifError(err);
        test.ok(monitor);
        test.equal(monitor.name, MONITOR.name);
        test.equal(monitor.medium, MONITOR.medium);
        test.done();
    });
};

exports.test_put_probe = function (test) {
    amon.putProbe(ADMIN_UUID, MONITOR.name, PROBE, function (err, probe) {
        test.ifError(err);
        test.ok(probe);
        test.equal(probe.name, PROBE.name);
        test.equal(probe.monitor, PROBE.monitor);
        test.equal(probe.zone, PROBE.zone);
        test.equal(probe.urn, PROBE.urn);
        test.equal(probe.data.path, PROBE.data.path);
        test.equal(probe.data.regex, PROBE.data.regex);
        test.equal(probe.data.threshold, PROBE.data.threshold);
        test.equal(probe.data.period, PROBE.data.period);
        test.done();
    });
};

exports.test_list_probes = function (test) {
    amon.putProbe(ADMIN_UUID, MONITOR.name, PROBE_2, function (err, probe) {
        test.ifError(err);
        test.ok(probe);

        amon.listProbes(ADMIN_UUID, MONITOR.name, function (err, probes) {
            test.ifError(err);
            test.ok(probes);
            test.equal(probes.length, 2);

            amon.deleteProbe(ADMIN_UUID, MONITOR.name, PROBE_2.name,
              function (err) {
                test.ifError(err);
                test.done();
            });
        });
    });
};

exports.test_get_probe = function (test) {
    amon.getProbe(ADMIN_UUID, MONITOR.name, PROBE.name, function (err, probe) {
        test.ifError(err);
        test.ok(probe);
        test.equal(probe.name, PROBE.name);
        test.equal(probe.monitor, PROBE.monitor);
        test.equal(probe.zone, PROBE.zone);
        test.equal(probe.urn, PROBE.urn);
        test.equal(probe.data.path, PROBE.data.path);
        test.equal(probe.data.regex, PROBE.data.regex);
        test.equal(probe.data.threshold, PROBE.data.threshold);
        test.equal(probe.data.period, PROBE.data.period);
        test.done();
    });
};

exports.test_delete_probe = function (test) {
    amon.deleteProbe(ADMIN_UUID, MONITOR.name, PROBE.name, function (err) {
        test.ifError(err);
        amon.getProbe(ADMIN_UUID, MONITOR.name, PROBE.name, function (err) {
            test.equal(err.httpCode, 404);
            test.done();
        });
    });
};

exports.test_list_monitors = function (test) {
    amon.putMonitor(ADMIN_UUID, MONITOR_2, function (err, monitor) {
        test.ifError(err);
        amon.listMonitors(ADMIN_UUID, function (err, monitors) {
            test.ifError(err);
            test.ok(monitors);
            test.equal(monitors.length, 2, 'Found more than 2 monitors');
            amon.deleteMonitor(ADMIN_UUID, MONITOR_2.name, function (err) {
                test.ifError(err);
                test.done();
            });
        });
    });
};

exports.test_get_monitor = function (test) {
    amon.getMonitor(ADMIN_UUID, MONITOR.name, function (err, monitor) {
        test.ifError(err);
        test.ok(monitor);
        test.equal(monitor.name, MONITOR.name);
        test.equal(monitor.medium, MONITOR.medium);
        test.done();
    });
};

exports.test_delete_monitor = function (test) {
    amon.deleteMonitor(ADMIN_UUID, MONITOR.name, function (err) {
        test.ifError(err);
        setTimeout(function () {
            amon.getMonitor(ADMIN_UUID, MONITOR.name, function (err) {
                test.equal(err.httpCode, 404);
                test.done();
            });
        }, 3000);
    });
};

exports.tearDown = function (test) {
    cleanupAccount(test);
};
