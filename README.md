# Cloud Cost Estimator

Sketch your cloud architecture and see roughly what it will cost.

Pick **AWS**, **Azure** or **Google Cloud**, drag services onto a canvas, wire them together, and set how big they are and how long they run. The total updates as you go, and the same diagram is priced on all three clouds side by side.

**Try it:** [https://nandan.dev/cloud-cost-estimator/](https://nandan.dev/cloud-cost-estimator/)

## Features

- Drag-and-drop canvas with 15 service types: VMs, containers (with sidecars), Kubernetes, functions, SQL, Redis, object/block storage, container registry, load balancer, NAT gateway, CDN, message queue, logging, and an Internet/users node
- Per-service settings: instance size, quantity, run time (hours, days or months), and usage such as GB stored, requests, cache hit ratio or memory per task
- Wires carry data transfer (GB/month). Internet egress and cross-zone traffic are charged; traffic within one zone is free
- Cost breakdown by service group, plus a cross-cloud comparison of the same diagram
- **Import Terraform:** add `.tf` and `.tfvars` files, a whole folder, or pasted code, and get an editable diagram with its services, sizes, quantities and connections
- Your diagram is saved in your browser automatically

The app has no backend of its own, but the live site uses Google Analytics and Hotjar to see how it's used. Hotjar session recordings can include what's on screen, such as your diagram.

## Importing Terraform

Click **Import Terraform** to turn existing configuration into a diagram you can edit and price. Files are read in your browser and never uploaded, and the import dialog is excluded from Hotjar recordings. Resource names shown on the canvas are excluded too.

AWS, Azure and Google Cloud resources are supported. An import report lists everything that needs your attention:

- **Usage is a placeholder.** Terraform doesn't say how many GB or requests you'll have, so services billed on usage start with default amounts and wires start at 10 GB/month. The total isn't reliable until you set them.
- **Sizes not in the price list** are priced as the closest match and flagged.
- **Unmapped resources** are listed as not priced, so you can see what the total leaves out.
- **Not evaluated:** modules aren't expanded, `for_each` is priced as one, and conditional or computed values are flagged instead of guessed. Terraform JSON isn't supported. Each folder is read on its own, so same-named resources in `dev/` and `prod/` stay separate.
- **Not included:** root disks and database storage that are set inside another resource.

## Accuracy

Prices are **approximate on-demand list prices** for one region per cloud (us-east-1, East US, us-central1), copied by hand from the providers' public pricing pages. Tax, free tiers, reserved/committed-use discounts and some secondary charges are not included. Use this to compare designs and catch big-ticket items, then confirm with the provider's own calculator before committing a budget.

Spotted a wrong price? Please [open an issue](https://github.com/sirius93/cloud-cost-estimator/issues) or a pull request. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Run locally

Requires Node.js 20.19 or newer.

```sh
npm install
npm run dev     # start the dev server
npm test        # run the cost-calculation checks
npm run build   # production build in dist/
```

Every push to `main` is tested, built and deployed to GitHub Pages by [.github/workflows/pages.yml](.github/workflows/pages.yml).

## How it's built

React with [React Flow](https://reactflow.dev/) for the canvas and [Lucide](https://lucide.dev/) for icons, bundled with Vite. There is no backend.

| File | What's in it |
|---|---|
| [src/cost.js](src/cost.js) | Service types, prices for each cloud, and all cost math. Pure JavaScript with no React |
| [src/cost.check.js](src/cost.check.js) | Assertions for the cost math (`npm test`) |
| [src/terraform.js](src/terraform.js) | Reads Terraform and builds the diagram: the resource mapping, wiring and layout. No React |
| [src/terraform.check.js](src/terraform.check.js) | Assertions for the Terraform import (also run by `npm test`) |
| [src/seo.js](src/seo.js) | Page title, FAQ and structured data, rendered into `index.html` at build time from the real price data |
| [src/App.jsx](src/App.jsx) | Canvas, palette, settings panel and cost estimate |
| [src/styles.css](src/styles.css) | Styles, including dark mode |

## Support

If this saved you a surprise on your cloud bill, you can [buy me a coffee](https://buymeacoffee.com/siri) ☕

More of my work: [nandan.dev](https://nandan.dev/)
