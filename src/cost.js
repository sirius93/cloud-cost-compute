// Pricing data + cost math. Pure, no React, so `npm test` can run it in Node.

export const HOURS_PER_MONTH = 730 // the convention all three clouds use
export const UNITS = { hours: 1, days: 24, months: HOURS_PER_MONTH }

// Generic kinds map onto every cloud, so one diagram can be priced on any of them.
// model: 'hourly' = price/h × qty × hours; 'usage' = monthly usage charge × months; null = free.
// extra: additional inputs as [field, label, show?(service)] — show hides inputs a cloud doesn't bill.
export const KINDS = {
  compute:    { label: 'Virtual machine', group: 'Compute', model: 'hourly' },
  container: {
    label: 'Containers (serverless)', group: 'Compute', model: 'hourly', qtyLabel: 'Tasks / instances',
    defaults: { vcpu: 0.5, memGiB: 1, sidecarVcpu: 0, sidecarMemGiB: 0 },
    extra: [['vcpu', 'App vCPU per task'], ['memGiB', 'App memory per task (GiB)'], ['sidecarVcpu', 'Sidecar vCPU per task'], ['sidecarMemGiB', 'Sidecar memory per task (GiB)']],
    note: 'Sidecars (service-mesh proxy, log shipper…) run in every task and are billed as extra vCPU and memory.',
  },
  k8s:        { label: 'Kubernetes control plane', group: 'Compute', model: 'hourly' },
  serverless: {
    label: 'Functions', group: 'Compute', model: 'usage', amountLabel: 'Million requests per month', amountUnit: 'M req/mo', priceUnit: 'million requests', defaultAmount: 5,
    defaults: { ms: 100, memGiB: 0.5, vcpu: 1, concurrency: 1 },
    extra: [['ms', 'Avg request duration (ms)'], ['memGiB', 'Memory (GiB)'], ['vcpu', 'vCPU', s => s.cpuSecond > 0], ['concurrency', 'Concurrent requests per instance', s => s.concurrency]],
  },
  database:   { label: 'Managed SQL', group: 'Database', model: 'hourly' },
  cache:      { label: 'Redis cache', group: 'Database', model: 'hourly' },
  object:     { label: 'Object storage', group: 'Storage', model: 'usage', amountLabel: 'GB stored', amountUnit: 'GB', priceUnit: 'GB-month', defaultAmount: 100 },
  block:      { label: 'Block storage', group: 'Storage', model: 'usage', amountLabel: 'GB provisioned', amountUnit: 'GB', priceUnit: 'GB-month', defaultAmount: 100 },
  registry: {
    label: 'Container registry', group: 'Storage', model: 'usage', amountLabel: 'GB of images stored', amountUnit: 'GB', priceUnit: 'GB-month', defaultAmount: 20,
    note: 'Pulls within the same region are free. Put cross-region pulls on a wire.',
  },
  lb:         { label: 'Load balancer', group: 'Network', model: 'hourly' },
  nat: {
    label: 'NAT gateway', group: 'Network', model: 'usage', amountLabel: 'GB processed per month', amountUnit: 'GB/mo', priceUnit: 'GB processed', defaultAmount: 100,
    defaults: { gateways: 1, vms: 4 },
    extra: [['gateways', 'Gateways (usually one per zone)', s => !s.perVm], ['vms', 'VMs using NAT', s => s.perVm]],
  },
  cdn: {
    label: 'CDN', group: 'Network', model: 'usage', amountLabel: 'GB delivered per month', amountUnit: 'GB/mo', priceUnit: 'GB delivered', defaultAmount: 100,
    defaults: { mreq: 1, hit: 90 },
    extra: [['mreq', 'Million requests per month'], ['hit', 'Cache hit ratio (%)']],
  },
  internet:   { label: 'Internet / users', group: 'Network', model: null },
  queue:      { label: 'Message queue', group: 'Integration', model: 'usage', amountLabel: 'Million requests per month', amountUnit: 'M req/mo', priceUnit: 'million requests', defaultAmount: 5 },
  logs: {
    label: 'Logging', group: 'Operations', model: 'usage', amountLabel: 'GB ingested per month', amountUnit: 'GB/mo', priceUnit: 'GB ingested', defaultAmount: 20,
    note: 'Ingestion only. Long-term retention and log queries are billed separately.',
  },
}

// ponytail: approximate on-demand list prices, one region per cloud, hand-copied from public
// pricing pages. Size tiers line up by index across clouds. Swap for a live price API when needed.
// Functions: request fee + instance time × (vCPU-second + GiB-second). Lambda and Azure Functions bill
// memory only (CPU scales with it) and run one request per instance; Cloud Run bills both and shares
// instances across concurrent requests. Minimum instances and free tiers are not modelled.
// CDN: delivery + cache fill on misses + request fee (+ Front Door's monthly base fee).
// Containers: Fargate / Container Apps (active rate) / Cloud Run instance-based billing, per vCPU-h and GiB-h.
// NAT: hourly per gateway + per GB processed; Cloud NAT bills per VM, capped at 32 VMs.
// Usage services may have `base` (monthly fee) and `included` (free units within it).
export const CLOUDS = {
  aws: {
    name: 'AWS', region: 'us-east-1 (N. Virginia)', egress: 0.09, interZone: 0.02,
    services: {
      compute: { name: 'EC2', sizes: [['t3.micro', 0.0104], ['t3.medium', 0.0416], ['m5.large', 0.096], ['m5.xlarge', 0.192], ['c5.2xlarge', 0.34]] },
      container: { name: 'ECS on Fargate', cpuHour: 0.04048, gibHour: 0.004445 },
      registry: { name: 'ECR', price: 0.10 },
      nat: { name: 'NAT Gateway', hourly: 0.045, price: 0.045 },
      logs: { name: 'CloudWatch Logs', price: 0.50 },
      k8s: { name: 'EKS', sizes: [['Cluster', 0.10]] },
      serverless: { name: 'Lambda', price: 0.20, cpuSecond: 0, gibSecond: 0.0000166667 },
      database: { name: 'RDS PostgreSQL', sizes: [['db.t3.micro', 0.018], ['db.t3.medium', 0.072], ['db.m5.large', 0.178], ['db.m5.xlarge', 0.356]] },
      cache: { name: 'ElastiCache', sizes: [['cache.t3.micro', 0.017], ['cache.m5.large', 0.156]] },
      object: { name: 'S3 Standard', price: 0.023 },
      block: { name: 'EBS gp3', price: 0.08 },
      lb: { name: 'Application LB', sizes: [['ALB', 0.0225]] },
      cdn: { name: 'CloudFront', price: 0.085, fill: 0, perMReq: 1.00 }, // origin fetch from AWS origins is free
      queue: { name: 'SQS', price: 0.40 },
    },
  },
  azure: {
    name: 'Azure', region: 'East US', egress: 0.087, interZone: 0,
    services: {
      compute: { name: 'Virtual Machines', sizes: [['B1s', 0.0104], ['B2s', 0.0416], ['D2s v5', 0.096], ['D4s v5', 0.192], ['F8s v2', 0.338]] },
      container: { name: 'Container Apps', cpuHour: 0.0864, gibHour: 0.0108 },
      registry: { name: 'Container Registry Basic', price: 0.10, base: 5.07, included: 10 },
      nat: { name: 'NAT Gateway', hourly: 0.045, price: 0.045 },
      logs: { name: 'Log Analytics', price: 2.30 },
      k8s: { name: 'AKS Standard', sizes: [['Cluster', 0.10]] },
      serverless: { name: 'Functions', price: 0.20, cpuSecond: 0, gibSecond: 0.000016 },
      database: { name: 'PostgreSQL Flexible', sizes: [['B1ms', 0.0207], ['B2s', 0.0827], ['D2s v3', 0.178], ['D4s v3', 0.356]] },
      cache: { name: 'Cache for Redis', sizes: [['C0 Basic', 0.022], ['C1 Standard', 0.10]] },
      object: { name: 'Blob Storage Hot', price: 0.018 },
      block: { name: 'Managed Disk SSD', price: 0.075 },
      lb: { name: 'Load Balancer', sizes: [['Standard', 0.025]] },
      cdn: { name: 'Front Door CDN', price: 0.081, fill: 0.02, perMReq: 0.90, base: 35 },
      queue: { name: 'Service Bus', price: 0.80 },
    },
  },
  gcp: {
    name: 'Google Cloud', region: 'us-central1 (Iowa)', egress: 0.12, interZone: 0.01,
    services: {
      compute: { name: 'Compute Engine', sizes: [['e2-micro', 0.0084], ['e2-medium', 0.0335], ['n2-standard-2', 0.0971], ['n2-standard-4', 0.1942], ['c2-standard-8', 0.4176]] },
      container: { name: 'Cloud Run (always on)', cpuHour: 0.0648, gibHour: 0.0072 },
      registry: { name: 'Artifact Registry', price: 0.10 },
      nat: { name: 'Cloud NAT', hourly: 0.044, perVm: 0.0014, price: 0.045 },
      logs: { name: 'Cloud Logging', price: 0.50 },
      k8s: { name: 'GKE', sizes: [['Cluster', 0.10]] },
      serverless: { name: 'Cloud Run (per request)', price: 0.40, cpuSecond: 0.000024, gibSecond: 0.0000025, concurrency: true },
      database: { name: 'Cloud SQL PostgreSQL', sizes: [['db-f1-micro', 0.0105], ['db-g1-small', 0.035], ['2 vCPU / 8 GB', 0.134], ['4 vCPU / 16 GB', 0.268]] },
      cache: { name: 'Memorystore Redis', sizes: [['Basic 1 GB', 0.049], ['Standard 5 GB', 0.27]] },
      object: { name: 'Cloud Storage', price: 0.020 },
      block: { name: 'Persistent Disk', price: 0.10 },
      lb: { name: 'Cloud Load Balancing', sizes: [['Global forwarding rule', 0.025], ['Regional forwarding rule', 0.025]], pool: { included: 5, extra: 0.01 } },
      cdn: { name: 'Cloud CDN', price: 0.08, fill: 0.01, perMReq: 0.75 },
      queue: { name: 'Pub/Sub', price: 0.04 },
    },
  },
}

export const newData = kind => ({ kind, size: 0, qty: 1, amount: KINDS[kind].defaultAmount ?? 0, duration: 1, unit: 'months', ...KINDS[kind].defaults })

export const sizesOf = (cloud, kind) => CLOUDS[cloud].services[kind]?.sizes ?? []

// Size index is shared across clouds; clamp in case the new cloud has fewer tiers.
export function sizeOf(cloud, d) {
  const sizes = sizesOf(cloud, d.kind)
  return sizes[Math.min(d.size, sizes.length - 1)]
}

const monthsOf = d => (KINDS[d.kind].model ? (d.duration * UNITS[d.unit]) / HOURS_PER_MONTH : 0)

function monthlyUsage(svc, d) {
  if (d.kind === 'serverless') {
    const conc = svc.concurrency ? Math.max(1, d.concurrency) : 1
    const instanceSeconds = (d.amount * 1e6 * d.ms) / 1000 / conc
    return svc.price * d.amount + instanceSeconds * (d.vcpu * svc.cpuSecond + d.memGiB * svc.gibSecond)
  }
  if (d.kind === 'cdn') {
    const miss = 1 - Math.min(d.hit, 100) / 100
    return svc.price * d.amount + svc.fill * d.amount * miss + svc.perMReq * d.mreq + (svc.base ?? 0)
  }
  if (d.kind === 'nat') {
    const hourly = svc.perVm ? Math.min(d.vms * svc.perVm, svc.hourly) : svc.hourly * d.gateways
    return hourly * HOURS_PER_MONTH + svc.price * d.amount
  }
  return svc.price * Math.max(0, d.amount - (svc.included ?? 0)) + (svc.base ?? 0)
}

// Per-instance hourly price: a picked size, or containers' vCPU + memory (app plus sidecars).
export function hourlyPrice(cloud, d) {
  const svc = CLOUDS[cloud].services[d.kind]
  if (d.kind === 'container') return (d.vcpu + d.sidecarVcpu) * svc.cpuHour + (d.memGiB + d.sidecarMemGiB) * svc.gibHour
  return sizeOf(cloud, d)[1]
}

// Google bills forwarding rules as a pool: the size's price covers the first rules, then each extra adds a little.
// Rules are assumed to start together; each stretch of time is split evenly across the rules running then.
// ponytail: one diagram = one project, so multi-project designs read low. Add a project field if that matters.
function poolCosts(cloud, ds) {
  const { included, extra } = CLOUDS[cloud].services.lb.pool
  const hoursOf = d => d.duration * UNITS[d.unit]
  const costs = ds.map(() => 0)
  let from = 0
  for (const to of [...new Set(ds.map(hoursOf))].sort((a, b) => a - b)) {
    const running = ds.filter(d => hoursOf(d) > from)
    const rules = running.reduce((sum, d) => sum + d.qty, 0)
    const perRule = rules && (sizeOf(cloud, ds[0])[1] + Math.max(0, rules - included) * extra) / rules
    ds.forEach((d, i) => { if (hoursOf(d) > from) costs[i] += perRule * d.qty * (to - from) })
    from = to
  }
  return costs
}

export function nodeCost(cloud, d) {
  const model = KINDS[d.kind].model
  if (d.kind === 'lb' && CLOUDS[cloud].services.lb.pool) return poolCosts(cloud, [d])[0]
  if (model === 'hourly') return hourlyPrice(cloud, d) * d.qty * d.duration * UNITS[d.unit]
  if (model === 'usage') return monthlyUsage(CLOUDS[cloud].services[d.kind], d) * monthsOf(d)
  return 0
}

// Wires are free unless they really cost something:
//  - touching the internet node: internet egress, except Internet↔CDN (delivery is billed on the CDN node)
//  - internal: free within one zone; cross-zone rate only when the wire is marked as crossing zones
// ponytail: wire GB is entered by hand, not derived from upstream nodes (e.g. CDN misses → origin).
export function edgeRate(cloud, a, b, crossZone) {
  const c = CLOUDS[cloud], kinds = [a.kind, b.kind]
  if (kinds.includes('internet')) return kinds.includes('cdn') ? 0 : c.egress
  return crossZone ? c.interZone : 0
}

// Billed for as long as the longer-running end is up.
export function edgeCost(cloud, a, b, e = {}) {
  return edgeRate(cloud, a, b, e.crossZone) * (e.gb ?? 0) * Math.max(monthsOf(a), monthsOf(b))
}

// What each node adds to the diagram, by id. Differs from nodeCost only where nodes share a pool.
export function nodeCosts(cloud, nodes) {
  const costs = Object.fromEntries(nodes.map(n => [n.id, nodeCost(cloud, n.data)]))
  if (CLOUDS[cloud].services.lb.pool) {
    for (const [name] of sizesOf(cloud, 'lb')) {
      const pool = nodes.filter(n => n.data.kind === 'lb' && sizeOf(cloud, n.data)[0] === name)
      if (pool.length) poolCosts(cloud, pool.map(n => n.data)).forEach((cost, i) => { costs[pool[i].id] = cost })
    }
  }
  return costs
}

export function totals(cloud, nodes, edges) {
  const byId = Object.fromEntries(nodes.map(n => [n.id, n.data]))
  const groups = {}
  const add = (g, v) => { groups[g] = (groups[g] ?? 0) + v }
  const costs = nodeCosts(cloud, nodes)
  for (const n of nodes) add(KINDS[n.data.kind].group, costs[n.id])
  for (const e of edges) {
    const a = byId[e.source], b = byId[e.target]
    if (a && b) add('Data transfer', edgeCost(cloud, a, b, e.data))
  }
  return { groups, total: Object.values(groups).reduce((s, v) => s + v, 0) }
}
