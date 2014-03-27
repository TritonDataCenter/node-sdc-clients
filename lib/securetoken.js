/*
 * Copyright (c) 2014, Joyent, Inc. All rights reserved.
 *
 * Joyent needs some means to securely pass data, using public clients,
 * between services; typically this is used to validate that a client is who
 * it claims to be.
 *
 * SecureToken is a means to do this. It takes a single key which is used
 * for future tokens, and a hash of keys for decoding past tokens. The encode()
 * method takes a Javascript object and converts it into a secure token. The
 * process involves serializing and gzipping the object, encrypting it with the
 * current encryption key, then producing a HMAC to prevent tampering.
 * Decryption is just the reverse of this process, although it also involves
 * looking up a key in a hash table, since different keys were used for
 * different clients and periods in the past.
 *
 * There is some wackiness and minor weaknesses with the token generation which
 * should be improved; it's written the current way for backwards compatibility.
 */

var crypto = require('crypto');
var zlib   = require('zlib');

var API_VERSION = '0.1.0';
crypto.DEFAULT_ENCODING = 'binary';



/**
 * Constructor. Takes keys and converts them into a format with SecureToken
 * uses internally (primarily, just converts from hex to binary buffers).
 *
 * @param {Object} encryptionKey : key and UUID used for all token generation.
 * @param {Object} decryptionKeys : past keys and UUIDs needed for decoding.
 */

function SecureToken(encryptionKey, decryptionKeys) {
    var self = this;

    self.encryptionKey  = {
        uuid: encryptionKey.uuid,
        key: new Buffer(encryptionKey.key, 'hex').toString('binary')
    };

    self.decryptionKeys = {};
    decryptionKeys.forEach(function (key) {
        self.decryptionKeys[key.uuid] = {
           uuid: key.uuid,
           key: new Buffer(key.key, 'hex').toString('binary')
        };
    });
}

module.exports = SecureToken;



/**
 * Takes an object, gzips and encrypts it, and generates an HMAC. Returns a
 * secure token which can later be passed to decrypt() to retrieve the
 * original object.
 *
 * @param {Object} obj : the data to convert into a secure token.
 * @param {Function} cb : callback invoked upon error or token generation.
 */

SecureToken.prototype.encrypt =
function (obj, cb) {
    var self = this;

    var json = JSON.stringify(obj);

    return zlib.gzip(json, function (err, gzdata) {
       if (err)
           return cb(err);

       var tokdata = {
           date: new Date().toISOString(),
           data: gzdata.toString('binary')
       };

       var key = self.encryptionKey.key;

       var cipher = crypto.createCipher('aes128', key);
       var crypted = cipher.update(JSON.stringify(tokdata), 'binary', 'base64');
       crypted += cipher.final('base64');

       var hasher = crypto.createHmac('sha256', key);
       hasher.update(crypted);
       var hash = hasher.digest('base64');

       var token = {
           keyid: self.encryptionKey.uuid,
           data: crypted,
           version: API_VERSION,
           hash: hash
       };

       return cb(null, token);
    });
};



/**
 * Takes a secure token verifies it hasn't been tampered with, then decrypts and
 * gunzips into the original object that was passed to encrypt().
 *
 * @param {Object} token : the secure token to convert back into an object.
 * @param {Function} cb : callback invoked upon error or object decoding.
 */

SecureToken.prototype.decrypt =
function (token, cb) {
    var self = this;

    if (!token || typeof (token) !== 'object' ||
        typeof (token.keyid) !== 'string' || typeof (token.data) !== 'string' ||
        typeof (token.hash) !== 'string' || typeof (token.version) !== 'string')
        return cb('Invalid token');

    if (token.version !== API_VERSION)
        return cb('Unknown version');

    var decryptionKey = self.decryptionKeys[token.keyid];
    if (!decryptionKey)
        return cb('Unknown keyid');

    var key = decryptionKey.key;

    try {
        var hasher = crypto.createHmac('sha256', key);
        hasher.update(token.data);
        var hash = hasher.digest('base64');
    } catch (e) {
        return cb('Error generating HMAC from data');
    }

    if (hash !== token.hash)
        return cb('Invalid hash');

    try {
        var decipher = crypto.createDecipher('aes128', key);
        var decrypted = decipher.update(token.data, 'base64', 'binary');
        decrypted += decipher.final('binary');
    } catch (e) {
        return cb('Unable to decipher data');
    }

    try {
        var decryptData = JSON.parse(decrypted).data;
    } catch (e) {
        return cb('Unable to decode JSON before gunzipping');
    }

    return zlib.gunzip(new Buffer(decryptData, 'binary'), function (err, res) {
        if (err)
            return cb('Could not decompress token');

        try {
            var obj = JSON.parse(res.toString());
        } catch (e) {
            return cb('Unable to decode JSON after gunzipping');
        }

        return cb(null, obj);
    });
};
