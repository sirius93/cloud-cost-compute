import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { TITLE, DESCRIPTION, FAQ, jsonLd, renderSeo, servicesTable, pricesTable } from './seo.js'
import { KINDS } from './cost.js'

assert.ok(TITLE.length <= 60, `title is ${TITLE.length} chars`)
assert.ok(DESCRIPTION.length <= 160, `description is ${DESCRIPTION.length} chars`)

const data = JSON.parse(jsonLd('2026-01-01'))
const [app, faq] = data['@graph']
assert.equal(app.url, 'https://nandan.dev/cloud-cost-estimator/')
assert.equal(faq.mainEntity.length, FAQ.length)

const services = servicesTable()
for (const k of Object.values(KINDS)) if (k.model) assert.ok(services.includes(k.label), k.label)
assert.match(services, /EC2.*Virtual Machines.*Compute Engine/)
assert.match(pricesTable(), /\$70\.08 \(m5\.large\)/) // 0.096 × 730, same math as the app
assert.doesNotMatch(pricesTable(), /NaN|undefined/)

// Every placeholder in the page gets filled, and every FAQ answer is visible text (required for FAQ markup).
const page = renderSeo(readFileSync(new URL('../index.html', import.meta.url), 'utf8'), '2026-01-01')
assert.doesNotMatch(page, /\{\{|undefined/)
for (const [q, a] of FAQ) {
  const text = s => s.replace(/&/g, '&amp;')
  assert.ok(page.includes(`<h3>${text(q)}</h3>`), q)
  assert.ok(page.includes(a.slice(0, 40)), q)
}
assert.equal((page.match(/<h1/g) ?? []).length, 1)
assert.ok(!/<h1/.test(readFileSync(new URL('./App.jsx', import.meta.url), 'utf8')), 'the static page owns the only h1')

console.log('seo checks passed')
