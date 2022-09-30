<!--
    This Source Code Form is subject to the terms of the Mozilla Public
    License, v. 2.0. If a copy of the MPL was not distributed with this
    file, You can obtain one at http://mozilla.org/MPL/2.0/.
-->

<!--
    Copyright 2019 Joyent, Inc.
-->

# node-sdc-clients

This repository is part of the Triton project. See the [contribution
guidelines](https://github.com/TritonDataCenter/triton/blob/master/CONTRIBUTING.md)
and general documentation at the main
[Triton project](https://github.com/TritonDataCenter/triton) page.

This repository holds Node.js client libraries for many of the core Triton REST APIs:
Amon, CA, CNS, CNAPI, FWAPI, IMGAPI, NAPI, PAPI, SAPI, VMAPI.

Node.js client libraries for other Triton APIs are in other repos. For example see:
- [node-ufds](https://github.com/TritonDataCenter/node-ufds): client for Triton's core UFDS service
- [node-moray](https://github.com/TritonDataCenter/node-moray): client for Triton's core Moray service
- [node-triton](https://github.com/TritonDataCenter/node-triton): Triton CloudAPI client and CLI
- [node-manta](https://github.com/TritonDataCenter/node-manta): Manta client and CLI
- [wf-client](https://github.com/TritonDataCenter/sdc-wf-client): client for Triton's core
  Workflow API service


## Testing

To run the tests from a Triton DataCenter global zone:

    ./test/runtests

Or to run the test suite remotely (say you are developing on Mac and want to test
against your CoaL):

    ./test/runtests -H root@10.99.99.7

To run a single one of the files use the `-f FILTER` option, e.g.

    ./test/runtests -H root@10.99.99.7 -f ./test/napi.test.js


## Development

Before commit, ensure that the following checks are clean:

    make prepush


## Releases

Changes with possible user impact should:

1. Add a note to the changelog (CHANGES.md).
2. Bump the package version appropriately.
3. Once merged to master, the new version should be tagged and published to npm
   via:

        make cutarelease

   To list to npm accounts that have publish access:

        npm owner ls sdc-clients

The desire is that users of this package use published versions in their
package.json `dependencies`, rather than depending on git shas.
