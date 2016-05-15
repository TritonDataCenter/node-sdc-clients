/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2016, Joyent, Inc.
 */

/*
 * Client library for the SDC Firewall API (FWAPI)
 */

var assert = require('assert-plus');
var RestifyClient = require('./restifyclient');
var util = require('util');
var format = util.format;



// --- Exported Client



/**
 * Constructor
 *
 * See the RestifyClient constructor for details
 */
function FWAPI(options) {
    RestifyClient.call(this, options);
}

util.inherits(FWAPI, RestifyClient);



// --- Misc methods



/**
 * Ping FWAPI server.
 *
 * @param {Function} callback : of the form f(err, res).
 */
FWAPI.prototype.ping = function (params, callback) {
    if (typeof (params) === 'function') {
        callback = params;
        params = {};
    }

    var opts = {
        endpointName: 'fwapi.getping',
        path: '/ping'
    };

    return this.get(opts, params, callback);
};



// --- Rule methods



/**
 * Lists all rules.
 *
 * @param {Function} params : Parameters (optional).
 * @param {Object} options : Request options (optional).
 * @param {Function} callback : of the form f(err, res).
 */
FWAPI.prototype.listRules = function (params, options, callback) {
    // If only one argument then this is 'find all'
    if (typeof (params) === 'function') {
        callback = params;
        params = {};
    // If 2 arguments -> (params, callback)
    } else if (typeof (options) === 'function') {
        callback = options;
        options = undefined;
    }

    var opts = {
        endpointName: 'fwapi.listrules',
        path: '/rules'
    };

    if (options && options.headers) {
        opts.headers = options.headers;
    }

    return this.get(opts, params, callback);
};


/**
 * Gets a rule by UUID.
 *
 * @param {String} uuid : the rule UUID.
 * @param {Function} callback : of the form f(err, res).
 */
FWAPI.prototype.getRule = function (uuid, params, callback) {
    assert.string(uuid, 'uuid');

    var opts = {
        endpointName: 'fwapi.getrule',
        path: format('/rules/%s', uuid)
    };

    return this.get(opts, params, callback);
};


/**
 * Updates the rule specified by uuid.
 *
 * @param {String} uuid : the rule UUID.
 * @param {Object} params : the parameters to update.
 * @param {Function} callback : of the form f(err, res).
 */
FWAPI.prototype.updateRule = function (uuid, params, callback) {
    assert.string(uuid, 'uuid');
    assert.object(params, 'params');

    var opts = {
        endpointName: 'fwapi.updaterule',
        path: format('/rules/%s', uuid)
    };

    return this.put(opts, params, callback);
};


/**
 * Creates a rule.
 *
 * @param {Object} params : the rule parameters.
 * @param {Object} options : Request options.
 * @param {Function} callback : of the form f(err, res).
 */
FWAPI.prototype.createRule = function (params, options, callback) {
    assert.object(params, 'params');

    if (typeof (options) === 'function') {
        callback = options;
        options = undefined;
    }

    var opts = {
        endpointName: 'fwapi.createrule',
        path: '/rules'
    };

    if (options && options.headers) {
        opts.headers = options.headers;
    }

    return this.post(opts, params, callback);
};


/**
 * Deletes the rule specified by uuid.
 *
 * @param {String} uuid : the rule UUID.
 * @param {Object} params : optional parameters.
 * @param {Function} callback : of the form f(err, res).
 */
FWAPI.prototype.deleteRule = function (uuid, params, callback) {
    assert.string(uuid, 'uuid');

    var opts = {
        endpointName: 'fwapi.deleteRule',
        path: format('/rules/%s', uuid)
    };

    return this.del(opts, params, callback);
};


/**
 * Gets VMs affected by a rule.
 *
 * @param {String} uuid : the rule UUID.
 * @param {Function} callback : of the form f(err, res).
 */
FWAPI.prototype.getRuleVMs = function (uuid, params, callback) {
    assert.string(uuid, 'uuid');

    var opts = {
        endpointName: 'fwapi.getrulevms',
        path: format('/rules/%s/vms', uuid)
    };

    return this.get(opts, params, callback);
};


/**
 * Gets rules affecting a VM.
 *
 * @param {String} uuid : the rule UUID.
 * @param {Function} callback : of the form f(err, res).
 */
FWAPI.prototype.getVMrules = function (uuid, params, callback) {
    assert.string(uuid, 'uuid');

    var opts = {
        endpointName: 'fwapi.getvmrules',
        path: format('/firewalls/vms/%s', uuid)
    };

    return this.get(opts, params, callback);
};



// --- Update methods


/**
 * Creates an update.
 *
 * @param {Object} params : the update parameters.
 * @param {Function} callback : of the form f(err, res).
 */
FWAPI.prototype.createUpdate = function (params, callback) {
    assert.object(params, 'params');

    var opts = {
        endpointName: 'fwapi.createupdate',
        path: '/updates'
    };

    return this.post(opts, params, callback);
};


module.exports = FWAPI;
