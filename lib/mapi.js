// Copyright 2011 Joyent, Inc.  All rights reserved.

var assert = require('assert');

var LRU = require("lru-cache");
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
var ZONE_USAGE_FMT = ZONE_FMT + '/usage/%s';

var VM_ACTION_FMT = CUST_FMT + '/vms/%s/%s';


///--- Exported MAPI Client

/**
 * Constructor
 *
 * Note that in options you can pass in any parameters that the restify
 * RestClient constructor takes (for example retry/backoff settings).
 *
 * @param {Object} options:
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

  // TODO (mcavage) remove this line when PROV-818 is fixed
  options.noContentMD5 = true;
  this.client = restify.createClient(options);
}


/**
 * Lists all the datasets available in MAPI for the given
 * tenant.
 *
 * @param {String} customer the CAPI customer uuid.
 * @param {Object} options: optional parameters for listing (TODO)
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

  var self = this;
  var request = {
    path: '/datasets?owner_uuid=' + customer
  };
  this.client.get(request, function(err, obj, headers) {
    if (err) return callback(self._translateError(err));

    return callback(null, obj);
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

  var self = this;
  var request = {
    path: '/datasets/' + dataset
  };
  this.client.get(request, function(err, obj, headers) {
    if (err) return callback(self._translateError(err));
    if (!obj) {
      return callback(newError({
        httpCode: HttpCodes.NotFound,
        restCode: RestCodes.ResourceNotFound,
        message: 'dataset ' + dataset + ' does not exist.'
      }));
    }

    if (customer) {
      if (obj.owner_uuid && (obj.owner_uuid !== customer)) {
        return callback(newError({
          httpCode: HttpCodes.Forbidden,
          restCode: RestCodes.NotAuthorized,
          message: 'You do not have access to dataset: ' + dataset
        }));
      }
    }
    return callback(null, obj);
  });
};


/**
 * Lists packages available to a tenant.
 *
 * @param {String} customer the CAPI customer uuid.
 * @param {Object} options: optional parameters for listing (TODO)
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

  var self = this;
  var request = {
    path: '/packages?owner_uuid=' + customer
  };
  this.client.get(request, function(err, packages) {
    if (err) return callback(self._translateError(err));

    return callback(null, packages);
  });
};


/**
 * Gets a package by name for a tenant.
 *
 * @param {String} customer the CAPI customer uuid.
 * @param {String} name of the package
 * @param {Function} callback of the form f(err, pkg).
 */
MAPI.prototype.getPackageByName = function(customer, name, callback) {
  if (!customer) throw new TypeError('customer is required');
  if (!name) throw new TypeError('name is required');
  if (!callback || typeof(callback) !== 'function')
    throw new TypeError('callback is required (function)');

  var self = this;
  var request = {
    path: sprintf('/packages/%s?owner_uuid=%s', name, customer),
    expect: 200,
    headers: {
      'X-Joyent-Find-With': 'name'
    }
  };
  return this.client.get(request, function(err, obj, headers) {
    if (err) return callback(self._translateError(err));

    if (!obj)
      return callback(newError({
        httpCode: HttpCodes.NotFound,
        restCode: RestCodes.ResourceNotFound,
        message: 'package ' + name + ' not found.'
    }));

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
  var request = {
    path: sprintf(CUST_FMT + '/zones', customer),
    expect: 204
  };
  if (options && options.allZones) {
    request.headers = {
      'X-Joyent-Ignore-Provisioning-State': 'true'
    };
  }
  return this.client.head(request, function(err, headers) {
    if (err) return callback(self._translateError(err));
    if (!headers || !headers['x-joyent-resource-count'])
      return callback(null, 0);

    return callback(null, parseInt(headers['x-joyent-resource-count'], 10));
  });
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
 *                   - allZones: whether or not to include
 *                               transitioning/destroyed zones.
 * @param {Function} callback of the form f(err, zones).
 */
MAPI.prototype.listZones = function(customer, options, callback) {
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


  var path = sprintf(CUST_FMT + '/zones', customer);
  if (options) {
    if (options.limit !== undefined)
      path = path + '?limit=' + options.limit;
    if (options.offset !== undefined)
      offset = ((path.indexOf('?') === -1) ? path + '?offset=' : path + '&offset=') + options.offset;
  }
  var self = this;
  var request = {
    path: path,
    expect: 204
  };
  if (options && options.allZones) {
    request.headers = {
      'X-Joyent-Ignore-Provisioning-State': 'true'
    };
  }
  return this.client.get(request, function(err, obj, headers) {
    if (err) return callback(self._translateError(err));
    if (!obj || !obj.length) return callback(null, []);

    return callback(null, obj);
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
    expect: [204, 410],
    headers: {
      'x-joyent-ignore-provisioning-state': true,
      'x-joyent-find-with': 'alias'
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
    expect: [204, 410],
    headers: {
      'x-joyent-ignore-provisioning-state': true,
      'x-joyent-find-with': 'name'
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
 * @param {String} container the container id.
 * @param {String} month the YYYY-MM date param to fetch usage for.
 */
MAPI.prototype.getZoneUsage= function(customer, zname, month, callback) {
  var resource = sprintf(ZONE_USAGE_FMT, customer, zname, month);
  return this.client.get(resource, function(error, usage) {
    if (error || !usage) {
      if (!usage || error.httpCode === HttpCodes.NotFound) {
        return callback(newError({httpCode: HttpCodes.NotFound,
                                  restCode: RestCodes.ResourceNotFound,
                                  message: zname + '/' + month +
                                           ' does not exist'}));
      }
      return callback(error);
    }

    return callback(undefined, usage);
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
 * @param {Function} callback of the form f(err, zone).
 */
MAPI.prototype.createZone = function(customer, options, callback) {
  if (!customer) throw new TypeError('customer is required');
  if (!options || typeof(options) !== 'object')
    throw new TypeError('options is required (object)');
  if (!callback || typeof(callback) !== 'function')
    throw new TypeError('callback is required (function)');

  options.owner_uuid = customer;

  var self = this;
  var request = {
    path: sprintf(CUST_FMT + '/zones', customer),
    expect: 202,
    body: options
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
      'x-joyent-ignore-provisioning-state': true
    },
    expect: [202, 204, 410]
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
      'x-joyent-ignore-provisioning-state': true
    },
    expect: [202, 204, 410]
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
      'x-joyent-ignore-provisioning-state': true
    },
    expect: [202, 410]
  };

  this.client.put(request, function(err, obj, headers) {
    if (err) return callback(self._translateError(err));

    return callback();
  });
};


/**
 * Destroys a zone
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
      'x-joyent-ignore-provisioning-state': true
    },
    expect: [202, 410]
  };

  this.client.del(request, function(err, obj, headers) {
    if (err) return callback(self._translateError(err));

    return callback();
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
  var request = {
    path: sprintf(CUST_FMT + '/vms', customer),
    expect: 204
  };
  if (options && options.allVMs) {
    request.headers = {
      'X-Joyent-Ignore-Provisioning-State': 'true'
    };
  }
  return this.client.head(request, function(err, headers) {
    if (err) return callback(self._translateError(err));
    if (!headers || !headers['x-joyent-resource-count'])
      return callback(null, 0);

    return callback(null, parseInt(headers['x-joyent-resource-count'], 10));
  });
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
 */
MAPI.prototype.listVirtualMachines = function(customer, options, callback) {
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


  var path = '/vms?owner_uuid=' + customer;
  if (options) {
    if (options.limit !== undefined)
      path = path + '&limit=' + options.limit;
    if (options.offset !== undefined)
      offset = path + '&offset=' + options.offset;
  }

  var self = this;
  var request = {
    path: path,
    expect: 204
  };

  if (options && options.allVMs) {
    request.headers = {
      'X-Joyent-Ignore-Provisioning-State': true
    };
  }

  return this.client.get(request, function(err, obj, headers) {
    if (err) return callback(self._translateError(err));
    if (!obj || !obj.length) return callback(null, []);

    return callback(null, obj);
  });
};
MAPI.prototype.listVMs = MAPI.prototype.listVirtualMachines;


/**
 * Retrives a particular VM by name (uuid).
 *
 * @param {String} customer the CAPI customer uuid.
 * @param {String} vm the vm uuid
 * @param {Function} callback of the form f(err, vm).
 */
MAPI.prototype.getVirtualMachine = function(customer, vm, callback) {
  if (!customer) throw new TypeError('customer is required');
  if (!vm) throw new TypeError('vm is required');
  if (!callback || typeof(callback) !== 'function')
    throw new TypeError('callback is required (function)');

  var self = this;
  var request = {
    path: sprintf('/vms/%s?owner_uuid=%s', vm, customer),
    headers: {
      'x-joyent-ignore-provisioning-state': true
    },
    expect: [204, 410]
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
    path: '/vms',
    expect: 202,
    body: options
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
      'x-joyent-ignore-provisioning-state': true
    },
    expect: [202, 410]
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
      'x-joyent-ignore-provisioning-state': true
    },
    expect: [202, 410]
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
      'x-joyent-ignore-provisioning-state': true
    },
    expect: [202, 410]
  };

  this.client.post(request, function(err, obj, headers) {
    if (err) return callback(self._translateError(err));

    return callback();
  });
};
MAPI.prototype.rebootVM = MAPI.prototype.rebootVirtualMachine;


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
    path: sprintf('/customers/%s/vms/%s', customer, vm),
    headers: {
      'x-joyent-ignore-provisioning-state': true
    },
    expect: [202, 410]
  };

  this.client.del(request, function(err, obj, headers) {
    if (err) return callback(self._translateError(err));

    return callback();
  });
};
MAPI.prototype.deleteVM = MAPI.prototype.deleteVirtualMachine;



///--- Private methods

MAPI.prototype._translateError = function(err) {
  assert.ok(err);

  // We don't always get an error response from MAPI, but when we do,
  // use it.
  if (err.details && err.details.object) {
    var _err = newError();
    if (err.details.object.messages && err.details.object.messages[0])
      _err.message = err.details.object.messages[0];

    switch(err.details.object.code) {
    case 'InvalidHostnameError':
      _err.httpCode = HttpCodes.Conflict;
      _err.restCode = RestCodes.InvalidArgument;
      break;
    case 'InvalidParamError':
      _err.httpCode = HttpCodes.Conflict;
      _err.restCode = RestCodes.InvalidArgument;
      break;
    case 'NotFoundError':
      _err.httpCode = HttpCodes.NotFound;
      _err.restCode = RestCodes.ResourceNotFound;
      break;
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

    }

    return _err;
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
