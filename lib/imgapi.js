/*
 * Copyright (c) 2012, Joyent, Inc. All rights reserved.
 *
 * Client library for the SDC Image API (IMGAPI)
 */

var util = require('util'),
    format = util.format;
var qs = require('querystring');
var fs = require('fs');
var crypto = require('crypto');

var WError = require('verror').WError;
var assert = require('assert-plus');
var restify = require('restify');



// ---- client errors

function ChecksumError(cause, actual, expected) {
    if (expected === undefined) {
        actual = cause;
        expected = actual;
        cause = undefined;
    }
    assert.optionalObject(cause);
    assert.string(actual);
    assert.string(expected);

    var args = [];
    if (cause) args.push(cause);
    args = args.concat('content-md5 expected to be %s, but was %s',
        expected, actual);
    WError.apply(this, args);
}
util.inherits(ChecksumError, WError);



// ---- client API

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
 * @param {UUID} account : Optional. The UUID of the account who is querying.
 *      If given this will only return images accessible to that account.
 * @param {Function} callback : `function (err, image, res)`
 */
IMGAPI.prototype.getImage = function getImage(uuid, account, callback) {
    assert.string(uuid, 'uuid');
    if (callback === undefined) {
        callback = account;
        account = undefined;
    }
    assert.optionalString(account, 'account');
    assert.func(callback, 'callback');

    var path = format('/images/%s', uuid);
    if (account) {
        path += '?' + qs.stringify({account: account});
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
 * @param {UUID} account : Optional. The UUID of the account on behalf of whom
 *      this request is being made. If given this will only return images
 *      accessible to that account.
 * @param {Function} callback : `function (err, image, res)`
 */
IMGAPI.prototype.createImage = function createImage(data, account, callback) {
    assert.object(data, 'data');
    if (callback === undefined) {
        callback = account;
        account = undefined;
    }
    assert.optionalString(account, 'account');
    assert.func(callback, 'callback');

    var path = '/images';
    if (account) {
        path += '?' + qs.stringify({account: account});
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
 * Import an image (operator/admin use only).
 *
 * This differs from `createImage` in that you can import an image and
 * persist its `uuid` (and `published_at`). This is for operator use only.
 * Typically it is for importing existing images from images.joyent.com.
 *
 * @param {String} data : the image data.
 * @param {Function} callback : `function (err, image, res)`
 */
IMGAPI.prototype.adminImportImage = function adminImportImage(data, callback) {
    assert.object(data, 'data');
    assert.func(callback, 'callback');
    assert.string(data.uuid, 'data.uuid');

    var path = format('/images/%s?action=import', data.uuid);
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
 * @param {UUID} account : Optional. The UUID of the account on behalf of whom
 *      this request is being made. If given this will only return images
 *      accessible to that account.
 * @param {Function} callback : `function (err, image, res)`
 */
IMGAPI.prototype.addImageFile = function addImageFile(uuid, filePath, account,
                                                      callback) {
    assert.string(uuid, 'uuid');
    assert.string(filePath, 'filePath');
    if (callback === undefined) {
        callback = account;
        account = undefined;
    }
    assert.optionalString(account, 'account');
    assert.func(callback, 'callback');

    var self = this;
    var path = format('/images/%s/file', uuid);
    if (account) {
        path += '?' + qs.stringify({account: account});
    }
    fs.stat(filePath, function (statErr, stats) {
        if (statErr) {
            callback(statErr);
            return;
        }

        var opts = {
            path: path,
            headers: {
                'Content-Type': 'application/octet-stream',
                'Content-Length': stats.size,
                'Accept': 'application/json'
            }
        };
        self.rawClient.put(opts, function (connectErr, req) {
            if (connectErr) {
                callback(connectErr);
                return;
            }

            fs.createReadStream(filePath).pipe(req);

            req.on('result', function (resultErr, res) {
                if (resultErr) {
                    callback(resultErr, null, res);
                    return;
                }

                var chunks = [];
                res.setEncoding('utf8');
                res.on('data', function (chunk) {
                    chunks.push(chunk);
                });
                res.on('end', function () {
                    var body = chunks.join('');
                    var data;
                    try {
                        data = JSON.parse(body);
                    } catch (syntaxErr) {
                        callback(new WError(syntaxErr,
                            'invalid image data in response: \'%s\'', body));
                        return;
                    }
                    callback(null, data, res);
                });
            });
        });
    });
};


/**
 * Get an image file.
 *
 * @param {String} uuid : the UUID of the image.
 * @param {String} filePath : Path to which to save the image file.
 * @param {UUID} account : Optional. The UUID of the account on behalf of whom
 *      this request is being made. If given this will only return images
 *      accessible to that account.
 * @param {Function} callback : `function (err, res)`
 *
 * TODO: May want a version of this that returns a stream, `getImageFileStream`.
 */
IMGAPI.prototype.getImageFile = function getImageFile(uuid, filePath, account,
                                                      callback) {
    assert.string(uuid, 'uuid');
    assert.string(filePath, 'filePath');
    if (callback === undefined) {
        callback = account;
        account = undefined;
    }
    assert.optionalString(account, 'account');
    assert.func(callback, 'callback');

    var self = this;
    var path = format('/images/%s/file', uuid);
    if (account) {
        path += '?' + qs.stringify({account: account});
    }
    self.rawClient.get(path, function (connectErr, req) {
        if (connectErr) {
            callback(connectErr);
            return;
        }
        req.on('result', function (resultErr, res) {
            if (resultErr) {
                callback(resultErr, res);
                return;
            }

            res.pipe(fs.createWriteStream(filePath));

            var hash = crypto.createHash('md5');
            res.on('data', function (chunk) { hash.update(chunk); });

            var finished = false;
            function finish(err) {
                if (!finished) {
                    if (!err) {
                        var md5_expected = res.headers['content-md5'];
                        var md5_actual = hash.digest('base64');
                        if (md5_actual !== md5_expected) {
                            err = new ChecksumError(md5_actual, md5_expected);
                        }
                    }
                    callback(err, res);
                    finished = true;
                }
            }
            res.on('error', finish);
            res.on('end', finish);
        });
    });
};


/**
 * Activate an image.
 *
 * @param {String} uuid : the UUID of the image.
 * @param {UUID} account : Optional. The UUID of the account on behalf of whom
 *      this request is being made. If given this will only return images
 *      accessible to that account.
 * @param {Function} callback : `function (err, image, res)`
 */
IMGAPI.prototype.activateImage = function activateImage(uuid, account, callback) {
    assert.string(uuid, 'uuid');
    if (callback === undefined) {
        callback = account;
        account = undefined;
    }
    assert.optionalString(account, 'account');
    assert.func(callback, 'callback');

    var path = format('/images/%s', uuid);
    var query = {action: 'activate'};
    if (account) {
        query.account = account;
    }
    path += '?' + qs.stringify(query);
    this.client.post(path, function (err, req, res, image) {
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
 * @param {String} uuid : the UUID of the image.
 * @param {UUID} account : Optional. The UUID of the account on behalf of whom
 *      this request is being made. If given this will restrict to images
 *      accessible to that account.
 * @param {Function} callback : `function (err, res)`
 */
IMGAPI.prototype.deleteImage = function deleteImage(uuid, account, callback) {
    assert.string(uuid, 'uuid');
    if (callback === undefined) {
        callback = account;
        account = undefined;
    }
    assert.optionalString(account, 'account');
    assert.func(callback, 'callback');

    var path = format('/images/%s', uuid);
    if (account) {
        path += '?' + qs.stringify({account: account});
    }
    this.client.del(path, function (err, req, res) {
        if (err) {
            callback(err, res);
        } else {
            callback(null, res);
        }
    });
};


module.exports = IMGAPI;
