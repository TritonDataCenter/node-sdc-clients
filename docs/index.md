---
title: node-sdc-clients
markdown2extras: tables, code-friendly
---
<!--
    This Source Code Form is subject to the terms of the Mozilla Public
    License, v. 2.0. If a copy of the MPL was not distributed with this
    file, You can obtain one at http://mozilla.org/MPL/2.0/.
-->

<!--
    Copyright (c) 2014, Joyent, Inc.
-->

# node-sdc-clients

node-sdc-clients provides node.js client libraries for SDC Services.

# UFDS API Client

## UFDS(options)

Creates a UFDS client instance.

Options must be an object that contains

| Name | Type | Description |
| ---- | ---- | ----------- |
| url | String | UFDS location |
| bindDN | String | admin bindDN for UFDS. |
| password | String | password to said adminDN |
| cache | Object or *false* | age(Default 60s) size(default 1k) *false* to disable |


## close(callback)

Unbinds the underlying LDAP client.

| Name | Type | Description |
| ---- | ---- | ----------- |
| callback | Function | optional* callback of the form ``f(err)``. |




## authenticate(username, password, cb)

Checks a user's password in UFDS.

Returns a RestError of '401' if password mismatches. Returns the same user
object as getUser on success.

### Arguments:

| Name | Type | Description |
| ---- | ---- | ----------- |
| login | String | login one of login, uuid or the result of getUser. |
| password | String | password correct password. |
| cb | Function | callback of the form ``fn(err, user)``. |

### Throws:

| Error | Description |
| ----- | ----------- |
| TypeError | on bad input |




## addUser(user, callback)

Adds a new user into UFDS.

This call expects the user object to look like the `sdcPerson` UFDS
schema, minus objectclass/dn/uuid.

| Name | Type | Description |
| ---- | ---- | ----------- |
| user | Object | the entry to add. |
| callback | Function | callback of the form ``fn(err, user).`` |

### Throws

| Error | Description |
| ----- | ----------- |
| TypeError | on bad input |




## getUser(login, callback)

Looks up a user by login to UFDS.

| Name | Type | Description |
| ---- | ---- | ----------- |
| login | String | login (or uuid) for a customer. |
| options | Object | options (optional). |
| callback | Function | callback of the form f(err, user). |

### Throws

| Error | Description |
| ----- | ----------- |
| TypeError | on bad input. |



## updateUser(user, changes, callback)

Updates a user record.

| Name | Type | Description |
| ---- | ---- | ----------- |
| user | String or Object | The user UUID or login string or a user object with a `user.dn`, `user.uuid` or `user.login` (i.e. a user object as from `getUser`).user the user record you got from getUser. |
| changes | Object | Changes to the object you want merged in. For example: `{myfield: "blah"}` will add/replace the existing `myfield`. You can delete an existing field by passing in a null value, e.g.: `{addthisfield: "blah", rmthisfield: null}`. |
| callback | Function | callback of the form `function (err, user)`. |

### Throws

| Error | Description |
| ----- | ----------- |
| TypeError | on bad input. |



## deleteUser(user, callback)

Deletes a user record.

| Name | Type | Description |
| ---- | ---- | ----------- |
| user | Object | user the user record you got from getUser. |
| callback | Function | callback of the form ``fn(err, user)``. |

### Throws

| Error | Description |
| ----- | ----------- |
| TypeError | on bad input |





## addKey(user, key, callback)

Adds a new SSH key to a given user record.

You can either pass in an SSH public key (string) or an object of the form

    {
      name: foo,
      openssh: public key
    }

This method will return you the full key as processed by UFDS. If you don't
pass in a name, then the name gets set to the fingerprint of the SSH key.

| Name | Type | Description |
| ---- | ---- | ----------- |
| user | Object | the user record you got from getUser. |
| key | String | the OpenSSH public key. |
| callback | Function | callback of the form `fn(err, key)`. |




### Throws

| Error | Description |
| ----- | ----------- |
| TypeError | on bad input. |





## getKey(user, fingerprint, callback)

Retrieves an SSH key by fingerprint.

| Name | Type | Description |
| ---- | ---- | ----------- |
| user | Object | user the object you got back from getUser. |
| fingerprint | String | fingerprint the SSH fp (or name) of the SSH key you want. |
| callback | Function | callback of the form `fn(err, key)`. |

### Throws

| Error | Description |
| ----- | ----------- |
| TypeError | on bad input. |





## listKeys(user, callback)

Loads all keys for a given user.

| Name | Type | Description |
| ---- | ---- | ----------- |
| user | Object | user the user you got from getUser. |
| callback | Function | callback of the form fn(err, keys). |

### Throws

| Error | Description |
| ----- | ----------- |
| TypeError | on bad input. |






## deleteKey(user, key, callback)

Deletes an SSH key under a user.

| Name | Type | Description |
| ---- | ---- | ----------- |
| user | User | the object you got back from getUser. |
| key | Object | key the object you got from getKey. |
| callback | Function | callback of the form fn(err, key). |

### Throws

| Error | Description |
| ----- | ----------- |
| TypeError | on bad input. |






## listLimits(user, callback)

Lists "CAPI" limits for a given user.

| Name | Type | Description |
| ---- | ---- | ----------- |
| user | Object | the object returned from ``getUser`` |
| callback | Function | callback of the form ``fn(err, limits)`` |

### Throws

| Error | Description |
| ----- | ----------- |
| TypeError | on bad input. |





## getLimit(user, datacenter, callback)

Gets a "CAPI" limit for a given user.

| Name | Type | Description |
| ---- | ---- | ----------- |
| user | Object | user the object returned from getUser. |
| datacenter | String | datacenter the datacenter name. |
| callback | Function | callback of the form fn(err, limits). |

### Throws

| Error | Description |
| ----- | ----------- |
| TypeError | on bad input. |






## addLimit(user, limit, callback)

Creates a "CAPI"" limit for a given user.

| Name | Type | Description |
| ---- | ---- | ----------- |
| user | Object | the object returned from getUser. |
| limit | Object | the limit to add. |
| callback | Function | callback of the form ``fn(err, limits)`` |







## updateLimit(user, limit, callback)

Updates a "CAPI"" limit for a given user.

| Name | Type | Description |
| ---- | ---- | ----------- |
| user | Object | the object returned from getUser. |
| limit | Object | the limit to add. |
| callback | Function | callback of the form ``fn(err, limits)`` |

### Throws

| Error | Description |
| ----- | ----------- |
| TypeError | on bad input. |






## deleteLimit(user, limit, callback)

Deletes a "CAPI"" limit for a given user.

Note that this deletes _all_ limits for a datacenter, so if you just want
to purge one, you probably want to use updateLimit.

| Name | Type | Description |
| ---- | ---- | ----------- |
| user | Object | the object returned from getUser. |
| limit | Object | the limit to delete. |
| callback | Function callback of the form ``fn(err)``. |

### Throws

| Error | Description |
| ----- | ----------- |
| TypeError | on bad input. |





## add(dn, entry, callback)

Low-level API to wrap up UFDS add operations.

See ldapjs docs.

| Name | Type | Description |
| ---- | ---- | ----------- |
| dn | String | dn of the record to add. |
| entry | Object | entry record attributes. |
| callback | Function | callback of the form ``fn(error, entries).`` |

### Throws

| Error | Description |
| ----- | ----------- |
| TypeError | on bad input. |





## del(dn, callback)

Low-level API to wrap up UFDS delete operations.

See ldapjs docs.

| Name | Type | Description |
| ---- | ---- | ----------- |
| dn | String | dn dn to delete. |
| callback | Function | callback of the form ``fn(error)``. |

### Throws

| Error | Description |
| ----- | ----------- |
| TypeError | on bad input. |






## modify(dn, changes, callback)

Low-level API to wrap up UFDS modify operations.

See ldapjs docs.

| Name | Type | Description |
| ---- | ---- | ----------- |
| dn | String | dn to update |
| changes | Object | changes to make. |
| callback | Function | callback of the form fn(error). |

### Throws

| Error | Description |
| ----- | ----------- |
| TypeError | on bad input. |





## search(base, options, callback)

Low-level API to wrap up UFDS search operations.
See ldapjs docs.

| Name | Type | Description |
| ---- | ---- | ----------- |
| base | String | search base. |
| options | Object | search options. |
| callback | Function | callback of the form ``fn(error, entries)``. |

### Returns

| Type | Description |
| ---- | ----------- |
| Boolean | true if callback was invoked from cache, false if not. |

### Throw

| Error | Description |
| ----- | ----------- |
| TypeError | on bad input. |




## setLogLevel(level)

Convenience mechanism to set the LDAP log level.

| Name | Type | Description |
| ---- | ---- | ----------- |
| level | String | see Log4js levels. |

### Throws

| Error | Description |
| ----- | ----------- |
| TypeError | on bad input. |



# Amon Master API Client

TODO


# CA API Client

TODO


# VMAPI Client

## listVms(params, callback)

List all VMs given the specified filter params. Currently the following
parameters are allowed:

| Name | Type | Description |
| ---- | ---- | ----------- |
| owner_uuid | UUID | VM Owner |
| type | String | 'vm' or 'zone' |
| alias | String | VM Alias |
| state | String | running, stopped, active or destroyed |
| ram | Number | Amount of memory of the VM |
| tag.key | String | If VM is tagged with 'key' |

The function callback takes the following form

| Name | Type | Description |
| ---- | ---- | ----------- |
| callback | Function | fn(error, vms) |


## getVm(params, callback)

Gets a VM.

| Name | Type | Description |
| ---- | ---- | ----------- |
| params | Object | Filter params |
| params.uuid | UUID | VM UUID. Required |
| params.owner_uuid | UUID | VM Owner. Optional |
| callback | Function | fn(error, vm) |


## createVm(params, callback)

Creates a VM. See VMAPI docs for more information regarding available parameters
for creating a new VM.

| Name | Type | Description |
| ---- | ---- | ----------- |
| params | Object | Attributes of the VM |
| callback | Function | fn(error, job) |


## stopVm(params, callback)

Stops a VM.

| Name | Type | Description |
| ---- | ---- | ----------- |
| params | Object | Filter params |
| params.uuid | UUID | VM UUID. Required |
| params.owner_uuid | UUID | VM Owner. Optional |
| callback | Function | fn(error, job) |


## startVm(params, callback)

Starts a VM.

| Name | Type | Description |
| ---- | ---- | ----------- |
| params | Object | Filter params |
| params.uuid | UUID | VM UUID. Required |
| params.owner_uuid | UUID | VM Owner. Optional |
| callback | Function | fn(error, job) |


## rebootVm(params, callback)

Reboots a VM.

| Name | Type | Description |
| ---- | ---- | ----------- |
| params | Object | Filter params |
| params.uuid | UUID | VM UUID. Required |
| params.owner_uuid | UUID | VM Owner. Optional |
| callback | Function | fn(error, job) |


## reprovisionVm(params, callback)

Reprovisions a VM.

| Name | Type | Description |
| ---- | ---- | ----------- |
| params | Object | Filter params |
| params.uuid | UUID | VM UUID. Required |
| params.image_uuid | UUID | Image UUID. Required |
| params.owner_uuid | UUID | VM Owner. Optional |
| callback | Function | fn(error, job) |


## updateVm(params, callback)

Updates a VM. Params takes the following options:

| Name | Type | Description |
| ---- | ---- | ----------- |
| uuid | UUID | VM UUID. Required |
| owner_uuid | UUID | VM Owner. Optional |
| payload | Object | VM attributes to be updated. Required |

The following parameters are allowed for the VM 'payload':

| Name | Type | Description |
| ---- | ---- | ----------- |
| alias | String | VM Alias |
| ram | Number | Amount of memory of the VM |
| max_swap | Number | Amount of swap of the VM |
| quota | Number | VM quota |
| new_owner_uuid | UUID | New owner for the VM |
| zfs_io_priority | Number | VM ZFS IO priority |
| tags | Object | New tags to assign to the VM |
| customer_metadata | Object | New customer_metadata to assign to the VM |
| internal_metadata | Object | New internal_metadata to assign to the VM |

The function callback takes the following form

| Name | Type | Description |
| ---- | ---- | ----------- |
| callback | Function | fn(error, job) |


## deleteVm(params, callback)

Deletes a VM.

| Name | Type | Description |
| ---- | ---- | ----------- |
| params | Object | Filter params |
| params.uuid | UUID | VM UUID. Required |
| params.owner_uuid | UUID | VM Owner. Optional |
| callback | Function | fn(error, job) |


## listMetadata(type, params, callback)

Gets existing metadata for a VM.

| Name | Type | Description |
| ---- | ---- | ----------- |
| type | String | 'customer_metadata', 'internal_metadata' or 'tags' |
| params | Object | Filter params |
| params.uuid | UUID | VM UUID. Required |
| params.owner_uuid | UUID | VM Owner. Optional |
| callback | Function | fn(error, metadata) |


## addMetadata(type, params, callback)

Adds (appends) metadata to a VM. Existing metadata will not be replaced. If we wanted to add foo=bar as metadata tags for a VM then the params argument would look like:

        {
            uuid: <uuid>,
            owner_uuid: <owner_uuid>,
            metadata: { foo: 'bar' }
        }


| Name | Type | Description |
| ---- | ---- | ----------- |
| type | String | 'customer_metadata', 'internal_metadata' or 'tags' |
| params | Object | Filter params |
| params.uuid | UUID | VM UUID. Required |
| params.owner_uuid | UUID | VM Owner. Optional |
| params.metadata | Object | Metadata to be added to the VM |
| callback | Function | fn(error, jobs) |


## setMetadata(type, params, callback)

Sets (replaces) metadata to a VM. Existing metadata will be replaced. If we wanted to add foo=bar as metadata tags for a VM then the params argument would look like:

        {
            uuid: <uuid>,
            owner_uuid: <owner_uuid>,
            metadata: { foo: 'bar' }
        }


| Name | Type | Description |
| ---- | ---- | ----------- |
| type | String | 'customer_metadata', 'internal_metadata' or 'tags' |
| params | Object | Filter params |
| params.uuid | UUID | VM UUID. Required |
| params.owner_uuid | UUID | VM Owner. Optional |
| params.metadata | Object | Metadata to be set for the VM |
| callback | Function | fn(error, jobs) |


## deleteMetadata(type, params, key, callback)

Deletes a metadata key from a VM.

| Name | Type | Description |
| ---- | ---- | ----------- |
| type | String | 'customer_metadata', 'internal_metadata' or 'tags' |
| params | Object | Filter params |
| params.uuid | UUID | VM UUID. Required |
| params.owner_uuid | UUID | VM Owner. Optional |
| key | String | Metadata key to be removed |
| callback | Function | fn(error, jobs) |


## deleteAllMetadata(type, params, callback)

Deletes ALL metadata keys from a VM.

| Name | Type | Description |
| ---- | ---- | ----------- |
| type | String | 'customer_metadata', 'internal_metadata' or 'tags' |
| params | Object | Filter params |
| params.uuid | UUID | VM UUID. Required |
| params.owner_uuid | UUID | VM Owner. Optional |
| callback | Function | fn(error, jobs) |


## listJobs(params, callback)

Returns all jobs matching the specified search filters.

| Name | Type | Description |
| ---- | ---- | ----------- |
| vm_uuid | UUID | Return all jobs for this VM UUID |
| execution | String | Job state. See below |
| task | String | Type of job. See below |

### Job 'execution' State Inputs

| Execution |
| --------- |
| running |
| succeeded |
| failed |

### Job 'task' Type Inputs

**NOTE** Any metadata endpoint that returns a Job response object is an 'update'
job for the backend system.

| Task |
| ---- |
| provision |
| start |
| stop |
| reboot |
| update |

## getJob(uuid, callback)

Returns a job with the specified UUID.

| Name | Type | Description |
| ---- | ---- | ----------- |
| uuid | UUID | Job UUID |

# CNS Client

For descriptions of return types of these functions, see the CNS REST API documentation (in the CNS repository).

## ping([options, ]callback)

Pings the CNS REST server

| Name     | Type     | Description    |
| -------- | -------- | -------------- |
| callback | Function | fn(error) |

## getVM(uuid[, options], callback)

Retrieves the information that CNS has recorded about a given SDC VM,
including the DNS records associated with it (both instance and service
records)

| Name     | Type     | Description    |
| -------- | -------- | -------------- |
| uuid     | UUID     | VM UUID        |
| callback | Function | fn(error, obj) |

## listPeers([options, ]callback)

Lists all the peers of the CNS server (secondary nameservers that have
used zone transfers to replicate its contents)

| Name     | Type     | Description     |
| -------- | -------- | --------------- |
| callback | Function | fn(error, objs) |

## getPeer(address[, options], callback)

Gets detailed information (beyond the information included in ListPeers)
about a particular peer.

| Name     | Type     | Description        |
| -------- | -------- | ------------------ |
| address  | String   | IP address of peer |
| callback | Function | fn(error, obj)     |

## deletePeer(address[, options], callback)

Deletes a peer from CNS, causing all state about the peer (including
knowledge about its latest sync'd serial numbers, whether it supports
NOTIFY etc) to be forgotten.

| Name     | Type     | Description        |
| -------- | -------- | ------------------ |
| address  | String   | IP address of peer |
| callback | Function | fn(error)          |

## listZones([options, ]callback)

Lists all zones served by the CNS server and their latest generated
serial numbers.

| Name     | Type     | Description     |
| -------- | -------- | --------------- |
| callback | Function | fn(error, objs) |

## listAllowedPeers([options, ]callback)

Lists the current contents of the peer ACL. Addresses that match an entry
in this ACL will be allowed to perform a zone transfer and become a new
peer.

| Name     | Type     | Description     |
| -------- | -------- | --------------- |
| callback | Function | fn(error, objs) |
