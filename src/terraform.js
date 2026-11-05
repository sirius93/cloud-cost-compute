// Turns Terraform files into a diagram. Pure, no React, so `npm test` can run it in Node.
// Runs entirely in the browser: file contents are never uploaded.

import { CLOUDS, KINDS, newData } from './cost.js'

export const isTerraformFile = name => /\.(tf|tfvars)(\.json)?$/.test(name) && !/(^|\/)\.terraform\//.test(name)

// --- HCL scanning. ponytail: reads blocks, simple attributes and references, not full HCL.
// Expressions it can't evaluate (conditionals, functions, for_each) are reported, never guessed.

// s[i] is the opening quote; returns the index just past the closing one.
function skipString(s, i) {
  for (i++; i < s.length; i++) {
    if (s[i] === '\\') i++
    else if (s[i] === '"') return i + 1
    else if (s.startsWith('$${', i) || s.startsWith('%%{', i)) i += 2
    else if (s.startsWith('${', i) || s.startsWith('%{', i)) {
      i = closeBrace(s, i + 1)
      if (i < 0) return s.length
    }
  }
  return s.length
}

// s[i] starts `<<`; returns the index past the heredoc, or -1 if this isn't one.
function skipHeredoc(s, i) {
  const m = /^<<-?([A-Za-z_]\w*)[ \t]*\n/.exec(s.slice(i, i + 200))
  if (!m) return -1
  const start = i + m[0].length
  const end = new RegExp(`^[ \\t]*${m[1]}[ \\t]*$`, 'm').exec(s.slice(start))
  return end ? start + end.index + end[0].length : s.length
}

// s[open] is `{`; returns the index of its matching `}`, or -1.
function closeBrace(s, open) {
  let depth = 0
  for (let i = open; i < s.length; i++) {
    const c = s[i]
    if (c === '"') { i = skipString(s, i) - 1; continue }
    if (c === '<' && s[i + 1] === '<') {
      const end = skipHeredoc(s, i)
      if (end > 0) { i = end - 1; continue }
    }
    if (c === '{') depth++
    else if (c === '}' && --depth === 0) return i
  }
  return -1
}

function stripComments(text) {
  const s = text.replace(/\r\n/g, '\n')
  let out = ''
  for (let i = 0; i < s.length;) {
    let end = -1
    if (s[i] === '"') end = skipString(s, i)
    else if (s.startsWith('<<', i)) end = skipHeredoc(s, i)
    if (end > 0) { out += s.slice(i, end); i = end; continue }
    if (s[i] === '#' || s.startsWith('//', i)) {
      const nl = s.indexOf('\n', i)
      i = nl < 0 ? s.length : nl
    } else if (s.startsWith('/*', i)) {
      const close = s.indexOf('*/', i)
      i = close < 0 ? s.length : close + 2
    } else out += s[i++]
  }
  return out
}

// Raw token assigned to `key`, or undefined. Searches nested blocks too, so `settings { tier = … }` works.
// A value followed by more expression (`a ? b : c`) isn't a plain value, so it counts as unreadable.
function rawAttr(body, key) {
  const m = new RegExp(`(?<![\\w.-])${key}\\s*=(?!=)\\s*\\[?\\s*("(?:[^"\\\\]|\\\\.)*"|[^\\s,\\]}]+)`).exec(body)
  if (!m) return undefined
  const rest = /^[^\n]*/.exec(body.slice(m.index + m[0].length))[0]
  return /^[ \t]*([,\]}].*)?$/.test(rest) ? m[1] : undefined
}

function evaluate(ctx, raw, depth = 0) {
  if (raw === undefined || depth > 5) return undefined
  let v = raw
  if (v.startsWith('"')) {
    v = v.slice(1, -1)
    const interp = /^\$\{([^{}]+)\}$/.exec(v)
    if (!interp) return v.includes('${') ? undefined : v
    v = interp[1].trim()
  }
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v)
  if (v === 'true' || v === 'false') return v === 'true'
  const ref = /^(var|local)\.(\w+)$/.exec(v)
  if (!ref) return undefined
  return evaluate(ctx, ref[1] === 'var' ? ctx.vars[ref[2]] : rawAttr(ctx.locals, ref[2]), depth + 1)
}

function parseDir(files, report) {
  const ctx = { vars: {}, locals: '', resources: [], modules: [] }
  const tfvars = []
  for (const file of files) {
    if (file.name.endsWith('.json')) { report.warnings.push(`${file.name}: JSON Terraform isn't supported, so it was skipped.`); continue }
    const src = stripComments(file.text)
    if (file.name.endsWith('.tfvars')) { tfvars.push({ name: file.name, src }); continue }
    const block = /^[ \t]*([A-Za-z_][\w-]*)[ \t]*((?:"[^"\n]*"[ \t]*)*)\{/gm
    for (let m; (m = block.exec(src));) {
      const open = m.index + m[0].length - 1
      const close = closeBrace(src, open)
      if (close < 0) { report.warnings.push(`${file.name}: unbalanced braces after "${m[0].trim()}", so the rest of the file was skipped.`); break }
      const body = src.slice(open + 1, close)
      const labels = [...m[2].matchAll(/"([^"]*)"/g)].map(x => x[1])
      if (m[1] === 'resource' && labels.length === 2) ctx.resources.push({ type: labels[0], name: labels[1], key: `${labels[0]}.${labels[1]}`, body })
      else if (m[1] === 'variable') ctx.vars[labels[0]] = rawAttr(body, 'default')
      else if (m[1] === 'locals') ctx.locals += `${body}\n`
      else if (m[1] === 'module') ctx.modules.push(labels[0])
      block.lastIndex = close + 1
    }
  }
  // terraform.tfvars, then *.auto.tfvars. Any other .tfvars is picked at plan time, so last one alphabetically wins.
  const order = f => (f.name.endsWith('.auto.tfvars') ? 2 : /(^|\/)terraform\.tfvars$/.test(f.name) ? 1 : 0)
  tfvars.sort((a, b) => order(a) - order(b) || a.name.localeCompare(b.name))
  const plain = tfvars.filter(f => order(f) === 0)
  if (plain.length > 1) report.warnings.push(`Several .tfvars files found. Their values were merged and ${plain.at(-1).name} wins any conflicts.`)
  for (const { src } of tfvars) {
    for (const [, key] of src.matchAll(/^[ \t]*(\w+)[ \t]*=/gm)) ctx.vars[key] = rawAttr(src, key)
  }

  const byKey = Object.fromEntries(ctx.resources.map(r => [r.key, r]))
  for (const r of ctx.resources) {
    const refs = [...r.body.matchAll(/(?<![\w.])((?:aws|azurerm|google)_\w+\.[A-Za-z_][\w-]*)/g)].map(x => x[1])
    r.refs = [...new Set(refs)].map(k => byKey[k]).filter(x => x && x !== r)
  }
  return ctx
}

// --- Mapping Terraform resources onto the calculator's service kinds

const cpu = v => (/m$/.test(v) ? parseFloat(v) / 1000 : Number(v))
const mem = v => {
  const m = /^([\d.]+)\s*(Mi|M|Gi|G)?$/.exec(String(v))
  if (!m) return NaN
  return /^M/.test(m[2] ?? '') ? Number(m[1]) / 1024 : Number(m[1])
}
const mb = v => Number(v) / 1024
const units1024 = v => Number(v) / 1024

// size/qty/amount: attribute names ('a|b' = first that resolves). via: also read attributes from these referenced types.
// fields: node field → [attribute, convert]. pool: an inline worker pool that becomes its own compute node.
const SPECS = {
  aws_instance: { kind: 'compute', size: 'instance_type' },
  aws_autoscaling_group: { kind: 'compute', size: 'instance_type', qty: 'desired_capacity|min_size', via: ['aws_launch_template', 'aws_launch_configuration'] },
  aws_eks_node_group: { kind: 'compute', size: 'instance_types', qty: 'desired_size' },
  aws_ecs_service: { kind: 'container', qty: 'desired_count', via: ['aws_ecs_task_definition'], fields: { vcpu: ['cpu', units1024], memGiB: ['memory', mb] } },
  aws_eks_cluster: { kind: 'k8s' },
  aws_lambda_function: { kind: 'serverless', fields: { memGiB: ['memory_size', mb] } },
  aws_db_instance: { kind: 'database', size: 'instance_class', multiAz: true },
  aws_rds_cluster_instance: { kind: 'database', size: 'instance_class' },
  aws_elasticache_cluster: { kind: 'cache', size: 'node_type', qty: 'num_cache_nodes' },
  aws_elasticache_replication_group: { kind: 'cache', size: 'node_type', qty: 'num_cache_clusters' },
  aws_s3_bucket: { kind: 'object' },
  aws_ebs_volume: { kind: 'block', amount: 'size' },
  aws_ecr_repository: { kind: 'registry' },
  aws_lb: { kind: 'lb', internal: g => g('internal') === true },
  aws_alb: { kind: 'lb', internal: g => g('internal') === true },
  aws_nat_gateway: { kind: 'nat' },
  aws_cloudfront_distribution: { kind: 'cdn' },
  aws_sqs_queue: { kind: 'queue' },
  aws_cloudwatch_log_group: { kind: 'logs' },

  azurerm_linux_virtual_machine: { kind: 'compute', size: 'size' },
  azurerm_windows_virtual_machine: { kind: 'compute', size: 'size' },
  azurerm_virtual_machine: { kind: 'compute', size: 'vm_size' },
  azurerm_linux_virtual_machine_scale_set: { kind: 'compute', size: 'sku', qty: 'instances' },
  azurerm_windows_virtual_machine_scale_set: { kind: 'compute', size: 'sku', qty: 'instances' },
  azurerm_kubernetes_cluster: { kind: 'k8s', pool: { size: 'vm_size', qty: 'node_count' } },
  azurerm_kubernetes_cluster_node_pool: { kind: 'compute', size: 'vm_size', qty: 'node_count' },
  azurerm_container_app: { kind: 'container', qty: 'min_replicas', fields: { vcpu: ['cpu', cpu], memGiB: ['memory', mem] } },
  azurerm_linux_function_app: { kind: 'serverless' },
  azurerm_windows_function_app: { kind: 'serverless' },
  azurerm_function_app: { kind: 'serverless' },
  azurerm_postgresql_flexible_server: { kind: 'database', size: 'sku_name' },
  azurerm_redis_cache: { kind: 'cache', sizeFrom: g => g('family') && `${g('family')}${g('capacity')} ${g('sku_name')}` },
  azurerm_storage_account: { kind: 'object' },
  azurerm_managed_disk: { kind: 'block', amount: 'disk_size_gb' },
  azurerm_container_registry: { kind: 'registry' },
  azurerm_lb: { kind: 'lb', internal: g => g('subnet_id') !== undefined },
  azurerm_application_gateway: { kind: 'lb' },
  azurerm_nat_gateway: { kind: 'nat' },
  azurerm_cdn_profile: { kind: 'cdn' },
  azurerm_cdn_frontdoor_profile: { kind: 'cdn' },
  azurerm_servicebus_namespace: { kind: 'queue' },
  azurerm_log_analytics_workspace: { kind: 'logs' },

  google_compute_instance: { kind: 'compute', size: 'machine_type' },
  google_compute_instance_group_manager: { kind: 'compute', size: 'machine_type', qty: 'target_size', via: ['google_compute_instance_template'] },
  google_compute_region_instance_group_manager: { kind: 'compute', size: 'machine_type', qty: 'target_size', via: ['google_compute_instance_template'] },
  google_container_cluster: { kind: 'k8s', pool: { size: 'machine_type', qty: 'initial_node_count' } },
  google_container_node_pool: { kind: 'compute', size: 'machine_type', qty: 'node_count' },
  google_cloud_run_service: { kind: 'serverless', fields: { vcpu: ['cpu', cpu], memGiB: ['memory', mem], concurrency: ['container_concurrency', Number] } },
  google_cloud_run_v2_service: { kind: 'serverless', fields: { vcpu: ['cpu', cpu], memGiB: ['memory', mem], concurrency: ['max_instance_request_concurrency', Number] } },
  google_cloudfunctions_function: { kind: 'serverless', fields: { memGiB: ['available_memory_mb', mb] } },
  google_cloudfunctions2_function: { kind: 'serverless', fields: { memGiB: ['available_memory', mem], vcpu: ['available_cpu', cpu] } },
  google_sql_database_instance: { kind: 'database', size: 'tier' },
  google_redis_instance: { kind: 'cache', sizeFrom: g => g('memory_size_gb') && `${g('tier') === 'STANDARD_HA' ? 'Standard' : 'Basic'} ${g('memory_size_gb')} GB` },
  google_storage_bucket: { kind: 'object' },
  google_compute_disk: { kind: 'block', amount: 'size' },
  google_artifact_registry_repository: { kind: 'registry' },
  google_compute_forwarding_rule: { kind: 'lb', sizeFrom: () => 'Regional forwarding rule', internal: g => /INTERNAL/.test(g('load_balancing_scheme') ?? '') },
  google_compute_global_forwarding_rule: { kind: 'lb', sizeFrom: () => 'Global forwarding rule', internal: g => /INTERNAL/.test(g('load_balancing_scheme') ?? '') },
  google_compute_router_nat: { kind: 'nat' },
  google_compute_backend_service: { kind: 'cdn', only: g => g('enable_cdn') === true },
  google_compute_backend_bucket: { kind: 'cdn', only: g => g('enable_cdn') === true },
  google_pubsub_topic: { kind: 'queue' },
  google_logging_project_sink: { kind: 'logs' },
}

// Not services, but traffic flows through them: services linked via these get a wire.
// Shared infrastructure (VPCs, subnets, security groups, roles) is left out on purpose, or everything would connect.
const CONNECTORS = new Set([
  'aws_lb_listener', 'aws_lb_listener_rule', 'aws_alb_listener', 'aws_lb_target_group', 'aws_alb_target_group',
  'aws_lb_target_group_attachment', 'aws_autoscaling_attachment', 'aws_ecs_task_definition', 'aws_launch_template',
  'aws_launch_configuration', 'aws_lambda_event_source_mapping', 'aws_lambda_permission', 'aws_apigatewayv2_integration',
  'azurerm_lb_backend_address_pool', 'azurerm_lb_rule', 'azurerm_network_interface',
  'azurerm_network_interface_backend_address_pool_association', 'azurerm_function_app_function',
  'google_compute_backend_service', 'google_compute_backend_bucket', 'google_compute_url_map',
  'google_compute_target_http_proxy', 'google_compute_target_https_proxy', 'google_compute_target_tcp_proxy',
  'google_compute_instance_group', 'google_compute_instance_template', 'google_compute_region_network_endpoint_group',
])

// Free or close to it, so not worth a warning. Anything else unmapped is listed as "not priced".
const NO_COST = /^(random|null|tls|local|time|terraform)_|_(vpc|subnet|subnetwork|network|virtual_network|security_group\w*|route_table\w*|route|internet_gateway|network_acl\w*|resource_group|firewall\w*|project_service|project_iam\w*|service_account\w*|role\w*|policy\w*|iam_\w+|ecs_cluster|rds_cluster|db_subnet_group|elasticache_subnet_group|lb_probe|health_check|http_health_check|compute_router|s3_bucket_\w+|storage_container|subnet_\w+|key_pair)$|_iam_/

// Left-to-right order on the canvas, which also sets the direction of each wire.
const RANK = { internet: 0, cdn: 1, lb: 2, compute: 3, container: 3, k8s: 3, serverless: 3, queue: 4, cache: 5, database: 5, object: 6, block: 6, registry: 6, nat: 6, logs: 7 }

const normSize = s => String(s).toLowerCase().replace(/^(b_|gp_|mo_)?standard_/, '').replace(/_/g, ' ')
const sizeTail = s => (s.includes('.') ? s.split('.').pop() : s.split('-').slice(1).join('-'))

// Exact price-list match, else the same size in another family (m6i.large → m5.large).
function matchSize(cloud, kind, raw) {
  const names = CLOUDS[cloud].services[kind].sizes.map(([n]) => normSize(n))
  const want = normSize(raw)
  const exact = names.indexOf(want)
  if (exact >= 0) return { index: exact, exact: true }
  const near = sizeTail(want) ? names.findIndex(n => sizeTail(n) === sizeTail(want)) : -1
  return { index: Math.max(near, 0), exact: false }
}

function groupBy(items, keyOf) {
  const groups = {}
  for (const item of items) (groups[keyOf(item)] ??= []).push(item)
  return groups
}

const cloudOf = type => ({ aws: 'aws', azurerm: 'azure', google: 'gcp' })[type.split('_')[0]]

function buildNode(ctx, r, spec, specOverride, label, report) {
  const cloud = cloudOf(r.type)
  const s = specOverride ?? spec
  const kind = s.kind ?? 'compute'
  const d = { ...newData(kind), source: r.key, label }
  const via = r.refs.filter(x => spec.via?.includes(x.type))
  const get = keys => {
    for (const key of keys.split('|')) {
      for (const src of [r, ...via]) {
        const v = evaluate(ctx, rawAttr(src.body, key))
        if (v !== undefined) return v
      }
    }
    return undefined
  }
  const has = key => new RegExp(`(?<![\\w.-])${key}\\s*=(?!=)`).test(r.body)

  if (s.size || s.sizeFrom) {
    const raw = s.sizeFrom ? s.sizeFrom(get) : get(s.size)
    const sizes = CLOUDS[cloud].services[kind].sizes
    if (raw === undefined || raw === false) {
      report.warnings.push(`${r.key}: couldn't read its size, so it's priced as ${sizes[0][0]}. Change it on the node.`)
    } else {
      const { index, exact } = matchSize(cloud, kind, raw)
      d.size = index
      if (!exact) report.warnings.push(`${r.key}: ${raw} isn't in the price list, so it's priced as ${sizes[index][0]}. Change it on the node.`)
    }
  }
  if (s.qty) {
    const q = Number(get(s.qty))
    if (q >= 1) d.qty = q
  }
  for (const [field, [key, convert]] of Object.entries(s.fields ?? {})) {
    const v = get(key)
    if (v !== undefined && convert(v) > 0) d[field] = convert(v)
  }
  const amount = s.amount && Number(get(s.amount))
  if (amount > 0) d.amount = amount
  else if (KINDS[kind].model === 'usage') report.placeholders++

  if (s.multiAz && get('multi_az') === true) d.qty *= 2 // Multi-AZ runs and bills a standby instance

  // count multiplies whatever this kind is billed per. It only applies to the resource itself, not an inline pool.
  if (!specOverride) {
    if (has('count')) {
      const n = Number(evaluate(ctx, rawAttr(r.body, 'count')))
      if (n === 0) return null
      if (n >= 1 && KINDS[kind].model === 'hourly') d.qty *= n
      else if (n >= 1 && kind === 'nat') d.gateways = n
      else if (n >= 1 && kind === 'block') d.amount *= n
      else if (n > 1) report.warnings.push(`${r.key}: count = ${n}, but it's priced as one because usage is set per node.`)
      else if (!(n >= 1)) report.warnings.push(`${r.key}: couldn't read its count, so it's priced as one.`)
    } else if (has('for_each')) {
      report.warnings.push(`${r.key}: uses for_each, so it's priced as one. Raise the quantity on the node if there are more.`)
    }
  }
  return d
}

export function importTerraform(files) {
  const report = { files: files.length, resources: 0, placeholders: 0, warnings: [], notPriced: [], inferredInternet: false }
  const dirOf = name => (name.includes('/') ? name.slice(0, name.lastIndexOf('/')) : '')
  const dirs = groupBy(files, f => dirOf(f.name))
  const multiDir = Object.keys(dirs).length > 1

  const nodes = []
  const edges = new Map()
  const votes = {}
  const contexts = Object.entries(dirs).map(([dir, group]) => [dir, parseDir(group, report)])
  for (const [dir, ctx] of contexts) {
    const prefix = multiDir ? `${dir.split('/').pop()}/` : ''
    const idOf = r => `${dir}|${r.key}`
    const ours = new Map() // resource → node id
    report.resources += ctx.resources.length
    if (ctx.modules.length) report.warnings.push(`Modules aren't expanded: ${ctx.modules.join(', ')}. Add a local module's folder to include its resources, but wires between it and the rest won't be drawn.`)

    for (const r of ctx.resources) {
      const spec = SPECS[r.type]
      const g = key => evaluate(ctx, rawAttr(r.body, key))
      if (!spec || (spec.only && !spec.only(g))) {
        if (!spec && !CONNECTORS.has(r.type) && !NO_COST.test(r.type)) report.notPriced.push(r.key)
        continue
      }
      const data = buildNode(ctx, r, spec, null, `${prefix}${r.name}`, report)
      if (!data) continue
      if (spec.internal) data.internal = spec.internal(g)
      nodes.push({ id: idOf(r), data })
      ours.set(r, idOf(r))
      votes[cloudOf(r.type)] = (votes[cloudOf(r.type)] ?? 0) + 1

      if (spec.pool && [spec.pool.size, spec.pool.qty].some(k => g(k) !== undefined)) {
        const id = `${idOf(r)}#pool`
        nodes.push({ id, data: buildNode(ctx, r, spec, { ...spec.pool, kind: 'compute' }, `${prefix}${r.name} workers`, report) })
        addEdge(edges, nodes, id, idOf(r))
      }
    }

    // Direct references between services.
    for (const [r, id] of ours) for (const ref of r.refs) if (ours.has(ref)) addEdge(edges, nodes, id, ours.get(ref))

    // Services joined through connectors: walk each connected group of connectors, wire the services it touches.
    const isConnector = r => CONNECTORS.has(r.type) && !ours.has(r)
    const linked = new Map()
    const link = (a, b) => {
      if (!linked.has(a)) linked.set(a, new Set())
      linked.get(a).add(b)
    }
    for (const r of ctx.resources) for (const ref of r.refs) if (isConnector(r) || isConnector(ref)) { link(r, ref); link(ref, r) }
    const seen = new Set()
    for (const start of ctx.resources.filter(isConnector)) {
      if (seen.has(start)) continue
      const touched = new Set()
      const stack = [start]
      seen.add(start)
      while (stack.length) {
        for (const n of linked.get(stack.pop()) ?? []) {
          if (ours.has(n)) touched.add(ours.get(n))
          else if (isConnector(n) && !seen.has(n)) { seen.add(n); stack.push(n) }
        }
      }
      const ids = [...touched]
      for (const a of ids) for (const b of ids) if (a < b) addEdge(edges, nodes, a, b, true)
    }
  }

  const ranked = Object.entries(votes).sort((a, b) => b[1] - a[1])
  const cloud = ranked[0]?.[0] ?? 'aws'
  if (ranked.length > 1) report.warnings.push(`Resources from several clouds found. Everything is priced on ${CLOUDS[cloud].name}, the most common one.`)

  // Public entry points with nothing in front of them get an inferred Internet node.
  const hasUpstream = new Set([...edges.values()].map(e => e.target))
  const entries = nodes.filter(n => ['cdn', 'lb'].includes(n.data.kind) && !n.data.internal && !hasUpstream.has(n.id))
  if (entries.length) {
    nodes.push({ id: 'internet', data: { ...newData('internet'), label: 'Inferred from public entry points' } })
    for (const n of entries) addEdge(edges, nodes, 'internet', n.id)
    report.inferredInternet = true
  }
  for (const n of nodes) delete n.data.internal

  return { cloud, nodes: layout(nodes), edges: [...edges.values()], report }
}

// Wires run from lower rank to higher. Same rank only connects on a direct reference, keeping its direction,
// because connectors would otherwise join every pair behind one load balancer.
function addEdge(edges, nodes, from, to, viaConnector = false) {
  const rank = id => RANK[nodes.find(n => n.id === id).data.kind]
  if (viaConnector && rank(from) === rank(to)) return
  const [source, target] = rank(from) <= rank(to) ? [from, to] : [to, from]
  const id = `${source}->${target}`
  if (!edges.has(id) && !edges.has(`${target}->${source}`)) edges.set(id, { id, source, target, data: { gb: 10 } })
}

function layout(nodes) {
  // Everything behind the compute tier shares a column, so wires never run behind a node in between.
  const columns = groupBy(nodes, n => Math.min(RANK[n.data.kind], 4))
  const tallest = Math.max(...Object.values(columns).map(c => c.length))
  return Object.keys(columns).map(Number).sort((a, b) => a - b).flatMap((key, col) => {
    const column = columns[key].sort((a, b) => RANK[a.data.kind] - RANK[b.data.kind] || a.data.label.localeCompare(b.data.label))
    const top = ((tallest - column.length) * 120) / 2
    return column.map((n, row) => ({ id: n.id, type: 'service', position: { x: col * 340, y: top + row * 120 }, data: n.data }))
  })
}

export const EXAMPLE_TF = `variable "instance_type" {
  default = "m5.large"
}

resource "aws_lb" "web" {
  name               = "web"
  load_balancer_type = "application"
  subnets            = [aws_subnet.public.id]
}

resource "aws_lb_target_group" "web" {
  port   = 80
  vpc_id = aws_vpc.main.id
}

resource "aws_lb_listener" "web" {
  load_balancer_arn = aws_lb.web.arn
  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.web.arn
  }
}

resource "aws_launch_template" "web" {
  instance_type = var.instance_type
  user_data     = base64encode("DB_HOST=\${aws_db_instance.main.address}")
}

resource "aws_autoscaling_group" "web" {
  desired_capacity  = 3
  target_group_arns = [aws_lb_target_group.web.arn]
  launch_template {
    id = aws_launch_template.web.id
  }
}

resource "aws_db_instance" "main" {
  instance_class = "db.t3.medium"
  multi_az       = true
  engine         = "postgres"
}

resource "aws_s3_bucket" "assets" {
  bucket = "my-assets"
}

resource "aws_sqs_queue" "jobs" {
  name = "jobs"
}

resource "aws_lambda_function" "worker" {
  function_name = "worker"
  memory_size   = 1024
  environment {
    variables = {
      BUCKET = aws_s3_bucket.assets.bucket
    }
  }
}

resource "aws_lambda_event_source_mapping" "jobs" {
  event_source_arn = aws_sqs_queue.jobs.arn
  function_name    = aws_lambda_function.worker.arn
}

resource "aws_vpc" "main" {
  cidr_block = "10.0.0.0/16"
}

resource "aws_subnet" "public" {
  vpc_id = aws_vpc.main.id
}
`
