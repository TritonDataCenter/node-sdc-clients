// Copyright 2013 Joyent, Inc.  All rights reserved.

var crypto = require('crypto');
var EventEmitter = require('events').EventEmitter;
var util = require('util');

var assert = require('assert-plus');
var backoff = require('backoff');
var bunyan = require('bunyan');
var httpSignature = require('http-signature');
var clone = require('clone');
var ldap = require('ldapjs');
var once = require('once');
var restify = require('restify');
var uuid = require('node-uuid');

var cache = require('./cache');
var assertions = require('./assertions');



// --- Globals

var sprintf = util.format;

var getFingerprint = httpSignature.sshKeyFingerprint;

var InternalError = restify.InternalError;
var InvalidArgumentError = restify.InvalidArgumentError;
var InvalidCredentialsError = restify.InvalidCredentialsError;
var MissingParameterError = restify.MissingParameterError;
var NotAuthorizedError = restify.NotAuthorizedError;
var ResourceNotFoundError = restify.ResourceNotFoundError;

var DEF_LOG = bunyan.createLogger({
    name: 'sdc-client',
    component: 'ufds',
    stream: process.stderr,
    serializers: bunyan.stdSerializers
});

var HIDDEN = new ldap.Control({
    type: '1.3.6.1.4.1.38678.1',
    criticality: true
});

var LDAP_PROXY_EVENTS = [
    'connect',
    'connectTimeout',
    'close',
    'end',
    'error',
    'socketTimeout',
    'timeout'
];

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



// --- Internal Functions

function createClient(opts, cb) {
    assert.object(opts, 'options');
    assert.func(cb, 'callback');

    cb = once(cb);

    var dn = opts.credentials.dn;
    var log = opts.log;
    var passwd = opts.credentials.passwd;
    var retryOpts = clone(opts.retry || {});
    retryOpts.maxTimeout = retryOpts.maxTimeout || 30000;
    retryOpts.retries = retryOpts.retries || Infinity;

    function _createClient(_, _cb) {

        function onConnect() {
            client.removeListener('error', onError);
            log.trace('ufds: connected');
            client.bind(dn, passwd, function (err) {
                if (err) {
                    log.error({
                        bindDN: dn,
                        err: err
                    }, 'UFDS: invalid credentials; aborting');
                    retry.abort();
                    _cb(err);
                    return;
                }

                log.trace({
                    bindDN: dn
                }, 'UFDS: connected and bound');
                client.socket.setKeepAlive(true);
                _cb(null, client);
            });
        }

        function onError(err) {
            client.removeListener('connect', onConnect);
            _cb(err);
        }

        var client = ldap.createClient(opts);
        client.once('connect', onConnect);
        client.once('error', onError);
    }

    var retry = backoff.call(_createClient, null, cb);
    retry.setStrategy(new backoff.ExponentialStrategy(retryOpts));
    retry.failAfter(retryOpts.retries);

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
        }, 'ufds: connection attempt failed');
    });

    retry.start();
    return (retry);
}


function extendUser(self, user) {
    assert.object(self, 'self');
    assert.object(user, 'user');

    user.isAdmin = function isAdmin() {
        return (user.memberof.indexOf(ADMIN_GROUP) !== -1);
    };

    user.isReader = function isReader() {
        return (user.memberof.indexOf(READERS_GROUP) !== -1);
    };

    user.addToGroup = function addToGroup(group, cb) {
        var rdn = sprintf(GROUP_FMT, group);
        if (user.memberof.indexOf(rdn) !== -1) {
            cb(null);
            return;
        }

        var change = {
            operation: 'add',
            modification: {
                uniquemember: user.dn.toString()
            }
        };
        self.modify(rdn, [change], cb);
    };

    user.removeFromGroup = function removeFromGroup(group, cb) {
        var rdn = sprintf(GROUP_FMT, group);
        if (user.memberof.indexOf(rdn) === -1) {
            cb(null);
            return;
        }

        var change = {
            operation: 'delete',
            modification: {
                uniquemember: user.dn.toString()
            }
        };
        self.modify(rdn, [change], cb);
    };

    user.groups = function groups() {
        var grps = [];
        user.memberof.forEach(function (g) {
            var rdns = ldap.parseDN(g).rdns;
            if (rdns && rdns.length && rdns[0].cn)
                grps.push(rdns[0].cn);
        });
        return (grps);
    };

    user.unlock = function unlock(cb) {
        var mod = {
            pwdfailuretime: null,
            pwdaccountlockedtime: null
        };
        self.updateUser(user, mod, cb);
    };

    // Reexport the prototype as bounds so callers can use convenience
    // functions (warning: this is slow)
    [
        'authenticate',
        'addKey',
        'getKey',
        'listKeys',
        'deleteKey',
        'addLimit',
        'getLimit',
        'listLimits',
        'updateLimit',
        'deleteLimit',
        'listVmsUsage'
    ].forEach(function curry(f) {
        user[f] = UFDS.prototype[f].bind(self, user);
    });

    user.destroy = UFDS.prototype.deleteUser.bind(self, user);

    return (user);
}


function translateError(err) {
    assert.object(err, 'error');

    var error;

    if (err instanceof restify.HttpError) {
        error = err;
    } else if (err instanceof ldap.LDAPError) {
        switch (err.name) {

        case 'NoSuchAttributeError':
        case 'NoSuchObjectError':
        case 'UndefinedAttributeTypeError':
            error = new ResourceNotFoundError('The resource you requested ' +
                                              'does not exist');
            break;

        case 'InvalidDnSyntax':
        case 'AttributeOrValueExistsError':
        case 'ConstraintViolationError':
        case 'ObjectclassModsProhibitedError':
            error = new InvalidArgumentError(err.message);
            break;

        case 'EntryAlreadyExistsError':
            error =  new InvalidArgumentError(err.message + ' already exists');
            break;

        case 'ObjectclassViolationError':
            var msg = sprintf('Request is missing a required parameter (%s)',
                              err.message);
            error = new MissingParameterError(msg);
            break;


        case 'NotAllowedOnNonLeafError':
        case 'NotAllowedOnRdnError':
            error = new InvalidArgumentError(
                'The resource in question has "child" elements or is ' +
                    'immutable and cannot be destroyed');
            break;

        default:
            error = new restify.InternalError(err.message);
            break;
        }
    } else {
        error = new restify.InternalError(err.message);
    }

    return (error);
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
 *                  - clientTimeout {Object} Optional request timeout (in ms)
 *                    to pass to ldapjs client. Any request that takes longer
 *                    will be terminated with a 'request timeout (client
 *                    interrupt)' error. By default there is no timeout.
 */
function UFDS(opts) {
    assert.object(opts, 'options');
    assert.string(opts.bindDN, 'options.bindDN');
    assert.string(opts.bindPassword, 'options.bindPassword');
    assert.optionalObject(opts.log, 'options.log');
    assert.string(opts.url, 'options.url');

    var self = this;
    EventEmitter.call(this);

    this.cacheOptions = clone(opts.cache || false);
    this.cache =
        this.cacheOptions ? cache.createCache(this.cacheOptions) : null;
    this.log = (opts.log || DEF_LOG).child({component: 'ufds'}, true);

    this.ldapOpts = {
        connectTimeout: opts.connectTimeout,
        credentials: {
            dn: opts.bindDN,
            passwd: opts.bindPassword
        },
        log: self.log,
        retry: opts.retry || {},
        tlsOptions: self.tlsOptions,
        timeout: opts.clientTimeout || opts.timeout,
        url: opts.url
    };

    (function connect() {
        self.connecting = createClient(self.ldapOpts, function (err, client) {
            self.connecting = false;

            // We only get error if credentials are invalid
            if (err) {
                self.emit('error', err);
                return;
            }

            if (self.closed && client) {
                client.unbind();
                return;
            }

            function handleClose() {
                if (self.client && !self.connecting && !self.closed) {
                    self.log.warn(err, 'LDAP client disconnected');
                    self.client = null;
                    connect();
                }
            }

            client.once('error', handleClose);
            client.once('close', handleClose);

            LDAP_PROXY_EVENTS.forEach(function reEmit(event) {
                client.on(event, self.emit.bind(self, event));
            });

            self.client = client;
            self.emit('connect');
            self.emit('ready'); // backwards compatible
        });
    })();
}
util.inherits(UFDS, EventEmitter);
module.exports = UFDS;


/**
 * Unbinds the underlying LDAP client.
 *
 * @param {Function} callback of the form f(err).
 */
UFDS.prototype.close = function close(cb) {
    assert.func(cb, 'callback');

    cb = once(cb);

    var self = this;

    this.closed = true;
    if (!this.client) {
        if (this.connecting)
            this.connecting.abort();
        cb();
        return;
    }

    LDAP_PROXY_EVENTS.forEach(function reEmit(event) {
        self.client.removeAllListeners(event);
    });

    this.client.unbind(function (err) {
        if (err) {
            cb(translateError(err));
        } else {
            process.nextTick(self.emit.bind(self, 'close'));
            cb();
        }
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
UFDS.prototype.authenticate = function authenticate(login, passwd, cb) {
    if (typeof (login) !== 'object')
        assert.string(login, 'login');
    assert.string(passwd, 'password');
    assert.func(cb, 'callback');

    cb = once(cb);

    if (!this.client) {
        cb(new InternalError('not connected'));
        return;
    }

    var entry;
    var client = this.client;
    var cacheKey = login.toString() + ':' + passwd;
    var self = this;

    function _compare(user) {
        client.compare(user.dn, 'userpassword', passwd, function (err, ok) {
            if (err) {
                cb(translateError(err));
            } else if (!ok) {
                cb(new InvalidCredentialsError('The credentials ' +
                                               'provided are invalid'));
            } else {
                if (self.cache)
                    self.cache.put(cacheKey, user);

                cb(null, user);
            }
        });
    }

    if (this.cache && (entry = this.cache.get(cacheKey))) {
        cb(null, entry);
    } else if (typeof (login) === 'object') {
        _compare(login);
    } else {
        this.getUser(login, function (err, user) {
            if (err) {
                cb(err);
            } else {
                _compare(user);
            }
        });
    }
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
UFDS.prototype.addUser = function addUser(user, cb) {
    assert.object(user, 'user');
    assert.func(cb, 'callback');

    cb = once(cb);

    var dn = sprintf(USER_FMT, user.uuid);
    var self = this;

    user.uuid = uuid();
    user.objectclass = 'sdcperson';

    this.add(dn, user, function (add_err) {
        if (add_err) {
            cb(add_err);
        } else {
            self.getUser(user.uuid, function (err, obj) {
                if (err) {
                    cb(err);
                } else {
                    cb(null, obj);
                }
            });
        }
    });
};


/**
 * Looks up a user by login to UFDS.
 *
 * @param {String} login (or uuid) for a customer.
 * @param {Function} callback of the form f(err, user).
 * @throws {TypeError} on bad input.
 */
UFDS.prototype.getUser = function getUser(login, cb) {
    assert.func(cb, 'callback');
    if (typeof (login) !== 'object') {
        assert.string(login, 'login');
    } else {
        cb(null, login);
        return;
    }

    cb = once(cb);

    var opts = {
        scope: 'one',
        filter: sprintf('(&(objectclass=sdcperson)(|(login=%s)(uuid=%s)))',
                        login, login)
    };
    var self = this;

    this.search(USERS, opts, function (err, entries) {
        if (err) {
            cb(err);
            return;
        }

        if (entries.length === 0) {
            cb(new ResourceNotFoundError(login + ' does not exist'));
            return;
        }

        // Now load the groups they're in
        opts = {
            scope: 'one',
            filter: sprintf(
                    '(&(objectclass=groupofuniquenames)(uniquemember=%s))',
                    entries[0].dn.toString())
        };
        self.search(GROUPS, opts, function (groupErr, groups) {
            if (groupErr) {
                cb(groupErr);
                return;
            }

            entries[0].memberof = groups.map(function (v) {
                return (v.dn);
            });

            cb(null, extendUser(self, entries[0]));
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
UFDS.prototype.updateUser = function updateUser(user, changes, cb) {
    if (typeof (user) !== 'string')
        assert.object(user, 'user');

    assert.object(changes, 'changes');
    assert.func(cb, 'callback');

    cb = once(cb);

    var self = this;

    function getDn(u, _cb) {
        if (u.dn) {
            _cb(null, u.dn);
        } else {
            var login = u.uuid || u.login || u;
            self.getUser(login, function (err, obj) {
                if (err) {
                    _cb(err);
                } else {
                    _cb(null, obj.dn);
                }
            });
        }
    }

    // Get the user from the backend to get the `dn`, if necessary.
    getDn(user, function (err, dn) {
        if (err) {
            cb(err);
            return;
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
            cb(null);
            return;
        }

        self.modify(dn, ldapChanges, cb);
    });
};


/**
 * Deletes a user record.
 *
 * @param {Object} user the user record you got from getUser.
 * @param {Function} callback of the form fn(err, user).
 * @throws {TypeError} on bad input.
 */
UFDS.prototype.deleteUser = function deleteUser(user, cb) {
    if (typeof (user) !== 'string')
        assert.object(user, 'user');
    assert.func(cb, 'callback');

    cb = once(cb);

    var self = this;

    function _delete(err, user) {
        if (err) {
            cb(err);
        } else {
            self.del(user.dn, cb);
        }
    }

    if (typeof (user) === 'object') {
        _delete(null, user);
    } else {
        this.getUser(user, _delete);
    }
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
UFDS.prototype.addKey = function addKey(user, key, cb) {
    if (typeof (user) !== 'string')
        assert.object(user, 'user');
    if (typeof (key) !== 'object') {
        assert.string(key, 'key');
        key = { openssh: key };
        assert.string(key.openssh, 'key.openssh');
    }
    assert.func(cb, 'callback');

    cb = once(cb);


    var self = this;

    function _addKey(init_err, user) {
        if (init_err) {
            cb(init_err);
            return;
        }

        var fingerprint = getFingerprint(key.openssh);
        var dn = sprintf(KEY_FMT, fingerprint, user.uuid);
        var entry = {
            openssh: key.openssh,
            fingerprint: fingerprint,
            name: key.name || fingerprint,
            objectclass: 'sdckey'
        };

        // We are searching keys by fingerprint or name before allowing
        // addition of a new one with same fingerprint or name:
        self.getKey(user, entry.fingerprint, function (err, k) {
            if (err && err.statusCode === 404) {
                self.getKey(user, entry.name, function (err2, k) {
                    if (err2 && err2.statusCode === 404) {
                        self.add(dn, entry, function (err3) {
                            if (err3) {
                                cb(translateError(err3));
                            } else {
                                self.getKey(user, fingerprint, cb);
                            }
                        });
                    } else {
                        cb(new InvalidArgumentError(sprintf(
                            'Key with name=%s, fingerprint=%s already exists',
                            entry.name, entry.fingerprint)));
                    }
                });
            } else {
                cb(new InvalidArgumentError(sprintf(
                    'Key with name %s and fingerprint %s already exists',
                    entry.name, entry.fingerprint)));
            }
        });
    }

    if (typeof (user) === 'object') {
        _addKey(null, user);
    } else {
        this.getUser(user, _addKey);
    }
};


/**
 * Retrieves an SSH key by fingerprint.
 *
 * @param {Object} user the object you got back from getUser.
 * @param {String} fingerprint the SSH fp (or name) of the SSH key you want.
 * @param {Function} callback of the form fn(err, key).
 * @throws {TypeError} on bad input.
 */
UFDS.prototype.getKey = function getKey(user, fp, cb) {
    if (typeof (user) !== 'string') {
        assert.object(user, 'user');
    }
    assert.string(fp, 'fingerprint');
    assert.func(cb, 'callback');

    cb = once(cb);

    this.listKeys(user, function (err, keys) {
        if (err) {
            cb(err);
            return;
        }

        var key;
        if (!keys.some(function (k) {
            if (k.fingerprint === fp || k.name === fp)
                key = k;

            return (key ? true : false);
        })) {
            cb(new ResourceNotFoundError(fp + ' does not exist'));
        } else {
            cb(null, key);
        }
    });
};


/**
 * Loads all keys for a given user.
 *
 * @param {Object} user the user you got from getUser.
 * @param {Function} callback of the form fn(err, keys).
 * @throws {TypeError} on bad input.
 */
UFDS.prototype.listKeys = function listKeys(user, cb) {
    if (typeof (user) !== 'string') {
        assert.object(user, 'user');
    }
    assert.func(cb, 'callback');

    cb = once(cb);

    var self = this;
    function _keys(err, user) {
        if (err) {
            cb(err);
        } else {
            var opts = {
                scope: 'one',
                filter: '(objectclass=sdckey)'
            };
            self.search(user.dn, opts, cb);
        }
    }

    if (typeof (user) === 'object') {
        _keys(null, user);
    } else {
        self._getUser(user, _keys);
    }
};


/**
 * Deletes an SSH key under a user.
 *
 * @param {User} the object you got back from getUser.
 * @param {Object} key the object you got from getKey.
 * @param {Function} callback of the form fn(err, key).
 * @throws {TypeError} on bad input.
 */
UFDS.prototype.deleteKey = function deleteKey(user, key, cb) {
    if (typeof (user) !== 'string')
        assert.object(user, 'user');
    if (typeof (key) !== 'string')
        assert.object(key, 'key');
    assert.func(cb, 'callback');

    cb = once(cb);

    var self = this;
    function _delKey(user, key) {
        if (!ldap.parseDN(user.dn).parentOf(key.dn)) {
            cb(new NotAuthorizedError(key.dn + ' not a child of ' + user.dn));
        } else {
            self.del(key.dn, cb);
        }
    }

    function _getKey(user) {
        if (typeof (key) === 'object') {
            _delKey(user, key);
        } else {
            self.getKey(user, key, function (err, key) {
                if (err) {
                    cb(err);
                } else {
                    _delKey(user, key);
                }

        });
        }

    }

    if (typeof (user) === 'object') {
        _getKey(user);
    } else {
        this.getUser(user, function (err, user) {
            if (err) {
                cb(err);
            } else {
                _getKey(user);
            }
        });
    }


};


/**
 * Lists "CAPI" limits for a given user.
 *
 * @param {Object} user the object returned from getUser.
 * @param {Function} callback of the form fn(err, limits).
 * @throws {TypeError} on bad input.
 */
UFDS.prototype.listLimits = function listLimits(user, cb) {
    if (typeof (user) !== 'string')
        assert.object(user, 'user');
    assert.func(cb, 'callback');

    cb = once(cb);

    var opts = {
        scope: 'one',
        filter: '(objectclass=capilimit)'
    };
    var self = this;
    function limits(err, user) {
        if (err) {
            cb(err);
        } else {
            self.search(user.dn, opts, cb);
        }
    }

    if (typeof (user) === 'object') {
        limits(null, user);
    } else {
        self.getUser(user, limits);
    }
};


/**
 * Gets a "CAPI" limit for a given user.
 *
 * @param {Object} user the object returned from getUser.
 * @param {String} datacenter the datacenter name.
 * @param {Function} callback of the form fn(err, limit).
 * @throws {TypeError} on bad input.
 */
UFDS.prototype.getLimit = function getLimit(user, dc, cb) {
    if (typeof (user) !== 'string')
        assert.object(user, 'user');
    if (typeof (dc) !== 'string') {
        assert.object(dc, 'datacenter');
        cb(null, dc);
        return;
    }
    assert.func(cb, 'callback');

    cb = once(cb);

    var self = this;
    function _limits(init_err, user) {
        if (init_err) {
            cb(init_err);
            return;
        }

        self.listLimits(user, function (err, limits) {
            if (err) {
                cb(err);
                return;
            }

            var limit;
            if (!limits.some(function (l) {
                if (l.datacenter === dc)
                    limit = l;
                return (limit ? true : false);
            })) {
                cb(new ResourceNotFoundError(sprintf('No limit found for %s/%s',
                                                     user.login, dc)));
            } else {
                cb(null, limit);
            }
        });
    }

    if (typeof (user) === 'object') {
        _limits(null, user);
    } else {
        this.getUser(user, _limits);
    }
};


/**
 * Creates a "CAPI" limit for a given user.
 *
 * @param {Object} user the object returned from getUser.
 * @param {Object} limit the limit to add.
 * @param {Function} callback of the form fn(err, limit).
 * @throws {TypeError} on bad input.
 */
UFDS.prototype.addLimit = function addLimit(user, limit, cb) {
    if (typeof (user) !== 'string')
        assert.object(user, 'user');
    assert.object(limit, 'limit');
    assert.string(limit.datacenter, 'limit.datacenter');
    assert.func(cb, 'callback');

    cb = once(cb);

    var self = this;
    function _add(get_err, user) {
        if (get_err) {
            cb(get_err);
            return;
        }

        var dn = sprintf(LIMIT_FMT, limit.datacenter, user.uuid);
        var entry = clone(limit);
        entry.objectclass = 'capilimit';

        self.add(dn, entry, function (err) {
            if (err) {
                cb(translateError(err));
            } else {
                self.getLimit(user, limit.datacenter, cb);
            }
        });
    }

    if (typeof (user) === 'object') {
        _add(null, user);
    } else {
        this.getUser(user, _add);
    }
};


/**
 * Updates a "CAPI" limit for a given user.
 *
 * @param {Object} user the object returned from getUser.
 * @param {Object} limit the limit to add.
 * @param {Function} callback of the form fn(err, limit).
 * @throws {TypeError} on bad input.
 */
UFDS.prototype.updateLimit = function updateLimit(user, limit, cb) {
    if (typeof (user) !== 'string')
        assert.object(user, 'user');
    assert.object(limit, 'limit');
    assert.string(limit.datacenter, 'limit.datacenter');
    assert.func(cb, 'callback');

    cb = once(cb);

    var self = this;
    function _mod(user, _limit) {
        var dn = sprintf(LIMIT_FMT, limit.datacenter, user.uuid);
        var changes = [];
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
            cb(null);
            return;
        }

        self.modify(dn, changes, cb);
    }

    function _limit(get_err, user) {
        if (get_err) {
            cb(get_err);
        } else {
            self.getLimit(user, limit.datacenter, function (err, l) {
                if (err) {
                    cb(err);
                } else {
                    _mod(user, l);
                }
            });
        }
    }

    if (typeof (user) === 'object') {
        _limit(null, user);
    } else {
        this.getUser(user, _limit);
    }
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
UFDS.prototype.deleteLimit = function deleteLimit(user, limit, cb) {
    if (typeof (user) !== 'string')
        assert.object(user, 'user');
    assert.object(limit, 'limit');
    assert.string(limit.datacenter, 'limit.datacenter');

    assert.func(cb, 'callback');
    cb = once(cb);

    var self = this;
    function _del(err, user) {
        if (err) {
            cb(err);
        } else {
            self.del(sprintf(LIMIT_FMT, limit.datacenter, user.uuid), cb);
        }
    }

    if (typeof (user) === 'object') {
        _del(null, user);
    } else {
        this.getUser(user, _del);
    }
};


/**
 * Loads all vms for a given user.
 *
 * @param {Object} user the user you got from getUser.
 * @param {Function} callback of the form fn(err, vms).
 * @throws {TypeError} on bad input.
 */
UFDS.prototype.listVmsUsage = function listVmsUsage(user, cb) {
    if (typeof (user) !== 'string')
        assert.object(user, 'user');
    assert.func(cb, 'callback');

    cb = once(cb);

    var self = this;
    function _vms(err, user) {
        if (err) {
            cb(err);
        } else {
            var opts = {
                scope: 'one',
                filter: '(objectclass=vmusage)'
            };
            self.search(user.dn, opts, cb);
        }
    }

    if (typeof (user) === 'object') {
        _vms(null, user);
    } else {
        this.getUser(user, _vms);
    }
};


/**
 * Lists foreign dcs by authorized dev.
 *
 * @param {Object} user the object you got back from getUser.
 * @param {String} authdev the authorized developer key
 * @param {Function} callback of the form fn(err, key)
 * @throws {TypeError} on bad input
 */

UFDS.prototype.listForeigndc = function listForeigndc(user, authdev, cb) {
    cb = once(cb);

    var dn = sprintf(AUTHDEV_FMT, authdev, user.uuid);
    var opts = {
        scope: 'one',
        filter: '(objectclass=foreigndc)'
    };
    this.search(dn, opts, once(cb));
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

UFDS.prototype.addForeigndc = function addForeigndc(user, authdev, dc, cb) {
    cb = once(cb);
    var self = this;
    var opts = {
        scope: 'one',
        filter: sprintf('(&(objectclass=authdev)(authdev=%s))', authdev)
    };
    self.search(user.dn, opts, function (err, devlist) {
        if (err) {
            cb(err);
            return;
        }

        if (devlist.length !== 0) {
            var dcdn = sprintf(AUTHDEV_FMT, authdev, user.uuid);
            var dcopts = {
                scope: 'one',
                filter: sprintf('(&(objectclass=foreigndc)(foreigndc=%s))',
                    dc.name)
            };

            self.search(dcdn, dcopts, function (err2, dclist) {
                if (err2) {
                    cb(err2);
                    return;
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
                    self.modify(moddn, changes, cb);
                } else {
                    var insertdn = sprintf(FOREIGNDC_FMT, dc.name, authdev,
                                           user.uuid);
                    var obj = {
                        foreigndc: dc.name,
                        url: dc.url,
                        token: dc.token,
                        objectclass: 'foreigndc'
                    };
                    self.add(insertdn, obj, cb);
                }
            });
        } else  { // insert the dev first
            var insertdevdn = sprintf(AUTHDEV_FMT, authdev, user.uuid);
            var devobj = { authdev: authdev, objectclass: 'authdev' };
            self.add(insertdevdn, devobj, function (err2, deventry) {
                if (err2) {
                    cb(err2);
                    return;
                }
                var insertdn = sprintf(FOREIGNDC_FMT, dc.name, authdev,
                                       user.uuid);
                var obj = {
                    foreigndc: dc.name,
                    url: dc.url,
                    token: dc.token,
                    objectclass: 'foreigndc'
                };
                self.add(insertdn, obj, cb);
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
UFDS.prototype.getMetadata = function getMetadata(user, key, cb) {
    if (typeof (user) !== 'string')
        assert.object(user, 'user');
    assert.string(key, 'key');
    assert.func(cb, 'callback');

    cb = once(cb);

    var dn = sprintf(METADATA_FMT, key, user.uuid);
    var opts = {
        scope: 'base',
        filter: '(objectclass=capimetadata)'
    };
    this.search(dn, opts, function (err, md) {
        if (err) {
            cb(err);
        } else {
            cb(null, md ? md[0] : null);
        }
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
UFDS.prototype.addMetadata = function addMetadata(user, key, metadata, cb) {
    if (typeof (user) !== 'string')
        assert.object(user, 'user');
    assert.string(key, 'key');
    assert.object(metadata, 'metadata');
    assert.func(cb, 'callback');

    cb = once(cb);

    var self = this;

    function _addMetadata(user) {
        assert.object(user, 'user');
        assert.string(user.uuid, 'user.uuid');

        var dn = sprintf(METADATA_FMT, key, user.uuid);
        metadata.objectclass = 'capimetadata';

        // We are searching keys by fingerprint or name before allowing
        // addition of a new one with same fingerprint or name:
        self.getMetadata(user, key, function (err, k) {
            if (err && err.statusCode === 404) {
                self.add(dn, metadata, function (err2) {
                    if (err2) {
                        cb(translateError(err2));
                    } else {
                        self.getMetadata(user, key, cb);
                    }
                });
            } else {
                cb(new InvalidArgumentError(sprintf('Metadata with key %s ' +
                                                    'already exists', key)));
            }
        });
    }

    if (typeof (user) === 'object') {
        _addMetadata(user);
    } else {
        this.getUser(user, function (err, user) {
            if (err) {
                cb(err);
            } else {
                _addMetadata(user);
            }
        });
    }
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
UFDS.prototype.modifyMetadata = function modifyMetadata(user, key, md, cb) {
    if (typeof (user) !== 'string')
        assert.object(user, 'user');
    assert.string(key, 'key');
    assert.object(md, 'metadata');
    assert.func(cb, 'callback');

    cb = once(cb);

    var self = this;

    function _modMetadata(user) {
        assert.object(user, 'user');
        assert.string(user.uuid, 'user.uuid');

        var dn = sprintf(METADATA_FMT, key, user.uuid);
        md.objectclass = 'capimetadata';

        self.getMetadata(user, key, function (err) {
            if (err && err.statusCode === 404) {
                self.add(dn, md, function (err2) {
                    if (err2) {
                        cb(translateError(err2));
                    } else {
                        self.getMetadata(user, key, cb);
                    }
                });
            } else {
                var ldapChanges = [];
                Object.keys(md).forEach(function (k) {
                    if (k === 'dn' ||
                        k === 'objectclass' ||
                        typeof (md[k]) === 'function') {
                        return;
                    }

                    var change = {
                        modification: {}
                    };
                    if (md[k] === null) {
                        change.type = 'delete';
                        change.modification[k] = [];
                    } else {
                        change.type = 'replace';
                        change.modification[k] = md[k];
                    }

                    ldapChanges.push(change);
                });

                if (!ldapChanges.length) {
                    cb(null);
                } else {
                    self.modify(dn, ldapChanges, cb);
                }
            }
      });
    }

    if (typeof (user) === 'object') {
        _modMetadata(user);
    } else {
        this.getUser(user, function (err, user) {
            if (err) {
                cb(err);
            } else {
                _modMetadata(user);
            }
        });
    }
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
UFDS.prototype.add = function add(dn, entry, cb) {
    assert.string(dn, 'key');
    assert.object(entry, 'entry');
    assert.func(cb, 'callback');

    cb = once(cb);

    if (!this.client) {
        cb(new InternalError('not connected'));
        return;
    }

    var self = this;

    this.client.add(dn, entry, function (err) {
        if (err) {
            cb(translateError(err));
        } else {
            self._newCache();
            cb(null);
        }
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
UFDS.prototype.del = function del(dn, cb) {
    assert.string(dn, 'key');
    assert.func(cb, 'callback');

    cb = once(cb);

    if (!this.client) {
        cb(new InternalError('not connected'));
        return;
    }

    var self = this;
    this.client.del(dn, function (err) {
        if (err) {
            cb(translateError(err));
        } else {
            self._newCache();
            cb(null);
        }
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
UFDS.prototype.modify = function modify(dn, changes, cb) {
    assert.string(dn, 'key');
    assert.object(changes, 'changes');
    assert.func(cb, 'callback');

    cb = once(cb);

    if (!this.client) {
        cb(new InternalError('not connected'));
        return;
    }

    var self = this;
    this.client.modify(dn, changes, function (err) {
        if (err) {
            cb(translateError(err));
        } else {
            self._newCache();
            cb(null);
        }
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
UFDS.prototype.search = function search(base, options, cb) {
    assert.string(base, 'key');
    assert.object(options, 'changes');
    assert.func(cb, 'callback');

    cb = once(cb);

    if (!this.client) {
        cb(new InternalError('not connected'));
        return;
    }

    var key = base + '::' + JSON.stringify(options);
    var self = this;
    var tmp;

    if ((tmp = (this.cache ? this.cache.get(key) : false))) {
        cb(null, clone(tmp));
        return;
    }

    self.client.search(base, options, HIDDEN, function (start_err, res) {
        if (start_err) {
            cb(translateError(start_err));
            return;
        }

        var entries = [];
        res.on('searchEntry', function (entry) {
            entries.push(entry.object);
        });

        res.on('error', function (err) {
            cb(translateError(err));
        });

        res.on('end', function () {
            if (entries.length && self.cache)
                self.cache.put(key, clone(entries));

            cb(null, entries);
        });
    });
};


UFDS.prototype.setLogLevel = function setLogLevel(level) {
    this.log.level(level);
    if (this.client)
        this.client.log.level(level);
};



// --- "Private" methods

UFDS.prototype._newCache = function _newCache() {
    this.cache = null;
    if (this.cacheOptions)
        this.cache = cache.createCache(this.cacheOptions);
};



// --- "Tests"
// Uncomment the following, and then follow prompts
//
// (function test() {
//     var vasync = require('vasync');

//     assert.ok(process.env.UFDS_IP, 'UFDS_IP must be set in your environment');

//     function test_cb(test, cb) {
//         function _cb(err) {
//             if (err) {
//                 console.error('\tFAIL: unable to %s: %s', test, err.toString());
//             } else {
//                 console.log('\tOK: %s', test);
//             }
//             cb(err);
//         }

//         return (_cb);
//     }

//     vasync.pipeline({
//         arg: {},
//         funcs: [
//             function connect(opts, cb) {
//                 console.log('\ncreating client...');
//                 var client = new UFDS({
//                     bindDN: 'cn=root',
//                     bindPassword: 'secret',
//                     log: bunyan.createLogger({
//                         level: process.env.LOG_LEVEL || 'info',
//                         name: 'ufds_test_client',
//                         serializers: bunyan.stdSerializers,
//                         stream: process.stdout
//                     }),
//                     url: 'ldaps://' + process.env.UFDS_IP + ':636'
//                 });

//                 client.once('connect', function () {
//                     console.log('\tOK: connected');
//                     opts.client = client;
//                     cb();
//                 });

//                 client.once('error', function (err) {
//                     console.error('\tFAIL: unable to connect: %s',
//                                   err.toString());
//                     cb(err);
//                 });
//             },

//             function getUser(opts, cb) {
//                 console.log('\nfetching a user...');
//                 opts.client.getUser('admin', test_cb('getUser', cb));
//             },

//             function reconnect(opts, cb) {
//                 console.log('\nKILL THE UFDS SERVER');
//                 opts.client.once('error', function (err) {
//                     console.log('\t\terror received');
//                 });
//                 opts.client.once('close', function () {
//                     console.log('\t\terror received');
//                     opts.client.getUser('admin', function (err) {
//                         if (err)
//                             console.log('\t\treconnect: ok in down state');
//                     });
//                 });

//                 opts.client.once('connect', test_cb('reconnect', cb));
//             },

//             function close(opts, cb) {
//                 console.log('\nclosing client...');
//                 opts.client.close(test_cb('close', cb));
//             }
//         ]
//     }, function (err) {
//         if (err) {
//             console.error('\nTests FAILED');
//             process.exit(1);
//         } else {
//             console.log('\nTests PASSED');
//             process.exit(0);
//         }
//     });
// })();
