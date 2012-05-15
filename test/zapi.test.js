// Copyright 2011 Joyent, Inc.  All rights reserved.

var Logger = require('bunyan');
var restify = require('restify');
var uuid = require('node-uuid');

var ZAPI = require('../lib/index').ZAPI;



///--- Globals

var ZAPI_URL = 'http://' + (process.env.ZAPI_IP || '0.0.0.0:8080');
// var ZAPI_URL = 'http://' + (process.env.ZAPI_IP || '10.99.99.19');

var zapi = null;
var ZONE = null;
var DATASET_UUID = null;
var CUSTOMER = '930896af-bf8c-48d4-885c-6573a94b1853';



///--- Helpers

function waitForState(state, callback) {
  function check() {
    return zapi.getMachine(ZONE, function(err, machine) {
      if (err)
        return callback(err);

      if (machine.state === state)
        return callback(null);

      setTimeout(check, 3000);
    });
  }

  return check();
}


///--- Tests

exports.setUp = function(test, assert) {
  zapi = new ZAPI({
    url: ZAPI_URL,
    username: 'admin',
    password: 'z3cr3t',
    retry: {
      retries: 1,
      minTimeout: 1000
    },
    log: new Logger({
      name: 'zapi_unit_test',
      stream: process.stderr,
      level: (process.env.LOG_LEVEL || 'info'),
      serializers: Logger.stdSerializers
    })
  });
  test.finish();
};


exports.test_list_machines = function(test, assert) {
  zapi.listMachines(function(err, machines) {
    assert.ifError(err);
    assert.ok(machines);
    ZONE = machines[0].uuid;
    DATASET_UUID = machines[0].dataset_uuid;
    test.finish();
  });
};


exports.test_list_machines_by_owner = function(test, assert) {
  zapi.listMachines({ owner_uuid: CUSTOMER }, function(err, machines) {
    assert.ifError(err);
    assert.ok(machines);
    test.finish();
  });
};


exports.test_get_machine = function(test, assert) {
  zapi.getMachine(ZONE, function(err, machine) {
    assert.ifError(err);
    assert.ok(machine);
    test.finish();
  });
};


exports.test_create_zone = function(test, assert) {
  var opts = {
    owner_uuid: CUSTOMER,
    dataset_uuid: DATASET_UUID,
    brand: 'joyent',
    ram: 64
  };

  zapi.createMachine(opts, function(err, machine) {
    assert.ifError(err);
    assert.ok(machine);
    assert.equal(opts.ram, machine.ram);
    ZONE = machine.uuid;
    test.finish();
  });
};


exports.test_wait_for_running = function(test, assert) {
  waitForState('running', function(err) {
    assert.ifError(err);
    setTimeout(function () {
      // Try to avoid the reboot after zoneinit so we don't stop the zone
      // too early
      test.finish();
    }, 20000);

  });
};


exports.test_stop_zone = function(test, assert) {
  zapi.stopMachine(ZONE, function(err, machine) {
    assert.ifError(err);
    assert.ok(machine);
    test.finish();
  });
};


exports.test_wait_for_stopped = function(test, assert) {
  waitForState('stopped', function(err) {
    assert.ifError(err);
    test.finish();
  });
};


exports.test_start_zone = function(test, assert) {
  zapi.startMachine(ZONE, function(err, machine) {
    assert.ifError(err);
    assert.ok(machine);
    test.finish();
  });
};


exports.test_wait_for_started = function(test, assert) {
  waitForState('running', function(err) {
    assert.ifError(err);
    test.finish();
  });
};


exports.test_reboot_zone = function(test, assert) {
  zapi.rebootMachine(ZONE, function(err, machine) {
    assert.ifError(err);
    assert.ok(machine);
    test.finish();
  });
};


exports.test_wait_for_reboot = function(test, assert) {
  setTimeout(function () {
      waitForState('running', function(err) {
        assert.ifError(err);
        test.finish();
      });
  }, 3000);
};


exports.test_destroy_zone = function(test, assert) {
  zapi.destroyMachine(ZONE, function(err, machine) {
    assert.ifError(err);
    assert.ok(machine);
    test.finish();
  });
};


exports.test_wait_for_destroyed = function(test, assert) {
  waitForState('destroyed', function(err) {
    assert.ifError(err);
    test.finish();
  });
};
