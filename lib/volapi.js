var util = require('util');

var assert = require('assert-plus');

var RestifyClient = require('./restifyclient');

function VOLAPI(options) {
    RestifyClient.call(this, options);
    this.url = options.url;
}

util.inherits(VOLAPI, RestifyClient);


VOLAPI.prototype.close = function close() {
    this.client.close();
};

VOLAPI.prototype.createVolume =
    function createVolume(params, options, callback) {
        if (typeof (options) === 'function') {
            callback = options;
            options = undefined;
        }

        assert.object(params, 'params');
        assert.optionalObject(options, 'options');
        assert.func(callback, 'callback');

        var opts = {
            path: '/volumes',
            headers: {}
        };

        if (options) {
            if (options.headers) {
                opts.headers = options.headers;
            }

            opts.log = options.log || this.log;
        }

        if (params.context) {
            opts.headers['x-context'] = JSON.stringify(params.context);
        }

        return this.post(opts, params, callback);
    };

VOLAPI.prototype.listVolumes = function listVolumes(params, options, callback) {
    // If only one argument then this is 'find all'
    if (typeof (params) === 'function') {
        callback = params;
        params = {};
    // If 2 arguments -> (params, callback)
    } else if (typeof (options) === 'function') {
        callback = options;
        options = undefined;
    }

    assert.optionalObject(params, 'params');
    assert.optionalObject(options, 'options');
    assert.func(callback, 'callback');

    var reqOpts = { path: '/volumes', query: params };
    if (options) {
        reqOpts.headers = options.headers;
        reqOpts.log = options.log || this.log;
    }

    this.get(reqOpts, callback);
};

VOLAPI.prototype.getVolume = function getVolume(params, options, callback) {
    var query = {};

    // If 2 arguments -> (params, callback)
    if (typeof (options) === 'function') {
        callback = options;
        options = undefined;
    }

    assert.object(params, 'params');
    assert.string(params.uuid, 'params.uuid');
    assert.optionalObject(options, 'options');
    assert.func(callback, 'callback');

    if (params.owner_uuid) {
        query.owner_uuid = params.owner_uuid;
    }

    var reqOpts = { path: '/volumes' + params.uuid, query: query };
    if (options) {
        reqOpts.headers = options.headers;
        reqOpts.log = options.log || this.log;
    }

    this.get(reqOpts, callback);
};

VOLAPI.prototype.deleteVolume =
    function deleteVolume(params, options, callback) {
        var query = {};

        if (typeof (options) === 'function') {
            callback = options;
            options = undefined;
        }

        assert.object(params, 'params');
        assert.string(params.uuid, 'params.uuid');
        assert.optionalObject(options, 'options');
        assert.func(callback, 'callback');

        if (params.owner_uuid) {
            query.owner_uuid = params.owner_uuid;
        }

        var reqOpts = {
            path: '/volumes/' + params.uuid,
            query: query,
            headers: {}
        };

        if (options) {
            if (options.headers) {
                reqOpts.headers = options.headers;
            }

            reqOpts.log = options.log || this.log;
        }

        if (params.context) {
            reqOpts.headers['x-context'] = JSON.stringify(params.context);
        }

        return this.del(reqOpts, callback);
    };

/**
 * Does a ping check to see if API is still serving requests.
 *
 * @param {Function} callback : of the form f(err).
 */
VOLAPI.prototype.ping = function (callback) {
    var opts = { path: '/ping' };
    this.get(opts, callback);
};

module.exports = VOLAPI;