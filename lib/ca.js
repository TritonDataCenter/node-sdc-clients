// Copyright 2011 Joyent, Inc.  All rights reserved.

var assert = require('assert');

var restify = require('restify');
var sprintf = require('sprintf').sprintf;



///--- Globals

var HttpCodes = restify.HttpCodes;
var RestCodes = restify.RestCodes;
var log = restify.log;
var newError = restify.newError;

var CA_FMT = '/ca/customers/%s';
var INST_BASE_FMT = CA_FMT + '/instrumentations';
var INST_FMT = INST_BASE_FMT + '/%s';
var INST_CLONE_FMT = INST_FMT + '/clone';
var RAW_FMT = INST_FMT + '/value/raw';
var HEATMAP_IMG_FMT = INST_FMT + '/value/heatmap/image';
var HEATMAP_DETAILS_FMT = INST_FMT + '/value/heatmap/image?x=%s&y=%s';



///--- Exported CA Client

/**
 * Constructor
 *
 * Note that in options you can pass in any parameters that the restify
 * RestClient constructor takes (for example retry/backoff settings).
 *
 * @param {Object} options
 *                  - url {String} CA location.
 *
 */
function CA(options) {
  if (!options) throw new TypeError('options required');
  if ((options.uri && options.url) ||
      !(options.uri || options.url))
    throw new TypeError('One of options.uri, options.url required');

  if (options.uri)
    options.url = options.uri;
  if (options.logLevel)
    log.level(options.logLevel);
  if (!options.version)
    options.version = 'ca/0.1.6';
  this.client = restify.createClient(options);
}


/**
 * Does a listing of the "root" CA endpoint.
 *
 * This hoss gives you the "schema" that CA supports.
 *
 * @param {String} customer a CAPI customer uuid.
 * @param {Function} callback of the form f(err, schema).
 */
CA.prototype.listSchema = function(customer, callback) {
  if (!customer) throw new TypeError('customer is required');
  if (!callback || typeof(callback) !== 'function')
    throw new TypeError('callback is required (function)');

  var self = this;
  var request = {
    path: sprintf(CA_FMT, customer)
  };
  return this.client.get(request, function(err, schema) {
    if (err) return callback(self._translateError(err));

    return callback(null, schema);
  });
};
CA.prototype.getSchema = CA.prototype.listSchema;
CA.prototype.list = CA.prototype.listSchema;
CA.prototype.describe = CA.prototype.listSchema;


/**
 * Lists all instrumentations created for a customer.
 *
 * @param {String} customer the CAPI customer uuid.
 * @param {Function} callback of the form f(err, instrumentations).
 */
CA.prototype.listInstrumentations = function(customer, callback) {
  if (!customer) throw new TypeError('customer is required');
  if (!callback || typeof(callback) !== 'function')
    throw new TypeError('callback is required (function)');

  var self = this;
  var request = {
    path: sprintf(INST_BASE_FMT, customer)
  };
  return this.client.get(request, function(err, instrumentations) {
    if (err) return callback(self._translateError(err));

    return callback(null, instrumentations);
  });
};


/**
 * Creates a new CA instrumentation.
 *
 * Refer to the CA documentation for an explanation of what goes in params.
 *
 * @param {String} customer the CAPI customer uuid.
 * @param {Object} params the intstrumentation parameters.
 * @param {Function} callback of the form f(err, instrumentation).
 */
CA.prototype.createInstrumentation = function(customer, params, callback) {
  if (!customer) throw new TypeError('customer is required');
  if (!params || typeof(params) !== 'object')
    throw new TypeError('params is required(object)');
  if (!callback || typeof(callback) !== 'function')
    throw new TypeError('callback is required (function)');

  var self = this;
  var request = {
    path: sprintf(INST_BASE_FMT, customer),
    body: params
  };
  return this.client.post(request, function(err, instrumentation) {
    if (err) return callback(self._translateError(err));

    return callback(null, instrumentation);
  });
};


/**
 * Clones a CA instrumentation.
 *
 * Refer to the CA documentation for an explanation of what goes in params.
 *
 * @param {String} customer the CAPI customer uuid.
 * @param {Object} params the intstrumentation parameters.
 * @param {Function} callback of the form f(err, instrumentation).
 */
CA.prototype.cloneInstrumentation = function(customer, id, params, callback) {
  if (!customer) throw new TypeError('customer is required');
  if (!id) throw new TypeError('id is required');
  if (typeof(params) === 'function') {
    callback = params;
    params = {};
  }
  if (!params || typeof(params) !== 'object')
    throw new TypeError('params must be an object');
  if (!callback || typeof(callback) !== 'function')
    throw new TypeError('callback is required (function)');

  var self = this;
  var request = {
    path: sprintf(INST_CLONE_FMT, customer, id),
    body: params
  };
  return this.client.post(request, function(err, instrumentation) {
    if (err) return callback(self._translateError(err));

    return callback(null, instrumentation);
  });
};


/**
 * Retrieves a single instrumentation by CA instrumentation id.
 *
 * @param {String} customer the CAPI customer uuid.
 * @param {String} instrumentation the intstrumentation id.
 * @param {Function} callback of the form f(err, instrumentation).
 */
CA.prototype.getInstrumentation = function(customer,
                                           instrumentation,
                                           callback) {

  if (!customer) throw new TypeError('customer is required');
  if (!instrumentation) throw new TypeError('instrumentation is required');
  if (!callback || typeof(callback) !== 'function')
    throw new TypeError('callback is required (function)');

  var self = this;
  var request = {
    path: sprintf(INST_FMT, customer, instrumentation)
  };
  return this.client.get(request, function(err, instrumentation) {
    if (err) return callback(self._translateError(err));

    return callback(null, instrumentation);
  });
};


/**
 * Retrieves a single "raw" instrumentation by CA instrumentation id.
 *
 * @param {String} customer the CAPI customer uuid.
 * @param {String} instrumentation the intstrumentation id.
 * @param {Function} callback of the form f(err, instrumentation).
 */
CA.prototype.getInstrumentationValueRaw = function(customer,
                                                   instrumentation,
                                                   callback) {

  if (!customer) throw new TypeError('customer is required');
  if (!instrumentation) throw new TypeError('instrumentation is required');
  if (!callback || typeof(callback) !== 'function')
    throw new TypeError('callback is required (function)');

  var self = this;
  var request = {
    path: sprintf(RAW_FMT, customer, instrumentation)
  };
  return this.client.get(request, function(err, instrumentation) {
    if (err) return callback(self._translateError(err));

    return callback(null, instrumentation);
  });
};


/**
 * Retrieves an instrumentation heatmap image from CA by instrumentation id.
 *
 * @param {String} customer the CAPI customer uuid.
 * @param {String} instrumentation the intstrumentation id.
 * @param {Function} callback of the form f(err, heatmap).
 */
CA.prototype.getHeatmap = function(customer, instrumentation, callback) {
  if (!customer) throw new TypeError('customer is required');
  if (!instrumentation) throw new TypeError('instrumentation is required');
  if (!callback || typeof(callback) !== 'function')
    throw new TypeError('callback is required (function)');

  var self = this;
  var request = {
    path: sprintf(HEATMAP_IMG_FMT, customer, instrumentation)
  };
  return this.client.get(request, function(err, heatmap) {
    if (err) return callback(self._translateError(err));

    return callback(null, heatmap);
  });
};
CA.prototype.getInstrumentationHeatmap = CA.prototype.getHeatmap;
CA.prototype.getInstrumentationHeatmapImage = CA.prototype.getHeatmap;



/**
 * Retrieves an instrumentation heatmap detail from CA by instrumentation id.
 *
 * @param {String} customer the CAPI customer uuid.
 * @param {String} instrumentation the intstrumentation id.
 * @param {String} x the x coordinate.
 * @param {String} y the y coordinate.
 * @param {Function} cb of the form f(err, details).
 */
CA.prototype.getHeatmapDetails = function(customer, instrumentation, x, y, cb) {
  if (!customer) throw new TypeError('customer is required');
  if (!instrumentation) throw new TypeError('instrumentation is required');
  if (!cb || typeof(cb) !== 'function')
    throw new TypeError('callback is required (function)');

  var self = this;
  var request = {
    path: sprintf(HEATMAP_DETAILS_FMT, customer, instrumentation, x, y)
  };
  return this.client.get(request, function(err, details) {
    if (err) return cb(self._translateError(err));

    return cb(null, details);
  });
};
CA.prototype.getInstrumentationHeatmapDetails = CA.prototype.getHeatmapDetails;


/**
 * Deletes an instrumentation from CA by instrumentation id.
 *
 * @param {String} customer the CAPI customer uuid.
 * @param {String} instrumentation the intstrumentation id.
 * @param {Function} callback of the form f(err, instrumentation).
 */
CA.prototype.deleteInstrumentation = function(customer,
                                              instrumentation,
                                              callback) {

  if (!customer) throw new TypeError('customer is required');
  if (!instrumentation) throw new TypeError('instrumentation is required');
  if (!callback || typeof(callback) !== 'function')
    throw new TypeError('callback is required (function)');

  var self = this;
  var request = {
    path: sprintf(INST_FMT, customer, instrumentation)
  };
  return this.client.del(request, function(err) {
    if (err) return callback(self._translateError(err));

    return callback();
  });
};
CA.prototype.destroyInstrumentation = CA.prototype.deleteInstrumentation;



///--- Private methods

CA.prototype._translateError = function(err) {
  assert.ok(err);
  if (!err.details || !err.details.object || !err.details.object.error) {
    // Don't send back the default "unknown error occurred" message here...
    err.message = err.restCode;
    return err;
  }

  var _err = err.details.object.error;

  var message = null;
  var status = null;

  switch (_err.code) {
  case 'ECA_INVAL':
  case 'ECA_EXISTS':
  case 'ECA_INCOMPAT':
    status = HttpCodes.Conflict;
    code = RestCodes.InvalidArgument;
    message = _err.message;
    break;
  case 'ECA_NOENT':
    status = HttpCodes.NotFound;
    code = RestCodes.NotFound;
    message = 'Resource not found.';
    break;
  default:
    status = HttpCodes.InternalError;
    code = RestCodes.UnknownError;
    message = null;
    break;
  }

  return newError({
    httpCode: status,
    restCode: code,
    message: message,
    error: err
  });
};



module.exports = CA;
