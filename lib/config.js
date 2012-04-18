/* Copyright 2012 Joyent, Inc. All rights reserved. */

var EventEmitter = require('events').EventEmitter;
var ldap = require('ldapjs');
var url = require('url');
var path = require('path');

/**
 * Constructor
 *
 * @Param {Object} options the config options object:
 *                         - svc {String} service name
 *                         - ufdsargs {Object} UFDS config options object
 *                         - dc {String} the datacenter name, if used for scoping
 *                         - host {String} the host name, if used for scoping
 *                         - nofollowref {Boolean} do not follow references
 */

function Config(options) {
  var svc = options.svc;
  var ufdsargs = options.ufdsargs
  var nofollowref = options.nofollowref || false; 

  var self = this;

  EventEmitter.call(this);

  self._ufdsargs = options.ufdsargs;
  self._ldapcfg = {canonical: {}};
  self._scopedc = options.dc;
  self._scopehost = options.host;

  this._client = ldap.createClient(ufdsargs);
  this._client.bind(ufdsargs.bindDN, ufdsargs.bindPassword, function(err) {

  var pCtrl = new ldap.PersistentSearchControl({
    type: '2.16.840.1.113730.3.4.3',
    value: {
      changeTypes: 15,
      changesOnly: false,
      returnECs: true
    }
  });
  self._client.search('svc=' + svc + ',ou=config,o=smartdc', {scope:'sub'}, [pCtrl],
    function (err, res) {

      res.on("error", function(err) { console.log(err.message) });

      res.on("searchEntry", function(entry) {

        var dn = entry.objectName.split(',');
        var dndc = undefined;
        var dnhost = undefined;

        // determine the scope of the search result
        for (var i = 0 ; i < dn.length; i++) {
          var kv = dn[i].replace(/ /g,'').split('=')
          if ( kv[0] == 'dc' )
            dndc = kv[1];
          if ( kv[0] == 'host' )
            dnhost = kv[1];
        }

        // figure out the scope of all this new data we got
        var cfgresult;
        if ( dndc ) {
          if (!self._ldapcfg[dndc]) self._ldapcfg[dndc] = {};
          cfgresult = self._ldapcfg[dndc];
        } else if ( dnhost ) {
          if (!self._ldapcfg[dnhost]) self._ldapcfg[dnhost] = {}
          cfgresult = self._ldapcfg[dnhost];
        } else {
          cfgresult = self._ldapcfg.canonical;
        }

        if (entry.object.objectclass == "config")
          self._makeconfig(entry, cfgresult);
        else if ( entry.object.objectclass == "referral" && ! nofollowref )
          self._makeref(entry,cfgresult);

      }); // on.("searchentry")
    }); // self._client.search()
  }); // self._client.bind()
}
util.inherits(Config, EventEmitter);
module.exports = Config;

/*
 * Add a config pointer to another service
 */
Config.prototype._makeref = function(entry, cfgresult) {
  var self = this;
  var refsvc = "";
  var ref = url.parse(entry.object.ref);
  var refdnElem = path.basename(ref.path).split(',');

  // we are only concerned with referrals that point at svc=...
  for (var i = 0; i < refdnElem.length; ++i) {
    if (refdnElem[i].split('=')[0] == 'svc')
      refsvc = refdnElem[i].split('=')[1];
  }

  if (ref.hostname == undefined) {
    if (refsvc) {
      var refcfgargs = {
        svc: refsvc,
        ufdsargs: self._ufdsargs,
        dc: self._scopedc,
        host: self._scopehost,
        nofollowref: true
      }
      cfgresult[refsvc] = new Config(refcfgargs);
      cfgresult[refsvc].on('update', function() { self.emit('update') });
    }
  } else {
    var connectargs = { url: ref.protocol + "//" + ref.host };

    if ( entry.object.bindDN != undefined )
      connectargs.bindDN = entry.object.bindDN;
    else
      connectargs.bindDN = self._ufdsargs.bindDN;
        
    if ( entry.object.bindPassword != undefined )
      connectargs.bindPassword = entry.object.bindPassword;
    else
      connectargs.bindPassword = self._ufdsargs.bindPassword;

    if (refsvc) {
      try {
        var refcfgargs = {
          svc: refsvc,
          ufdsargs: connectargs,
          dc: self._scopedc,
          host: self._scopehost,
          nofollowref: true
        }
        cfgresult[refsvc] = new Config(refcfgargs);
        cfgresult[refsvc].on('update', function() { self.emit('update') });
      } catch (err) {
        console.log(JSON.stringify(err));
      }
    } // if (refsvc)
  }
  self._updatekeys();
}

/*
 * Mutate self based on an ldap config entry
 */

Config.prototype._makeconfig = function(entry, cfgresult) {
  var self = this;
  var obj = entry.object;
  var entries = Object.keys(obj);
  var i = 0;

  for (i = 0; i < entries.length; ++i ) {
    // remove the internal/private variables ( starting with '_' )
    if (!/^_/.test(entries[i])) {
      var val = entries[i];
      cfgresult[entries[i]] = obj[entries[i]];
    }
  }

  self._updatekeys();
}

/*
 * update the Config object's getter keys
 */
Config.prototype._updatekeys = function() {
  
  var self = this;
  //  list of keys to update
  var keys = Object.keys(self._ldapcfg.canonical);

  if(self._ldapcfg[self._scopedc])
    keys  = keys.concat(Object.keys(self._ldapcfg[self._scopedc]));

  if(self._ldapcfg[self._scopehost])
    keys = keys.concat(Object.keys(self._ldapcfg[self._scopehost]));

  var len = keys.length;

  // make config.var work
  keys.forEach( function(val) {
    self.__defineGetter__(val, function() {
      // using host scope
      if (self._ldapcfg[self._scopehost] && self._ldapcfg[self._scopehost][val])
        return (self._ldapcfg[self._scopehost][val]);
      // using DC scope
      if (self._ldapcfg[self._scopedc] && self._ldapcfg[self._scopedc][val])
        return (self._ldapcfg[self._scopedc][val]);
      // finally fall through to canonical scope          
      return self._ldapcfg.canonical[val];          
    });

    // after updates, fire the 'update' emitter
    if ( --len <= 0 )
      self.emit('update');
  });
}

/**
 * Insert a config variable to the configuration pointed at by this object,
 * as well as LDAP
 *
 * @Param {Object} cfg The key:value pairs to add to the config
 */
Config.prototype.insert = function(cfg) {
  if (typeof(cfg) != 'object') {
    return (1);
  }
  var self = this;

  var changes = [];
  var len = Object.keys(cfg).length;

  Object.keys(cfg).forEach( function(key) {
    var ldapconfig = {};
    var mod = {};
    mod[key] = cfg[key];

    if (self._ldapcfg[key] == 'undefined')
      ldapconfig.operation = 'add';
    else
      ldapconfig.operation = 'replace';

    ldapconfig.modification = mod;

    var change = new ldap.Change(ldapconfig);
    changes.push(change);

    len--;

    if ( len <= 0 )
      self._client.modify(self.dn, changes, function(err) {
        // not really sure what the "right" thing to do is here
        if (err && err != 'null')
          console.log("Error inserting changes: " + err + "\n"); 
      });
  }); // keys(cfg).forEach
} // self.insert
