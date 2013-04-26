// Copyright 2013 Joyent, Inc.  All rights reserved.

var assert = require('assert');
var crypto = require('crypto');
var EventEmitter = require('events').EventEmitter;
var util = require('util');

var httpSignature = require('http-signature');
var ldap = require('ldapjs');
var restify = require('restify');
var uuid = require('node-uuid');
var clone = require('clone');
var backoff = require('backoff');
var Logger = require('bunyan');

var cache = require('./cache');
var assertions = require('./assertions');


var DEF_LOG = new Logger({
    name: 'sdc-client',
    component: 'ufds',
    stream: process.stderr,
    serializers: Logger.stdSerializers
});

// --- Globals

var assertFunction = assertions.assertFunction;
var assertNumber = assertions.assertNumber;
var assertObject = assertions.assertObject;
var assertString = assertions.assertString;

var InvalidCredentialsError = restify.InvalidCredentialsError;
var NotAuthorizedError = restify.NotAuthorizedError;
var ResourceNotFoundError = restify.ResourceNotFoundError;
var InvalidArgumentError = restify.InvalidArgumentError;

var getFingerprint = httpSignature.sshKeyFingerprint;
var sprintf = util.format;

var HIDDEN = new ldap.Control({
    type: '1.3.6.1.4.1.38678.1',
    criticality: true
});

var SUFFIX = 'o=smartdc';

var GROUPS = 'ou=groups, ' + SUFFIX;
var GROUP_FMT = 'cn=%s, ' + GROUPS;
var ADMIN_GROUP = sprintf(GROUP_FMT, 'operators');
var READERS_GROUP = sprintf(GROUP_FMT, 'readers');

var USERS = 'ou=users, ' + SUFFIX;
var USER_FMT = 'uuid=%s, ' + USERS;
var KEY_FMT = 'fingerprint=%s, ' + USER_FMT;
var LIMIT_FMT = 'dclimit=%s, ' + USER_FMT;
var VM_FMT = 'vm=%s, ' + USER_FMT;
var METADATA_FMT = 'metadata=%s, ' + USER_FMT;

var AUTHDEV_FMT = 'authdev=%s, ' + USER_FMT;
var FOREIGNDC_FMT = 'foreigndc=%s, ' + AUTHDEV_FMT;

function createUfdsClient(opts, cb) {
    assertObject('opts', opts);
    assertFunction('cb', cb);

    var log = opts.log;
    var retryOpts = opts.retry || {};

    function _createClient(_, _cb) {
        var client = ldap.createClient(opts);

        function onConnect() {
            client.removeListener('error', onError);
            log.trace('ufds: connected');
            _cb(null, client);
        }

        function onError(err) {
            client.removeListener('connect', onConnect);
            _cb(err);
        }

        client.once('connect', onConnect);
        client.once('error', onError);
        client.bind(opts.bindDN, opts.bindCredentials, function (err) {
            if (err) {
                log.error(err, 'Unable to bind to UFDS');
                client.emit('error', err);
                return;
            }

            log.debug('Bound to UFDS');
            client.emit('connect');

        });
    }

    var retry = backoff.call(_createClient, null, cb);
    retry.failAfter(retryOpts.retries || Infinity);
    retry.setStrategy(new backoff.ExponentialStrategy({
        initialDelay: retryOpts.minTimeout || 100,
        maxDelay: retryOpts.maxTimeout || 30000
    }));

    retry.on('backoff', function (number, delay) {
        var level;
        if (number === 0) {
            level = 'info';
        } else if (number < 5) {
            level = 'warn';
        } else {
            level = 'error';
        }
        log[level]({
            attempt: number,
            delay: delay
        }, 'ufds: connection attempted (failed)');
    });

    retry.start();
    return (retry);
}

// --- Exported API

/**
 * Constructor.
 *
 * @param {Object} options options object:
 *                  - url {String} UFDS location.
 *                  - bindDN {String} admin bind DN for UFDS.
 *                  - password {String} password to said admin DN.
 *                  - cache {Object} age (default 60s) and size (default 1k).
 *                                   use false to disable altogether.
 */
function UFDS(options) {
    assertObject('options', options);
    assertString('options.bindDN', options.bindDN);
    assertString('options.bindPassword', options.bindPassword);
    assertString('options.url', options.url);
    if (!options.log) {
        options.log = DEF_LOG;
    }
    assertObject('options.log', options.log);

    var self = this;
    EventEmitter.call(this);

    if (options.cache !== false) {
        this.cache = cache.createCache(options.cache);
    }

    options.bindCredentials = options.bindCredentials || options.bindPassword;
    // Force connection pooling
    if (!options.maxConnections) {
        options.maxConnections = 5;
    }

    // Default client.timeout:
    if (!options.clientTimeout) {
        options.clientTimeout = 5000;
    }
    options.timeout = options.clientTimeout;

    this.log = options.log.child({clazz: 'UFDS'}, true);

    this.connect = function connect() {
        createUfdsClient(options, function (err, client) {
            if (err) {
                self.emit('error', err);
            } else {
                client.on('timeout', function () {
                    self.emit('timeout');
                });
                self.client = client;
                self.emit('ready');
            }
        });
    };

    this.__defineGetter__('cacheOptions', function () {
        return options.cache || false;
    });

    this.connect();
}

util.inherits(UFDS, EventEmitter);
module.exports = UFDS;


/**
 * Unbinds the underlying LDAP client.
 *
 * @param {Function} callback of the form f(err).
 */
UFDS.prototype.close = function close(callback) {
    assertFunction('callback', callback);

    var self = this;
    self.client.unbind(function (err) {
        if (err) {
            return callback(self._translateError(err));
        }

        return callback(null);
    });
};


/**
 * Checks a user's password in UFDS.
 *
 * Returns a RestError of '401' if password mismatches. Returns the same user
 * object as getUser on success.
 *
 * @param {String} login one of login, uuid or the result of getUser.
 * @param {String} password correct password.
 * @param {Function} callback of the form fn(err, user).
 * @throws {TypeError} on bad input.
 */
UFDS.prototype.authenticate = function authenticate(login, password, callback) {
    if (typeof (login) !== 'object') {
        assertString('login', login);
    }
    assertFunction('callback', callback);

    var self = this,
        cacheKey = login + ':' + password,
        entry;

    if (this.cache && (entry = this.cache.get(cacheKey))) {
        return callback(null, entry);
    }

    function _compare(user) {
        self.client.compare(user.dn, 'userpassword', password,
            function (err, ok) {
                if (err) {
                    return callback(self._translateError(err));
                }

                if (!ok) {
                    return callback(
                      new InvalidCredentialsError('The credentials ' +
                                                  'provided are invalid'));
                }

                if (self.cache) {
                    self.cache.put(cacheKey, user);
                }

                return callback(null, user);
            });
    }

    if (typeof (login) === 'object') {
        return _compare(login);
    }

    return this.getUser(login, function (err, user) {
        if (err) {
            return callback(err);
        }

        return _compare(user);
    });
};


/**
 * Adds a new user into UFDS.
 *
 * This call expects the user object to look like the `sdcPerson` UFDS
 * schema, minus objectclass/dn/uuid.
 *
 * @param {Object} user the entry to add.
 * @param {Function} callback of the form fn(err, user).
 * @throws {TypeError} on bad input.
 */
UFDS.prototype.addUser = function addUser(user, callback) {
    assertObject('user', user);
    assertFunction('callback', callback);

    var self = this;

    user.uuid = uuid();
    user.objectclass = 'sdcperson';

    return this.add(sprintf(USER_FMT, user.uuid), user, function (err) {
        if (err) {
            return callback(err);
        }

        return self.getUser(user.uuid, function (err, user) {
            if (err) {
                return callback(err);
            }

            return callback(null, user);
        });
    });
};


/**
 * Looks up a user by login to UFDS.
 *
 * @param {String} login (or uuid) for a customer.
 * @param {Object} options (optional).
 * @param {Function} callback of the form f(err, user).
 * @throws {TypeError} on bad input.
 */
UFDS.prototype.getUser = function getUser(login, callback) {
    if (typeof (login) !== 'object') {
        assertString('login', login);
    }
    assertFunction('callback', callback);

    if (typeof (login) === 'object') {
        return callback(null, login);
    }

    var self = this,
        opts = {
            scope: 'one',
            filter: sprintf('(&(objectclass=sdcperson)(|(login=%s)(uuid=%s)))',
                            login, login)
        };

    return this.search(USERS, opts, function (err, entries) {
        if (err) {
            return callback(err);
        }

        if (entries.length === 0) {
            var msg = login + ' does not exist';
            return callback(new ResourceNotFoundError(msg));
        }

        // Now load the groups they're in
        opts = {
            scope: 'one',
            filter: sprintf(
                    '(&(objectclass=groupofuniquenames)(uniquemember=%s))',
                    entries[0].dn.toString())
        };
        return self.search(GROUPS, opts, function (groupErr, groups) {
            if (groupErr) {
                return callback(groupErr);
            }

            entries[0].memberof = groups.map(function (v) {
                return v.dn;
            });
            return callback(null, self._extendUser(entries[0]));
        });
    });
};


/**
 * Updates a user record.
 *
 * @param {String|Object} user  UUID or login string or a user object with
 *      a `user.dn`, `user.uuid` or `user.login` (i.e. a user object as from
 *      `getUser`).
 * @param {Object} changes  Changes to the plain object you want merged in. E.g.
 *      `{myfield: "blah"}` will add/replace the existing `myfield`. You can
 *      delete an existing field by passing in a null value, e.g.:
 *      `{addthisfield: "blah", rmthisfield: null}`.
 * @param {Function} callback of the form fn(err, user).
 * @throws {TypeError} on bad input.
 */
UFDS.prototype.updateUser = function updateUser(user, changes, callback) {
    if (typeof (user) !== 'string') {
        assertObject('user', user);
    }
    assertObject('changes', changes);
    assertFunction('callback', callback);

    var self = this;

    function getDn(user2, cb) {
        if (user2.dn) {
            return cb(null, user2.dn);
        } else {
            var login = user2.uuid || user2.login || user2;
            self.getUser(login, function (err2, userObj) {
                if (err2) {
                    cb(err2);
                } else {
                    cb(null, userObj.dn);
                }
            });
            return (null);
        }
    }

    // Get the user from the backend to get the `dn`, if necessary.
    getDn(user, function (err, dn) {
        if (err) {
            return callback(err);
        }

        var ldapChanges = [];
        Object.keys(changes).forEach(function (k) {
            if (k === 'dn' ||
                k === 'objectclass' ||
                k === 'uuid' ||
                user[k] === changes[k] ||
                typeof (changes[k]) === 'function') {
                return;
            }

            var change = {modification: {}};
            if (changes[k] === null) {
                change.type = 'delete';
                change.modification[k] = [];
            } else {
                change.type = 'replace';
                change.modification[k] = changes[k];
            }
            ldapChanges.push(change);
        });

        if (!ldapChanges.length) {
            return callback(null);
        }

        return self.modify(dn, ldapChanges, callback);
    });
};


/**
 * Deletes a user record.
 *
 * @param {Object} user the user record you got from getUser.
 * @param {Function} callback of the form fn(err, user).
 * @throws {TypeError} on bad input.
 */
UFDS.prototype.deleteUser = function deleteUser(user, callback) {
    if (typeof (user) !== 'string') {
        assertObject('user', user);
    }
    assertFunction('callback', callback);

    var self = this;
    function _callback(user) {
        return self.del(user.dn, callback);
    }

    if (typeof (user) === 'object') {
        return _callback(user);
    }

    return this.getUser(user, function (err, user) {
        if (err) {
            return callback(err);
        }

        return _callback(user);
    });
};


/**
 * Adds a new SSH key to a given user record.
 *
 * You can either pass in an SSH public key (string) or an object of the form
 *
 * {
 *   name: foo,
 *   openssh: public key
 * }
 *
 * This method will return you the full key as processed by UFDS. If you don't
 * pass in a name, then the name gets set to the fingerprint of the SSH key.
 *
 * @param {Object} user the user record you got from getUser.
 * @param {String} key the OpenSSH public key.
 * @param {Function} callback of the form fn(err, key).
 * @throws {TypeError} on bad input.
 */
UFDS.prototype.addKey = function addKey(user, key, callback) {
    if (typeof (user) !== 'string') {
        assertObject('user', user);
    }
    if (typeof (key) !== 'object') {
        assertString('key', key);
    }
    assertFunction('callback', callback);

    if (typeof (key) === 'string') {
        key = { openssh: key };
    }
    assertString('key.openssh', key.openssh);

    var self = this;

    function _addKey(user) {
        var fingerprint = getFingerprint(key.openssh),
            dn = sprintf(KEY_FMT, fingerprint, user.uuid),
            entry = {
                openssh: key.openssh,
                fingerprint: fingerprint,
                name: key.name || fingerprint,
                objectclass: 'sdckey'
            };

        // We are searching keys by fingerprint or name before allowing
        // addition of a new one with same fingerprint or name:
        return self.getKey(user, entry.fingerprint, function (e, k) {
            if (e && e.statusCode === 404) {
                return self.getKey(user, entry.name, function (e, k) {
                    if (e && e.statusCode === 404) {
                        return self.add(dn, entry, function (err) {
                            if (err) {
                                return callback(self._translateError(err));
                            }

                            return self.getKey(user, fingerprint, callback);
                        });

                    } else {
                        return callback(new InvalidArgumentError(util.format(
                          'Key with name %s and fingerprint %s already exists',
                          entry.name, entry.fingerprint)));
                    }
                });
            } else {
                return callback(new InvalidArgumentError(util.format(
                    'Key with name %s and fingerprint %s already exists',
                    entry.name, entry.fingerprint)));
            }

        });
    }

    if (typeof (user) === 'object') {
        return _addKey(user);
    }

    return this.getUser(user, function (err, user) {
        if (err) {
            return callback(err);
        }

        return _addKey(user);
    });
};


/**
 * Retrieves an SSH key by fingerprint.
 *
 * @param {Object} user the object you got back from getUser.
 * @param {String} fingerprint the SSH fp (or name) of the SSH key you want.
 * @param {Function} callback of the form fn(err, key).
 * @throws {TypeError} on bad input.
 */
UFDS.prototype.getKey = function getKey(user, fingerprint, callback) {
    if (typeof (user) !== 'string') {
        assertObject('user', user);
    }
    assertString('fingerprint', fingerprint);
    assertFunction('callback', callback);

    return this.listKeys(user, function (err, keys) {
        if (err) {
            return callback(err);
        }

        var key, i = 0;
        for (i; i < keys.length; i += 1) {
            if (keys[i].fingerprint === fingerprint ||
                keys[i].name === fingerprint) {
                key = keys[i];
                break;
            }
        }

        if (!key) {
            return callback(
                new ResourceNotFoundError(fingerprint + ' does not exist'));
        }

        return callback(null, key);
    });
};


/**
 * Loads all keys for a given user.
 *
 * @param {Object} user the user you got from getUser.
 * @param {Function} callback of the form fn(err, keys).
 * @throws {TypeError} on bad input.
 */
UFDS.prototype.listKeys = function listKeys(user, callback) {
    if (typeof (user) !== 'string') {
        assertObject('user', user);
    }
    assertFunction('callback', callback);

    var self = this;
    function _keys(user) {
        var opts = {
            scope: 'one',
            filter: '(objectclass=sdckey)'
        };
        self.search(user.dn, opts, function (err, keys) {
            if (err) {
                return callback(err);
            }

            return callback(null, keys);
        });
    }

    if (typeof (user) === 'object') {
        return _keys(user);
    }

    return self.getUser(user, function (err, user) {
        if (err) {
            return callback(err);
        }

        return _keys(user);
    });
};


/**
 * Deletes an SSH key under a user.
 *
 * @param {User} the object you got back from getUser.
 * @param {Object} key the object you got from getKey.
 * @param {Function} callback of the form fn(err, key).
 * @throws {TypeError} on bad input.
 */
UFDS.prototype.deleteKey = function deleteKey(user, key, callback) {
    if (typeof (user) !== 'string') {
        assertObject('user', user);
    }
    if (typeof (key) !== 'string') {
        assertObject('key', key);
    }
    assertFunction('callback', callback);

    var self = this;
    function _delKey(user, key) {
        if (!ldap.parseDN(user.dn).parentOf(key.dn)) {
            return callback(new NotAuthorizedError(key.dn +
                                ' is not a child of ' + user.dn));
        }

        return self.del(key.dn, function (err) {
            if (err) {
                return callback(err);
            }

            return callback(null);
        });
    }

    function _getKey(user) {
        if (typeof (key) === 'object') {
            return _delKey(user, key);
        }

        return self.getKey(user, key, function (err, key) {
            if (err) {
                return callback(err);
            }

            return _delKey(user, key);
        });
    }

    if (typeof (user) === 'object') {
        return _getKey(user);
    }

    return self.getUser(user, function (err, user) {
        if (err) {
            return callback(err);
        }

        return _getKey(user);
    });
};


/**
 * Lists "CAPI" limits for a given user.
 *
 * @param {Object} user the object returned from getUser.
 * @param {Function} callback of the form fn(err, limits).
 * @throws {TypeError} on bad input.
 */
UFDS.prototype.listLimits = function listLimits(user, callback) {
    if (typeof (user) !== 'string') {
        assertObject('user', user);
    }
    assertFunction('callback', callback);

    var self = this;
    function _limits(user) {
        var opts = {
            scope: 'one',
            filter: '(objectclass=capilimit)'
        };
        self.search(user.dn, opts, function (err, limits) {
            if (err) {
                return callback(err);
            }

            return callback(null, limits);
        });
    }

    if (typeof (user) === 'object') {
        return _limits(user);
    }

    return self.getUser(user, function (err, user) {
        if (err) {
            return callback(err);
        }

        return _limits(user);
    });
};


/**
 * Gets a "CAPI" limit for a given user.
 *
 * @param {Object} user the object returned from getUser.
 * @param {String} datacenter the datacenter name.
 * @param {Function} callback of the form fn(err, limit).
 * @throws {TypeError} on bad input.
 */
UFDS.prototype.getLimit = function getLimit(user, datacenter, callback) {
    if (typeof (user) !== 'string') {
        assertObject('user', user);
    }
    if (typeof (datacenter) !== 'string') {
        assertObject('datacenter', datacenter);
    }
    assertFunction('callback', callback);

    if (typeof (datacenter) === 'object') {
        return callback(null, datacenter);
    }

    var self = this;
    function _limits(user) {
        self.listLimits(user, function (err, limits) {
            if (err) {
                return callback(err);
            }

            var i = 0;
            for (i; i < limits.length; i += 1) {
                if (limits[i].datacenter === datacenter) {
                    return callback(null, limits[i]);
                }
            }

            return callback(new ResourceNotFoundError(
                'No limit found for ' + user.login + '/' + datacenter + '.'));
        });
    }

    if (typeof (user) === 'object') {
        return _limits(user);
    }

    return self.getUser(user, function (err, user) {
        if (err) {
            return callback(err);
        }

        return _limits(user);
    });
};


/**
 * Creates a "CAPI" limit for a given user.
 *
 * @param {Object} user the object returned from getUser.
 * @param {Object} limit the limit to add.
 * @param {Function} callback of the form fn(err, limit).
 * @throws {TypeError} on bad input.
 */
UFDS.prototype.addLimit = function addLimit(user, limit, callback) {
    if (typeof (user) !== 'string') {
        assertObject('user', user);
    }
    assertObject('limit', limit);
    assertString('limit.datacenter', limit.datacenter);
    assertFunction('callback', callback);

    var self = this;
    function _add(user) {
        var dn = sprintf(LIMIT_FMT, limit.datacenter, user.uuid),
            entry = {
                objectclass: 'capilimit'
            };

        Object.keys(limit).forEach(function (k) {
            entry[k] = limit[k];
        });

        return self.add(dn, entry, function (err) {
            if (err) {
                return callback(self._translateError(err));
            }

            return self.getLimit(user, limit.datacenter, callback);
        });
    }

    if (typeof (user) === 'object') {
        return _add(user);
    }

    return self.getUser(user, function (err, user) {
        if (err) {
            return callback(err);
        }

        return _add(user);
    });
};


/**
 * Updates a "CAPI" limit for a given user.
 *
 * @param {Object} user the object returned from getUser.
 * @param {Object} limit the limit to add.
 * @param {Function} callback of the form fn(err, limit).
 * @throws {TypeError} on bad input.
 */
UFDS.prototype.updateLimit = function updateLimit(user, limit, callback) {
    if (typeof (user) !== 'string') {
        assertObject('user', user);
    }
    assertObject('limit', limit);
    assertString('limit.datacenter', limit.datacenter);
    assertFunction('callback', callback);

    var self = this;
    function _mod(user, _limit) {
        var dn = sprintf(LIMIT_FMT, limit.datacenter, user.uuid),
            changes = [];
        Object.keys(limit).forEach(function (k) {
            if (k === 'dn' ||
                k === 'objectclass' ||
                typeof (limit[k]) === 'function' ||
                limit[k] === _limit[k]) {
                return;
                }

            var change = {
                type: 'replace',
                modification: {}
            };
            if (_limit[k] && !limit[k]) {
                change.type = 'delete';
                change.modification[k] = [];
            } else {
                change.modification[k] = limit[k];
            }
            changes.push(change);
        });

        if (!changes.length) {
            return callback(null);
        }

        return self.modify(dn, changes, callback);
    }

    function _limit(user) {
        return self.getLimit(user, limit.datacenter, function (err, limit) {
            if (err) {
                return callback(err);
            }

            return _mod(user, limit);
        });
    }

    if (typeof (user) === 'object') {
        return _limit(user);
    }

    return self.getUser(user, function (err, user) {
        if (err) {
            return callback(err);
        }

        return _limit(user);
    });
};


/**
 * Deletes a "CAPI" limit for a given user.
 *
 * Note that this deletes _all_ limits for a datacenter, so if you just want
 * to purge one, you probably want to use updateLimit.
 *
 * @param {Object} user the object returned from getUser.
 * @param {Object} limit the limit to delete.
 * @param {Function} callback of the form fn(err).
 * @throws {TypeError} on bad input.
 */
UFDS.prototype.deleteLimit = function deleteLimit(user, limit, callback) {
    if (typeof (user) !== 'string') {
        assertObject('user', user);
    }
    assertObject('limit', limit);
    assertString('limit.datacenter', limit.datacenter);
    assertFunction('callback', callback);

    var self = this;
    function _del(user) {
        var dn = sprintf(LIMIT_FMT, limit.datacenter, user.uuid);
        return self.del(dn, callback);
    }

    if (typeof (user) === 'object') {
        return _del(user);
    }

    return self.getUser(user, function (err, user) {
        if (err) {
            return callback(err);
        }

        return _del(user);
    });
};


/**
 * Loads all vms for a given user.
 *
 * @param {Object} user the user you got from getUser.
 * @param {Function} callback of the form fn(err, vms).
 * @throws {TypeError} on bad input.
 */
UFDS.prototype.listVmsUsage = function listVmsUsage(user, callback) {
    if (typeof (user) !== 'string') {
        assertObject('user', user);
    }
    assertFunction('callback', callback);

    var self = this;
    function _vms(user) {
        var opts = {
            scope: 'one',
            filter: '(objectclass=vmusage)'
        };
        self.search(user.dn, opts, function (err, vms) {
            if (err) {
                return callback(err);
            }

            return callback(null, vms);
        });
    }

    if (typeof (user) === 'object') {
        return _vms(user);
    }

    return self.getUser(user, function (err, user) {
        if (err) {
            return callback(err);
        }

        return _vms(user);
    });
};

/**
 * Lists foreign dcs by authorized dev.
 *
 * @param {Object} user the object you got back from getUser.
 * @param {String} authdev the authorized developer key
 * @param {Function} callback of the form fn(err, key)
 * @throws {TypeError} on bad input
 */

UFDS.prototype.listForeigndc = function listForeigndc(user, authdev, callback) {
    var self = this;
    var opts = {
        scope: 'one',
        filter: '(objectclass=foreigndc)'
    };
    var dn = sprintf(AUTHDEV_FMT, authdev, user.uuid);
    return self.search(dn, opts, function (err, dclist) {
        if (err) {
            return callback(err);
        }
        return callback(null, dclist);
    });
};

/**
 * inserts a foreign dc by authorized dev & key.
 *
 * @param {Object} user the object you got back from getUser.
 * @param {String} authdev the authorized developer key
 * @param {String} dcname the unique name for the datacenter
 * @param {Object} params the parameters for the foreign datacenter.
 *     must contain at least url & token
 * @param {Function} callback of the form fn(err, key)
 * @throws {TypeError} on bad input
 */

UFDS.prototype.addForeigndc =
    function addForeigndc(user, authdev, dc, callback) {
    var self = this;
    var opts = {
        scope: 'one',
        filter: sprintf('(&(objectclass=authdev)(authdev=%s))', authdev)
    };
    return self.search(user.dn, opts, function (err, devlist) {
        if (err) {
            return callback(err);
        }

        if (devlist.length !== 0) {
            var dcdn = sprintf(AUTHDEV_FMT, authdev, user.uuid);
            var dcopts = {
                scope: 'one',
                filter: sprintf('(&(objectclass=foreigndc)(foreigndc=%s))',
                    dc.name)
            };

            return self.search(dcdn, dcopts, function (err2, dclist) {
                if (err2) {
                    return callback(err2);
                }

                if (dclist.length !== 0) {
                    // The dc already exists,
                    // so we're replacing the token and/or url
                    var changes = [
                        {
                            type: 'replace',
                            modification: { 'url' : dc.url }
                        },
                        {
                            type: 'replace',
                            modification: { 'token' : dc.token }
                        }
                    ];
                    var moddn = sprintf(FOREIGNDC_FMT, dc.name, authdev,
                                        user.uuid);
                    return self.modify(moddn, changes, callback);
                } else {
                    var insertdn = sprintf(FOREIGNDC_FMT, dc.name, authdev,
                                           user.uuid);
                    var obj = {
                        foreigndc: dc.name,
                        url: dc.url,
                        token: dc.token,
                        objectclass: 'foreigndc'
                    };
                    return self.add(insertdn, obj, callback);
                }
            });
        } else  { // insert the dev first
            var insertdevdn = sprintf(AUTHDEV_FMT, authdev, user.uuid);
            var devobj = { authdev: authdev, objectclass: 'authdev' };
            return self.add(insertdevdn, devobj, function (err2, deventry) {
                if (err2) {
                    return callback(err2);
                }
                var insertdn = sprintf(FOREIGNDC_FMT, dc.name, authdev,
                                       user.uuid);
                var obj = {
                    foreigndc: dc.name,
                    url: dc.url,
                    token: dc.token,
                    objectclass: 'foreigndc'
                };
                return self.add(insertdn, obj, callback);
            });
        }
    });
};


/**
 * Retrieves metadata by key.
 *
 * @param {Object} user the object you got back from getUser.
 * @param {String} appkey the metadata key.
 * @param {Function} callback of the form fn(err, key).
 * @throws {TypeError} on bad input.
 */
UFDS.prototype.getMetadata = function getMetadata(user, key, callback) {
    var self = this;
    if (typeof (user) !== 'string') {
        assertObject('user', user);
    }
    assertString('key', key);
    assertFunction('callback', callback);

    var opts = {
        scope: 'base',
        filter: '(objectclass=capimetadata)'
    };
    var dn = sprintf(METADATA_FMT, key, user.uuid);
    self.search(dn, opts, function (err, metadata) {
        if (err) {
            return callback(err);
        }
        if (metadata) {
            return callback(null, metadata[0]);
        }
        return callback(null, null);
    });
};

/**
 * Adds new metadata to a given user record.
 *
 * takes a CAPI metadata key and an object of arbitrary fields (not nested)
 *
 * This method will return you the full metadata as processed by UFDS.
 *
 * @param {Object} user the user record you got from getUser.
 * @param {String} key the CAPI metadata key (application key)
 * @param {Object} metadata the CAPI metadata to be inserted
 * @param {Function} callback of the form fn(err, metadata).
 * @throws {TypeError} on bad input.
 */
UFDS.prototype.addMetadata =
          function addMetadata(user, key, metadata, callback) {
    if (typeof (user) !== 'string') {
        assertObject('user', user);
    }
    assertString('key', key);
    assertObject('metadata', metadata);
    assertFunction('callback', callback);
    var self = this;

    function _addMetadata(user) {
        assertString('user.uuid', user.uuid);
        var dn = sprintf(METADATA_FMT, key, user.uuid);
        metadata.objectclass = 'capimetadata';

        // We are searching keys by fingerprint or name before allowing
        // addition of a new one with same fingerprint or name:
        return self.getMetadata(user, key, function (e, k) {
            if (e && e.statusCode === 404) {
                return self.add(dn, metadata, function (err) {
                    if (err) {
                        return callback(self._translateError(err));
                    }
                    return self.getMetadata(user, key, callback);
                });
            } else {
                return callback(new InvalidArgumentError(util.format(
                    'Metadata with key %s already exists', key)));
            }
        });
    }

    if (typeof (user) === 'object') {
        return _addMetadata(user);
    }

    return this.getUser(user, function (err, user) {
        if (err) {
            return callback(err);
        }
        return _addMetadata(user);
    });

};

/**
 * modifies metadata entries to a given user record's metadata.
 *
 * takes a CAPI metadata key and an object of arbitrary fields (not nested)
 *
 *
 * This method will return you the full metadata as processed by UFDS.
 *
 * @param {Object} user the user record you got from getUser.
 * @param {String} key the CAPI metadata key (application key)
 * @param {Object} metadata the CAPI metadata to be inserted
 * @param {Function} callback of the form fn(err, metadata).
 * @throws {TypeError} on bad input.
 */
UFDS.prototype.modifyMetadata = function
            modifyMetadata(user, key, metadata, callback) {
    if (typeof (user) !== 'string') {
        assertObject('user', user);
    }
    assertString('key', key);
    assertObject('metadata', metadata);
    assertFunction('callback', callback);
    var self = this;

    function _modMetadata(user) {
        assertString('user.uuid', user.uuid);
        var dn = sprintf(METADATA_FMT, key, user.uuid);
        metadata.objectclass = 'capimetadata';

        return self.getMetadata(user, key, function (e, k) {
            if (e && e.statusCode === 404) {
                return self.add(dn, metadata, function (err) {
                    if (err) {
                        return callback(self._translateError(err));
                    }
                    return self.getMetadata(user, key, callback);
                });
            } else {
                var ldapChanges = [];
                Object.keys(metadata).forEach(function (k) {
                    if (k === 'dn' ||
                        k === 'objectclass' ||
                        typeof (metadata[k]) === 'function') {
                        return;
                    }

                    var change = {modification: {}};
                    if (metadata[k] === null) {
                        change.type = 'delete';
                        change.modification[k] = [];
                    } else {
                        change.type = 'replace';
                        change.modification[k] = metadata[k];
                    }
                    ldapChanges.push(change);
                });
                if (!ldapChanges.length) {
                    return callback(null);
                }

                return self.modify(dn, ldapChanges, callback);
            }
      });
    }
    if (typeof (user) === 'object') {
        return _modMetadata(user);
    }

    return this.getUser(user, function (err, user) {
        if (err) {
            return callback(err);
        }
        return _modMetadata(user);
    });

};


/**
 * Low-level API to wrap up UFDS add operations.
 *
 * See ldapjs docs.
 *
 * @param {String} dn of the record to add.
 * @param {Object} entry record attributes.
 * @param {Function} callback of the form fn(error, entries).
 * @throws {TypeError} on bad input.
 */
UFDS.prototype.add = function add(dn, entry, callback) {
    assertString('dn', dn);
    assertObject('entry', entry);
    assertFunction('callback', callback);

    var self = this;
    return this.client.add(dn, entry, function (err) {
        if (err) {
            return callback(self._translateError(err));
        }

        self._newCache();

        return callback(null);
    });
};


/**
 * Low-level API to wrap up UFDS delete operations.
 *
 * See ldapjs docs.
 *
 * @param {String} dn dn to delete.
 * @param {Function} callback of the form fn(error).
 * @throws {TypeError} on bad input.
 */
UFDS.prototype.del = function del(dn, callback) {
    assertString('dn', dn);
    assertFunction('callback', callback);

    var self = this;
    return this.client.del(dn, function (err) {
        if (err) {
            return callback(self._translateError(err));
        }

        self._newCache();
        return callback(null);
    });
};


/**
 * Low-level API to wrap up UFDS modify operations.
 *
 * See ldapjs docs.
 *
 * @param {String} dn to update
 * @param {Object} changes to make.
 * @param {Function} callback of the form fn(error).
 * @throws {TypeError} on bad input.
 */
UFDS.prototype.modify = function modify(dn, changes, callback) {
    assertString('dn', dn);
    assertFunction('callback', callback);

    var self = this;
    return this.client.modify(dn, changes, function (err) {
        if (err) {
            return callback(self._translateError(err));
        }

        self._newCache();
        return callback(null);
    });
};


/**
 * Low-level API to wrap up UFDS search operations.
 *
 * See ldapjs docs.
 *
 * @param {String} base search base.
 * @param {Object} options search options.
 * @param {Function} callback of the form fn(error, entries).
 * @return {Boolean} true if callback was invoked from cache, false if not.
 * @throws {TypeError} on bad input.
 */
UFDS.prototype.search = function search(base, options, callback) {
    assertString('base', base);
    assertObject('options', options);
    assertFunction('callback', callback);

    var self = this,
        key = base + '::' + JSON.stringify(options),
        entries;

    if ((entries = (this.cache ? this.cache.get(key) : false))) {
        callback(null, clone(entries));
        return true;
    }

    return self.client.search(base, options, HIDDEN, function (err, res) {
        if (err) {
            return callback(self._translateError(err));
        }

        res.on('searchEntry', function (entry) {
            if (!entries) {
                entries = [];
            }

            if (util.isArray(entries)) {
                entries.push(entry.object);
            }
        });

        res.on('error', function (err) {
            return callback(self._translateError(err));
        });

        res.on('end', function () {
            if (entries && entries.length && self.cache) {
                self.cache.put(key, entries);
            }

            return callback(null, entries ? clone(entries) : []);
        });

        return false;
    });
};


UFDS.prototype.setLogLevel = function setLogLevel(level) {
    this.client.log.level(level);
};


// --- "Private" methods

UFDS.prototype._newCache = function _newCache() {
    this.cache = null;
    if (this.cacheOptions) {
        this.cache = cache.createCache(this.cacheOptions);
    }
};


UFDS.prototype._translateError = function _translateError(error) {
    if (error instanceof restify.HttpError) {
        return error;
    }

    if (error instanceof ldap.LDAPError) {
        switch (error.name) {

        case 'NoSuchAttributeError':
        case 'NoSuchObjectError':
        case 'UndefinedAttributeTypeError':
            return new ResourceNotFoundError(
                'The resource you requested does not exist');

        case 'InvalidDnSyntax':
        case 'AttributeOrValueExistsError':
        case 'ConstraintViolationError':
        case 'ObjectclassModsProhibitedError':
            return new restify.InvalidArgumentError(error.message);
        case 'EntryAlreadyExistsError':
            return new restify.InvalidArgumentError(error.message +
                                                  ' already exists');

        case 'ObjectclassViolationError':
            return new restify.MissingParameterError(
                sprintf('Request is missing a required parameter (%s)',
                    error.message));

        case 'NotAllowedOnNonLeafError':
        case 'NotAllowedOnRdnError':
            return new restify.InvalidArgumentError(
                'The resource in question has "child" elements or is ' +
                'immutable and cannot be destroyed');

        default:
            break;
        }
    }

    return new restify.InternalError(error.message);
};


UFDS.prototype._extendUser = function _extendUser(user) {
    assert.equal(typeof (user), 'object');

    var self = this;

    user.authenticate = function authenticate(password, callback) {
        return self.authenticate(user, password, function (err, user) {
            if (err) {
                return callback(err);
            }

            return callback();
        });
    };

    user.isAdmin = function isAdmin() {
        return (user.memberof.indexOf(ADMIN_GROUP) !== -1);
    };

    user.isReader = function isReader() {
        return (user.memberof.indexOf(READERS_GROUP) !== -1);
    };

    user.addToGroup = function addToGroup(group, callback) {
        var rdn = sprintf(GROUP_FMT, group);
        if (user.memberof.indexOf(rdn) !== -1) {
            return callback(null);
        }
        var change = {
            operation: 'add',
            modification: {
                uniquemember: user.dn.toString()
            }
        };
        return self.modify(rdn, [change], callback);
    };

    user.removeFromGroup = function removeFromGroup(group, callback) {
        var rdn = sprintf(GROUP_FMT, group);
        if (user.memberof.indexOf(rdn) === -1) {
            return callback(null);
        }
        var change = {
            operation: 'delete',
            modification: {
                uniquemember: user.dn.toString()
            }
        };
        return self.modify(rdn, [change], callback);
    };

    user.groups = function groups() {
        var grps = [];
        user.memberof.forEach(function (g) {
            var rdns = ldap.parseDN(g).rdns;
            if (rdns && rdns.length && rdns[0].cn) {
                grps.push(rdns[0].cn);
            }
        });
        return grps;
    };

    user.addKey = function addKey(key, callback) {
        return self.addKey(user, key, callback);
    };
    user.getKey = function getKey(fingerprint, callback) {
        return self.getKey(user, fingerprint, callback);
    };
    user.listKeys = function listKeys(callback) {
        return self.listKeys(user, callback);
    };
    user.deleteKey = function deleteKey(key, callback) {
        return self.deleteKey(user, key, callback);
    };

    user.addLimit = function addLimit(limit, callback) {
        return self.addLimit(user, limit, callback);
    };
    user.getLimit = function getLimit(datacenter, callback) {
        return self.getLimit(user, datacenter, callback);
    };
    user.listLimits = function listLimits(callback) {
        return self.listLimits(user, callback);
    };
    user.updateLimit = function updateLimit(limit, callback) {
        return self.updateLimit(user, limit, callback);
    };
    user.deleteLimit = function deleteLimit(limit, callback) {
        return self.deleteLimit(user, limit, callback);
    };

    user.listVmsUsage = function listVmsUsage(callback) {
        return self.listVmsUsage(user, callback);
    };

    user.unlock = function unlock(callback) {
        return self.updateUser(user, {
            pwdfailuretime: null,
            pwdaccountlockedtime: null
        }, callback);
    };

    user.destroy = function destroy(callback) {
        return self.deleteUser(user, callback);
    };

    return user;
};
