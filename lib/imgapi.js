/*
 * Copyright (c) 2012, Joyent, Inc. All rights reserved.
 *
 * Client library for the SDC Image API (IMGAPI)
 */

var format = require('util').format;
var qs = require('querystring');

var assert = require('assert-plus');
var restify = require('restify');




/**
 * Create an IMGAPI client.
 *
 * @param options {Object}
 *      - `url` {String} IMGAPI url
 */
function IMGAPI(options) {
    assert.object(options, 'options')
    assert.string(options.url, 'options.url')
    this.client = restify.createJsonClient(options);
}



/**
 * Ping. <https://mo.joyent.com/docs/imgapi/master/#Ping>
 *
 * TODO: support 'error' query param
 * @param error {String} Optional error code. If given, the ping is expected
 *      to respond with a sample error with that code (if supported).
 * @param callback {Function} `function (err, pong, res)`
 */
IMGAPI.prototype.ping = function (error, callback) {
    if (typeof (error) === 'function') {
        callback = error;
        error = undefined;
    }
    assert.optionalString(error, 'error');
    assert.func(callback, 'callback');

    var path = '/ping';
    if (error) {
        path += '?' + qs.stringify({error: error});
    }
    this.client.get(path, function (err, req, res, pong) {
        if (err) {
            callback(err, null, res);
        } else {
            callback(null, pong, res);
        }
    });
};


/**
 * Lists all Images
 *
 * @param params {Object} Optional filter params. NYI
 *      XXX Previous filters allowed? 'name', 'version', 'type', 'os',
 *          'restricted_to_uuid' & 'creator_uuid' params.
 * @param callback {Function} `function (err, images)`
 */
IMGAPI.prototype.listImages = function (params, callback) {
    if (typeof (params) === 'function') {
        callback = params;
        params = {};
    }
    assert.func(callback, 'callback');
    assert.object(params);

    var path = '/images';
    var query = qs.stringify(params);
    if (query.length > 0) {
        path += '?' + query;
    }
    this.client.get(path, function (err, req, res, images) {
        if (err) {
            callback(err);
        } else {
            callback(null, images);
        }
    });
};


/**
 * Gets an IMAGE by UUID
 *
 * @param {String} image_uuid : the UUID of the IMAGE.
 * @param {Function} callback : of the form f(err, img).
 */
IMGAPI.prototype.getImage = function (image_uuid, cb) {
    var self = this,
        path;

    if (typeof (image_uuid) !== 'string') {
        throw new TypeError('image_uuid (String) required');
    }

    path = format('/datasets/%s', image_uuid);

    return self.client.get(path, function (err, req, res, img) {
        if (err) {
            return cb(err);
        } else {
            return cb(null, img);
        }
    });
};

module.exports = IMGAPI;
