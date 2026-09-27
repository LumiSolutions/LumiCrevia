# LumiCrevia product contract

Wave 7A prepares the local product foundation. It does not call LumiOrbia, does not create a platform organization, and does not deploy Crevia.

The canonical Git line before this branch was `main` at `fffa683cbe51924278aee44fd8eb510e292370f7`, an empty README. No other branch, builder, database, or deployment existed in `LumiSolutions/LumiCrevia`. This contract describes the foundation added on `cursor/crevia-orbia-foundation-6e03`. It does not claim a visual editor.

## Purpose

LumiCrevia is the website builder and publication service:

- website and site-project records
- page editor document model
- design tokens and website theme configuration
- draft and published preview
- publication orchestration records
- website revision management

It is not the platform admin, the commerce catalog, the CRM, the accounting ledger, the marketing generation source, the inbox, or the analytics source.

## Data ownership

Crevia owns:

- websites and site projects
- pages, page trees, sections, blocks, and components
- layout, style tokens, website theme overrides, and breakpoints
- navigation structure and page metadata, including SEO fields
- draft revisions, published revisions, and preview state
- publication configuration and domain-mapping metadata
- website-specific media references

Orbia owns the platform organization, platform user, membership, product assignment, module assignment, extension assignment, platform branding, and platform audit.

DripForge / commerce owns products, orders, shop customers, inventory, prices, and commerce configuration. Syntara owns marketing generation, campaigns, generated marketing assets, and the brand profile used for content behavior. Navio owns inbox, chat, and notifications. Accora owns accounting. Veyra will own analytics aggregation. Crevia stores references to those systems and does not copy their source rows.

## Organization mapping

An Orbia organization is not a website.

```
Orbia organization
  -> one Crevia product organization (orbiaOrganizationId)
       -> zero or more sites
            -> pages
                 -> nested blocks
```

The only mapping key is `orbiaOrganizationId`. Email, slug, domain, site name, and brand name are not lookup keys. `identityLookupKey` keeps `orbiaUserId` and drops email.

A product organization may contain zero sites. Enabling Crevia does not create a website, homepage, theme, demo page, template, asset, or user.

## Identity

Target flow, prepared locally and not connected:

1. Orbia session
2. authorize
3. one-use code
4. `GET /api/auth/orbia/callback`
5. server exchange
6. `crevia_session`
7. fresh introspection for sensitive writes

The in-memory exchange rejects a wrong app, a wrong client, an expired code, a replay, and a second parallel consume. A password on the callback is rejected and does not open a session. `createOrbiaExchangeClient` returns `live_orbia_disabled` and performs no network call.

Dev and test may resolve a fixture user id through `resolveDevActor`. That actor has no organization. `APP_ENV` other than `LOCAL` or `TEST` rejects the dev actor. Production-like startup without `CREVIA_IDENTITY_MODE=orbia` is fail-closed.

## Session

`crevia_session` is `HttpOnly`, `SameSite=Lax`, and `Secure` when the app env is staging or production. The store keeps the SHA-256 hash, not the raw token.

Context:

- `orbiaUserId`
- `orbiaOrganizationId`
- `creviaOrganizationId`
- `membershipRole`
- modules and capabilities
- `evaluatedAt`

An `orbia_session` cookie is not accepted as a Crevia session.

## Provisioning

`POST /api/internal/orbia/provision` expects header `x-crevia-provisioning-key`. The key is `CREVIA_PROVISIONING_KEY`, separate from the identity client secret.

`enable` creates one empty product organization or returns the existing one. `disable` turns builder access off and leaves sites, pages, drafts, published revisions, and assets in place. `re-enable` restores the same product organization and does not seed content.

## Modules

Server gates that exist in this repository are `available`. Surfaces that do not exist are `planned`. The Orbia catalog is unchanged and still lists only `crevia.sites` as planned.

| Key | Local state | Server gate |
| --- | --- | --- |
| `crevia.dashboard` | planned | no |
| `crevia.sites` | available | yes |
| `crevia.pages` | available | yes |
| `crevia.builder` | available | yes |
| `crevia.assets` | available | yes |
| `crevia.themes` | available | yes |
| `crevia.preview` | available | yes |
| `crevia.publishing` | available | yes |
| `crevia.domains` | available | yes |
| `crevia.templates` | planned | no |

`crevia.builder` gates draft saves. It is not a canvas. There is no drag-and-drop implementation in this repository.

Gates are server-side. Builder off denies draft writes. Assets off denies asset create and archive. Publishing off denies publish. Domains off denies hostname writes. Themes off denies theme writes. Sites off denies site create and archive.

## Site model

`ProductOrganization` 1—N `Site`. A site has `id`, `organizationId`, `name`, `status` (`active` or `archived`), `homepagePageId`, `draftVersion`, and `publishedRevisionId`.

Page index rows carry `id`, `siteId`, `organizationId`, `title`, `slug`, `status`, `navigationVisible`, `sortOrder`, and `homepage`. Archive is a soft delete. Published revision history is kept.

## Page and block contract

The editable document is a JSON snapshot on a site revision, not a normalized block table. A page snapshot contains SEO metadata and a nested block tree. A block is:

- `id`
- `type` (`section`, `text`, `media`, `navigation`)
- `version`
- `props`
- `styles`
- `responsive` (`desktop`, `tablet`, `mobile` style values on the same block)
- `children`
- `metadata`

The type string is a product contract name, not a React component name. Known types are schema version 1. An unknown type is rejected. A known type with an unknown version returns `migration_required`. No migration engine is included.

Responsive values do not duplicate the page per breakpoint.

Server-side `inspectSnapshot` rejects the save when the document is invalid. Client types are not trusted.

## Revisions

`SiteRevision` fields: `revisionId`, `siteId`, `organizationId`, `version`, `status` (`DRAFT` or `PUBLISHED`), `createdAt`, `createdBy`, and `snapshot`.

A save sends `expectedVersion`. The matching draft version increments and stores a cloned snapshot. A stale expected version returns a conflict (`409` on the result). The save does not create a publication.

There is no client undo stack. An editor history would not replace these revisions.

## Publishing

A publication record has `siteId`, `revisionId`, `target`, `status` (`QUEUED`, `BUILDING`, `PUBLISHED`, `FAILED`), `createdAt`, `completedAt`, and `error`.

The local fixture marks a successful publish as `PUBLISHED` immediately. No cloud target is called. After publication, a newer draft save leaves `publishedRevisionId` on the published revision. Public render reads that snapshot and does not read the later draft.

## Assets

Classifications:

- `CREVIA_WEBSITE_ASSET`
- `SYNTARA_MARKETING_ASSET_REFERENCE`
- `COMMERCE_ASSET_REFERENCE`
- `PLATFORM_BRANDING_REFERENCE`

External assets store `sourceSystem` and `externalAssetId` plus display metadata. This wave stores no bytes. Storage readiness stays degraded.

## Themes

Website theme tokens (colors, typography, spacing, borders, shadows) belong to a site. `platformBrandingRef` may point at an Orbia branding id. Crevia does not copy platform branding and does not copy a Syntara brand profile.

## Domains

A domain row stores `hostname`, `verificationStatus`, `sslStatus`, and `publicationTarget`. Saving a hostname does not mutate DNS or request a certificate.

## Disable and re-enable

Disable sets `access` to `disabled` and blocks new site writes. Existing rows remain. Re-enable uses the same `orbiaOrganizationId` and the same local id.

## Health

`GET /api/health` reports the process only. It does not print secrets, database URLs, or keys.

`GET /api/readiness` reports persistence, storage, identity, provisioning, migration, publishing, and builder. A missing publishing target leaves publishing `degraded` and builder `ready`. Orbia mode without client id and secret, or dev mode in production, fails identity closed.

## Persistence

The foundation store is in memory and is created empty for each process. There is no Prisma schema, no SQLite file, no PostgreSQL database, and no blob container. Cloud multi-tenant hosting still needs a durable organization-scoped database and an asset store. That choice is not made in this wave.

## DripForge boundary

`dripforge.ch` and the DripForge HQ routes stay where they are. Later migration scope is described in `docs/crevia-dripforge-migration.md`. This wave imports nothing.
