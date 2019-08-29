<!--
    This Source Code Form is subject to the terms of the Mozilla Public
    License, v. 2.0. If a copy of the MPL was not distributed with this
    file, You can obtain one at http://mozilla.org/MPL/2.0/.
-->

<!--
    Copyright 2019 Joyent, Inc.
-->

# sdc-clients Changelog

## sdc-clients 8.2.0

- Backport of channel support (TRITON-886) from v12.0.0

## sdc-clients 8.1.5

- CNAPI-568: new waitTask, pollTask methods
- PUBAPI-1068: fabric networks support
- ZAPI-608: addition of vmapi.createVmAndWait funct

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
