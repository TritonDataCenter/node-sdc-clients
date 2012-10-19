// Copyright 2012 Joyent, Inc.  All rights reserved.
//

var assert = require('assert');
var fs = require('fs');
var sprintf = require('util').format;
var util = require('util');
var uuid = require('node-uuid');
var vasync = require('vasync');

var Config = require('../lib/config');

if (require.cache[__dirname + '/helper.js'])
    delete require.cache[__dirname + '/helper.js'];
var helper = require('./helper.js');


// --- Globals

var test = helper.test;

var client, role, zoneid;
role = 'testsvc-' + uuid.v4().substr(0, 8);
zoneid = uuid.v4();

var UFDS_IP = process.env.UFDS_IP || '10.2.206.10'; // bh1-kvm6

var options = {
    ufds: {
        url: 'ldaps://' + UFDS_IP,
        bindDN: 'cn=root',
        bindCredentials: 'secret'
    },
    log: helper.log
};

var CONFIG = {
    'robot': 'Bender',
    'good_news_everyone': true,
    'year': 3000,
    'staff': [ 'Leela', 'Zoidberg', 'Amy', 'Fry' ],
    'characters': {
        'Calculon': {
            'acting_talent': 'incredible'
        },
        'Donbot': {
           'says': 'Their desire to keep living shows me no respect.'
        },
        'Clamps': {
            'num': 2
        }
    }
};

// -- Setup

test('setup client', function (t) {
    client = new Config(options);
    t.ok(client);
    t.done();
});


// -- Basic tests

test('lookup nonexistent role', function (t) {
    client.lookupFile('notarole', function (err, results) {
        t.ifError(err);
        t.deepEqual(results, {});
        t.done();
    });
});

test('lookup nonexistent role w/ empty options', function (t) {
    client.lookupFile('notarole', {}, function (err, results) {
        t.ifError(err);
        t.deepEqual(results, {});
        t.done();
    });
});

test('lookup nonexistent zone', function (t) {
    var opts = {};
    opts.zoneid = uuid.v4();

    client.lookupFile('notarole', opts, function (err, results) {
        t.ifError(err);
        t.deepEqual(results, {});
        t.done();
    });
});

test('lookup nonexistent tag', function (t) {
    client.lookupFile('notarole', { tag: uuid.v4() }, function (err, results) {
        t.ifError(err);
        t.deepEqual(results, {});
        t.done();
    });
});


// -- Test config files

var nsswitch = '/etc/nsswitch.conf';
var resolv = '/etc/resolv.conf';
var nsswitch_contents, resolv_contents;

test('put text config file', function (t) {
    nsswitch_contents = fs.readFileSync(nsswitch, 'ascii');

    var file = {};
    file.service = 'nsswitch';
    file.type = 'text';
    file.contents = nsswitch_contents;
    file.path = nsswitch;

    client.putFile(file, role, function (err) {
        t.ifError(err);
        t.done();
    });
});

test('lookup config file', function (t) {
    client.lookupFile(role, function (err, res) {
        t.ifError(err);

        t.equal(res['nsswitch'].path, nsswitch);
        t.equal(res['nsswitch'].contents, nsswitch_contents);
        t.equal(res['nsswitch'].type, 'text');

        t.done();
    });
});

test('lookup config file w/empty options', function (t) {
    client.lookupFile(role, {}, function (err, res) {
        t.ifError(err);

        t.equal(res['nsswitch'].path, nsswitch);
        t.equal(res['nsswitch'].contents, nsswitch_contents);
        t.equal(res['nsswitch'].type, 'text');

        t.done();
    });
});

test('put another text config file', function (t) {
    resolv_contents = fs.readFileSync(resolv, 'ascii');

    var file = {};
    file.service = 'resolv';
    file.type = 'text';
    file.contents = resolv_contents;
    file.path = resolv;

    client.putFile(file, role, function (err) {
        t.ifError(err);
        t.done();
    });
});

test('lookup config files', function (t) {
    client.lookupFile(role, function (err, res) {
        t.ifError(err);

        t.equal(res['nsswitch'].path, nsswitch);
        t.equal(res['nsswitch'].contents, nsswitch_contents);
        t.equal(res['nsswitch'].type, 'text');

        t.equal(res['resolv'].path, resolv);
        t.equal(res['resolv'].contents, resolv_contents);
        t.equal(res['resolv'].type, 'text');

        t.done();
    });
});

test('put JSON config file', function (t) {
    var file = {};
    file.service = 'mako';
    file.type = 'json';
    file.contents = CONFIG;
    file.path = '/opt/smartdc/mako/etc/config.json';

    client.putFile(file, role, function (err) {
        t.ifError(err);
        t.done();
    });
});

test('lookup config files yet again', function (t) {
    client.lookupFile(role, function (err, res) {
        t.ifError(err);

        t.equal(res['nsswitch'].path, nsswitch);
        t.equal(res['nsswitch'].contents, nsswitch_contents);
        t.equal(res['nsswitch'].type, 'text');

        t.equal(res['resolv'].path, resolv);
        t.equal(res['resolv'].contents, resolv_contents);
        t.equal(res['resolv'].type, 'text');

        t.equal(res['mako'].path, '/opt/smartdc/mako/etc/config.json');
        t.deepEqual(res['mako'].contents, CONFIG);
        t.equal(res['mako'].type, 'json');

        t.done();
    });
});

test('delete one config file', function (t) {
    client.deleteFile('resolv', role, function (err) {
        t.ifError(err);
        t.done();
    });
});

test('delete nonexistent config file', function (t) {
    client.deleteFile('resolv', role, function (err) {
        t.ok(err);
        t.ok(err.message);
        t.done();
    });
});

test('delete bogus config file', function (t) {
    client.deleteFile('bogus', role, function (err) {
        t.ok(err);
        t.ok(err.message);
        t.done();
    });
});

test('delete bogus config file from bogus role', function (t) {
    client.deleteFile('bogus', 'bogusrole', function (err) {
        t.ok(err);
        t.ok(err.message);
        t.done();
    });
});

test('lookup config files one last time', function (t) {
    client.lookupFile(role, function (err, res) {
        t.ifError(err);

        t.equal(res['nsswitch'].path, nsswitch);
        t.equal(res['nsswitch'].contents, nsswitch_contents);
        t.equal(res['nsswitch'].type, 'text');

        t.ok(!res['resolv']);

        t.equal(res['mako'].path, '/opt/smartdc/mako/etc/config.json');
        t.deepEqual(res['mako'].contents, CONFIG);
        t.equal(res['mako'].type, 'json');

        t.done();
    });
});

test('delete the rest of config files', function (t) {
    client.deleteFile('mako', role, function (err) {
        t.ifError(err);
        client.deleteFile('nsswitch', role, function (suberr) {
            t.ifError(suberr);
            t.done();
        });
    });
});

test('lookup returns an empty object', function (t) {
    client.lookupFile(role, function (err, res) {
        console.log(res);
        t.equal(Object.keys(res).length, 0);
        t.done();
    });
});

test('put file to be written locally', function (t) {
    var file = {};
    file.service = 'dummy';
    file.type = 'json';
    file.contents = {
        foo: 'bar',
        baz: true,
        myArray: [ 1, 2, 3 ]
    };
    file.path = sprintf('/tmp/dummy.%s.json', role);

    var config;

    var put = function (_, cb) {
        client.putFile(file, role, function (err) {
            t.ifError(err);
            return (cb(null));
        });
    };

    var lookup = function (_, cb) {
        client.lookupFile(role, function (err, result) {
            t.ifError(err);
            config = result;
            return (cb(null));
        });
    };

    var writeFile = function (_, cb) {
        client.writeFile(config.dummy, { norefresh: true }, function (err) {
            t.ifError(err);
            return (cb(null));
        });
    };

    var verify = function (_, cb) {
        fs.readFile(file.path, 'ascii', function (err, contents) {
            var obj = JSON.parse(contents);
            t.deepEqual(obj, config[file.service].contents);
            return (cb(null));
        });
    };

    var unlink = function (_, cb) {
        fs.unlink(file.path, function (err) {
            t.ifError(err);
            return (cb(null));
        });
    };

    vasync.pipeline({
        funcs: [
            put,
            lookup,
            writeFile,
            verify,
            unlink
        ]
    }, function (err, results) {
        t.ifError(err);
        t.done();
    });
});

var newrole = 'testsvc-' + uuid.v4().substr(0, 8);
var newzoneid = uuid.v4();

test('put file for zone w/o putting file for role first', function (t) {
    var file = {};
    file.service = 'nsswitch';
    file.type = 'text';
    file.contents = nsswitch_contents;
    file.path = nsswitch;

    var opts = {};
    opts.zoneid = newzoneid;

    client.putFile(file, newrole, opts, function (err) {
        t.ifError(err);
        t.done();
    });
});

test('lookup zone config file', function (t) {
    var opts = {};
    opts.zoneid = newzoneid;

    client.lookupFile(newrole, opts, function (err, res) {
        t.ifError(err);

        t.equal(res['nsswitch'].path, nsswitch);
        t.equal(res['nsswitch'].contents, nsswitch_contents);
        t.equal(res['nsswitch'].type, 'text');

        t.done();
    });
});


// -- Test overwriting configuration

newrole = 'testsvc-' + uuid.v4().substr(0, 8);
newzoneid = uuid.v4();

test('overwrite configuration', function (t) {
    var file = {};
    file.service = 'foobar';
    file.type = 'json';
    file.contents = { foo: 'bar' };
    file.path = '/etc/foobar.conf';

    var opts = {};
    opts.zoneid = newzoneid;

    client.putFile(file, newrole, opts, function (err) {
        t.ifError(err);

        file.contents = { baz: 'biz' };

        client.putFile(file, newrole, opts, function (suberr) {
            t.ifError(suberr);

            client.lookupFile(newrole, opts, function (subsuberr, res) {
                t.ifError(subsuberr);

                t.equal(res['foobar'].path, '/etc/foobar.conf');
                t.deepEqual(res['foobar'].contents, { baz: 'biz' });
                t.equal(res['foobar'].type, 'json');

                t.ok(!res['foobar'].contents.foo);

                t.done();
            });
        });
    });
});


// -- Test changelog

test('recent changes', function (t) {
    client.recentChanges(newrole, 0, function (err, changes) {
        t.ifError(err);
        t.ok(changes.length > 0);
        t.done();
    });
});


// -- Test "simple" interface

var roleid = 'testrole' + uuid.v4().substr(0, 8);

test('lookupConfig() should return empty config', function (t) {
    client.lookupConfig(roleid, function (err, config) {
        t.ifError(err);
        t.deepEqual(config, {});
        t.done();
    });
});

test('putConfig()', function (t) {
    client.putConfig(CONFIG, roleid, function (err) {
        t.ifError(err);
        t.done();
    });
});

test('lookupConfig() should return proper config', function (t) {
    client.lookupConfig(roleid, function (err, config) {
        t.ifError(err);
        t.deepEqual(config, CONFIG);
        t.done();
    });
});

test('deleteConfig() ', function (t) {
    client.deleteConfig(roleid, function (err) {
        t.ifError(err);
        t.done();
    });
});

test('lookupConfig() after delete should return empty config', function (t) {
    client.lookupConfig(roleid, function (err, config) {
        t.ifError(err);
        t.deepEqual(config, {});
        t.done();
    });
});


// -- Teardown

test('unbind', function (t) {
    client.unbind(function (err) {
        t.ifError(err);
        t.done();
    });
});
