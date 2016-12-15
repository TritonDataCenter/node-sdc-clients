<!--
    This Source Code Form is subject to the terms of the Mozilla Public
    License, v. 2.0. If a copy of the MPL was not distributed with this
    file, You can obtain one at http://mozilla.org/MPL/2.0/.
-->

<!--
    Copyright 2016 Joyent, Inc.
-->

# sdc-clients Changelog

## not yet released

## 10.0.4

- IMGAPI-606 Restore support to `imgapi.cliSigner` that the given keyId is
  a *path to a private SSH key*. That feature had been dropped in v9.0.0
  which meant sdc-imgapi-cli.git (which exposed the feature) could not
  update.

## 10.0.3

- IMGAPI-599 IMGAPI client broken since 10.0.0.

## 10.0.2

- TOOLS-1584 Ensure 'filters.channel' passed to IMGAPI.listImages wins over a
  channel set on the IMGAPI instance.

## 10.0.1

- IMGAPI-596 Move from restify-clients fork to restify-clients@1.4.0 with
  upstreamed HTTP proxy support.

## 10.0.0

- Update dependencies and code to support working with node v4. The most
  significant change is from a forked version of restify@2.8.5 (which added
  a few patches for HTTP proxy support) to current restify-clients@1.x
  and restify-errors@3.x.

  Note: until <https://github.com/restify/node-restify/issues/878> work is
  upstreamed to a restify-clients release, this will still be using a fork (but
  a more modern one).

- [Backward incompatible] Drop the "UFDS" client from this package. A long
  while back, it was split out to the separate
  [node-ufds](https://github.com/joyent/node-ufds) repo and `ufds` npm package.
  Users should switch to that. Get at least ufds@1.2.0 for node v4 support.
  UFDS client docs were moved to node-ufds in CAPI-524.


## 9.5.1

- IMGAPI-586: Change the endpoint URL for IMGAPI AdminReloadAuthKeys.

## 9.5.0

- IMGAPI-579: client support for IMGAPI AdminReloadAuthKeys endpoint

## sdc-clients 9.4.0

- CNS-144: new API for calculating DNS suffixes for a proposed (not yet provisioned) VM

## sdc-clients 9.3.0

- IMGAPI-536: AdminChangeImageStor, GetImage?inclAdminFields=true, ListImages?inclAdminFields=true

## sdc-clients 9.2.0

- CAPI-515: update node-ufds dependency, this pulls in fixes for CAPI-513 and others,
  as well as a lot of general cleanup work

## sdc-clients 9.1.1

- TOOLS-1327, ZAPI-722, TOOLS-1328: fixes to tests

## sdc-clients 9.1.0

- PUBAPI-1225: add client for Triton CNS
- ZAPI-655: add test for paginating listVms
- DOCKER-74: add docker build support

## sdc-clients 9.0.3

- TOOLS-1009: update libuuid to 0.1.4

## sdc-clients 9.0.2

- PUBAPI-1163: tools using sshpk should lock in an exact version
- TOOLS-1079: CNAPI#refreshSysinfoAndWait
- DOCKER-587: support docker v2 pull *by digest*

## sdc-clients 9.0.1

- Published to npm

## sdc-clients 9.0.0

- PUBAPI-1146: divorce between *_KEY_ID env vars and keyId actually sent
  to server, this affects the imgapi clients

## sdc-clients 8.1.5

- CNAPI-568: new waitTask, pollTask methods
- PUBAPI-1068: fabric networks support
- ZAPI-608: addition of vmapi.createVmAndWait function

## sdc-clients 8.1.4

- TOOLS-913: sdc-clients' imgapi.js ListImages?marker=$MARKER drops first hit even if it isn't that $MARKER image

## sdc-clients 8.1.3

- TOOLS-720: imgapi.js supports an IMGAPI URL with a base path.

## sdc-clients 8.1.1

- Channel support for imgapi.js.

## sdc-clients 8.1.0

- [Backward incompatible change.] `imgapi.createFromVm` and
  `imgapi.createFromVmAndWait` have been renamed to `imgapi.createImageFromVm`
  and `imgapi.createImageFromVmAndWait`, respectively.  There is only one
  user (AFAICT, cloudapi) so not bothering with backward compat shim.

- Add incremental support to `imgadm.createImageFromVm[AndWait]`.

## sdc-clients 8.0.0

- Backward incompatible version. Entire repo modified to work with SDC 7.0
  instead of SDC 6.5. Added clients for all the new API services replacing
  previous MAPI.

## sdc-clients 7.0.3

- [Backward incompatible change] entire repo ported to restify1.0. Mapi
  client now only speaks to /machines.  Code cut by order of magnitude.

## sdc-clients 7.0.2

- [Backword incompatible change.] `Amon.putMonitor` and `Amon.putProbe`
  methods have changed to take the monitor/probe *name* field as a
  separate argument.


## sdc-clients 7.0.1

- CAPI-104: Fix `new UFDS(...)` handling for erroneous credential options.
  Ensure no 'ready' event after an 'error' event for error to bind.

  [Backward incompatible change.] Change the 'ready' event from `UFDS` to
  not include the "bound" value: the 'ready' event means the bind was
  successful.


## sdc-clients 7.0.0

- PROV-1371: Add MAPI.{listMachines,countMachines,getMachine,getMachineByAlias}
  methods. This is a start at methods for MAPI's new "/machines/..."
  endpoints.

  The following MAPI client methods are now deprecated: countZones,
  listZones, getZoneByAlias, getZone, countVirtualMachines, listVMs,
  getVirtualMachine, getVMByAlias.

  Note that these new client methods are closer to MAPI's actual
  behaviour than, e.g. `MAPI.getZones`. For example, specifying an owner
  uuid is optional, options match the MAPI names, destroyed machines are
  returned.

  [Backward incompatible change.] Also adds an `errorFormatter` option to the
  MAPI constructor for translating MAPI error responses. A
  `MAPI.restifyErrorFormatter` is provided to get some Cavage-approved (TM)
  translation -- which was the old default behaviour:

        var client = new MAPI({
          ...,
          errorFormatter: MAPI.restifyErrorFormatter
        });

- PROV-1370: MAPI.{count,list}{Zones,VMs}: drop 'all*' options. Just always
  set 'X-Joyent-Ignore-Provisioning-State' header.

- PROV-1369: `count` in callback from `MAPI.countVMs` and `MAPI.countZones`


## sdc-clients 6.1.0

This version stuck around for a long time, from SDC 6.1 through all SDC 6.5 releases.
Initially it was set to match the SDC release version, but Mark has been shown
the error of his ways. We'll start fresh at version 7.0.0.
