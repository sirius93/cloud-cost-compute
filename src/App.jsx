import { createContext, useContext, useEffect, useRef, useState } from 'react'
import {
  ReactFlow, ReactFlowProvider, Background, Controls, Handle, Position,
  addEdge, useNodesState, useEdgesState, useReactFlow, useConnection,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Server, Container, Boxes, Zap, Database, MemoryStick, Archive, HardDrive, Package, Split, Router, Globe, Inbox, ScrollText, Users, Trash2, Coffee, House, FileCode, X } from 'lucide-react'
import { CLOUDS, KINDS, UNITS, newData, nodeCosts, edgeCost, edgeRate, hourlyPrice, sizeOf, sizesOf, totals } from './cost.js'
import { importTerraform, isTerraformFile, EXAMPLE_TF } from './terraform.js'

const ICONS = {
  compute: Server, container: Container, k8s: Boxes, serverless: Zap, database: Database, cache: MemoryStick,
  object: Archive, block: HardDrive, registry: Package, lb: Split, nat: Router, cdn: Globe, internet: Users,
  queue: Inbox, logs: ScrollText,
}
const GROUPS = [...new Set(Object.values(KINDS).map(k => k.group))]
const STORE = 'ccc-diagram'
const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format
const rate = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 4 }).format
const CloudCtx = createContext('aws')
const CostsCtx = createContext({})

// lucide-react no longer ships brand icons, so the GitHub mark is inlined.
const GitHubMark = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
    <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
  </svg>
)

const svcName = (cloud, kind) => CLOUDS[cloud].services[kind]?.name ?? KINDS[kind].label

const node = (id, kind, x, y, extra) => ({ id, type: 'service', position: { x, y }, data: { ...newData(kind), ...extra } })
const wire = (source, target, gb) => ({ id: `${source}-${target}`, source, target, data: { gb } })
const SAMPLE = {
  cloud: 'aws',
  nodes: [
    node('users', 'internet', 0, 120),
    node('lb', 'lb', 240, 120),
    node('web', 'compute', 480, 40, { qty: 2, size: 2 }),
    node('db', 'database', 760, 0, { size: 1 }),
    node('files', 'object', 760, 200),
  ],
  edges: [wire('users', 'lb', 200), wire('lb', 'web', 200), wire('web', 'db', 50), wire('web', 'files', 20)],
}

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE))
    if (!saved) return SAMPLE
    // Fill fields added since the diagram was saved.
    return { ...saved, nodes: saved.nodes.map(n => ({ ...n, data: { ...newData(n.data.kind), ...n.data } })) }
  } catch { return SAMPLE }
}

function describe(cloud, d) {
  const k = KINDS[d.kind]
  if (!k.model) return 'Traffic source'
  const size = () => d.kind === 'container' ? `${d.vcpu + d.sidecarVcpu} vCPU / ${d.memGiB + d.sidecarMemGiB} GiB` : sizeOf(cloud, d)[0]
  const what = k.model === 'hourly' ? `${d.qty}× ${size()}` : `${d.amount} ${k.amountUnit}`
  return `${what} · ${d.duration} ${d.unit}`
}

function ServiceNode({ id, data }) {
  const cloud = useContext(CloudCtx)
  const costs = useContext(CostsCtx)
  const k = KINDS[data.kind]
  const Icon = ICONS[data.kind]
  // While a wire is being dragged, the target handle covers the whole node so you can drop anywhere on it.
  const wiring = useConnection(c => c.inProgress && c.fromHandle?.type === 'source')
  return (
    <div className={`node ${k.group.toLowerCase()}`}>
      <Handle type="target" position={Position.Left} className={wiring ? 'drop-zone' : ''} />
      <Icon size={22} aria-hidden />
      <div className="node-text">
        <b>{svcName(cloud, data.kind)}</b>
        {data.label && <small className="node-label" data-hj-suppress>{data.label}</small>}
        <small>{describe(cloud, data)}</small>
      </div>
      {k.model && <span className="node-cost">{usd(costs[id])}</span>}
      <Handle type="source" position={Position.Right} />
    </div>
  )
}
const nodeTypes = { service: ServiceNode }

function Palette({ cloud, onAdd }) {
  return (
    <nav className="palette" aria-label="Services">
      {GROUPS.map(g => (
        <section key={g}>
          <h2>{g}</h2>
          {Object.entries(KINDS).filter(([, k]) => k.group === g).map(([kind, k]) => {
            const Icon = ICONS[kind]
            return (
              <button key={kind} className={`tile ${g.toLowerCase()}`} draggable title="Drag onto the canvas, or click to add"
                onDragStart={e => e.dataTransfer.setData('application/x-kind', kind)} onClick={() => onAdd(kind)}>
                <Icon size={18} aria-hidden />
                <span><b>{svcName(cloud, kind)}</b><small>{k.label}</small></span>
              </button>
            )
          })}
        </section>
      ))}
    </nav>
  )
}

const numInput = (value, onChange) => ({
  type: 'number', min: 0, step: 'any', value, onChange: e => onChange(Math.max(0, Number(e.target.value) || 0)),
})

function NodeConfig({ cloud, data: d, cost, patch, remove }) {
  const k = KINDS[d.kind]
  const svc = CLOUDS[cloud].services[d.kind]
  return (
    <section className="card">
      <h2>{svcName(cloud, d.kind)}</h2>
      {d.source && <p className="muted fine source" data-hj-suppress>From Terraform: {d.source}</p>}
      {k.model === 'hourly' && <>
        {sizesOf(cloud, d.kind).length > 0 && <label>Size
          <select value={Math.min(d.size, sizesOf(cloud, d.kind).length - 1)} onChange={e => patch({ size: Number(e.target.value) })}>
            {sizesOf(cloud, d.kind).map(([name, price], i) => <option key={i} value={i}>{name} — {rate(price)}/h</option>)}
          </select>
        </label>}
        <label>{k.qtyLabel ?? 'Quantity'} <input {...numInput(d.qty, qty => patch({ qty }))} step={1} /></label>
      </>}
      {k.model === 'usage' && <label>{k.amountLabel}
        <input {...numInput(d.amount, amount => patch({ amount }))} />
        <small className="muted">{rate(svc.price)} per {k.priceUnit}</small>
      </label>}
      {k.extra?.filter(([, , show]) => !show || show(svc)).map(([key, label]) => (
        <label key={key}>{label} <input {...numInput(d[key], v => patch({ [key]: v }))} /></label>
      ))}
      {k.note && <p className="muted fine">{k.note}</p>}
      {d.kind === 'container' && <p className="muted fine">
        {rate(svc.cpuHour)}/vCPU-h + {rate(svc.gibHour)}/GiB-h = {rate(hourlyPrice(cloud, d))}/h per task.
      </p>}
      {d.kind === 'nat' && <p className="muted fine">
        {svc.perVm
          ? `${rate(svc.perVm)}/h per VM, capped at ${rate(svc.hourly)}/h, plus ${rate(svc.price)}/GB processed.`
          : `${rate(svc.hourly)}/h per gateway plus ${rate(svc.price)}/GB processed.`}
      </p>}
      {d.kind === 'serverless' && <p className="muted fine">
        {svc.cpuSecond
          ? `${rate(svc.cpuSecond)}/vCPU-s + ${rate(svc.gibSecond)}/GiB-s while handling requests. Minimum instances not included.`
          : `${rate(svc.gibSecond)}/GiB-s; CPU scales with memory. One request per instance.`}
      </p>}
      {d.kind === 'lb' && svc.pool && <p className="muted fine">
        {rate(sizeOf(cloud, d)[1])}/h covers the first {svc.pool.included} rules of each type, then {rate(svc.pool.extra)}/h per extra rule.
        The charge is split across this diagram's rules, which are treated as one project.
      </p>}
      {d.kind === 'cdn' && <p className="muted fine">
        Origin serves {Math.round(d.amount * (1 - Math.min(d.hit, 100) / 100))} GB/mo of cache misses
        (fill {rate(svc.fill)}/GB, {rate(svc.perMReq)} per million requests{svc.base ? `, ${usd(svc.base)}/mo base fee` : ''}).
        Set that on the CDN → origin wire.
      </p>}
      {k.model && <label>Run for
        <span className="row">
          <input {...numInput(d.duration, duration => patch({ duration }))} />
          <select value={d.unit} onChange={e => patch({ unit: e.target.value })}>
            {Object.keys(UNITS).map(u => <option key={u}>{u}</option>)}
          </select>
        </span>
      </label>}
      {k.model
        ? <p className="big">{usd(cost)}</p>
        : <p className="muted">Wires to this node are billed at the internet egress rate ({rate(CLOUDS[cloud].egress)}/GB).</p>}
      <button className="danger" onClick={remove}><Trash2 size={14} aria-hidden /> Remove</button>
    </section>
  )
}

function EdgeConfig({ cloud, edge, a, b, patch, remove }) {
  const gb = edge.data?.gb ?? 0
  const kinds = [a.kind, b.kind]
  const c = CLOUDS[cloud]
  return (
    <section className="card">
      <h2>{svcName(cloud, a.kind)} → {svcName(cloud, b.kind)}</h2>
      <label>GB transferred per month <input {...numInput(gb, gb => patch({ gb }))} /></label>
      {kinds.includes('internet')
        ? <p className="muted">{kinds.includes('cdn')
            ? 'Billed on the CDN node as delivery, no separate charge.'
            : `Internet egress: ${rate(c.egress)}/GB`}</p>
        : <>
            <label className="check">
              <input type="checkbox" checked={!!edge.data?.crossZone} onChange={e => patch({ crossZone: e.target.checked })} />
              Crosses availability zones ({rate(c.interZone)}/GB)
            </label>
            <p className="muted fine">Traffic within one zone, and load balancer → serverless backends, is not billed separately.</p>
          </>}
      <p className="big">{usd(edgeCost(cloud, a, b, edge.data))}</p>
      <p className="muted fine">Rate in use: {rate(edgeRate(cloud, a, b, edge.data?.crossZone))}/GB</p>
      <button className="danger" onClick={remove}><Trash2 size={14} aria-hidden /> Remove wire</button>
    </section>
  )
}

function Estimate({ cloud, nodes, edges }) {
  const { groups, total } = totals(cloud, nodes, edges)
  return (
    <section className="card">
      <h2>Estimated cost</h2>
      <p className="total">{usd(total)}</p>
      <p className="muted">Each service over its own run time</p>
      {Object.entries(groups).filter(([, v]) => v > 0).map(([g, v]) => (
        <div key={g} className="bar">
          <i style={{ width: `${(v / total) * 100}%` }} />
          <span>{g}</span><span>{usd(v)}</span>
        </div>
      ))}
      <h3>Same diagram on</h3>
      {Object.entries(CLOUDS).map(([id, c]) => (
        <div key={id} className={`cmp ${id === cloud ? 'current' : ''}`}>
          <span>{c.name}</span><span>{usd(totals(id, nodes, edges).total)}</span>
        </div>
      ))}
      <p className="fine">Approximate on-demand list prices. Excludes tax, free tiers and discounts. Check the provider's calculator before committing a budget.</p>
    </section>
  )
}

// data-hj-suppress: Terraform can hold names and secrets, so keep it out of Hotjar session recordings.
function TerraformDialog({ onImport, onClose }) {
  const ref = useRef(null)
  const [files, setFiles] = useState([])
  const [text, setText] = useState('')
  const [problem, setProblem] = useState(null)
  useEffect(() => { ref.current.showModal() }, [])

  const addFiles = async list => {
    const read = await Promise.all([...list]
      .map(f => ({ f, name: f.webkitRelativePath || f.name }))
      .filter(({ name }) => isTerraformFile(name))
      .map(async ({ f, name }) => ({ name, text: await f.text() })))
    setProblem(read.length ? null : { message: 'No .tf or .tfvars files found there.', warnings: [] })
    setFiles(fs => [...fs.filter(a => !read.some(b => b.name === a.name)), ...read])
  }
  const build = () => {
    const all = text.trim() ? [...files, { name: 'pasted.tf', text }] : files
    const result = importTerraform(all)
    if (result.nodes.length) onImport(result)
    else setProblem({ message: 'No services that can be priced were found.', warnings: result.report.warnings })
  }
  return (
    <dialog ref={ref} className="tf-dialog" onClose={onClose} data-hj-suppress
      onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); addFiles(e.dataTransfer.files) }}>
      <h2>Import Terraform</h2>
      <p className="muted">Add one or more files, or a whole folder. They're read in your browser and never uploaded.</p>
      <div className="row">
        <label className="link">Choose files
          <input type="file" className="visually-hidden" multiple accept=".tf,.tfvars,.json" onChange={e => addFiles(e.target.files)} />
        </label>
        <label className="link">Choose folder
          <input type="file" className="visually-hidden" webkitdirectory="" onChange={e => addFiles(e.target.files)} />
        </label>
        <button onClick={() => setText(EXAMPLE_TF)}>Try an example</button>
      </div>
      {files.length > 0 && <ul className="tf-files">
        {files.map(f => <li key={f.name}>{f.name}
          <button aria-label={`Remove ${f.name}`} onClick={() => setFiles(fs => fs.filter(x => x !== f))}><X size={12} aria-hidden /></button>
        </li>)}
      </ul>}
      <label>Or paste Terraform here
        <textarea rows={12} spellCheck={false} value={text} onChange={e => setText(e.target.value)} placeholder={'resource "aws_instance" "web" {\n  instance_type = "t3.medium"\n}'} />
      </label>
      {problem && <div className="tf-problem" role="alert">
        {problem.message}
        {problem.warnings.map(w => <div key={w}>{w}</div>)}
      </div>}
      <div className="row tf-actions">
        <button onClick={() => ref.current.close()}>Cancel</button>
        <button className="primary" disabled={!files.length && !text.trim()} onClick={build}>Build diagram</button>
      </div>
      <p className="muted fine">Building replaces the diagram currently on the canvas.</p>
    </dialog>
  )
}

function ImportReport({ report, services, wires, onClose }) {
  return (
    <section className="card report" data-hj-suppress>
      <button className="close" aria-label="Dismiss import report" onClick={onClose}><X size={14} aria-hidden /></button>
      <h2>Terraform import</h2>
      <p>{services} services and {wires} wires from {report.resources} resources. You can edit all of it.</p>
      <ul>
        {report.placeholders > 0 && <li><b>{report.placeholders} usage-billed {report.placeholders === 1 ? 'service uses a placeholder' : 'services use placeholder'} amounts.</b> Terraform doesn't say how many GB or requests you'll have, so the total isn't reliable until you set them.</li>}
        <li>Wires default to 10 GB/month. Set real traffic on each one.</li>
        {report.inferredInternet && <li>The Internet node wasn't in your Terraform. It was added in front of your public entry points.</li>}
        {report.warnings.map(w => <li key={w}>{w}</li>)}
      </ul>
      {report.notPriced.length > 0 && <details>
        <summary>{report.notPriced.length} {report.notPriced.length === 1 ? 'resource' : 'resources'} not priced, which may cost money</summary>
        <ul>{report.notPriced.map(k => <li key={k}>{k}</li>)}</ul>
      </details>}
    </section>
  )
}

function Editor() {
  const [initial] = useState(load)
  const [cloud, setCloud] = useState(initial.cloud)
  const [nodes, setNodes, onNodesChange] = useNodesState(initial.nodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initial.edges)
  const { screenToFlowPosition, fitView } = useReactFlow()
  const [importing, setImporting] = useState(false)
  const [imported, setImported] = useState(null)

  useEffect(() => {
    const closeAbout = e => { if (e.key === 'Escape' && location.hash === '#about') location.hash = '' }
    addEventListener('keydown', closeAbout)
    return () => removeEventListener('keydown', closeAbout)
  }, [])

  useEffect(() => {
    try { localStorage.setItem(STORE, JSON.stringify({ cloud, nodes, edges })) } catch {}
  }, [cloud, nodes, edges])

  const add = (kind, position) => setNodes(ns => [
    ...ns.map(n => ({ ...n, selected: false })),
    { id: crypto.randomUUID(), type: 'service', position, data: newData(kind), selected: true },
  ])
  const addAtCenter = kind => add(kind, screenToFlowPosition({
    x: innerWidth / 2 + Math.random() * 60 - 30, y: innerHeight / 2 + Math.random() * 60 - 30,
  }))
  const onDrop = e => {
    e.preventDefault()
    const kind = e.dataTransfer.getData('application/x-kind')
    if (KINDS[kind]) add(kind, screenToFlowPosition({ x: e.clientX, y: e.clientY }))
  }

  const patchNode = (id, p) => setNodes(ns => ns.map(n => n.id === id ? { ...n, data: { ...n.data, ...p } } : n))
  const patchEdge = (id, p) => setEdges(es => es.map(e => e.id === id ? { ...e, data: { ...e.data, ...p } } : e))
  const removeNode = id => {
    setNodes(ns => ns.filter(n => n.id !== id))
    setEdges(es => es.filter(e => e.source !== id && e.target !== id))
  }

  const onImport = ({ cloud, nodes, edges, report }) => {
    setCloud(cloud)
    setNodes(nodes)
    setEdges(edges)
    setImported({ report, services: nodes.length, wires: edges.length })
    setImporting(false)
    setTimeout(() => fitView({ padding: 0.1 }), 50) // once the new nodes have been measured
  }

  const byId = Object.fromEntries(nodes.map(n => [n.id, n.data]))
  const shownEdges = edges.map(e => {
    const a = byId[e.source], b = byId[e.target], gb = e.data?.gb ?? 0
    return { ...e, label: `${gb} GB/mo · ${usd(a && b ? edgeCost(cloud, a, b, e.data) : 0)}` }
  })
  const selNode = nodes.find(n => n.selected)
  const selEdge = !selNode && edges.find(e => e.selected && byId[e.source] && byId[e.target])
  const costs = nodeCosts(cloud, nodes)

  return (
    <CloudCtx.Provider value={cloud}>
    <CostsCtx.Provider value={costs}>
      <div className="app">
        <header>
          <span className="brand">Cloud Cost Estimator</span>
          <div className="seg" role="group" aria-label="Cloud provider">
            {Object.entries(CLOUDS).map(([id, c]) => (
              <button key={id} aria-pressed={cloud === id} onClick={() => setCloud(id)}>{c.name}</button>
            ))}
          </div>
          <span className="muted">{CLOUDS[cloud].region}</span>
          <span className="spacer" />
          <a className="link" href="#about">About</a>
          <button className="primary with-icon" onClick={() => setImporting(true)}><FileCode size={14} aria-hidden /> Import Terraform</button>
          <button onClick={() => { setNodes(SAMPLE.nodes); setEdges(SAMPLE.edges); setImported(null) }}>Load sample</button>
          <button onClick={() => { setNodes([]); setEdges([]); setImported(null) }}>Clear</button>
          <a className="link icon" href="https://nandan.dev/" target="_blank" rel="noopener noreferrer" aria-label="nandan.dev" title="nandan.dev">
            <House size={16} aria-hidden />
          </a>
          <a className="link icon" href="https://github.com/sirius93/cloud-cost-estimator" target="_blank" rel="noopener noreferrer" aria-label="GitHub repository" title="GitHub repository">
            <GitHubMark />
          </a>
          <a className="link coffee" href="https://buymeacoffee.com/siri" target="_blank" rel="noopener noreferrer">
            <Coffee size={16} aria-hidden /> Buy me a coffee
          </a>
        </header>
        <Palette cloud={cloud} onAdd={addAtCenter} />
        <main onDrop={onDrop} onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move' }}>
          <ReactFlow
            nodes={nodes} edges={shownEdges} nodeTypes={nodeTypes}
            onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
            onConnect={c => setEdges(es => addEdge({ ...c, data: { gb: 10 } }, es))}
            isValidConnection={c => c.source !== c.target}
            deleteKeyCode={['Backspace', 'Delete']} colorMode="system" fitView
          >
            <Background />
            <Controls />
          </ReactFlow>
        </main>
        <aside>
          {imported && <ImportReport {...imported} onClose={() => setImported(null)} />}
          {selNode
            ? <NodeConfig cloud={cloud} data={selNode.data} cost={costs[selNode.id]} patch={p => patchNode(selNode.id, p)} remove={() => removeNode(selNode.id)} />
            : selEdge
              ? <EdgeConfig cloud={cloud} edge={selEdge} a={byId[selEdge.source]} b={byId[selEdge.target]}
                  patch={p => patchEdge(selEdge.id, p)} remove={() => setEdges(es => es.filter(e => e.id !== selEdge.id))} />
              : <section className="card muted">
                  Drag services from the left onto the canvas. Wire them by dragging from a node's right dot to another node.
                  Click a node or wire to configure it.
                </section>}
          <Estimate cloud={cloud} nodes={nodes} edges={edges} />
        </aside>
        {importing && <TerraformDialog onImport={onImport} onClose={() => setImporting(false)} />}
      </div>
    </CostsCtx.Provider>
    </CloudCtx.Provider>
  )
}

export default function App() {
  return <ReactFlowProvider><Editor /></ReactFlowProvider>
}
