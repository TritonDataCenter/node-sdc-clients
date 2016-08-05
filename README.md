<!--
    This Source Code Form is subject to the terms of the Mozilla Public
    License, v. 2.0. If a copy of the MPL was not distributed with this
    file, You can obtain one at http://mozilla.org/MPL/2.0/.
-->

<!--
    Copyright (c) 2016, Joyent, Inc.
-->

# node-sdc-clients

This repository is part of the Joyent Triton project. See the [contribution
guidelines](https://github.com/joyent/triton/blob/master/CONTRIBUTING.md) --
*Triton does not use GitHub PRs* -- and general documentation at the main
[Triton project](https://github.com/joyent/triton) page.

Node.js client libraries for the various SDC REST API services: Amon, CA,
CNAPI, NAPI, UFDS, Packages on top of UFDS and VMAPI so far.

## Testing

Short version:

    make test

Of course, you may want to read some assumptions we made in order to ensure
the previous `make test` will run successfully.

Currently, every `test/*.test.js` file can be run separately as a different
test suite by issuing the proper commands:

    AMON_IP=10.99.99.20 \
    MACHINE_UUID=f56dbb40-1c81-4047-9d56-73fc3adf2b99 \
    make amon_test

    CA_IP=10.99.99.24 make ca_test

    make cnapi_test

    make ufds_test

    make package_test

    make vmapi_test

    make napi_test

    make imgapi_test

    make papi_test

Each one of this commands assumes you've got a running version of the proper
API service.

For every service, the following environment variables can be provided to
indicate the IP addresses where these services are running:

    AMON_IP
    CA_IP
    CNAPI_IP
    UFDS_IP
    VMAPI_IP
    NAPI_IP
    PAPI_IP

Of course, you provide each one of these environment variables to the proper
test suite make command and, in case you plan to run `make test`, i.e, all the
test suites, you may want to provide all these environment variables.

Also, note that `amon` test suite requires the UUID of a real machine to be
given as environment variable in order to be able to create real machine
probes (`MACHINE_UUID` env var).

Given UFDS, CNAPI, NAPI and VMAPI are services provided by the default headnode
core zones, if the associated IP env variables are not provided, the test
suites will set them to the default values into a COAL image running the
headnode; that is:

    CNAPI_IP=10.99.99.18
    UFDS_IP=10.99.99.14
    VMAPI_IP=10.99.99.22
    NAPI_IP=10.99.99.10
    AMON_IP=10.99.99.20
    CA_IP=10.99.99.25
    PAPI_IP=10.99.99.30

There are no default values pointing to the headnode zones for AMON and CA.
The default test values for these APIs point to `localhost` so, you may want
to either run them locally or pass in the values for these zones IPs.

So, in brief, requirements to run these test suites:

- Headnode setup, including AMON and CA zones. 
- Run the following command:

    CNAPI_IP=10.99.99.18 \
    VMAPI_IP=10.99.99.22 \
    UFDS_IP=10.99.99.14 \
    NAPI_IP=10.99.99.10 \
    CA_IP=10.99.99.25 \
    AMON_IP=10.99.99.20 \
    PAPI_IP=10.99.99.30 \
    MACHINE_UUID=f56dbb40-1c81-4047-9d56-73fc3adf2b99 \
    make test

with the different IP env vars pointing to the right IP for each zone.

Note that it's also possible to pass the ENV variable `ADMIN_PWD` to be used
with UFDS authentication tests. When not given, it will default to the
_traditional_ `joypass123`.
