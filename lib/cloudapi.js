// Copyright 2011 Joyent, Inc.  All rights reserved.

var assert = require('assert');
var crypto = require('crypto');

var restify = require('restify');
var sprintf = require('sprintf').sprintf;

var utils = require('./utils');



///--- Globals

var date = restify.httpDate;
var log = restify.log;

var SIGNATURE = 'Signature keyId="%s",algorithm="%s" %s'

var ROOT = '/%s';
var KEYS = ROOT + '/keys';
var KEY = KEYS + '/%s';



///--- Internal Helpers




///--- Exported CloudAPI Client

/**
 * Constructor
 *
 * Note that in options you can pass in any parameters that the restify
 * RestClient constructor takes (for example retry/backoff settings).
 *
 * @param {Object} options
 *                  - url {String} CloudAPI location.
 *
 * @throws {TypeError} on bad input.
 */
function CloudAPI(options) {
  if (!options) throw new TypeError('options required');
  if (!options.url) throw new TypeError('options.url required');
  if (!(options.username && options.password) &&
      !(options.keyId && options.key))
    throw new TypeError('Either username/password or keyId/key are required');

  if (options.logLevel)
    log.level(options.logLevel);
  if (!options.version)
    options.version = '6.1.0';
  this.account = options.account || 'my';

  // Try to use RSA Signing over BasicAuth
  if (options.key) {
    this.keyId = options.keyId;
    this.key = options.key;
  } else {
    this.basicAuth = utils.basicAuth(options.username, options.password);
  }
  options.contentType = 'application/json';

  this.client = restify.createClient(options);
}


/**
 * Looks up your account record.
 *
 * Returns an object.
 *
 * @param {String} account (optional) the login name of the account.
 * @param {Function} callback of the form f(err, account).
 * @throws {TypeError} on bad input.
 */
CloudAPI.prototype.getAccount = function(account, callback) {
  if (typeof(account) === 'function') {
    callback = account;
    account = this.account;
  }
  if (!callback || typeof(callback) !== 'function')
    throw new TypeError('callback (function) required');

  var req = this._request(sprintf(ROOT, account));
  var cb = this._contentCallback('getAccount', req, callback);
  return this.client.get(req, cb);
}
CloudAPI.prototype.GetAccount = CloudAPI.prototype.getAccount;


/**
 * Creates an SSH key on your account.
 *
 * Returns a JS object (the created key). Note that options can actually
 * be just the key PEM, if you don't care about names.
 *
 * @param {String} account (optional) the login name of the account.
 * @param {Object} options object containing:
 *                   - {String} name (optional) name for your ssh key.
 *                   - {String} key SSH public key.
 * @param {Function} callback of the form f(err, key).
 * @throws {TypeError} on bad input.
 */
CloudAPI.prototype.createKey = function(account, options, callback) {
  if (typeof(options) === 'function') {
    callback = options;
    options = account;
    account = this.account;
  }
  if (!callback || typeof(callback) !== 'function')
    throw new TypeError('callback (function) required');
  if (!options ||
      (typeof(options) !== 'string' && typeof(options) !== 'object'))
    throw new TypeError('options (object) required');

  if (typeof(options) === 'string') {
    options = {
      key: options
    };
  }

  var req = this._request(sprintf(KEYS, account), options);
  var cb = this._contentCallback('createKey', req, callback);
  return this.client.post(req, cb);
}
CloudAPI.prototype.CreateKey = CloudAPI.prototype.createKey;


/**
 * Lists all SSH keys on file for your account.
 *
 * Returns an array of objects.
 *
 * @param {String} account (optional) the login name of the account.
 * @param {Function} callback of the form f(err, keys).
 * @throws {TypeError} on bad input.
 */
CloudAPI.prototype.listKeys = function(account, callback) {
  if (typeof(account) === 'function') {
    callback = account;
    account = this.account;
  }
  if (!callback || typeof(callback) !== 'function')
    throw new TypeError('callback (function) required');

  var req = this._request(sprintf(KEYS, account));
  var cb = this._contentCallback('listKeys', req, callback);
  return this.client.get(req, cb);
}
CloudAPI.prototype.ListKeys = CloudAPI.prototype.listKeys;


/**
 * Retrieves an SSH key from your account.
 *
 * Returns a JS object (the created key).
 *
 * @param {String} account (optional) the login name of the account.
 * @param {String} key can be either the string name of the key, or the object
 *                 returned from create/get.
 * @param {Function} callback of the form f(err, key).
 * @throws {TypeError} on bad input.
 */
CloudAPI.prototype.getKey = function(account, key, callback) {
  if (typeof(key) === 'function') {
    callback = key;
    key = account;
    account = this.account;
  }

  if (!key || (typeof(key) !== 'object' && typeof(key) !== 'string'))
    throw new TypeError('key (object|string) required');
  if (!callback || typeof(callback) !== 'function')
    throw new TypeError('callback (function) required');

  var name = (typeof(key) === 'object' ? key.name : key);
  var req = this._request(sprintf(KEY, account, name));
  var cb = this._contentCallback('getKey', req, callback);

  return this.client.get(req, cb);
}
CloudAPI.prototype.GetKey = CloudAPI.prototype.getKey;


/**
 * Deletes an SSH key from your account.
 *
 * Returns a JS object (the created key).
 *
 * @param {String} account (optional) the login name of the account.
 * @param {String} key can be either the string name of the key, or the object
 *                 returned from create/get.
 * @param {Function} callback of the form f(err, key).
 * @throws {TypeError} on bad input.
 */
CloudAPI.prototype.deleteKey = function(account, key, callback) {
  if (typeof(key) === 'function') {
    callback = key;
    key = account;
    account = this.account;
  }

  if (!key || (typeof(key) !== 'object' && typeof(key) !== 'string'))
    throw new TypeError('key (object|string) required');
  if (!callback || typeof(callback) !== 'function')
    throw new TypeError('callback (function) required');

  var name = (typeof(key) === 'object' ? key.name : key);
  var req = this._request(sprintf(KEY, account, name));
  var cb = this._noContentCallback('deleteKey', req, callback);

  return this.client.del(req, cb);
}
CloudAPI.prototype.DeleteKey = CloudAPI.prototype.deleteKey;



///--- Private Functions

CloudAPI.prototype._error = function(err) {
  assert.ok(err);

  if (err.name === 'HttpError') {
    var e = new Error();
    e.name = 'CloudApiError';
    e.code = err.details.object.code;
    e.message = err.details.object.message;
    return e;
  }

  return err;
};


CloudAPI.prototype._contentCallback = function(name, req, callback) {
  assert.ok(name);
  assert.ok(req);
  assert.ok(callback);

  var self = this;

  return function(err, obj, headers, res) {
    var rc;
    if (err) rc = err.httpCode;
    else if (res) rc = res.statusCode;
    else rc = -1;

    log.debug('CloudAPI.%s(%s): status=%d, err=%s, obj=%o, headers=%o',
              name, req.path, rc, err, obj, headers);

    if (err)
      return callback(self._error(err));

    return callback(null, obj);
  };
};


CloudAPI.prototype._noContentCallback = function(name, req, callback) {
  assert.ok(name);
  assert.ok(req);
  assert.ok(callback);

  var self = this;

  return function(err, headers, res) {
    var rc;
    if (err) rc = err.httpCode;
    else if (res) rc = res.statusCode;
    else rc = -1;

    log.debug('CloudAPI.%s(%s): status=%d, err=%s, obj=%o, headers=%o',
              name, req.path, rc, err, headers);

    if (err)
      return callback(self._error(err));

    return callback();
  };
};


CloudAPI.prototype._request = function(path, body) {
  assert.ok(path);

  var now = restify.httpDate();
  var authz;
  if (this.basicAuth) {
    authz = this.basicAuth;
  } else {
    var signer = crypto.createSign('RSA-SHA256');
    signer.update(now);
    authz = sprintf(SIGNATURE,
                    this.keyId,
                    'rsa-sha256',
                    signer.sign(this.key, 'base64'));
  }

  var obj = {
    path: path,
    headers: {
      Authorization: authz,
      Date: now
    },
  };
  if (body)
    obj.body = body;

  return obj;
};



///--- Exports

module.exports = CloudAPI;
