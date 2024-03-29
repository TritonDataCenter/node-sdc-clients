/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2020 Joyent, Inc.
 * Copyright 2022 MNX Cloud, Inc.
 */

/*
 * Client library for the TritonDC Image API (IMGAPI).
 *
 * Usage without auth (e.g. when talking to in-SDC IMGAPI on admin network):
 *
 *      var imgapi = require('sdc-clients/lib/imgapi');
 *      var client = imgapi.createClient({url: <URL>});
 *      client.ping(function (err, pong, res) { ... });
 *
 * Usage with HTTP Basic auth (no current IMGAPI deploys using this):
 *
 *      var client = imgapi.createClient({
 *          url: <URL>,
 *          user: <USERNAME>,
 *          password: <PASSWORD>
 *      });
 *      client.ping(function (err, pong, res) { ... });
 *
 * Usage with HTTP-Signature auth (e.g. https://images.smartos.org -- however
 * GETs to images.smartos.org don't require auth):
 *
 *      var client = imgapi.createClient({
 *          url: <URL>,
 *          user: <USERNAME>,
 *          log: <BUNYAN-LOGGER>,
 *          sign: imgapi.cliSigner({
 *              keyId: <KEY-ID>,        // ssh fingerprint, priv key path
 *              user: <USERNAME>,
 *              log: <BUNYAN-LOGGER>,
 *          })
 *      });
 *      client.ping(function (err, pong, res) { ... });
 *
 * For IMGAPIs that support channels -- separate buckets for images -- you
 * can specify the channel in the constructor as a separate field:
 *
 *      var client = imgapi.createClient({
 *          url: <URL>,
 *          channel: <CHANNEL>
 *          ...
 *      });
 *
 * or as a query param on the `url`, e.g.
 * <https://updates.tritondatacenter.com?channel=staging>.
 */

var p = console.log;
var util = require('util'),
    format = util.format;
var qs = require('querystring');
var fs = require('fs');
var crypto = require('crypto');
var vasync = require('vasync');
var async = require('async');
var once = require('once');
var WError = require('verror').WError;
var assert = require('assert-plus');
var restifyClients = require('restify-clients');
var mod_url = require('url');
var backoff = require('backoff');
var auth = require('smartdc-auth');
var sshpk = require('sshpk');


// ---- globals

var nodeVer = process.versions.node.split('.').map(Number);
var writeStreamFinishEvent = 'finish';
if (nodeVer[0] === 0 && nodeVer[1] <= 8) {
    writeStreamFinishEvent = 'close';
}


// ---- client errors

function ChecksumError(cause, actual, expected) {
    this.code = 'ChecksumError';
    if (expected === undefined) {
        expected = actual;
        actual = cause;
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

/**
 * An error signing a request.
 */
function SigningError(cause) {
    this.code = 'SigningError';
    assert.optionalObject(cause);
    var msg = 'error signing request';
    var args = (cause ? [cause, msg] : [msg]);
    WError.apply(this, args);
}
util.inherits(SigningError, WError);




// ---- internal support stuff

function BunyanNoopLogger() {}
BunyanNoopLogger.prototype.trace = function () {};
BunyanNoopLogger.prototype.debug = function () {};
BunyanNoopLogger.prototype.info = function () {};
BunyanNoopLogger.prototype.warn = function () {};
BunyanNoopLogger.prototype.error = function () {};
BunyanNoopLogger.prototype.fatal = function () {};
BunyanNoopLogger.prototype.child = function () { return this; };
BunyanNoopLogger.prototype.end = function () {};


/**
 * Note: Borrowed from muskie.git/lib/common.js. The hope is that this hack
 * will no longer be necessary in node 0.10.x.
 *
 * This is so shitty...
 * Node makes no guarantees it won't emit. Even if you call pause.
 * So basically, we buffer whatever chunks it decides it wanted to
 * throw at us. Later we go ahead and remove the listener we setup
 * to buffer, and then re-emit.
 */
function pauseStream(stream) {
    function _buffer(chunk) {
        stream.__buffered.push(chunk);
    }

    function _catchEnd(chunk) {
        stream.__imgapi_ended = true;
    }

    stream.__imgapi_ended = false;
    stream.__imgapi_paused = true;
    stream.__buffered = [];
    stream.on('data', _buffer);
    stream.once('end', _catchEnd);
    stream.pause();

    stream._resume = stream.resume;
    stream.resume = function _imgapi_resume() {
        if (!stream.__imgapi_paused)
            return;

        stream.removeListener('data', _buffer);
        stream.removeListener('end', _catchEnd);

        stream.__buffered.forEach(stream.emit.bind(stream, 'data'));
        stream.__buffered.length = 0;

        stream._resume();
        stream.resume = stream._resume;

        if (stream.__imgapi_ended)
            stream.emit('end');
    };
}


function extendErrFromRawBody(err, res, callback) {
    if (!res) {
        callback(err);
        return;
    }

    function finish_() {
        if (errBody && (!err.body.message || !err.body.code)) {
            try {
                var data = JSON.parse(errBody);
                err.message = data.message;
                err.body.message = data.message;
                err.body.code = data.code;
            } catch (e) {
                err.message = errBody;
                err.body.message = errBody;
            }
        }
        callback(err);
    }
    var finish = once(finish_);

    var errBody = '';
    res.on('data', function (chunk) { errBody += chunk; });
    res.on('error', finish);
    res.on('end', finish);
}


function objCopy(obj) {
    var copy = {};
    Object.keys(obj).forEach(function (k) {
        copy[k] = obj[k];
    });
    return copy;
}

function simpleMerge(a, b) {
    assert.object(a, 'a');
    assert.object(b, 'b');
    var bkeys = Object.keys(b);
    bkeys.forEach(function (key) {
        a[key] = b[key];
    });
}


// ---- client API

/* BEGIN JSSTYLED */
/**
 * Create an IMGAPI client.
 *
 * @param options {Object}
 *      - `url` {String} IMGAPI url. This may optionally include a
 *        '?channel=<channel>' query param. If both this and `options.channel`
 *        are given, the latter wins.
 *      - `channel` {String} Optional. The channel to use, for IMGAPI servers
 *        that use channels.
 *        See <https://updates.tritondatacenter.com/docs/#ListChannels>.
 *      - `user` {String} Optional. Used for basic or http-signature auth.
 *      - `password` {String} Optional. If provided, this implies that basic
 *        auth should be used for client requests.
 *      - `sign` {Function} Optional. Implies http-signature auth. This is
 *        a function that handles signing. It is of the form
 *        `function (<string-to-sign>, <callback>)`.
 *      - `version` {String} Optional. Used for the accept-version
 *        header in requests to the IMGAPI server. If unspecified this
 *        defaults to '*', meaning that over time you could experience breaking
 *        changes. Specifying a value is strongly recommended. E.g. '~2'.
 *      - `contentMd5` {Object} Handling of Content-MD5 response header. Per
 *        https://github.com/joyent/triton/blob/master/docs/developer-guide/coding-guidelines-node.md#restify-clients-contentmd5-option
 *        this defaults to `{encodings: ['utf8', 'binary']}`.
 *      - ... and any other standard restify client options,
 *        e.g. `options.userAgent`.
 *
 * Authentication (i.e. the 'Authorization' header) is applied for all client
 * requests if either the 'password' or 'sign' options are provided. The
 * former implies Basic auth, the latter http-signature auth.
 */
/* END JSSTYLED */
function IMGAPI(options) {
    assert.object(options, 'options');
    assert.string(options.url, 'options.url');
    assert.optionalString(options.channel, 'options.channel');
    assert.optionalString(options.user, 'options.user');
    assert.optionalString(options.password, 'options.password');
    assert.optionalFunc(options.sign, 'options.sign');
    assert.ok(!(options.password && options.sign),
        'not both "options.password" and "options.sign"');
    if (options.version) {
        // Allow options.version=null to avoid default, mainly for testing.
        assert.string(options.version, 'options.version');
    }
    assert.optionalObject(options.contentMd5, 'options.contentMd5');
    options = objCopy(options);

    // `this.url` is the URL with the optional channel query param *removed*.
    var parsed = mod_url.parse(options.url);
    if (parsed.query) {
        var params = qs.parse(parsed.query);
        if (params.channel) {
            this.channel = params.channel;
        }
        delete parsed.search;
        this.url = mod_url.format(parsed);
    } else {
        this.url = options.url;
    }
    // _basePath: the URL subpath *without* a trailing '/'
    this._basePath = parsed.pathname;
    if (this._basePath.slice(-1) === '/') {
        this._basePath = this._basePath.slice(0, -1);
    }

    if (options.channel) {
        this.channel = options.channel;
        delete options.channel;
    }

    // Make sure a given bunyan logger has reasonable client_re[qs]
    // serializers.
    if (options.log && options.log.serializers &&
        !options.log.serializers.client_req) {
        options.log = options.log.child({
            serializers: restifyClients.bunyan.serializers
        });
    }
    if (options.version === undefined) {
        options.version = '*';
    }

    if (!options.contentMd5) {
        options.contentMd5 = {
            encodings: ['utf8', 'binary']
        };
    }

    this.client = restifyClients.createJsonClient(options);
    // Work around <https://github.com/mcavage/node-restify/pull/291>.
    // Switch to `restify.createHttpClient` when that pull is in.
    options.type = 'http';
    this.rawClient = restifyClients.createClient(options);
    if (options.password) {
        assert.string(options.user, 'options.password, but no options.user');
        this.client.basicAuth(options.user, options.password);
        this.rawClient.basicAuth(options.user, options.password);
    } else if (options.sign) {
        assert.string(options.user, 'options.sign, but no options.user');
        this.user = options.user;
        this.sign = options.sign;
    }
}

IMGAPI.prototype.close = function close() {
    this.client.close();
    this.rawClient.close();
};

IMGAPI.prototype._getAuthHeaders = function _getAuthHeaders(callback) {
    var self = this;
    if (!self.sign) {
        callback(null, {});
        return;
    }

    var headers = {};
    headers.date = new Date().toUTCString();
    var sigstr = 'date: ' + headers.date;

    self.sign(sigstr, function (err, signature) {
        if (err || !signature) {
            callback(new SigningError(err));
            return;
        }

        // Note that we are using the *user* for the "keyId" in the
        // HTTP-Signature scheme. This is because on the server-side (IMGAPI)
        // only the username is used to determine relevant keys with which to
        // verify. The `keyId` in this code is only meaningful client-side.
        //
        // We *could* change and pass through the `keyId` and an additional
        // `user` param. Then the server-side would only need to verify
        // against a specific key signature. This is what Manta currently
        // does.
        headers.authorization = format(
            'Signature keyId="%s",algorithm="%s",signature="%s"',
            self.user, signature.algorithm, signature.signature);
        callback(null, headers);
    });
};


/**
 * Return an appropriate query string *with the leading '?'* from the given
 * fields. If any of the field values are undefined or null, then they will
 * be excluded.
 */
IMGAPI.prototype._qs = function _qs(fields, fields2) {
    assert.object(fields, 'fields');
    assert.optionalObject(fields2, 'fields2'); // can be handy to pass in 2 objs

    var query = {};
    Object.keys(fields).forEach(function (key) {
        var value = fields[key];
        if (value !== undefined && value !== null) {
            query[key] = value;
        }
    });
    if (fields2) {
        Object.keys(fields2).forEach(function (key) {
            var value = fields2[key];
            if (value !== undefined && value !== null) {
                query[key] = value;
            }
        });
    }

    if (Object.keys(query).length === 0) {
        return '';
    } else {
        return '?' + qs.stringify(query);
    }
};


/**
 * Return an appropriate full URL *path* given an IMGAPI subpath.
 * This handles prepending the API's base path, if any: e.g. if the configured
 * URL is "https://example.com/base/path".
 *
 * Optionally an object of query params can be passed in to include a query
 * string. This just calls `this._qs(...)`.
 */
IMGAPI.prototype._path = function _path(subpath, qparams, qparams2) {
    assert.string(subpath, 'subpath');
    assert.ok(subpath[0] === '/');
    assert.optionalObject(qparams, 'qparams');
    assert.optionalObject(qparams2, 'qparams2'); // can be handy to pass in 2

    var path = this._basePath + subpath;
    if (qparams) {
        path += this._qs(qparams, qparams2);
    }
    return path;
};



/**
 * Ping. <https://mo.joyent.com/docs/imgapi/master/#Ping>
 *
 * @param error {String} Optional error code. If given, the ping is expected
 *      to respond with a sample error with that code (if supported).
 * @param callback {Function} `function (err, pong, res)`
 */
IMGAPI.prototype.ping = function ping(error, callback) {
    var self = this;
    if (typeof (error) === 'function') {
        callback = error;
        error = undefined;
    }
    assert.optionalString(error, 'error');
    assert.func(callback, 'callback');

    var path = self._path('/ping', {error: error});
    self._getAuthHeaders(function (hErr, headers) {
        if (hErr) {
            callback(hErr);
            return;
        }
        var reqOpts = {
            path: path,
            headers: headers,
            connectTimeout: 15000 // long default for spotty internet
        };
        self.client.get(reqOpts, function (err, req, res, pong) {
            if (err) {
                callback(err, null, res);
            } else {
                callback(null, pong, res);
            }
        });
    });
};


/**
 * Get IMGAPI internal state (for dev/debugging).
 *
 * @param {Function} callback : `function (err, state, res)`
 */
IMGAPI.prototype.adminGetState = function adminGetState(callback) {
    var self = this;
    assert.func(callback, 'callback');

    var path = self._path('/state');
    self._getAuthHeaders(function (hErr, headers) {
        if (hErr) {
            callback(hErr);
            return;
        }
        var reqOpts = {
            path: path,
            headers: headers
        };
        self.client.get(reqOpts, function (err, req, res, state) {
            if (err) {
                callback(err, null, res);
            } else {
                callback(null, state, res);
            }
        });
    });
};


/**
 * Tell IMGAPI to reload its authkeys (if relevant).
 *
 * @param {Function} callback : `function (err, res)`
 */
IMGAPI.prototype.adminReloadAuthKeys = function adminReloadAuthKeys(callback) {
    var self = this;
    assert.func(callback, 'callback');

    var path = self._path('/authkeys/reload');
    self._getAuthHeaders(function (hErr, headers) {
        if (hErr) {
            callback(hErr);
            return;
        }
        var reqOpts = {
            path: path,
            headers: headers
        };
        self.client.post(reqOpts, function (err, req, res) {
            callback(err, res);
        });
    });
};



/**
 * Lists Images
 * <https://mo.joyent.com/docs/imgapi/master/#ListImages>
 *
 * @param filters {Object} Optional filter params, e.g. `{os: 'smartos'}`.
 *      See the doc link above for a full list of supported filters.
 * @param options {Object} Optional request options.
 *      - headers {Object} Optional extra request headers.
 *      - inclAdminFields {Boolean} Whether to include admin fields in the
 *        returned images.
 *      - channel {String} Optional override for the channel set on the
 *        constructor. This is only relevant for IMGAPI servers that
 *        support channels.
 * @param callback {Function} `function (err, images, res)`
 *
 * NOTE about filters.limit and filters.marker:
 *
 * When no limit is passed we want to allow listImages to automatically
 * loop through all available images because there is default 'hard'
 * limit of 1k images being imposed because of the moray backend. When
 * a limit is passed we are already overriding that so we don't need to
 * do multiple queries to form our response
 */
IMGAPI.prototype.listImages = function listImages(filters, options, callback) {
    var self = this;
    if (typeof (filters) === 'function') {
        callback = filters;
        options = {};
        filters = {};
    } else if (typeof (options) === 'function') {
        callback = options;
        options = {};
    }
    assert.object(filters, 'filters');
    assert.object(options, 'options');
    assert.optionalObject(options.headers, 'options.headers');
    assert.optionalBool(options.inclAdminFields, 'options.inclAdminFields');
    assert.optionalString(options.channel, 'options.channel');
    assert.func(callback, 'callback');
    var inclAdminFields = (options.inclAdminFields !== undefined
            ? options.inclAdminFields.toString()
            : undefined);

    self._getAuthHeaders(function (hErr, headers) {
        if (hErr) {
            callback(hErr);
            return;
        }
        if (options.headers) {
            simpleMerge(headers, options.headers);
        }

        if (filters.limit) {
            listImagesWithLimit(headers, callback);
        } else {
            listAllImages(headers, callback);
        }
    });

    function listImagesWithLimit(headers, cb) {
        // limit and marker come straight from filters
        var path = self._path('/images', {
            channel: options.channel || self.channel,
            inclAdminFields: inclAdminFields
        }, filters);
        var reqOpts = {
            path: path,
            headers: headers
        };

        self.client.get(reqOpts, function (err, req, res, images) {
            if (err) {
                cb(err, null, res);
            } else {
                cb(null, images, res);
            }
        });
    }

    function listAllImages(headers, cb) {
        var limit = undefined;
        var marker = filters.marker;
        var images = [];
        var lastRes;
        var stop = false;

        // Since we can have more than 1000 images in a IMGAPI repository we
        // need to loop through /images until we are able to fetch all of them
        async.whilst(
            function testAllImagesFetched() {
                return !stop;
            },
            listImagesFromSource,
            function doneFetching(fetchErr) {
                return cb(fetchErr, images, lastRes);
            });

        function listImagesFromSource(whilstNext) {
            // These options are passed once they are set for the first time
            // or they are passed by the client calling listImages()
            if (marker) {
                filters.marker = marker;
            }
            if (limit) {
                filters.limit = limit;
            }

            var path = self._path('/images', {
                channel: options.channel || self.channel,
                inclAdminFields: inclAdminFields
            }, filters);
            var reqOpts = {
                path: path,
                headers: headers
            };

            self.client.get(reqOpts, function (listErr, req, res, sImages) {
                // This may involve several request-responses so we keep a
                // reference to the last reponse received
                lastRes = res;
                if (listErr) {
                    stop = true;
                    return whilstNext(listErr);
                }

                // On every query we do this:
                // - check if result size is less than limit (stop)
                // - if we have to keep going set a new marker,
                //   otherwise shift() because the first element is
                //   our marker
                // - concat to full list of images
                if (!limit) {
                    limit = 1000;
                }
                if (sImages.length < limit) {
                    stop = true;
                }
                // No marker means this is the first query and we
                // shouldn't shift() the array
                if (marker && sImages.length && sImages[0].uuid === marker) {
                    sImages.shift();
                }
                // We hit this when we either reached an empty page of
                // results or an empty first result
                if (!sImages.length) {
                    stop = true;
                    return whilstNext();
                }
                // Safety check if remote server doesn't support limit
                // and marker yet. In this case we would be iterating
                // over the same list of /images
                var newMarker = sImages[sImages.length - 1].uuid;
                if (marker && marker === newMarker) {
                    stop = true;
                    return whilstNext();
                }
                marker = newMarker;
                images = images.concat(sImages);

                return whilstNext();
            });
        }
    }
};



/**
 * Gets an image by UUID.
 *
 * @param {String} uuid : the UUID of the image.
 * @param {UUID} account : Optional. The UUID of the account who is querying.
 *      If given this will only return images accessible to that account.
 * @param options {Object} Optional request options.
 *      - headers {Object} Optional extra request headers.
 *      - inclAdminFields {Boolean} Whether to include admin fields in the
 *        returned image.
 *      - channel {String} Optional override for the channel set on the
 *        constructor. This is only relevant for IMGAPI servers that
 *        support channels.
 * @param {Function} callback : `function (err, image, res)`
 */
IMGAPI.prototype.getImage =
function getImage(uuid, account, options, callback) {
    var self = this;
    assert.string(uuid, 'uuid');
    if (typeof (account) === 'function') {
        callback = account;
        options = {};
        account = undefined;
    } else if (typeof (account) === 'object') {
        callback = options;
        options = account;
        account = undefined;
    } else if (typeof (options) === 'function') {
        callback = options;
        options = {};
    }
    assert.optionalString(account, 'account');
    assert.object(options, 'options');
    assert.optionalObject(options.headers, 'options.headers');
    assert.optionalBool(options.inclAdminFields, 'options.inclAdminFields');
    assert.optionalString(options.channel, 'options.channel');
    assert.func(callback, 'callback');
    var inclAdminFields = (options.inclAdminFields !== undefined
            ? options.inclAdminFields.toString()
            : undefined);

    var path = self._path('/images/' + uuid, {
        account: account,
        channel: options.channel || self.channel,
        inclAdminFields: inclAdminFields
    });
    self._getAuthHeaders(function (hErr, headers) {
        if (hErr) {
            callback(hErr);
            return;
        }
        if (options.headers) {
            simpleMerge(headers, options.headers);
        }
        var reqOpts = {
            path: path,
            headers: headers
        };
        self.client.get(reqOpts, function (err, req, res, image) {
            if (err) {
                callback(err, null, res);
            } else {
                callback(null, image, res);
            }
        });
    });
};


/**
 * Create an image.
 *
 * @param {String} data : the image data.
 * @param {UUID} account : Optional. The UUID of the account on behalf of whom
 *      this request is being made. If given this will only return images
 *      accessible to that account.
 * @param options {Object} Optional request options.
 *      - headers {Object} Optional extra request headers.
 *      - channel {String} Optional override for the channel set on the
 *        constructor. This is only relevant for IMGAPI servers that
 *        support channels.
 * @param {Function} callback : `function (err, image, res)`
 */
IMGAPI.prototype.createImage =
function createImage(data, account, options, callback) {
    var self = this;
    assert.object(data, 'data');
    if (typeof (account) === 'function') {
        callback = account;
        options = {};
        account = undefined;
    } else if (typeof (account) === 'object') {
        callback = options;
        options = account;
        account = undefined;
    } else if (typeof (options) === 'function') {
        callback = options;
        options = {};
    }
    assert.optionalString(account, 'account');
    assert.object(options, 'options');
    assert.optionalObject(options.headers, 'options.headers');
    assert.optionalString(options.channel, 'options.channel');
    assert.func(callback, 'callback');

    var path = self._path('/images', {
        account: account,
        channel: options.channel || self.channel
    });
    self._getAuthHeaders(function (hErr, headers) {
        if (hErr) {
            callback(hErr);
            return;
        }
        if (options.headers) {
            simpleMerge(headers, options.headers);
        }
        var reqOpts = {
            path: path,
            headers: headers
        };
        self.client.post(reqOpts, data, function (err, req, res, image) {
            if (err) {
                callback(err, null, res);
            } else {
                callback(null, image, res);
            }
        });
    });
};


/**
 * Creates a new Image from an existing customer VM. The VM in question cannot
 * be running for this action to be successful. This is the async version of
 * this action, meaning that it will return a job object and it is up to the
 * client to poll the job until it completes.
 *
 * @param {String} data : the image data.
 * @param {Object} options: Required.
 *      - vm_uuid {Boolean} Required. VM from which the Image is going to be
 *        created.
 *      - incremental {Boolean} Optional. Default false. Create an incremental
 *        image.
 *      - headers {Object} Optional Additional request headers.
 *      - channel {String} Optional override for the channel set on the
 *        constructor. This is only relevant for IMGAPI servers that
 *        support channels.
 * @param {UUID} account : Optional. The UUID of the account on behalf of whom
 *      this request is being made. If given this will only return images
 *      accessible to that account.
 * @param {Function} callback : `function (err, job, res)`
 */
IMGAPI.prototype.createImageFromVm =
function createImageFromVm(data, options, account, callback) {
    var self = this;
    if (callback === undefined) {
        callback = account;
        account = undefined;
    }
    assert.object(data, 'data');
    assert.object(options, 'options');
    assert.string(options.vm_uuid, 'options.vm_uuid');
    assert.optionalBool(options.incremental, 'options.incremental');
    assert.optionalObject(options.headers, 'options.headers');
    assert.optionalString(options.channel, 'options.channel');
    assert.optionalString(account, 'account');
    assert.func(callback, 'callback');

    var path = self._path('/images');
    path += self._qs({
        channel: options.channel || self.channel,
        action: 'create-from-vm',
        vm_uuid: options.vm_uuid,
        incremental: options.incremental,
        account: account
    });
    self._getAuthHeaders(function (hErr, headers) {
        if (hErr) {
            callback(hErr);
            return;
        }
        if (options.headers) {
            simpleMerge(headers, options.headers);
        }
        var reqOpts = {
            path: path,
            headers: headers
        };
        self.client.post(reqOpts, data, function (err, req, res, job) {
            if (err) {
                callback(err, null, res);
            } else {
                callback(null, job, res);
            }
        });
    });
};


/**
 * Creates a new Image from an existing customer VM. The VM in question cannot
 * be running for this action to be successful. This is the sync version of this
 * action, meaning that it will block until the Image creation operation has
 * completed.
 *
 * @param {String} data : the image data.
 * @param {Object} options: Required.
 *      - vm_uuid {Boolean} Required. VM from which the Image is going to be
 *        created.
 *      - incremental {Boolean} Optional. Default false. Create an incremental
 *        image.
 *      - headers {Object} Optional Additional request headers.
 * @param {UUID} account : Optional. The UUID of the account on behalf of whom
 *      this request is being made. If given this will only return images
 *      accessible to that account.
 * @param {Function} callback : `function (err, image, res)`
 */
IMGAPI.prototype.createImageFromVmAndWait =
function createImageFromVmAndWait(data, options, account, callback) {
    var self = this;
    var fn;
    if (callback === undefined) {
        callback = account;
        account = undefined;
        fn = self.createImageFromVm.bind(self, data, options);
    } else {
        fn = self.createImageFromVm.bind(self, data, options, account);
    }

    fn.call(self, function (err, job, res) {
        if (err) {
            callback(err, null, res);
        } else {
            var wfapiUrl = res.headers['workflow-api'];

            assert.string(wfapiUrl, 'wfapiUrl');
            assert.string(job['job_uuid'], 'job_uuid');
            assert.string(job['image_uuid'], 'image_uuid');

            waitForJob(wfapiUrl, job['job_uuid'], function (jErr) {
                if (jErr) {
                    callback(jErr);
                    return;
                }
                self.getImage(job['image_uuid'], callback);
            });
        }
    });
};


/**
 * Import an image (operator/admin use only).
 *
 * This differs from `createImage` in that you can import an image and
 * persist its `uuid` (and `published_at`). This is for operator use only.
 * Typically it is for importing existing images from images.smartos.org. When
 * a `source` URL of a remote IMGAPI repository is passed then the IMGAPI will
 * retrieve the manifest directly, allowing clients to not need to have a
 * manifest file at hand. When doing this the first parameter for the function
 * should only be an object with a single key which is the `uuid` of the image
 *
 * @param {String} data : the image data.
 * @param {Object} options: For backward compat, this argument is optional.
 *      - skipOwnerCheck {Boolean} Optional. Default false.
 *      - source {String} Optional. The source IMGAPI repository. If a source
 *          URL is passed then the only key needed for the data of the image is
 *          its uuid, any additional properties are going to be ignored.
 *          Append '?channel=<channel>' to select a particular source
 *          channel, if relevant.
 *      - headers {Object} Optional Additional request headers.
 *      - channel {String} Optional override for the channel set on the
 *        constructor. This is only relevant for IMGAPI servers that
 *        support channels.
 * @param {Function} callback : `function (err, image, res)`
 */
IMGAPI.prototype.adminImportImage = function adminImportImage(
        data, options, callback) {
    var self = this;
    if (callback === undefined) {
        callback = options;
        options = {};
    }
    assert.object(data, 'data');
    assert.object(options, 'options');
    assert.optionalBool(options.skipOwnerCheck, 'options.skipOwnerCheck');
    assert.optionalString(options.source, 'options.source');
    assert.optionalObject(options.headers, 'options.headers');
    assert.optionalString(options.channel, 'options.channel');
    assert.func(callback, 'callback');
    assert.string(data.uuid, 'data.uuid');

    var path = self._path('/images/' + data.uuid);
    path += self._qs({
        channel: options.channel || self.channel,
        action: 'import',
        skip_owner_check: options.skipOwnerCheck,
        source: options.source
    });
    self._getAuthHeaders(function (hErr, headers) {
        if (hErr) {
            callback(hErr);
            return;
        }
        if (options.headers) {
            simpleMerge(headers, options.headers);
        }
        var reqOpts = {
            path: path,
            headers: headers
        };

        // When passing a source a body is not POSTed
        if (options.source) {
            self.client.post(reqOpts, onPost);
        } else {
            self.client.post(reqOpts, data, onPost);
        }
        function onPost(err, req, res, image) {
            if (err) {
                callback(err, null, res);
            } else {
                callback(null, image, res);
            }
        }
    });
};


/**
 * Import a remote image (operator/admin use only).
 *
 * This differs from `AdminImportImage` in that IMGAPI will download the image
 * manifest, add files and activate the image in a single step. A `source`
 * parameter needs to be passed so IMGAPI can find the remote image manifest to
 * be imported. This is for operator use only.
 * Typically it is for importing existing images from images.smartos.org.
 * This API call is blocking, meaning that the callback provided won't be called
 * until the image has been imported completely into the local IMGAPI.
 *
 * @param {String} uuid : the UUID of the image.
 * @param {String} source : the source IMGAPI repository.
 * @param {Object} options: For backward compat, this argument is optional.
 *      - skipOwnerCheck {Boolean} Optional. Default false.
 *      - headers {Object} Optional Additional request headers.
 *      - channel {String} Optional override for the channel set on the
 *        constructor. This is only relevant for IMGAPI servers that
 *        support channels.
 * @param {Function} callback : `function (err, image, res)`
 */
IMGAPI.prototype.adminImportRemoteImageAndWait =
function adminImportRemoteImageAndWait(uuid, source, options, callback) {
    var self = this;
    if (callback === undefined) {
        callback = options;
        options = {};
    }
    assert.string(uuid, 'uuid');
    assert.string(source, 'source');
    assert.object(options, 'options');
    assert.optionalBool(options.skipOwnerCheck, 'options.skipOwnerCheck');
    assert.optionalObject(options.headers, 'options.headers');
    assert.optionalString(options.channel, 'options.channel');
    assert.optionalNumber(options.retries, 'options.retries');
    assert.func(callback, 'callback');

    var path = self._path('/images/' + uuid, {
        channel: options.channel || self.channel,
        action: 'import-remote',
        source: source,
        skip_owner_check: options.skipOwnerCheck
    });

    var maxRetries = options.retries || 1;
    self._getAuthHeaders(function (hErr, headers) {
        if (hErr) {
            callback(hErr);
            return;
        }
        if (options.headers) {
            simpleMerge(headers, options.headers);
        }
        var reqOpts = {
            path: path,
            headers: headers
        };

        // Keep latest HTTP response handy:
        var theResponse;

        var retry = backoff.exponential({
            maxDelay: Infinity
        });

        retry.failAfter(maxRetries);

        retry.on('backoff', function (number, delay, err) {
            self.client.log.trace({
                attempt: number,
                delay: delay,
                err: err
            }, 'retry backoff');
        });

        retry.on('ready', function (number, delay) {
            self.client.log.trace({
                attempt: number,
                delay: delay
            }, 'retry ready');

            self.client.post(reqOpts, function (err, req, res, obj) {
                if (err) {
                    theResponse = res;
                    return retry.backoff(err);
                } else {
                    var wfapiUrl = res.headers['workflow-api'];
                    try {
                        assert.string(wfapiUrl, 'wfapiUrl');
                        assert.string(obj.job_uuid, 'job_uuid');
                        assert.string(obj.image_uuid, 'image_uuid');
                    } catch (e) {
                        return retry.backoff(e);
                    }

                    return waitForJob(wfapiUrl, obj.job_uuid, function (jErr) {
                        if (jErr) {
                            retry.backoff(jErr);
                        } else {
                            retry.reset();
                            self.getImage(obj.image_uuid, callback);
                        }
                    });
                }
            });

        });

        retry.on('fail', function (err) {
            self.client.log.trace({err: err}, 'retry fail');
            callback(err, null, theResponse);
        });

        retry.emit('ready');

    });
};


/**
 * Import a docker image layer (operator/admin use only).
 *
 * @param {Object} options.
 *      - repo {String} Required. The docker repo, e.g. 'busybox',
 *        'quay.io/foo/bar', 'trentm/busybox', 'myreg.example.com:5000/blah'.
 *      - tag {String} Required*. The image repository tag. One of 'tag' or
 *        'digest' is required.
 *      - digest {String} Required*. An image content-digest. One of 'tag' or
 *        'digest' is required.
 *      - regAuth {String} Optional. Registry auth info formatted as in
 *        the 'x-registry-auth' header in `docker` client requests.
 *      - regConfig {String} Optional. Registry config info formatted as is
 *        the 'x-registry-config' header in `docker` client requests.
 *      - public {Boolean} Optional. Value for IMGAPI `manifest.public`.
 *        Default true.
 *      - headers {Object} Optional Additional request headers.
 *      - channel {String} Optional override for the channel set on the
 *        constructor. This is only relevant for IMGAPI servers that
 *        support channels.
 * @param {Function} callback : `function (err, res)`
 */
IMGAPI.prototype.adminImportDockerImage = function adminImportDockerImage(
        options, callback) {
    var self = this;
    if (callback === undefined) {
        callback = options;
        options = {};
    }
    assert.object(options, 'options');
    assert.string(options.repo, 'options.repo');
    assert.optionalString(options.tag, 'options.tag');
    assert.optionalString(options.digest, 'options.digest');
    if (!options.tag && !options.digest) {
        throw new assert.AssertionError({ message:
            'one of "options.tag" or "options.digest" is required' });
    }
    assert.optionalString(options.regAuth, 'options.regAuth');
    assert.optionalString(options.regConfig, 'options.regConfig');
    assert.optionalBool(options.public, 'options.public');
    assert.optionalObject(options.headers, 'options.headers');
    assert.optionalString(options.channel, 'options.channel');
    assert.func(callback, 'callback');

    var path = self._path('/images');
    path += self._qs({
        channel: options.channel || self.channel,
        action: 'import-docker-image',
        tag: options.tag,
        digest: options.digest,
        repo: options.repo,
        public: options.public
    });

    self._getAuthHeaders(function (hErr, headers) {
        if (hErr) {
            callback(hErr);
            return;
        }
        if (options.regAuth) {
            headers['x-registry-auth'] = options.regAuth;
        }
        if (options.regConfig) {
            headers['x-registry-config'] = options.regConfig;
        }
        if (options.headers) {
            simpleMerge(headers, options.headers);
        }
        var reqOpts = {
            path: path,
            headers: headers
        };

        self.rawClient.post(reqOpts, function (connectErr, req) {
            if (connectErr) {
                callback(connectErr);
                return;
            }

            req.on('result', function (resultErr, res) {
                if (resultErr) {
                    extendErrFromRawBody(resultErr, res, function () {
                        callback(resultErr, null, res);
                    });
                    return;
                }

                res.setEncoding('utf8');
                callback(null, res);
            });

            req.end();
        });
    });
};


/**
 * Push a docker image (which can have multiple layers) to a remote registry.
 * (operator/admin use only)
 *
 * @param {Object} options.
 *      - image {Object} Required: the sdc-docker ImageV2 model instance.
 *      - repoAndTag {String} Required. The docker repo, e.g. 'busybox',
 *        'trentm/busybox:latest', 'myreg.example.com:5000/blah:master'.
 *      - regAuth {String} Optional. Registry auth info formatted as in
 *        the 'x-registry-auth' header in `docker` client requests.
 *      - headers {Object} Optional Additional request headers.
 *      - channel {String} Optional override for the channel set on the
 *        constructor. This is only relevant for IMGAPI servers that
 *        support channels.
 * @param {Function} callback : `function (err, res)`
 */
IMGAPI.prototype.adminPushDockerImage =
function adminPushDockerImage(options, callback) {
    var self = this;
    if (callback === undefined) {
        callback = options;
        options = {};
    }
    assert.object(options, 'options');
    assert.optionalObject(options.headers, 'options.headers');
    assert.object(options.image, 'options.image');
    assert.optionalString(options.regAuth, 'options.regAuth');
    assert.string(options.repoAndTag, 'options.repoAndTag');
    assert.optionalString(options.channel, 'options.channel');
    assert.func(callback, 'callback');

    var path = self._path(format('/images/%s/push', options.image.image_uuid), {
        channel: options.channel || self.channel,
        image: options.image,
        repoAndTag: options.repoAndTag,
        public: options.public
    });

    self._getAuthHeaders(function (hErr, headers) {
        if (hErr) {
            callback(hErr);
            return;
        }
        headers['Content-Type'] = 'application/json';
        if (options.regAuth) {
            headers['x-registry-auth'] = options.regAuth;
        }
        if (options.headers) {
            simpleMerge(headers, options.headers);
        }
        var reqOpts = {
            path: path,
            headers: headers
        };

        self.rawClient.post(reqOpts, function (connectErr, req) {
            if (connectErr) {
                callback(connectErr);
                return;
            }

            req.on('result', function (resultErr, res) {
                if (resultErr) {
                    extendErrFromRawBody(resultErr, res, function () {
                        callback(resultErr, null, res);
                    });
                    return;
                }

                res.setEncoding('utf8');
                callback(null, res);
            });

            req.write(JSON.stringify(options.image));
            req.end();
        });
    });
};


/*
 * Wait for a job to complete.  Returns an error if the job fails with an error
 * other than the (optional) list of expected errors. Taken from SAPI
 */
function waitForJob(url, job_uuid, cb) {
    assert.string(url, 'url');
    assert.string(job_uuid, 'job_uuid');
    assert.func(cb, 'cb');

    var client = restifyClients.createJsonClient({url: url, agent: false});
    pollJob(client, job_uuid, function (err, job) {
        if (err)
            return cb(err);
        var result = job.chain_results.pop();
        if (result.error) {
            var errmsg = result.error.message || JSON.stringify(result.error);
            return cb(new Error(errmsg));
        } else {
            return cb();
        }
    });
}



/*
 * Poll a job until it reaches either the succeeded or failed state.
 * Taken from SAPI.
 *
 * Note: if a job fails, it's the caller's responsibility to check for a failed
 * job.  The error object will be null even if the job fails.
 */
function pollJob(client, job_uuid, cb) {
    var attempts = 0;
    var errors = 0;

    var timeout = 5000;  // 5 seconds
    var limit = 720;     // 1 hour

    var poll = function () {
        client.get('/jobs/' + job_uuid, function (err, req, res, job) {
            attempts++;

            if (err) {
                errors++;
                if (errors >= 5) {
                    return cb(err);
                } else {
                    return setTimeout(poll, timeout);
                }
            }

            if (job && job.execution === 'succeeded') {
                return cb(null, job);
            } else if (job && job.execution === 'failed') {
                return cb(null, job);
            } else if (attempts > limit) {
                return cb(new Error('polling for import job timed out'), job);
            }

            return setTimeout(poll, timeout);
        });
    };

    poll();
}


/**
 * Import a remote image (operator/admin use only).
 *
 * This differs from `AdminImportImage` in that IMGAPI will download the image
 * manifest, add files and activate the image in a single step. A `source`
 * parameter needs to be passed so IMGAPI can find the remote image manifest to
 * be imported. This is for operator use only.
 * Typically it is for importing existing images from images.smartos.org.
 * This is the async version of adminImportRemoteImageAndWait. The callback
 * returns an object that contains the job_uuid where clients can get details
 * about the progress of the import job.
 *
 * @param {String} uuid : the UUID of the image.
 * @param {String} source : the source IMGAPI repository.
 * @param {Object} options: For backward compat, this argument is optional.
 *      - skipOwnerCheck {Boolean} Optional. Default false.
 *      - headers {Object} Optional Additional request headers.
 *      - channel {String} Optional override for the channel set on the
 *        constructor. This is only relevant for IMGAPI servers that
 *        support channels.
 * @param {Function} callback : `function (err, job, res)`
 */
IMGAPI.prototype.adminImportRemoteImage =
function adminImportRemoteImage(uuid, source, options, callback) {
    var self = this;
    if (callback === undefined) {
        callback = options;
        options = {};
    }
    assert.string(uuid, 'uuid');
    assert.string(source, 'source');
    assert.object(options, 'options');
    assert.optionalBool(options.skipOwnerCheck, 'options.skipOwnerCheck');
    assert.optionalObject(options.headers, 'options.headers');
    assert.optionalString(options.channel, 'options.channel');
    assert.func(callback, 'callback');

    var path = self._path('/images/' + uuid, {
        channel: options.channel || self.channel,
        action: 'import-remote',
        source: source,
        skip_owner_check: options.skipOwnerCheck
    });
    self._getAuthHeaders(function (hErr, headers) {
        if (hErr) {
            callback(hErr);
            return;
        }
        if (options.headers) {
            simpleMerge(headers, options.headers);
        }
        var reqOpts = {
            path: path,
            headers: headers
        };
        self.client.post(reqOpts, function (err, req, res, image) {
            if (err) {
                callback(err, null, res);
            } else {
                callback(null, image, res);
            }
        });
    });
};


/**
 * Add an image file.
 *
 * @param {Object} options
 *      - {String} uuid : the UUID of the image.
 *      - {String} source. Optional. the source IMGAPI repository. If a source
 *        URL is passed then the rest of values passed within this object (
 *        other than `uuid`) are going to be ignored as they are only needed
 *        when a local file is loaded into IMGAPI.
 *      - {String|Object} file : Readable stream or path to the image file.
 *        If a stream is passed in it must be paused. Also, if this is
 *        node < v0.10 then it must be paused with `imgapi.pauseStream` or
 *        similar due to a node stream API bug.
 *      - {Number} size : Optional. The number of bytes. If `file` is a path
 *        to an image file, then size will be retrieved with `fs.stat`.
 *      - {String} compression : One of 'bzip2', 'gzip', or 'none'.
 *      - {String} sha1 : SHA-1 hash of the file being uploaded.
 *      - {String} storage : The type of storage preferred for this image file.
 *        Can be "local" or "manta". Will try to default to "manta" when
 *        available, otherwise "local".
 *      - headers {Object} Optional Additional request headers.
 *      - channel {String} Optional override for the channel set on the
 *        constructor. This is only relevant for IMGAPI servers that
 *        support channels.
 * @param {UUID} account : Optional. The UUID of the account on behalf of whom
 *      this request is being made. If given this will only return images
 *      accessible to that account.
 * @param {Function} callback : `function (err, image, res)`
 */
IMGAPI.prototype.addImageFile = function addImageFile(options, account,
                                                      callback) {
    var self = this;
    assert.object(options, 'options');
    assert.string(options.uuid, 'options.uuid');
    assert.optionalObject(options.headers, 'options.headers');
    assert.optionalString(options.channel, 'options.channel');
    if (callback === undefined) {
        callback = account;
        account = undefined;
    }
    assert.func(callback, 'callback');
    var uuid = options.uuid;

    // Separate code path for undocumented AddImageFileFromSource endpoint.
    if (options.source) {
        assert.string(options.source, 'options.source');
        var path = self._path(format('/images/%s/file', uuid), {
            channel: options.channel || self.channel,
            source: options.source,
            storage: options.storage
        });
        self._getAuthHeaders(function (hErr, headers) {
            if (hErr) {
                callback(hErr);
                return;
            }
            if (options.headers) {
                simpleMerge(headers, options.headers);
            }
            var reqOpts = {
                path: path,
                headers: headers
            };
            self.client.put(reqOpts, function (err, req, res, image) {
                if (err) {
                    callback(err, null, res);
                } else {
                    callback(null, image, res);
                }
            });
        });
        return;
    }

    // Normal file/stream AddImageFile
    assert.string(options.compression, 'options.compression');
    assert.ok(['string', 'object'].indexOf(typeof (options.file)) !== -1,
        'options.file');
    assert.optionalString(options.sha1, 'options.sha1');
    assert.optionalNumber(options.size, 'options.size');
    assert.optionalString(account, 'account');
    var file = options.file;

    function getFileStreamAndSize(next) {
        var stream;
        if (typeof (file) === 'object') {
            return next(null, file, options.size);
        } else if (options.size) {
            stream = fs.createReadStream(file);
            pauseStream(stream);
            return next(null, stream, options.size);
        } else {
            return fs.stat(file, function (statErr, stats) {
                if (statErr) {
                    return next(statErr);
                }
                stream = fs.createReadStream(file);
                pauseStream(stream);
                return next(null, stream, stats.size);
            });
        }
    }

    getFileStreamAndSize(function (err, stream, size) {
        if (err) {
            callback(err);
            return;
        }

        var reqPath = self._path(format('/images/%s/file', uuid), {
            channel: options.channel || self.channel,
            compression: options.compression,
            account: account,
            sha1: options.sha1,
            dataset_guid: options.dataset_guid,
            storage: options.storage
        });

        self._getAuthHeaders(function (hErr, headers) {
            if (hErr) {
                callback(hErr);
                return;
            }
            headers['Content-Type'] = 'application/octet-stream';
            if (size) {
                headers['Content-Length'] = size;
            }
            headers['Accept'] = 'application/json';
            if (options.headers) {
                simpleMerge(headers, options.headers);
            }
            var reqOpts = {
                path: reqPath,
                headers: headers
            };
            self.rawClient.put(reqOpts, function (connectErr, req) {
                if (connectErr) {
                    callback(connectErr);
                    return;
                }

                stream.pipe(req);
                stream.resume();

                req.on('result', function (resultErr, res) {
                    if (resultErr) {
                        extendErrFromRawBody(resultErr, res, function () {
                            callback(resultErr, null, res);
                        });
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
                                'invalid image data in response: \'%s\'',
                                body));
                            return;
                        }
                        callback(null, data, res);
                    });
                });
            });
        });
    });
};


/**
 * Add an image file from a URL.
 *
 * @param {Object} options
 *      - {String} uuid : the UUID of the image.
 *      - {String} file_url : A url to the file to be downloaded. Only https
 *        urls are supported, and the server must not use a self-signed cert.
 *      - {String} compression : Optional. One of 'bzip2', 'gzip', 'xz' or
 *                 'none'.
 *      - {String} sha1 : SHA-1 hash of the file being uploaded.
 *      - {String} storage : The type of storage preferred for this image file.
 *        Can be "local" or "manta". Will try to default to "manta" when
 *        available, otherwise "local".
 *      - headers {Object} Optional Additional request headers.
 * @param {UUID} account : Optional. The UUID of the account on behalf of whom
 *      this request is being made. If given this will only return images
 *      accessible to that account.
 * @param {Function} callback : `function (err, image, res)`
 */
IMGAPI.prototype.addImageFileFromUrl = function addImageFileFromUrl(
    options, account, callback) {

    var self = this;
    assert.object(options, 'options');
    assert.uuid(options.uuid, 'options.uuid');
    assert.string(options.file_url, 'options.file_url');
    assert.optionalString(options.compression, 'options.compression');

    assert.optionalObject(options.headers, 'options.headers');
    if (callback === undefined) {
        callback = account;
        account = undefined;
    }
    assert.func(callback, 'callback');
    var uuid = options.uuid;
    var file_url = options.file_url;

    // Sigh. sdc-imgapi-cli runs with an old version of node which has no
    // String.endsWith(..) method, so implement our own instead.
    function endsWith(testStr, endsStr) {
        var index = testStr.lastIndexOf(endsStr);
        if (index < 0) {
            return false;
        }
        if (endsStr.length + index == testStr.length) {
            return true;
        }
        return false;
    }

    // supported compression values from sdc-imgapi.git/lib/constants.js
    if (options.compression === undefined) {
        var url_path = mod_url.parse(file_url).pathname;
        if (endsWith(url_path, '.gz') || endsWith(url_path, '.tgz')) {
            options.compression = 'gzip';
        } else if (endsWith(url_path, '.bz2')) {
            options.compression = 'bzip2';
        } else if (endsWith(url_path, '.xz')) {
            options.compression = 'xz';
        } else {
            self.client.log.warn(
                'Expected the URL path to end with one of .gz, .tgz, .bz2 ' +
                'or .xz. Using "none" compression instead.');
            options.compression = 'none';
        }
    }

    var path = self._path(format('/images/%s/file/from-url', uuid), {
        channel: self.channel,
        storage: options.storage,
        compression: options.compression,
        account: account,
        sha1: options.sha1,
        dataset_guid: options.dataset_guid
    });

    var data = {file_url: file_url};

    self._getAuthHeaders(function (hErr, headers) {
        if (hErr) {
            callback(hErr);
            return;
        }
        if (options.headers) {
            simpleMerge(headers, options.headers);
        }
        var reqOpts = {
            path: path,
            headers: headers
        };
        self.client.post(reqOpts, data, function (err, req, res, image) {
            if (err) {
                callback(err, null, res);
            } else {
                callback(null, image, res);
            }
        });
        return;
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
 * @param options {Object} Optional request options.
 *      - headers {Object} Optional extra request headers.
 *      - channel {String} Optional override for the channel set on the
 *        constructor. This is only relevant for IMGAPI servers that
 *        support channels.
 *      - index {Number} Optional files array index. Default is 0.
 * @param {Function} callback : `function (err, res)`
 */
IMGAPI.prototype.getImageFile =
function getImageFile(uuid, filePath, account, options, callback) {
    var self = this;
    assert.string(uuid, 'uuid');
    assert.string(filePath, 'filePath');
    if (typeof (account) === 'function') {
        callback = account;
        options = {};
        account = undefined;
    } else if (typeof (options) === 'function') {
        callback = options;
        options = {};
    }
    assert.optionalString(account, 'account');
    assert.object(options, 'options');
    assert.optionalObject(options.headers, 'options.headers');
    assert.optionalString(options.channel, 'options.channel');
    assert.optionalNumber(options.index, 'options.index');
    assert.func(callback, 'callback');

    var path = self._path(format('/images/%s/file', uuid), {
        channel: options.channel || self.channel,
        index: options.index,
        account: account
    });
    self._getAuthHeaders(function (hErr, headers) {
        if (hErr) {
            callback(hErr);
            return;
        }
        if (options.headers) {
            simpleMerge(headers, options.headers);
        }
        var reqOpts = {
            path: path,
            headers: headers
        };
        self.rawClient.get(reqOpts, function (connectErr, req) {
            if (connectErr) {
                callback(connectErr);
                return;
            }
            req.on('result', function (resultErr, res) {
                if (resultErr) {
                    extendErrFromRawBody(resultErr, res, function () {
                        callback(resultErr, res);
                    });
                    return;
                }

                var hash = null;
                var out = res.pipe(fs.createWriteStream(filePath));
                hash = crypto.createHash('md5');
                res.on('data', function (chunk) { hash.update(chunk); });

                function finish_(err) {
                    if (!err) {
                        var md5_expected = res.headers['content-md5'];
                        var md5_actual = hash.digest('base64');
                        if (md5_actual !== md5_expected) {
                            err = new ChecksumError(md5_actual,
                                                    md5_expected);
                        }
                    }
                    callback(err, res);
                }
                var finish = once(finish_);
                res.on('error', finish);
                out.on('error', finish);
                out.on(writeStreamFinishEvent, finish);
            });
        });
    });
};


/**
 * Get an image file stream.
 *
 * @param {String} uuid : the UUID of the image.
 * @param {UUID} account : Optional. The UUID of the account on behalf of whom
 *      this request is being made. If given this will only return images
 *      accessible to that account.
 * @param options {Object} Optional request options.
 *      - headers {Object} Optional extra request headers.
 *      - channel {String} Optional override for the channel set on the
 *        constructor. This is only relevant for IMGAPI servers that
 *        support channels.
 *      - index {Number} Optional files array index. Default is 0.
 * @param {Function} callback : `function (err, stream)`
 *      The `stream` is also an HTTP response object, i.e. headers are on
 *      `stream.headers`.
 */
IMGAPI.prototype.getImageFileStream = function getImageFileStream(
        uuid, account, options, callback) {
    var self = this;
    assert.string(uuid, 'uuid');
    if (typeof (account) === 'function') {
        callback = account;
        options = {};
        account = undefined;
    } else if (typeof (options) === 'function') {
        callback = options;
        options = {};
    }
    assert.optionalString(account, 'account');
    assert.object(options, 'options');
    assert.optionalObject(options.headers, 'options.headers');
    assert.optionalString(options.channel, 'options.channel');
    assert.optionalNumber(options.index, 'options.index');
    assert.func(callback, 'callback');

    var path = self._path(format('/images/%s/file', uuid), {
        channel: options.channel || self.channel,
        index: options.index,
        account: account
    });
    self._getAuthHeaders(function (hErr, headers) {
        if (hErr) {
            callback(hErr);
            return;
        }
        if (options.headers) {
            simpleMerge(headers, options.headers);
        }
        var reqOpts = {
            path: path,
            headers: headers
        };
        self.rawClient.get(reqOpts, function (connectErr, req) {
            if (connectErr) {
                callback(connectErr);
                return;
            }
            req.on('result', function (resultErr, res) {
                if (resultErr) {
                    extendErrFromRawBody(resultErr, res, function () {
                        callback(resultErr, res);
                    });
                    return;
                }
                pauseStream(res);
                callback(null, res);
            });
        });
    });
};


/**
 * Add an image icon.
 *
 * @param {Object} options
 *      - {String} uuid : the UUID of the image.
 *      - {String} contentType : the content type of the icon.
 *      - {String|Object} file : Readable stream or path to the image icon.
 *        If a stream is passed in it must be paused. Also, if this is
 *        node < v0.10 then it must be paused with `imgapi.pauseStream` or
 *        similar due to a node stream API bug.
 *      - {Number} size : The number of bytes. If `file` is a stream, then
 *        this is required, otherwise it will be retrieved with `fs.stat`.
 *      - {String} sha1 : SHA-1 hash of the icon file being uploaded.
 *      - headers {Object} Optional Additional request headers.
 *      - channel {String} Optional override for the channel set on the
 *        constructor. This is only relevant for IMGAPI servers that
 *        support channels.
 * @param {UUID} account : Optional. The UUID of the account on behalf of whom
 *      this request is being made. If given this will only return images
 *      accessible to that account.
 * @param {Function} callback : `function (err, image, res)`
 */
IMGAPI.prototype.addImageIcon = function addImageIcon(options, account,
                                                      callback) {
    var self = this;
    assert.object(options, 'options');
    assert.string(options.uuid, 'options.uuid');
    assert.string(options.contentType, 'options.contentType');
    assert.ok(['string', 'object'].indexOf(typeof (options.file)) !== -1,
        'options.file');
    assert.optionalString(options.sha1, 'options.sha1');
    assert.optionalNumber(options.size, 'options.size');
    assert.optionalObject(options.headers, 'options.headers');
    assert.optionalString(options.channel, 'options.channel');
    if (callback === undefined) {
        callback = account;
        account = undefined;
    }
    assert.optionalString(account, 'account');
    assert.func(callback, 'callback');
    var uuid = options.uuid;
    var file = options.file;

    function getFileStreamAndSize(next) {
        var stream;
        if (typeof (file) === 'object') {
            assert.number(options.size, 'options.size');
            return next(null, file, options.size);
        } else if (options.size) {
            stream = fs.createReadStream(file);
            pauseStream(stream);
            return next(null, stream, options.size);
        } else {
            return fs.stat(file, function (statErr, stats) {
                if (statErr) {
                    return next(statErr);
                }
                stream = fs.createReadStream(file);
                pauseStream(stream);
                return next(null, stream, stats.size);
            });
        }
    }

    getFileStreamAndSize(function (err, stream, size) {
        if (err) {
            callback(err);
            return;
        }

        var path = self._path(format('/images/%s/icon', uuid), {
            channel: options.channel || self.channel,
            account: account,
            sha1: options.sha1
        });

        self._getAuthHeaders(function (hErr, headers) {
            if (hErr) {
                callback(hErr);
                return;
            }
            headers['Content-Type'] = options.contentType;
            headers['Content-Length'] = size;
            headers['Accept'] = 'application/json';
            if (options.headers) {
                simpleMerge(headers, options.headers);
            }
            var reqOpts = {
                path: path,
                headers: headers
            };
            self.rawClient.put(reqOpts, function (connectErr, req) {
                if (connectErr) {
                    callback(connectErr);
                    return;
                }

                stream.pipe(req);
                stream.resume();

                req.on('result', function (resultErr, res) {
                    if (resultErr) {
                        extendErrFromRawBody(resultErr, res, function () {
                            callback(resultErr, null, res);
                        });
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
                                'invalid image data in response: \'%s\'',
                                body));
                            return;
                        }
                        callback(null, data, res);
                    });
                });
            });
        });
    });
};


/**
 * Get an image icon.
 *
 * @param {String} uuid : the UUID of the image.
 * @param {String} filePath : Path to which to save the image icon.
 * @param {UUID} account : Optional. The UUID of the account on behalf of whom
 *      this request is being made. If given this will only return images
 *      accessible to that account.
 * @param options {Object} Optional request options.
 *      - headers {Object} Optional extra request headers.
 *      - channel {String} Optional override for the channel set on the
 *        constructor. This is only relevant for IMGAPI servers that
 *        support channels.
 * @param {Function} callback : `function (err, res)`
 */
IMGAPI.prototype.getImageIcon =
function getImageIcon(uuid, filePath, account, options, callback) {
    var self = this;
    assert.string(uuid, 'uuid');
    assert.string(filePath, 'filePath');
    if (typeof (account) === 'function') {
        callback = account;
        options = {};
        account = undefined;
    } else if (typeof (options) === 'function') {
        callback = options;
        options = {};
    }
    assert.optionalString(account, 'account');
    assert.object(options, 'options');
    assert.optionalObject(options.headers, 'options.headers');
    assert.optionalString(options.channel, 'options.channel');
    assert.func(callback, 'callback');

    var path = self._path(format('/images/%s/icon', uuid), {
        channel: options.channel || self.channel,
        account: account
    });
    self._getAuthHeaders(function (hErr, headers) {
        if (hErr) {
            callback(hErr);
            return;
        }
        if (options.headers) {
            simpleMerge(headers, options.headers);
        }
        var reqOpts = {
            path: path,
            headers: headers
        };
        self.rawClient.get(reqOpts, function (connectErr, req) {
            if (connectErr) {
                callback(connectErr);
                return;
            }
            req.on('result', function (resultErr, res) {
                if (resultErr) {
                    extendErrFromRawBody(resultErr, res, function () {
                        callback(resultErr, res);
                    });
                    return;
                }

                var hash = null;
                var out = res.pipe(fs.createWriteStream(filePath));
                hash = crypto.createHash('md5');
                res.on('data', function (chunk) { hash.update(chunk); });

                function finish_(err) {
                    if (!err) {
                        var md5_expected = res.headers['content-md5'];
                        var md5_actual = hash.digest('base64');
                        if (md5_actual !== md5_expected) {
                            err = new ChecksumError(md5_actual,
                                                    md5_expected);
                        }
                    }
                    callback(err, res);
                }
                var finish = once(finish_);

                res.on('error', finish);
                out.on('error', finish);
                out.on(writeStreamFinishEvent, finish);
            });
        });
    });
};


/**
 * Get an image icon stream.
 *
 * @param {String} uuid : the UUID of the image.
 * @param {UUID} account : Optional. The UUID of the account on behalf of whom
 *      this request is being made. If given this will only return images
 *      accessible to that account.
 * @param options {Object} Optional request options.
 *      - headers {Object} Optional extra request headers.
 *      - channel {String} Optional override for the channel set on the
 *        constructor. This is only relevant for IMGAPI servers that
 *        support channels.
 * @param {Function} callback : `function (err, stream)`
 *      The `stream` is also an HTTP response object, i.e. headers are on
 *      `stream.headers`.
 */
IMGAPI.prototype.getImageIconStream = function getImageIconStream(
        uuid, account, options, callback) {
    var self = this;
    assert.string(uuid, 'uuid');
    if (typeof (account) === 'function') {
        callback = account;
        options = {};
        account = undefined;
    } else if (typeof (options) === 'function') {
        callback = options;
        options = {};
    }
    assert.optionalString(account, 'account');
    assert.object(options, 'options');
    assert.optionalObject(options.headers, 'options.headers');
    assert.optionalString(options.channel, 'options.channel');
    assert.func(callback, 'callback');

    var path = self._path(format('/images/%s/icon', uuid), {
        channel: options.channel || self.channel,
        account: account
    });
    self._getAuthHeaders(function (hErr, headers) {
        if (hErr) {
            callback(hErr);
            return;
        }
        if (options.headers) {
            simpleMerge(headers, options.headers);
        }
        var reqOpts = {
            path: path,
            headers: headers
        };
        self.rawClient.get(reqOpts, function (connectErr, req) {
            if (connectErr) {
                callback(connectErr);
                return;
            }
            req.on('result', function (resultErr, res) {
                if (resultErr) {
                    extendErrFromRawBody(resultErr, res, function () {
                        callback(resultErr, res);
                    });
                    return;
                }
                pauseStream(res);
                callback(null, res);
            });
        });
    });
};


/**
 * Delete the image icoon.
 *
 * @param {String} uuid : the UUID of the image.
 * @param {UUID} account : Optional. The UUID of the account on behalf of whom
 *      this request is being made. If given this will restrict to images
 *      accessible to that account.
 * @param options {Object} Optional request options.
 *      - headers {Object} Optional extra request headers.
 *      - channel {String} Optional override for the channel set on the
 *        constructor. This is only relevant for IMGAPI servers that
 *        support channels.
 * @param {Function} callback : `function (err, image, res)`
 */
IMGAPI.prototype.deleteImageIcon =
function deleteImageIcon(uuid, account, options, callback) {
    var self = this;
    assert.string(uuid, 'uuid');
    if (typeof (account) === 'function') {
        callback = account;
        options = {};
        account = undefined;
    } else if (typeof (options) === 'function') {
        callback = options;
        options = {};
    }
    assert.optionalString(account, 'account');
    assert.object(options, 'options');
    assert.optionalObject(options.headers, 'options.headers');
    assert.optionalString(options.channel, 'options.channel');
    assert.func(callback, 'callback');

    var path = self._path(format('/images/%s/icon', uuid), {
        channel: options.channel || self.channel,
        account: account
    });
    self._getAuthHeaders(function (hErr, headers) {
        if (hErr) {
            callback(hErr);
            return;
        }
        if (options.headers) {
            simpleMerge(headers, options.headers);
        }
        var reqOpts = {
            path: path,
            headers: headers
        };
        self.client.del(reqOpts, function (err, req, res, image) {
            if (err) {
                callback(err, null, res);
            } else {
                callback(null, image, res);
            }
        });
    });
};


/**
 * Exports an image to the specified Manta path. Only images that already live
 * on manta can be exported, locally stored images are not supported.
 *
 * @param {String} uuid : the UUID of the image.
 * @param {UUID} account : Optional. The UUID of the account on behalf of whom
 *      this request is being made. If given then the manta_path prefix must
 *      resolve to a location that is owned by the account. If not given then
 *      the manta_path prefix is assumed to (and must) resolve to a path that is
 *      owned by the admin uuser
 * @param {Object} options: Required.
 *      - manta_path {String} Required. Manta path prefix where the image file
 *          file and manifest should be exported to. If "manta_path" is a dir,
 *          then the files are saved to it. If the basename of "PATH" is not a
 *          dir, then "PATH.imgmanifest" and "PATH.zfs[.EXT]" are created.
 *      - headers {Object} Optional. Additional request headers.
 *      - channel {String} Optional override for the channel set on the
 *        constructor. This is only relevant for IMGAPI servers that
 *        support channels.
 * @param {Function} callback : `function (err, image, res)`
 */
IMGAPI.prototype.exportImage =
function exportImage(uuid, account, options, callback) {
    var self = this;
    assert.string(uuid, 'uuid');
    if (typeof (options) === 'function') {
        callback = options;
        options = account;
        account = undefined;
    }
    assert.object(options, 'options');
    assert.string(options.manta_path, 'manta_path');
    assert.optionalObject(options.headers, 'options.headers');
    assert.optionalString(options.channel, 'options.channel');
    assert.optionalString(account, 'account');
    assert.func(callback, 'callback');

    var path = self._path(format('/images/%s', uuid), {
        channel: options.channel || self.channel,
        action: 'export',
        manta_path: options.manta_path,
        account: account
    });
    self._getAuthHeaders(function (hErr, headers) {
        if (hErr) {
            callback(hErr);
            return;
        }
        if (options.headers) {
            simpleMerge(headers, options.headers);
        }
        var reqOpts = {
            path: path,
            headers: headers
        };
        self.client.post(reqOpts, function (err, req, res, obj) {
            if (err) {
                callback(err, null, res);
            } else {
                callback(null, obj, res);
            }
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
 * @param options {Object} Optional request options.
 *      - headers {Object} Optional extra request headers.
 *      - channel {String} Optional override for the channel set on the
 *        constructor. This is only relevant for IMGAPI servers that
 *        support channels.
 * @param {Function} callback : `function (err, image, res)`
 */
IMGAPI.prototype.activateImage =
function activateImage(uuid, account, options, callback) {
    var self = this;
    assert.string(uuid, 'uuid');
    if (typeof (account) === 'function') {
        callback = account;
        options = {};
        account = undefined;
    } else if (typeof (options) === 'function') {
        callback = options;
        options = {};
    }
    assert.optionalString(account, 'account');
    assert.object(options, 'options');
    assert.optionalObject(options.headers, 'options.headers');
    assert.optionalString(options.channel, 'options.channel');
    assert.func(callback, 'callback');

    var path = self._path(format('/images/%s', uuid), {
        channel: options.channel || self.channel,
        action: 'activate',
        account: account
    });
    self._getAuthHeaders(function (hErr, headers) {
        if (hErr) {
            callback(hErr);
            return;
        }
        if (options.headers) {
            simpleMerge(headers, options.headers);
        }
        var reqOpts = {
            path: path,
            headers: headers
        };
        self.client.post(reqOpts, function (err, req, res, image) {
            if (err) {
                callback(err, null, res);
            } else {
                callback(null, image, res);
            }
        });
    });
};


/**
 * Disable an image.
 *
 * @param {String} uuid : the UUID of the image.
 * @param {UUID} account : Optional. The UUID of the account on behalf of whom
 *      this request is being made. If given this will only return images
 *      accessible to that account.
 * @param options {Object} Optional request options.
 *      - headers {Object} Optional extra request headers.
 *      - channel {String} Optional override for the channel set on the
 *        constructor. This is only relevant for IMGAPI servers that
 *        support channels.
 * @param {Function} callback : `function (err, image, res)`
 */
IMGAPI.prototype.disableImage =
function disableImage(uuid, account, options, callback) {
    var self = this;
    assert.string(uuid, 'uuid');
    if (typeof (account) === 'function') {
        callback = account;
        options = {};
        account = undefined;
    } else if (typeof (options) === 'function') {
        callback = options;
        options = {};
    }
    assert.optionalString(account, 'account');
    assert.object(options, 'options');
    assert.optionalObject(options.headers, 'options.headers');
    assert.optionalString(options.channel, 'options.channel');
    assert.func(callback, 'callback');

    var path = self._path(format('/images/%s', uuid), {
        channel: options.channel || self.channel,
        action: 'disable',
        account: account
    });
    self._getAuthHeaders(function (hErr, headers) {
        if (hErr) {
            callback(hErr);
            return;
        }
        if (options.headers) {
            simpleMerge(headers, options.headers);
        }
        var reqOpts = {
            path: path,
            headers: headers
        };
        self.client.post(reqOpts, function (err, req, res, image) {
            if (err) {
                callback(err, null, res);
            } else {
                callback(null, image, res);
            }
        });
    });
};


/**
 * Enable an image.
 *
 * @param {String} uuid : the UUID of the image.
 * @param {UUID} account : Optional. The UUID of the account on behalf of whom
 *      this request is being made. If given this will only return images
 *      accessible to that account.
 * @param options {Object} Optional request options.
 *      - headers {Object} Optional extra request headers.
 *      - channel {String} Optional override for the channel set on the
 *        constructor. This is only relevant for IMGAPI servers that
 *        support channels.
 * @param {Function} callback : `function (err, image, res)`
 */
IMGAPI.prototype.enableImage =
function enableImage(uuid, account, options, callback) {
    var self = this;
    assert.string(uuid, 'uuid');
    if (typeof (account) === 'function') {
        callback = account;
        options = {};
        account = undefined;
    } else if (typeof (options) === 'function') {
        callback = options;
        options = {};
    }
    assert.optionalString(account, 'account');
    assert.object(options, 'options');
    assert.optionalObject(options.headers, 'options.headers');
    assert.optionalString(options.channel, 'options.channel');
    assert.func(callback, 'callback');

    var path = self._path(format('/images/%s', uuid), {
        channel: options.channel || self.channel,
        action: 'enable',
        account: account
    });
    self._getAuthHeaders(function (hErr, headers) {
        if (hErr) {
            callback(hErr);
            return;
        }
        if (options.headers) {
            simpleMerge(headers, options.headers);
        }
        var reqOpts = {
            path: path,
            headers: headers
        };
        self.client.post(reqOpts, function (err, req, res, image) {
            if (err) {
                callback(err, null, res);
            } else {
                callback(null, image, res);
            }
        });
    });
};


/**
 * Add more UUIDs to the Image ACL.
 *
 * @param {String} uuid : the UUID of the image.
 * @param {Array} acl : list of UUIDs to add to the image ACL.
 * @param {UUID} account : Optional. The UUID of the account on behalf of whom
 *      this request is being made. If given this will only return images
 *      accessible to that account.
 * @param options {Object} Optional request options.
 *      - headers {Object} Optional extra request headers.
 *      - channel {String} Optional override for the channel set on the
 *        constructor. This is only relevant for IMGAPI servers that
 *        support channels.
 * @param {Function} callback : `function (err, image, res)`
 */
IMGAPI.prototype.addImageAcl =
function addImageAcl(uuid, acl, account, options, callback) {
    var self = this;
    assert.string(uuid, 'uuid');
    if (typeof (account) === 'function') {
        callback = account;
        options = {};
        account = undefined;
    } else if (typeof (options) === 'function') {
        callback = options;
        options = {};
    }
    assert.optionalString(account, 'account');
    assert.arrayOfString(acl, 'acl');
    assert.object(options, 'options');
    assert.optionalObject(options.headers, 'options.headers');
    assert.optionalString(options.channel, 'options.channel');
    assert.func(callback, 'callback');

    var path = self._path(format('/images/%s/acl', uuid), {
        channel: options.channel || self.channel,
        action: 'add',
        account: account
    });
    self._getAuthHeaders(function (hErr, headers) {
        if (hErr) {
            callback(hErr);
            return;
        }
        if (options.headers) {
            simpleMerge(headers, options.headers);
        }
        var reqOpts = {
            path: path,
            headers: headers
        };
        self.client.post(reqOpts, acl, function (err, req, res, image) {
            if (err) {
                callback(err, null, res);
            } else {
                callback(null, image, res);
            }
        });
    });
};


/**
 * Remove UUIDs from the Image ACL.
 *
 * @param {String} uuid : the UUID of the image.
 * @param {Array} acl : list of UUIDs to remove from the image ACL.
 * @param {UUID} account : Optional. The UUID of the account on behalf of whom
 *      this request is being made. If given this will only return images
 *      accessible to that account.
 * @param options {Object} Optional request options.
 *      - headers {Object} Optional extra request headers.
 *      - channel {String} Optional override for the channel set on the
 *        constructor. This is only relevant for IMGAPI servers that
 *        support channels.
 * @param {Function} callback : `function (err, image, res)`
 */
IMGAPI.prototype.removeImageAcl =
function removeImageAcl(uuid, acl, account, options, callback) {
    var self = this;
    assert.string(uuid, 'uuid');
    if (typeof (account) === 'function') {
        callback = account;
        options = {};
        account = undefined;
    } else if (typeof (options) === 'function') {
        callback = options;
        options = {};
    }
    assert.optionalString(account, 'account');
    assert.arrayOfString(acl, 'acl');
    assert.object(options, 'options');
    assert.optionalObject(options.headers, 'options.headers');
    assert.optionalString(options.channel, 'options.channel');
    assert.func(callback, 'callback');

    var path = self._path(format('/images/%s/acl', uuid), {
        channel: options.channel || self.channel,
        action: 'remove',
        account: account
    });
    self._getAuthHeaders(function (hErr, headers) {
        if (hErr) {
            callback(hErr);
            return;
        }
        if (options.headers) {
            simpleMerge(headers, options.headers);
        }
        var reqOpts = {
            path: path,
            headers: headers
        };
        self.client.post(reqOpts, acl, function (err, req, res, image) {
            if (err) {
                callback(err, null, res);
            } else {
                callback(null, image, res);
            }
        });
    });
};


/**
 * Updates an image.
 *
 * @param {String} uuid : the UUID of the image.
 * @param {Object} data : attributes of the image that will be replaced.
 * @param {UUID} account : Optional. The UUID of the account on behalf of whom
 *      this request is being made. If given this will only return images
 *      accessible to that account.
 * @param options {Object} Optional request options.
 *      - headers {Object} Optional extra request headers.
 *      - channel {String} Optional override for the channel set on the
 *        constructor. This is only relevant for IMGAPI servers that
 *        support channels.
 * @param {Function} callback : `function (err, image, res)`
 */
IMGAPI.prototype.updateImage =
function updateImage(uuid, data, account, options, callback) {
    var self = this;
    assert.string(uuid, 'uuid');
    if (typeof (account) === 'function') {
        callback = account;
        options = {};
        account = undefined;
    } else if (typeof (options) === 'function') {
        callback = options;
        options = {};
    }
    assert.optionalString(account, 'account');
    assert.object(data, 'data');
    assert.object(options, 'options');
    assert.optionalObject(options.headers, 'options.headers');
    assert.optionalString(options.channel, 'options.channel');
    assert.func(callback, 'callback');

    var path = self._path(format('/images/%s', uuid), {
        channel: options.channel || self.channel,
        action: 'update',
        account: account
    });
    self._getAuthHeaders(function (hErr, headers) {
        if (hErr) {
            callback(hErr);
            return;
        }
        if (options.headers) {
            simpleMerge(headers, options.headers);
        }
        var reqOpts = {
            path: path,
            headers: headers
        };
        self.client.post(reqOpts, data, function (err, req, res, image) {
            if (err) {
                callback(err, null, res);
            } else {
                callback(null, image, res);
            }
        });
    });
};


/**
 * Clones an image.
 *
 * @param {String} uuid : the UUID of the image.
 * @param {UUID} account : The UUID of the account on behalf of whom
 *      this request is being made. This UUID must be on the image ACL.
 * @param options {Object} Optional request options.
 *      - headers {Object} Optional extra request headers.
 *      - channel {String} Optional override for the channel set on the
 *        constructor. This is only relevant for IMGAPI servers that
 *        support channels.
 * @param {Function} callback : `function (err, image, res)`
 */
IMGAPI.prototype.cloneImage =
function cloneImage(uuid, account, options, callback) {
    var self = this;
    assert.string(uuid, 'uuid');
    assert.string(account, 'account');
    if (typeof (options) === 'function') {
        callback = options;
        options = {};
    }
    assert.object(options, 'options');
    assert.optionalObject(options.headers, 'options.headers');
    assert.optionalString(options.channel, 'options.channel');
    assert.func(callback, 'callback');

    var path = self._path(format('/images/%s/clone', uuid), {
        account: account,
        channel: options.channel || self.channel
    });
    self._getAuthHeaders(function (hErr, headers) {
        if (hErr) {
            callback(hErr);
            return;
        }
        if (options.headers) {
            simpleMerge(headers, options.headers);
        }
        var reqOpts = {
            path: path,
            headers: headers
        };
        self.client.post(reqOpts, function (err, req, res, image) {
            if (err) {
                callback(err, null, res);
            } else {
                callback(null, image, res);
            }
        });
    });
};


/**
 * Delete an image.
 *
 * The image is remove from the current channel. When an image is removed
 * from its last channel, it is deleted from the repository. See
 * `forceAllChannels` below.
 *
 * @param {String} uuid : the UUID of the image.
 * @param {UUID} account : Optional. The UUID of the account on behalf of whom
 *      this request is being made. If given this will restrict to images
 *      accessible to that account.
 * @param options {Object} Optional request options.
 *      - headers {Object} Optional extra request headers.
 *      - channel {String} Optional override for the channel set on the
 *        constructor. This is only relevant for IMGAPI servers that
 *        support channels.
 *      - forceAllChannels {Boolean} Optional. Set to true for force actual
 *        deletion ofa
 * @param {Function} callback : `function (err, res)`
 */
IMGAPI.prototype.deleteImage =
function deleteImage(uuid, account, options, callback) {
    var self = this;
    assert.string(uuid, 'uuid');
    if (typeof (account) === 'function') {
        callback = account;
        options = {};
        account = undefined;
    } else if (typeof (account) === 'object') {
        callback = options;
        options = account;
        account = undefined;
    } else if (typeof (options) === 'function') {
        callback = options;
        options = {};
    }
    assert.optionalString(account, 'account');
    assert.object(options, 'options');
    assert.optionalObject(options.headers, 'options.headers');
    assert.optionalString(options.channel, 'options.channel');
    assert.optionalBool(options.forceAllChannels, 'options.forceAllChannels');
    assert.func(callback, 'callback');

    var path = self._path(format('/images/%s', uuid), {
        channel: options.channel || self.channel,
        account: account,
        force_all_channels: options.forceAllChannels
    });
    self._getAuthHeaders(function (hErr, headers) {
        if (hErr) {
            callback(hErr);
            return;
        }
        if (!headers['content-length']) {
            headers['content-length'] = 0;
        }
        if (options.headers) {
            simpleMerge(headers, options.headers);
        }
        var reqOpts = {
            path: path,
            headers: headers
        };
        self.client.del(reqOpts, function (err, req, res) {
            if (err) {
                callback(err, res);
            } else {
                callback(null, res);
            }
        });
    });
};


/**
 * Imports an image from the provided datatcenter.
 *
 * @param {String} uuid : the UUID of the image.
 * @param {UUID} account : The UUID of the account on behalf of whom
 *      this request is being made.
 * @param {Object} options: Required.
 *      - datacenter {String} Required. The datacenter to import the image from.
 *      - headers {Object} Optional. Additional request headers.
 *      - channel {String} Optional override for the channel set on the
 *        constructor. This is only relevant for IMGAPI servers that
 *        support channels.
 * @param {Function} callback : `function (err, job, res)`
 */
IMGAPI.prototype.importImageFromDatacenter =
function importImageFromDatacenter(uuid, account, options, callback) {
    var self = this;
    assert.uuid(uuid, 'uuid');
    assert.uuid(account, 'account');
    assert.object(options, 'options');
    assert.string(options.datacenter, 'options.datacenter');
    assert.optionalObject(options.headers, 'options.headers');
    assert.optionalString(options.channel, 'options.channel');
    assert.func(callback, 'callback');

    var path = self._path(format('/images/%s', uuid), {
        account: account,
        action: 'import-from-datacenter',
        channel: options.channel || self.channel,
        datacenter: options.datacenter
    });
    self._getAuthHeaders(function (hErr, headers) {
        if (hErr) {
            callback(hErr);
            return;
        }
        if (options.headers) {
            simpleMerge(headers, options.headers);
        }
        var reqOpts = {
            path: path,
            headers: headers
        };
        self.client.post(reqOpts, function (err, req, res, obj) {
            if (err) {
                callback(err, null, res);
            } else {
                callback(null, obj, res);
            }
        });
    });
};


/**
 * Imports an image from the provided datatcenter.
 *
 * @param {String} uuid : the UUID of the image.
 * @param {UUID} account : The UUID of the account on behalf of whom
 *      this request is being made.
 * @param {Object} options: Required.
 *      - datacenter {String} Required. The datacenter to import the image from.
 *      - headers {Object} Optional. Additional request headers.
 * @param {Function} callback : `function (err, image, res)`
 */
IMGAPI.prototype.importImageFromDatacenterAndWait =
function importImageFromDatacenterAndWait(uuid, account, options, callback) {
    var self = this;

    self.importImageFromDatacenter(uuid, account, options,
            function (err, job, res) {
        if (err) {
            callback(err, null, res);
            return;
        }

        var wfapiUrl = res.headers['workflow-api'];

        assert.string(wfapiUrl, 'wfapiUrl');
        assert.string(job['job_uuid'], 'job_uuid');
        assert.string(job['image_uuid'], 'image_uuid');

        waitForJob(wfapiUrl, job['job_uuid'], function (jErr) {
            if (jErr) {
                callback(jErr);
                return;
            }
            self.getImage(job['image_uuid'], callback);
        });
    });
};


/**
 * ListChannels
 * <https://mo.joyent.com/docs/imgapi/master/#ListChannels>
 *
 * @param opts {Object} Required. Request options.
 *      - headers {Object} Optional. Additional request headers.
 * @param cb {Function} `function (err, channels, res, req)`
 */
IMGAPI.prototype.listChannels = function listChannels(opts, cb) {
    var self = this;
    assert.object(opts, 'opts');
    assert.optionalObject(opts.headers, 'opts.headers');
    assert.func(cb, 'cb');

    var path = self._path('/channels');
    self._getAuthHeaders(function (hErr, headers) {
        if (hErr) {
            cb(hErr);
            return;
        }
        if (opts && opts.headers) {
            simpleMerge(headers, opts.headers);
        }
        var reqOpts = {
            path: path,
            headers: headers
        };
        self.client.get(reqOpts, function (err, req, res, channels) {
            if (err) {
                cb(err, null, res, req);
            } else {
                cb(null, channels, res, req);
            }
        });
    });
};


/**
 * ChannelAddImage
 * <https://mo.joyent.com/docs/imgapi/master/#ChannelAddImage>
 *
 * @param opts {Object} Required. Request options.
 *      - uuid {UUID} Required. UUID of image to add to a channel.
 *      - channel {String} Required. Channel to which to add the image.
 *      - account {String} Optional. The UUID of the account who is querying.
 *        If given this will restrict to images accessible to that account.
 *      - headers {Object} Optional. Additional request headers.
 * @param cb {Function} `function (err, img, res, req)`
 */
IMGAPI.prototype.channelAddImage = function channelAddImage(opts, cb) {
    var self = this;
    assert.object(opts, 'opts');
    assert.string(opts.uuid, 'opts.uuid');
    assert.string(opts.channel, 'opts.channel');
    assert.optionalString(opts.account, 'opts.account');
    assert.optionalObject(opts.headers, 'opts.headers');
    assert.func(cb, 'cb');

    /**
     * Dev Note: There are *two* "channel" vars in play here.
     * 1. The "channel" query param, used to find the given image (as with
     *    most other endpoints), and
     * 2. the "channel" param in the *body*, giving the channel to which to
     *    add image.
     */

    var path = self._path('/images/' + opts.uuid, {
        channel: self.channel,
        action: 'channel-add',
        account: opts.account
    });
    self._getAuthHeaders(function (hErr, headers) {
        if (hErr) {
            cb(hErr);
            return;
        }
        if (opts && opts.headers) {
            simpleMerge(headers, opts.headers);
        }
        var reqOpts = {
            path: path,
            headers: headers
        };
        var data = {channel: opts.channel};
        self.client.post(reqOpts, data, function (err, req, res, img) {
            if (err) {
                cb(err, null, res, req);
            } else {
                cb(null, img, res, req);
            }
        });
    });
};


/**
 * AdminChangeImageStor
 * <https://mo.joyent.com/docs/imgapi/master/#AdminChangeImageStor>
 *
 * @param opts {Object} Required. Request options.
 *      - uuid {UUID} Required. UUID of image to change.
 *      - stor {String} Required. The storage type to which to change.
 *      - headers {Object} Optional. Additional request headers.
 * @param cb {Function} `function (err, img, res, req)`
 */
IMGAPI.prototype.adminChangeStor = function adminChangeStor(opts, cb) {
    var self = this;
    assert.object(opts, 'opts');
    assert.string(opts.uuid, 'opts.uuid');
    assert.string(opts.stor, 'opts.stor');
    assert.optionalObject(opts.headers, 'opts.headers');
    assert.func(cb, 'cb');

    var path = self._path('/images/' + opts.uuid, {
        action: 'change-stor',
        stor: opts.stor
    });
    self._getAuthHeaders(function (hErr, headers) {
        if (hErr) {
            cb(hErr);
            return;
        }
        if (opts && opts.headers) {
            simpleMerge(headers, opts.headers);
        }
        var reqOpts = {
            path: path,
            headers: headers
        };
        self.client.post(reqOpts, function (err, req, res, img) {
            if (err) {
                cb(err, null, res, req);
            } else {
                cb(null, img, res, req);
            }
        });
    });
};


// ---- exports

module.exports = IMGAPI;

module.exports.ChecksumError = ChecksumError;
module.exports.SigningError = SigningError;

module.exports.createClient = function createClient(options) {
    return new IMGAPI(options);
};

module.exports.cliSigner = function (opts_) {
    var opts = objCopy(opts_);

    /* API backwards compatibility */
    if (opts.keyIds !== undefined) {
        if (!Array.isArray(opts.keyIds) || opts.keyIds.length !== 1)
            throw (new Error('options.keyIds must be an array with a single ' +
                'element'));
        opts.keyId = opts.keyIds[0];
        delete (opts.keyIds);
    }

    /*
     * Support for 'keyId' being a path to a private key, which was otherwise
     * dropped in node-sdc-clients@9.0.0.
     *
     * This is somewhat of a hack. This client's usage of smartdc-auth should
     * move away from its "legacy" cliSigner, privateKeySigner, etc.
     */
    var key;
    try {
        sshpk.parseFingerprint(opts.keyId);
    } catch (parseErr) {
        try {
            // Until smartdc-auth#11, this needs to be a string.
            key = fs.readFileSync(opts.keyId, {encoding: 'ascii'});
        } catch (readErr) {
            /*
             * Ignore this error, a rely on later code mentioning that the
             * given `keyId` is not a valid fingerprint.
             */
        }
    }

    var signer;
    if (key) {
        delete (opts.keyId);
        opts.key = key;
        signer = auth.privateKeySigner(opts);
    } else {
        signer = auth.cliSigner(opts);
    }
    return (signer);
};

// A useful utility that must be used on a stream passed into the
// `addImageFile` API to not lose leading chunks.
module.exports.pauseStream = pauseStream;
