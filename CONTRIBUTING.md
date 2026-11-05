# Contributing

Thanks for helping. Price corrections are the most useful contribution, followed by new services and bug fixes.

## Getting started

```sh
git clone https://github.com/sirius93/cloud-cost-estimator.git
cd cloud-cost-estimator
npm install
npm run dev
```

Before opening a pull request, make sure both of these pass:

```sh
npm test
npm run build
```

## Fixing a price

All prices live in `CLOUDS` in [src/cost.js](src/cost.js).

1. Change the number.
2. In the pull request, link the provider's pricing page you took it from and name the region.
3. If a test in [src/cost.check.js](src/cost.check.js) used the old price, update it.

Prices are on-demand list prices, in USD, for the region shown in the app (`region` on each cloud). Hourly prices are per hour; storage is per GB-month; transfer is per GB.

## Adding a service

A service is a generic **kind** that maps onto every cloud, so diagrams can be re-priced on any of them.

1. **Add the kind** to `KINDS` in [src/cost.js](src/cost.js): its label, palette group and pricing model.
   - `model: 'hourly'`: priced per hour × quantity × run time. Give each cloud a `sizes` list (`[name, $/hour]`); size tiers line up by index across clouds.
   - `model: 'usage'`: priced on a monthly amount (GB, requests, …). Give each cloud a `price`, plus `base` and `included` if it has a monthly fee that includes some usage.
   - Use `defaults` and `extra` for additional inputs, and `note` for a short caveat shown in the settings panel.
2. **Add the service to all three clouds** in `CLOUDS`. If a cloud has no equivalent, say so in the pull request.
3. **Add special pricing logic** in `monthlyUsage` or `hourlyPrice` only if the service can't be expressed with the fields above.
4. **Pick an icon** from [Lucide](https://lucide.dev/icons/) and add it to `ICONS` in [src/App.jsx](src/App.jsx).
5. **Add a test** in [src/cost.check.js](src/cost.check.js) that calculates one realistic configuration by hand.

## Supporting a Terraform resource

All of this is in [src/terraform.js](src/terraform.js), with tests in [src/terraform.check.js](src/terraform.check.js).

- **It's a billable service:** add it to `SPECS`, naming the service kind and the attributes that hold its size, quantity and so on.
- **Traffic flows through it but it isn't billed** (like a target group): add it to `CONNECTORS`, and services linked through it get a wire. Never add shared infrastructure such as VPCs or subnets, or every service ends up connected.
- **It's free:** add it to `NO_COST`, so it isn't reported as "not priced".

If a value can't be read reliably, add a warning to the report instead of guessing.

## Code style

- Keep the cost math in `cost.js`, free of React, so it can be tested with plain Node.
- Match the surrounding code. Prefer a few clear lines over a new abstraction or dependency.
- Comment *why* something is priced the way it is, especially simplifications (for example, "ingestion only, retention not included").

## Reporting issues

[Open an issue](https://github.com/sirius93/cloud-cost-estimator/issues) with:

- the cloud, service and settings you used
- the cost the app showed and the cost you expected
- a link to the pricing page, for price problems
