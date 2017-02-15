/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2016, Joyent, Inc.
 */

var assert = require('assert-plus');
var util = require('util');

var RestifyClient = require('./restifyclient');

var POLL_VOLUME_STATE_CHANGE_PERIOD_IN_MS = 1000;

function VOLAPI(options) {
    assert.object(options, 'options');
    assert.string(options.version, 'options.version');
    assert.notEqual(options.version, '*');
    assert.string(options.userAgent, 'options.userAgent');

    RestifyClient.call(this, options);
    this.url = options.url;
}

util.inherits(VOLAPI, RestifyClient);


VOLAPI.prototype.close = function close() {
    this.client.close();
};

function doCreateVolume(client, params, options, callback) {
    assert.object(client, 'client');
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

    return client.post(opts, params, callback);
}

VOLAPI.prototype.createVolume =
function createVolume(params, options, callback) {
    if (typeof (options) === 'function') {
        callback = options;
        options = undefined;
    }

    assert.object(params, 'params');
    assert.optionalObject(options, 'options');
    assert.func(callback, 'callback');

    doCreateVolume(this, params, options, callback);
};

function pollVolumeStateChange(client, volumeUuid, state, callback) {
    assert.object(client, 'client');
    assert.uuid(volumeUuid, 'volumeUuid');
    assert.string(state, 'state');
    assert.func(callback, 'callback');

    function _poll() {
        client.getVolume({
            uuid: volumeUuid
        }, function onGetVolume(getVolumeErr, volume) {
            if (getVolumeErr || volume.state === state) {
                callback(getVolumeErr, volume);
                return;
            } else {
                setTimeout(_poll, POLL_VOLUME_STATE_CHANGE_PERIOD_IN_MS);
            }
        });
    }

    setTimeout(_poll, POLL_VOLUME_STATE_CHANGE_PERIOD_IN_MS);
}

function pollVolumeCreation(client, volumeUuid, callback) {
    assert.object(client, 'client');
    assert.uuid(volumeUuid, 'volumeUuid');
    assert.func(callback, 'callback');

    pollVolumeStateChange(client, volumeUuid, 'ready', callback);
}

function pollVolumeDeletion(client, volumeUuid, callback) {
    assert.object(client, 'client');
    assert.uuid(volumeUuid, 'volumeUuid');
    assert.func(callback, 'callback');

    pollVolumeStateChange(client, volumeUuid, 'deleted', callback);
}

VOLAPI.prototype.createVolumeAndWait =
function createVolumeAndWait(params, options, callback) {
    if (typeof (options) === 'function') {
        callback = options;
        options = undefined;
    }

    assert.object(params, 'params');
    assert.optionalObject(options, 'options');
    assert.func(callback, 'callback');

    var self = this;

    doCreateVolume(self, params, options,
        function onVolumeCreated(volumeCreationErr, volume) {
            if (volumeCreationErr || volume === undefined ||
                volume.state !== 'creating') {
                callback(volumeCreationErr, volume);
                return;
            } else {
                pollVolumeCreation(self, volume.uuid, callback);
            }
        });
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

    var reqOpts = { path: '/volumes/' + params.uuid, query: query };
    if (options) {
        reqOpts.headers = options.headers;
        reqOpts.log = options.log || this.log;
    }

    this.get(reqOpts, callback);
};

function doDeleteVolume(client, params, options, callback) {
    var query = {};

    assert.object(client, 'client');
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

    return client.del(reqOpts, callback);
}

VOLAPI.prototype.deleteVolume =
    function deleteVolume(params, options, callback) {

        if (typeof (options) === 'function') {
            callback = options;
            options = undefined;
        }

        doDeleteVolume(this, params, options, callback);
    };

VOLAPI.prototype.deleteVolumeAndWait =
    function deleteVolumeAndWait(params, options, callback) {

        var self = this;

        if (typeof (options) === 'function') {
            callback = options;
            options = undefined;
        }

        doDeleteVolume(this, params, options,
            function onVolumeDeleted(volumeDeletionErr, volume) {
                if (volumeDeletionErr || volume === undefined ||
                    volume.state !== 'deleting') {
                    callback(volumeDeletionErr, volume);
                    return;
                } else {
                    pollVolumeDeletion(self, volume.uuid, callback);
                }
            });
    };

VOLAPI.prototype.updateVolume =
    function updateVolume(params, options, callback) {
        if (typeof (options) === 'function') {
            callback = options;
            options = {};
        }

        assert.object(params, 'params');
        assert.uuid(params.uuid, 'params.uuid');
        assert.optionalObject(options, 'options');
        assert.func(callback, 'callback');

        var opts = {
            path: '/volumes/' + params.uuid,
            headers: {}
        };

        if (options) {
            if (options.headers) {
                opts.headers = options.headers;
            }

            opts.log = options.log || this.log;
        }

        return this.post(opts, params, callback);
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