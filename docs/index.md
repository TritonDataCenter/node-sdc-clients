---
title: node-sdc-clients
markdown2extras: tables, code-friendly
---

# node-sdc-clients

node-sdc-clients provides node.js client libraries for many internal
Triton core services.

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
