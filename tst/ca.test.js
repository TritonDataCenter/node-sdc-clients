// Copyright 2011 Joyent, Inc.  All rights reserved.

var log = require('restify').log;
var uuid = require('node-uuid');

var CA = require('../lib/index').CA;



///--- Globals

var ca = null;
var customer = '930896af-bf8c-48d4-885c-6573a94b1853';
var instrumentation = null;


///--- Tests

exports.setUp = function(test, assert) {
  log.level(log.Level.Trace);
  ca = new CA({
    url: 'http://10.99.99.9:23181',
    retryOptions: {
      retries: 5,
      minTimeout: 1000
    }
  });
  test.finish();
};


exports.test_list_schema = function(test, assert) {
  ca.listSchema(customer, function(err, schema) {
    assert.ifError(err);
    assert.ok(schema);
    log.debug('ca.test: test_list_schema => %o', schema);
    test.finish();
  });
};


exports.test_create_instrumentation_bad_params = function(test, assert) {
  ca.createInstrumentation(customer, {}, function(err, instrumentation) {
    assert.ok(err);
    assert.ok(!instrumentation);
    assert.equal(err.httpCode, 409);
    assert.equal(err.restCode, 'InvalidArgument');
    assert.ok(err.message);
    log.debug('ca.test: test_create_instrumentation_bad => %o', err);
    test.finish();
  });
};


exports.test_create_instrumentation = function(test, assert) {
  var params = {
    module: 'fs',
    stat: 'logical_ops',
    decomposition: 'latency'
  };
  ca.createInstrumentation(customer, params, function(err, inst) {
    assert.ifError(err);
    assert.ok(inst);
    log.debug('ca.test: test_create_instrumentation => %o', inst);
    var uri = inst.uri;
    instrumentation = uri.substr(uri.lastIndexOf('/') + 1);
    test.finish();
  });
};


exports.test_list_instrumentations = function(test, assert) {
  ca.listInstrumentations(customer, function(err, instrumentations) {
    assert.ifError(err);
    assert.ok(instrumentations);
    assert.ok(instrumentations.length);
    var i = instrumentations[instrumentations.length - 1];
    assert.equal(i.module, 'fs');
    assert.equal(i.stat, 'logical_ops');
    log.debug('ca.test: test_list_instrumentations => %o', instrumentations);
    test.finish();
  });
};


exports.test_list_instrumentations_bogus_customer = function(test, assert) {
  ca.listInstrumentations(uuid(), function(err, instrumentations) {
    assert.ifError(err);
    assert.ok(instrumentations);
    assert.equal(instrumentations.length, 0);
    test.finish();
  });
};


exports.test_get_instrumentation_bad = function(test, assert) {
  ca.getInstrumentation(customer, uuid(), function(err, instrumentation) {
    assert.ok(err);
    assert.ok(!instrumentation);
    assert.equal(err.httpCode, 404);
    assert.equal(err.restCode, 'ResourceNotFound');
    assert.ok(err.message);
    log.debug('ca.test: test_get_instrumentation_bad => %o', err);
    test.finish();
  });
};


exports.test_get_instrumentation = function(test, assert) {
  ca.getInstrumentation(customer, instrumentation, function(err, inst) {
    assert.ifError(err);
    assert.ok(inst);
    log.debug('ca.test: test_get_instrumentation => %o', inst);
    test.finish();
  });
};


exports.test_get_heatmap = function(test, assert) {
  ca.getHeatmap(customer, instrumentation, function(err, heatmap) {
    assert.ifError(err);
    assert.ok(heatmap);
    log.debug('ca.test: test_get_heatmap => %o', heatmap);
    test.finish();
  });
};


exports.test_get_heatmap_bad = function(test, assert) {
  ca.getHeatmap(customer, uuid(), function(err, heatmap) {
    assert.ok(err);
    assert.ok(!heatmap);
    assert.equal(err.httpCode, 404);
    assert.equal(err.restCode, 'ResourceNotFound');
    assert.ok(err.message);
    log.debug('ca.test: get_heatmap_bad => %o', err);
    test.finish();
  });
};


exports.test_get_heatmap_details = function(test, assert) {
  ca.getHeatmapDetails(customer, instrumentation, 10, 20, function(err, hmap) {
    assert.ifError(err);
    assert.ok(hmap);
    log.debug('ca.test: test_get_heatmap_details => %o', hmap);
    test.finish();
  });
};


exports.test_get_heatmap_details_bad = function(test, assert) {
  ca.getHeatmapDetails(customer, uuid(), 10, 20, function(err, heatmap) {
    assert.ok(err);
    assert.ok(!heatmap);
    assert.equal(err.httpCode, 404);
    assert.equal(err.restCode, 'ResourceNotFound');
    assert.ok(err.message);
    log.debug('ca.test: get_heatmap_details_bad => %o', err);
    test.finish();
  });
};


exports.test_delete_instrumentation_bad = function(test, assert) {
  ca.deleteInstrumentation(customer, uuid(), function(err) {
    assert.ok(err);
    assert.equal(err.httpCode, 404);
    assert.equal(err.restCode, 'ResourceNotFound');
    assert.ok(err.message);
    log.debug('ca.test: delete_instrumentation_bad => %o', err);
    test.finish();
  });
};


// exports.test_clone_instrumentation = function(test, assert) {
//   ca.cloneInstrumentation(customer, instrumentation, function(err, inst) {
//     assert.ifError(err);
//     ca.deleteInstrumentation(customer, inst, function(err) {
//       assert.ifError(err);
//       test.finish();
//     });
//   });
// };


exports.test_delete_instrumentation = function(test, assert) {
  ca.deleteInstrumentation(customer, instrumentation, function(err) {
    assert.ifError(err);
    test.finish();
  });
};


exports.tearDown = function(test, assert) {
  test.finish();
};
