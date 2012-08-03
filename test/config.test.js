// Copyright 2012 Joyent, Inc.  All rights reserved.

var Logger = require('bunyan');
var restify = require('restify');
var uuid = require('node-uuid');

var Config = require('../lib/index').Config;



// --- Globals

var UFDS_URL = 'ldaps://' + (process.env.UFDS_IP || '10.99.99.16');
var SVC_NAME = 'myfakeservice';

var config;


// --- Tests

exports.setUp = function (callback) {
    config = new Config({
        svc: SVC_NAME,
        ufds: {
            url: UFDS_URL,
            bindDN: 'cn=root',
            bindPassword: 'secret'
        }
    }, callback);

    return (config);
};


exports.test_insert = function (test) {
    var properties = {
        foo: 'bar'
    };

    config.insert(properties, 'svc=myfakeservice,ou=config,o=smartdc');
    test.done();
};

exports.tearDown = function (callback) {
    return (callback());
};
