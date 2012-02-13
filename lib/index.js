// Copyright 2011 Joyent, Inc.  All rights reserved.

var log = require('restify').log;

var Amon = require('./amon');
var CA = require('./ca');
var CAPI = require('./capi');
var MAPI = require('./mapi');

try {
  var UFDS = require('./ufds');
} catch (e) {
  var UFDS = {};
}

module.exports = {
  Amon: Amon,
  CA: CA,
  CAPI: CAPI,
  MAPI: MAPI,
  UFDS: UFDS,

  /**
   * Sets the log level.
   *
   * @param {String} the level. Can be one of these:
   *         "trace" "debug" "info" "warn" "error" "fatal" "off".
   */
  setLogLevel: function(level) {
    // Set uppercase
    var upper = level.replace(/\b(.)(.*)/, function(m, first, rest) {
      return first.toUpperCase() + rest.toLowerCase();
    });

    var l = log.Level[upper];

    if (!l) {
      throw new TypeError('Unknown log level. Try one of these ' +
                          JSON.stringify(log.Level));
    }

    log.level(l);
  }

};
