/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2016, Joyent, Inc.
 */

/*
 * Client library for the SDC Packages API (PAPI)
 */

var util = require('util');
var format = util.format;
var restify = require('restify-clients');
var qs = require('querystring');
var assertions = require('./assertions');

// --- Globals

var assertFunction = assertions.assertFunction;
var assertNumber = assertions.assertNumber;
var assertObject = assertions.assertObject;
var assertString = assertions.assertString;

var ResourceNotFoundError = restify.ResourceNotFoundError;


// Note this is not a constructor!.
function PAPI(clientOpts) {
    if (typeof (clientOpts) !== 'object') {
        throw new TypeError('clientOpts (Object) required');
    }

    if (typeof (clientOpts.url) !== 'string') {
        throw new TypeError('clientOpts.url (String) required');
    }

    if (!clientOpts['X-Api-Version']) {
        clientOpts['X-Api-Version'] = '~7.0';
    }

    var client = restify.createJsonClient(clientOpts);


    /**
     * Adds a new package to PAPI
     *
     * See https://mo.joyent.com/docs/papi/master/#packageobjects for the
     * details on expected attributes
     *
     * @param {Object} pkg the entry to add.
     * @param {Object} request options.
     * @param {Function} cb of the form fn(err, pkg).
     * @throws {TypeError} on bad input.
     */
    function add(pkg, options, cb) {

        if (typeof (options) === 'function') {
            cb = options;
            options = {};
        }

        assertObject('pkg', pkg);
        assertFunction('cb', cb);

        var opts = {path: '/packages'};
        if (options.headers) {
            opts.headers = options.headers;
        }

        return client.post(opts, pkg, function (err, req, res, createdPkg) {
            if (err) {
                return cb(err);
            }
            return cb(null, createdPkg);
        });
    }


    /**
     * Looks up a package by uuid.
     *
     * @param {String} uuid for a package.
     * @param {Object} options params passed to PAPI
     * @param {Function} cb of the form f(err, pkg).
     * @throws {TypeError} on bad input.
     */
    function get(uuid, options, cb) {
        assertString('uuid', uuid);
        assertObject('options', options);
        assertFunction('cb', cb);

        var opts = {};

        if (options.headers) {
            opts.headers = options.headers;
            delete options.headers;
        }

        opts.path = createPath('/packages/' + uuid, options);

        return client.get(opts, function (err, req, res, pkg) {
            if (err) {
                return cb(err);
            }

            return cb(null, pkg);
        });
    }



    /**
     * Deletes a pkg record.
     *
     * @param {String} uuid the uuid of the record you received from get().
     * @param {Object} opt the uuid of the record you received from get().
     * @param {Function} cb of the form fn(err).
     * @throws {TypeError} on bad input.
     */
    function del(uuid, options, cb) {
        assertString('uuid', uuid);
        assertObject('options', options);
        assertFunction('cb', cb);



        var opts = {};
        if (options.headers) {
            opts.headers = options.headers;
            delete options.headers;
        }
        opts.path = createPath('/packages/' + uuid, options);

        return client.del(opts, cb);
    }


    /**
     * Updates a package record.
     *
     * Note you don't need to pass a whole copy of the pkg to changes, just the
     * attributes you want to modify
     *
     * @param {Object} pkg the package record you got from get.
     * @param {Object} changes the pkg to *replace* original package with
     * @param {Object} request options.
     * @param {Function} cb of the form fn(err).
     * @throws {TypeError} on bad input.
     */
    function update(uuid, changes, options, cb) {

        if (typeof (options) === 'function') {
            cb = options;
            options = {};
        }

        assertString('uuid', uuid);
        assertObject('changes', changes);
        assertFunction('cb', cb);

        var p = '/packages/' + uuid;
        var opts = {path: p};
        if (options.headers) {
            opts.headers = options.headers;
        }
        return client.put(opts, changes, function (err, req, res, pack) {
            if (err) {
                return cb(err);
            }

            return cb(null, pack);
        });
    }


    /**
     * Loads a list of packages.
     *
     * If the filter is a string, it will be fed as an LDIF filter directly to
     * PAPI. If it is a hash, each k/v pair will be passed to PAPI as
     * constraints on the query.
     *
     * See https://mo.joyent.com/docs/papi/master/#ListPackages for detailed
     * information regarding search filter and pagination options accepted
     *
     * The count argument retrieved on success will provide the total number
     * of packages matching the given search filter (retrieved by PAPI as
     * x-resource-count HTTP header).
     *
     * When passing a filter object (not a string), the query arguments will be
     * escaped according to ldif filter rules. This can be overridden with an
     * option, but don't do so unless you're 100% confident the query args
     * aren't potentially tainted.
     *
     * @param {String or Object} provided LDAP filter.
     * @param {Object} pagination options when desired.
     * @param {Function} callback cb of the form fn(err, pkgs, count).
     * @throws {TypeError} on bad input.
     */
    function list(filter, options, cb) {
        assertObject('options', options);
        assertFunction('cb', cb);

        var escape = options.escape;
        delete options.escape;
        var headers = options.headers;
        delete options.headers;

        var q = [];

        if (typeof (filter) === 'string') {
            q.push('filter=' + escapeParam(filter, false));
        } else {
            Object.keys(filter).forEach(function (k) {
                q.push(k + '=' + escapeParam(filter[k], escape));
            });
        }

        Object.keys(options).forEach(function (k) {
            q.push(k + '=' + options[k]);
        });

        var p = '/packages';

        // XXX should use opts.query instead
        if (q.length) {
            p = p + '?' + q.join('&');
        }

        var opts = {path: p};
        if (headers) {
            opts.headers = headers;
        }

        return client.get(opts, function (err, req, res, pkgs) {
            if (err) {
                return cb(err);
            }

            var count = Number(res.headers['x-resource-count']);
            return cb(null, pkgs, count);
        });
    }


   /**
    * Escapes param data being sent to PAPI.
    *
    * PAPI accepts special characters used for LDIF filters in its params
    * when making queries. This is useful for ops, but undesirable for
    * most applications (and especially data that may carry taint from
    * outside). This function escapes data (both ldif and query forms) so
    * that they're safe to use as params passed to PAPI.
    *
    * @param data the data to escape
    * @param escape whether to escape the data for ldif
    */
    function escapeParam(data, escape) {
        if (typeof (data) !== 'string')
            return data;

        // treat undefined as true as well
        if (escape !== false) {
            data = data.replace('(',  '{\\28}').
                        replace(')',  '{\\29}').
                        replace('\\', '{\\5c}').
                        replace('*',  '{\\2a}').
                        replace('/',  '{\\2f}');
        }

        return qs.escape(data);
    }


   /**
    * Append params to path.
    *
    * @param {String} path the path without params
    * @param {Object} options the args to apply to the end of the path
    */
    function createPath(path, options) {
        assertString('path', path);
        assertObject('options', options);

        var escape = options.escape;
        delete options.escape;

        var q = [];

        Object.keys(options).forEach(function (k) {
            q.push(k + '=' + escapeParam(options[k], escape));
        });

        if (q.length)
            path += '?' + q.join('&');

        return path;
    }


    /**
     * Terminate any open connections to the PAPI service.
     */
    function close() {
        client.close();
    }

    return {
        add: add,
        get: get,
        list: list,
        del: del,
        update: update,
        close: close,
        client: client
    };
}

module.exports = PAPI;
