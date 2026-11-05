// Search and answer-engine content, rendered into index.html at build time (see vite.config.js).
// Built from the real price data, so the page can't drift from what the app calculates.

import { CLOUDS, KINDS, newData, nodeCost, sizeOf } from './cost.js'

export const PAGE_URL = 'https://nandan.dev/cloud-cost-estimator/'
export const TITLE = 'Cloud Cost Estimator: AWS, Azure & GCP Calculator'
export const DESCRIPTION = 'Free cloud cost calculator for AWS, Azure and Google Cloud. Drag services onto a canvas or import Terraform to estimate and compare costs. No sign-up.'

export const FAQ = [
  ['What is Cloud Cost Estimator?',
    'Cloud Cost Estimator is a free browser tool that estimates what a cloud architecture will cost on AWS, Azure and Google Cloud. You draw the architecture by dragging services onto a canvas, or import it from Terraform, then set sizes and run times to see the cost of each service and the total.'],
  ['Is Cloud Cost Estimator free?',
    'Yes. It is free to use, needs no account or sign-up, and does not ask for access to your cloud account. The source code is on GitHub.'],
  ['How do I compare AWS, Azure and Google Cloud costs?',
    'Build one diagram and the estimate panel prices it on all three clouds side by side. Each service type maps to its equivalent on every cloud, for example EC2, Azure Virtual Machines and Compute Engine, so you can switch clouds without redrawing anything.'],
  ['Can I estimate cloud costs from Terraform?',
    'Yes. Add .tf and .tfvars files, a whole folder, or pasted code, and the tool builds an editable diagram with services, sizes, quantities and connections. Terraform does not say how much traffic or storage you will use, so usage-billed services start with placeholder amounts that you should replace. An import report lists these placeholders, any sizes missing from the price list, and resources it could not price.'],
  ['Is my Terraform code uploaded anywhere?',
    'No. Terraform files are read in your browser and never sent to a server, because the tool has no backend. The site does use Google Analytics and Hotjar to understand usage, and the import dialog is marked to be excluded from Hotjar session recordings.'],
  ['How is the monthly cost calculated?',
    'Hourly services cost the hourly price × quantity × hours, using 730 hours per month, the convention all three clouds use. Usage-billed services such as storage, CDN and functions cost their unit price × your monthly usage. Wires add data transfer: internet egress is charged, and traffic between availability zones is charged if you mark the wire as crossing zones.'],
  ['How accurate are the estimates?',
    'They are approximate. Prices are on-demand list prices for one region per cloud (AWS us-east-1, Azure East US and Google Cloud us-central1), entered by hand from public pricing pages. Tax, free tiers, reserved or committed-use discounts and some secondary charges are not included. Use it to compare designs and spot big costs, then confirm with the provider\'s own calculator before committing a budget.'],
  ['Does it include data transfer and NAT gateway costs?',
    'Yes. Each wire between services carries a data transfer amount in GB per month, and a NAT gateway node charges both its hourly fee and the data it processes. These are two of the costs most often missed in an early estimate.'],
]

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format
const clouds = Object.entries(CLOUDS)

const table = (caption, head, rows) => `<div class="table-scroll"><table>
<caption>${esc(caption)}</caption>
<thead><tr>${head.map(h => `<th scope="col">${esc(h)}</th>`).join('')}</tr></thead>
<tbody>${rows.map(([first, ...rest]) => `<tr><th scope="row">${esc(first)}</th>${rest.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('\n')}</tbody>
</table></div>`

export const servicesTable = () => table('Equivalent services on each cloud', ['Service', ...clouds.map(([, c]) => c.name)],
  Object.entries(KINDS).filter(([, k]) => k.model).map(([kind, k]) => [k.label, ...clouds.map(([, c]) => c.services[kind].name)]))

// One month of each example, priced with the same functions the app uses.
const EXAMPLES = [
  ['1 mid-size VM', 'compute', { size: 2 }],
  ['1 managed SQL database', 'database', { size: 2 }],
  ['1 load balancer', 'lb', {}],
  ['1 NAT gateway + 100 GB processed', 'nat', {}],
  ['100 GB object storage', 'object', {}],
]
export const pricesTable = () => table('Example cost for one month at approximate on-demand list prices', ['Example', ...clouds.map(([, c]) => c.name)],
  EXAMPLES.map(([label, kind, extra]) => [label, ...clouds.map(([id]) => {
    const d = { ...newData(kind), ...extra }
    return `${usd(nodeCost(id, d))}${KINDS[kind].model === 'hourly' && extra.size !== undefined ? ` (${sizeOf(id, d)[0]})` : ''}`
  })]))

export const faqHtml = () => FAQ.map(([q, a]) => `<h3>${esc(q)}</h3>\n<p>${esc(a)}</p>`).join('\n')

export function jsonLd(today) {
  const author = {
    '@type': 'Person', name: 'Nandan Kumar', url: 'https://nandan.dev',
    sameAs: ['https://github.com/sirius93', 'https://www.linkedin.com/in/nandank93/', 'https://twitter.com/_sirius93_', 'https://blog.nandan.dev'],
  }
  const graph = [
    {
      '@type': 'WebApplication', name: 'Cloud Cost Estimator', url: PAGE_URL, description: DESCRIPTION,
      applicationCategory: 'DeveloperApplication', operatingSystem: 'Any (web browser)', browserRequirements: 'Requires JavaScript',
      isAccessibleForFree: true, offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
      image: `${PAGE_URL}og-image.png`, screenshot: `${PAGE_URL}screenshot.png`, dateModified: today, author,
      sameAs: ['https://github.com/sirius93/cloud-cost-estimator'],
      featureList: [
        'Drag-and-drop cloud architecture canvas', 'AWS, Azure and Google Cloud pricing', 'Side-by-side cost comparison across clouds',
        'Import from Terraform', 'Data transfer and NAT gateway costs', 'Per-service and total cost breakdown',
      ],
    },
    {
      '@type': 'FAQPage', url: PAGE_URL,
      mainEntity: FAQ.map(([name, text]) => ({ '@type': 'Question', name, acceptedAnswer: { '@type': 'Answer', text } })),
    },
    {
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Nandan Kumar', item: 'https://nandan.dev/' },
        { '@type': 'ListItem', position: 2, name: 'Cloud Cost Estimator', item: PAGE_URL },
      ],
    },
  ]
  return JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }).replace(/</g, '\\u003c')
}

export function renderSeo(html, today = new Date().toISOString().slice(0, 10)) {
  const values = {
    TITLE: esc(TITLE), DESCRIPTION: esc(DESCRIPTION), URL: PAGE_URL, JSON_LD: jsonLd(today), TODAY: today,
    SERVICES_TABLE: servicesTable(), PRICES_TABLE: pricesTable(), FAQ: faqHtml(),
  }
  return html.replace(/\{\{(\w+)\}\}/g, (_, key) => values[key])
}
