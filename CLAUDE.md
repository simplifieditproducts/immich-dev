# CLAUDE.md

## What this repo is

Private fork of [Immich](https://github.com/immich-app/immich) with custom patches.

Standard Immich monorepo layout: `server/` (NestJS API + job workers), `web/`
(SvelteKit), `mobile/` (Flutter), `machine-learning/`, `e2e/`.

`mobile/` and `e2e/` modules are not used, so leave them alone.

## Testing

The `server/` unit tests have NOT been updated for our customizations (e.g. the
repositories we added to the `BaseService` constructor broke the mock wiring in
`server/test/utils.ts`), so most of them fail for reasons unrelated to any
change under review. Do not run or rely on the unit tests for now. Verify
changes with `npx tsc --noEmit` and `npx eslint` on the touched files instead.

## Related repos

- `../immich-devops` — private sibling repo tracking the devops side of this
  app's production deployment: deployment guides and runbooks (`docs/`),
  incident reports (`incidents/`), maintenance scripts (`scripts/`), and
  planning docs (`plans/`). Look there first for anything about the production
  server, database operations, backups, or monitoring.
