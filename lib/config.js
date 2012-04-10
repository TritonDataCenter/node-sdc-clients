var EventEmitter = require('events').EventEmitter;
var ldap = require('ldapjs');
var url = require('url');
var path = require('path');

function Config(svc, ufdsargs, nofollowref) {
  nofollowref = nofollowref || false; 
  var self = this;

  self.updates = new EventEmitter()

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
  self.client.search('svc=' + svc + ',o=smartdc', {scope:'sub'}, [pCtrl],
    function (err, res) {
      res.on("searchEntry", function(entry) {
        if (entry.object.objectclass == "config") {
          var obj = entry.object;
          var entries = Object.keys(obj);
          var i = 0;
          for (i = 0; i < entries.length; ++i ) {
            // remove the internal/private variables ( starting with '_' )
            if (!/^_/.test(entries[i])) {
               self[entries[i]] = obj[entries[i]];
            }
          }
          self.updates.emit('update');
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
              self[refSvc] = new Config(refSvc, ufdsargs, true);
              self[refSvc].updates.on('update', function() { self.updates.emit('update') });
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
                self[refSvc] = new Config(refSvc, connectargs, true);
                self[refSvc].updates.on('update', function() { self.updates.emit('update') });
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
      if (self[key] == 'undefined')
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
