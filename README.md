# Node.js clients for Smart DataCenter APIs

Where? <git@git.joyent.com:node-sdc-clients.git>
Who? Mark Cavage.
What APIs? Currently, CA (cloud analytics) and CAPI.


# Example?

    var clients = require('sdc-clients');

    var CAPI = new clients.CAPI({
        url: "http://10.99.99.11",
        username: "admin",
        password: "admin's password",
    });
    CAPI.authenticate(username, password, function(err, customer) {});

    var CA = new clients.CA({url: "..."});
    CA.listSchema(customer, function(err, schema) {});


# Docs?

See the inline jsdoc. We should generate HTML docs from those. Have any
suggestions for that?

