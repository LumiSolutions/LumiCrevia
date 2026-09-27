import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createPostgresServerDeps } from "../src/deps.ts";
import { handleRequest } from "../src/http.ts";
import { openLocalSession } from "../src/identity.ts";
import { evaluateReadiness, healthReport } from "../src/readiness.ts";
import { createLocalFilesystemAssetStorage } from "../src/storage.ts";
import { emptySnapshot, type SiteSnapshot } from "../src/validation.ts";
import { BUILDER_MODULES, FIXTURE_ORBIA_ORG, FIXTURE_USER } from "../src/builder/fixtures.ts";
import { createPersistenceHarness, MODULES } from "./helpers/postgres.ts";

const KEY = "crevia-provisioning-key";

function pageSnapshot(title: string): SiteSnapshot {
  return {
    ...emptySnapshot(),
    pages: [
      {
        id: "page_home",
        slug: "home",
        title,
        sortOrder: 0,
        navigationVisible: true,
        homepage: true,
        seo: { title, description: "Fixture", canonical: "", robots: "index", ogImage: "" },
        blocks: [
          {
            id: "block_1",
            type: "text",
            version: 1,
            props: { html: title },
            styles: {},
            responsive: { desktop: {}, tablet: {}, mobile: {} },
            children: [],
            metadata: {},
          },
        ],
      },
    ],
  };
}

describe("postgresql persistence", () => {
  it("provisions one empty organization and persists site, page, revision, theme, and publication", async () => {
    const harness = await createPersistenceHarness();

    try {
      const first = await harness.repository.provisionOrganization({
        provisioningKey: KEY,
        expectedKey: KEY,
        action: "enable",
        orbiaOrganizationId: "org_fixture_a",
        displayName: "Fixture A",
      });
      assert.equal(first.ok, true);
      if (!first.ok) {
        return;
      }

      assert.equal(first.seeded, false);
      assert.equal(first.sites, 0);
      const organization = await harness.repository.findOrganizationById(first.localOrganizationId);
      assert.ok(organization);
      assert.deepEqual(
        { sites: organization!.sites, pages: organization!.pages, assets: organization!.assets, themes: organization!.themes, users: organization!.users },
        { sites: 0, pages: 0, assets: 0, themes: 0, users: 0 },
      );

      const site = await harness.repository.createSite({
        organizationId: first.localOrganizationId,
        name: "Durable site",
        createdBy: "user_a",
        modules: MODULES,
      });
      assert.equal(site.ok, true);
      if (!site.ok) {
        return;
      }

      const page = await harness.repository.createPage({
        organizationId: first.localOrganizationId,
        siteId: site.site.id,
        title: "Home",
        slug: "home",
        sortOrder: 0,
        navigationVisible: true,
        homepage: true,
        modules: MODULES,
      });
      assert.equal(page.ok, true);

      const duplicate = await harness.repository.createPage({
        organizationId: first.localOrganizationId,
        siteId: site.site.id,
        title: "Home 2",
        slug: "home",
        sortOrder: 1,
        navigationVisible: true,
        modules: MODULES,
      });
      assert.equal(duplicate.ok, false);

      const saved = await harness.repository.saveDraft({
        organizationId: first.localOrganizationId,
        siteId: site.site.id,
        expectedVersion: 1,
        createdBy: "user_a",
        snapshot: pageSnapshot("Home durable"),
        modules: MODULES,
      });
      assert.equal(saved.ok, true);
      if (!saved.ok) {
        return;
      }

      const theme = await harness.repository.updateTheme({
        organizationId: first.localOrganizationId,
        siteId: site.site.id,
        modules: MODULES,
        tokens: { ...emptySnapshot().theme, colors: { background: "#111" } },
      });
      assert.equal(theme.ok, true);

      const published = await harness.repository.publishSite({
        organizationId: first.localOrganizationId,
        siteId: site.site.id,
        revisionId: saved.revision.revisionId,
        target: "local-fixture",
        createdBy: "user_a",
        modules: MODULES,
      });
      assert.equal(published.ok, true);
      if (!published.ok) {
        return;
      }

      const live = await harness.repository.publishedOutput(first.localOrganizationId, site.site.id);
      assert.equal(live.ok, true);
      if (live.ok) {
        assert.equal(live.revision.revisionId, saved.revision.revisionId);
      }

      const counts = await harness.repository.tableCounts();
      assert.equal(counts.organizations, 1);
      assert.equal(counts.sites, 1);
      assert.ok(counts.pages >= 1);
      assert.ok(counts.revisions >= 2);
      assert.equal(counts.publications, 1);
      assert.equal(counts.themes, 1);
    } finally {
      await harness.cleanup();
    }
  });

  it("keeps the same organization id across disable and re-enable", async () => {
    const harness = await createPersistenceHarness();

    try {
      const enabled = await harness.repository.provisionOrganization({
        provisioningKey: KEY,
        expectedKey: KEY,
        action: "enable",
        orbiaOrganizationId: "org_fixture_a",
      });
      assert.equal(enabled.ok, true);
      if (!enabled.ok) {
        return;
      }

      const site = await harness.repository.createSite({
        organizationId: enabled.localOrganizationId,
        name: "Kept",
        createdBy: "user_a",
        modules: MODULES,
      });
      assert.equal(site.ok, true);

      const disabled = await harness.repository.provisionOrganization({
        provisioningKey: KEY,
        expectedKey: KEY,
        action: "disable",
        orbiaOrganizationId: "org_fixture_a",
      });
      assert.equal(disabled.ok, true);
      if (site.ok) {
        const blocked = await harness.repository.createPage({
          organizationId: enabled.localOrganizationId,
          siteId: site.site.id,
          title: "Nope",
          slug: "nope",
          sortOrder: 0,
          navigationVisible: true,
          modules: MODULES,
        });
        assert.equal(blocked.ok, false);
      }

      const reenabled = await harness.repository.provisionOrganization({
        provisioningKey: KEY,
        expectedKey: KEY,
        action: "re-enable",
        orbiaOrganizationId: "org_fixture_a",
      });
      assert.equal(reenabled.ok, true);
      if (!reenabled.ok) {
        return;
      }

      assert.equal(reenabled.localOrganizationId, enabled.localOrganizationId);
      const sites = await harness.repository.listSites(enabled.localOrganizationId);
      assert.equal(sites.length, 1);
      if (site.ok) {
        assert.equal(sites[0]?.id, site.site.id);
      }
    } finally {
      await harness.cleanup();
    }
  });

  it("persists hashed sessions and preview tokens, not the plaintext values", async () => {
    const harness = await createPersistenceHarness();

    try {
      const enabled = await harness.repository.provisionOrganization({
        provisioningKey: KEY,
        expectedKey: KEY,
        action: "enable",
        orbiaOrganizationId: "org_fixture_a",
      });
      assert.equal(enabled.ok, true);
      if (!enabled.ok) {
        return;
      }

      const site = await harness.repository.createSite({
        organizationId: enabled.localOrganizationId,
        name: "Preview",
        createdBy: "user_a",
        modules: MODULES,
      });
      assert.equal(site.ok, true);
      if (!site.ok) {
        return;
      }

      const opened = await openLocalSession({
        sessions: harness.sessions,
        appEnv: "TEST",
        orbiaUserId: FIXTURE_USER,
        orbiaOrganizationId: "org_fixture_a",
        creviaOrganizationId: enabled.localOrganizationId,
        membershipRole: "admin",
        modules: BUILDER_MODULES,
      });
      assert.equal(opened.ok, true);
      if (!opened.ok) {
        return;
      }

      const stored = await harness.sessions.find(opened.token);
      assert.ok(stored);
      assert.equal(JSON.stringify(stored).includes(opened.token), false);
      assert.equal(stored!.tokenHash.includes(opened.token), false);

      const preview = await harness.repository.issuePreviewToken({
        organizationId: enabled.localOrganizationId,
        siteId: site.site.id,
        revisionId: site.revision.revisionId,
        kind: "draft",
      });
      assert.equal(preview.ok, true);
      if (!preview.ok) {
        return;
      }

      const row = await harness.prisma.previewToken.findFirst();
      assert.ok(row);
      assert.equal(row!.tokenHash.includes(preview.token), false);
      const read = await harness.repository.readPreview({
        token: preview.token,
        organizationId: enabled.localOrganizationId,
      });
      assert.equal(read.ok, true);
    } finally {
      await harness.cleanup();
    }
  });

  it("archives a site without deleting revisions", async () => {
    const harness = await createPersistenceHarness();

    try {
      const enabled = await harness.repository.provisionOrganization({
        provisioningKey: KEY,
        expectedKey: KEY,
        action: "enable",
        orbiaOrganizationId: "org_fixture_a",
      });
      assert.equal(enabled.ok, true);
      if (!enabled.ok) {
        return;
      }

      const site = await harness.repository.createSite({
        organizationId: enabled.localOrganizationId,
        name: "Archive me",
        createdBy: "user_a",
        modules: MODULES,
      });
      assert.equal(site.ok, true);
      if (!site.ok) {
        return;
      }

      const archived = await harness.repository.archiveSite(enabled.localOrganizationId, site.site.id, MODULES);
      assert.equal(archived.ok, true);
      if (archived.ok) {
        assert.ok(archived.revisionsKept >= 1);
      }

      const hidden = await harness.repository.readSite(enabled.localOrganizationId, site.site.id);
      assert.equal(hidden.ok, false);
      const revision = await harness.prisma.siteRevision.findFirst({ where: { siteId: site.site.id } });
      assert.ok(revision);
    } finally {
      await harness.cleanup();
    }
  });

  it("reports database and storage failures without leaking connection details", async () => {
    const blocked = join(tmpdir(), `crevia-not-a-dir-${Date.now()}`);
    await writeFile(blocked, "not-a-directory");
    const storage = createLocalFilesystemAssetStorage(blocked);
    const files = await storage.health();
    assert.equal(files.ok, false);
    const report = healthReport({ database: "down", assetStorage: "down" });
    const serialized = JSON.stringify({ files, report });
    assert.equal(serialized.includes("crevia_local_only"), false);
    assert.equal(serialized.includes("DATABASE_URL"), false);
    assert.equal(report.status, "degraded");
    const readiness = evaluateReadiness({
      identityMode: "dev",
      appEnv: "TEST",
      clientId: "",
      clientSecret: "",
      provisioningKey: KEY,
      persistence: "missing",
      storage: "missing",
      migration: "missing",
    });
    assert.equal(readiness.status, "not_ready");
    assert.equal(JSON.stringify(readiness).includes("crevia_local_only"), false);
  });

  it("serves the local fixture through PostgreSQL persistence", async () => {
    const harness = await createPersistenceHarness();

    try {
      const deps = createPostgresServerDeps({
        prisma: harness.prisma,
        storage: harness.storage,
        sessions: harness.sessions,
        provisioningKey: "local-fixture-key",
        identityMode: "dev",
        appEnv: "TEST",
        secureCookies: false,
      });
      const opened = await handleRequest({ method: "POST", path: "/api/dev/fixture", headers: {} }, deps);
      assert.equal(opened.status, 200);
      const body = opened.body as { organizationId: string; siteId: string };
      const org = await harness.repository.findOrganizationByOrbiaId(FIXTURE_ORBIA_ORG);
      assert.equal(org?.id, body.organizationId);
      const draft = await harness.repository.latestDraft(body.organizationId, body.siteId);
      assert.equal(draft.ok, true);
    } finally {
      await harness.cleanup();
    }
  });
});
