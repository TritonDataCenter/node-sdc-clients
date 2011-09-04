// Copyright 2011 Joyent, Inc.  All rights reserved.

var assert = require('assert');

var LRU = require('lru-cache');
var restify = require('restify');
var sprintf = require('sprintf').sprintf;

var utils = require('./utils');

///--- Globals

var HttpCodes = restify.HttpCodes;
var RestCodes = restify.RestCodes;
var log = restify.log;
var newError = restify.newError;

var CUST_FMT = '/customers/%s';
var ZONE_FMT = CUST_FMT + '/zones/%s';
var ZONE_ACTION_FMT = ZONE_FMT + '/%s';
var ZONE_SNAPSHOTS_FMT = ZONE_FMT + '/zfs_snapshots';
var ZONE_SNAPSHOT_FMT = ZONE_SNAPSHOTS_FMT + '/%s';
var ZONE_SNAPSHOT_BOOT_FMT = ZONE_SNAPSHOTS_FMT + '/%s/boot';
var ZONE_TAGS_FMT = ZONE_FMT + '/tags';
var ZONE_TAG_FMT = ZONE_TAGS_FMT + '/%s';
var ZONE_USAGE_FMT = ZONE_FMT + '/usage/%s';

var VM_FMT = CUST_FMT + '/vms/%s';
var VM_ACTION_FMT = VM_FMT + '/%s';
var VM_TAGS_FMT = VM_FMT + '/tags';
var VM_TAG_FMT = VM_TAGS_FMT + '/%s';

var ANONYMOUS = '__anonymous';
var LIST_CACHE_KEY = '__list';


///--- Exported MAPI Client

/**
 * Constructor
 *
 * Note that in options you can pass in any parameters that the restify
 * RestClient constructor takes (for example retry/backoff settings).
 *
 * @param {Object} options parameters of the usual form:
 *                  - username {String} admin name to MAPI.
 *                  - password {String} password to said admin.
 *                  - url {String} MAPI location.
 */
function MAPI(options) {
  if (!options) throw new TypeError('options required');
  if (!options.username) throw new TypeError('options.username required');
  if (!options.password) throw new TypeError('options.password required');
  if ((options.uri && options.url) ||
      !(options.uri || options.url))
    throw new TypeError('One of options.uri, options.url required');

  if (options.uri) options.url = options.uri;
  if (!options.headers) options.headers = {};

  if (options.logLevel) log.level(options.logLevel);

  options.contentType = 'application/x-www-form-urlencoded';
  options.headers.Authorization =
    utils.basicAuth(options.username, options.password);
  options.headers['X-Joyent-Full-Error-Messages'] = 'true';

  options.retryCallback = function(code) {
    return (code >= 503);
  };

  this.client = restify.createClient(options);

  // In-memory caches
  this.pkgCacheSize = 100; // 100 records
  this.pkgCacheExpiry = 300 * 1000; // 5m
  if (options.pkgCache) {
    this.pkgCacheSize = options.pkgCache.size;
    this.pkgCacheExpiry = options.pkgCache.expiry * 1000;
  }
  this.pkgCache = LRU(this.pkgCacheSize);

  this.datasetCacheSize = 100; // 100 records
  this.datasetCacheExpiry = 300 * 1000; // 5m
  if (options.datasetCache) {
    this.datasetCacheSize = options.datasetCache.size;
    this.datasetCacheExpiry = options.datasetCache.expiry * 1000;
  }
  this.datasetCache = LRU(this.datasetCacheSize);
}


/**
 * Lists all the networks available in MAPI.
 *
 * Note that MAPI currently only has a /networks
 *
 * @param {String} customer the CAPI customer uuid.
 * @param {Object} options optional parameters for listing (TODO).
 * @param {Function} callback of the form f(err, datasets).
 */
MAPI.prototype.listNetworks = function(customer, options, callback) {
  if (!customer) throw new TypeError('customer is required');
  if (!options) throw new TypeError('callback is required (function');
  if (typeof(options) === 'function') {
    callback = options;
    options = null;
  } else if (typeof(options) !== 'object') {
    throw new TypeError('options must be an object');
  }
  if (!callback || typeof(callback) !== 'function')
    throw new TypeError('callback is required (function)');

  var self = this;
  this.client.get('/networks', function(err, networks) {
    if (err) {
      var e = self._translateError(err);
      return callback(e);
    }

    return callback(null, networks);
  });
};


/**
 * Lists all the datasets available in MAPI for the given
 * tenant.
 *
 * @param {String} customer the CAPI customer uuid.
 * @param {Object} options optional parameters for listing (TODO).
 * @param {Function} callback of the form f(err, datasets).
 */
MAPI.prototype.listDatasets = function(customer, options, callback) {
  if (!customer) throw new TypeError('customer is required');
  if (!options) throw new TypeError('callback is required (function');
  if (typeof(options) === 'function') {
    callback = options;
    options = null;
  } else if (typeof(options) !== 'object') {
    throw new TypeError('options must be an object');
  }
  if (!callback || typeof(callback) !== 'function')
    throw new TypeError('callback is required (function)');

  // Check the local cache first
  var cached = this._datasetCacheGet(customer, LIST_CACHE_KEY);
  if (cached) {
    if (!cached.found)
      return callback(cached.message);

    return callback(null, cached.message);
  }
  // End Cache Check

  var self = this;
  var request = {
    path: sprintf(CUST_FMT + '/datasets', customer),
    expect: [200, 204],
    headers: {
      User: customer
    }
  };
  this.client.get(request, function(err, datasets) {
    if (err) {
      var e = self._translateError(err);
      self._datasetCachePut(customer, LIST_CACHE_KEY, e);
      return callback(e);
    }

    self._datasetCachePut(customer, LIST_CACHE_KEY, datasets);
    return callback(null, datasets);
  });
};


/**
 * Returns a dataset by uuid.
 *
 * @param {String} customer the CAPI customer uuid.
 * @param {String} dataset the dataset uuid.
 * @param {Function} callback of the form f(err, dataset).
 */
MAPI.prototype.getDataset = function(customer, dataset, callback) {
  if (!customer) throw new TypeError('customer is required');
  if (!dataset) throw new TypeError('dataset is required');
  if (!callback || typeof(callback) !== 'function')
    throw new TypeError('callback is required (function)');

  // Check the local cache first
  var cached = this._datasetCacheGet(customer, dataset);
  if (cached) {
    if (!cached.found)
      return callback(cached.message);

    return callback(null, cached.message);
  }
  // End Cache Check

  var self = this;
  var request = {
    path: sprintf(CUST_FMT + '/datasets/%s', customer, dataset),
    expect: [200, 204],
    headers: {
      User: customer
    }
  };
  this.client.get(request, function(err, obj, headers) {
    var e;
    if (err) {
      e = self._translateError(err);
      self._datasetCachePut(customer, dataset, e);
      return callback(e);
    }

    if (!obj) {
      e = newError({
        httpCode: HttpCodes.NotFound,
        restCode: RestCodes.ResourceNotFound,
        message: 'dataset ' + dataset + ' not found.'
      });
      self._datasetCachePut(customer, name, e);
      return callback(e);
    }

    self._datasetCachePut(customer, dataset, obj);
    return callback(null, obj);
  });
};


/**
 * Lists packages available to a tenant.
 *
 * @param {String} customer the CAPI customer uuid.
 * @param {Object} options optional parameters for listing (TODO).
 * @param {Function} callback of the form f(err, packages).
 */
MAPI.prototype.listPackages = function(customer, options, callback) {
  if (!customer) throw new TypeError('customer is required');
  if (!options) throw new TypeError('callback is required (function');
  if (typeof(options) === 'function') {
    callback = options;
    options = null;
  } else if (typeof(options) !== 'object') {
    throw new TypeError('options must be an object');
  }
  if (!callback || typeof(callback) !== 'function')
    throw new TypeError('callback is required (function)');

  // Check the local cache first
  var cached = this._pkgCacheGet(customer, LIST_CACHE_KEY);
  if (cached) {
    if (!cached.found)
      return callback(cached.message);

    return callback(null, cached.message);
  }
  // End Cache Check

  var self = this;
  var request = {
    path: sprintf(CUST_FMT + '/packages', customer),
    expect: [200, 204],
    headers: {
      User: customer
    }
  };
  this.client.get(request, function(err, packages) {
    if (err) {
      var e = self._translateError(err);
      self._pkgCachePut(customer, LIST_CACHE_KEY, e);
      return callback(e);
    }

    self._pkgCachePut(customer, LIST_CACHE_KEY, packages || []);
    return callback(null, packages);
  });
};


/**
 * Gets a package by name for a tenant.
 *
 * @param {String} customer the CAPI customer uuid.
 * @param {String} name of the package.
 * @param {Function} callback of the form f(err, pkg).
 */
MAPI.prototype.getPackageByName = function(customer, name, callback) {
  if (!customer) throw new TypeError('customer is required');
  if (!name) throw new TypeError('name is required');
  if (!callback || typeof(callback) !== 'function')
    throw new TypeError('callback is required (function)');

  // Check the local cache first
  var cached = this._pkgCacheGet(customer, name);
  if (cached) {
    if (!cached.found)
      return callback(cached.message);

    return callback(null, cached.message);
  }
  // End Cache Check

  var self = this;
  var request = {
    path: sprintf(CUST_FMT + '/packages/%s', customer, name),
    expect: [200, 204],
    headers: {
      'X-Joyent-Find-With': 'name',
      User: customer
    }
  };
  return this.client.get(request, function(err, obj, headers) {
    var e;
    if (err) {
      e = self._translateError(err);
      self._pkgCachePut(customer, name, e);
      return callback(e);
    }

    if (!obj) {
      e = newError({
        httpCode: HttpCodes.NotFound,
        restCode: RestCodes.ResourceNotFound,
        message: 'package ' + name + ' not found.'
      });
      self._pkgCachePut(customer, name, e);
      return callback(e);
    }

    self._pkgCachePut(customer, name, obj);
    return callback(null, obj);
  });
};


/**
 * Counts the number of zones for a given customer.
 *
 * Note this can include transitioning/destroyed zones using the
 * options.allZone parameter.
 *
 * @param {String} customer the CAPI customer uuid.
 * @param {Object} options optional object with:
 *                   - allZones: whether or not to include
 *                               transitioning/destroyed zones.
 * @param {Function} callback of the form f(err, zones).
 */
MAPI.prototype.countZones = function(customer, options, callback) {
  return this.listZones(customer, options, callback, true);
};


/**
 * Lists all zones in MAPI for a given customer.
 *
 * Note that this API can return `all` zones, regardless of what state they
 * are in, or whether they were destroyed by using the `allZones` options
 * parameter. Additionally, you can pass in the limit/offset settings into the
 * options object.  Use `countZones` to figure out how many zones there are.
 *
 * @param {String} customer the CAPI customer uuid.
 * @param {Object} options optional object with:
 *                   - limit: MAPI query limit.
 *                   - offset: starting point for this query.
 *                   - all: whether or not to include
 *                          transitioning/destroyed zones.
 * @param {Function} callback of the form f(err, zones, headers).
 * @param {Boolean} headOnly HEAD instead of GET (optional, default false).
 */
MAPI.prototype.listZones = function(customer, options, callback, headOnly) {
  if (!customer) throw new TypeError('customer is required');
  if (!options) throw new TypeError('callback is required (function');
  if (typeof(options) === 'function') {
    callback = options;
    options = null;
  } else if (typeof(options) !== 'object') {
    throw new TypeError('options must be an object');
  }
  if (!callback || typeof(callback) !== 'function')
    throw new TypeError('callback is required (function)');


  var request = {
    path: sprintf(CUST_FMT + '/zones', customer),
    expect: [200, 204],
    headers: {
      User: customer
    },
    query: options
  };
  if (options && (options.allZones || options.all)) {
    request.headers['X-Joyent-Ignore-Provisioning-State'] = 'true';

    // Strip these off the query string.
    if (options.allZones)
      delete options.allZones;
    if (options.all)
      delete options.all;
  }

  var list = this.client.get;
  if (headOnly)
    list = this.client.head;

  var self = this;
  return list.call(this.client, request, function(err, obj, headers) {
    if (err)
      return callback(self._translateError(err));

    if (headOnly) {
      headers = obj;
      obj = null;
    }
    if (!obj || !obj.length)
      obj = [];

    return callback(null, obj, headers);
  });
};


/**
 * Retrives a particular zone by alias.
 *
 * Note this call will return the zone regardless of what state it is in,
 * including if it's destroyed, so check the state.
 *
 * @param {String} customer the CAPI customer uuid.
 * @param {String} alias the zone alias.
 * @param {Function} callback of the form f(err, zone).
 */
MAPI.prototype.getZoneByAlias = function(customer, alias, callback) {
  if (!customer) throw new TypeError('customer is required');
  if (!alias) throw new TypeError('alias is required');
  if (!callback || typeof(callback) !== 'function')
    throw new TypeError('callback is required (function)');

  var self = this;
  var request = {
    path: sprintf(ZONE_FMT, customer, alias),
    expect: [200, 204, 410],
    headers: {
      'x-joyent-ignore-provisioning-state': true,
      'x-joyent-find-with': 'alias',
      User: customer
    }
  };

  return this.client.get(request, function(err, obj, headers) {
    if (err) return callback(self._translateError(err));

    if (!obj) {
      return callback(newError({
        httpCode: HttpCodes.NotFound,
        restCode: RestCodes.ResourceNotFound,
        message: alias + ' does not exist.'
      }));
    }

    return callback(null, obj);
  });
};


/**
 * Retrives a particular zone by name (uuid).
 *
 * Note this call will return the zone regardless of what state it is in,
 * including if it's destroyed, so check the state.
 *
 * @param {String} customer the CAPI customer uuid.
 * @param {String} zone the zone name (uuid).
 * @param {Function} callback of the form f(err, zone).
 */
MAPI.prototype.getZone = function(customer, zone, callback) {
  if (!customer) throw new TypeError('customer is required');
  if (!zone) throw new TypeError('zone is required');
  if (!callback || typeof(callback) !== 'function')
    throw new TypeError('callback is required (function)');

  var self = this;
  var request = {
    path: sprintf(ZONE_FMT, customer, zone),
    expect: [200, 204, 410],
    headers: {
      'x-joyent-ignore-provisioning-state': true,
      'x-joyent-find-with': 'name',
      User: customer
    }
  };

  return this.client.get(request, function(err, obj, headers) {
    if (err) return callback(self._translateError(err));

    if (!obj) {
      return callback(newError({
        httpCode: HttpCodes.NotFound,
        restCode: RestCodes.ResourceNotFound,
        message: alias + ' does not exist.'
      }));
    }

    return callback(null, obj);
  });
};


/**
 * Gets the usage data for a zone.
 *
 * @param {String} customer capi uuid.
 * @param {String} zone the zone uuid.
 * @param {String} period the YYYY-MM date param to fetch usage for.
 * @param {Function} callback of the form f(err, usage).
 */
MAPI.prototype.getZoneUsage = function(customer, zone, period, callback) {
  if (!customer) throw new TypeError('customer is required');
  if (!zone) throw new TypeError('zone is required');
  if (!period) throw new TypeError('period is required');
  if (!callback || typeof(callback) !== 'function')
    throw new TypeError('callback is required (function)');

  var self = this;
  var request = {
    path: sprintf(ZONE_USAGE_FMT, customer, zone, period),
    expect: [200, 204, 410],
    headers: {
      'x-joyent-ignore-provisioning-state': true,
      User: customer
    }
  };

  return this.client.get(request, function(err, usage) {
    if (err) return callback(self._translateError(err));

    if (!usage) {
      return callback(newError({
        httpCode: HttpCodes.NotFound,
        restCode: RestCodes.ResourceNotFound,
        message: zone + '/' + period + ' does not exist'}));
    }

    return callback(null, usage);
  });
};



/**
 * Gets the usage data for a customer.
 *
 * @param {String} customer capi uuid.
 * @param {String} period the YYYY-MM date param to fetch usage for.
 * @param {Function} callback of the form f(err, usage).
 */
MAPI.prototype.getUsage = function(customer, period, callback) {
  if (!customer) throw new TypeError('customer is required');
  if (!period) throw new TypeError('period is required');
  if (!callback || typeof(callback) !== 'function')
    throw new TypeError('callback is required (function)');

  var self = this;
  var request = {
    path: sprintf(CUST_FMT + '/usage/%s', customer, period),
    expect: [200, 204, 410],
    headers: {
      User: customer
    }
  };

  return this.client.get(request, function(err, usage) {
    if (err) return callback(self._translateError(err));

    if (!usage) {
      return callback(newError({
        httpCode: HttpCodes.NotFound,
        restCode: RestCodes.ResourceNotFound,
        message: zone + '/' + period + ' does not exist'}));
    }

    return callback(null, usage);
  });
};


/**
 * Provisions a new zone in MAPI.
 *
 * Options, while MAPI docs are authoritative, generally contain:
 *  - dataset: the dataset uuid.
 *  - package: the package to provision with.
 *  - alias: the name you want on the machine.
 *  - hostname: the hostname to assign.
 *
 * Note this API, after creating, will turn around and retrieve the zone
 * for you, so transitions are unnecessary.
 *
 * @param {String} customer the CAPI customer uuid.
 * @param {Object} options the creation options (see MAPI docs).
 * @param {Object} tags (optional) tags to assign the new machine.
 * @param {Function} callback of the form f(err, zone).
 */
MAPI.prototype.createZone = function(customer, options, tags, callback) {
  if (!customer) throw new TypeError('customer is required');
  if (!options || typeof(options) !== 'object')
    throw new TypeError('options is required (object)');
  if (typeof(tags) === 'function') {
    callback = tags;
    tags = {};
  }
  if (typeof(tags) !== 'object')
    throw new TypeError('tags must be an object');
  if (!callback || typeof(callback) !== 'function')
    throw new TypeError('callback is required (function)');

  options.owner_uuid = customer;

  for (var k in tags) {
    if (tags.hasOwnProperty(k)) {
      options['tag.' + k] = tags[k];
    }
  }

  var self = this;
  var request = {
    path: sprintf(CUST_FMT + '/zones', customer),
    expect: [200, 201, 202],
    body: options,
    headers: {
      User: customer
    }
  };

  return this.client.post(request, function(err, obj, headers) {
    if (err) return callback(self._translateError(err));

    var transition = headers['x-joyent-transition-uri'];
    if (!transition) {
      log.warn('MAPI.createZone(%s): No Transition returned from MAPI',
               customer);
      return callback(newError());
    }

    var zoneid = transition.substr(transition.lastIndexOf('/') + 1);
    self.getZone(customer, zoneid, function(err, zone) {
      if (err) return callback(self._translateError(err));

      return callback(null, zone);
    });
  });
};


/**
 * Lists tags on a zone.
 *
 * @param {String} customer the CAPI uuid.
 * @param {String} zone the zone name.
 * @param {Function} callback of the form f(err, tags).
 */
MAPI.prototype.listZoneTags = function(customer, zone, callback) {
  if (!customer) throw new TypeError('customer is required');
  if (!zone) throw new TypeError('zone is required');
  if (!callback || typeof(callback) !== 'function')
    throw new TypeError('callback is required (function)');

  var self = this;
  var request = {
    path: sprintf(ZONE_TAGS_FMT, customer, zone),
    headers: {
      'x-joyent-ignore-provisioning-state': true,
      User: customer
    },
    expect: [200, 204, 410]
  };

  this.client.get(request, function(err, obj, headers) {
    if (err) return callback(self._translateError(err));

    return callback(null, obj);
  });
};


/**
 * Gets a tag on a zone.
 *
 * @param {String} customer the CAPI uuid.
 * @param {String} zone the zone name.
 * @param {String} tag the tag name.
 * @param {Function} callback of the form f(err, tags).
 */
MAPI.prototype.getZoneTag = function(customer, zone, tag, callback) {
  if (!customer) throw new TypeError('customer is required');
  if (!zone) throw new TypeError('zone is required');
  if (!tag) throw new TypeError('tag is required');
  if (!callback || typeof(callback) !== 'function')
    throw new TypeError('callback is required (function)');

  var self = this;
  var request = {
    path: sprintf(ZONE_TAG_FMT, customer, zone, tag),
    headers: {
      'x-joyent-ignore-provisioning-state': true,
      User: customer
    },
    expect: [200, 204, 410]
  };

  this.client.get(request, function(err, obj, headers) {
    if (err) return callback(self._translateError(err));

    return callback(null, obj);
  });
};


/**
 * Add tags to a zone.
 *
 * @param {String} customer the CAPI uuid.
 * @param {String} zone the zone name.
 * @param {Object} tags object (name: value).
 * @param {Function} callback of the form f(err).
 */
MAPI.prototype.addZoneTags = function(customer, zone, tags, callback) {
  if (!customer) throw new TypeError('customer is required');
  if (!zone) throw new TypeError('zone is required');
  if (!tags || typeof(tags) !== 'object')
    throw new TypeError('tags is required (object)');
  if (!callback || typeof(callback) !== 'function')
    throw new TypeError('callback is required (function)');

  var self = this;

  var _tags = {};
  for (var k in tags) {
    if (tags.hasOwnProperty(k)) {
      _tags['tag.' + k] = tags[k];
    }
  }

  var request = {
    path: sprintf(ZONE_TAGS_FMT, customer, zone),
    headers: {
      'x-joyent-ignore-provisioning-state': true,
      User: customer
    },
    body: _tags,
    expect: [200, 201, 202, 204, 410]
  };

  this.client.post(request, function(err, obj, headers) {
    if (err) return callback(self._translateError(err));

    return callback(null, obj);
  });
};


/**
 * Deletes a single tag from a zone.
 *
 * @param {String} customer the CAPI uuid.
 * @param {String} zone the zone name.
 * @param {String} tag tag name without the leading 'tag.'.
 * @param {Function} callback of the form f(err).
 */
MAPI.prototype.deleteZoneTag = function(customer, zone, tag, callback) {
  if (!customer) throw new TypeError('customer is required');
  if (!zone) throw new TypeError('zone is required');
  if (!tag) throw new TypeError('tag is required');
  if (!callback || typeof(callback) !== 'function')
    throw new TypeError('callback is required (function)');

  var self = this;
  var request = {
    path: sprintf(ZONE_TAG_FMT, customer, zone, tag),
    headers: {
      'x-joyent-ignore-provisioning-state': true,
      User: customer
    },
    expect: [200, 204, 410]
  };

  this.client.del(request, function(err, obj, headers) {
    if (err) return callback(self._translateError(err));

    return callback();
  });
};


/**
 * Deletes all tags from a zone.
 *
 * @param {String} customer the CAPI uuid.
 * @param {String} zone the zone name.
 * @param {Function} callback of the form f(err).
 */
MAPI.prototype.deleteZoneTags = function(customer, zone, callback) {
  if (!customer) throw new TypeError('customer is required');
  if (!zone) throw new TypeError('zone is required');
  if (!callback || typeof(callback) !== 'function')
    throw new TypeError('callback is required (function)');

  var self = this;
  var request = {
    path: sprintf(ZONE_TAGS_FMT, customer, zone),
    headers: {
      'x-joyent-ignore-provisioning-state': true,
      User: customer
    },
    expect: [200, 202, 204, 410]
  };

  this.client.del(request, function(err, obj, headers) {
    if (err) return callback(self._translateError(err));

    return callback();
  });
};


/**
 * Shutdown a zone.
 *
 * @param {String} customer the CAPI customer uuid.
 * @param {String} zone the zone name.
 * @param {Function} callback of the form f(err).
 */
MAPI.prototype.shutdownZone = function(customer, zone, callback) {
  if (!customer) throw new TypeError('customer is required');
  if (!zone) throw new TypeError('zone is required');
  if (!callback || typeof(callback) !== 'function')
    throw new TypeError('callback is required (function)');

  var self = this;
  var request = {
    path: sprintf(ZONE_ACTION_FMT, customer, zone, 'shutdown'),
    headers: {
      'x-joyent-ignore-provisioning-state': true,
      User: customer
    },
    expect: [200, 202, 204, 410]
  };

  this.client.put(request, function(err, obj, headers) {
    if (err) return callback(self._translateError(err));

    return callback();
  });
};


/**
 * Startup a zone.
 *
 * @param {String} customer the CAPI customer uuid.
 * @param {String} zone the zone name.
 * @param {Function} callback of the form f(err).
 */
MAPI.prototype.startupZone = function(customer, zone, callback) {
  if (!customer) throw new TypeError('customer is required');
  if (!zone) throw new TypeError('zone is required');
  if (!callback || typeof(callback) !== 'function')
    throw new TypeError('callback is required (function)');

  var self = this;
  var request = {
    path: sprintf(ZONE_ACTION_FMT, customer, zone, 'startup'),
    headers: {
      'x-joyent-ignore-provisioning-state': true,
      User: customer
    },
    expect: [200, 202, 204, 410]
  };

  this.client.put(request, function(err, obj, headers) {
    if (err) return callback(self._translateError(err));

    return callback();
  });
};


/**
 * Reboot a zone.
 *
 * @param {String} customer the CAPI customer uuid.
 * @param {String} zone the zone name.
 * @param {Function} callback of the form f(err).
 */
MAPI.prototype.rebootZone = function(customer, zone, callback) {
  if (!customer) throw new TypeError('customer is required');
  if (!zone) throw new TypeError('zone is required');
  if (!callback || typeof(callback) !== 'function')
    throw new TypeError('callback is required (function)');

  var self = this;
  var request = {
    path: sprintf(ZONE_ACTION_FMT, customer, zone, 'reboot'),
    headers: {
      'x-joyent-ignore-provisioning-state': true,
      User: customer
    },
    expect: [200, 202, 410]
  };

  this.client.put(request, function(err, obj, headers) {
    if (err) return callback(self._translateError(err));

    return callback();
  });
};


/**
 * Resizes a zone.
 *
 * @param {String} customer capi uuid.
 * @param {String} zone zone uuid.
 * @param {String} options object with the new resize params (see MAPI docs):
 *                   - {Number} ram the new memory size.
 *                   - {Number} cpu_shares the new CPU shares.
 *                   - {Number} cpu_cap the new CPU cap.
 *                   - {String} package the new package name.
 * @param {Function} callback of the form f(err).
 */
MAPI.prototype.resizeZone = function(customer, zone, options, callback) {
  if (!customer) throw new TypeError('customer is required');
  if (!zone) throw new TypeError('zone is required');
  if (!options || typeof(options) !== 'object')
    throw new TypeError('options is required (object)');
  if (!callback || typeof(callback) !== 'function')
    throw new TypeError('callback is required (function)');

  var self = this;
  var request = {
    path: sprintf(ZONE_ACTION_FMT, customer, zone, 'resize'),
    headers: {
      'x-joyent-ignore-provisioning-state': true,
      User: customer
    },
    body: options,
    expect: [200, 202, 410]
  };

  this.client.put(request, function(err, obj, headers) {
    if (err) return callback(self._translateError(err));

    return callback();
  });
};


/**
 * Deletes a zone.
 *
 * @param {String} customer capi uuid.
 * @param {String} zone zone alias.
 */
MAPI.prototype.deleteZone = function(customer, zone, callback) {
  if (!customer) throw new TypeError('customer is required');
  if (!zone) throw new TypeError('zone is required');
  if (!callback || typeof(callback) !== 'function')
    throw new TypeError('callback is required (function)');

  var self = this;
  var request = {
    path: sprintf(ZONE_FMT, customer, zone),
    headers: {
      'x-joyent-ignore-provisioning-state': true,
      User: customer
    },
    expect: [200, 202, 204, 410]
  };

  this.client.del(request, function(err, obj, headers) {
    if (err) return callback(self._translateError(err));

    return callback();
  });
};


/**
 * Takes a snapshot of a zone.
 *
 * @param {String} customer capi uuid.
 * @param {String} zone zone uuid.
 * @param {Object} options (optional) object:
 *                  - {String} snapshot_name obvious.
 * @param {Function} callback of the form f(err, id).
 */
MAPI.prototype.createZoneSnapshot = function(customer,
                                             zone,
                                             options,
                                             callback) {

  if (!customer) throw new TypeError('customer is required');
  if (!zone) throw new TypeError('zone is required');
  if (!options || typeof(options) !== 'object')
    throw new TypeError('options is required (object)');
  if (!callback || typeof(callback) !== 'function')
    throw new TypeError('callback is required (function)');

  // Send a dummy param, in case the object was empty. Nginx is a pita.
  options.a = 'b';

  var self = this;
  var request = {
    path: sprintf(ZONE_SNAPSHOTS_FMT, customer, zone),
    headers: {
      'x-joyent-ignore-provisioning-state': true,
      User: customer
    },
    expect: [202, 410],
    body: options
  };

  this.client.post(request, function(err, obj, headers) {
    if (err) return callback(self._translateError(err));

    var location = headers.location;
    if (!location) {
      log.warn('MAPI.snapshotZone(z=%s): No Location returned from MAPI', zone);
      return callback(newError());
    }

    var id = location.substr(location.lastIndexOf('/') + 1);

    return callback(null, id, headers);
  });
};


/**
 * Lists all snapshots for a zone.
 *
 * @param {String} customer capi uuid.
 * @param {String} zone zone uuid.
 * @param {Function} callback of the form f(err, id).
 */
MAPI.prototype.listZoneSnapshots = function(customer,
                                            zone,
                                            callback) {

  if (!customer) throw new TypeError('customer is required');
  if (!zone) throw new TypeError('zone is required');
  if (!callback || typeof(callback) !== 'function')
    throw new TypeError('callback is required (function)');

  var self = this;
  var request = {
    path: sprintf(ZONE_SNAPSHOTS_FMT, customer, zone),
    headers: {
      'x-joyent-ignore-provisioning-state': true,
      User: customer
    },
    expect: [200, 204, 410]
  };

  this.client.get(request, function(err, obj, headers) {
    if (err)
      return callback(self._translateError(err));

    if (!obj)
      obj = [];

    return callback(null, obj, headers);
  });
};


/**
 * Boots a zone from a snapshot
 *
 * @param {String} customer capi uuid.
 * @param {String} zone zone uuid.
 * @param {String} snapshot snapshot name.
 * @param {Function} callback of the form f(err, id).
 */
MAPI.prototype.bootZoneFromSnapshot = function(customer,
                                               zone,
                                               snapshot,
                                               callback) {

  if (!customer) throw new TypeError('customer is required');
  if (!zone) throw new TypeError('zone is required');
  if (!snapshot) throw new TypeError('snapshot is required');
  if (!callback || typeof(callback) !== 'function')
    throw new TypeError('callback is required (function)');

  var self = this;
  var request = {
    path: sprintf(ZONE_SNAPSHOT_BOOT_FMT, customer, zone, snapshot),
    headers: {
      'x-joyent-ignore-provisioning-state': true,
      User: customer
    },
    expect: [202, 410]
  };

  this.client.post(request, function(err, obj, headers) {
    if (err)
      return callback(self._translateError(err));

    return callback(null, obj, headers);
  });
};


/**
 * Gets a snapshot for a zone.
 *
 * @param {String} customer capi uuid.
 * @param {String} zone zone uuid.
 * @param {String} snapshot snapshot name.
 * @param {Function} callback of the form f(err, id).
 */
MAPI.prototype.getZoneSnapshot = function(customer,
                                          zone,
                                          snapshot,
                                          callback) {

  if (!customer) throw new TypeError('customer is required');
  if (!zone) throw new TypeError('zone is required');
  if (!snapshot) throw new TypeError('snapshot is required');
  if (!callback || typeof(callback) !== 'function')
    throw new TypeError('callback is required (function)');

  var self = this;
  var request = {
    path: sprintf(ZONE_SNAPSHOT_FMT, customer, zone, snapshot),
    headers: {
      'x-joyent-ignore-provisioning-state': true,
      User: customer
    },
    expect: [200, 204, 410]
  };

  this.client.get(request, function(err, obj, headers) {
    if (err)
      return callback(self._translateError(err));

    return callback(null, obj, headers);
  });
};


/**
 * Deletes a snapshot for a zone.
 *
 * @param {String} customer capi uuid.
 * @param {String} zone zone uuid.
 * @param {String} snapshot snapshot name.
 * @param {Function} callback of the form f(err, id).
 */
MAPI.prototype.deleteZoneSnapshot = function(customer,
                                             zone,
                                             snapshot,
                                             callback) {

  if (!customer) throw new TypeError('customer is required');
  if (!zone) throw new TypeError('zone is required');
  if (!snapshot) throw new TypeError('snapshot is required');
  if (!callback || typeof(callback) !== 'function')
    throw new TypeError('callback is required (function)');

  var self = this;
  var request = {
    path: sprintf(ZONE_SNAPSHOT_FMT, customer, zone, snapshot),
    headers: {
      'x-joyent-ignore-provisioning-state': true,
      User: customer
    },
    expect: [202, 204, 410]
  };

  this.client.del(request, function(err, obj, headers) {
    if (err)
      return callback(self._translateError(err));

    return callback(null, obj, headers);
  });
};


/**
 * Counts the number of VMs for a given customer.
 *
 * Note this can include transitioning VMs using the
 * options.allVMs parameter.
 *
 * @param {String} customer the CAPI customer uuid.
 * @param {Object} options optional object with:
 *                   - allVMs: whether or not to include
 *                             transitioning/destroyed VMs.
 * @param {Function} callback of the form f(err, count).
 */
MAPI.prototype.countVirtualMachines = function(customer, options, callback) {
  return this.listVMs(customer, options, callback, true);
};
MAPI.prototype.countVMs = MAPI.prototype.countVirtualMachines;


/**
 * Lists all virtual machines in MAPI for a given customer.
 *
 * @param {String} customer the CAPI customer uuid.
 * @param {Object} options optional object with:
 *                   - limit: MAPI query limit.
 *                   - offset: starting point for this query.
 * @param {Function} callback of the form f(err, vms).
 * @param {Boolean} headOnly HEAD instead of GET (default: false).
 */
MAPI.prototype.listVMs = function(customer, options, callback, headOnly) {
  if (!customer) throw new TypeError('customer is required');
  if (!options) throw new TypeError('callback is required (function');
  if (typeof(options) === 'function') {
    callback = options;
    options = null;
  } else if (typeof(options) !== 'object') {
    throw new TypeError('options must be an object');
  }
  if (!callback || typeof(callback) !== 'function')
    throw new TypeError('callback is required (function)');


  var request = {
    path: sprintf(CUST_FMT + '/vms', customer),
    expect: [200, 204],
    headers: {
      User: customer,
      'X-Joyent-Ignore-Provisioning-State': 'true'
    },
    query: options
  };

  var list = this.client.get;
  if (headOnly)
    list = this.client.head;

  var self = this;
  return list.call(this.client, request, function(err, obj, headers) {
    if (err)
      return callback(self._translateError(err));

    if (headOnly) {
      headers = obj;
      obj = null;
    }
    if (!obj || !obj.length)
      obj = [];

    return callback(null, obj, headers);
  });
};
MAPI.prototype.listVirtualMachines = MAPI.prototype.listVMs;


/**
 * Retrives a particular VM by name (uuid).
 *
 * @param {String} customer the CAPI customer uuid.
 * @param {String} vm the vm uuid.
 * @param {Function} callback of the form f(err, vm).
 */
MAPI.prototype.getVirtualMachine = function(customer, vm, callback) {
  if (!customer) throw new TypeError('customer is required');
  if (!vm) throw new TypeError('vm is required');
  if (!callback || typeof(callback) !== 'function')
    throw new TypeError('callback is required (function)');

  var self = this;
  var request = {
    path: sprintf(VM_FMT, customer, vm),
    headers: {
      'x-joyent-ignore-provisioning-state': true,
      User: customer
    },
    expect: [200, 204, 410]
  };

  return this.client.get(request, function(err, obj, headers) {
    if (err) return callback(self._translateError(err));

    if (!obj) {
      return callback(newError({
        httpCode: HttpCodes.NotFound,
        restCode: RestCodes.ResourceNotFound,
        message: alias + ' does not exist.'
      }));
    }

    return callback(null, obj);
  });
};
MAPI.prototype.getVM = MAPI.prototype.getVirtualMachine;


/**
 * Retrives a particular VM by alias.
 *
 * Note this call will return the VM regardless of what state it is in.
 *
 * @param {String} customer the CAPI customer uuid.
 * @param {String} alias the VM alias.
 * @param {Function} callback of the form f(err, zone).
 */
MAPI.prototype.getVMByAlias = function(customer, alias, callback) {
  if (!customer) throw new TypeError('customer is required');
  if (!alias) throw new TypeError('alias is required');
  if (!callback || typeof(callback) !== 'function')
    throw new TypeError('callback is required (function)');

  var self = this;
  var request = {
    path: sprintf(VM_FMT, customer, alias),
    expect: [200, 204, 410],
    headers: {
      'x-joyent-ignore-provisioning-state': true,
      'x-joyent-find-with': 'alias',
      User: customer
    }
  };

  return this.client.get(request, function(err, obj, headers) {
    if (err) return callback(self._translateError(err));

    if (!obj) {
      return callback(newError({
        httpCode: HttpCodes.NotFound,
        restCode: RestCodes.ResourceNotFound,
        message: alias + ' does not exist.'
      }));
    }

    return callback(null, obj);
  });
};
MAPI.prototype.getVirtualMachineByAlias = MAPI.prototype.getVMByAlias;


/**
 * Provisions a new VM in MAPI.
 *
 * Options, while MAPI docs are authoritative, generally contain:
 *  - dataset: the dataset uuid.
 *  - package: the package to provision with.
 *  - alias: the name you want on the machine.
 *  - hostname: the hostname to assign.
 *
 * @param {String} customer the CAPI customer uuid.
 * @param {Object} options the creation options (see MAPI docs).
 * @param {Function} callback of the form f(err, zone).
 */
MAPI.prototype.createVirtualMachine = function(customer, options, callback) {
  if (!customer) throw new TypeError('customer is required');
  if (!options || typeof(options) !== 'object')
    throw new TypeError('options is required (object)');
  if (!callback || typeof(callback) !== 'function')
    throw new TypeError('callback is required (function)');

  options.owner_uuid = customer;

  var self = this;
  var request = {
    path: sprintf(CUST_FMT + '/vms', customer),
    expect: [200, 201, 202, 204],
    body: options,
    headers: {
      User: customer
    }
  };

  return this.client.post(request, function(err, obj, headers) {
    if (err) return callback(self._translateError(err));

    var transition = headers['x-joyent-transition-uri'];
    if (!transition) {
      log.warn('MAPI.createVirtualMachine(%s): No Transition returned.',
               customer);
      return callback(newError());
    }

    var id = transition.substr(transition.lastIndexOf('/') + 1);
    self.getVM(customer, id, function(err, vm) {
      if (err) return callback(self._translateError(err));

      return callback(null, vm);
    });
  });
};
MAPI.prototype.createVM = MAPI.prototype.createVirtualMachine;


/**
 * Shutdown a VM.
 *
 * @param {String} customer the CAPI customer uuid.
 * @param {String} vm the VM uuid.
 * @param {Function} callback of the form f(err).
 */
MAPI.prototype.shutdownVirtualMachine = function(customer, vm, callback) {
  if (!customer) throw new TypeError('customer is required');
  if (!vm) throw new TypeError('vm is required');
  if (!callback || typeof(callback) !== 'function')
    throw new TypeError('callback is required (function)');

  var self = this;
  var request = {
    path: sprintf(VM_ACTION_FMT, customer, vm, 'shutdown'),
    headers: {
      'x-joyent-ignore-provisioning-state': true,
      User: customer
    },
    expect: [200, 202, 204, 410]
  };

  this.client.post(request, function(err, obj, headers) {
    if (err) return callback(self._translateError(err));

    return callback();
  });
};
MAPI.prototype.shutdownVM = MAPI.prototype.shutdownVirtualMachine;


/**
 * Startup a VM.
 *
 * @param {String} customer the CAPI customer uuid.
 * @param {String} vm the VM uuid.
 * @param {Function} callback of the form f(err).
 */
MAPI.prototype.startupVirtualMachine = function(customer, vm, callback) {
  if (!customer) throw new TypeError('customer is required');
  if (!vm) throw new TypeError('vm is required');
  if (!callback || typeof(callback) !== 'function')
    throw new TypeError('callback is required (function)');

  var self = this;
  var request = {
    path: sprintf(VM_ACTION_FMT, customer, vm, 'startup'),
    headers: {
      'x-joyent-ignore-provisioning-state': true,
      User: customer
    },
    expect: [200, 202, 204, 410]
  };

  this.client.post(request, function(err, obj, headers) {
    if (err) return callback(self._translateError(err));

    return callback();
  });
};
MAPI.prototype.startupVM = MAPI.prototype.startupVirtualMachine;


/**
 * Reboot a VM.
 *
 * @param {String} customer the CAPI customer uuid.
 * @param {String} vm the VM uuid.
 * @param {Function} callback of the form f(err).
 */
MAPI.prototype.rebootVirtualMachine = function(customer, vm, callback) {
  if (!customer) throw new TypeError('customer is required');
  if (!vm) throw new TypeError('vm is required');
  if (!callback || typeof(callback) !== 'function')
    throw new TypeError('callback is required (function)');

  var self = this;
  var request = {
    path: sprintf(VM_ACTION_FMT, customer, vm, 'reboot'),
    headers: {
      'x-joyent-ignore-provisioning-state': true,
      User: customer
    },
    expect: [200, 202, 204, 410]
  };

  this.client.post(request, function(err, obj, headers) {
    if (err) return callback(self._translateError(err));

    return callback();
  });
};
MAPI.prototype.rebootVM = MAPI.prototype.rebootVirtualMachine;


/**
 * Lists tags on a VM.
 *
 * @param {String} customer the CAPI uuid.
 * @param {String} vm the vm name.
 * @param {Function} callback of the form f(err, tags).
 */
MAPI.prototype.listVirtualMachineTags = function(customer, vm, callback) {
  if (!customer) throw new TypeError('customer is required');
  if (!vm) throw new TypeError('vm is required');
  if (!callback || typeof(callback) !== 'function')
    throw new TypeError('callback is required (function)');

  var self = this;
  var request = {
    path: sprintf(VM_TAGS_FMT, customer, vm),
    headers: {
      'x-joyent-ignore-provisioning-state': true,
      User: customer
    },
    expect: [200, 204, 410]
  };

  this.client.get(request, function(err, obj, headers) {
    if (err) return callback(self._translateError(err));

    return callback(null, obj);
  });
};
MAPI.prototype.listVMTags = MAPI.prototype.listVirtualMachineTags;


/**
 * Gets a single tag on a VM.
 *
 * @param {String} customer the CAPI uuid.
 * @param {String} vm the vm name.
 * @param {String} tag the tag name.
 * @param {Function} callback of the form f(err, tags).
 */
MAPI.prototype.getVirtualMachineTag = function(customer, vm, tag, callback) {
  if (!customer) throw new TypeError('customer is required');
  if (!vm) throw new TypeError('vm is required');
  if (!tag) throw new TypeError('tag is required');
  if (!callback || typeof(callback) !== 'function')
    throw new TypeError('callback is required (function)');

  var self = this;
  var request = {
    path: sprintf(VM_TAG_FMT, customer, vm, tag),
    headers: {
      'x-joyent-ignore-provisioning-state': true,
      User: customer
    },
    expect: [200, 204, 410]
  };

  this.client.get(request, function(err, obj, headers) {
    if (err) return callback(self._translateError(err));

    return callback(null, obj);
  });
};
MAPI.prototype.listVMTags = MAPI.prototype.listVirtualMachineTags;


/**
 * Add tags to a VM.
 *
 * @param {String} customer the CAPI uuid.
 * @param {String} vm the vm name.
 * @param {Object} tags object (name: value).
 * @param {Function} callback of the form f(err).
 */
MAPI.prototype.addVirtualMachineTags = function(customer, vm, tags, callback) {
  if (!customer) throw new TypeError('customer is required');
  if (!vm) throw new TypeError('vm is required');
  if (!tags || typeof(tags) !== 'object')
    throw new TypeError('tags is required (object)');
  if (!callback || typeof(callback) !== 'function')
    throw new TypeError('callback is required (function)');

  var self = this;

  var _tags = {};
  for (var k in tags) {
    if (tags.hasOwnProperty(k)) {
      _tags['tag.' + k] = tags[k];
    }
  }

  var request = {
    path: sprintf(VM_TAGS_FMT, customer, vm),
    headers: {
      'x-joyent-ignore-provisioning-state': true,
      User: customer
    },
    body: _tags,
    expect: [200, 201, 202, 204, 410]
  };

  this.client.post(request, function(err, obj, headers) {
    if (err) return callback(self._translateError(err));

    return callback(null, obj);
  });
};
MAPI.prototype.addVMTags = MAPI.prototype.addVirtualMachineTags;


/**
 * Deletes a single tag from a VM.
 *
 * @param {String} customer the CAPI uuid.
 * @param {String} vm the vm name..
 * @param {String} tag tag name without the leading 'tag.'.
 * @param {Function} callback of the form f(err).
 */
MAPI.prototype.deleteVirtualMachineTag = function(customer, vm, tag, callback) {
  if (!customer) throw new TypeError('customer is required');
  if (!vm) throw new TypeError('vm is required');
  if (!tag) throw new TypeError('tag is required');
  if (!callback || typeof(callback) !== 'function')
    throw new TypeError('callback is required (function)');

  var self = this;
  var request = {
    path: sprintf(VM_TAG_FMT, customer, vm, tag),
    headers: {
      'x-joyent-ignore-provisioning-state': true,
      User: customer
    },
    expect: [200, 204, 410]
  };

  this.client.del(request, function(err, obj, headers) {
    if (err) return callback(self._translateError(err));

    return callback();
  });
};
MAPI.prototype.deleteVMTag = MAPI.prototype.deleteVirtualMachineTag;


/**
 * Deletes all tags from a VM.
 *
 * @param {String} customer the CAPI uuid.
 * @param {String} vm the vm name.
 * @param {Function} callback of the form f(err).
 */
MAPI.prototype.deleteVirtualMachineTags = function(customer, vm, callback) {
  if (!customer) throw new TypeError('customer is required');
  if (!vm) throw new TypeError('vm is required');
  if (!callback || typeof(callback) !== 'function')
    throw new TypeError('callback is required (function)');

  var self = this;
  var request = {
    path: sprintf(VM_TAGS_FMT, customer, vm),
    headers: {
      'x-joyent-ignore-provisioning-state': true,
      User: customer
    },
    expect: [200, 202, 204, 410]
  };

  this.client.del(request, function(err, obj, headers) {
    if (err) return callback(self._translateError(err));

    return callback();
  });
};
MAPI.prototype.deleteVMTags = MAPI.prototype.deleteVirtualMachineTags;


/**
 * Destroys a vm.
 *
 * @param {String} customer capi uuid.
 * @param {String} vm vm uuid.
 * @param {Function} callback of the form f(err).
 */
MAPI.prototype.deleteVirtualMachine = function(customer, vm, callback) {
  if (!customer) throw new TypeError('customer is required');
  if (!vm) throw new TypeError('vm is required');
  if (!callback || typeof(callback) !== 'function')
    throw new TypeError('callback is required (function)');

  var self = this;
  var request = {
    path: sprintf(VM_FMT, customer, vm),
    headers: {
      'x-joyent-ignore-provisioning-state': true,
      User: customer
    },
    expect: [200, 202, 204, 410]
  };

  this.client.del(request, function(err, obj, headers) {
    if (err) return callback(self._translateError(err));

    return callback();
  });
};
MAPI.prototype.deleteVM = MAPI.prototype.deleteVirtualMachine;


var SERVERS_FMT = '/servers';
/**
 * Lists servers
 *
 * @param {Object} opts optional parameters for listing.
 * @param {Function} callback of the form f(err, servers).
 */
MAPI.prototype.listServers = function(opts, callback) {
  if (!opts) {
    callback = opts;
    opts = {};
  }
  if (typeof(opts) !== 'object') throw new TypeError('opts must be an object');
  if (!callback || typeof(callback) !== 'function')
    throw new TypeError('callback is required (function)');

  var self = this;
  var request = {
    path: SERVERS_FMT,
    expect: [200],
    query: opts
  };
  this.client.get(request, function(err, servers) {
    if (err) return callback(self._translateError(err));

    return callback(null, servers);
  });
};

var SERVER_FMT = SERVERS_FMT + '/%s';
/**
 * Update server
 *
 * @param {Number} server_id the id of the server.
 * @param {Object} opts for information to update server with.
 * @param {Function} callback of the form f(err).
 */
MAPI.prototype.updateServer = function(server_id, opts, callback) {
  if (!server_id) throw new TypeError('server_id is required');
  if (!opts) {
    callback = opts;
    opts = {};
  }
  if (typeof(opts) !== 'object') throw new TypeError('opts must be an object');
  if (!callback || typeof(callback) !== 'function')
    throw new TypeError('callback is required (function)');

  var self = this;
  var request = {
    path: sprintf(SERVER_FMT, server_id),
    expect: [200],
    body: opts
  };

  this.client.put(request, function(err, obj, headers) {
    if (err) return callback(self._translateError(err));

    return callback();
  });
};

var SERVER_REBOOT_FMT = SERVER_FMT + '/reboot';
/*
 * Reboot server
 *
 * @param {Number} server id
 * @param {Function} callback in the form of f(err)
 */
MAPI.prototype.rebootServer = function(server_id, callback) {
  if (!server_id) throw new TypeError('server_id is required');
  if (!callback || typeof(callback) !== 'function')
    throw new TypeError('callback is required (function)');

  var self = this;
  var request = {
    path: sprintf(SERVER_REBOOT_FMT, server_id),
    expect: [204]
  };

  this.client.post(request, function(err, obj, headers) {
    if (err) return callback(self._translateError(err));

    return callback();
  });
};

var SERVER_SETUP_FMT = SERVER_FMT + '/setup';
/*
 * Setup server
 *
 * @param {Number} server id
 * @param {Function} callback in the form of f(err)
 */
MAPI.prototype.setupServer = function(server_id, callback) {
  if (!server_id) throw new TypeError('server_id is required');
  if (!callback || typeof(callback) !== 'function')
    throw new TypeError('callback is required (function)');

  var self = this;
  var request = {
    path: sprintf(SERVER_SETUP_FMT, server_id),
    expect: [204]
  };

  this.client.post(request, function(err, obj, headers) {
    if (err) return callback(self._translateError(err));

    return callback();
  });
};

var NIC_FMT = '/nics/%s/nic_tags';
/**
 * Update a nics tags
 *
 * @param {String} mac_addr mac address.
 * @param {Object} opts for information to update nic tags with.
 * @param {Function} callback of the form f(err).
 */
MAPI.prototype.updateNicTags = function(mac_addr, opts, callback) {
  if (!mac_addr) throw new TypeError('mac_addr is required');
  if (!opts) {
    callback = opts;
    opts = {};
  }
  if (typeof(opts) !== 'object') throw new TypeError('opts must be an object');
  if (!callback || typeof(callback) !== 'function')
    throw new TypeError('callback is required (function)');

  var self = this;
  var request = {
    path: sprintf(NIC_FMT, mac_addr),
    expect: [201],
    body: opts
  };

  this.client.post(request, function(err, obj, headers) {
    if (err) return callback(self._translateError(err));

    return callback();
  });
};

///--- Private methods

// Warning: this is some ugly caching logic for packages and datasets.
// Basically, we have to segregate packages/datasets in the "anonymous"
// space vs packages/datasets specific to a customer.  These all get
// returned in one batch from MAPI so we have to pick apart and
// reassemble.  No doubt this code could be clearer, so if you feel
// ambitious and want to refactor, go. to. town.

MAPI.prototype._datasetCachePut = function(customer, name, dataset) {
  assert.ok(customer);
  assert.ok(name);
  assert.ok(name);

  return this._cachePut(this.datasetCache, customer, name, dataset);
};


MAPI.prototype._datasetCacheGet = function(customer, name) {
  assert.ok(customer);
  assert.ok(name);

  return this._cacheGet(this.datasetCache,
                        this.datasetCacheExpiry,
                        customer,
                        name);
};


MAPI.prototype._pkgCachePut = function(customer, name, pkg) {
  assert.ok(customer);
  assert.ok(name);
  assert.ok(pkg);

  return this._cachePut(this.pkgCache, customer, name, pkg);
};


MAPI.prototype._pkgCacheGet = function(customer, name) {
  assert.ok(customer);
  assert.ok(name);

  return this._cacheGet(this.pkgCache, this.pkgCacheExpiry, customer, name);
};


MAPI.prototype._cachePut = function(cache, customer, name, object) {
  assert.ok(cache);
  assert.ok(customer);
  assert.ok(name);
  assert.ok(object);

  var cacheKey = customer + ':' + name;

  var obj = {
    found: true,
    message: object,
    ctime: new Date().getTime()
  };

  if (object instanceof Error) {
    obj.found = false;
  } else if (object instanceof Array) {
    var anon = {
      found: true,
      message: [],
      ctime: obj.ctime
    };
    var specific = [];

    var i = 0;
    var j = 0;
    object.forEach(function(o) {
      if (o.owner_uuid === null) {
        anon.message[i++] = o;
      } else {
        specific[j++] = o;
      }
    });
    obj.message = specific;

    var anonyKey = ANONYMOUS + ':' + name;
    log.trace('MAPI._cachePut(%s): writing %o', anonyKey, anon);
    cache.set(anonyKey, anon);
  } else if (object instanceof Object) {
    if (object.owner_uuid === null) {
      cacheKey = ANONYMOUS + ':' + name;
    }
  }

  log.trace('MAPI._cachePut(%s): writing %o', cacheKey, obj);
  cache.set(cacheKey, obj);
  return obj;
};


MAPI.prototype._cacheGet = function(cache, expiry, customer, name) {
  assert.ok(cache);
  assert.ok(expiry);
  assert.ok(customer);
  assert.ok(name);

  var now = new Date().getTime();

  var cacheKey = customer + ':' + name;
  var cached = cache.get(customer + ':' + name);
  var anon = cache.get(ANONYMOUS + ':' + name);
  var obj = null;

  log.trace('MAPI._cacheGet(%s): => cached=%o, anon=%o',
            cacheKey, cached, anon);

  if (cached) {
    if ((now - cached.ctime) <= expiry) {

      obj = {
        found: cached.found,
        ctime: cached.ctime
      };

      // Deep clone so we don't mess with the record in cache.
      if (cached.found && cached.message instanceof Array) {
        if (!obj.message)
          obj.message = [];
        cached.message.forEach(function(p) {
          obj.message.push(p);
        });
      }

      // Check if we need to merge the anonymous records too.
      if (anon && anon.found && anon.message instanceof Array) {
        if (!obj.message)
          obj.message = [];
        anon.message.forEach(function(p) {
          obj.message.push(p);
        });
      }

      if (!obj.message)
        obj.message = cached.message;
    }
  } else if (anon) {
    if ((now - anon.ctime) <= expiry)
      obj = anon;
  }

  log.trace('MAPI._cacheGet(%s): cache hit => %o', cacheKey, obj);
  return obj;
};


MAPI.prototype._translateError = function(err) {
  assert.ok(err);

  // We don't always get an error response from MAPI, but when we do,
  // use it.
  if (err.details && err.details.object) {
    var _err = newError();
    if (err.details.object.messages && err.details.object.messages[0])
      _err.message = err.details.object.messages[0];

    switch (err.details.object.code) {
    case 'InvalidHostnameError':
      _err.httpCode = HttpCodes.Conflict;
      _err.restCode = RestCodes.InvalidArgument;
      _err.message = 'name syntax is invalid';
      break;
    case 'InvalidParamError':
      _err.httpCode = HttpCodes.Conflict;
      _err.restCode = RestCodes.InvalidArgument;
      break;
    case 'NotFoundError':
      _err.httpCode = HttpCodes.NotFound;
      _err.restCode = RestCodes.ResourceNotFound;
      break;
    case 'NoAvailableServersError':
    case 'NoAvailableServersWithDatasetError':
      _err.httpCode = HttpCodes.ServiceUnavailable;
      _err.restCode = 'InsufficientCapacity';
      break;
    case 'SetupError':
      _err.httpCode = HttpCodes.ServiceUnavailable;
      _err.restCode = RestCodes.InternalError;
      _err.message = 'System is unavailable for provisioning';
      break;
    case 'TransitionConflictError':
    case 'TransitionToCurrentStatusError':
      _err.httpCode = HttpCodes.Conflict;
      _err.restCode = 'InvalidState';
      break;
    case 'UnacceptableTransitionError':
      _err.httpCode = HttpCodes.Conflict;
      _err.restCode = 'InvalidState';
      break;
    case 'UnknownDatasetError':
      _err.httpCode = HttpCodes.Conflict;
      _err.restCode = RestCodes.InvalidArgument;
      break;
    case 'UnknownPackageError':
      _err.httpCode = HttpCodes.Conflict;
      _err.restCode = RestCodes.InvalidArgument;
      break;
    case RestCodes.RetriesExceeded:
      _err.httpCode = HttpCodes.InternalError;
      _err.restCode = RestCodes.InternalError;
      break;
    }

    return _err;
  }

  if (err.restCode && err.restCode === RestCodes.RetriesExceeded) {
    return newError({
      httpCode: HttpCodes.InternalError,
      restCode: RestCodes.InternalError
    });
  }

  // If we're here, the error was something else.
  if (err.httpCode === HttpCodes.BadRequest) {
    err.httpCode = HttpCodes.Conflict;
    err.restCode = RestCodes.InvalidArgument;
    err.message = err.restCode;
  }

  return err;
};

module.exports = MAPI;
