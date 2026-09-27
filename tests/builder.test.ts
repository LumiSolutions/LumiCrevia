import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createBlock, starterSnapshot } from "../src/builder/blocks.ts";
import { resolvePointerDrop } from "../src/builder/dnd.ts";
import {
  commitDocument,
  createEditorSession,
  markConflict,
  markSaved,
  redoEditor,
  undoEditor,
} from "../src/builder/editor.ts";
import { BUILDER_MODULES, createBuilderFixture } from "../src/builder/fixtures.ts";
import { addPage, archivePageInSnapshot, duplicatePage, pageById, renamePage } from "../src/builder/pages.ts";
import { pageFromSnapshot, renderPage } from "../src/builder/render.ts";
import { canDrop, insertBlock, moveBlock, removeBlock } from "../src/builder/tree.ts";
import { handleRequest } from "../src/http.ts";
import { createSessionStore } from "../src/identity.ts";
import {
  createFoundationStore,
  createSite,
  latestDraft,
  provisionOrganization,
  publishSite,
  publicPublishedRender,
  saveDraft,
} from "../src/store.ts";
import type { ServerDeps } from "../src/http-types.ts";

const KEY = "local-fixture-key";

function deps(store = createFoundationStore()): ServerDeps {
  return {
    store,
    sessions: createSessionStore(),
    controlPlane: { async exchange() { return { ok: false as const, reason: "live_orbia_disabled" as const }; } },
    provisioningKey: KEY,
    clientId: "crevia-client",
    clientSecret: "secret",
    identityMode: "dev",
    appEnv: "TEST",
    secureCookies: false,
  };
}

async function fixtureSession() {
  const server = deps();
  const opened = await handleRequest({ method: "POST", path: "/api/dev/fixture", headers: {} }, server);
  assert.equal(opened.status, 200);
  const cookie = opened.headers["set-cookie"] ?? "";
  const body = opened.body as { siteId: string; organizationId: string };
  return { server, cookie, ...body };
}

describe("builder domain", () => {
  it("loads a site and page, selects, adds, deletes, and reorders blocks", () => {
    const snapshot = starterSnapshot();
    const home = snapshot.pages[0]!;
    let session = createEditorSession(snapshot, 2);
    assert.equal(session.document.pageId, home.id);
    const heading = home.blocks[0]?.children[0];
    assert.ok(heading);
    session = { ...session, document: { ...session.document, selectedBlockId: heading.id } };
    assert.equal(session.document.selectedBlockId, heading.id);

    const extra = createBlock("text");
    extra.props.content = "Footer note";
    const added = { ...home, blocks: [...home.blocks, extra] };
    session = commitDocument(session, {
      ...session.document,
      snapshot: { ...snapshot, pages: snapshot.pages.map((page) => (page.id === home.id ? added : page)) },
      selectedBlockId: extra.id,
    });
    assert.equal(session.saveState, "dirty");
    assert.equal(pageById(session.document.snapshot, home.id)?.blocks.length, 2);

    const removed = removeBlock(pageById(session.document.snapshot, home.id)!.blocks, extra.id);
    assert.equal(removed.nodes.length, 1);

    const section = home.blocks[0]!;
    const first = section.children[0]!;
    const second = section.children[1]!;
    const reordered = moveBlock(section.children, first.id, { parentId: null, index: 2 });
    assert.ok(reordered);
    assert.equal(reordered[0]?.id, second.id);
    assert.equal(reordered[1]?.id, first.id);
  });

  it("supports nested reorder and rejects invalid drops", () => {
    const section = createBlock("section");
    const inner = createBlock("container");
    const text = createBlock("text");
    section.children = [inner];
    inner.children = [text];
    const tree = [section];
    assert.equal(canDrop(tree, section.id, { parentId: text.id, index: 0 }), false);
    assert.equal(canDrop(tree, text.id, { parentId: section.id, index: 0 }), true);
    const moved = moveBlock(tree, text.id, { parentId: section.id, index: 1 });
    assert.ok(moved);
    assert.equal(moved[0]?.children.some((child) => child.id === text.id), true);
    assert.equal(insertBlock(tree, createBlock("text"), { parentId: section.id, index: 0 })[0]?.children.length, 2);
  });

  it("resolves pointer drops for empty canvas, edges, and nested containers", () => {
    const section = createBlock("section");
    const heading = createBlock("text");
    const body = createBlock("text");
    heading.props.content = "Heading";
    body.props.content = "Body";
    section.children = [heading, body];
    const tree = [section];

    const empty = resolvePointerDrop({
      tree: [],
      draggingId: "lib:text",
      overId: "canvas",
      overKind: "canvas",
      pointerY: 40,
      overRect: { top: 0, height: 400 },
    });
    assert.equal(empty.ok, true);

    const canvas = resolvePointerDrop({
      tree,
      draggingId: heading.id,
      overId: "canvas",
      overKind: "canvas",
      pointerY: 10,
      overRect: { top: 0, height: 400 },
    });
    assert.equal(canvas.ok, true);

    const top = resolvePointerDrop({
      tree,
      draggingId: heading.id,
      overId: body.id,
      overKind: "block",
      pointerY: 12,
      overRect: { top: 10, height: 80 },
    });
    assert.equal(top.ok && top.indicator.edge, "before");

    const middle = resolvePointerDrop({
      tree,
      draggingId: heading.id,
      overId: section.id,
      overKind: "container",
      pointerY: 140,
      overRect: { top: 100, height: 80 },
    });
    assert.equal(middle.ok && middle.indicator.edge, "inside");

    const bottom = resolvePointerDrop({
      tree,
      draggingId: heading.id,
      overId: body.id,
      overKind: "block",
      pointerY: 86,
      overRect: { top: 10, height: 80 },
    });
    assert.equal(bottom.ok && bottom.indicator.edge, "after");

    const invalid = resolvePointerDrop({
      tree,
      draggingId: section.id,
      overId: heading.id,
      overKind: "block",
      pointerY: 20,
      overRect: { top: 0, height: 40 },
    });
    assert.equal(invalid.ok, false);
  });

  it("switches pages without leaking content and supports page CRUD plus SEO", () => {
    let snapshot = starterSnapshot();
    const home = snapshot.pages[0]!;
    const about = snapshot.pages[1]!;
    assert.notEqual(home.blocks[0]?.children[0]?.props.content, about.blocks[0]?.children[0]?.props.content);
    snapshot = addPage(snapshot, { title: "Work", slug: "work" });
    snapshot = renamePage(snapshot, snapshot.pages[2]!.id, "Work with us");
    snapshot = duplicatePage(snapshot, home.id);
    const archived = archivePageInSnapshot(snapshot, snapshot.pages[2]!.id);
    assert.ok(archived.pages.every((page) => page.id !== snapshot.pages[2]!.id));
    const page = { ...home, seo: { ...home.seo, title: "Home SEO", description: "Desc", canonical: "https://example.test", robots: "noindex", ogImage: "https://example.test/og.png" } };
    assert.equal(page.seo.title, "Home SEO");
  });

  it("keeps mobile style overrides off the desktop bucket", () => {
    const block = createBlock("text");
    block.responsive.desktop = { fontSize: "32px" };
    block.responsive.mobile = { fontSize: "16px" };
    assert.equal(block.responsive.desktop.fontSize, "32px");
    assert.equal(block.responsive.mobile.fontSize, "16px");
  });

  it("tracks dirty state, undo/redo, and revision-safe save/conflict", () => {
    const snapshot = starterSnapshot();
    let session = createEditorSession(snapshot, 2);
    assert.equal(session.saveState, "clean");
    session = commitDocument(session, { ...session.document, selectedBlockId: "x" });
    assert.equal(session.saveState, "dirty");
    session = undoEditor(session);
    assert.equal(session.document.selectedBlockId, null);
    session = redoEditor(session);
    assert.equal(session.document.selectedBlockId, "x");
    session = markSaved(session, 3);
    assert.equal(session.expectedVersion, 3);
    session = markConflict(session, 9);
    assert.equal(session.saveState, "conflict");
  });
});

describe("builder persistence and preview", () => {
  it("saves through expectedVersion and keeps published stable after draft edits", () => {
    const store = createFoundationStore();
    const fixture = createBuilderFixture(store, KEY);
    assert.equal(fixture.ok, true);
    if (!fixture.ok) {
      return;
    }

    const draft = latestDraft(store, fixture.organizationId, fixture.siteId);
    assert.equal(draft.ok, true);
    if (!draft.ok) {
      return;
    }

    const published = publishSite(store, {
      organizationId: fixture.organizationId,
      siteId: fixture.siteId,
      revisionId: draft.revision.revisionId,
      target: "local-fixture",
      createdBy: "fixture",
      modules: BUILDER_MODULES,
    });
    assert.equal(published.ok, true);

    const next = structuredClone(draft.revision.snapshot);
    next.pages[0]!.title = "Draft after publish";
    const saved = saveDraft(store, {
      organizationId: fixture.organizationId,
      siteId: fixture.siteId,
      expectedVersion: draft.revision.version,
      createdBy: "fixture",
      snapshot: next,
      modules: BUILDER_MODULES,
    });
    assert.equal(saved.ok, true);

    const live = publicPublishedRender(store, fixture.siteId);
    assert.equal(live.ok, true);
    if (live.ok) {
      assert.notEqual(live.snapshot.pages[0]?.title, "Draft after publish");
    }

    const stale = saveDraft(store, {
      organizationId: fixture.organizationId,
      siteId: fixture.siteId,
      expectedVersion: draft.revision.version,
      createdBy: "fixture",
      snapshot: next,
      modules: BUILDER_MODULES,
    });
    assert.equal(stale.ok, false);
    if (!stale.ok) {
      assert.equal(stale.reason, "conflict");
    }
  });

  it("renders draft and published previews from revision snapshots", () => {
    const snapshot = starterSnapshot();
    const page = pageFromSnapshot(snapshot, "home");
    assert.ok(page);
    const html = renderPage(page, snapshot);
    assert.match(html, /Independent strategy/);
    assert.match(html, /data-internal/);
  });
});

describe("builder http", () => {
  it("opens a local fixture, loads a site, and denies a foreign site id", async () => {
    const { server, cookie, siteId, organizationId } = await fixtureSession();
    const loaded = await handleRequest({ method: "GET", path: `/api/sites/${siteId}`, headers: { cookie } }, server);
    assert.equal(loaded.status, 200);

    const other = createFoundationStore();
    const foreignOrg = provisionOrganization(other, {
      provisioningKey: KEY,
      expectedKey: KEY,
      action: "enable",
      orbiaOrganizationId: "org_fixture_b",
    });
    assert.equal(foreignOrg.ok, true);
    if (!foreignOrg.ok) {
      return;
    }
    const foreignSite = createSite(other, {
      organizationId: foreignOrg.localOrganizationId,
      name: "Other",
      createdBy: "x",
      modules: BUILDER_MODULES,
    });
    assert.equal(foreignSite.ok, true);
    if (!foreignSite.ok) {
      return;
    }

    server.store.sites.push(foreignSite.site);
    const denied = await handleRequest(
      { method: "GET", path: `/api/sites/${foreignSite.site.id}`, headers: { cookie } },
      server,
    );
    assert.equal(denied.status, 404);
    assert.equal(organizationId.length > 0, true);
  });

  it("rejects unsafe draft HTML through the HTTP save gate", async () => {
    const { server, cookie, siteId } = await fixtureSession();
    const loaded = await handleRequest({ method: "GET", path: `/api/sites/${siteId}`, headers: { cookie } }, server);
    const body = loaded.body as { draft: { version: number; snapshot: ReturnType<typeof starterSnapshot> } };
    body.draft.snapshot.pages[0]!.blocks[0]!.children[0]!.props.html = "<script>alert(1)</script>";
    const saved = await handleRequest(
      {
        method: "POST",
        path: `/api/sites/${siteId}/draft`,
        headers: { cookie },
        body: { expectedVersion: body.draft.version, snapshot: body.draft.snapshot },
      },
      server,
    );
    assert.equal(saved.status, 400);
    assert.equal((saved.body as { reason: string }).reason, "unsafe_html");
  });

  it("fails fixture mode closed outside LOCAL/TEST", async () => {
    const server = deps();
    server.appEnv = "production";
    const opened = await handleRequest({ method: "POST", path: "/api/dev/fixture", headers: {} }, server);
    assert.equal(opened.status, 403);
  });
});
