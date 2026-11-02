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

## Merging upstream

Production has about 40M search and face vectors, and many users' vectors are
archived to files (`../immich-devops/scripts/vector-archive.py`). A change that
recomputes them all takes many hours, so check each upstream merge for:

- **The default models**: `clip.modelName` and `facialRecognition.modelName` in
  `server/src/config.ts`. Immich saves only settings that differ from the
  defaults, so a new upstream default switches the model on every server that
  never changed it, with no setting changed: no guard refuses it, and new photos
  get vectors that don't match the old ones (`vector-archive.py restore` reads
  the image's defaults and leaves the old-model part out, but everyone else's
  vectors stay mixed). Both lines carry a `// fork: pinned` comment so such a
  change conflicts; keep our value when resolving it. The default can't be
  pinned in the settings instead, since a value equal to the default isn't
  saved.
- **Migrations that touch `smart_search`, `face_search`, `clip_index` or
  `face_index`**: nothing checks migrations, and they run on every server.
- **Migrations dated before ours** (`1793048400000`, `1793580000000`):
  production refuses unordered migrations, so the server wouldn't start. Rename
  them to a later date.

More in `../immich-devops/docs/vector-index-capacity.md` ("What the fork turns
off").

## Related repos

- `../immich-devops` — private sibling repo tracking the devops side of this
  app's production deployment: deployment guides and runbooks (`docs/`),
  incident reports (`incidents/`), maintenance scripts (`scripts/`), and
  planning docs (`plans/`). Look there first for anything about the production
  server, database operations, backups, or monitoring.
