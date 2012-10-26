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
    assert.object(options, 'options');
    assert.string(options.url, 'options.url');
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
IMGAPI.prototype.ping = function ping(error, callback) {
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
 * @param filters {Object} Optional filter params. NYI
 *      XXX Previous filters allowed? 'name', 'version', 'type', 'os',
 *          'restricted_to_uuid' & 'creator_uuid' params.
 * @param callback {Function} `function (err, images, res)`
 */
IMGAPI.prototype.listImages = function listImages(filters, callback) {
    if (typeof (filters) === 'function') {
        callback = filters;
        filters = {};
    }
    assert.func(callback, 'callback');
    assert.object(filters);

    var path = '/images';
    var query = qs.stringify(filters);
    if (query.length > 0) {
        path += '?' + query;
    }
    this.client.get(path, function (err, req, res, images) {
        if (err) {
            callback(err, null, res);
        } else {
            callback(null, images, res);
        }
    });
};



/**
 * Gets an image by UUID.
 *
 * @param {String} uuid : the UUID of the IMAGE.
 * @param {Function} callback : `function (err, image, res)`
 */
IMGAPI.prototype.getImage = function getImage(uuid, callback) {
    assert.string(uuid, 'uuid');
    assert.func(callback, 'callback');

    var path = format('/images/%s', uuid);
    this.client.get(path, function (err, req, res, image) {
        if (err) {
            callback(err, null, res);
        } else {
            callback(null, image, res);
        }
    });
};



module.exports = IMGAPI;
