// Copyright 2011 Joyent, Inc.  All rights reserved.

var assert = require('assert');
var crypto = require('crypto');

var createCache = require('lru-cache');
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
var PACKAGES = ROOT + '/packages';
var PACKAGE = PACKAGES + '/%s';
var DATASETS = ROOT + '/datasets';
var DATASET = DATASETS + '/%s';



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

  options.contentType = 'application/json';

  this.client = restify.createClient(options);

  // Try to use RSA Signing over BasicAuth
  if (options.key) {
    this.keyId = options.keyId;
    this.key = options.key;
  } else {
    this.basicAuth = utils.basicAuth(options.username, options.password);
  }

  // Initialize the cache
  if (!options.noCache) {
    this.cacheSize = options.cacheSize || 1000;
    this.cacheExpiry = (options.cacheExpiry || 60) * 1000;
    this.cache = createCache(this.cacheSize);
  }

}


/**
 * Looks up your account record.
 *
 * Returns an object.
 *
 * @param {String} account (optional) the login name of the account.
 * @param {Function} callback of the form f(err, account).
 * @param {Boolean} noCache optional flag to force skipping the cache.
 * @throws {TypeError} on bad input.
 */
CloudAPI.prototype.getAccount = function(account, callback, noCache) {
  if (typeof(account) === 'function') {
    callback = account;
    account = this.account;
  }
  if (!callback || typeof(callback) !== 'function')
    throw new TypeError('callback (function) required');

  var self = this;
  var req = this._request(sprintf(ROOT, account));

  return this._get(req, callback, noCache);
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
  return this._post(req, callback);
}
CloudAPI.prototype.CreateKey = CloudAPI.prototype.createKey;


/**
 * Lists all SSH keys on file for your account.
 *
 * Returns an array of objects.
 *
 * @param {String} account (optional) the login name of the account.
 * @param {Function} callback of the form f(err, keys).
 * @param {Boolean} noCache optional flag to force skipping the cache.
 * @throws {TypeError} on bad input.
 */
CloudAPI.prototype.listKeys = function(account, callback, noCache) {
  if (typeof(account) === 'function') {
    callback = account;
    account = this.account;
  }
  if (!callback || typeof(callback) !== 'function')
    throw new TypeError('callback (function) required');

  var req = this._request(sprintf(KEYS, account));
  return this._get(req, callback, noCache);
}
CloudAPI.prototype.ListKeys = CloudAPI.prototype.listKeys;


/**
 * Retrieves an SSH key from your account.
 *
 * Returns a JS object.
 *
 * @param {String} account (optional) the login name of the account.
 * @param {String} key can be either the string name of the key, or the object
 *                 returned from create/get.
 * @param {Function} callback of the form f(err, key).
 * @param {Boolean} noCache optional flag to force skipping the cache.
 * @throws {TypeError} on bad input.
 */
CloudAPI.prototype.getKey = function(account, key, callback, noCache) {
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
  return this._get(req, callback, noCache);
}
CloudAPI.prototype.GetKey = CloudAPI.prototype.getKey;


/**
 * Deletes an SSH key from your account.
 *
 * @param {String} account (optional) the login name of the account.
 * @param {String} key can be either the string name of the key, or the object
 *                 returned from create/get.
 * @param {Function} callback of the form f(err).
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
  return this._del(req, callback);
};
CloudAPI.prototype.DeleteKey = CloudAPI.prototype.deleteKey;


/**
 * Lists all packages available to your account.
 *
 * Returns an array of objects.
 *
 * @param {String} account (optional) the login name of the account.
 * @param {Function} callback of the form f(err, packages).
 * @param {Boolean} noCache optional flag to force skipping the cache.
 * @throws {TypeError} on bad input.
 */
CloudAPI.prototype.listPackages = function(account, callback, noCache) {
  if (typeof(account) === 'function') {
    callback = account;
    account = this.account;
  }
  if (!callback || typeof(callback) !== 'function')
    throw new TypeError('callback (function) required');

  var req = this._request(sprintf(PACKAGES, account));
  return this._get(req, callback, noCache);
};
CloudAPI.prototype.ListPackages = CloudAPI.prototype.listPackages;


/**
 * Retrieves a single package available to your account.
 *
 * Returns a JS object.
 *
 * @param {String} account (optional) the login name of the account.
 * @param {String} pkg can be either the string name of the package, or an
 *                 object returned from listPackages.
 * @param {Function} callback of the form f(err, package).
 * @param {Boolean} noCache optional flag to force skipping the cache.
 * @throws {TypeError} on bad input.
 */
CloudAPI.prototype.getPackage = function(account, pkg, callback, noCache) {
  if (typeof(pkg) === 'function') {
    callback = pkg;
    pkg = account;
    account = this.account;
  }
  if (!pkg || (typeof(pkg) !== 'object' && typeof(pkg) !== 'string'))
    throw new TypeError('key (object|string) required');
  if (!callback || typeof(callback) !== 'function')
    throw new TypeError('callback (function) required');

  var name = (typeof(pkg) === 'object' ? pkg.name : pkg);
  var req = this._request(sprintf(PACKAGE, account, name));
  return this._get(req, callback, noCache);
}
CloudAPI.prototype.GetPackage = CloudAPI.prototype.getPackage;



/**
 * Lists all datasets available to your account.
 *
 * Returns an array of objects.
 *
 * @param {String} account (optional) the login name of the account.
 * @param {Function} callback of the form f(err, datasets).
 * @param {Boolean} noCache optional flag to force skipping the cache.
 * @throws {TypeError} on bad input.
 */
CloudAPI.prototype.listDatasets = function(account, callback, noCache) {
  if (typeof(account) === 'function') {
    callback = account;
    account = this.account;
  }
  if (!callback || typeof(callback) !== 'function')
    throw new TypeError('callback (function) required');

  var req = this._request(sprintf(DATASETS, account));
  return this._get(req, callback, noCache);
};
CloudAPI.prototype.ListDatasets = CloudAPI.prototype.listDatasets;


/**
 * Retrieves a single dataset available to your account.
 *
 * Returns a JS object.
 *
 * @param {String} account (optional) the login name of the account.
 * @param {String} dataset can be either the string name of the dataset, or an
 *                 object returned from listDatasets.
 * @param {Function} callback of the form f(err, package).
 * @param {Boolean} noCache optional flag to force skipping the cache.
 * @throws {TypeError} on bad input.
 */
CloudAPI.prototype.getDataset = function(account, dataset, callback, noCache) {
  if (typeof(dataset) === 'function') {
    callback = dataset;
    dataset = account;
    account = this.account;
  }
  if (!dataset || (typeof(dataset) !== 'object' && typeof(dataset) !== 'string'))
    throw new TypeError('key (object|string) required');
  if (!callback || typeof(callback) !== 'function')
    throw new TypeError('callback (function) required');

  var name = (typeof(dataset) === 'object' ? dataset.id : dataset);
  var req = this._request(sprintf(DATASET, account, name));
  return this._get(req, callback, noCache);
}
CloudAPI.prototype.GetDataset = CloudAPI.prototype.getDataset;



///--- Private Functions

CloudAPI.prototype._error = function(err) {
  if (err && (err.name === 'HttpError')) {
    var e = new Error();
    e.name = 'CloudApiError';
    e.code = err.details.object.code;
    e.message = err.details.object.message;
    return e;
  }

  return err;
};


CloudAPI.prototype._get = function(req, callback, noCache) {
  assert.ok(req);
  assert.ok(callback);

  var self = this;

  // Check the cache first
  if (!noCache) {
    var cached = this._cacheGet(req.path);
    if (cached) {
      if (cached instanceof Error)
        return callback(cached);

      return callback(null, cached);
    }
  }

  // Issue HTTP request
  return this.client.get(req, function(err, obj, headers) {
    if (err)
      err = self._error(err);

    if (obj)
      self._cachePut(req.path, obj);

    log.debug('CloudAPI._get(%s) -> err=%o, obj=%o', req.path, err, obj);
    return callback(err, obj);
  });
};


CloudAPI.prototype._post = function(req, callback) {
  assert.ok(req);
  assert.ok(callback);

  var self = this;

  // Issue HTTP request
  return this.client.post(req, function(err, obj, headers) {
    if (err)
      err = self._error(err);

    log.debug('CloudAPI._post(%s) -> err=%o, obj=%o', req.path, err, obj);
    return callback(err, obj);
  });
};


CloudAPI.prototype._del = function(req, callback) {
  assert.ok(req);
  assert.ok(callback);

  var self = this;

  // Issue HTTP request
  return this.client.del(req, function(err, headers) {
    if (err) {
      err = self._error(err);
    } else {
      self._cachePut(req.path, null);
    }

    log.debug('CloudAPI._del(%s) -> err=%o', req.path, err);
    return callback(err);
  });
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


CloudAPI.prototype._cachePut = function(key, value) {
  assert.ok(key);

  if (!this.cache)
    return false;

  if (value === null) {
    // Do a purge
    log.debug('CloudAPI._cachePut(%s): purging', key);
    return this.cache.set(key, null);
  }

  var obj = {
    value: value,
    ctime: new Date().getTime()
  };
  log.debug('CloudAPI._cachePut(%s): writing %o', key, obj);
  this.cache.set(key, obj);
  return true;
};


CloudAPI.prototype._cacheGet = function(key) {
  assert.ok(key);

  if (!this.cache)
    return null;

  var obj = this.cache.get(key);
  if (obj) {
    assert.ok(obj.ctime);
    assert.ok(obj.value);
    var now = new Date().getTime();
    if ((now - obj.ctime) <= this.cacheExpiry) {
      log.debug('CloudAPI._cacheGet(%s): cache hit => %o', key, obj);
      return obj.value;
    }
  }

  log.debug('CloudAPI._cacheGet(%s): cache miss', key);
  return null;
};



///--- Exports

module.exports = CloudAPI;
