import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { createPrismaClient } from "../src/deps.ts";
import { emptySnapshot } from "../src/validation.ts";
import {
  createPersistenceHarness,
  dumpDatabase,
  MODULES,
  resetDatabase,
  RESTORE_DATABASE_URL,
  restoreDatabase,
  TEST_DATABASE_URL,
} from "./helpers/postgres.ts";

const KEY = "crevia-provisioning-key";
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");

describe("backup restore", () => {
  it("restores organization, site, page, revision, publication, asset, theme, and session counts", async () => {
    const harness = await createPersistenceHarness();
    const restore = createPrismaClient(RESTORE_DATABASE_URL);
    const folder = await mkdtemp(join(tmpdir(), "crevia-dump-"));
    const file = join(folder, "crevia_test.dump");

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
        name: "Backup",
        createdBy: "user_a",
        modules: MODULES,
      });
      assert.equal(site.ok, true);
      if (!site.ok) {
        return;
      }

      await harness.repository.saveDraft({
        organizationId: enabled.localOrganizationId,
        siteId: site.site.id,
        expectedVersion: 1,
        createdBy: "user_a",
        snapshot: {
          ...emptySnapshot(),
          pages: [
            {
              id: "page_home",
              slug: "home",
              title: "Backup",
              sortOrder: 0,
              navigationVisible: true,
              homepage: true,
              seo: { title: "Backup", description: "", canonical: "", robots: "", ogImage: "" },
              blocks: [],
            },
          ],
        },
        modules: MODULES,
      });
      await harness.repository.updateTheme({
        organizationId: enabled.localOrganizationId,
        siteId: site.site.id,
        modules: MODULES,
        tokens: emptySnapshot().theme,
      });
      await harness.repository.saveAsset({
        organizationId: enabled.localOrganizationId,
        siteId: site.site.id,
        classification: "CREVIA_WEBSITE_ASSET",
        sourceSystem: null,
        externalAssetId: null,
        displayName: "File",
        filename: "file.png",
        mimeType: "image/png",
        bytes: PNG,
        modules: MODULES,
      });
      await harness.repository.issuePreviewToken({
        organizationId: enabled.localOrganizationId,
        siteId: site.site.id,
        revisionId: site.revision.revisionId,
        kind: "draft",
      });

      const expected = await harness.repository.tableCounts();
      await dumpDatabase(TEST_DATABASE_URL, file);
      await resetDatabase(restore);
      await restoreDatabase(RESTORE_DATABASE_URL, file);

      const actual = {
        organizations: await restore.productOrganization.count(),
        sites: await restore.site.count(),
        pages: await restore.page.count(),
        revisions: await restore.siteRevision.count(),
        publications: await restore.publication.count(),
        assets: await restore.asset.count(),
        themes: await restore.theme.count(),
        sessions: await restore.productSession.count(),
        previews: await restore.previewToken.count(),
      };
      assert.deepEqual(actual, expected);
    } finally {
      await restore.$disconnect();
      await harness.cleanup();
      await rm(folder, { recursive: true, force: true });
    }
  });
});
