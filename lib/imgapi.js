/*
 * Copyright (c) 2012, Joyent, Inc. All rights reserved.
 *
 * Client library for the SDC Image API (IMGAPI)
 */

var format = require('util').format;
var qs = require('querystring');
var fs = require('fs');

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
    this.rawClient = restify.createClient(options);
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
 * @param {String} uuid : the UUID of the image.
 * @param {UUID} user : Optional. The UUID of the user who is querying. If
 *      given this will only return images accessible to that user.
 * @param {Function} callback : `function (err, image, res)`
 */
IMGAPI.prototype.getImage = function getImage(uuid, user, callback) {
    assert.string(uuid, 'uuid');
    if (callback === undefined) {
        callback = user;
        user = undefined;
    }
    assert.optionalString(user, 'user');
    assert.func(callback, 'callback');

    var path = format('/images/%s', uuid);
    if (user) {
        path += '?' + qs.stringify({user: user});
    }
    this.client.get(path, function (err, req, res, image) {
        if (err) {
            callback(err, null, res);
        } else {
            callback(null, image, res);
        }
    });
};



/**
 * Create an image.
 *
 * @param {String} data : the image data.
 * @param {UUID} user : Optional. The UUID of the user on behalf of whom this
 *      request is being made. If given this will only return images
 *      accessible to that user.
 * @param {Function} callback : `function (err, image, res)`
 */
IMGAPI.prototype.createImage = function createImage(data, user, callback) {
    assert.object(data, 'data');
    if (callback === undefined) {
        callback = user;
        user = undefined;
    }
    assert.optionalString(user, 'user');
    assert.func(callback, 'callback');

    var path = '/images';
    if (user) {
        path += '?' + qs.stringify({user: user});
    }
    this.client.post(path, data, function (err, req, res, image) {
        if (err) {
            callback(err, null, res);
        } else {
            callback(null, image, res);
        }
    });
};


/**
 * Add an image file.
 *
 * @param {String} uuid : the UUID of the image.
 * @param {String} filePath : Path to the image file.
 * @param {UUID} user : Optional. The UUID of the user on behalf of whom this
 *      request is being made. If given this will only return images
 *      accessible to that user.
 * @param {Function} callback : `function (err, image, res)`
 */
IMGAPI.prototype.addImageFile = function addImageFile(uuid, filePath, user, callback) {
    assert.string(uuid, 'uuid');
    assert.string(filePath, 'filePath');
    if (callback === undefined) {
        callback = user;
        user = undefined;
    }
    assert.optionalString(user, 'user');
    assert.func(callback, 'callback');

    var self = this;
    var path = format('/images/%s/file', uuid);
    if (user) {
        path += '?' + qs.stringify({user: user});
    }
    fs.stat(filePath, function (statErr, stats) {
        if (statErr) {
            return callback(statErr);
        }

        var opts = {
            path: path,
            headers: {
                'content-type': 'application/octet-stream',
                'content-length': stats.size
            }
        };
        self.rawClient.put(opts, function (connectErr, req) {
            if (connectErr) {
                return callback(connectErr);
            }

            fs.createReadStream(filePath).pipe(req);

            req.on('result', function (resultErr, res) {
                if (resultErr) {
                    return callback(resultErr, null, res);
                }

                var body = [];
                res.setEncoding('utf8');
                res.on('data', function (chunk) {
                    body.push(chunk);
                });
                res.on('end', function () {
                    callback(null, body.join(''), res);
                });
            });
        });
    });
};



module.exports = IMGAPI;
