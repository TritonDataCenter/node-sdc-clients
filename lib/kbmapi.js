/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2018 Joyent, Inc.
 */

/*
 * Client library for the Triton Key Backup and Management API (KBMAPI)
 */

var RestifyClient = require('./restifyclient');
var assert = require('assert-plus');
var util = require('util');
var format = util.format;

// --- Exported Client

function KBMAPI(options) {
    RestifyClient.call(this, options);
}

util.inherits(KBMAPI, RestifyClient);

/**
 * Creates a pivtoken
 *
 * @param {String} guid: the guid of the token
 * @param {Object} params: the token parameters
 * @param {Object} options: request options
 * @param {Function} callback: of the form f(err, res)
 *
 * TODO: Document format of params
 */
KBMAPI.prototype.createToken = function (guid, params, options, callback) {
    assert.string(guid, 'guid');
    assert.object(params, 'params');
    params.guid = guid;

    if (typeof (options) === 'function') {
        callback = options;
        options = undefined;
    }

    var opts = { path: '/pivtokens' };
    if (options && options.headers) {
        opts.headers = options.headers;
    }

    return this.post(opts, params, callback);
};

/**
 * Deletes the pivtoken specified by GUID
 *
 * @param {String} guid: the GUID
 * @param {Object} params: the optional parameters
 * @param {Object} options: request options
 * @param {Function} callback" of the form f(err, res)
 */
KBMAPI.prototype.deleteToken = function (guid, params, options, callback) {
    assert.string(guid, 'guid');

    if (typeof (params) === 'function') {
        callback = params;
        params = {};
    } else if (typeof (options) === 'function') {
        callback = options;
        options = undefined;
    }

    var opts = { path: format('/pivtokens/%s', guid), query: params };
    if (options && options.headers) {
        opts.headers = options.headers;
    }

    return this.del(opts, callback);
};

/**
 * List all tokens
 *
 * @param {Object} params: optional parameters
 * @param {Object} options: request options.
 * @param {Function} callback: of the form f(err, res)
 */
KBMAPI.prototype.getTokens = function (params, options, callback) {
    if (typeof (params) === 'function') {
        callback = params;
        params = {};
    } else if (typeof (options) === 'function') {
        callback = options;
        options = undefined;
    }

    var opts = { path: '/pivtokens', query: params };
    if (options && options.headers) {
        opts.headers = options.headers;
    }

    return this.get(opts, callback);
};

// XXX No update for the moment

/**
 * Gets the public information about a token
 *
 * @param {String} guid: the pivtoken guid
 * @param {Object} options: request options
 * @param {Function} callback: of the form f(err, res)
 */
KBMAPI.prototype.getToken = function (guid, options, callback) {
    assert.string(guid, 'guid');

    if (typeof (options) === 'function') {
        callback = options;
        options = undefined;
    }

    var opts = { path: format('/pivtokens/%s', guid) };
    if (options && options.headers) {
        opts.headers = options.headers;
    }

    return this.get(opts, callback);
};

/**
 * Gets the token info including PIN.
 * XXX In the released version, this will require authenticating
 *
 * @param {String} guid: the pivtoken guid
 * @param {Object} options: request options
 * @param {Function} callback: of the form f(err, res)
 */
KBMAPI.prototype.getTokenPin = function (guid, options, callback) {
    assert.string(guid, 'guid');

    if (typeof (options) === 'function') {
        callback = options;
        options = undefined;
    }

    var opts = { path: format('/pivtokens/%s/pin', guid) };
    if (options && options.headers) {
        opts.headers = options.headers;
    }

    return this.get(opts, callback);
};

module.exports = KBMAPI;
