# Crevia visual builder

Wave 7B adds a local visual editor on the Wave 7A foundation. Wave 7C keeps that editor and routes every save through `inspectSnapshot` and `saveDraft(expectedVersion)` into PostgreSQL. The editor does not own a second document store and does not import Prisma.

## Editor architecture

```
React builder (web/)
  -> editor session (dirty / undo)
  -> POST /api/sites/:id/draft
  -> inspectSnapshot
  -> saveDraft(expectedVersion)
  -> SiteRevision
```

The canvas renders the foundation `BlockNode` tree from the current draft snapshot. Block types are `section`, `text`, `media`, `navigation`, plus optional `button` and `container`.

## Block tree

A page snapshot holds nested blocks:

- `id`, `type`, `version`
- `props`, `styles`, `responsive`, `children`, `metadata`

Responsive values live on the same block (`desktop` / `tablet` / `mobile`). There is no page copy per breakpoint.

## Drag and drop

`@dnd-kit` pointer sensors move existing blocks and place library items. Collision uses `pointerWithin` against full canvas and container rectangles. `src/builder/dnd.ts` maps pointer Y to `before` / `inside` / `after`. Invalid drops (into self or descendants) are rejected; the tree does not change.

After a successful drop the moved block stays selected and the session is dirty.

## Pages

Page content, SEO, navigation visibility, and sort order live in `SiteRevision.snapshot.pages`. The page index is synced from that snapshot on each successful save. Archive is a soft delete. Duplicate copies blocks with new ids.

## Revisions and save

The editor tracks `clean | dirty | saving | saved | conflict | error`. Save sends the current snapshot and `expectedVersion`. A newer draft version returns `409 conflict`. The UI offers reload latest, keep local copy, and compare later. There is no force-save.

Autosave is debounced (1.6s), skipped while a save is in flight, and skipped in the conflict state.

## Preview and publication

Draft preview uses a preview token for the latest draft revision. Published preview uses `publishedRevisionId`. Public render at `/p/:siteId/:slug` reads only the published snapshot.

`publishSite` writes a local fixture publication immediately. Later draft edits do not change the public render.

## Undo / redo

Undo is a client history of editor documents, capped at 50 entries. It is not the server revision list.

## Fixture mode

`POST /api/dev/fixture` exists only for `LOCAL` and `TEST`. It provisions fixture org A, one studio site, and a session cookie. Production-like environments reject it.
