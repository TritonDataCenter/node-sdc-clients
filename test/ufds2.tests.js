// Copyright 2013 Joyent, Inc.  All rights reserved.

var Logger = require('bunyan');
var libuuid = require('libuuid');
function uuid() {
    return (libuuid.create());
}
var util = require('util');
var clone = require('clone');

var UFDS = require('../lib/ufds2');


// --- Globals

// var UFDS_URL = 'ldaps://' + (process.env.UFDS_IP || '10.99.99.18');
var UFDS_URL = 'ldap://127.0.0.1:1389';

var ufds;

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

var PWD = process.env.ADMIN_PWD || 'joypass123';

var ID = uuid();
var LOGIN = 'a' + ID.substr(0, 7);
var EMAIL = LOGIN + '_test@joyent.com';
var DN = util.format('uuid=%s, ou=users, o=smartdc', ID);

var SUB_ID = uuid();
var SUB_LOGIN = 'a' + SUB_ID.substr(0, 7);
var SUB_EMAIL = SUB_LOGIN + '_test@joyent.com';
var SUB_UUID;

// --- Tests

exports.setUp = function (callback) {
    ufds = new UFDS({
        url: UFDS_URL,
        bindDN: 'cn=root',
        bindPassword: 'secret',
        clientTimeout: 2000,
        log: new Logger({
            name: 'ufds_unit_test',
            stream: process.stdout,
            level: (process.env.LOG_LEVEL || 'info'),
            serializers: Logger.stdSerializers
        }),
        tlsOptions: {
            rejectUnauthorized: false
        },
        retry: {
            retries: 5,
            maxTimeout: 10000,
            minTimeout: 100
        }
    });
    ufds.once('ready', function () {
        ufds.removeAllListeners('error');
        callback();
    });
    ufds.once('error', function (err) {
        ufds.removeAllListeners('ready');
        callback(err);
    });
};


exports.testGetUser = function (test) {
    var entry = {
        login: LOGIN,
        email: EMAIL,
        uuid: ID,
        userpassword: PWD,
        objectclass: 'sdcperson'
    };

    ufds.add(DN, entry, function (err) {
        test.ifError(err);
        ufds.getUser(LOGIN, function (err, user) {
            test.ifError(err);
            test.equal(user.login, LOGIN);
            test.done();
        });
    });
};


exports.testGetUserByUuid = function (test) {
    ufds.getUser(ID, function (err, user) {
        test.ifError(err);
        test.equal(user.login, LOGIN);
        test.done();
    });
};


exports.testGetUserByEmail = function (test) {
    ufds.getUserByEmail(EMAIL, function (err, user) {
        test.ifError(err);
        test.equal(user.login, LOGIN);
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
    ufds.authenticate(LOGIN, PWD, function (err, user) {
        test.ifError(err);
        test.ok(user);
        ufds.getUser(LOGIN, function (err, user2) {
            test.ifError(err);
            test.equal(user.login, user2.login);
            test.done();
        });
    });
};


exports.testAuthenticateByUuid = function (test) {
    ufds.authenticate(ID, PWD, function (err, user) {
        test.ifError(err);
        test.ok(user);
        test.equal(user.login, LOGIN);
        user.authenticate(PWD, function (err) {
            test.ifError(err);
            test.done();
        });
    });
};


exports.test_add_key = function (test) {
    ufds.getUser(LOGIN, function (err, user) {
        test.ifError(err);
        user.addKey(SSH_KEY, function (err, key) {
            test.ifError(err, err);
            test.ok(key, 'have key: ' + key);
            if (key) {
                test.equal(key.openssh, SSH_KEY);
            }
            test.done();
        });
    });
};


exports.test_add_duplicated_key_not_allowed = function (test) {
    ufds.getUser(LOGIN, function (err, user) {
        test.ifError(err, 'getUser error');
        user.addKey(SSH_KEY, function (err, key) {
            test.ok(err, 'add duplicated key error');
            test.done();
        });
    });
};


exports.testListAndGetKeys = function (test) {
    ufds.getUser(LOGIN, function (err, user) {
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
    ufds.getUser(LOGIN, function (err, user) {
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
    ufds.getUser(LOGIN, function (err, user) {
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
    ufds.getUser(LOGIN, function (err, user) {
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


exports.testUserGroups = function (test) {
    ufds.getUser(LOGIN, function (err, user) {
        test.ifError(err);
        test.ok(!user.isAdmin());
        test.ok(!user.isReader());
        user.addToGroup('readers', function (err2) {
            test.ifError(err2);
            ufds.getUser(LOGIN, function (err3, user2) {
                test.ifError(err3);
                test.ok(user2.isReader());
                user2.addToGroup('operators', function (err4) {
                    test.ifError(err4);
                    ufds.getUser(LOGIN, function (err5, user3) {
                        test.ifError(err5);
                        test.ok(user3.isAdmin());
                        user3.removeFromGroup('operators', function (err6) {
                            test.ifError(err6);
                            ufds.getUser(LOGIN, function (err7, user4) {
                                test.ifError(err7);
                                test.ok(user4.isReader() && !user4.isAdmin());
                                test.done();
                            });
                        });
                    });
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
        ufds.updateUser(user, {
            phone: '+1 (206) 555-1212',
            pwdaccountlockedtime: Date.now() + (3600 * 1000)
        }, function (err) {
            test.ifError(err);
            user.authenticate(entry.userpassword, function (er) {
                test.ok(er);
                test.equal(er.statusCode, 401);
                user.unlock(function (e) {
                    test.ifError(e);
                    user.authenticate(entry.userpassword, function (er2) {
                        test.ifError(er2);
                        user.destroy(function (err) {
                            test.ifError(err);
                            test.done();
                        });
                    });
                });
            });
        });
    });
};


exports.testCrudLimit = function (test) {
    ufds.getUser(LOGIN, function (err, user) {
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
    ufds.add(util.format(VM_FMT, VM_ONE.uuid, ID), VM_ONE,
            function (err) {
        test.ifError(err, 'Add VM_ONE error');
        ufds.add(util.format(VM_FMT, VM_TWO.uuid, ID), VM_TWO,
            function (err2) {
            test.ifError(err2, 'Add VM_TWO error');
            ufds.listVmsUsage(ID, function (err3, vms) {
                test.ifError(err3, 'Error listing Vms');
                test.ok(Array.isArray(vms));
                ufds.getUser(LOGIN, function (err4, user) {
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


exports.testMetadata = function (t) {
    var meta = {
        whatever: 'A meaningful value for whatever setting it'
    };
    var key = 'some-app';
    var META_FMT = 'metadata=%s, uuid=%s, ou=users, o=smartdc';

    ufds.getUser(LOGIN, function (err, user) {
        t.ifError(err, 'testMetadata getUser error');
        t.ok(user);
        ufds.addMetadata(user, key, meta, function (err2, metadata) {
            t.ifError(err2, 'testMetadata addMetadata error');
            t.ok(metadata.cn);
            t.equal(key, metadata.cn);
            t.ok(metadata.dn);
            t.equal(metadata.dn, util.format(META_FMT, key, user.uuid));
            t.ok(metadata.objectclass);
            t.equal('capimetadata', metadata.objectclass);
            // CAPI-319: getMetadata w/o object
            ufds.getMetadata(LOGIN, key, function (err3, meta3) {
                t.ifError(err3, 'testMetadata getMetadata error');
                t.ok(meta3);
                // And now with object:
                ufds.getMetadata(user, key, function (err4, meta4) {
                    t.ifError(err4, 'testMetadata getMetadata error');
                    t.ok(meta4);
                    ufds.deleteMetadata(user, key, function (er5, meta5) {
                        t.ifError(er5);
                        t.done();
                    });
                });
            });
        });
    });
};


// Account users and roles:
exports.test_add_sub_user_to_account = function (test) {
    var entry = {
        login: SUB_LOGIN,
        email: SUB_EMAIL,
        userpassword: PWD,
        objectclass: 'sdcperson',
        account: ID
    };

    ufds.addUser(entry, function (err, user) {
        test.ifError(err);
        test.equal(user.login, SUB_LOGIN);
        test.ok(user.uuid);
        SUB_UUID = user.uuid;
        ufds.getUser(SUB_UUID, ID, function (e1, u1) {
            test.equal(user.login, SUB_LOGIN);
            test.done();
        });
    });

};


exports.test_subuser_key = function (test) {
    ufds.getUser(SUB_LOGIN, ID, function (err, user) {
        test.ifError(err);
        user.addKey(SSH_KEY, function (err, key) {
            test.ifError(err, err);
            test.ok(key, 'have key: ' + key);
            if (key) {
                test.equal(key.openssh, SSH_KEY);
            }
            user.listKeys(function (er2, keys) {
                test.ifError(er2);
                test.ok(keys);
                test.ok(keys.length);
                test.equal(keys[0].openssh, SSH_KEY);
                user.getKey(keys[0].fingerprint, user.account,
                    function (er3, key2) {
                    test.ifError(er3);
                    test.ok(key2);
                    test.deepEqual(keys[0], key2);
                    user.deleteKey(keys[0], function (err) {
                        test.ifError(err);
                        test.done();
                    });
                });
            });
        });
    });
};


exports.test_sub_users_metadata = function (t) {
    var meta = {
        whatever: 'A meaningful value for whatever setting it'
    };
    var key = 'some-app';
    var SUB_META_FMT = 'metadata=%s, uuid=%s, uuid=%s, ou=users, o=smartdc';

    ufds.getUser(SUB_LOGIN, ID, function (err, user) {
        t.ifError(err, 'testMetadata getUser error');
        t.ok(user, 'metadata user');
        ufds.addMetadata(user, key, meta, function (err2, metadata) {
            t.ifError(err2, 'testMetadata addMetadata error');
            t.ok(metadata.cn, 'metadata cn');
            t.equal(key, metadata.cn, 'metadata cn value');
            t.ok(metadata.dn, 'metadata dn');
            t.equal(metadata.dn,
                util.format(SUB_META_FMT, key, user.uuid, user.account),
                'metadata dn value');
            t.ok(metadata.objectclass, 'meta objectclass');
            t.equal('capimetadata', metadata.objectclass,
                'meta objectclass val');
            // CAPI-319: getMetadata w/o object
            ufds.getMetadata(SUB_LOGIN, key, user.account,
                function (err3, meta3) {
                t.ifError(err3, 'testMetadata getMetadata error');
                t.ok(meta3, 'get meta w/o object');
                // And now with object:
                ufds.getMetadata(user, key, function (err4, meta4) {
                    t.ifError(err4, 'testMetadata getMetadata error');
                    t.ok(meta4, 'get meta with object');
                    ufds.deleteMetadata(user, key, function (er5, meta5) {
                        t.ifError(er5);
                        t.done();
                    });
                });
            });
        });
    });
};


// Sub-users limits are the same than main account user limits:
exports.test_sub_users_limits = function (test) {
    ufds.getUser(LOGIN, function (err, user) {
        test.ifError(err);
        test.ok(user);
        user.addLimit(
          {datacenter: 'coal', smartos: '123'},
          function (err, limit) {
            test.ifError(err);
            test.ok(limit);
            test.ok(limit.smartos);
            ufds.getUser(SUB_LOGIN, ID, function (err, subuser) {
                test.ifError(err, 'sub user limits getUser error');
                test.ok(subuser, 'subuser');
                subuser.listLimits(function (err, limits) {
                    test.ifError(err);
                    test.ok(limits);
                    test.ok(limits.length);
                    test.ok(limits[0].smartos);
                    subuser.getLimit(limits[0].datacenter,
                        function (err, limit) {
                        test.ifError(err);
                        test.ok(limit);
                        test.ok(limit.smartos);
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


exports.test_sub_users_vms_usage = function (test) {
    ufds.listVmsUsage(SUB_LOGIN, ID, function (err3, vms) {
        test.ifError(err3, 'Error listing Vms');
        test.ok(Array.isArray(vms));
        ufds.getUser(SUB_LOGIN, ID, function (err4, user) {
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
};


exports.test_sub_users_crud = function (test) {
    var id = uuid();
    var login = 'a' + id.substr(0, 7);
    var email = login + '_test@joyent.com';

    var entry = {
        login: login,
        email: email,
        userpassword: PWD,
        objectclass: 'sdcperson',
        account: ID
    };

    ufds.addUser(entry, function (err, user) {
        test.ifError(err);
        test.equal(user.login, login);
        ufds.getUserByEmail(entry.email, entry.account,
            function (err2, user2) {
                test.ifError(err2);
                test.equal(user2.login, login);

                ufds.updateUser(user.uuid, {
                    phone: '+1 (206) 555-1212',
                    pwdaccountlockedtime: Date.now() + (3600 * 1000)
                }, user.account, function (err) {
                    test.ifError(err);
                    user.authenticate(entry.userpassword, function (er) {
                        test.ok(er);
                        test.equal(er.statusCode, 401);
                        user.unlock(function (e) {
                            test.ifError(e);
                            user.authenticate(entry.userpassword,
                                function (er2) {
                                test.ifError(er2);
                                user.destroy(function (er3) {
                                    test.ifError(er3);
                                    test.done();
                                });
                            });
                        });
                    });
                });

        });
    });
};


exports.test_account_roles = function (test) {
    var role_uuid = uuid();
    var cn = 'a' + role_uuid.substr(0, 7);
    var entry = {
        role: cn,
        policydocument: 'Any string would be OK here',
        uniquemember: util.format(
                'uuid=%s, uuid=%s, ou=users, o=smartdc', SUB_UUID, ID),
        account: ID,
        uuid: role_uuid,
        description: 'This is completely optional'
    };
    ufds.addRole(ID, entry, function (err, role) {
        test.ifError(err, 'addRole error');
        test.equal(role.dn, util.format(
                'role-uuid=%s, uuid=%s, ou=users, o=smartdc', role_uuid, ID));
        ufds.listRoles(ID, function (err, roles) {
            test.ifError(err, 'listRoles error');
            test.ok(Array.isArray(roles), 'Array of roles');
            test.equal(roles[0].dn, util.format(
                'role-uuid=%s, uuid=%s, ou=users, o=smartdc', role_uuid, ID));
            ufds.getUser(SUB_LOGIN, ID, function (err, subuser) {
                test.ifError(err, 'sub user limits getUser error');
                test.ok(subuser, 'subuser');
                test.ok(subuser.roles, 'subuser.roles');
                test.ok(Array.isArray(subuser.roles), 'roles is an array');
                ufds.getUser(ID, function (err, user) {
                    test.ifError(err, 'get User error');
                    user.addToRole(role.uuid, function (err) {
                        test.ifError(err, 'addToRole error');
                        ufds.getUser(ID, function (err, user) {
                            test.ifError(err, 'get User error');
                            test.ok(user.roles.length);
                            user.removeFromRole(role.uuid, function (err) {
                                test.ifError(err, 'removeFromRole error');
                                entry.policydocument = [
                                    'Fred can read *.js when dirname = ' +
                                    'examples and sourceip = 10.0.0.0/8',
                                    'John, Jack and Jane can ops_* *'
                                ];
                                ufds.modifyRole(ID, entry.uuid, entry,
                                    function (err, role) {
                                    test.ifError(err, 'modify role error');
                                    test.equal(role.policydocument.length, 2);
                                    ufds.deleteRole(ID, entry.uuid,
                                        function (err) {
                                        test.ifError(err, 'deleteRole error');
                                        test.done();
                                    });
                                });
                            });
                        });
                    });
                });
            });
        });
    });
};


exports.test_account_groups = function (test) {
    var group_uuid = uuid();
    var cn = 'a' + group_uuid.substr(0, 7);
    var entry = {
        cn: cn,
        uniquemember: util.format(
                'uuid=%s, uuid=%s, ou=users, o=smartdc', SUB_UUID, ID),
        account: ID,
        uuid: group_uuid
    };
    ufds.addGroup(ID, entry, function (err, group) {
        test.ifError(err, 'addGroup error');
        test.equal(group.dn, util.format(
                'group-uuid=%s, uuid=%s, ou=users, o=smartdc',
                group_uuid, ID));
        ufds.listGroups(ID, function (err, groups) {
            test.ifError(err, 'listGroups error');
            test.ok(Array.isArray(groups), 'Array of groups');
            test.equal(groups[0].dn, util.format(
                'group-uuid=%s, uuid=%s, ou=users, o=smartdc',
                group_uuid, ID));
            ufds.getUser(SUB_LOGIN, ID, function (err, subuser) {
                test.ifError(err, 'sub user limits getUser error');
                test.ok(subuser, 'subuser');
                test.ok(subuser.memberof, 'subuser.groups');
                test.ok(Array.isArray(subuser.memberof), 'groups is an array');
                ufds.getUser(ID, function (err, user) {
                    test.ifError(err, 'get User error');
                    user.addToGroup(group.uuid, entry.account, function (err) {
                        test.ifError(err, 'addToGroup error');
                        ufds.getUser(ID, function (err, user) {
                            test.ifError(err, 'get User error');
                            test.ok(user.memberof.length);
                            user.removeFromGroup(group.uuid, entry.account,
                                function (err) {
                                test.ifError(err, 'removeFromGroup error');
                                entry.memberrole = util.format(
                                    'role-uuid=%s, uuid=%s, ' +
                                    'ou=users, o=smartdc',
                                    group_uuid, ID);
                                ufds.modifyGroup(ID, entry.uuid, entry,
                                    function (err, group) {
                                    test.ifError(err, 'modify group error');
                                    test.ok(group.memberrole);
                                    ufds.deleteGroup(ID, entry.uuid,
                                        function (err) {
                                        test.ifError(err, 'deleteGroup error');
                                        test.done();
                                    });
                                });
                            });
                        });
                    });
                });
            });
        });
    });
};


exports.test_remove_user_from_account = function (test) {
    ufds.deleteUser(SUB_LOGIN, ID, function (err) {
        test.ifError(err);
        test.done();
    });
};


exports.tearDown = function (callback) {
    ufds.close(function () {
        callback();
    });
};
