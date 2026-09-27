import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createPrismaClient } from "../src/deps.ts";
import { createPostgresRepository } from "../src/postgres-repository.ts";
import { hashBytes } from "../src/storage.ts";
import { emptySnapshot, type SiteSnapshot } from "../src/validation.ts";
import { createPersistenceHarness, MODULES, TEST_DATABASE_URL } from "./helpers/postgres.ts";

const KEY = "crevia-provisioning-key";
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");

function snapshot(title: string): SiteSnapshot {
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
        seo: { title, description: "", canonical: "", robots: "", ogImage: "" },
        blocks: [
          {
            id: "block_1",
            type: "text",
            version: 1,
            props: { html: title },
            styles: {},
            responsive: {},
            children: [],
            metadata: {},
          },
        ],
      },
    ],
  };
}

describe("restart durability", () => {
  it("reloads organization, site, pages, draft, theme, asset, and publication after a new client", async () => {
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
        name: "Durable",
        createdBy: "user_a",
        modules: MODULES,
      });
      assert.equal(site.ok, true);
      if (!site.ok) {
        return;
      }

      const saved = await harness.repository.saveDraft({
        organizationId: enabled.localOrganizationId,
        siteId: site.site.id,
        expectedVersion: 1,
        createdBy: "user_a",
        snapshot: snapshot("Draft 2"),
        modules: MODULES,
      });
      assert.equal(saved.ok, true);
      if (!saved.ok) {
        return;
      }

      await harness.repository.updateTheme({
        organizationId: enabled.localOrganizationId,
        siteId: site.site.id,
        modules: MODULES,
        tokens: { ...emptySnapshot().theme, colors: { background: "#abc" } },
      });
      const asset = await harness.repository.saveAsset({
        organizationId: enabled.localOrganizationId,
        siteId: site.site.id,
        classification: "CREVIA_WEBSITE_ASSET",
        sourceSystem: null,
        externalAssetId: null,
        displayName: "Hero",
        filename: "hero.png",
        mimeType: "image/png",
        bytes: PNG,
        modules: MODULES,
      });
      assert.equal(asset.ok, true);
      const published = await harness.repository.publishSite({
        organizationId: enabled.localOrganizationId,
        siteId: site.site.id,
        revisionId: saved.revision.revisionId,
        target: "local-fixture",
        createdBy: "user_a",
        modules: MODULES,
      });
      assert.equal(published.ok, true);

      await harness.prisma.$disconnect();
      const restarted = createPrismaClient(TEST_DATABASE_URL);
      const repo = createPostgresRepository(restarted, harness.storage);

      try {
        const org = await repo.findOrganizationByOrbiaId("org_fixture_a");
        assert.equal(org?.id, enabled.localOrganizationId);
        const loadedSite = await repo.readSite(enabled.localOrganizationId, site.site.id);
        assert.equal(loadedSite.ok, true);
        const draft = await repo.latestDraft(enabled.localOrganizationId, site.site.id);
        assert.equal(draft.ok, true);
        const theme = await repo.readTheme(enabled.localOrganizationId, site.site.id);
        assert.equal(theme.ok, true);
        if (asset.ok) {
          const bytes = await repo.readAssetBytes(enabled.localOrganizationId, asset.asset.id);
          assert.equal(bytes.ok, true);
          if (bytes.ok) {
            assert.equal(hashBytes(bytes.bytes), hashBytes(PNG));
            assert.equal(bytes.bytes.byteLength, PNG.byteLength);
          }
        }
        const live = await repo.publicPublishedRender(site.site.id);
        assert.equal(live.ok, true);
        if (live.ok) {
          assert.equal(live.snapshot.pages[0]?.title, "Draft 2");
        }
      } finally {
        await repo.disconnect();
      }
    } finally {
      await harness.cleanup();
    }
  });

  it("keeps published revision 5 after a later draft 6 and a client restart", async () => {
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

      const created = await harness.repository.createSite({
        organizationId: enabled.localOrganizationId,
        name: "Published durable",
        createdBy: "user_a",
        modules: MODULES,
      });
      assert.equal(created.ok, true);
      if (!created.ok) {
        return;
      }

      let version = 1;
      let revisionId = created.revision.revisionId;

      for (let next = 2; next <= 5; next += 1) {
        const saved = await harness.repository.saveDraft({
          organizationId: enabled.localOrganizationId,
          siteId: created.site.id,
          expectedVersion: version,
          createdBy: "user_a",
          snapshot: snapshot(`Home ${next}`),
          modules: MODULES,
        });
        assert.equal(saved.ok, true);
        if (!saved.ok) {
          return;
        }
        version = saved.revision.version;
        revisionId = saved.revision.revisionId;
      }

      const published = await harness.repository.publishSite({
        organizationId: enabled.localOrganizationId,
        siteId: created.site.id,
        revisionId,
        target: "local-fixture",
        createdBy: "user_a",
        modules: MODULES,
      });
      assert.equal(published.ok, true);

      await harness.prisma.$disconnect();
      const mid = createPrismaClient(TEST_DATABASE_URL);
      const midRepo = createPostgresRepository(mid, harness.storage);
      const draft6 = await midRepo.saveDraft({
        organizationId: enabled.localOrganizationId,
        siteId: created.site.id,
        expectedVersion: 5,
        createdBy: "user_a",
        snapshot: snapshot("Draft 6"),
        modules: MODULES,
      });
      assert.equal(draft6.ok, true);
      await midRepo.disconnect();

      const finalClient = createPrismaClient(TEST_DATABASE_URL);
      const finalRepo = createPostgresRepository(finalClient, harness.storage);

      try {
        const live = await finalRepo.publicPublishedRender(created.site.id);
        assert.equal(live.ok, true);
        if (live.ok) {
          assert.equal(live.version, 5);
          assert.equal(live.snapshot.pages[0]?.title, "Home 5");
          assert.equal(JSON.stringify(live.snapshot).includes("Draft 6"), false);
        }
      } finally {
        await finalRepo.disconnect();
      }
    } finally {
      await harness.cleanup();
    }
  });
});
