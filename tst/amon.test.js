var sys = require('sys');
var sdcClients = require('../lib/index');
var Amon = sdcClients.AMON;
var querystring = require('querystring');

var amon = null;

//TODO: change this to the actualy COAL URL once we move to COAL
var AMON_URL = 'http://localhost:8080';

var USER = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

var CONTACT = {
  'name' : 'test-contact',
  'medium' :  'email',
  'data' : 'foo@bar.com'
};

var CONTACT_2 = {
   'name' : 'email',
   'medium' : 'email',
   'data' : '"Yunong Xiao" <yunong+amon@joyent.com>' 
};

var MONITOR = {
  'name' : 'test-monitor',
  'contacts': ['testcontact']
};

var MONITOR_2 = {
   'name': 'yunong-monitor', 
   'contacts': [ 'email' ] 
};

var PROBE = {
  'name': 'test-probe',
  'user': USER,
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
  'user': USER,
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

exports.setUp = function(test, assert) {
  sdcClients.setLogLevel('trace');
  amon = new Amon({
    url: AMON_URL
  });
  
  test.finish();
};

exports.test_get_user = function(test, assert) {
  amon.getUser(USER, function(err, user){
    assert.ifError(err);
    test.finish();
  });
};

exports.test_list_contacts = function(test, assert) {
  var c = CONTACT;
  amon.listContacts(USER, function(err, contacts){
    assert.ifError(err);
    assert.ok(contacts);
    assert.equal(contacts.length, 1, 'Found more than 1 contacts');
    assert.equal(contacts[0].name, CONTACT_2.name);
    assert.equal(contacts[0].contact, CONTACT_2.contact);
    test.finish();
  });
};

exports.test_create_contact = function(test, assert) {
  amon.createContact(USER, CONTACT, function(err, contact) {
    assert.ifError(err);
    assert.ok(contact);
    assert.equal(contact.name, CONTACT.name);
    assert.equal(contact.medium, CONTACT.medium);
    assert.equal(contact.data, CONTACT.data);
    test.finish();
  });
};

exports.test_get_contact = function(test, assert) {
  amon.getContact(USER, CONTACT.name, function(err, contact) {
    assert.ifError(err);
    assert.ok(contact);
    assert.equal(contact.name, CONTACT.name);
    assert.equal(contact.medium, CONTACT.medium);
    assert.equal(contact.data, CONTACT.data);
    test.finish();
  });
};

exports.test_delete_contact = function(test, assert) {
  amon.deleteContact(USER, CONTACT.name, function(err) {
    assert.ifError(err);
    amon.getContact(USER, CONTACT.name, function(err) {
      assert.equal(err.httpCode, 404);
    });
    test.finish();
  });
};

exports.test_list_monitors = function(test, assert) {
  amon.listMonitors(USER, function(err, monitors) {
    assert.ifError(err);
    assert.ok(monitors);
    assert.equal(monitors.length, 1, 'Found more than 1 monitors');
    assert.equal(monitors[0].name, MONITOR_2.name);
    assert.equal(monitors[0].medium, MONITOR_2.medium);
    test.finish();
  });
};

exports.test_create_monitor = function(test, assert) {
  amon.createMonitor(USER, MONITOR, function(err, monitor) {
    assert.ifError(err);
    assert.ok(monitor);
    assert.equal(monitor.name, MONITOR.name);
    assert.equal(monitor.medium, MONITOR.medium);
    test.finish();
  });
};

exports.test_create_probe = function(test, assert) {
  amon.createProbe(USER, MONITOR.name, PROBE, function(err, probe) {
    sys.puts(sys.inspect(probe));
    assert.ifError(err);
    assert.ok(probe);
    assert.equal(probe.name, PROBE.name);
    assert.equal(probe.monitor, PROBE.monitor);
    assert.equal(probe.zone, PROBE.zone);
    assert.equal(probe.urn, PROBE.urn);
    assert.equal(probe.data.path, PROBE.data.path);                           
    assert.equal(probe.data.regex, PROBE.data.regex);
    assert.equal(probe.data.threshold, PROBE.data.threshold);
    assert.equal(probe.data.period, PROBE.data.period);
    test.finish();
  });
};

exports.test_list_probes = function(test, assert) {
  amon.listProbes(USER, MONITOR.name, function(err, probes) {
    assert.ifError(err);
    assert.ok(probes);
    assert.equal(probes.length, 1);
    var probe = probes[0];
    assert.ok(probe);
    assert.equal(probe.name, PROBE.name);
    assert.equal(probe.monitor, PROBE.monitor);
    assert.equal(probe.zone, PROBE.zone);
    assert.equal(probe.urn, PROBE.urn);
    assert.equal(probe.data.path, PROBE.data.path);                           
    assert.equal(probe.data.regex, PROBE.data.regex);
    assert.equal(probe.data.threshold, PROBE.data.threshold);
    assert.equal(probe.data.period, PROBE.data.period);
    test.finish();
  });
};

exports.test_get_probe = function(test, assert) {
  amon.getProbe(USER, MONITOR.name, PROBE.name, function(err, probe) {
    assert.ifError(err);
    assert.ok(probe);
    assert.equal(probe.name, PROBE.name);
    assert.equal(probe.monitor, PROBE.monitor);
    assert.equal(probe.zone, PROBE.zone);
    assert.equal(probe.urn, PROBE.urn);
    assert.equal(probe.data.path, PROBE.data.path);                           
    assert.equal(probe.data.regex, PROBE.data.regex);
    assert.equal(probe.data.threshold, PROBE.data.threshold);
    assert.equal(probe.data.period, PROBE.data.period);
    test.finish();
  });
};

exports.test_delete_probe = function(test, assert) {
  amon.deleteProbe(USER, MONITOR.name, PROBE.name, function(err) {
    assert.ifError(err);
    amon.getProbe(USER, MONITOR.name, PROBE.name, function(err) {
      assert.equal(err.httpCode, 404);
    });
    
    test.finish();
  });
};

exports.test_get_monitor = function(test, assert) {
  amon.getMonitor(USER, MONITOR.name, function(err, monitor) {
    assert.ifError(err);
    assert.ok(monitor);
    assert.equal(monitor.name, MONITOR.name);
    assert.equal(monitor.medium, MONITOR.medium);
    test.finish();
  });
};

exports.test_delete_monitor = function(test, assert) {
  amon.deleteMonitor(USER, MONITOR.name, function(err) {
    assert.ifError(err);
    amon.getMonitor(USER, MONITOR.name, function(err) {
       assert.equal(err.httpCode, 404);
    });
    test.finish();
  });
};