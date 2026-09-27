# Crevia durable persistence

Wave 7C moves LumiCrevia from process-local memory to organization-scoped PostgreSQL persistence and local asset bytes. This wave is local only. It does not create Neon, Azure, Container Apps, Orbia live assignments, or tenants.

## Decision

The in-memory `FoundationStore` stays as the unit-test adapter (option A). Foundation and builder domain tests keep using it.

Normal local runtime and persistence tests use PostgreSQL through `FoundationRepository`. The HTTP layer and builder UI never import Prisma.

```
Domain services
  -> FoundationRepository
      -> Memory adapter (unit tests)
      -> PostgreSQL adapter (local run + integration tests)
Builder UI
  -> HTTP
      -> repository
```

## Local start

PostgreSQL 16 is the isolated local engine in this environment (17 was not available without Docker). Create the role and database once, then:

```bash
export DATABASE_URL=postgresql://crevia:crevia_local_only@127.0.0.1:5432/crevia_local
export DIRECT_DATABASE_URL=$DATABASE_URL
export CREVIA_ASSET_STORAGE_PATH=$PWD/var/crevia-assets
export CREVIA_IDENTITY_MODE=dev
export CREVIA_APP_ENV=LOCAL
export CREVIA_PROVISIONING_KEY=local-fixture-key

npx prisma migrate deploy
npm start
```

`DIRECT_DATABASE_URL` is optional and only needed later if a pooled URL is introduced. Do not commit secrets. The local password above is a fixture value for this machine only.

## Environment

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection for Prisma |
| `DIRECT_DATABASE_URL` | Optional direct/non-pooled alias |
| `CREVIA_ASSET_STORAGE_PATH` | Root for `LocalFilesystemAssetStorage` |
| `CREVIA_IDENTITY_MODE` | `dev` locally, `orbia` required outside LOCAL/TEST |
| `CREVIA_APP_ENV` | `LOCAL` / `TEST` / staging / production |
| `CREVIA_PROVISIONING_KEY` | Internal provision header |

Default local asset path is `$PWD/var/crevia-assets`. It is not `/tmp` and not the source tree. `var/` is gitignored.

## Migrations

Use `prisma migrate deploy`. Do not use `db push` as a production strategy. A fresh database applies `prisma/migrations/20260927190000_init`.

```bash
npx prisma validate
npx prisma migrate deploy
npx prisma migrate status
```

## Optimistic concurrency

`saveDraft(expectedVersion)` issues an atomic `UPDATE ... WHERE draftVersion = expectedVersion`. The revision insert and page-index sync run in the same transaction. Two parallel saves of the same version produce one success and one `409 conflict`.

Publish writes the published revision, the publication row, and `site.publishedRevisionId` in one transaction.

## Asset write consistency

Crevia uploads:

1. Validate size, mime, and filename. SVG and executables are rejected.
2. Write bytes through `LocalFilesystemAssetStorage` (temp file, then rename).
3. Insert metadata in a database transaction.
4. If the database write fails after the file write, delete the file.

This is not two-phase commit. Compensating cleanup covers the file-without-metadata case. If a process dies after a successful metadata commit and before a later delete, the file remains the durable bytes.

Storage keys are generated as `organizations/{orgId}/sites/{siteId}/assets/{assetId}/{sanitizedFilename}`. They are not a public URL contract. `../`, absolute paths, and foreign organization prefixes are rejected.

External Syntara, commerce, and platform assets store `sourceSystem` + `externalAssetId` only. Bytes are not copied.

`AzureBlobAssetStorage` is intentionally not implemented in this wave.

## Failure isolation

- Database down: `/api/health` reports `database=down` without the connection string. `/api/readiness` is `not_ready`.
- Asset path not writable: `assetStorage` / storage checks are missing. Builder reads that do not need assets can still succeed when the database is up.

Publishing stays `degraded` because the publisher is the local fixture, not a cloud target.

## Backup

Local `pg_dump` / `pg_restore` is covered by `tests/backup.test.ts`. There is no cloud backup wave in 7C.
