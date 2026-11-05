import assert from 'node:assert/strict'
import { nodeCost, nodeCosts, edgeCost, totals } from './cost.js'

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`)
const vm = { kind: 'compute', size: 0, qty: 1, duration: 1, unit: 'months' }
const month = { duration: 1, unit: 'months' }

near(nodeCost('aws', vm), 0.0104 * 730)
near(nodeCost('aws', { ...vm, qty: 2, duration: 3, unit: 'days' }), 0.0104 * 2 * 72)
near(nodeCost('aws', { ...vm, size: 99 }), 0.34 * 730) // clamps to largest tier
near(nodeCost('gcp', { kind: 'object', amount: 100, duration: 2, unit: 'months' }), 0.02 * 100 * 2)
near(nodeCost('aws', { kind: 'internet' }), 0)

// Serverless: 5M req × 100 ms, 1 vCPU, 0.5 GiB
const fn = { kind: 'serverless', amount: 5, ms: 100, vcpu: 1, memGiB: 0.5, concurrency: 1, ...month }
near(nodeCost('gcp', fn), 2 + 500_000 * (0.000024 + 0.5 * 0.0000025)) // ≈ $14.63
near(nodeCost('gcp', { ...fn, concurrency: 10 }), 2 + 50_000 * (0.000024 + 0.5 * 0.0000025))
near(nodeCost('aws', { ...fn, concurrency: 10 }), 1 + 500_000 * 0.5 * 0.0000166667) // Lambda ignores concurrency

// CDN: delivery + cache fill on misses + requests (+ base fee)
const cdn = { kind: 'cdn', amount: 100, mreq: 1, hit: 90, ...month }
near(nodeCost('gcp', cdn), 8 + 0.01 * 10 + 0.75)
near(nodeCost('azure', cdn), 8.1 + 0.02 * 10 + 0.90 + 35)

// Containers: app + sidecar resources per task
const task = { kind: 'container', qty: 2, vcpu: 1, memGiB: 2, sidecarVcpu: 0.25, sidecarMemGiB: 0.5, ...month }
near(nodeCost('aws', task), 2 * (1.25 * 0.04048 + 2.5 * 0.004445) * 730)

// NAT: hourly + per GB; Cloud NAT per VM, capped
const nat = { kind: 'nat', amount: 100, gateways: 2, vms: 4, ...month }
near(nodeCost('aws', nat), 2 * 0.045 * 730 + 4.5)
near(nodeCost('gcp', nat), 4 * 0.0014 * 730 + 4.5)
near(nodeCost('gcp', { ...nat, vms: 100 }), 0.044 * 730 + 4.5)

// Base fee with included units
near(nodeCost('azure', { kind: 'registry', amount: 30, ...month }), 5.07 + 0.10 * 20)
near(nodeCost('azure', { kind: 'registry', amount: 5, ...month }), 5.07)
near(nodeCost('aws', { kind: 'logs', amount: 20, ...month }), 10)

// Wires
const net = { kind: 'internet' }
near(edgeCost('aws', net, vm, { gb: 10 }), 0.9)                                     // internet egress
near(edgeCost('gcp', net, cdn, { gb: 100 }), 0)                                      // billed on CDN node
near(edgeCost('aws', vm, { ...vm, duration: 2 }, { gb: 10 }), 0)                     // same zone: free
near(edgeCost('aws', vm, { ...vm, duration: 2 }, { gb: 10, crossZone: true }), 0.4)  // cross-zone, longer end

const t = totals('aws', [{ id: 'a', data: vm }, { id: 'b', data: net }], [{ source: 'b', target: 'a', data: { gb: 10 } }, { source: 'x', target: 'a' }])
near(t.total, 0.0104 * 730 + 0.9)
near(t.groups['Data transfer'], 0.9)

// Google forwarding rules: pooled per type, flat for the first 5, then per extra rule
const rule = (id, extra) => ({ id, data: { kind: 'lb', size: 0, qty: 1, ...month, ...extra } })
const lbTotal = (cloud, ...ns) => totals(cloud, ns, []).total
near(lbTotal('gcp', rule('a')), 0.025 * 730)
near(lbTotal('gcp', rule('a'), rule('b')), 0.025 * 730)                              // HTTP + HTTPS cost the same as one
near(lbTotal('gcp', rule('a', { qty: 10 })), 0.075 * 730)                            // Google's worked example
near(lbTotal('gcp', rule('a', { qty: 6 }), rule('b', { qty: 4 })), 0.075 * 730)      // same, across nodes
near(lbTotal('gcp', rule('a'), rule('b', { size: 1 })), 0.05 * 730)                  // global and regional bill separately
near(nodeCost('gcp', rule('a', { qty: 10 }).data), 0.075 * 730)
near(lbTotal('gcp', rule('a', { qty: 0 })), 0)
const split = nodeCosts('gcp', [rule('a', { qty: 3 }), rule('b')])
near(split.a, 0.75 * 0.025 * 730)                                                    // shared by rule count
near(split.b, 0.25 * 0.025 * 730)
// One rule for a month, one for a day: shared for the day, then the longer one pays alone
const uneven = nodeCosts('gcp', [rule('a'), rule('b', { unit: 'days' })])
near(uneven.a, 0.025 * 12 + 0.025 * (730 - 24))
near(uneven.b, 0.025 * 12)
near(lbTotal('aws', rule('a'), rule('b')), 2 * 0.0225 * 730)                         // AWS and Azure stay per node
near(lbTotal('azure', rule('a'), rule('b', { size: 1 })), 2 * 0.025 * 730)           // regional size clamps elsewhere

console.log('cost checks passed')
