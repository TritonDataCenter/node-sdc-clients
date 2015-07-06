/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

var Logger = require('bunyan'),
    restify = require('restify'),
    DSAPI = require('../lib/index').DSAPI,
    util = require('util');

var libuuid = require('libuuid');
function uuid() {
    return (libuuid.create());
}

// --- Globals

var DSAPI_URL = process.env.DSAPI_URL || 'https://datasets.joyent.com';

var dsapi, IMAGES;

exports.setUp = function (callback) {
    var logger = new Logger({
            name: 'dsapi.test',
            stream: process.stderr,
            level: (process.env.LOG_LEVEL || 'info'),
            serializers: Logger.stdSerializers
    });

    dsapi = new DSAPI({
        url: DSAPI_URL,
        retry: {
            retries: 1,
            minTimeout: 1000
        },
        log: logger,
        agent: false,
        rejectUnauthorized: false
    });

    callback();
};


exports.test_list_images = function (t) {
    dsapi.listImages(function (err, images, res) {
        t.ifError(err, 'listImages Error');
        t.ok(images, 'listImages OK');
        if (images) {
            IMAGES = images;
            IMAGES.forEach(function (ds) {
                t.ok(ds.name, 'ds.name OK');
                t.ok(ds.version, 'ds.version OK');
                t.ok(ds.os, 'ds.os OK');
                t.ok(ds.urn, 'ds.urn OK');
                t.ok(ds.uuid, 'ds.uuid OK');
            });
        }
        t.ok(res, 'listImages response object');
        t.done();
    });
};


exports.test_get_image = function (t) {
    dsapi.getImage(IMAGES[0].uuid, function (err, img) {
        t.ifError(err, 'getImage Error');
        t.ok(img, 'getImage OK');
        t.equal(img.urn, IMAGES[0].urn);
        t.done();
    });
};


exports.tearDown = function (callback) {
    dsapi.close();
    callback();
};
