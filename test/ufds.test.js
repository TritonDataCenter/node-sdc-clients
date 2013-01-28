// Copyright 2012 Joyent, Inc.  All rights reserved.

var Logger = require('bunyan');
var uuid = require('node-uuid'),
    util = require('util'),
    clone = require('clone');

var UFDS = require('../lib/index').UFDS;


// --- Globals

var UFDS_URL = 'ldaps://' + (process.env.UFDS_IP || '10.99.99.14');

var ufds;
var ADMIN_UUID = '00000000-0000-0000-0000-000000000000';
var SSH_KEY = 'ssh-rsa AAAAB3NzaC1yc2EAAAABIwAAAIEAvad19ePSDckmgmo6Unqmd8' +
    'n2G7o1794VN3FazVhV09yooXIuUhA+7OmT7ChiHueayxSubgL2MrO/HvvF/GGVUs/t3e0u4' +
    '5YwRC51EVhyDuqthVJWjKrYxgDMbHru8fc1oV51l0bKdmvmJWbA/VyeJvstoX+eiSGT3Jge' +
    'egSMVtc= mark@foo.local';

var SSH_KEY_TWO = 'ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQCymx1xJfEugfRzb3G4H' +
'dB8pzwZWbRo6kCSSgrpElMkOSPiPYCqaRVoD7FaX1yv1wUwQzuS/9rrf9PFvdGk81CNMpy0NG/I' +
'6nlMH/v+mKvJYGvX5hc/fAg8izLwBwqCkJw/nek8Hv3PL4bJUZ18driqn4LUoj+gFlcmYoJy9+p' +
'uvGkgDmXQxx5z0Vf+J6N6DQo8mymgbzvAMQNgf4xfTGCjIbUJFCVOMnH2S7XPypbGzOYS3Z8VYT' +
'bt3AZHhEq9ZK4JfC60P8ddZvx6HFxOpqcoE6lFKj2GGziXusNndxfMKjTcZx2IHHlkR2+umeEnM' +
'QhuWNEaoMFHiEIWU8h8HloD whatever@wherever.local';

var SSH_KEY_THREE = 'ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQDY2qV5e2q8qb+kYtn' +
'pvRxC5PM6aqPPgWcaXn2gm4jtefGAPuJX9fIkz/KTRRLxdG27IMt6hBXRXvL0Gzw0H0mSUPHAbq' +
'g4TAyG3/xEHp8iLH/QIf/RwVgjoGB0MLZn7q+L4ThMDo9rIrc5CpfOm/AN9vC4w0Zzu/XpJbzjd' +
'pTXOh+vmOKkiWCzN+BJ9DvX3iei5NFiSL3rpru0j4CUjBKchUg6X7mdv42g/ZdRT9rilmEP154F' +
'X/bVsFHitmyyYgba+X90uIR8KGLFZ4eWJNPprJFnCWXrpY5bSOgcS9aWVgCoH8sqHatNKUiQpZ4' +
'Lsqr+Z4fAf4enldx/KMW91iKn whatever@wherever.local';

var ADMIN_PWD = process.env.ADMIN_PWD || 'joypass123';


// --- Tests

exports.setUp = function (callback) {
    ufds = new UFDS({
        url: UFDS_URL,
        bindDN: 'cn=root',
        bindPassword: 'secret123',
        log: new Logger({
            name: 'ufds_unit_test',
            stream: process.stderr,
            level: (process.env.LOG_LEVEL || 'info'),
            serializers: Logger.stdSerializers
        })
    });
    ufds.on('ready', function () {
        callback();
    });
    ufds.on('error', function (err) {
        callback(err);
    });
};


exports.testGetUser = function (test) {
    ufds.getUser('admin', function (err, user) {
        test.ifError(err);
        test.equal(user.login, 'admin');
        test.ok(user.isAdmin);
        test.ok(user.isAdmin());
        test.ok(user.groups);
        test.ok(user.groups());
        test.equal(user.groups().length, 1);
        test.equal(user.groups()[0], 'operators');
        ufds.getUser(user, function (err, user2) {
            test.ifError(err);
            test.deepEqual(user, user2);
            test.done();
        });
    });
};


exports.testGetUserByUuid = function (test) {
    ufds.getUser(ADMIN_UUID, function (err, user) {
        test.ifError(err);
        test.equal(user.login, 'admin');
        test.ok(user.isAdmin);
        test.ok(user.isAdmin());
        test.done();
    });
};


exports.testGetUserNotFound = function (test) {
    ufds.getUser(uuid(), function (err, user) {
        test.ok(err);
        test.equal(err.statusCode, 404);
        test.equal(err.restCode, 'ResourceNotFound');
        test.ok(err.message);
        test.ok(!user);
        test.done();
    });
};


exports.testAuthenticate = function (test) {
    ufds.authenticate('admin', ADMIN_PWD, function (err, user) {
        test.ifError(err);
        test.ok(user);
        ufds.getUser('admin', function (err, user2) {
            test.ifError(err);
            test.equal(user.login, user2.login);
            test.done();
        });
    });
};


exports.testAuthenticateByUuid = function (test) {
    ufds.authenticate(ADMIN_UUID, ADMIN_PWD, function (err, user) {
        test.ifError(err);
        test.ok(user);
        test.equal(user.login, 'admin');
        test.ok(user.isAdmin());
        user.authenticate(ADMIN_PWD, function (err) {
            test.ifError(err);
            test.done();
        });
    });
};


exports.test_add_key = function (test) {
    ufds.getUser('admin', function (err, user) {
        test.ifError(err);
        user.addKey(SSH_KEY, function (err, key) {
            test.ifError(err);
            test.ok(key);
            test.equal(key.openssh, SSH_KEY);
            test.done();
        });
    });
};


exports.test_add_duplicated_key_not_allowed = function (test) {
    ufds.getUser('admin', function (err, user) {
        test.ifError(err, 'getUser error');
        user.addKey(SSH_KEY, function (err, key) {
            test.ok(err, 'add duplicated key error');
            test.done();
        });
    });
};


exports.testListAndGetKeys = function (test) {
    ufds.getUser('admin', function (err, user) {
        test.ifError(err);
        user.listKeys(function (err, keys) {
            test.ifError(err);
            test.ok(keys);
            test.ok(keys.length);
            test.equal(keys[0].openssh, SSH_KEY);
            user.getKey(keys[0].fingerprint, function (err, key) {
                test.ifError(err);
                test.ok(key);
                test.deepEqual(keys[0], key);
                test.done();
            });
        });
    });
};


exports.test_add_key_by_name = function (test) {
    ufds.getUser('admin', function (err, user) {
        test.ifError(err);
        user.addKey({
            openssh: SSH_KEY_TWO,
            name: 'id_rsa'
        }, function (err, key) {
            test.ifError(err);
            test.ok(key);
            test.equal(key.openssh, SSH_KEY_TWO);
            test.done();
        });
    });

};

exports.test_add_duplicated_key_by_name = function (test) {
    ufds.getUser('admin', function (err, user) {
        test.ifError(err, 'getUser error');
        user.addKey({
            openssh: SSH_KEY_THREE,
            name: 'id_rsa'
        }, function (err, key) {
            test.ok(err, 'add duplicated key error');
            test.done();
        });
    });
};


exports.testDelKey = function (test) {
    ufds.getUser('admin', function (err, user) {
        test.ifError(err);
        user.listKeys(function (err, keys) {
            test.ifError(err);
            user.deleteKey(keys[0], function (err) {
                test.ifError(err);
                user.deleteKey(keys[1], function (err) {
                    test.ifError(err);
                    test.done();
                });
            });
        });
    });
};


exports.testCrudUser = function (test) {
    var entry = {
        login: 'a' + uuid().replace('-', '').substr(0, 7),
        email: uuid() + '@devnull.com',
        userpassword: 'secret123'
    };
    ufds.addUser(entry, function (err, user) {
        test.ifError(err);
        test.ok(user);
        test.ok(user.uuid);
        user.phone = '+1 (206) 555-1212';
        user.save(function (err) {
            test.ifError(err);
            user.destroy(function (err) {
                test.ifError(err);
                test.done();
            });
        });
    });
};


exports.testCrudLimit = function (test) {
    ufds.getUser('admin', function (err, user) {
        test.ifError(err);
        test.ok(user);
        user.addLimit(
          {datacenter: 'coal', smartos: '123'},
          function (err, limit) {
            test.ifError(err);
            test.ok(limit);
            test.ok(limit.smartos);
            user.listLimits(function (err, limits) {
                test.ifError(err);
                test.ok(limits);
                test.ok(limits.length);
                test.ok(limits[0].smartos);
                limits[0].nodejs = 234;
                user.updateLimit(limits[0], function (err) {
                    test.ifError(err);
                    user.getLimit(limits[0].datacenter, function (err, limit) {
                        test.ifError(err);
                        test.ok(limit);
                        test.ok(limit.smartos);
                        test.ok(limit.nodejs);
                        user.deleteLimit(limit, function (err) {
                            test.ifError(err);
                            test.done();
                        });
                    });
                });
            });
        });
    });
};


exports.testsListVmsUsage = function (test) {
    var VM_ONE = {
        objectclass: 'vmusage',
        ram: 1024,
        quota: 10240,
        uuid: uuid(),
        image_uuid: uuid(),
        image_os: 'smartos',
        image_name: 'percona',
        billing_id: uuid()
    };

    var VM_TWO = {
        objectclass: 'vmusage',
        ram: 2048,
        quota: 10240,
        uuid: uuid(),
        image_uuid: uuid(),
        image_os: 'smartos',
        image_name: 'smartos',
        billing_id: uuid()
    };


    var VM_FMT = 'vm=%s, uuid=%s, ou=users, o=smartdc';
    ufds.add(util.format(VM_FMT, VM_ONE.uuid, ADMIN_UUID), VM_ONE,
            function (err) {
        test.ifError(err, 'Add VM_ONE error');
        ufds.add(util.format(VM_FMT, VM_TWO.uuid, ADMIN_UUID), VM_TWO,
            function (err2) {
            test.ifError(err2, 'Add VM_TWO error');
            ufds.listVmsUsage(ADMIN_UUID, function (err3, vms) {
                test.ifError(err3, 'Error listing Vms');
                test.ok(Array.isArray(vms));
                ufds.getUser('admin', function (err4, user) {
                    test.ifError(err4, 'listVms getUser error');
                    test.ok(user);
                    user.listVmsUsage(function (err5, vms2) {
                        test.ifError(err5, 'list user vms error');
                        test.ok(Array.isArray(vms2));
                        test.ok(vms2.length >= 2);
                        test.done();
                    });
                });
            });
        });
    });
};

exports.tearDown = function (callback) {
    ufds.close(function () {
        callback();
    });
};
