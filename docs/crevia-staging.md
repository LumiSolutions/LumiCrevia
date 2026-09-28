# Crevia cloud staging infrastructure

Wave 7D stands up LumiCrevia as its own staging application. This wave is
infrastructure only. It does not assign Crevia in Orbia, create a Product
Organization, import DripForge, publish a site, or change `main`.

## Status

| Gate | State |
| --- | --- |
| CREVIA VISUAL BUILDER | READY |
| CREVIA PERSISTENCE | READY |
| CREVIA CLOUD INFRASTRUCTURE | BLOCKED — Azure deployment principal was not injected into this agent |
| CREVIA INFRA SECURITY | BLOCKED_OWNER_ACTION |
| CREVIA ORBIA CONTRACT | NOT_STARTED |
| CREVIA TENANT ACTIVATION | BLOCKED_BY_POLICY |

The application code, Neon project, schema, backup, and restore proof are in
place. The Container App, ACR image push, private blob containers, and runtime
storage proof wait on an Azure login. Do not treat the product as cloud-ready
until that work is finished.

## Source

| Item | Value |
| --- | --- |
| Original 7C commit (tested persistence) | `70cf0c44ca2ad663727cdc37550bb17a9286a4d5` |
| 7D cloud-adapter commit | `f880082ca8badf1f629ce64307cb17c16e34fb93` |
| 7D Dockerfile fix / current HEAD | `7f4cfeb951354d7d699f7f270becbde01b5f9bcb` |
| Working branch | `cursor/crevia-cloud-staging-f963` |
| `release/crevia-platform-v1` | not updated (acceptance incomplete) |
| `main` | unchanged |

Cloud-specific changes on 7D: `AzureBlobAssetStorage` behind `AssetStorage`,
`CREVIA_IDENTITY_MODE=infrastructure` for staging only, Dockerfile (TypeScript
build before production prune), and fail-closed storage when Azure is missing
in staging/production.

## Neon

| Item | Value |
| --- | --- |
| Project | LumiCrevia |
| Project ID | `curly-tree-38586033` |
| Organization | `org-wild-thunder-25200037` |
| Plan | Free |
| Region | `aws-eu-central-1` |
| PostgreSQL | 17.11 |
| Branch | `production` (`br-winter-dream-b26117qc`, default) |
| Database | `lumicrevia` |
| Role | `crevia` |
| Runtime connection | pooled Neon URL (`DATABASE_URL`) |
| Migration/admin connection | direct Neon URL (`DIRECT_DATABASE_URL`) |

The default `neondb` / `neondb_owner` leftover from project creation is unused
by the application. Connection strings are not recorded here.

## Migrations

`prisma migrate deploy` applied `20260927190000_init`.
`prisma migrate status`: Database schema is up to date. No drift.

Post-migration and restore-proof business counts are all zero:

ProductOrganization, Site, Page, SiteRevision, Publication, Theme, Asset,
ProductSession, PreviewToken = 0.

`_prisma_migrations` = 1 (`20260927190000_init`). No seed.

## Backup and restore

Local artifact (upload to `crevia-backups` is pending Azure login):

- path: `crevia-backups/postgres/initial/20260928T055231Z/lumicrevia.dump`
- SHA-256: `93b896a87c14150e33b8a5f674e1333e2eecd72424cac66df31172e7b716def2`
- size: 28600 bytes
- timestamp: `20260928T055231Z`
- format: PostgreSQL custom (`-Fc`)
- restore: isolated PostgreSQL 17.11 on local port 5433, database `crevia_restore_7d`
- restore exit: 0
- schema objects: 43 public tables/indexes, equal to source
- business counts after restore: all zero

`metadata.json` sits beside the dump and contains only non-secret operational
fields.

## Azure inventory (anonymous / unauthenticated)

Existing shared infrastructure that resolved:

- Storage account `lumisolutionsstorage` (blob endpoint answers; anonymous list/get is `401 NoAuthenticationInformation`)
- ACR `acrlumisolutions` (registry API answers `401 UNAUTHORIZED`)

Not created or confirmed in this wave:

- container `crevia-assets`
- container `crevia-backups`
- ACR repository `lumicrevia`
- Container App `ca-crevia-staging`

Local immutable image (not pushed; no ACR credential):

- tag: `acrlumisolutions.azurecr.io/lumicrevia:7f4cfeb951354d7d699f7f270becbde01b5f9bcb`
- image id: `sha256:50ee948a77505f600bce26ef4c4b97dee3174e2a351162e51a33dba996afd1d8`
- registry digest: none (push blocked)
- image env: `NODE_ENV=production` only; no `DATABASE_URL`, SAS, or ACR token

Local container proof against Neon (not Azure Container Apps):

- health HTTP 200: process ok, database ok, assetStorage down
- readiness HTTP 200 / `status=degraded` / `mode=infrastructure`
- `proof.database=lumicrevia`, migration ready, identity/provisioning skipped
- storage missing (no local filesystem fallback)
- `/` and `/app` 403; business writes 401 `no_session`; provision 403 `infrastructure_mode`
- health/readiness/logs contained no connection strings

Anonymous requests did not list blobs or containers. Public access was not
enabled by this wave. Account-wide public access was not changed.

## Desired Azure layout (blocked)

Reuse:

- Storage: `lumisolutionsstorage`
- ACR: `acrlumisolutions`
- Environment: `cae-lumisolutions-prod`

Create if still absent:

- private containers `crevia-assets` and `crevia-backups` (public access none)
- immutable image `acrlumisolutions.azurecr.io/lumicrevia:<deployed-commit>`
- Container App `ca-crevia-staging`, minReplicas 0, maxReplicas 1, system-assigned identity

Runtime must use `AzureBlobAssetStorage` / container `crevia-assets`.
Staging must not fall back to `$PWD/var/crevia-assets`.

## Identity mode

Staging runtime is intended to start with:

```
CREVIA_APP_ENV=staging
CREVIA_IDENTITY_MODE=infrastructure
```

This mode is not a user auth mode. Production refuses it. Effects:

- health and readiness allowed
- no login, Dev Actor, mock login, product session, Orbia callback success, or provisioning
- builder/business routes denied (`403 infrastructure_mode` or unauthenticated deny)
- readiness `identity=skipped`, `provisioning=skipped`, `publishing=degraded`
- HTTP 200 when core persistence/migration are valid; body `status=degraded` because publishing stays unconfigured

## Managed identity / Owner actions

This agent had Azure CLI 2.90.0 and no login:

- no `AZURE_*` / `ARM_*` secrets
- `az login --identity` timed out (no IMDS)
- `Microsoft.Authorization/roleAssignments/write` could not be tested

`MANAGED_IDENTITY_HARDENING = BLOCKED_OWNER_ACTION`

Required Owner actions (do not send Owner credentials to the agent):

A. After `ca-crevia-staging` exists, assign **Storage Blob Data Contributor**
   to its system-assigned identity, scope **only** container `crevia-assets`.

B. Assign **AcrPull** to the same principal, scope `acrlumisolutions`.

Until A/B land, use a least-privilege temporary container SAS on
`crevia-assets` only and a repository-scoped ACR pull token for `lumicrevia`.
Do not grant backup, account-wide, or catalog-wide access.

Unblock for the next 7D continuation: inject a Contributor (or equivalent)
service principal into the agent environment so containers, the image, and
`ca-crevia-staging` can be created. Do not inject Owner.

## Publishing

Unconfigured / degraded. No Static Web App, CDN, custom domain, DNS, or
production renderer.

## Orbia

Not modified. Expected unchanged:

- branch `release/orbia-platform-v1`
- commit `1dfa0c653daf2c9a029be69dbbf70e680379b792`
- one Platform Organization: `serva-staging`
- Crevia remains planned / disabled
- no `crevia.organization` ExternalReference

## Rollback

Do not delete Neon, storage, or backups.

- App: previous Container App revision, or scale to zero if only one revision exists.
- Schema: keep applied migrations; restore from `crevia-backups/postgres/initial/...` if needed.

## Next wave

WAVE 7E — Orbia ↔ Crevia live contract (health, identity, authorize/exchange,
introspection, provisioning contract, descriptor, modules) still without a
Product Organization or app assignment.

Finish 7D Azure first.
