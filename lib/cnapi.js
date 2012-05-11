/*
 * Copyright (c) 2012, Joyent, Inc. All rights reserved.
 *
 * Client library for the SDC Compute Node API (CNAPI)
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
function CNAPI(options) {
  RestifyClient.call(this, options);
}

util.inherits(CNAPI, RestifyClient);


/**
 * Gets boot params for the given CN
 *
 * @param {String} uuid : CN UUID to get
 * @param {Function} callback : of the form f(err, res).
 */
CNAPI.prototype.getBootParams = function(uuid, callback) {
  if (!uuid)
    throw new TypeError('uuid is required (string)');
  return this.get(format("/boot/%s", uuid), callback);
};


module.exports = CNAPI;
