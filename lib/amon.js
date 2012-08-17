// Copyright 2012 Joyent, Inc.  All rights reserved.

var format = require('util').format;

var assert = require('assert-plus');
var restify = require('restify');



// --- Exported Amon Client

/**
 * Constructor
 *
 * Note that in options you can pass in any parameters that the restify
 * RestClient constructor takes (for example retry/backoff settings).
 *
 * @param {Object} options
 *    - url {String} Amon Master location.
 *    - ... any other options allowed to `restify.createJsonClient`
 *
 */
function Amon(options) {
    if (!options)
        throw new TypeError('options required');
    if (!options.url)
        throw new TypeError('options.url (String) is required');

    this.client = restify.createJsonClient(options);
}


/**
 * Ping Amon server.
 *
 * @param {Function} callback : call of the form f(err, pong).
 */
Amon.prototype.ping = function (callback) {
    if (!callback || typeof (callback) !== 'function')
        throw new TypeError('callback (Function) is required');

    return this.client.get('/ping', function (err, req, res, pong) {
        if (err) {
            return callback(err);
        }
        return callback(null, pong);
    });
};



//---- Probe Groups

/**
 * List probe groups by user.
 *
 * @param {String} user : the user uuid.
 * @param {Function} callback : call of the form f(err, probegroups).
 */
Amon.prototype.listProbeGroups = function (user, callback) {
    assert.string(user, 'user');
    assert.func(callback, 'callback');
    var path = format('/pub/%s/probegroups', user);
    return this.client.get(path, function (err, req, res, obj) {
        if (err) {
            return callback(err);
        }
        return callback(null, obj);
    });
};


/**
 * Create a probe group.
 *
 * @param {String} user : The user UUID.
 * @param {Object} probeGroup : The probe group data.
 */
Amon.prototype.createProbeGroup = function (user, probeGroup, callback) {
    assert.string(user, 'user');
    assert.object(probeGroup, 'probeGroup');
    var path = format('/pub/%s/probegroups', user);
    return this.client.post(path, probeGroup, function (err, req, res, obj) {
        if (err) {
            return callback(err);
        }
        return callback(null, obj);
    });
};


/**
 * Update a probe group.
 *
 * @param {String} user : The user UUID.
 * @param {String} uuid : probe group UUID.
 * @param {Object} probeGroup : The probe group data.
 */
Amon.prototype.putProbeGroup = function (user, uuid, probeGroup, callback) {
    assert.string(user, 'user');
    assert.string(uuid, 'uuid');
    assert.object(probeGroup, 'probeGroup');
    var path = format('/pub/%s/probegroups/%s', user, uuid);
    return this.client.put(path, probeGroup, function (err, req, res, obj) {
        if (err) {
            return callback(err);
        }
        return callback(null, obj);
    });
};


/**
 * Deletes a probe group from Amon.
 *
 * @param {String} user : the user uuid.
 * @param {String} uuid : probe group UUID.
 * @param {Function} callback of the form f(err).
 */
Amon.prototype.deleteProbeGroup = function (user, uuid, callback) {
    assert.string(user, 'user');
    assert.string(uuid, 'uuid');
    assert.func(callback, 'callback');
    var path = format('/pub/%s/probegroups/%s', user, uuid);
    return this.client.del(path, function (err, req, res) {
        if (err) {
            return callback(err);
        }
        return callback(null);
    });
};


/**
 * Get a probe group.
 *
 * @param {String} user : the user uuid.
 * @param {String} uuid : probe group UUID.
 * @param {Function} callback of the form f(err, account).
 */
Amon.prototype.getProbeGroup = function (user, uuid, callback) {
    assert.string(user, 'user');
    assert.string(uuid, 'uuid');
    assert.func(callback, 'callback');
    var path = format('/pub/%s/probegroups/%s', user, uuid);
    return this.client.get(path, function (err, req, res, obj) {
        if (err) {
            return callback(err);
        }
        return callback(null, obj);
    });
};



//---- Probes

/**
 * List probes by user.
 *
 * @param {String} user : the user uuid.
 * @param {Function} callback : call of the form f(err, probes).
 */
Amon.prototype.listProbes = function (user, callback) {
    assert.string(user, 'user');
    assert.func(callback, 'callback');
    var path = format('/pub/%s/probes', user);
    return this.client.get(path, function (err, req, res, obj) {
        if (err) {
            return callback(err);
        }
        return callback(null, obj);
    });
};


/**
 * Create a probe.
 *
 * @param {String} user : The user UUID.
 * @param {Object} probe : The probe data.
 */
Amon.prototype.createProbe = function (user, probe, callback) {
    assert.string(user, 'user');
    assert.object(probe, 'probe');
    var path = format('/pub/%s/probes', user);
    return this.client.post(path, probe, function (err, req, res, obj) {
        if (err) {
            return callback(err);
        }
        return callback(null, obj);
    });
};


/**
 * Update a probe.
 *
 * @param {String} user : The user UUID.
 * @param {String} uuid : probe UUID.
 * @param {Object} probe : The probe data.
 */
Amon.prototype.putProbe = function (user, uuid, probe, callback) {
    assert.string(user, 'user');
    assert.string(uuid, 'uuid');
    assert.object(probe, 'probe');
    var path = format('/pub/%s/probes/%s', user, uuid);
    return this.client.put(path, probe, function (err, req, res, obj) {
        if (err) {
            return callback(err);
        }
        return callback(null, obj);
    });
};


/**
 * Deletes a probe from Amon.
 *
 * @param {String} user : the user uuid.
 * @param {String} uuid : probe UUID.
 * @param {Function} callback of the form f(err).
 */
Amon.prototype.deleteProbe = function (user, uuid, callback) {
    assert.string(user, 'user');
    assert.string(uuid, 'uuid');
    assert.func(callback, 'callback');
    var path = format('/pub/%s/probes/%s', user, uuid);
    return this.client.del(path, function (err, req, res) {
        if (err) {
            return callback(err);
        }
        return callback(null);
    });
};


/**
 * Gets probe.
 *
 * @param {String} user : the user uuid.
 * @param {String} uuid : probe UUID.
 * @param {Function} callback of the form f(err, account).
 */
Amon.prototype.getProbe = function (user, uuid, callback) {
    assert.string(user, 'user');
    assert.string(uuid, 'uuid');
    assert.func(callback, 'callback');
    var path = format('/pub/%s/probes/%s', user, uuid);
    return this.client.get(path, function (err, req, res, obj) {
        if (err) {
            return callback(err);
        }
        return callback(null, obj);
    });
};




module.exports = Amon;
