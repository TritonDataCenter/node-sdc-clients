// Copyright 2011 Joyent, Inc.  All rights reserved.

var CAPI = require('./capi');
var log = require('restify').log;

module.exports = {

  CAPI: CAPI,

  /**
   * Sets the log level.
   *
   * @param {String} the level. Can be one of these:
   * "trace" "debug" "info" "warn" "error" "fatal" "off"
   */
  setLogLevel: function(level) {
    // Set uppercase
    var upper = level.replace(/\b(.)(.*)/, function(m, first, rest) {
      return first.toUpperCase() + rest.toLowerCase();
    });

    var l = log.Level[upper];

    if (!l) {
      throw new Error("Unknown log level. Try one of these " +
          JSON.stringify(log.Level));
    }

    log.level(l);
  }

};
