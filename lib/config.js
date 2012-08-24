/*
 * Copyright (c) 2012, Joyent, Inc. All rights reserved.
 *
 * config.js: a facility for managing and deploying configuration files
 */

var assert = require('assert-plus');
var fs = require('fs');
var ldap = require('ldapjs');
var sprintf = require('util').format;
var vasync = require('vasync');
var VError = require('verror').VError;

var baseDN = 'ou=config, o=smartdc';

// These are attributes on each LDAP object which aren't part of the config
var extraAttributes = [ 'dn', 'controls', 'objectclass', 'svc', 'role' ];


// -- Helper functions

function assertOptions(options) {
    assert.object(options, 'options');
    if (options.zoneid)
        assert.string(options.zoneid, 'options.zoneid');
    if (options.tag)
        assert.string(options.tag, 'options.tag');
    assert.ok(!(options.zoneid && options.tag));
}

function consDN(role, options) {
    var dn;

    assert.string(role, 'role');

    dn = sprintf('role=%s, %s', role, baseDN);

    if (options && options.tag)
        dn = sprintf('tag=%s, ', options.tag) + dn;
    if (options && options.zoneid)
        dn = sprintf('zoneid=%s, ', options.zoneid) + dn;

    return (dn);
}

function ldapSearch(client, dn, scope, callback) {
    var opts = {};
    opts.scope = scope;

    var entries = [];

    client.search(dn, opts, function (err, res) {
        if (err) {
            return (callback(new VError(err, 'error from search ' +
                'results: %s', err.name)));
        }

        res.on('searchEntry', function (result) {
            entries.push(result.object);
        });

        res.on('error', function (suberr) {
            return (callback(new VError(suberr, 'error from search ' +
                'results: %s', suberr.name)));
        });

        res.on('end', function (result) {
            return (callback(null, entries));
        });
        return (null);
    });
}

function isRealAttribute(attr) {
    var real = true;
    for (var ii = 0; ii < extraAttributes.length; ii++)
        real = real & (attr !== extraAttributes[ii]);
    return (real);
}


// -- Library functions

function Config(config) {
    var self = this;

    assert.object(config.ufds, 'config.ufds');
    assert.string(config.ufds.url, 'config.ufds.url');
    assert.string(config.ufds.bindDN, 'config.ufds.bindDN');
    assert.string(config.ufds.bindCredentials, 'config.ufds.bindCredentials');

    assert.object(config.log);

    self.config = config;
    self.log = config.log;

    self.client = ldap.createClient({
        url: config.ufds.url,
        bindDN: config.ufds.bindDN,
        bindCredentials: config.ufds.bindCredentials,
        maxConnections: 2
    });
}

/*
 * Insert a new configuration file for a service or a specific zone.  The file
 * argument is an object with the following attributes:
 *
 *     service: Required.  The SMF service in the local zone to which this
 *         configuration applies.
 *
 *     type: Required.  One of 'text' or 'json'.
 *
 *     contents: Required.  The contents of the configuration file, whether a
 *         JSON object (for type 'json') or a string (for type 'text')
 *
 *     path: Required.  The location in which this file should be installed.
 *
 * The options argument contains the following attributes:
 *
 *     role: Required.  The SDC role to which this configuration applies.
 *
 *     zoneid: Optional.  The zone UUID to which this configuration applies.
 *        Any files added for a particular zone will override the general
 *        role configuration.
 */
Config.prototype.put = function put(file, role, options, callback) {
    var self = this;
    var log = self.log;

    assert.object(file, 'file');
    assert.string(file.service, 'file.service');
    assert.string(file.type, 'file.type');
    assert.ok(file.type === 'json' || file.type === 'text');
    assert.ok(file.contents, 'file.contents');
    assert.string(file.path, 'file.path');

    assert.string(role, 'role');

    if (arguments.length === 3) {
        callback = options;
        options = null;
    } else {
        assert.ok(arguments.length === 4);
        assertOptions(options);
    }

    var dn = consDN(role, options);

    var entry = {};
    entry.svc = role;  // XXX can go away when I update schema
    entry.role = role;
    entry.objectclass = 'config';
    entry[file.service] = JSON.stringify(file);

    self.client.add(dn, entry, function (err) {
        if (err && err.name === 'EntryAlreadyExistsError') {
            var change = {};
            change.operation = 'replace';
            change.modification = {};
            change.modification[file.service] = JSON.stringify(file);

            return (self.client.modify(dn, change, function (suberr) {
                if (suberr) {
                    log.error('failed to replace file for "%s": %s',
                        dn, suberr.name);
                    return (callback(suberr));
                }

                log.info('replaced config file for "%s"', dn);
                return (callback(null));
            }));
        } else if (err) {
            log.error('failed to add file for "%s": %s',
                dn, err.name);
            return (callback(new VError(err, 'failed to add file ' +
                'for %s: %s', dn, err.name)));
        }

        log.info('added file for "%s"', dn);
        return (callback(null));
    });
};

/*
 * Returns the set of configuration files for a given role.  If zoneid is
 * specified as well, then any configuration files specific to that zone will
 * override the role's files.
 *
 * Note that the override happens on a per-file granularity -- not a per-option
 * granularity.  For example, let's assume the 'webserver' role has the
 * following configuration files:
 *
 *     http: {
 *         workers: 10,
 *        'cache size': 256 * 1024 * 1024
 *     },
 *     amon: {
 *         amon_url: 'http://10.0.0.1'
 *     }
 *
 * and the zone '4febbad0' (an instantiation of 'webserver') has the following
 * configuration files:
 *
 *     http: {
 *         'cache size': 1024 * 1024 * 1024
 *     }
 *
 * A call to lookup('webserver', '4febbad0') will return only:
 *
 *     http: {
 *         'cache size': 1024 * 1024 * 1024
 *     },
 *     amon: {
 *         amon_url: 'http://10.0.0.1'
 *     }
 *
 * Note that the http configuration has no notion of the workers attribute.
 */
Config.prototype.lookup = function lookup(role, options, callback) {
    var self = this;
    var client = self.client;
    var log = self.log;

    assert.string(role, 'role');

    if (arguments.length === 2) {
        callback = options;
        options = null;
    } else {
        assert.ok(arguments.length === 3);
        assertOptions(options);
    }

    var config, role_config, child_config;

    var lookupRoleConfig = function (_, cb) {
        ldapSearch(client, consDN(role), 'one', function (err, results) {
            if (err)
                return (cb(err));

            assert.arrayOfObject(results, 'results');

            if (results.length > 1)
                log.notice('more than one config entry for role "%s"', role);

            role_config = results[0];

            return (cb(null));
        });
    };

    var lookupConfig = function (_, cb) {
        if (!options || (!options.zoneid && !options.tag)) {
            config = null;
            return (cb(null));
        }

        return (ldapSearch(client, consDN(role, options), 'one',
            function (err, results) {
            if (err)
                return (cb(err));

            assert.arrayOfObject(results, 'results');

            if (results.length > 1)
                log.notice('more than one config entry for zone "%s"', role);

            child_config = results[0];
            return (cb(null));
        }));
    };

    var assembleConfig = function (_, cb) {
        config = {};

        if (role_config) {
            Object.keys(role_config).forEach(function (attr) {
                if (isRealAttribute(attr))
                    config[attr] = JSON.parse(role_config[attr]);
            });
        }

        if (child_config) {
            assert.object(role_config, 'role_config');

            Object.keys(child_config).forEach(function (attr) {
                if (isRealAttribute(attr))
                    config[attr] = JSON.parse(child_config[attr]);
            });
        }

        return (cb(null));
    };

    vasync.pipeline({
        funcs: [
            lookupRoleConfig,
            lookupConfig,
            assembleConfig
        ]
    }, function (err) {
        if (err)
            return (callback(err));
        return (callback(null, config));
    });
};

/*
 * Write one or more configuration files locally.
 */
Config.prototype.write = function write(config, callback) {
    var self = this;
    var log = self.log;

    assert.object(config, 'config');

    var writeFile = function (key, cb) {
        var path = config[key].path;
        var contents = config[key].contents;
        if (config[key].type === 'json')
            contents = JSON.stringify(contents, 4);

        fs.writeFile(path, contents, function (err) {
            if (err) {
                var msg = sprintf('failed to write config file "%s": %s',
                    path, err.message);
                log.error(msg);
                return (cb(new VError(msg)));
            }

            log.info('wrote config file for "%s" service', key);
            return (cb(null));
        });
    };

    vasync.forEachParallel({
        func: writeFile,
        inputs: Object.keys(config)
    }, function (err, results) {
        return (callback(err));
    });
};

Config.prototype.del = function del(service, role, options, callback) {
    var self = this;
    var log = self.log;

    assert.string(service, 'service');

    if (arguments.length === 3) {
        callback = options;
        options = null;
    } else {
        assert.ok(arguments.length === 4);
        assertOptions(options);
    }

    var dn = consDN(role, options);

    ldapSearch(self.client, dn, 'one', function (err, entries) {
        if (err)  {
            log.error('failed to find service to delete: %s', err.message);
            return (callback(err));
        }

        var entry = entries[0];

        var change = {};
        change.operation = 'delete';
        change.modification = {};
        change.modification[service] = entry[service];

        self.client.modify(dn, change, function (suberr) {
            if (suberr) {
                var msg = sprintf('failed to delete config file "%s" for ' +
                    'dn "%s": %s"', service, dn, suberr.name);
                log.error(msg);
                return (callback(new VError(msg)));
            }

            log.info('deleted config file "%s" for dn "%s"', service, dn);
            return (callback(null));
        });
        return (null);
    });
};

Config.prototype.unbind = function unbind(callback) {
    var self = this;
    var log = self.log;

    self.client.unbind(function (err) {
        if (err) {
            var msg = sprintf('failed to unbind: %s', err.message);
            log.error(msg);
            return (callback(new VError(err, msg)));
        }
        return (callback(null));
    });
};

module.exports = Config;
