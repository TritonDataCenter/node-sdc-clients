// Copyright 2011 Joyent, Inc.  All rights reserved.

var Logger = require('bunyan');
var restify = require('restify');
var uuid = require('node-uuid');

var VMAPI = require('../lib/index').VMAPI;



// --- Globals

var VMAPI_URL = 'http://' + (process.env.VMAPI_IP || 'localhost:8080');

var vmapi = null;
var ZONE = null;
var DATASET_UUID = null;
var QUERY = null;
var CUSTOMER = '930896af-bf8c-48d4-885c-6573a94b1853';
var NETWORKS = 'adbf3257-e566-40a9-8df0-c0db469b78bd';



// --- Helpers

function waitForState(state, callback) {
  function check() {
    return vmapi.getVm(QUERY, function (err, vm) {
      if (err)
        return callback(err);

      if (vm.state === state)
        return callback(null);

      return setTimeout(check, 3000);
    });
  }

  return check();
}


// --- Tests

exports.setUp = function (callback) {
  vmapi = new VMAPI({
    url: VMAPI_URL,
    retry: {
      retries: 1,
      minTimeout: 1000
    },
    log: new Logger({
      name: 'vmapi_unit_test',
      stream: process.stderr,
      level: (process.env.LOG_LEVEL || 'info'),
      serializers: Logger.stdSerializers
    })
  });
  callback();
};


exports.test_list_vms = function (test) {
  vmapi.listVms(function (err, vms) {
    test.ifError(err);
    test.ok(vms);
    ZONE = vms[0].uuid;
    DATASET_UUID = vms[0].dataset_uuid;
    QUERY = {
      uuid: ZONE,
      owner_uuid: CUSTOMER
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


exports.test_get_vm = function (test) {
  vmapi.getVm(QUERY, function (err, vm) {
    test.ifError(err);
    test.ok(vm);
    test.done();
  });
};


exports.test_create_zone = function (test) {
  var opts = {
    owner_uuid: CUSTOMER,
    dataset_uuid: DATASET_UUID,
    networks: NETWORKS,
    brand: 'joyent-minimal',
    ram: 64
  };

  vmapi.createVm(opts, function (err, job) {
    test.ifError(err);
    test.ok(job);
    QUERY = {
      uuid: job.vm_uuid,
      owner_uuid: CUSTOMER
    };
    test.done();
  });
};


exports.test_wait_for_running = function (test) {
  waitForState('running', function (err) {
    test.ifError(err);
    setTimeout(function () {
      // Try to avoid the reboot after zoneinit so we don't stop the zone
      // too early
      test.done();
    }, 20000);

  });
};


exports.test_stop_zone = function (test) {
  vmapi.stopVm(QUERY, function (err, job) {
    test.ifError(err);
    test.ok(job);
    test.done();
  });
};


exports.test_wait_for_stopped = function (test) {
  waitForState('stopped', function (err) {
    test.ifError(err);
    test.done();
  });
};


exports.test_start_zone = function (test) {
  vmapi.startVm(QUERY, function (err, job) {
    test.ifError(err);
    test.ok(job);
    test.done();
  });
};


exports.test_wait_for_started = function (test) {
  waitForState('running', function (err) {
    test.ifError(err);
    test.done();
  });
};


exports.test_reboot_zone = function (test) {
  vmapi.rebootVm(QUERY, function (err, job) {
    test.ifError(err);
    test.ok(job);
    test.done();
  });
};


exports.test_wait_for_reboot = function (test) {
  setTimeout(function () {
      waitForState('running', function (err) {
        test.ifError(err);
        test.done();
      });
  }, 3000);
};


exports.test_destroy_zone = function (test) {
  vmapi.deleteVm(QUERY, function (err, job) {
    test.ifError(err);
    test.ok(job);
    test.done();
  });
};


exports.test_wait_for_destroyed = function (test) {
  waitForState('destroyed', function (err) {
    test.ifError(err);
    test.done();
  });
};
