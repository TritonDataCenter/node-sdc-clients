/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2016, Joyent, Inc.
 */

/*
 * Client library for the Triton Packages API (PAPI)
 */

var assert = require('assert-plus');
var clone = require('clone');
var qs = require('querystring');
var restifyClients = require('restify-clients');
var Tracer = require('triton-tracer');


// ---- internal support

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
    assert.string(path, 'path');
    assert.object(options, 'options');

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


// ---- client

function PAPI(clientOpts) {
    /*
     * At one time, the `PAPI` export was not written to be a constructor,
     * so usage was:
     *      var client = PAPI(...);
     * We want to move to the preferred:
     *      var client = new PAPI(...);
     * without breaking the old usage.
     */
    if (!(this instanceof PAPI)) {
        return new PAPI(clientOpts);
    }

    var self = this;

    if (typeof (clientOpts) !== 'object') {
        throw new TypeError('clientOpts (Object) required');
    }

    if (typeof (clientOpts.url) !== 'string') {
        throw new TypeError('clientOpts.url (String) required');
    }

    if (!clientOpts['X-Api-Version']) {
        clientOpts['X-Api-Version'] = '~7.0';
    }

    self.client = restifyClients.createJsonClient(clientOpts);
    return undefined;
}


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
PAPI.prototype.add = function add(pkg, options, cb) {
    var self = this;

    if (typeof (options) === 'function') {
        cb = options;
        options = {};
    }

    assert.object(pkg, 'pkg');
    assert.func(cb, 'cb');

    var opts = {path: '/packages'};
    if (options.headers) {
        opts.headers = options.headers;
    }

    return self.client.post(opts, pkg, function (err, req, res, createdPkg) {
        if (err) {
            return cb(err);
        }
        return cb(null, createdPkg);
    });
};


/**
 * Looks up a package by uuid.
 *
 * @param {String} uuid for a package.
 * @param {Object} options params passed to PAPI
 * @param {Function} cb of the form f(err, pkg).
 * @throws {TypeError} on bad input.
 */
PAPI.prototype.get = function get(uuid, options, cb) {
    var self = this;

    assert.string(uuid, 'uuid');
    assert.object(options, 'options');
    assert.func(cb, 'cb');

    var opts = {};

    if (options.headers) {
        opts.headers = options.headers;
        delete options.headers;
    }

    opts.path = createPath('/packages/' + uuid, options);

    return self.client.get(opts, function (err, req, res, pkg) {
        if (err) {
            return cb(err);
        }

        return cb(null, pkg);
    });
};



/**
 * Deletes a pkg record.
 *
 * @param {String} uuid the uuid of the record you received from get().
 * @param {Object} opt the uuid of the record you received from get().
 * @param {Function} cb of the form fn(err).
 * @throws {TypeError} on bad input.
 */
PAPI.prototype.del = function del(uuid, options, cb) {
    var self = this;

    assert.string(uuid, 'uuid');
    assert.object(options, 'options');
    assert.func(cb, 'cb');

    var opts = {};
    if (options.headers) {
        opts.headers = options.headers;
        delete options.headers;
    }
    opts.path = createPath('/packages/' + uuid, options);

    return self.client.del(opts, cb);
};


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
PAPI.prototype.update = function update(uuid, changes, options, cb) {
    var self = this;


    if (typeof (options) === 'function') {
        cb = options;
        options = {};
    }

    assert.string(uuid, 'uuid');
    assert.object(changes, 'changes');
    assert.func(cb, 'cb');

    var p = '/packages/' + uuid;
    var opts = {path: p};
    if (options.headers) {
        opts.headers = options.headers;
    }
    return self.client.put(opts, changes, function (err, req, res, pack) {
        if (err) {
            return cb(err);
        }

        return cb(null, pack);
    });
};


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
PAPI.prototype.list = function list(filter, options, cb) {
    var self = this;

    assert.object(options, 'options');
    assert.func(cb, 'cb');

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

    return self.client.get(opts, function (err, req, res, pkgs) {
        if (err) {
            return cb(err);
        }

        var count = Number(res.headers['x-resource-count']);
        return cb(null, pkgs, count);
    });
};



/**
 * Terminate any open connections to the PAPI service.
 */
PAPI.prototype.close = function close() {
    var self = this;

    self.client.close();
};


PAPI.prototype.child = function child(req) {
    assert.object(req, 'req');

    var self = this;
    var _child;

    _child = clone(self, true, 1);
    _child.client = Tracer.restifyClient.child(self.client, req,
        'sdc-clients:papi');

    return (_child);
};


module.exports = PAPI;
