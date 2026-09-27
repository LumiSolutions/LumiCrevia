# LumiCrevia

Local website-builder and publication service for the LumiSolutions platform.

Wave 7C adds durable PostgreSQL persistence and local asset storage. There is still no cloud publish target and no Orbia live call. See `docs/crevia-product-contract.md`, `docs/crevia-builder.md`, `docs/crevia-persistence.md`, and `docs/crevia-dripforge-migration.md`.

```bash
export DATABASE_URL=postgresql://crevia:crevia_local_only@127.0.0.1:5432/crevia_local
export CREVIA_ASSET_STORAGE_PATH=$PWD/var/crevia-assets
export CREVIA_APP_ENV=LOCAL
export CREVIA_IDENTITY_MODE=dev
export CREVIA_PROVISIONING_KEY=local-fixture-key

npx prisma migrate deploy
npm start
npm test
npm run typecheck
npm run lint
npm run build
npx prisma validate
npx prisma migrate status
```

Local fixture UI: `POST /api/dev/fixture`, then `/app`.
