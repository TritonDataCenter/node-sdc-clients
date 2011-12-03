var sys = require('sys');
var sdcClients = require('../lib/index');
var Amon = sdcClients.Amon;

var amon = null;

//TODO: change this to the actualy COAL URL once we move to COAL
var AMON_URL = 'http://localhost:8080';

// we hijack the admin user since it's always going to exist
var ADMIN_UUID = '930896af-bf8c-48d4-885c-6573a94b1853';

var CONTACT = {
  'name' : 'test-contact',
  'medium' : 'email',
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


var cleanupAccount = function(test, assert) {
  // delete all contacts
  amon.listContacts(ADMIN_UUID, function(err, contacts) {
    contacts.forEach(function(contacts) {
      sys.puts(contacts.name);
      amon.deleteContact(ADMIN_UUID, contacts.name, function(err) {
        assert.ifError(err);
      });
    });
  });
  
  amon.listMonitors(ADMIN_UUID, function(err, monitors) {
    monitors.forEach(function(monitor) {
      sys.puts(monitor.name);
      // for each monitor, list and delete its probes
      amon.listProbes(ADMIN_UUID, monitor.name, function(err, probes) {
        // delete the probes
        probes.forEach(function(probe) {
          sys.puts(probe.name);
          amon.deleteProbe(ADMIN_UUID, monitor.name, probe.name, function(err) {
            assert.ifError(err);
          });
        });
      });

       // delete the monitors
      amon.deleteMonitor(ADMIN_UUID, monitor.name, function(err) {
          test.finish();
      });
    });
  });
};

exports.setUp = function(test, assert) {
  sdcClients.setLogLevel('trace');
  amon = new Amon({
    url: AMON_URL
  });
  
  cleanupAccount(test, assert);
  test.finish();
};

exports.test_get_user = function(test, assert) {
  amon.getUser(ADMIN_UUID, function(err, user) {
    assert.ifError(err);
    test.finish();
  });
};

exports.test_contact_crud = function(test, assert) {
  amon.putContact(ADMIN_UUID, CONTACT, function(err, contact) {
    assert.ifError(err);
    assert.ok(contact);
    assert.equal(contact.name, CONTACT.name);
    assert.equal(contact.medium, CONTACT.medium);
    assert.equal(contact.data, CONTACT.data);

    amon.getContact(ADMIN_UUID, CONTACT.name, function(err, contact) {
      assert.ifError(err);
      assert.ok(contact);
      assert.equal(contact.name, CONTACT.name);
      assert.equal(contact.medium, CONTACT.medium);
      assert.equal(contact.data, CONTACT.data);
      // TODO: update is currently broken server side. add update when it's
      // fixed
      amon.deleteContact(ADMIN_UUID, CONTACT.name, function(err) {
        assert.ifError(err);
        amon.getContact(ADMIN_UUID, CONTACT.name, function(err) {
          assert.equal(err.httpCode, 404);
        });
        test.finish();
      });
    });
  });
};

exports.test_list_contacts = function(test, assert) {
  amon.putContact(ADMIN_UUID, CONTACT_2, function(err, contact) {
    assert.ifError(err);

    amon.putContact(ADMIN_UUID, CONTACT, function(err, contact) {
      assert.ifError(err);

      amon.listContacts(ADMIN_UUID, function(err, contacts) {
        assert.ifError(err);
        assert.ok(contacts);
        assert.equal(contacts.length, 2, 'Found more than 2 contacts');

        amon.deleteContact(ADMIN_UUID, CONTACT.name, function(err) {
          assert.ifError(err);

          amon.deleteContact(ADMIN_UUID, CONTACT_2.name, function(err) {
            assert.ifError(err);
            test.finish();
          });
        });
      });
    });
  });
};

exports.test_put_monitor = function(test, assert) {
  amon.putMonitor(ADMIN_UUID, MONITOR, function(err, monitor) {
    assert.ifError(err);
    assert.ok(monitor);
    assert.equal(monitor.name, MONITOR.name);
    assert.equal(monitor.medium, MONITOR.medium);
    test.finish();
  });
};

exports.test_put_probe = function(test, assert) {
  amon.putProbe(ADMIN_UUID, MONITOR.name, PROBE, function(err, probe) {
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
  amon.putProbe(ADMIN_UUID, MONITOR.name, PROBE_2, function(err, probe) {
    assert.ifError(err);
    assert.ok(probe);
    
    amon.listProbes(ADMIN_UUID, MONITOR.name, function(err, probes) {
      assert.ifError(err);
      assert.ok(probes);
      assert.equal(probes.length, 2);

      amon.deleteProbe(ADMIN_UUID, MONITOR.name, PROBE_2.name, function(err) {
         assert.ifError(err);
         test.finish();
       });
    });
  });
};

exports.test_get_probe = function(test, assert) {
  amon.getProbe(ADMIN_UUID, MONITOR.name, PROBE.name, function(err, probe) {
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
  amon.deleteProbe(ADMIN_UUID, MONITOR.name, PROBE.name, function(err) {
    assert.ifError(err);
    amon.getProbe(ADMIN_UUID, MONITOR.name, PROBE.name, function(err) {
      assert.equal(err.httpCode, 404);
    });

    test.finish();
  });
};

exports.test_list_monitors = function(test, assert) {
  amon.putMonitor(ADMIN_UUID, MONITOR_2, function(err, monitor) {
    assert.ifError(err);
    amon.listMonitors(ADMIN_UUID, function(err, monitors) {
      assert.ifError(err);
      assert.ok(monitors);
      assert.equal(monitors.length, 2, 'Found more than 2 monitors');
      amon.deleteMonitor(ADMIN_UUID, MONITOR_2.name, function(err) {
        assert.ifError(err);
        test.finish();
      });
    });
  });
};

exports.test_get_monitor = function(test, assert) {
  amon.getMonitor(ADMIN_UUID, MONITOR.name, function(err, monitor) {
    assert.ifError(err);
    assert.ok(monitor);
    assert.equal(monitor.name, MONITOR.name);
    assert.equal(monitor.medium, MONITOR.medium);
    test.finish();
  });
};

exports.test_delete_monitor = function(test, assert) {
  amon.deleteMonitor(ADMIN_UUID, MONITOR.name, function(err) {
    assert.ifError(err);
    amon.getMonitor(ADMIN_UUID, MONITOR.name, function(err) {
      assert.equal(err.httpCode, 404);
    });
    test.finish();
  });
};

exports.tearDown = function(test, assert) {
  // delete all contacts, monitors and probes associated with admin-user
  cleanupAccount();
  test.finish();
};