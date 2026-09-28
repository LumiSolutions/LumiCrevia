# Crevia cloud staging infrastructure

Wave 7D stands up LumiCrevia as its own staging application. This wave is
infrastructure only. It does not assign Crevia in Orbia, create a Product
Organization, import DripForge, publish a site, or change `main`.

## Status

| Gate | State |
| --- | --- |
| CREVIA VISUAL BUILDER | READY |
| CREVIA PERSISTENCE | READY |
| CREVIA CLOUD INFRASTRUCTURE | READY — staging Container App is live |
| CREVIA INFRA SECURITY | BLOCKED_OWNER_ACTION — managed-identity RBAC was refused; temporary SAS and ACR pull token expire 2026-10-05T07:19:59Z |
| CREVIA ORBIA CONTRACT | NOT_STARTED |
| CREVIA TENANT ACTIVATION | BLOCKED_BY_POLICY |

Wave 7D.1 deployed the exact source commit below. No Product Organization was
created. Orbia was not modified. `main` was not merged.

## Source

| Item | Value |
| --- | --- |
| Original 7C commit (tested persistence) | `70cf0c44ca2ad663727cdc37550bb17a9286a4d5` |
| 7D cloud-adapter commit | `f880082ca8badf1f629ce64307cb17c16e34fb93` |
| 7D Dockerfile fix | `7f4cfeb951354d7d699f7f270becbde01b5f9bcb` |
| Deployed source commit | `866ef4714e0c93d5915c41b26e014eed8e5efdaa` |
| Working branch | `cursor/crevia-cloud-staging-f963` |
| `release/crevia-platform-v1` | `866ef4714e0c93d5915c41b26e014eed8e5efdaa` |
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

Uploaded to private container `crevia-backups` (public access none):

- blob: `postgres/initial/20260928T055231Z/lumicrevia.dump`
- SHA-256: `93b896a87c14150e33b8a5f674e1333e2eecd72424cac66df31172e7b716def2`
- size: 28600 bytes
- timestamp: `20260928T055231Z`
- format: PostgreSQL custom (`-Fc`)
- restore proof from the prior step: isolated PostgreSQL 17.11, database `crevia_restore_7d`, exit 0, 43 public schema objects, business counts all zero

`metadata.json` is the sibling blob and contains only non-secret operational
fields. The dump bytes match the recorded checksum. The sidecar file was
rewritten from those recorded fields on this machine.

## Azure result

Reused, unchanged except for the Crevia resources below:

- Resource group `Lumi-Solutions`
- Storage `lumisolutionsstorage` (account-wide public access was not changed)
- ACR `acrlumisolutions`
- Environment `cae-lumisolutions-prod`

Created:

- private containers `crevia-assets` and `crevia-backups` (public access none)
- image `acrlumisolutions.azurecr.io/lumicrevia:866ef4714e0c93d5915c41b26e014eed8e5efdaa`
- registry digest `sha256:22b90164758936c85018bcdcc020bd4f2441e4c59362b0ad07e0e4a33fac3642`
- Container App `ca-crevia-staging` in `cae-lumisolutions-prod`
- active revision `ca-crevia-staging--wave7d1`
- FQDN `ca-crevia-staging.ambitiousstone-8929079e.switzerlandnorth.azurecontainerapps.io`
- system-assigned managed identity, minReplicas 0, maxReplicas 1
- observed scale: `ScaledToZero`, replicas 0

Runtime uses `AzureBlobAssetStorage` and container `crevia-assets`. Staging does
not set `CREVIA_ASSET_STORAGE_PATH` and does not fall back to local disk.

Live acceptance on revision `ca-crevia-staging--wave7d1`:

- `GET /api/health` 200: process ok, database ok, assetStorage ok
- `GET /api/readiness` 200: `status=degraded`, `mode=infrastructure`, `proof.database=lumicrevia`, migration ready, identity and provisioning skipped
- `/` and `/app` 403 `infrastructure_mode`
- business writes 401 `no_session`; provision and Orbia callback 403 `infrastructure_mode`
- storage probe `_health/<random>` put, exists, get, delete; blob absent afterward; `crevia-assets` empty; Asset rows remain 0
- Neon business counts remain 0

## Identity

`Microsoft.Authorization/roleAssignments/write` returned AuthorizationFailed
once for Storage Blob Data Contributor on `crevia-assets` and once for AcrPull
on `acrlumisolutions`. Those assignments were not retried.

`MANAGED_IDENTITY_HARDENING = BLOCKED_OWNER_ACTION`

Temporary fallback, both expiring `2026-10-05T07:19:59Z`:

- container SAS on `crevia-assets` only, permissions `rcwd`, HTTPS only
- ACR token `crevia-staging-pull`, scope `lumicrevia` `content/read` and `metadata/read`

Owner actions still required before that expiry:

A. Assign **Storage Blob Data Contributor** to the system identity, scope **only**
   container `crevia-assets`.

B. Assign **AcrPull** to the same principal, scope `acrlumisolutions`.

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

7D Azure staging is accepted. Replace the temporary SAS and ACR pull token
with the Owner role assignments before 2026-10-05T07:19:59Z.
