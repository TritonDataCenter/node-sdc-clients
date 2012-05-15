/*
 * Copyright (c) 2012, Joyent, Inc. All rights reserved.
 *
 * Client library for the SDC Networking API (ZAPI)
 */

var util = require('util');
var format = util.format;

var RestifyClient = require('./restifyclient');



///--- Exported Client


/**
 * Constructor
 *
 * See the RestifyClient constructor for details
 */
function ZAPI(options) {
  RestifyClient.call(this, options);
}

util.inherits(ZAPI, RestifyClient);



///--- Machine methods



/**
 * Lists all machines
 *
 * @param {Object} params : Filter params.
 * @param {Function} callback : of the form f(err, res).
 */
ZAPI.prototype.listMachines = function(params, callback) {
  if (typeof(params) === 'function') {
    callback = params;
    params = {};
  }
  return this.get("/machines", params, callback);
};



/**
 * Gets a machine by UUID
 *
 * @param {String} uuid : the UUID of the machine.
 * @param {Function} callback : of the form f(err, res).
 */
ZAPI.prototype.getMachine = function(uuid, callback) {
  if (!uuid)
    throw new TypeError('UUID is required');

  return this.get(format("/machines/%s", uuid), callback);
};



/**
 * Creates a machine
 *
 * @param {Object} params : attributes of the machine.
 * @param {Function} callback : of the form f(err, res).
 */
ZAPI.prototype.createMachine = function(params, callback) {
  if (!params || typeof(params) !== 'object')
    throw new TypeError('params is required (object)');

  return this.post("/machines", params, callback);
};



/**
 * Stops a machine
 *
 * @param {String} uuid : the UUID of the machine.
 * @param {Function} callback : of the form f(err, res).
 */
ZAPI.prototype.stopMachine = function(uuid, callback) {
  if (!uuid)
    throw new TypeError('UUID is required');

  return this.post(format("/machines/%s", uuid), { action: 'stop' }, callback);
};



/**
 * Starts a machine
 *
 * @param {String} uuid : the UUID of the machine.
 * @param {Function} callback : of the form f(err, res).
 */
ZAPI.prototype.startMachine = function(uuid, callback) {
  if (!uuid)
    throw new TypeError('UUID is required');

  return this.post(format("/machines/%s", uuid), { action: 'start' }, callback);
};



/**
 * Reboots a machine
 *
 * @param {String} uuid : the UUID of the machine.
 * @param {Function} callback : of the form f(err, res).
 */
ZAPI.prototype.rebootMachine = function(uuid, callback) {
  if (!uuid)
    throw new TypeError('UUID is required');

  return this.post(format("/machines/%s", uuid), { action: 'reboot' }, callback);
};



/**
 * Destroys a machine
 *
 * @param {String} uuid : the UUID of the machine.
 * @param {Function} callback : of the form f(err, res).
 */
ZAPI.prototype.destroyMachine = function(uuid, callback) {
  if (!uuid)
    throw new TypeError('UUID is required');

  return this.del(format("/machines/%s", uuid), callback);
};



module.exports = ZAPI;
