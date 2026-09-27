import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createPostgresServerDeps } from "../src/deps.ts";
import { handleRequest } from "../src/http.ts";
import { openLocalSession } from "../src/identity.ts";
import { storageKeyBelongsTo } from "../src/storage.ts";
import { emptySnapshot } from "../src/validation.ts";
import { BUILDER_MODULES } from "../src/builder/fixtures.ts";
import { createPersistenceHarness, MODULES } from "./helpers/postgres.ts";

const KEY = "crevia-provisioning-key";
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");

async function orgWithSite(harness: Awaited<ReturnType<typeof createPersistenceHarness>>, orbiaOrganizationId: string) {
  const enabled = await harness.repository.provisionOrganization({
    provisioningKey: KEY,
    expectedKey: KEY,
    action: "enable",
    orbiaOrganizationId,
  });
  assert.equal(enabled.ok, true);
  if (!enabled.ok) {
    throw new Error("provision failed");
  }

  const site = await harness.repository.createSite({
    organizationId: enabled.localOrganizationId,
    name: orbiaOrganizationId,
    createdBy: "user",
    modules: MODULES,
  });
  assert.equal(site.ok, true);
  if (!site.ok) {
    throw new Error("site failed");
  }

  return { organizationId: enabled.localOrganizationId, site: site.site, revision: site.revision };
}

describe("cross-organization isolation", () => {
  it("blocks org B from reading or mutating org A records, including guessed ids", async () => {
    const harness = await createPersistenceHarness();

    try {
      const orgA = await orgWithSite(harness, "org_fixture_a");
      const orgB = await orgWithSite(harness, "org_fixture_b");

      const page = await harness.repository.createPage({
        organizationId: orgA.organizationId,
        siteId: orgA.site.id,
        title: "Home",
        slug: "home",
        sortOrder: 0,
        navigationVisible: true,
        homepage: true,
        modules: MODULES,
      });
      assert.equal(page.ok, true);

      const asset = await harness.repository.saveAsset({
        organizationId: orgA.organizationId,
        siteId: orgA.site.id,
        classification: "CREVIA_WEBSITE_ASSET",
        sourceSystem: null,
        externalAssetId: null,
        displayName: "Secret",
        filename: "secret.png",
        mimeType: "image/png",
        bytes: PNG,
        modules: MODULES,
      });
      assert.equal(asset.ok, true);
      if (!asset.ok) {
        return;
      }

      const theme = await harness.repository.updateTheme({
        organizationId: orgA.organizationId,
        siteId: orgA.site.id,
        modules: MODULES,
        tokens: emptySnapshot().theme,
      });
      assert.equal(theme.ok, true);

      const preview = await harness.repository.issuePreviewToken({
        organizationId: orgA.organizationId,
        siteId: orgA.site.id,
        revisionId: orgA.revision.revisionId,
        kind: "draft",
      });
      assert.equal(preview.ok, true);

      assert.equal((await harness.repository.readSite(orgB.organizationId, orgA.site.id)).ok, false);
      assert.equal(page.ok && (await harness.repository.archivePage(orgB.organizationId, page.page.id)).ok, false);
      assert.equal((await harness.repository.latestDraft(orgB.organizationId, orgA.site.id)).ok, false);
      assert.equal((await harness.repository.readAsset(orgB.organizationId, asset.asset.id)).ok, false);
      assert.equal((await harness.repository.readAssetBytes(orgB.organizationId, asset.asset.id)).ok, false);
      assert.equal((await harness.repository.archiveAsset(orgB.organizationId, asset.asset.id, MODULES)).ok, false);
      assert.equal((await harness.repository.readTheme(orgB.organizationId, orgA.site.id)).ok, false);
      assert.equal(
        (
          await harness.repository.updateTheme({
            organizationId: orgB.organizationId,
            siteId: orgA.site.id,
            modules: MODULES,
            tokens: emptySnapshot().theme,
          })
        ).ok,
        false,
      );
      assert.equal(
        (
          await harness.repository.publishSite({
            organizationId: orgB.organizationId,
            siteId: orgA.site.id,
            revisionId: orgA.revision.revisionId,
            target: "local-fixture",
            createdBy: "b",
            modules: MODULES,
          })
        ).ok,
        false,
      );
      if (preview.ok) {
        assert.equal(
          (await harness.repository.readPreview({ token: preview.token, organizationId: orgB.organizationId })).ok,
          false,
        );
      }

      assert.equal(asset.asset.storageKey && storageKeyBelongsTo(orgB.organizationId, asset.asset.storageKey), false);
      const stolen = await harness.storage.get(asset.asset.storageKey ?? "");
      assert.ok(stolen);
      assert.equal(storageKeyBelongsTo(orgA.organizationId, asset.asset.storageKey ?? ""), true);

      const deps = createPostgresServerDeps({
        prisma: harness.prisma,
        storage: harness.storage,
        sessions: harness.sessions,
        provisioningKey: KEY,
        identityMode: "dev",
        appEnv: "TEST",
      });
      const opened = await openLocalSession({
        sessions: harness.sessions,
        appEnv: "TEST",
        orbiaUserId: "user_b",
        orbiaOrganizationId: "org_fixture_b",
        creviaOrganizationId: orgB.organizationId,
        membershipRole: "admin",
        modules: BUILDER_MODULES,
      });
      assert.equal(opened.ok, true);
      if (!opened.ok) {
        return;
      }

      const guessed = await handleRequest(
        { method: "GET", path: `/api/sites/${orgA.site.id}`, headers: { cookie: opened.cookie } },
        deps,
      );
      assert.equal(guessed.status, 404);

      const guessedAsset = await handleRequest(
        { method: "GET", path: `/api/assets/${asset.asset.id}/content`, headers: { cookie: opened.cookie } },
        deps,
      );
      assert.equal(guessedAsset.status, 404);
    } finally {
      await harness.cleanup();
    }
  });
});
