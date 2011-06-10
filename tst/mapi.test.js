// Copyright 2011 Joyent, Inc.  All rights reserved.

var log = require('restify').log;
var uuid = require('node-uuid');

var MAPI = require('../lib/index').MAPI;



///--- Globals

var mapi = null;
var datasetUuid = null;
var customer = '930896af-bf8c-48d4-885c-6573a94b1853';
var zoneAlias = process.env.MAPI_ZONE_ALIAS;
var zoneName = process.env.MAPI_ZONE_NAME;

var createAlias = uuid();
var createdZone = null;
var createdVM = null;

///--- Tests

exports.setUp = function(test, assert) {
  //log.level(log.Level.Trace);
  mapi = new MAPI({
    url: 'http://10.99.99.8:8080',
    username: 'admin',
    password: 'tot@ls3crit',
    retryOptions: {
      retries: 1,
      minTimeout: 1000
    }
  });
  test.finish();
};


exports.test_list_datasets = function(test, assert) {
  mapi.listDatasets(customer, function(err, datasets) {
    assert.ifError(err);
    assert.ok(datasets);
    assert.ok(datasets.length);
    log.debug('mapi.test: list_datasets => %o', datasets);
    for (var i = 0; i < datasets.length; i++) {
      if (datasets[i].name === 'smartos')
        datasetUuid = datasets[i].uuid;
    }
    test.finish();
  });
};


exports.test_get_dataset = function(test, assert) {
  // MAPI works with both uuid and id, so i'm kind of lying here
  // and just using the "guaranteed to be at least 1" dataset monotonic id.
  mapi.getDataset(customer, 1, function(err, dataset) {
    assert.ifError(err);
    assert.ok(dataset);
    log.debug('mapi.test: get_dataset => %o', dataset);
    test.finish();
  });
};


exports.test_get_dataset_not_found = function(test, assert) {
  mapi.getDataset(customer, uuid(), function(err, dataset) {
    assert.ok(err);
    assert.ok(!dataset);
    assert.equal(err.httpCode, 404);
    assert.equal(err.restCode, 'ResourceNotFound');
    assert.ok(err.message);
    log.debug('mapi.test: get_dataset_no_found => %o', err);
    test.finish();
  });
};


exports.test_list_packages = function(test, assert) {
  mapi.listPackages(customer, function(err, packages) {
    assert.ifError(err);
    assert.ok(packages);
    assert.ok(packages.length);
    log.debug('mapi.test: list_packages => %o', packages);
    test.finish();
  });
};


exports.test_get_package_by_name = function(test, assert) {
  mapi.getPackageByName(customer, 'regular_128', function(err, pkg) {
    assert.ifError(err);
    assert.ok(pkg);
    log.debug('mapi.test: get_package_by_name => %o', pkg);
    test.finish();
  });
};


exports.test_get_package_by_name_not_found = function(test, assert) {
  mapi.getPackageByName(customer, uuid(), function(err, pkg) {
    assert.ok(err);
    assert.ok(!pkg);
    assert.equal(err.httpCode, 404);
    assert.equal(err.restCode, 'ResourceNotFound');
    assert.ok(err.message);
    log.debug('mapi.test: get_package_by_name_not_found => %o', err);
    test.finish();
  });
};


exports.test_list_zones = function(test, assert) {
  mapi.listZones(customer, function(err, zones) {
    assert.ifError(err);
    assert.ok(zones);
    log.debug('mapi.test: list_zones => %o', zones);
    test.finish();
  });
};


exports.test_list_zones_bad_tenant = function(test, assert) {
  mapi.listZones(uuid(), function(err, zones) {
    assert.ifError(err);
    assert.ok(zones);
    log.debug('mapi.test: list_zones_bad_tenant => %o', zones);
    test.finish();
  });
};


exports.test_list_zones_all_zones = function(test, assert) {
  mapi.listZones(customer, { allZones: true }, function(err, zones) {
    assert.ifError(err);
    assert.ok(zones);
    log.debug('mapi.test: list_zones_all_zones => %o', zones);
    test.finish();
  });
};


exports.test_list_zones_limit_offset = function(test, assert) {
  var opts = {
    allZones: true,
    limit: 1,
    offset: 0
  };
  mapi.listZones(customer, opts, function(err, zones) {
    assert.ifError(err);
    assert.ok(zones);
    log.debug('mapi.test: list_zones_limit_offset => %o', zones);
    test.finish();
  });
};


exports.test_list_zones_limit_offset_empty = function(test, assert) {
  var opts = {
    limit: 0,
    offset: 3
  };
  mapi.listZones(customer, opts, function(err, zones) {
    assert.ifError(err);
    assert.ok(zones);
    assert.equal(zones.length, 0);
    log.debug('mapi.test: list_zones_limit_offset_empty => %o', zones);
    test.finish();
  });
};


exports.test_count_zones = function(test, assert) {
  mapi.countZones(customer, function(err, count) {
    assert.ifError(err);
    assert.isDefined(count);
    log.debug('mapi.test: count_zones => %o', count);
    test.finish();
  });
};


exports.test_count_zones_no_tenant = function(test, assert) {
  mapi.countZones(uuid(), function(err, count) {
    assert.ifError(err);
    assert.isDefined(count);
    assert.equal(count, 0);
    log.debug('mapi.test: count_zones_no_tenant => %o', count);
    test.finish();
  });
};


exports.test_count_zones_all = function(test, assert) {
  mapi.countZones(customer, { allZones: true }, function(err, count) {
    assert.ifError(err);
    assert.isDefined(count);
    log.debug('mapi.test: count_zones_all => %o', count);
    test.finish();
  });
};


if (zoneAlias)
exports.test_get_zone_by_alias = function(test, assert) {
  mapi.getZoneByAlias(customer, zoneAlias, function(err, zone) {
    assert.ifError(err);
    assert.ok(zone);
    assert.equal(zoneAlias, zone.alias);
    log.debug('mapi.test: get_zone_by_alias => %o', zone);
    test.finish();
  });
};


if (zoneAlias)
exports.test_get_zone_by_alias_not_found = function(test, assert) {
  mapi.getZoneByAlias(customer, uuid(), function(err, zone) {
    assert.ok(err);
    assert.ok(!zone);
    assert.equal(err.httpCode, 404);
    assert.equal(err.restCode, 'ResourceNotFound');
    assert.ok(err.message);
    log.debug('mapi.test: get_zone_by_alias_not_found => %o', err);
    test.finish();
  });
};


if (zoneName)
exports.test_get_zone = function(test, assert) {
  mapi.getZone(customer, zoneName, function(err, zone) {
    assert.ifError(err);
    assert.ok(zone);
    assert.equal(zoneName, zone.name);
    log.debug('mapi.test: get_zone => %o', zone);
    test.finish();
  });
};


exports.test_get_zone_not_found = function(test, assert) {
  mapi.getZone(customer, uuid(), function(err, zone) {
    assert.ok(err);
    assert.ok(!zone);
    assert.equal(err.httpCode, 404);
    assert.equal(err.restCode, 'ResourceNotFound');
    assert.ok(err.message);
    log.debug('mapi.test: get_zone_not_found => %o', err);
    test.finish();
  });
};


exports.test_create_zone = function(test, assert) {
  var opts = {
    dataset_uuid: datasetUuid,
    networks: 'external',
    alias: createAlias,
    hostname: 'a' + uuid().substr(0, 6)
  };
  opts['package'] = 'regular_128';
  mapi.createZone(customer, opts, function(err, zone) {
    log.debug('mapi.test: create_zone => e=%o, z=%o', err, zone);
    assert.ifError(err);
    assert.ok(zone);
    assert.equal(opts.alias, zone.alias);
    createdZone = zone.name;
    setTimeout(function() {
      test.finish();
    }, 120 * 1000);
  });
};


exports.test_invalid_zone_state = function(test, assert) {
  mapi.deleteZone(customer, createdZone, function(err) {
    assert.ok(err);
    assert.equal(err.httpCode, 409);
    assert.equal(err.restCode, 'InvalidState');
    assert.ok(err.message);
    log.debug('mapi.test: invalid_zone_state err => %o', err);
    test.finish();
  });
};

exports.test_shutdown_zone = function(test, assert) {
  mapi.shutdownZone(customer, createdZone, function(err) {
    assert.ifError(err);
    setTimeout(function() {
      mapi.shutdownZone(customer, createdZone, function(err) {
        assert.ifError(err);
        test.finish();
      });
    }, 45 * 1000);
  });
};


exports.test_start_zone = function(test, assert) {
  mapi.startupZone(customer, createdZone, function(err) {
    assert.ifError(err);
    setTimeout(function() {
      test.finish();
    }, 45 * 1000);
  });
};


exports.test_reboot_zone = function(test, assert) {
  mapi.rebootZone(customer, createdZone, function(err) {
    assert.ifError(err);
    setTimeout(function() {
      test.finish();
    }, 45 * 1000);
  });
};


exports.test_delete_zone = function(test, assert) {
  mapi.shutdownZone(customer, createdZone, function(err) {
    assert.ifError(err);
    setTimeout(function() {
      mapi.deleteZone(customer, createdZone, function(err) {
        assert.ifError(err);
        test.finish();
      });
    }, 45 * 1000);
  });
};


exports.test_count_vms_all = function(test, assert) {
  mapi.countVMs(customer, function(err, count) {
    assert.ifError(err);
    assert.isDefined(count);
    log.debug('mapi.test: count_vms => %o', count);
    test.finish();
  });
};


exports.test_list_vms = function(test, assert) {
  mapi.listVMs(customer, function(err, vms) {
    assert.ifError(err);
    assert.ok(vms);
    log.debug('mapi.test: list_vms => %o', vms);
    test.finish();
  });
};


exports.test_get_vm_not_found = function(test, assert) {
  mapi.getVM(customer, uuid(), function(err, vm) {
    assert.ok(err);
    assert.ok(!vm);
    assert.equal(err.httpCode, 404);
    assert.equal(err.restCode, 'ResourceNotFound');
    assert.ok(err.message);
    log.debug('mapi.test: get_vm_not_found => %o', err);
    test.finish();
  });
};


exports.test_get_vm_bad_tenant = function(test, assert) {
  mapi.getVM(uuid(), uuid(), function(err, vm) {
    assert.ok(err);
    assert.ok(!vm);
    assert.equal(err.httpCode, 404);
    assert.equal(err.restCode, 'ResourceNotFound');
    assert.ok(err.message);
    log.debug('mapi.test: get_vm_not_found => %o', err);
    test.finish();
  });
};

// NOTE: This test requires not only a provisionable HVM node
// but also a customer with SSH Key in place.
exports.test_create_vm = function(test, assert) {
  var name = 'a' + uuid().substr(0,6);
  var opts = {
    dataset_uuid: '6f6b0a2e-8dcd-11e0-9d84-000c293238eb',
    networks: 'external',
    alias: name,
    hostname: name,
    root_authorized_keys: 'ssh-dss AAAAB3NzaC1kc3MAAACBAJaDBDG/Wtn6aHgTVVLKF0FydITVdtdzlDp0fgnsD9Z7q4/bNWb83Hmlk2/ppfNJlABX2Yrn9f3iO1KbAz/qZ4YgxxDjStdGnPVTbhcrZe6a/dGYWWNJXwX4nFR5st+DuFTbAGPGaN1qujhNLJXuCnxd7ITwmUXACZxGGJhordmpAAAAFQCUooiLG2dN5KwPqyimuvyqmP9GQQAAAIEAken9e9IyyySxFr1SPRc+AelmkvefVE38B93K9Aj0/tJD10OA3T9s4pX/+hhTUt4TgKFO3NYq26q845erLRoKIPEQxBB9f+H0CdDdXpRpvMa/BS3NwYWEGApkKvrjO65NX5mEWlqVu0xkARqTOdlA6xNOa2IrXrICfTHQ/3GU5IgAAACBAIxylgDff72uBfdiGrgO5wZ/Qvxv6CLpm3RWshPBnSv0jcoQVtxuiBK+jpEAneA7dLwJEYnX60CPMoo5Rr6sch3YJGbnpNKQQPXiVvX3slNBReVqv6riMsyAju2BEE2azb0o0fE3qkIWbv0/Gc2sKLJK16zDqbccPlHyBfl3xWtL pedro@joyent.com'
  };
  opts['package'] = 'regular_128';
  mapi.createVM(customer, opts, function(err, vm) {
    log.debug('mapi.test: create_vm => e=%o, vm=%o', err, vm);
    assert.ifError(err);
    assert.ok(vm);
    assert.equal(opts.alias, vm.alias);
    createdVM = vm.name;
    setTimeout(function() {
      test.finish();
    }, 120 * 1000);
  });
};


// Blocked on PROV-831
// exports.test_shutdown_vm = function(test, assert) {
//   mapi.shutdownVM(customer, createdVM, function(err) {
//     log.debug('mapi.test: shutdown_vm => e=%o', err);
//     assert.ifError(err);
//     setTimeout(function() {
//       test.finish();
//     }, 120 * 1000);
//   });
// };


exports.test_delete_vm = function(test, assert) {
  mapi.deleteVM(customer, createdVM, function(err) {
    log.debug('mapi.test: shutdown_vm => e=%o', err);
    assert.ifError(err);
    assert.ok(vm);
    test.finish();
  });
};


exports.tearDown = function(test, assert) {
  test.finish();
};
