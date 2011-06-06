// Copyright 2011 Joyent, Inc.  All rights reserved.

var uuid = require('node-uuid');

var sdcClients = require('../lib/index');
var Capi = sdcClients.CAPI;

var capi = null;
var key = {
  name: uuid(),
  key: 'ssh-dss AAAAB3NzaC1kc3MAAACBAJTdTh/rEJyEdi7GxZUhoKqxnbpREBJvkuiyu9ulXXrH8pPr0MGpvuA0umR8YOYKtNoKRsAScU4o+rEI++5Curt7GvsebHmSv5FSyWfSrLkCQfntAiWf1/e796Ky/hcU54hvwthw/Cq3piriaz6WGjRt/o8rpj+Q2cykCMTjKl+HAAAAFQCyh0FmX4j3g4cmJiNWbJg1rqitIQAAAIEAki9Uvqv266avFVCgIi9Fi5Tby80gVR9EFnP5YybqwcZWzDtT2O23PREqegxlsMxsCPPngny5O9q4ZBAcHu1qBo52imGEvsoobioHRaCcS2CG72pqhMFRb8XERUR5JQ2JuqdkA8BaxQdMckV5PMXju89CjGhouCn7+ovUjKC13wQAAACANG2maPPYrn1KrRn1qrfUkeRw0qja8QBZSoIZb8mocloPM7uiLkJudsy7f7WKjNrg/KiJ6QkFXYMQaxtINGxC4Ns1e7aOkmSGvCQheVMG30xxEBoEEhwCORPOgoW5EveQ2JUyTqcYhNxD/+ZKGG0JnZJTn0Ic45eg2gLpUBezGxk= mark@bluesnoop.local'
};
var appKey = 'portal-coal';
var mdKey = uuid();
var mdObj = {
  foo: uuid()
};


exports.setUp = function(test, assert) {
  sdcClients.setLogLevel('trace');
  capi = new Capi({
    url: 'http://10.99.99.11:8080',
    username: 'admin',
    password: 'tot@ls3crit',
    authCache: {
      size: 1000,
      expiry: 60
    },
    accountCache: {
      size: 1000,
      expiry: 300
    }
  });
  test.finish();
};


exports.test_get_account_and_cached = function(test, assert) {
  capi.getAccount('admin', function(err, account) {
    assert.ifError(err);
    assert.ok(account);
    capi.getAccount('admin', function(err, account) {
      assert.ifError(err);
      assert.ok(account);
      test.finish();
    });
  });
};


exports.test_get_account_invalid_name = function(test, assert) {
  capi.getAccount(uuid(), function(err, account) {
    assert.ok(err);
    assert.ok(!account);
    assert.equal(err.httpCode, 404);
    assert.equal(err.restCode, 'ResourceNotFound');
    assert.ok(err.message);
    test.finish();
  });
};


exports.test_authenticate_valid_and_cached = function(test, assert) {
  capi.authenticate('admin', 'joypass123', function(err, account) {
    assert.ifError(err);
    assert.ok(account);
    capi.authenticate('admin', 'joypass123', function(err, account) {
      assert.ifError(err);
      assert.ok(account);
      test.finish();
    });
  });
};


exports.test_authenticate_invalid_password = function(test, assert) {
  capi.authenticate('admin', uuid(), function(err, account) {
    assert.ok(err);
    assert.ok(!account);
    test.finish();
  });
};


exports.test_create_key = function(test, assert) {
  capi.createKey('admin', key, function(err, capiKey) {
    assert.ifError(err);
    assert.ok(key);
    assert.equal(capiKey.name, key.name);
    assert.equal(capiKey.body, key.key);
    test.finish();
  });
};


exports.test_create_bad_body = function(test, assert) {
  capi.createKey('admin', { name: 'foo', key: 'bar' }, function(err, capiKey) {
    assert.ok(err);
    assert.ok(!capiKey);
    assert.equal(err.httpCode, 409);
    assert.equal(err.restCode, 'InvalidArgument');
    assert.equal(err.message, 'Key does not appear to be authentic');
    test.finish();
  });
};


exports.test_list_keys = function(test, assert) {
  capi.listKeys('admin', function(err, keys) {
    assert.ifError(err);
    assert.ok(keys);
    assert.equal(keys.length, 1);
    assert.equal(keys[0].name, key.name);
    assert.equal(keys[0].body, key.key);
    test.finish();
  });
};


exports.test_get_key_by_name = function(test, assert) {
  capi.getKeyByName('admin', key.name, function(err, capiKey) {
    assert.ifError(err);
    assert.ok(key);
    assert.equal(capiKey.name, key.name);
    assert.equal(capiKey.body, key.key);
    test.finish();
  });
};


exports.test_get_key_by_name_missing = function(test, assert) {
  capi.getKeyByName('admin', uuid(), function(err, capiKey) {
    assert.ok(err);
    assert.ok(!capiKey);
    assert.equal(404, err.httpCode);
    assert.equal('ResourceNotFound', err.restCode);
    assert.ok(err.message);
    test.finish();
  });
};


exports.test_delete_key = function(test, assert) {
  capi.listKeys('admin', function(err, keys) {
    assert.ifError(err);
    assert.ok(keys);
    assert.equal(keys[0].name, key.name);
    capi.deleteKey('admin', keys[0].id, function(err) {
      assert.ifError(err);
      test.finish();
    });
  });
};


exports.test_delete_key_missing = function(test, assert) {
  capi.deleteKey('admin', 65535, function(err) {
    assert.ok(err);
    assert.equal(404, err.httpCode);
    assert.equal('ResourceNotFound', err.restCode);
    assert.ok(err.message);
    test.finish();
  });
};


exports.test_put_metadata = function(test, assert) {
  capi.putMetadata('admin', appKey, mdKey, mdObj, function(err) {
    assert.ifError(err);
    test.finish();
  });
};


exports.test_put_metadata_invalid = function(test, assert) {
  capi.putMetadata('admin', uuid(), mdKey, {}, function(err) {
    assert.ok(err);
    assert.equal(409, err.httpCode);
    assert.equal('InvalidArgument', err.restCode);
    assert.ok(err.message);
    test.finish();
  });
};


exports.test_get_metadata = function(test, assert) {
  capi.getMetadata('admin', appKey, mdKey, function(err, obj) {
    assert.ifError(err);
    assert.ok(obj);
    assert.equal(mdObj.foo, obj.foo);
    test.finish();
  });
};


exports.test_get_invalid_metadata = function(test, assert) {
  capi.getMetadata('admin', appKey, uuid(), function(err, obj) {
    assert.ok(err);
    assert.equal(404, err.httpCode);
    assert.equal('ResourceNotFound', err.restCode);
    assert.ok(err.message);
    test.finish();
  });
};


exports.test_del_invalid_metadata = function(test, assert) {
  capi.deleteMetadata('admin', appKey, uuid(), function(err) {
    assert.ok(err);
    assert.equal(404, err.httpCode);
    assert.equal('ResourceNotFound', err.restCode);
    assert.ok(err.message);
    test.finish();
  });
};


exports.test_del_metadata = function(test, assert) {
  capi.deleteMetadata('admin', appKey, mdKey, function(err) {
    assert.ifError(err);
    test.finish();
  });
};


exports.test_put_limits = function(test, assert) {
  capi.putLimit('930896af-bf8c-48d4-885c-6573a94b1853',
                'coal',
                'smartos',
                4,
                function(err) {
    assert.ifError(err);
    test.finish();
  });
};


exports.test_list_limits = function(test, assert) {
  capi.listLimits('930896af-bf8c-48d4-885c-6573a94b1853',
                  function(err, limits) {
    assert.ifError(err);
    assert.ok(limits);
    assert.equal(limits[0].type, 'smartos');
    assert.equal(limits[0].value, 4);
    test.finish();
  });
};


exports.test_del_limit = function(test, assert) {
  capi.deleteLimit('930896af-bf8c-48d4-885c-6573a94b1853',
                   'coal',
                   'smartos',
                   function(err) {
    assert.ifError(err);
    test.finish();
  });
};


exports.tearDown = function(test, assert) {
  test.finish();
};
