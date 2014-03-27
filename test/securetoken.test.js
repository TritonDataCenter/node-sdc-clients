/*
 * Copyright 2014 Joyent, Inc.  All rights reserved.
 */

var crypto = require('crypto');
var zlib   = require('zlib');
var SecureToken = require('../lib/index').SecureToken;



crypto.DEFAULT_ENCODING = 'binary'; // sigh



var keys = [ {
    uuid: '8ea74e99-91d5-4207-9822-7096900b44c5',
    key: '499d7d5db79b25d9be22197d869b38bb8b2dbb5e86ba3565b4fbd542e1b1bd33',
    timestamp: '2014-03-25T10:47:19.342Z'
}, {
    uuid: '2022a43b-1699-46e9-9233-517a4dbeffd8',
    key: '647e49528b7e046c703c150295eb0f3643c0d42e62e91484df67892a9613e5d6',
    timestamp: '2014-03-26T10:52:52.381Z'
} ];

// tokenizer is normal encrypt/decrypt usage. tokenizerOld is just so we can
// generate tokens with a different (older) key.
var tokenizer     = new SecureToken(keys[1], keys);
var tokenizerOld  = new SecureToken(keys[0], []);
var exampleObject = { foo: 1, bar: ['baz'] };
var exampleToken;
var exampleOldToken;



exports.test_round_trip = function (t) {
    tokenizer.encrypt(exampleObject, function (err, token) {
        t.ifError(err);

        t.equal(token.keyid, keys[1].uuid);
        t.equal(token.version, '0.1.0');
        t.ok(token.data);
        t.ok(token.hash);

        // so we can use this for other tests too
        exampleToken = token;

        tokenizer.decrypt(token, function (err, newObj) {
            t.ifError(err);
            t.deepEqual(newObj, exampleObject);

            t.done();
        });
    });
};



exports.test_decrypt_different_key = function (t) {
    tokenizerOld.encrypt(exampleObject, function (err, token) {
        t.ifError(err);

        // so we can use this for other tests too
        exampleOldToken = token;

        tokenizer.decrypt(token, function (err, newObj) {
            t.ifError(err);
            t.deepEqual(newObj, exampleObject);

            t.done();
        });
    });
};



exports.test_decrypt_wrong_key = function (t) {
    var token = deepCopy(exampleToken);
    token.keyid = '7ea17610-3c7b-4859-94fb-2bf81cdc9fce';

    tokenizer.decrypt(token, function (err, newObj) {
        t.equal(err, 'Unknown keyid');
        t.ifError(newObj);

        t.done();
    });
};



exports.test_decrypt_wrong_version = function (t) {
    var token = deepCopy(exampleToken);
    token.version = '0.1.1';

    tokenizer.decrypt(token, function (err, newObj) {
        t.equal(err, 'Unknown version');
        t.ifError(newObj);

        t.done();
    });
};



exports.test_decrypt_wrong_hash = function (t) {
    var token = deepCopy(exampleToken);
    token.hash = exampleOldToken.hash;

    tokenizer.decrypt(token, function (err, newObj) {
        t.equal(err, 'Invalid hash');
        t.ifError(newObj);

        t.done();
    });
};



exports.test_decrypt_wrong_data = function (t) {
    var token = deepCopy(exampleToken);
    token.data = exampleOldToken.data;

    tokenizer.decrypt(token, function (err, newObj) {
        t.equal(err, 'Invalid hash');
        t.ifError(newObj);

        t.done();
    });
};



exports.test_decrypt_malformed_data = function (t) {
    var token = deepCopy(exampleToken);
    token.data = token.data.slice(0, 5);

    tokenizer.decrypt(token, function (err, newObj) {
        t.equal(err, 'Invalid hash');
        t.ifError(newObj);

        t.done();
    });
};



exports.test_decrypt_malformed_hash = function (t) {
    var token = deepCopy(exampleToken);
    token.hash = token.hash.slice(0, 5);

    tokenizer.decrypt(token, function (err, newObj) {
        t.equal(err, 'Invalid hash');
        t.ifError(newObj);

        t.done();
    });
};



exports.test_decrypt_malformed_token = function (t) {
    tokenizer.decrypt('asd', function (err, newObj) {
        t.equal(err, 'Invalid token');
        t.ifError(newObj);

        t.done();
    });
};



exports.test_decrypt_missing_token = function (t) {
    tokenizer.decrypt(null, function (err, newObj) {
        t.equal(err, 'Invalid token');
        t.ifError(newObj);

        t.done();
    });
};



exports.test_decrypt_missing_keyid = function (t) {
    var token = deepCopy(exampleToken);
    delete token.keyid;

    tokenizer.decrypt(token, function (err, newObj) {
        t.equal(err, 'Invalid token');
        t.ifError(newObj);

        t.done();
    });
};



exports.test_decrypt_missing_hash = function (t) {
    var token = deepCopy(exampleToken);
    delete token.hash;

    tokenizer.decrypt(token, function (err, newObj) {
        t.equal(err, 'Invalid token');
        t.ifError(newObj);

        t.done();
    });
};



exports.test_decrypt_missing_data = function (t) {
    var token = deepCopy(exampleToken);
    delete token.data;

    tokenizer.decrypt(token, function (err, newObj) {
        t.equal(err, 'Invalid token');
        t.ifError(newObj);

        t.done();
    });
};


exports.test_decrypt_missing_version = function (t) {
    var token = deepCopy(exampleToken);
    delete token.data;

    tokenizer.decrypt(token, function (err, newObj) {
        t.equal(err, 'Invalid token');
        t.ifError(newObj);

        t.done();
    });
};


exports.test_decrypt_invalid_keyid = function (t) {
    var token = deepCopy(exampleToken);
    token.keyid = [];

    tokenizer.decrypt(token, function (err, newObj) {
        t.equal(err, 'Invalid token');
        t.ifError(newObj);

        t.done();
    });
};



exports.test_decrypt_invalid_hash = function (t) {
    var token = deepCopy(exampleToken);
    token.hash = [];

    tokenizer.decrypt(token, function (err, newObj) {
        t.equal(err, 'Invalid token');
        t.ifError(newObj);

        t.done();
    });
};



exports.test_decrypt_invalid_data = function (t) {
    var token = deepCopy(exampleToken);
    token.data = [];

    tokenizer.decrypt(token, function (err, newObj) {
        t.equal(err, 'Invalid token');
        t.ifError(newObj);

        t.done();
    });
};



exports.test_decrypt_invalid_version = function (t) {
    var token = deepCopy(exampleToken);
    token.version = [];

    tokenizer.decrypt(token, function (err, newObj) {
        t.equal(err, 'Invalid token');
        t.ifError(newObj);

        t.done();
    });
};



exports.test_malformed_json = function (t) {
    var badJson = '{ "a"';
    var key = new Buffer(keys[0].key, 'hex').toString('binary');
    var keyUuid = keys[0].uuid;

    return zlib.gzip(badJson, function (err, gzdata) {
        var tokdata = JSON.stringify({
            date: new Date().toISOString(),
            data: gzdata.toString('binary')
        });

        var cipher = crypto.createCipher('aes128', key);
        var crypted = cipher.update(tokdata, 'binary', 'base64');
        crypted += cipher.final('base64');

        var hasher = crypto.createHmac('sha256', key);
        hasher.update(crypted);
        var hash = hasher.digest('base64');

        var token = {
            keyid: keyUuid,
            data: crypted,
            version: '0.1.0',
            hash: hash
        };

        tokenizer.decrypt(token, function (err, newObj) {
            t.equal(err, 'Unable to decode JSON after gunzipping');
            t.ifError(newObj);

            t.done();
        });
    });
};



exports.test_malformed_gzip = function (t) {
    var key = new Buffer(keys[0].key, 'hex').toString('binary');
    var keyUuid = keys[0].uuid;

    var tokdata = JSON.stringify({
        date: new Date().toISOString(),
        data: '\0000\0001\0002'
    });

    var cipher = crypto.createCipher('aes128', key);
    var crypted = cipher.update(tokdata, 'binary', 'base64');
    crypted += cipher.final('base64');

    var hasher = crypto.createHmac('sha256', key);
    hasher.update(crypted);
    var hash = hasher.digest('base64');

    var token = {
        keyid: keyUuid,
        data: crypted,
        version: '0.1.0',
        hash: hash
    };

    tokenizer.decrypt(token, function (err, newObj) {
        t.equal(err, 'Could not decompress token');
        t.ifError(newObj);

        t.done();
    });
};



function deepCopy(obj) {
    if (typeof (obj) !== 'object')
        return obj;

    if (obj === null)
        return null;

    var clone;

    if (Array.isArray(obj)) {
      clone = [];

      for (var i = obj.length - 1; i >= 0; i--) {
        clone[i] = deepCopy(obj[i]);
      }
    } else {
      clone = {};

      for (i in obj) {
        clone[i] = deepCopy(obj[i]);
      }
    }

    return clone;
}
