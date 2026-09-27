import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CREVIA_APP_KEY,
  MODULE_DESCRIPTORS,
  type CreviaModuleKey,
} from "../src/contract.ts";
import { handleRequest } from "../src/http.ts";
import {
  authenticateProductRequest,
  authorizeSensitiveWrite,
  completeCallback,
  createMemoryControlPlane,
  createOrbiaExchangeClient,
  createSessionStore,
  identityLookupKey,
  resolveDevActor,
  type ExchangeGrant,
} from "../src/identity.ts";
import { createMemoryServerDeps } from "../src/deps.ts";
import { evaluateReadiness, healthReport } from "../src/readiness.ts";
import { serverDepsFromEnv } from "../src/server.ts";
import {
  archiveAsset,
  archivePage,
  archiveSite,
  createFoundationStore,
  createPage,
  createSite,
  issuePreviewToken,
  organizationSeedCounts,
  provisionOrganization,
  publicPublishedRender,
  publishSite,
  readAsset,
  readPreview,
  readSite,
  readTheme,
  saveAsset,
  saveDomain,
  saveDraft,
  updateTheme,
  publishedOutput,
  importTemplate,
} from "../src/store.ts";
import { emptySnapshot, type BlockNode, type SiteSnapshot } from "../src/validation.ts";

const CLIENT_ID = "crevia-client";
const CLIENT_SECRET = "crevia-identity-secret";
const PROVISIONING_KEY = "crevia-provisioning-key";

const modules = MODULE_DESCRIPTORS.filter((module) => module.serverGate).map(
  (module) => module.key,
) as CreviaModuleKey[];

function grant(overrides: Partial<ExchangeGrant> = {}): ExchangeGrant {
  return {
    orbiaUserId: "user_fixture",
    orbiaOrganizationId: "org_fixture_a",
    membershipRole: "admin",
    modules,
    organizationStatus: "active",
    membershipStatus: "active",
    appEnabled: true,
    evaluatedAt: "2026-09-27T00:00:00.000Z",
    ...overrides,
  };
}

function block(overrides: Partial<BlockNode> = {}): BlockNode {
  return {
    id: "block_1",
    type: "text",
    version: 1,
    props: { html: "Hallo" },
    styles: {},
    responsive: {
      desktop: { fontSize: "32px" },
      tablet: { fontSize: "24px" },
      mobile: { fontSize: "18px" },
    },
    children: [],
    metadata: {},
    ...overrides,
  };
}

function snapshot(pages: SiteSnapshot["pages"] = []): SiteSnapshot {
  return {
    ...emptySnapshot(),
    pages,
  };
}

function enable(store: ReturnType<typeof createFoundationStore>, orbiaOrganizationId: string) {
  const result = provisionOrganization(store, {
    provisioningKey: PROVISIONING_KEY,
    expectedKey: PROVISIONING_KEY,
    action: "enable",
    orbiaOrganizationId,
    displayName: orbiaOrganizationId,
  });
  assert.equal(result.ok, true);
  if (!result.ok) {
    throw new Error("provision failed");
  }
  return result.localOrganizationId;
}

describe("provisioning", () => {
  it("enables one empty product organization and does not seed a website", () => {
    const store = createFoundationStore();
    const first = provisionOrganization(store, {
      provisioningKey: PROVISIONING_KEY,
      expectedKey: PROVISIONING_KEY,
      action: "enable",
      orbiaOrganizationId: "org_fixture_a",
      displayName: "Fixture A",
    });
    const second = provisionOrganization(store, {
      provisioningKey: PROVISIONING_KEY,
      expectedKey: PROVISIONING_KEY,
      action: "enable",
      orbiaOrganizationId: "org_fixture_a",
    });

    assert.equal(first.ok && second.ok, true);
    if (!first.ok || !second.ok) {
      return;
    }

    assert.equal(second.localOrganizationId, first.localOrganizationId);
    assert.equal(second.reused, true);
    assert.equal(second.seeded, false);
    assert.equal(second.sites, 0);
    assert.equal(store.organizations.length, 1);
    assert.equal(store.sites.length, 0);
    assert.deepEqual(organizationSeedCounts(store.organizations[0]!), {
      sites: 0,
      pages: 0,
      assets: 0,
      themes: 0,
      users: 0,
    });
    assert.equal(
      store.organizations.some((row) => row.orbiaOrganizationId === "serva-staging"),
      false,
    );
  });

  it("keeps sites on disable and re-enables the same organization", () => {
    const store = createFoundationStore();
    const organizationId = enable(store, "org_fixture_a");
    const site = createSite(store, {
      organizationId,
      name: "Fixture site",
      createdBy: "user_fixture",
      modules,
    });
    assert.equal(site.ok, true);

    const disabled = provisionOrganization(store, {
      provisioningKey: PROVISIONING_KEY,
      expectedKey: PROVISIONING_KEY,
      action: "disable",
      orbiaOrganizationId: "org_fixture_a",
    });
    assert.equal(disabled.ok, true);
    if (site.ok) {
      assert.equal(createPage(store, {
        organizationId,
        siteId: site.site.id,
        title: "Home",
        slug: "home",
        sortOrder: 0,
        navigationVisible: true,
        modules,
      }).ok, false);
    }

    const reenabled = provisionOrganization(store, {
      provisioningKey: PROVISIONING_KEY,
      expectedKey: PROVISIONING_KEY,
      action: "re-enable",
      orbiaOrganizationId: "org_fixture_a",
    });
    assert.equal(reenabled.ok, true);
    if (!reenabled.ok) {
      return;
    }
    assert.equal(reenabled.localOrganizationId, organizationId);
    assert.equal(reenabled.seeded, false);
    assert.equal(store.sites.length, 1);
  });

  it("rejects a bad provisioning key", () => {
    const store = createFoundationStore();
    const result = provisionOrganization(store, {
      provisioningKey: "wrong",
      expectedKey: PROVISIONING_KEY,
      action: "enable",
      orbiaOrganizationId: "org_fixture_a",
    });
    assert.deepEqual(result, { ok: false, reason: "provisioning_key_rejected" });
    assert.equal(store.organizations.length, 0);
  });
});

describe("sites, revisions, and publication", () => {
  it("keeps a published revision while the draft moves forward", () => {
    const store = createFoundationStore();
    const organizationId = enable(store, "org_fixture_a");
    const created = createSite(store, {
      organizationId,
      name: "Site A",
      createdBy: "user_a",
      modules,
    });
    assert.equal(created.ok, true);
    if (!created.ok) {
      return;
    }

    let version = created.site.draftVersion;
    let revisionId = created.revision.revisionId;

    for (let next = 2; next <= 5; next += 1) {
      const saved = saveDraft(store, {
        organizationId,
        siteId: created.site.id,
        expectedVersion: version,
        createdBy: "user_a",
        modules,
        snapshot: snapshot([
          {
            id: "page_home",
            slug: "home",
            title: `Home ${next}`,
            sortOrder: 0,
            navigationVisible: true,
            homepage: true,
            seo: {
              title: "Home",
              description: "Fixture",
              canonical: "https://example.test/home",
              robots: "index",
              ogImage: "",
            },
            blocks: [block({ props: { html: `Version ${next}` } })],
          },
        ]),
      });
      assert.equal(saved.ok, true);
      if (!saved.ok) {
        return;
      }
      version = saved.revision.version;
      revisionId = saved.revision.revisionId;
      assert.equal(saved.publishedRevisionId, null);
    }

    assert.equal(version, 5);
    const publicationsBefore = store.publications.length;
    const conflict = saveDraft(store, {
      organizationId,
      siteId: created.site.id,
      expectedVersion: 5,
      createdBy: "user_b",
      modules,
      snapshot: snapshot(),
    });
    assert.equal(conflict.ok, true);
    const stale = saveDraft(store, {
      organizationId,
      siteId: created.site.id,
      expectedVersion: 5,
      createdBy: "user_b",
      modules,
      snapshot: snapshot(),
    });
    assert.equal(stale.ok, false);
    if (stale.ok) {
      return;
    }
    assert.equal(stale.reason, "conflict");
    assert.equal(store.publications.length, publicationsBefore);

    const published = publishSite(store, {
      organizationId,
      siteId: created.site.id,
      revisionId,
      target: "local-fixture",
      createdBy: "user_a",
      modules,
    });
    assert.equal(published.ok, true);

    const edited = saveDraft(store, {
      organizationId,
      siteId: created.site.id,
      expectedVersion: 6,
      createdBy: "user_a",
      modules,
      snapshot: snapshot([
        {
          id: "page_home",
          slug: "home",
          title: "Draft 7",
          sortOrder: 0,
          navigationVisible: true,
          homepage: true,
          seo: {
            title: "Draft",
            description: "Still draft",
            canonical: "",
            robots: "noindex",
            ogImage: "",
          },
          blocks: [block({ props: { html: "Draft only" } })],
        },
      ]),
    });
    assert.equal(edited.ok, true);
    if (!edited.ok) {
      return;
    }
    assert.equal(edited.revision.version, 7);
    assert.equal(edited.revision.status, "DRAFT");

    const live = publishedOutput(store, organizationId, created.site.id);
    assert.equal(live.ok, true);
    if (!live.ok) {
      return;
    }
    assert.equal(live.revision.revisionId, revisionId);
    assert.equal(live.revision.version, 5);
    assert.equal(live.revision.status, "PUBLISHED");
    assert.equal(live.revision.snapshot.pages[0]?.title, "Home 5");

    const publicRender = publicPublishedRender(store, created.site.id);
    assert.equal(publicRender.ok, true);
    if (publicRender.ok) {
      assert.equal(publicRender.version, 5);
      assert.equal(JSON.stringify(publicRender.snapshot).includes("Draft only"), false);
    }
  });

  it("rejects unsafe content and unknown block versions", () => {
    const store = createFoundationStore();
    const organizationId = enable(store, "org_fixture_a");
    const created = createSite(store, {
      organizationId,
      name: "Site A",
      createdBy: "user_a",
      modules,
    });
    assert.equal(created.ok, true);
    if (!created.ok) {
      return;
    }

    const script = saveDraft(store, {
      organizationId,
      siteId: created.site.id,
      expectedVersion: 1,
      createdBy: "user_a",
      modules,
      snapshot: snapshot([
        {
          id: "page_home",
          slug: "home",
          title: "Home",
          sortOrder: 0,
          navigationVisible: true,
          homepage: true,
          seo: { title: "", description: "", canonical: "", robots: "", ogImage: "" },
          blocks: [block({ props: { html: "<script>alert(1)</script>" } })],
        },
      ]),
    });
    assert.deepEqual(script.ok ? null : script.reason, "unsafe_html");

    const link = saveDraft(store, {
      organizationId,
      siteId: created.site.id,
      expectedVersion: 1,
      createdBy: "user_a",
      modules,
      snapshot: snapshot([
        {
          id: "page_home",
          slug: "home",
          title: "Home",
          sortOrder: 0,
          navigationVisible: true,
          homepage: true,
          seo: { title: "", description: "", canonical: "", robots: "", ogImage: "" },
          blocks: [block({ props: { href: "javascript:alert(1)" } })],
        },
      ]),
    });
    assert.deepEqual(link.ok ? null : link.reason, "unsafe_url");

    const dataUrl = saveDraft(store, {
      organizationId,
      siteId: created.site.id,
      expectedVersion: 1,
      createdBy: "user_a",
      modules,
      snapshot: snapshot([
        {
          id: "page_home",
          slug: "home",
          title: "Home",
          sortOrder: 0,
          navigationVisible: true,
          homepage: true,
          seo: { title: "", description: "", canonical: "", robots: "", ogImage: "" },
          blocks: [block({ props: { src: "data:text/html,hi" } })],
        },
      ]),
    });
    assert.deepEqual(dataUrl.ok ? null : dataUrl.reason, "unsafe_url");

    const customJs = saveDraft(store, {
      organizationId,
      siteId: created.site.id,
      expectedVersion: 1,
      createdBy: "user_a",
      modules,
      snapshot: snapshot([
        {
          id: "page_home",
          slug: "home",
          title: "Home",
          sortOrder: 0,
          navigationVisible: true,
          homepage: true,
          seo: { title: "", description: "", canonical: "", robots: "", ogImage: "" },
          blocks: [block({ props: { customJs: "alert(1)" } })],
        },
      ]),
    });
    assert.deepEqual(customJs.ok ? null : customJs.reason, "custom_js_rejected");

    const unknown = saveDraft(store, {
      organizationId,
      siteId: created.site.id,
      expectedVersion: 1,
      createdBy: "user_a",
      modules,
      snapshot: snapshot([
        {
          id: "page_home",
          slug: "home",
          title: "Home",
          sortOrder: 0,
          navigationVisible: true,
          homepage: true,
          seo: { title: "", description: "", canonical: "", robots: "", ogImage: "" },
          blocks: [block({ version: 9 })],
        },
      ]),
    });
    assert.deepEqual(unknown.ok ? null : unknown.reason, "migration_required");
    assert.equal(importTemplate({ snapshot: emptySnapshot(), customJs: "alert(1)" }).ok, false);
  });

  it("archives a site without dropping revisions and hides other organizations", () => {
    const store = createFoundationStore();
    const orgA = enable(store, "org_fixture_a");
    const orgB = enable(store, "org_fixture_b");
    const siteA = createSite(store, { organizationId: orgA, name: "A", createdBy: "a", modules });
    const siteB = createSite(store, { organizationId: orgB, name: "B", createdBy: "b", modules });
    assert.equal(siteA.ok && siteB.ok, true);
    if (!siteA.ok || !siteB.ok) {
      return;
    }

    const page = createPage(store, {
      organizationId: orgA,
      siteId: siteA.site.id,
      title: "Home",
      slug: "home",
      sortOrder: 0,
      navigationVisible: true,
      homepage: true,
      modules,
    });
    assert.equal(page.ok, true);
    const asset = saveAsset(store, {
      organizationId: orgA,
      siteId: siteA.site.id,
      classification: "SYNTARA_MARKETING_ASSET_REFERENCE",
      sourceSystem: "syntara",
      externalAssetId: "asset_ext_1",
      displayName: "Campaign still",
      modules,
    });
    assert.equal(asset.ok, true);
    const theme = updateTheme(store, {
      organizationId: orgA,
      siteId: siteA.site.id,
      modules,
      tokens: {
        ...emptySnapshot().theme,
        colors: { background: "#fff" },
        platformBrandingRef: { sourceSystem: "orbia", externalId: "brand_1" },
      },
    });
    assert.equal(theme.ok, true);

    assert.equal(readSite(store, orgB, siteA.site.id).ok, false);
    assert.equal(page.ok && archivePage(store, orgB, page.page.id).ok, false);
    if (asset.ok) {
      assert.equal(readAsset(store, orgB, asset.asset.id).ok, false);
      assert.equal(archiveAsset(store, orgB, asset.asset.id, modules).ok, false);
    }
    assert.equal(readTheme(store, orgB, siteA.site.id).ok, false);
    assert.equal(
      updateTheme(store, {
        organizationId: orgB,
        siteId: siteA.site.id,
        modules,
        tokens: emptySnapshot().theme,
      }).ok,
      false,
    );
    assert.equal(
      publishSite(store, {
        organizationId: orgB,
        siteId: siteA.site.id,
        revisionId: siteA.revision.revisionId,
        target: "local-fixture",
        createdBy: "b",
        modules,
      }).ok,
      false,
    );
    const preview = issuePreviewToken(store, {
      organizationId: orgA,
      siteId: siteA.site.id,
      revisionId: siteA.revision.revisionId,
      kind: "draft",
    });
    assert.equal(preview.ok, true);
    if (preview.ok) {
      assert.equal(readPreview(store, { token: preview.token, organizationId: orgB }).ok, false);
      assert.equal(readPreview(store, { token: preview.token, organizationId: orgA }).ok, true);
    }

    const domain = saveDomain(store, {
      organizationId: orgA,
      siteId: siteA.site.id,
      hostname: "fixture.example",
      modules,
    });
    assert.equal(domain.ok, true);
    if (domain.ok) {
      assert.equal(domain.dnsMutated, false);
    }

    const archived = archiveSite(store, orgA, siteA.site.id, modules);
    assert.equal(archived.ok, true);
    if (archived.ok) {
      assert.ok(archived.revisionsKept >= 1);
    }
    assert.equal(readSite(store, orgA, siteA.site.id).ok, false);
    assert.equal(store.revisions.some((row) => row.siteId === siteA.site.id), true);
    assert.equal(saveDraft(store, {
      organizationId: orgA,
      siteId: siteA.site.id,
      expectedVersion: 1,
      createdBy: "a",
      modules: modules.filter((key) => key !== "crevia.builder"),
      snapshot: snapshot(),
    }).ok, false);
  });
});

describe("identity", () => {
  it("exchanges a code once and rejects replay, expiry, and mismatches", async () => {
    const now = { value: 1_000 };
    const plane = createMemoryControlPlane({
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      now: () => now.value,
    });
    const sessions = createSessionStore();
    const code = plane.issue(grant());
    const opened = await completeCallback({
      code,
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      controlPlane: plane,
      sessions,
      creviaOrganizationId: "corg_a",
      secure: true,
    });

    assert.equal(opened.ok, true);
    if (!opened.ok) {
      return;
    }
    assert.match(opened.cookie, /crevia_session=/);
    assert.match(opened.cookie, /HttpOnly/);
    assert.match(opened.cookie, /SameSite=Lax/);
    assert.match(opened.cookie, /Secure/);
    assert.equal(JSON.stringify(await sessions.values()).includes(opened.token), false);
    assert.deepEqual(opened.context, {
      orbiaUserId: "user_fixture",
      orbiaOrganizationId: "org_fixture_a",
      creviaOrganizationId: "corg_a",
      membershipRole: "admin",
      capabilities: opened.context.capabilities,
      modules,
      evaluatedAt: "2026-09-27T00:00:00.000Z",
    });

    assert.deepEqual(
      await plane.exchange({
        code,
        appKey: CREVIA_APP_KEY,
        clientId: CLIENT_ID,
        clientSecret: CLIENT_SECRET,
      }),
      { ok: false, reason: "replay" },
    );
    assert.deepEqual(
      await plane.exchange({
        code: plane.issue(grant(), { appKey: "navio" }),
        appKey: CREVIA_APP_KEY,
        clientId: CLIENT_ID,
        clientSecret: CLIENT_SECRET,
      }),
      { ok: false, reason: "wrong_app" },
    );
    assert.deepEqual(
      await plane.exchange({
        code: plane.issue(grant()),
        appKey: CREVIA_APP_KEY,
        clientId: "other-client",
        clientSecret: CLIENT_SECRET,
      }),
      { ok: false, reason: "wrong_client" },
    );
    assert.deepEqual(
      await plane.exchange({
        code: plane.issue(grant(), { ttlMs: -1 }),
        appKey: CREVIA_APP_KEY,
        clientId: CLIENT_ID,
        clientSecret: CLIENT_SECRET,
      }),
      { ok: false, reason: "expired" },
    );
  });

  it("consumes one code when two exchanges run together", async () => {
    const plane = createMemoryControlPlane({
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
    });
    const code = plane.issue(grant());
    const results = await Promise.all([
      plane.exchange({ code, appKey: CREVIA_APP_KEY, clientId: CLIENT_ID, clientSecret: CLIENT_SECRET }),
      plane.exchange({ code, appKey: CREVIA_APP_KEY, clientId: CLIENT_ID, clientSecret: CLIENT_SECRET }),
    ]);
    assert.equal(results.filter((result) => result.ok).length, 1);
    assert.equal(results.filter((result) => !result.ok && result.reason === "replay").length, 1);
  });

  it("does not fall back to a password, email, or a dev organization", async () => {
    const plane = createMemoryControlPlane({
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
    });
    const sessions = createSessionStore();
    const refused = await completeCallback({
      code: plane.issue(grant()),
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      controlPlane: plane,
      sessions,
      creviaOrganizationId: "corg_a",
      password: "second-password",
    });
    assert.deepEqual(refused, { ok: false, reason: "password_fallback_forbidden" });
    assert.equal((await sessions.values()).length, 0);
    assert.deepEqual(identityLookupKey({ orbiaUserId: "user_1", email: "person@example.test" }), {
      orbiaUserId: "user_1",
    });
    assert.deepEqual(resolveDevActor("production"), { ok: false, reason: "dev_actor_forbidden" });
    assert.equal(resolveDevActor("TEST").ok, true);
    if (resolveDevActor("TEST").ok) {
      assert.equal("orbiaOrganizationId" in resolveDevActor("TEST"), false);
    }
    assert.deepEqual(await createOrbiaExchangeClient().exchange({
      code: "code",
      appKey: CREVIA_APP_KEY,
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
    }), { ok: false, reason: "live_orbia_disabled" });

    const opened = await completeCallback({
      code: plane.issue(grant()),
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      controlPlane: plane,
      sessions,
      creviaOrganizationId: "corg_a",
      secure: true,
    });
    assert.equal(opened.ok, true);
    if (!opened.ok) {
      return;
    }
    const foreign = await authenticateProductRequest({
      cookieHeader: `orbia_session=${opened.token}`,
      mode: "orbia",
      sessions,
    });
    assert.deepEqual(foreign, { ok: false, reason: "orbia_cookie_rejected" });
  });

  it("requires fresh introspection for publish and denies a disabled module", () => {
    const context = {
      orbiaUserId: "user_fixture",
      orbiaOrganizationId: "org_fixture_a",
      creviaOrganizationId: "corg_a",
      membershipRole: "member" as const,
      capabilities: [],
      modules,
      evaluatedAt: "2026-09-27T00:00:00.000Z",
    };
    const directory = {
      organizationStatus: "active" as const,
      membershipStatus: "active" as const,
      appEnabled: true,
      modules: modules.filter((key) => key !== "crevia.publishing"),
      creviaOrganizationId: "corg_a",
    };
    assert.equal(
      authorizeSensitiveWrite({ context, directory, action: "publish" }).ok,
      false,
    );
    const owner = {
      ...context,
      membershipRole: "owner" as const,
      capabilities: [
        "SITE_READ" as const,
        "SITE_WRITE" as const,
        "PAGE_WRITE" as const,
        "BUILDER_WRITE" as const,
        "ASSET_WRITE" as const,
        "THEME_WRITE" as const,
        "PREVIEW_READ" as const,
        "PUBLISH" as const,
        "DOMAIN_WRITE" as const,
        "TEMPLATE_PUBLISH" as const,
      ],
    };
    assert.equal(
      authorizeSensitiveWrite({
        context: owner,
        directory: { ...directory, modules },
        action: "publish",
      }).ok,
      true,
    );
    assert.equal(authorizeSensitiveWrite({ context: null, directory, action: "site.delete" }).ok, false);
  });
});

describe("http", () => {
  it("serves health without secrets and keeps builder ready when publishing is degraded", async () => {
    const store = createFoundationStore();
    const sessions = createSessionStore();
    const plane = createMemoryControlPlane({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET });
    const deps = createMemoryServerDeps({
      store,
      sessions,
      provisioningKey: PROVISIONING_KEY,
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      identityMode: "orbia",
      appEnv: "TEST",
      secureCookies: true,
    });
    deps.controlPlane = plane;
    const health = await handleRequest({ method: "GET", path: "/api/health", headers: {} }, deps);
    assert.equal(health.status, 200);
    assert.equal(JSON.stringify(health.body).includes(PROVISIONING_KEY), false);
    assert.deepEqual(health.body, healthReport());

    const readiness = await handleRequest({ method: "GET", path: "/api/readiness", headers: {} }, deps);
    assert.equal(readiness.status, 200);
    const body = readiness.body as ReturnType<typeof evaluateReadiness>;
    assert.equal(body.checks.publishing, "degraded");
    assert.equal(body.checks.builder, "ready");
    assert.equal(body.checks.persistence, "ready");

    const closed = evaluateReadiness({
      identityMode: "dev",
      appEnv: "production",
      clientId: "",
      clientSecret: "",
      provisioningKey: "",
    });
    assert.equal(closed.status, "not_ready");
    assert.equal(closed.checks.identity, "missing");
    assert.equal(closed.checks.builder, "ready");
  });

  it("provisions through the internal route and opens a local callback", async () => {
    const store = createFoundationStore();
    const sessions = createSessionStore();
    const plane = createMemoryControlPlane({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET });
    const deps = createMemoryServerDeps({
      store,
      sessions,
      provisioningKey: PROVISIONING_KEY,
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      identityMode: "orbia",
      appEnv: "TEST",
      secureCookies: true,
    });
    deps.controlPlane = plane;
    const provision = await handleRequest(
      {
        method: "POST",
        path: "/api/internal/orbia/provision",
        headers: { "x-crevia-provisioning-key": PROVISIONING_KEY },
        body: { action: "enable", orbiaOrganizationId: "org_fixture_a", displayName: "Fixture A" },
      },
      deps,
    );
    assert.equal(provision.status, 200);
    const created = provision.body as { localOrganizationId: string; sites: number; seeded: boolean };
    assert.equal(created.sites, 0);
    assert.equal(created.seeded, false);

    const code = plane.issue(grant());
    const callback = await handleRequest(
      {
        method: "GET",
        path: `/api/auth/orbia/callback?code=${code}&creviaOrganizationId=${created.localOrganizationId}`,
        headers: {},
      },
      deps,
    );
    assert.equal(callback.status, 200);
    assert.match(callback.headers["set-cookie"] ?? "", /crevia_session=/);

    const session = await handleRequest(
      {
        method: "GET",
        path: "/api/session",
        headers: { cookie: callback.headers["set-cookie"] },
      },
      deps,
    );
    assert.equal(session.status, 200);
  });
});

describe("process start", () => {
  it("fails closed when production-like mode is not orbia", () => {
    const previousEnv = process.env.CREVIA_APP_ENV;
    const previousMode = process.env.CREVIA_IDENTITY_MODE;
    const previousUrl = process.env.DATABASE_URL;
    const previousStorage = process.env.CREVIA_ASSET_STORAGE_PATH;
    process.env.CREVIA_APP_ENV = "production";
    process.env.CREVIA_IDENTITY_MODE = "dev";
    process.env.DATABASE_URL = "postgresql://crevia:crevia_local_only@127.0.0.1:5432/crevia_local";
    process.env.CREVIA_ASSET_STORAGE_PATH = `${process.cwd()}/var/crevia-assets`;
    const deps = serverDepsFromEnv();
    assert.equal(deps.identityMode, "dev");
    assert.equal(deps.appEnv, "production");
    assert.equal(deps.secureCookies, true);
    process.env.CREVIA_APP_ENV = previousEnv;
    process.env.CREVIA_IDENTITY_MODE = previousMode;
    process.env.DATABASE_URL = previousUrl;
    process.env.CREVIA_ASSET_STORAGE_PATH = previousStorage;
  });
});
