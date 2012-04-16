var EventEmitter = require('events').EventEmitter;
var ldap = require('ldapjs');
var url = require('url');
var path = require('path');

function Config(svc, ufdsargs, scopedc, scopehost, nofollowref) {
  var nofollowref = nofollowref || false; 
  var self = this;
  self.updates = new EventEmitter();
  
  self.ldapcfg = {canonical: {}};
  self.scopedc = scopedc;
  self.scopehost = scopehost;
  this.client = ldap.createClient(ufdsargs);
  this.client.bind(ufdsargs.bindDN, ufdsargs.bindPassword, function(err) {

  var pCtrl = new ldap.PersistentSearchControl({
    type: '2.16.840.1.113730.3.4.3',
    value: {
      changeTypes: 15,
      changesOnly: false,
      returnECs: true
    }
  });
  self.client.search('svc=' + svc + ',ou=config,o=smartdc', {scope:'sub'}, [pCtrl],
    function (err, res) {
      res.on("error", function(err) { console.log(err.message) });
      res.on("searchEntry", function(entry) {
        var dn = entry.objectName.split(',');
        var dndc = undefined;
        var dnhost = undefined;
        for (var i = 0 ; i < dn.length; i++) {
          var kv = dn[i].replace(/ /g,'').split('=')
          if ( kv[0] == 'dc' )
            dndc = kv[1];
          if ( kv[0] == 'host' )
            dnhost = kv[1];
        }
        var cfgresult;
        if ( dndc ) {
          if (!self.ldapcfg[dndc]) self.ldapcfg[dndc] = {};
          cfgresult = self.ldapcfg[dndc];
	} else if ( dnhost ) {
          if (!self.ldapcfg[dnhost]) self.ldapcfg[dnhost] = {}
          cfgresult = self.ldapcfg[dnhost];
	} else {
          cfgresult = self.ldapcfg.canonical;
        }

        if (entry.object.objectclass == "config") {
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
          var keys = Object.keys(self.ldapcfg.canonical);
          if(self.ldapcfg[scopedc])
            keys  = keys.concat(Object.keys(self.ldapcfg[self.scopedc]));
          if(self.ldapcfg[scopehost])
            keys = keys.concat(Object.keys(self.ldapcfg[self.scopehost]));
          var len = keys.length;
          keys.forEach( function(val) {
            self.__defineGetter__(val, function() {
              if (self.ldapcfg[self.scopehost] && self.ldapcfg[self.scopehost][val])
                return (self.ldapcfg[self.scopehost][val]);
              if (self.ldapcfg[self.scopedc] && self.ldapcfg[self.scopedc][val])
                return (self.ldapcfg[self.scopedc][val]);
              return self.ldapcfg.canonical[val];
            });
            if ( --len <= 0 )
              self.updates.emit('update');
          });
        } else if ( entry.object.objectclass == "referral" && ! nofollowref ) {
          var refSvc = "";
          var ref = url.parse(entry.object.ref);
          var refdnElem = path.basename(ref.path).split(',');
          // we are only concerned with referrals that point at svc=...
          for (i = 0; i < refdnElem.length; ++i) {
            if (refdnElem[i].split('=')[0] == 'svc')
              refSvc = refdnElem[i].split('=')[1];
          }
          if (ref.hostname == undefined) {
            if (refSvc) {
              cfgresult[refSvc] = new Config(refSvc, ufdsargs, self.scopedc, self.scopehost, true);
              cfgresult[refSvc].updates.on('update', function() { self.updates.emit('update') });
            }
          } else {
            var connectargs = { url: ref.protocol + "//" + ref.host };
            if ( entry.object.bindDN != undefined )
              connectargs.bindDN = entry.object.bindDN;
            else
              connectargs.bindDN = ufdsargs.bindDN;
            if ( entry.object.bindPassword != undefined )
              connectargs.bindPassword = entry.object.bindPassword;
            else
              connectargs.bindPassword = ufdsargs.bindPassword;

            if (refSvc) {
              try {
                cfgresult[refSvc] = new Config(refSvc, connectargs, self.scopedc, self.scopehost, true);
                cfgresult[refSvc].updates.on('update', function() { self.updates.emit('update') });
              } catch (err) {
                console.log(JSON.stringify(err));
              }
            }
          }
        }
      });
    });
  });
  self.insert = function(cfg) {
    if (typeof(cfg) != 'object') {
      return (1);
    }
    var changes = [];
    var len = Object.keys(cfg).length;
    Object.keys(cfg).forEach( function(key) {
      var ldapconfig = {};
        var mod = {};
        mod[key] = cfg[key];
      if (self.ldapcfg[key] == 'undefined')
        ldapconfig.operation = 'add';
      else
        ldapconfig.operation = 'replace';
      ldapconfig.modification = mod;
      var change = new ldap.Change(ldapconfig);
      changes.push(change);
      len--;
      if ( len <= 0 )
        self.client.modify(self.dn, changes, function(err) {
          // not really sure what the "right" thing to do is here
          if (err && err != 'null')
            console.log("Error inserting changes: " + err + "\n"); 
        });
    }); 
    return (0);
  };
}

exports.config = Config;
