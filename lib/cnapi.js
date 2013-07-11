/*
 * Copyright (c) 2012, Joyent, Inc. All rights reserved.
 *
 * Client library for the SDC Compute Node API (CNAPI)
 */

var util = require('util');
var format = util.format;

var RestifyClient = require('./restifyclient');



// --- Exported Client


/**
 * Constructor
 *
 * See the RestifyClient constructor for details
 */
function CNAPI(options) {
    RestifyClient.call(this, options);
}

util.inherits(CNAPI, RestifyClient);


/**
 * Gets boot params for the given CN
 *
 * @param {String} uuid : CN UUID to get
 * @param {Object} options : Request options.
 * @param {Function} callback : of the form f(err, res).
 */
CNAPI.prototype.getBootParams = function (uuid, options, callback) {
    if (!uuid)
        throw new TypeError('uuid is required (string)');
    if (typeof (options) === 'function') {
        callback = options;
        options = undefined;
    }

    var opts = { path: format('/boot/%s', uuid) };
    if (options && options.headers) {
        opts.headers = options.headers;
    }

    return this.get(opts, callback);
};



/**
 * Lists all servers
 *
 * @param {Object} params : Filter params.
 * @param {Object} options : Request options.
 * @param {Function} callback : of the form f(err, res).
 */
CNAPI.prototype.listServers = function (params, options, callback) {
    if (typeof (params) === 'function') {
        callback = params;
        params = {};
    } else if (typeof (options) === 'function') {
        callback = options;
        options = undefined;
    }

    var opts = { path: '/servers', query: params };
    if (options && options.headers) {
        opts.headers = options.headers;
    }

    return this.get(opts, callback);
};



/**
 * Gets a server by UUID
 *
 * @param {String} uuid : the UUID of the server.
 * @param {Object} options : Request options.
 * @param {Function} callback : of the form f(err, res).
 */
CNAPI.prototype.getServer = function (uuid, options, callback) {
    if (!uuid)
        throw new TypeError('UUID is required');
    if (typeof (options) === 'function') {
        callback = options;
        options = undefined;
    }

    var opts = { path: format('/servers/%s', uuid) };
    if (options && options.headers) {
        opts.headers = options.headers;
    }

    return this.get(opts, callback);
};



/**
 * Setup a server by UUID
 *
 * @param {String} uuid : the UUID of the server.
 * @param {Object} params : setup parameters (optional).
 * @param {Object} options : Request options.
 * @param {Function} callback : of the form f(err, res).
 */
CNAPI.prototype.setupServer = function (uuid, params, options, callback) {
    if (!uuid)
        throw new TypeError('UUID is required');
    if (typeof (params) === 'function') {
        callback = params;
        params = {};
    } else if (typeof (options) === 'function') {
        callback = options;
        options = undefined;
    }

    var opts = { path: format('/servers/%s/setup', uuid) };
    if (options && options.headers) {
        opts.headers = options.headers;
    }

    return this.put(opts, params, callback);
};



/**
 * Gets a task
 *
 * @param {String} id : the task id.
 * @param {Object} options : Request options.
 * @param {Function} callback : of the form f(err, res).
 */
CNAPI.prototype.getTask = function (id, options, callback) {
    if (!id)
        throw new TypeError('Task Id is required');
    if (typeof (options) === 'function') {
        callback = options;
        options = undefined;
    }

    var opts = { path: format('/tasks/%s', id) };
    if (options && options.headers) {
        opts.headers = options.headers;
    }

    return this.get(opts, callback);
};



/**
 * Creates a vm
 *
 * @param {String} server : the UUID of the server.
 * @param {Object} params : attributes of the vm.
 * @param {Object} options : Request options.
 * @param {Function} callback : of the form f(err, res).
 */
CNAPI.prototype.createVm = function (server, params, options, callback) {
    if (!server)
        throw new TypeError('Server UUID is required');
    if (!params || typeof (params) !== 'object')
        throw new TypeError('params is required (object)');
    if (typeof (options) === 'function') {
        callback = options;
        options = undefined;
    }

    var opts = { path: format('/servers/%s/vms', server) };
    if (options && options.headers) {
        opts.headers = options.headers;
    }

    return this.post(opts, params, callback);
};



/**
 * Gets a vm on a server
 *
 * @param {String} server : the UUID of the server.
 * @param {String} uuid : the UUID of the vm.
 * @param {Object} options : Request options.
 * @param {Function} callback : of the form f(err, res).
 */
CNAPI.prototype.getVm = function (server, uuid, options, callback) {
    if (!server)
        throw new TypeError('Server UUID is required');
    if (!uuid)
        throw new TypeError('VM UUID is required');
    if (typeof (options) === 'function') {
        callback = options;
        options = undefined;
    }

    var opts = { path: format('/servers/%s/vms/%s', server, uuid) };
    if (options && options.headers) {
        opts.headers = options.headers;
    }

    return this.get(opts, callback);
};



/**
 * Stops a vm on a server
 *
 * @param {String} server : the UUID of the server.
 * @param {String} uuid : the UUID of the vm.
 * @param {Object} options : Request options.
 * @param {Function} callback : of the form f(err, res).
 */
CNAPI.prototype.stopVm = function (server, uuid, options, callback) {
    if (!server)
        throw new TypeError('Server UUID is required');
    if (!uuid)
        throw new TypeError('VM UUID is required');
    if (typeof (options) === 'function') {
        callback = options;
        options = undefined;
    }

    var opts = { path: format('/servers/%s/vms/%s/stop', server, uuid) };
    if (options && options.headers) {
        opts.headers = options.headers;
    }

    return this.post(opts, {}, callback);
};



/**
 * Starts a vm on a server
 *
 * @param {String} server : the UUID of the server.
 * @param {String} uuid : the UUID of the vm.
 * @param {Object} options : Request options.
 * @param {Function} callback : of the form f(err, res).
 */
CNAPI.prototype.startVm = function (server, uuid, options, callback) {
    if (!server)
        throw new TypeError('Server UUID is required');
    if (!uuid)
        throw new TypeError('VM UUID is required');
    if (typeof (options) === 'function') {
        callback = options;
        options = undefined;
    }

    var opts = { path: format('/servers/%s/vms/%s/start', server, uuid) };
    if (options && options.headers) {
        opts.headers = options.headers;
    }

    return this.post(opts, {}, callback);
};



/**
 * Reboots a vm on a server
 *
 * @param {String} server : the UUID of the server.
 * @param {String} uuid : the UUID of the vm.
 * @param {Object} options : Request options.
 * @param {Function} callback : of the form f(err, res).
 */
CNAPI.prototype.rebootVm = function (server, uuid, options, callback) {
    if (!server)
        throw new TypeError('Server UUID is required');
    if (!uuid)
        throw new TypeError('VM UUID is required');
    if (typeof (options) === 'function') {
        callback = options;
        options = undefined;
    }

    var opts = { path: format('/servers/%s/vms/%s/reboot', server, uuid) };
    if (options && options.headers) {
        opts.headers = options.headers;
    }

    return this.post(opts, {}, callback);
};



/**
 * Update a server
 *
 * @param {String} uuid : server uuid
 * @param {Object} params : Filter params.
 * @param {Object} options : Request options.
 * @param {Function} callback : of the form f(err, res).
 */
CNAPI.prototype.updateServer = function (uuid, params, options, callback) {
    if (!uuid)
        throw new TypeError('UUID is required');
    if (typeof (params) !== 'object')
        throw new TypeError('params must be an object');
    if (typeof (options) === 'function') {
        callback = options;
        options = undefined;
    }

    var opts = { path: format('/servers/%s', uuid) };
    if (options && options.headers) {
        opts.headers = options.headers;
    }

    return this.post(opts, params, callback);
};



/**
 * Reboot a server
 *
 * @param {String} server : the UUID of the server.
 * @param {Object} options : Request options.
 * @param {Function} callback : of the form f(err, res).
 */
CNAPI.prototype.rebootServer = function (server, options, callback) {
    if (!server)
        throw new TypeError('Server UUID is required');
    if (typeof (options) === 'function') {
        callback = options;
        options = undefined;
    }

    var opts = { path: format('/servers/%s/reboot', server) };
    if (options && options.headers) {
        opts.headers = options.headers;
    }

    return this.post(opts, {}, callback);
};



/**
 * Deletes a vm from a server
 *
 * @param {String} server : the UUID of the server.
 * @param {String} uuid : the UUID of the vm.
 * @param {Object} options : Request options.
 * @param {Function} callback : of the form f(err, res).
 */
CNAPI.prototype.deleteVm = function (server, uuid, options, callback) {
    if (!server)
        throw new TypeError('Server UUID is required');
    if (!uuid)
        throw new TypeError('VM UUID is required');
    if (typeof (options) === 'function') {
        callback = options;
        options = undefined;
    }

    var opts = { path: format('/servers/%s/vms/%s', server, uuid) };
    if (options && options.headers) {
        opts.headers = options.headers;
    }

    return this.del(opts, callback);
};



/**
 * Updates nics on a server
 *
 * @param {String} uuid : the UUID of the server.
 * @param {Object} params : Nic params.
 * @param {Object} options : Request options.
 * @param {Function} callback : of the form f(err, res).
 */
CNAPI.prototype.updateNics = function (uuid, params, options, callback) {
    if (!uuid)
        throw new TypeError('UUID is required');
    if (typeof (params) === 'function') {
        callback = params;
        params = {};
    } else if (typeof (options) === 'function') {
        callback = options;
        options = undefined;
    }

    var opts = { path: format('/servers/%s/nics', uuid) };
    if (options && options.headers) {
        opts.headers = options.headers;
    }

    return this.put(opts, params, callback);
};



/**
 * Runs a command on the specified server.  The optional 'params' argument can
 * contain two fields:
 *
 * @param {Array} args Array containing arguments to be passed in to command
 * @param {Object} env Object containing environment variables to be passed in
 * @param {Object} options : Request options.
 * @param {Function} callback : of the form f(err, res).
 */
function commandExecute(server, script, params, options, callback) {
    if (!server)
        throw new TypeError('Server UUID is required');
    if (!script)
        throw new TypeError('Script is required');

    if (typeof (params) === 'function') {
        callback = params;
        params = {};
    } else if (typeof (options) === 'function') {
        callback = options;
        options = undefined;
    }

    params.script = script;

    var opts = { path: format('/servers/%s/execute', server) };
    if (options && options.headers) {
        opts.headers = options.headers;
    }

    return this.post(opts, params, callback);
}

CNAPI.prototype.commandExecute = commandExecute;

module.exports = CNAPI;
