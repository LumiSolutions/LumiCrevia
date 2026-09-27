# Crevia migration boundary for DripForge

Wave 7A does not migrate DripForge. `dripforge.ch` stays on DripForge. No DNS record, publication target, or HQ route changes.

## What would move later

DripForge already classifies these HQ routes as `MOVE TO CREVIA LATER` in `lib/orbia/commerce-contract.ts` and `docs/dripforgehq-migration-map.md`:

- `/dripforgehq/seiten` — CMS pages stored in shop settings
- `/dripforgehq/edit` — in-context editor
- `/dripforgehq/edit/preview` — editor preview
- `/dripforgehq/website-staging` — site staging

The page shape today is `CmsCustomPageContent` in `lib/admin/cms-custom-pages.ts`: a slug, published flag, hero fields, layout rows, and blocks of type `richtext`, `imageText`, `gallery`, `faq`, `contact`, `valueCards`, or `cta`. Those blocks are DripForge settings, not Crevia documents. A later import would map them into the Crevia block contract (`id`, `type`, `version`, `props`, `styles`, `responsive`, `children`, `metadata`) and would validate the result with `inspectSnapshot` before any draft save.

Presentation-specific website settings that describe the public site can move with that import. Commerce settings stay in DripForge: catalog, prices, inventory, orders, shop customers, coupons, loyalty, and shop configuration.

These routes are not Crevia work:

- `/dripforgehq/shop-einstellungen`, `/dripforgehq/dienstleistungen`, `/dripforgehq/countdown` stay commerce or site-config
- `/dripforgehq/saisons` is seasonal commerce content, not a Crevia site
- `/dripforgehq/erstbesucher` is analytics source data for a later Veyra aggregate
- customizer, studio, and Meshy screens stay DripForge extensions

## Strangler path

Not executed:

1. Create a Crevia site on purpose for a future DripForge product organization. Provisioning must not create that site, and `serva-staging` is not that organization.
2. Import DripForge CMS pages into a Crevia draft revision. Keep the DripForge settings as the live site until cutover.
3. Compare the draft with the current DripForge pages.
4. Open a token-scoped Crevia draft preview. Do not publish the import automatically.
5. Choose a publication target and publish one immutable revision.
6. Cut the public domain over only after that published revision is accepted. DNS stays outside this repository until that later wave.
7. Retire `/dripforgehq/seiten`, `/dripforgehq/edit`, `/dripforgehq/edit/preview`, and `/dripforgehq/website-staging` only after the cutover. Do not delete them in advance.

Shop customers, orders, and catalog data are not part of the import. Syntara may later suggest copy; the published site snapshot still belongs to Crevia.
