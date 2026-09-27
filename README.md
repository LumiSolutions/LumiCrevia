# LumiCrevia

Local website-builder and publication foundation for the LumiSolutions platform.

The Wave 7A foundation plus a local visual editor. There is still no database, cloud publish target, or Orbia call. See `docs/crevia-product-contract.md`, `docs/crevia-builder.md`, and `docs/crevia-dripforge-migration.md`.

```bash
CREVIA_APP_ENV=LOCAL CREVIA_PROVISIONING_KEY=local-fixture-key npm start
npm test
npm run typecheck
npm run lint
npm run build
```

Local fixture UI: `POST /api/dev/fixture`, then `/app`.
