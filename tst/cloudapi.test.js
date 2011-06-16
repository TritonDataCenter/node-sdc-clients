// Copyright 2011 Joyent, Inc.  All rights reserved.

var fs = require('fs');

var uuid = require('node-uuid');

var sdcClients = require('../lib/index');
var CloudAPI = sdcClients.CloudAPI;


var LOGIN = 'admin';
var KNAME = 'rsa-1';

var client = null;
var stubClient = null;
var publicKey = null;
var privateKey = null;
var inst = null;


function _trim(str) {
  return str.replace(/^\s*/, '').replace(/\s*$/, '');
}



///--- Start Tests

exports.setUp = function(test, assert) {
  sdcClients.setLogLevel('debug');
  client = new CloudAPI({
    url: 'http://localhost:8080',
    username: 'admin',
    password: 'joypass123'
  });

  var keyFile = process.env.SSH_KEY;
  if (!keyFile)
    keyFile = process.env.HOME + '/.ssh/id_rsa';

  publicKey = _trim(fs.readFileSync(keyFile + '.pub', 'ascii'));
  privateKey = fs.readFileSync(keyFile, 'ascii');
  assert.ok(publicKey);
  assert.ok(privateKey);

  test.finish();
};


///--- Account Tests

exports.test_get_account_no_acct_param = function(test, assert) {
  client.getAccount(function(err, account) {
    assert.ifError(err);
    assert.ok(account);
    assert.equal(account.id, '930896af-bf8c-48d4-885c-6573a94b1853');
    assert.equal(account.firstName, 'Admin');
    assert.equal(account.lastName, 'User');
    assert.equal(account.email, 'user@joyent.com');
    test.finish();
  });
};


exports.test_get_account = function(test, assert) {
  client.getAccount(LOGIN, function(err, account) {
    assert.ifError(err);
    assert.ok(account);
    assert.equal(account.id, '930896af-bf8c-48d4-885c-6573a94b1853');
    assert.equal(account.firstName, 'Admin');
    assert.equal(account.lastName, 'User');
    assert.equal(account.email, 'user@joyent.com');
    test.finish();
  });
};


exports.test_get_account_by_object = function(test, assert) {
  client.getAccount(function(err, account) {
    client.getAccount(account, function(err, account) {
      assert.ifError(err);
      assert.ok(account);
      assert.equal(account.id, '930896af-bf8c-48d4-885c-6573a94b1853');
      assert.equal(account.firstName, 'Admin');
      assert.equal(account.lastName, 'User');
      assert.equal(account.email, 'user@joyent.com');
      test.finish();
    });
  });
};

exports.test_get_account_404 = function(test, assert) {
  client.getAccount(uuid(), function(err, account) {
    assert.ok(err);
    assert.equal(err.code, 'ResourceNotFound');
    assert.ok(err.message);
    test.finish();
  });
};


///--- Keys Tests

exports.test_create_key_no_acct_param_no_name = function(test, assert) {
  var object = {
    key: publicKey
  };
  client.createKey(object, function(err, key) {
    assert.ifError(err);
    assert.ok(key);
    assert.equal(key.name, KNAME);
    assert.equal(key.key, publicKey);
    client.deleteKey(KNAME, function(err) {
      assert.ifError(err);
      test.finish();
    });
  });
};


exports.test_create_key_account_name = function(test, assert) {
  var object = {
    name: 'cloudapi.test.js',
    key: publicKey
  };
  client.createKey(LOGIN, object, function(err, key) {
    assert.ifError(err);
    assert.ok(key);
    assert.equal(key.name, 'cloudapi.test.js');
    assert.equal(key.key, publicKey);
    client.deleteKey('cloudapi.test.js', function(err) {
      assert.ifError(err);
      test.finish();
    });
  });
};


exports.test_create_key_plain_key = function(test, assert) {
  client.createKey(LOGIN, publicKey, function(err, key) {
    assert.ifError(err);
    assert.ok(key);
    assert.equal(key.name, KNAME);
    assert.equal(key.key, publicKey);
    client.deleteKey(KNAME, function(err) {
      assert.ifError(err);
      test.finish();
    });
  });
};


exports.test_create_key_account_404 = function(test, assert) {
  var object = {
    name: 'cloudapi.test.js',
    key: publicKey
  };
  client.createKey(uuid(), publicKey, function(err, key) {
    assert.ok(err);
    assert.ok(!key);
    assert.equal(err.code, 'ResourceNotFound');
    assert.ok(err.message);
    test.finish();
  });
};


exports.test_create_key_bad_key = function(test, assert) {
  client.createKey(uuid(), function(err, key) {
    assert.ok(err);
    assert.ok(!key);
    assert.equal(err.code, 'InvalidArgument');
    assert.ok(err.message);
    test.finish();
  });
};


exports.test_create_key_dup_key = function(test, assert) {
  client.createKey(publicKey, function(err, key) {
    assert.ifError(err);
    assert.ok(key);
    assert.equal(key.name, KNAME);
    assert.equal(key.key, publicKey);

    client.createKey(publicKey, function(err, key) {
      assert.ok(err);
      assert.ok(!key);
      assert.equal(err.code, 'InvalidArgument');
      assert.ok(err.message);
      // Note we're leaving the key in place for the rest
      // of the tests
      test.finish();
    });
  });
};


exports.test_list_keys_no_acct_param = function(test, assert) {
  client.listKeys(function(err, keys) {
    assert.ifError(err);
    assert.ok(keys);
    assert.equal(keys.length, 1);
    assert.equal(keys[0].name, KNAME);
    assert.equal(keys[0].key, publicKey);
    test.finish();
  });
};


exports.test_list_keys = function(test, assert) {
  client.listKeys(LOGIN, function(err, keys) {
    assert.ifError(err);
    assert.ok(keys);
    assert.equal(keys.length, 1);
    assert.equal(keys[0].name, KNAME);
    assert.equal(keys[0].key, publicKey);
    test.finish();
  });
};


exports.test_list_keys_404 = function(test, assert) {
  client.listKeys(uuid(), function(err, keys) {
    assert.ok(err);
    assert.equal(err.code, 'ResourceNotFound');
    assert.ok(err.message);
    test.finish();
  });
};


exports.test_get_key_no_acct_param = function(test, assert) {
  client.getKey(KNAME, function(err, key) {
    assert.ifError(err);
    assert.ok(key);
    assert.equal(key.name, KNAME);
    assert.equal(key.key, publicKey);
    test.finish();
  });
};


exports.test_get_key_no_acct_param_obj = function(test, assert) {
  var obj = {
    name: KNAME,
    key: publicKey
  };
  client.getKey(obj, function(err, key) {
    assert.ifError(err);
    assert.ok(key);
    assert.equal(key.name, KNAME);
    assert.equal(key.key, publicKey);
    test.finish();
  });
};


exports.test_get_key_acct = function(test, assert) {
  client.getKey(LOGIN, KNAME, function(err, key) {
    assert.ifError(err);
    assert.ok(key);
    assert.equal(key.name, KNAME);
    assert.equal(key.key, publicKey);
    test.finish();
  });
};


exports.test_get_key_acct_404 = function(test, assert) {
  client.getKey(uuid(), KNAME, function(err, key) {
    assert.ok(err);
    assert.ok(!key);
    assert.equal(err.code, 'ResourceNotFound');
    assert.ok(err.message);
    test.finish();
  });
};


exports.test_get_key_404 = function(test, assert) {
  client.getKey(uuid(), function(err, key) {
    assert.ok(err);
    assert.ok(!key);
    assert.equal(err.code, 'ResourceNotFound');
    assert.ok(err.message);
    test.finish();
  });
};


///--- Datasets Tests

exports.test_list_datasets_no_acct_param = function(test, assert) {
  client.listDatasets(function(err, datasets) {
    assert.ifError(err);
    assert.ok(datasets);
    assert.ok(datasets.length);
    assert.ok(datasets[0].name);
    assert.ok(datasets[0].id);
    assert.ok(datasets[0].os);
    assert.ok(datasets[0].version);
    assert.ok((datasets[0]['default'] !== undefined));
    test.finish();
  });
};


exports.test_list_datasets = function(test, assert) {
  client.listDatasets(LOGIN, function(err, datasets) {
    assert.ifError(err);
    assert.ok(datasets);
    assert.ok(datasets.length);
    assert.ok(datasets[0].name);
    assert.ok(datasets[0].id);
    assert.ok(datasets[0].os);
    assert.ok(datasets[0].version);
    assert.ok((datasets[0]['default'] !== undefined));
    test.finish();
  });
};


exports.test_list_datasets_404 = function(test, assert) {
  client.listDatasets(uuid(), function(err, datasets) {
    assert.ok(err);
    assert.ok(!datasets);
    assert.equal(err.code, 'ResourceNotFound');
    assert.ok(err.message);
    test.finish();
  });
};


exports.test_get_dataset_no_acct_param = function(test, assert) {
  client.listDatasets(function(err, datasets) {
    assert.ifError(err);
    assert.ok(datasets);
    assert.ok(datasets.length);
    client.getDataset(datasets[0], function(err, dataset) {
      assert.ifError(err);
      assert.ok(dataset);
      assert.ok(datasets[0].name, datasets.name);
      assert.ok(datasets[0].id, dataset.id);
      assert.ok(datasets[0].os, dataset.os);
      assert.ok(datasets[0].version, dataset.version);
      assert.equal(datasets[0]['default'], dataset['default']);
      test.finish();
    });
  });
};


exports.test_get_dataset_no_acct_param_by_name = function(test, assert) {
  client.listDatasets(function(err, datasets) {
    assert.ifError(err);
    assert.ok(datasets);
    assert.ok(datasets.length);
    client.getDataset(datasets[0].id, function(err, dataset) {
      assert.ifError(err);
      assert.ok(dataset);
      assert.ok(datasets[0].name, datasets.name);
      assert.ok(datasets[0].id, dataset.id);
      assert.ok(datasets[0].os, dataset.os);
      assert.ok(datasets[0].version, dataset.version);
      assert.equal(datasets[0]['default'], dataset['default']);
      test.finish();
    });
  });
};


exports.test_get_dataset_by_name = function(test, assert) {
  client.listDatasets(function(err, datasets) {
    assert.ifError(err);
    assert.ok(datasets);
    assert.ok(datasets.length);
    client.getDataset(LOGIN, datasets[0].id, function(err, dataset) {
      assert.ifError(err);
      assert.ok(dataset);
      assert.ok(datasets[0].name, datasets.name);
      assert.ok(datasets[0].id, dataset.id);
      assert.ok(datasets[0].os, dataset.os);
      assert.ok(datasets[0].version, dataset.version);
      assert.equal(datasets[0]['default'], dataset['default']);
      test.finish();
    });
  });
};


exports.test_get_dataset_by_name_acct_404 = function(test, assert) {
  client.listDatasets(function(err, datasets) {
    assert.ifError(err);
    assert.ok(datasets);
    assert.ok(datasets.length);
    client.getDataset(uuid(), datasets[0].id, function(err, dataset) {
      assert.ok(err);
      assert.ok(!dataset);
      assert.equal(err.code, 'ResourceNotFound');
      assert.ok(err.message);
      test.finish();
    });
  });
};



///--- Packages Tests

exports.test_list_packages_no_acct_param = function(test, assert) {
  client.listPackages(function(err, packages) {
    assert.ifError(err);
    assert.ok(packages);
    assert.ok(packages.length);
    assert.ok(packages[0].name);
    assert.ok(packages[0].memory);
    assert.ok(packages[0].disk);
    assert.ok((packages[0]['default'] !== undefined));
    test.finish();
  });
};


exports.test_list_packages = function(test, assert) {
  client.listPackages(LOGIN, function(err, packages) {
    assert.ifError(err);
    assert.ok(packages);
    assert.ok(packages.length);
    assert.ok(packages[0].name);
    assert.ok(packages[0].memory);
    assert.ok(packages[0].disk);
    assert.ok((packages[0]['default'] !== undefined));
    test.finish();
  });
};


exports.test_list_packages_404 = function(test, assert) {
  client.listPackages(uuid(), function(err, packages) {
    assert.ok(err);
    assert.ok(!packages);
    assert.equal(err.code, 'ResourceNotFound');
    assert.ok(err.message);
    test.finish();
  });
};


exports.test_get_package_no_acct_param = function(test, assert) {
  client.listPackages(function(err, packages) {
    assert.ifError(err);
    assert.ok(packages);
    assert.ok(packages.length);
    client.getPackage(packages[0], function(err, pkg) {
      assert.ifError(err);
      assert.ok(pkg);
      assert.equal(packages[0].name, pkg.name);
      assert.equal(packages[0].memory, pkg.memory);
      assert.equal(packages[0].disk, pkg.disk);
      assert.equal(packages[0]['default'], pkg['default']);
      test.finish();
    });
  });
};


exports.test_get_package_no_acct_param_by_name = function(test, assert) {
  client.listPackages(function(err, packages) {
    assert.ifError(err);
    assert.ok(packages);
    assert.ok(packages.length);
    client.getPackage(packages[0].name, function(err, pkg) {
      assert.ifError(err);
      assert.ok(pkg);
      assert.equal(packages[0].name, pkg.name);
      assert.equal(packages[0].memory, pkg.memory);
      assert.equal(packages[0].disk, pkg.disk);
      assert.equal(packages[0]['default'], pkg['default']);
      test.finish();
    });
  });
};


exports.test_get_package_by_name = function(test, assert) {
  client.listPackages(function(err, packages) {
    assert.ifError(err);
    assert.ok(packages);
    assert.ok(packages.length);
    client.getPackage(LOGIN, packages[0].name, function(err, pkg) {
      assert.ifError(err);
      assert.ok(pkg);
      assert.equal(packages[0].name, pkg.name);
      assert.equal(packages[0].memory, pkg.memory);
      assert.equal(packages[0].disk, pkg.disk);
      assert.equal(packages[0]['default'], pkg['default']);
      test.finish();
    });
  });
};


exports.test_get_package_by_name_acct_404 = function(test, assert) {
  client.listPackages(function(err, packages) {
    assert.ifError(err);
    assert.ok(packages);
    assert.ok(packages.length);
    client.getPackage(uuid(), packages[0].name, function(err, pkg) {
      assert.ok(err);
      assert.ok(!pkg);
      assert.equal(err.code, 'ResourceNotFound');
      assert.ok(err.message);
      test.finish();
    });
  });
};


exports.test_get_package_by_name_404 = function(test, assert) {
  client.listPackages(function(err, packages) {
    assert.ifError(err);
    assert.ok(packages);
    assert.ok(packages.length);
    client.getPackage(uuid(), function(err, pkg) {
      assert.ok(err);
      assert.ok(!pkg);
      assert.equal(err.code, 'ResourceNotFound');
      assert.ok(err.message);
      test.finish();
    });
  });
};


exports.test_get_package_by_name_404 = function(test, assert) {
  client.listPackages(function(err, packages) {
    assert.ifError(err);
    assert.ok(packages);
    assert.ok(packages.length);
    client.getPackage(uuid(), function(err, pkg) {
      assert.ok(err);
      assert.ok(!pkg);
      assert.equal(err.code, 'ResourceNotFound');
      assert.ok(err.message);
      test.finish();
    });
  });
};


///--- Datacenters Tests

exports.test_list_datacenters_no_acct_param = function(test, assert) {
  client.listDatacenters(function(err, datacenters) {
    assert.ifError(err);
    assert.ok(datacenters);
    assert.ok(datacenters.coal);
    test.finish();
  });
};


exports.test_list_datacenters = function(test, assert) {
  client.listDatacenters(LOGIN, function(err, datacenters) {
    assert.ifError(err);
    assert.ok(datacenters);
    assert.ok(datacenters.coal);
    test.finish();
  });
};


exports.test_list_datacenters_404 = function(test, assert) {
  client.listDatacenters(uuid(), function(err, datacenters) {
    assert.ok(err);
    assert.ok(!datacenters);
    assert.equal(err.code, 'ResourceNotFound');
    assert.ok(err.message);
    test.finish();
  });
};


exports.test_create_datacenter_client_no_acct_param = function(test, assert) {
  // NoOp this shit to test API parameterization...
  // We're going to use the client in some of the machines test.
  process.env.SDC_TESTING = true;

  client.createClientForDatacenter('coal', function(err, newClient) {
    assert.ifError(err);
    assert.ok(newClient);
    assert.ok(newClient.listDatacenters);
    stubClient = newClient;
    test.finish();
  });
};


///--- Machines Tests

exports.stub_test_create_machine_no_params = function(test, assert) {
  assert.ok(stubClient);
  stubClient.createMachine(function(err, machine) {
    assert.ifError(err);
    assert.ok(machine);
    test.finish();
  });
};


exports.stub_test_create_machine_no_account = function(test, assert) {
  assert.ok(stubClient);
  stubClient.createMachine({}, function(err, machine) {
    assert.ifError(err);
    assert.ok(machine);
    test.finish();
  });
};


exports.stub_test_create_machine = function(test, assert) {
  assert.ok(stubClient);
  stubClient.createMachine(LOGIN, {}, function(err, machine) {
    assert.ifError(err);
    assert.ok(machine);
    test.finish();
  });
};


exports.stub_test_create_machine_opts_string = function(test, assert) {
  assert.ok(stubClient);
  var opts = {
    dataset: 'stub'
  };
  opts['package'] = 'regular_128';
  stubClient.createMachine(LOGIN, opts, function(err, machine) {
    assert.ifError(err);
    assert.ok(machine);
    test.finish();
  });
};


exports.stub_test_create_machine_opts_obj = function(test, assert) {
  assert.ok(stubClient);
  var opts = {
    dataset: {
      id: 'stub'
    }
  };
  opts['package'] = {
    name: 'regular_128'
  };
  stubClient.createMachine(LOGIN, opts, function(err, machine) {
    assert.ifError(err);
    assert.ok(machine);
    test.finish();
  });
};


// Do real machine creation tests

if (!process.env.NO_PROVISION_TESTS)
exports.test_create_machine_acct_404 = function(test, assert) {
  client.createMachine(uuid(), {}, function(err, machine) {
    assert.ok(err);
    assert.ok(!machine);
    assert.equal(err.code, 'ResourceNotFound');
    assert.ok(err.message);
    test.finish();
  });
};

if (!process.env.NO_PROVISION_TESTS)
exports.test_create_machine = function(test, assert) {
  var opts = {
    name: 'unitTest'
  };
  client.createMachine(opts, function(err, machine) {
    assert.ifError(err);
    assert.ok(machine);
    assert.ok(machine.id);
    assert.equal(machine.name, 'unitTest');
    assert.equal(machine.type, 'smartmachine');
    assert.equal(machine.owner, 'admin');
    assert.equal(machine.state, 'provisioning');
    assert.ok(machine.memory);
    assert.ok(machine.disk);
    assert.ok(machine.ips);
    test.finish();
  });
};


exports.test_list_machines = function(test, assert) {
  var opts = {
    type: 'smartmachine'
  };
  client.listMachines(opts, function(err, machines) {
    assert.ifError(err);
    assert.ok(machines);
    assert.ok(machines.length);
    assert.ok(machines[0].id);
    assert.equal(machines[0].type, 'smartmachine');
    assert.ok(machines[0].owner);
    assert.ok(machines[0].state);
    assert.ok(machines[0].memory);
    assert.ok(machines[0].disk);
    assert.ok(machines[0].ips);
    test.finish();
  });
};


exports.test_get_machine_by_object = function(test, assert) {
  client.listMachines(function(err, machines) {
    assert.ifError(err);
    assert.ok(machines);
    assert.ok(machines.length);
    assert.ok(machines[0].id);
    client.getMachine(machines[0], function(err, machine) {
      assert.ifError(err);
      assert.ok(machine);
      assert.equal(machines[0].id, machine.id);
      assert.equal(machines[0].type, machine.type);
      assert.equal(machines[0].owner, machine.owner);
      assert.equal(machines[0].name, machine.name);
      assert.equal(machines[0].disk, machine.disk);
      assert.ok(machine.state);
      assert.ok(machine.ips);
      test.finish();
    });
  });
};


exports.test_get_machine_by_id = function(test, assert) {
  client.listMachines(function(err, machines) {
    assert.ifError(err);
    assert.ok(machines);
    assert.ok(machines.length);
    assert.ok(machines[0].id);
    client.getMachine(machines[0].id, function(err, machine) {
      assert.ifError(err);
      assert.ok(machine);
      assert.equal(machines[0].id, machine.id);
      assert.equal(machines[0].type, machine.type);
      assert.equal(machines[0].owner, machine.owner);
      assert.equal(machines[0].name, machine.name);
      assert.equal(machines[0].disk, machine.disk);
      assert.ok(machine.state);
      assert.ok(machine.ips);
      test.finish();
    });
  });
};


exports.test_get_machine_404 = function(test, assert) {
  client.getMachine(uuid(), function(err, machine) {
    assert.ok(err);
    assert.ok(!machine);
    assert.equal(err.code, 'ResourceNotFound');
    assert.ok(err.message);
    test.finish();
  });
};


if (!process.env.NO_PROVISION_TESTS)
exports.test_shutdown_machine = function(test, assert) {
  client.listMachines(function(err, machines) {
    assert.ifError(err);
    assert.ok(machines);
    assert.ok(machines.length);
    assert.ok(machines[0].id);
    client.stopMachine(machines[0], function(err) {
      assert.ifError(err);
      setTimeout(function() {
        test.finish();
      }, 3000);
    });
  });
};


if (!process.env.NO_PROVISION_TESTS)
exports.test_delete_machine = function(test, assert) {
  client.listMachines(function(err, machines) {
    assert.ifError(err);
    assert.ok(machines);
    assert.ok(machines.length);
    assert.ok(machines[0].id);
    client.deleteMachine(machines[0], function(err) {
      assert.ifError(err);
      test.finish();
    });
  });
};


///--- Analytics Tests

exports.test_get_metrics = function(test, assert) {
  client.describeAnalytics(function(err, metrics) {
    assert.ifError(err);
    assert.ok(metrics);
    test.finish();
  });
};


exports.test_create_inst = function(test, assert) {
  var opts = {
    module: 'fs',
    stat: 'logical_ops',
    decomposition: 'latency'
  };
  client.createInstrumentation(LOGIN, opts, function(err, newInst) {
    assert.ifError(err);
    inst = newInst;
    assert.ok(inst);
    assert.ok(inst.id);
    test.finish();
  });
};


exports.test_get_inst = function(test, assert) {
  client.getInstrumentation(inst, function(err, inst2) {
    assert.ifError(err);
    assert.ok(inst);
    assert.equal(inst.id, inst.id);
    test.finish();
  });
};


exports.test_list_inst = function(test, assert) {
  client.listInstrumentations(function(err, insts) {
    assert.ifError(err);
    assert.ok(insts);
    assert.ok(insts.length);
    test.finish();
  });
};


exports.test_list_inst_404 = function(test, assert) {
  client.listInstrumentations(uuid(), function(err, insts) {
    assert.ok(err);
    assert.ok(!insts);
    assert.equal(err.code, 'ResourceNotFound');
    assert.ok(err.message);
    test.finish();
  });
};


exports.test_get_inst_value = function(test, assert) {
  client.getInstrumentationValue(inst, function(err, value) {
    assert.ifError(err);
    assert.ok(value);
    test.finish();
  });
};


exports.test_get_inst_hmap = function(test, assert) {
  client.getInstrumentationHeatmap(inst, function(err, hmap) {
    assert.ifError(err);
    assert.ok(hmap.image);
    test.finish();
  });
};


exports.test_get_inst_hmap_details = function(test, assert) {
  var opts = {
    x: 4,
    y: 5
  };
  client.getInstrumentationHeatmapDetails(inst, opts, function(err, hmap) {
    assert.ifError(err);
    assert.ok(hmap.image);
    test.finish();
  });
};


exports.test_del_inst = function(test, assert) {
  client.deleteInstrumentation(inst, function(err) {
    assert.ifError(err);
    test.finish();
  });
};


///--- Tests Done

exports.tearDown = function(test, assert) {
  client.listKeys(function(err, keys) {
    assert.ifError(err);
    if (!keys || !keys.length)
      return test.finish();

    var done = 0;
    keys.forEach(function(k) {
      client.deleteKey(k, function(err) {
        assert.ifError(err);
        if (++done >= keys.length)
          test.finish();
      });
    });
  });
};
