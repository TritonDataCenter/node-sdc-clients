/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * Client library for the SDC Packages API (PAPI)
 */

var util = require('util');
var format = util.format;
var restify = require('restify');
var qs = require('querystring');
var assertions = require('./assertions');

// --- Globals

var assertFunction = assertions.assertFunction;
var assertNumber = assertions.assertNumber;
var assertObject = assertions.assertObject;
var assertString = assertions.assertString;

var ResourceNotFoundError = restify.ResourceNotFoundError;


// Note this is not a constructor!.
function PAPI(options) {
    if (typeof (options) !== 'object') {
        throw new TypeError('options (Object) required');
    }

    if (typeof (options.url) !== 'string') {
        throw new TypeError('options.url (String) required');
    }

    if (!options['X-Api-Version']) {
        options['X-Api-Version'] = '~7.0';
    }

    var client = restify.createJsonClient(options);

    /**
     * Adds a new package to PAPI
     *
     * See https://mo.joyent.com/docs/papi/master/#packageobjects for the
     * details on expected attributes
     *
     * @param {Object} pkg the entry to add.
     * @param {Function} cb of the form fn(err, pkg).
     * @throws {TypeError} on bad input.
     */
    function add(pkg, cb) {
        assertObject('pkg', pkg);
        assertFunction('cb', cb);

        return client.post('/packages', pkg, function (err, req, res, pkg) {
            if (err) {
                return cb(err);
            }
            return cb(null, pkg);
        });
    }

    /**
     * Looks up a package by uuid.
     *
     * @param {String} uuid for a package.
     * @param {Function} cb of the form f(err, pkg).
     * @throws {TypeError} on bad input.
     */
    function get(uuid, cb) {
        if (typeof (uuid) !== 'object') {
            assertString('uuid', uuid);
        }
        assertFunction('cb', cb);

        if (typeof (uuid) === 'object') {
            return cb(null, uuid);
        }

        return client.get('/packages/' + uuid, function (err, req, res, pkg) {
            if (err) {
                return cb(err);
            }

            return cb(null, pkg);
        });
    }

    /**
     * Deletes a pkg record.
     *
     * @param {Object} pkg the pkg record you got from get.
     * @param {Function} cb of the form fn(err).
     * @throws {TypeError} on bad input.
     */
    function del(pkg, force, cb) {
        assertObject('pkg', pkg);
        if (typeof (force) === 'function') {
            cb = force;
            force = false;
        }
        assertFunction('cb', cb);

        return cb(new restify.BadMethodError('Packages cannot be deleted'));
    }


    /**
     * Updates a package record.
     *
     * Note you don't need to pass a whole copy of the pkg to changes, just the
     * attributes you want to modify
     *
     * @param {Object} pkg the package record you got from get.
     * @param {Object} changes the pkg to *replace* original package with
     * @param {Function} cb of the form fn(err).
     * @throws {TypeError} on bad input.
     */
    function update(pkg, changes, cb) {
        assertObject('pkg', pkg);
        assertObject('changes', changes);
        assertFunction('cb', cb);

        var p = '/packages/' + pkg.uuid;
        return client.put(p, changes, function (err, req, res, pack) {
            if (err) {
                return cb(err);
            }

            return cb(null, pack);
        });
    }


    /**
     * Loads all packages. If filter is provided, it will load only packages
     * matching the given LDAP filter.
     *
     * See https://mo.joyent.com/docs/papi/master/#ListPackages for detailed
     * information regarding search filter and pagination options accepted
     *
     * The count argument retrieved on success will provide the total number
     * of packages matching the given search filter (retrieved by PAPI as
     * x-resource-count HTTP header).
     *
     * Note that the correct way to pass options while not passign any filter,
     * due to both parameters being optional, is passing in 'null' as the
     * filter value: list(null, {limit: 50}, function (err, pkgs, count) {...})
     *
     * Additionally, filter can be either an String, or an object including
     * the pkg attributes to build the filter with.
     *
     * @param {String} provided LDAP filter. (Optional)
     * @param {Object} pagination options when desired. (Optional)
     * @param {Function} callback cb of the form fn(err, pkgs, count).
     * @throws {TypeError} on bad input.
     */
    function list(filter, options, cb) {
        if (typeof (filter) === 'function') {
            cb = filter;
            filter = null;
            options = {};
        } else if (typeof (options) === 'function') {
            cb = options;
            options = {};
        }
        assertFunction('cb', cb);

        var q = [];

        if (typeof (filter) === 'string') {
            q.push('filter=' + qs.escape(filter));
        } else if (filter !== null && typeof (filter) === 'object') {
            Object.keys(filter).forEach(function (k) {
                q.push(k + '=' + filter[k]);
            });
        }

        Object.keys(options).forEach(function (k) {
            q.push(k + '=' + options[k]);
        });

        var p = '/packages';

        if (q.length) {
            p = p + '?' + q.join('&');
        }

        return client.get(p, function (err, req, res, pkgs) {
            if (err) {
                return cb(err);
            }

            var count = Number(res.headers['x-resource-count']);
            return cb(null, pkgs, count);
        });
    }

    return {
        add: add,
        get: get,
        list: list,
        del: del,
        update: update,
        client: client
    };
}

module.exports = PAPI;
