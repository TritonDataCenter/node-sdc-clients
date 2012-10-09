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

var exec = require('child_process').exec;

var baseDN = 'ou=config, o=smartdc';
var CHANGELOG = 'cn=changelog';


// These are attributes on each LDAP object which aren't part of the config
var extraAttributes = [ 'dn', 'controls', 'objectclass', 'svc', 'role',
    '_id', '_parent' ];


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

function ldapSearch(client, dn, scope, cb) {
    var opts = {};
    opts.scope = scope;

    var entries = [];

    client.search(dn, opts, function (err, res) {
        if (err) {
            return (cb(new VError(err, 'error from search ' +
                'results: %s', err.name)));
        }

        res.on('searchEntry', function (result) {
            entries.push(result.object);
        });

        res.on('error', function (suberr) {
            return (cb(new VError(suberr, 'error from search ' +
                'results: %s', suberr.name)));
        });

        res.on('end', function (result) {
            return (cb(null, entries));
        });
        return (null);
    });
}

Config.prototype.isRealAttribute = function isRealAttribute(attr) {
    var real = true;
    for (var ii = 0; ii < extraAttributes.length; ii++)
        real = real && (attr !== extraAttributes[ii]);
    return (real);
};

function refreshService(service, cb) {
    var cmd = sprintf('/usr/sbin/svcadm refresh %s', service);
    exec(cmd, function (err, stdout, stderr) {
        return (cb(err));
    });
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
Config.prototype.putFile = function putFile(file, role, options, cb) {
    var self = this;
    var LOG = self.log;

    assert.object(file, 'file');
    assert.string(file.service, 'file.service');
    assert.string(file.type, 'file.type');
    assert.ok(file.type === 'json' || file.type === 'text');
    assert.ok(file.contents, 'file.contents');
    assert.string(file.path, 'file.path');

    assert.string(role, 'role');

    if (arguments.length === 3) {
        cb = options;
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
                    LOG.error('failed to replace file for "%s": %s',
                        dn, suberr.name);
                    return (cb(suberr));
                }

                LOG.info('replaced config file for "%s"', dn);
                return (cb(null));
            }));
        } else if (err && err.name === 'NoSuchObjectError') {
            LOG.warn('failed to add file: NoSuchObjectError; ' +
                'attemping to create parent object.');

            // Assume we need to create object role=<role>,...
            assert.string(options.zoneid, 'options.zoneid');

            var parentdn = consDN(role);
            var pentry = {};
            pentry.svc = role;  // XXX can go away when I update schema
            pentry.role = role;
            pentry.objectclass = 'config';

            self.client.add(parentdn, pentry, function (suberr) {
                if (suberr) {
                    LOG.error('failed to create parent object %s: %s',
                        parentdn, suberr.name);
                    return (cb(suberr));
                }

                LOG.info('created parent object %s', parentdn);

                self.putFile(file, role, options, function (subsuberr) {
                    return (cb(subsuberr));
                });

                return (null);
            });

            return (null);
        } else if (err) {
            LOG.error('failed to add file for "%s": %s',
                dn, err.name);
            return (cb(new VError(err, 'failed to add file ' +
                'for %s: %s', dn, err.name)));
        }

        LOG.info('added file for "%s"', dn);
        return (cb(null));
    });
};

/*
 * A simpler wrapper over the putFile() method.  Intended for configuration that
 * is only stored in UFDS and not written out to a file.
 */
Config.prototype.putConfig = function putConfig(config, role, cb) {
    var self = this;

    var file = {};

    file.service = role;
    file.type = 'json';
    file.contents = config;
    file.path = sprintf('/opt/smartdc/%s/etc/config.json', role);

    self.putFile(file, role, function (err) {
        return (cb(err));
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
 * A call to lookupFile('webserver', '4febbad0') will return only:
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
Config.prototype.lookupFile = function lookupFile(role, options, cb) {
    var self = this;
    var client = self.client;
    var LOG = self.log;

    assert.string(role, 'role');

    if (arguments.length === 2) {
        cb = options;
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
                LOG.warn('more than one config entry for role "%s"', role);

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
                LOG.warn('more than one config entry for zone "%s"', role);

            child_config = results[0];
            return (cb(null));
        }));
    };

    var assembleConfig = function (_, cb) {
        config = {};

        LOG.debug({
            role_config: role_config,
            child_config: child_config
        }, 'assembling whole config');

        if (role_config) {
            Object.keys(role_config).forEach(function (attr) {
                if (self.isRealAttribute(attr)) {
                    config[attr] = JSON.parse(role_config[attr]);
                    LOG.debug('found field %s from role object', attr);
                }
            });
        }

        if (child_config) {
            assert.object(role_config, 'role_config');

            Object.keys(child_config).forEach(function (attr) {
                if (self.isRealAttribute(attr)) {
                    config[attr] = JSON.parse(child_config[attr]);
                    LOG.debug('found field %s from zone object', attr);
                }
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
            return (cb(err));
        return (cb(null, config));
    });
};

/*
 * A simple wrapper over the lookupFile() method.  Intended for configuration
 * that is only stored in UFDS and not written out to a file.
 */
Config.prototype.lookupConfig = function lookupConfig(role, cb) {
    var self = this;
    var LOG = self.log;

    self.lookupFile(role, function (err, results) {
        if (err)
            return (cb(err));

        LOG.debug({
            results: results
        }, 'lookupConfig() found these results');

        var config = {};
        if (results[role])
            config = results[role].contents;

        return (cb(null, config));
    });
};

/*
 * Write a single configuration file locally.
 */
Config.prototype.writeFile = function writeFile(fileentry, options, cb) {
    var self = this;
    var LOG = self.log;

    if (arguments.length === 2) {
        cb = options;
        options = null;
    } else {
        assert.ok(arguments.length === 3);
        assert.object(options, 'options');
    }

    assert.string(fileentry.path, 'fileentry.path');
    assert.string(fileentry.type, 'fileentry.type');
    assert.string(fileentry.service, 'fileentry.service');

    LOG.debug({ update: fileentry }, 'applying update');

    var path = fileentry.path;
    var contents = fileentry.contents;
    if (fileentry.type === 'json') {
        LOG.debug('stringify()\'ing output');
        contents = JSON.stringify(contents, null, 4);
    }

    LOG.info('writing %s file into %s', fileentry.type,
        fileentry.path);

    fs.writeFile(path, contents, function (err) {
        if (err) {
            var msg = sprintf('failed to write config file "%s": %s',
                path, err.message);
            LOG.error(msg);
            return (cb(new VError(msg)));
        }

        LOG.info('wrote config file for "%s" service', fileentry.service);

        if (options && options.norefresh === true) {
            LOG.info('not refreshing service %s', fileentry.service);
            return (cb(null));
        }

        refreshService(fileentry.service, function (suberr) {
            if (suberr) {
                LOG.error('failed to refresh service %s: %s',
                    fileentry.service, suberr.message);
                return (cb(suberr));
            }

            LOG.info('refreshed service %s', fileentry.service);
            return (cb(null));
        });

        return (null);
    });

    return (null);
};

Config.prototype.deleteConfig = deleteConfig;
function deleteConfig(service, role, options, cb) {
    var self = this;
    var LOG = self.log;

    assert.string(service, 'service');
    assert.string(role, 'role');

    if (arguments.length === 3) {
        cb = options;
        options = null;
    } else {
        assert.ok(arguments.length === 4);
        assertOptions(options);
    }

    var dn = consDN(role, options);

    ldapSearch(self.client, dn, 'one', function (err, entries) {
        if (err)  {
            LOG.error('failed to find service to delete: %s', err.message);
            return (cb(err));
        }

        if (!entries || entries.length === 0) {
            var msg = sprintf('no configuration found for "%s"', role);
            LOG.error(msg);
            return (cb(new VError(err, msg)));
        }

        var entry = entries[0];

        if (!entry[service]) {
            msg = sprintf('no configuration found service "%s" in role "%s"',
                service, role);
            LOG.error(msg);
            return (cb(new VError(err, msg)));
        }

        var change = {};
        change.operation = 'delete';
        change.modification = {};
        change.modification[service] = entry[service];

        self.client.modify(dn, change, function (suberr) {
            if (suberr) {
                var msg = sprintf('failed to delete config file "%s" for ' +
                    'dn "%s": %s"', service, dn, suberr.name);
                LOG.error(msg);
                return (cb(new VError(msg)));
            }

            LOG.info('deleted config file "%s" for dn "%s"', service, dn);
            return (cb(null));
        });
        return (null);
    });
}

Config.prototype.recentChanges =
function recentChanges(role, changenumber, cb) {
    var self = this;
    var LOG = self.log;

    var searchdn = consDN(role);
    var filter = sprintf('(&(changenumber>=%d)' +
        '(targetdn=*role=%s, ou=config, o=smartdc))', changenumber, role);

    var searchopts = {};
    searchopts.scope = 'sub';
    searchopts.filter = filter;

    LOG.info('searching for %s (after changenumber %d)',
        searchdn, changenumber);

    self.client.search(CHANGELOG, searchopts, function (err, res) {
        if (err) {
            return (cb(new VError(err, 'error from search ' +
                'results: %s', err.name)));
        }

        var changes = [];

        res.on('searchEntry', function (entry) {
            var targetdn = ldap.parseDN(entry.object.targetdn);

            if (targetdn.equals(searchdn) ||
                targetdn.childOf(searchdn)) {
                assert.string(entry.object.changetype,
                    'entry.object.changetype');
                assert.string(entry.object.changenumber,
                    'entry.object.changenumber');

                LOG.trace({ obj: entry.object }, 'full change object');

                changes.push(entry.object);
            } else {
                LOG.debug('skipping change %d (changenumber %d)',
                    targetdn, parseInt(entry.object.changenumber, 10));
            }
        });

        res.on('error', function (suberr) {
            return (cb(new VError(suberr, 'error from search ' +
                'results: %s', suberr.name)));
        });

        res.on('end', function (result) {
            LOG.info('found %d recent changes for %s',
                changes.length, searchdn);

            changes.forEach(function (change) {
                change.changenumber = parseInt(change.changenumber, 10);
            });

            changes.sort(function sortByChangenumber(change1, change2) {
                return (change1.changenumber - change2.changenumber);
            });

            changes.forEach(function (change) {
                assert.ok(change.changetype === 'add' ||
                    change.changetype === 'modify' ||
                    change.changetype === 'delete');

                if (change.changes) {
                    change.changes = JSON.parse(change.changes);

                    LOG.trace({ change_changes: change.changes },
                        'parsed change.changes');
                }
                if (change.entry) {
                    change.entry = JSON.parse(change.entry);

                    LOG.trace({ change_entry: change.entry },
                        'parsed change.entry');

                    Object.keys(change.entry).forEach(function (key) {
                        if (self.isRealAttribute(key)) {
                            LOG.trace('parsing change.entry[%s]', key);
                            change.entry[key] = JSON.parse(change.entry[key]);
                        }
                    });
                }

                LOG.debug({ change: change }, 'returning change object');
            });

            return (cb(null, changes));
        });
        return (null);
    });
};

Config.prototype.unbind = function unbind(cb) {
    var self = this;
    var LOG = self.log;

    self.client.unbind(function (err) {
        if (err) {
            var msg = sprintf('failed to unbind: %s', err.message);
            LOG.error(msg);
            return (cb(new VError(err, msg)));
        }
        return (cb(null));
    });
};

module.exports = Config;
