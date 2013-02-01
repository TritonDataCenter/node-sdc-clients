// Copyright 2012 Joyent, Inc.  All rights reserved.

var Logger = require('bunyan');
var UsageAPI = require('../lib/index').UsageAPI;
var util = require('util');


// --- Globals

var USAGEAPI_IP = process.env.USAGEAPI_IP || '10.99.99.28';
var USAGEAPI_URL = 'http://' + USAGEAPI_IP;
var CUSTOMER = '00000000-0000-0000-0000-000000000000';

var usageapi, REPORT_LOCATION;

var finish = new Date(Date.now()).toISOString();
var start = new Date(Date.now() - (24 * 3600 * 1000)).toISOString();

exports.setUp = function (callback) {
    var logger = new Logger({
            name: 'usageapi_unit_test',
            stream: process.stderr,
            level: (process.env.LOG_LEVEL || 'info'),
            serializers: Logger.stdSerializers
    });

    usageapi = UsageAPI({
        url: USAGEAPI_URL,
        retry: {
            retries: 1,
            minTimeout: 1000
        },
        log: logger,
        username: process.env.USAGEAPI_USERNAME || 'admin',
        password: process.env.USAGEAPI_PASSWORD || 'joypass123',
        agent: false
    });

    callback();
};


exports.test_get_not_generated_report = function (t) {
    usageapi.getReport({
//        owners: CUSTOMER,
        start: start,
        finish: finish
    }, function (err, report) {
        t.ok(err, 'Get Not Generated Report Error');
        t.equal(err.statusCode, 404);
        t.done();
    });
};

exports.test_generate_report = function (t) {
    usageapi.generateReport({
//        owners: CUSTOMER,
        start: start,
        finish: finish
    }, function (err, loc) {
        t.ifError(err, 'Generate Report Error');
        t.ok(loc, 'report location OK');
        REPORT_LOCATION = loc;
        t.done();
    });
};

exports.test_get_report = function (t) {
    function waitForReport() {
        usageapi.getReport(REPORT_LOCATION, function (err, report) {
            t.ifError(err, 'Get Report Error');
            t.ok(report, 'report OK');
            if (report.status !== 'error' && report.status !== 'done') {
                t.equal(Object.keys(report.report).length, 0);
                setTimeout(waitForReport, 500);
            } else {
                t.equal(report.status, 'done');
                t.ok(Array.isArray(report.report.vms));
                t.done();
            }
        });
    }
    waitForReport();
};
