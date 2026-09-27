import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { emptySnapshot, type SiteSnapshot } from "../src/validation.ts";
import { createPersistenceHarness, MODULES } from "./helpers/postgres.ts";

const KEY = "crevia-provisioning-key";

function snapshot(): SiteSnapshot {
  return {
    ...emptySnapshot(),
    pages: [
      {
        id: "page_home",
        slug: "home",
        title: "Concurrent",
        sortOrder: 0,
        navigationVisible: true,
        homepage: true,
        seo: { title: "Concurrent", description: "", canonical: "", robots: "", ogImage: "" },
        blocks: [
          {
            id: "block_1",
            type: "text",
            version: 1,
            props: { html: "Hello" },
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

describe("postgresql concurrency", () => {
  it("accepts exactly one of twenty parallel saves with the same expectedVersion", async () => {
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
        name: "Race",
        createdBy: "user_a",
        modules: MODULES,
      });
      assert.equal(site.ok, true);
      if (!site.ok) {
        return;
      }

      const results = await Promise.all(
        Array.from({ length: 20 }, (_, index) =>
          harness.repository.saveDraft({
            organizationId: enabled.localOrganizationId,
            siteId: site.site.id,
            expectedVersion: 1,
            createdBy: `user_${index}`,
            snapshot: snapshot(),
            modules: MODULES,
          }),
        ),
      );

      const successes = results.filter((result) => result.ok);
      const conflicts = results.filter((result) => !result.ok && result.reason === "conflict");
      assert.equal(successes.length, 1);
      assert.equal(conflicts.length, 19);
      const current = await harness.repository.readSite(enabled.localOrganizationId, site.site.id);
      assert.equal(current.ok, true);
      if (current.ok) {
        assert.equal(current.site.draftVersion, 2);
      }
    } finally {
      await harness.cleanup();
    }
  });

  it("creates exactly one product organization for parallel enable of the same orbia id", async () => {
    const harness = await createPersistenceHarness();

    try {
      const results = await Promise.all(
        Array.from({ length: 20 }, () =>
          harness.repository.provisionOrganization({
            provisioningKey: KEY,
            expectedKey: KEY,
            action: "enable",
            orbiaOrganizationId: "org_fixture_parallel",
            displayName: "Parallel",
          }),
        ),
      );

      assert.equal(results.every((result) => result.ok), true);
      const ids = new Set(results.filter((result) => result.ok).map((result) => result.localOrganizationId));
      assert.equal(ids.size, 1);
      const counts = await harness.repository.tableCounts();
      assert.equal(counts.organizations, 1);
      assert.equal(counts.sites, 0);
    } finally {
      await harness.cleanup();
    }
  });
});
