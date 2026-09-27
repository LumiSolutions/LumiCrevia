import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { hashBytes, storageKeyBelongsTo, validateUpload } from "../src/storage.ts";
import { createPersistenceHarness, MODULES } from "./helpers/postgres.ts";

const KEY = "crevia-provisioning-key";
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");

describe("asset storage", () => {
  it("validates filename, mime, size, svg, and executables", () => {
    assert.equal(validateUpload({ filename: "ok.png", mimeType: "image/png", size: 12 }), null);
    assert.equal(validateUpload({ filename: "../x.png", mimeType: "image/png", size: 12 }), "invalid_filename");
    assert.equal(validateUpload({ filename: "ok.svg", mimeType: "image/svg+xml", size: 12 }), "svg_rejected");
    assert.equal(validateUpload({ filename: "ok.js", mimeType: "application/javascript", size: 12 }), "executable_rejected");
    assert.equal(validateUpload({ filename: "ok.png", mimeType: "application/x-msdownload", size: 12 }), "invalid_mime");
    assert.equal(validateUpload({ filename: "ok.png", mimeType: "image/png", size: 20 * 1024 * 1024 }), "asset_too_large");
  });

  it("stores Crevia upload bytes and rejects executable or svg uploads", async () => {
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
        name: "Assets",
        createdBy: "user_a",
        modules: MODULES,
      });
      assert.equal(site.ok, true);
      if (!site.ok) {
        return;
      }

      const uploaded = await harness.repository.saveAsset({
        organizationId: enabled.localOrganizationId,
        siteId: site.site.id,
        classification: "CREVIA_WEBSITE_ASSET",
        sourceSystem: null,
        externalAssetId: null,
        displayName: "Panel",
        filename: "panel.png",
        mimeType: "image/png",
        bytes: PNG,
        modules: MODULES,
      });
      assert.equal(uploaded.ok, true);
      if (!uploaded.ok) {
        return;
      }

      assert.ok(uploaded.asset.storageKey);
      assert.equal(storageKeyBelongsTo(enabled.localOrganizationId, uploaded.asset.storageKey!), true);
      const loaded = await harness.repository.readAssetBytes(enabled.localOrganizationId, uploaded.asset.id);
      assert.equal(loaded.ok, true);
      if (loaded.ok) {
        assert.equal(hashBytes(loaded.bytes), hashBytes(PNG));
        assert.equal(loaded.bytes.byteLength, PNG.byteLength);
      }

      const svg = await harness.repository.saveAsset({
        organizationId: enabled.localOrganizationId,
        siteId: site.site.id,
        classification: "CREVIA_WEBSITE_ASSET",
        sourceSystem: null,
        externalAssetId: null,
        displayName: "Bad",
        filename: "icon.svg",
        mimeType: "image/svg+xml",
        bytes: Buffer.from("<svg></svg>"),
        modules: MODULES,
      });
      assert.equal(svg.ok, false);

      const script = await harness.repository.saveAsset({
        organizationId: enabled.localOrganizationId,
        siteId: site.site.id,
        classification: "CREVIA_WEBSITE_ASSET",
        sourceSystem: null,
        externalAssetId: null,
        displayName: "Bad",
        filename: "hook.js",
        mimeType: "application/javascript",
        bytes: Buffer.from("alert(1)"),
        modules: MODULES,
      });
      assert.equal(script.ok, false);

      const archived = await harness.repository.archiveAsset(enabled.localOrganizationId, uploaded.asset.id, MODULES);
      assert.equal(archived.ok, true);
      const missing = await harness.repository.readAssetBytes(enabled.localOrganizationId, uploaded.asset.id);
      assert.equal(missing.ok, false);
    } finally {
      await harness.cleanup();
    }
  });

  it("stores external asset references without copying bytes", async () => {
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
        name: "Refs",
        createdBy: "user_a",
        modules: MODULES,
      });
      assert.equal(site.ok, true);
      if (!site.ok) {
        return;
      }

      const referenced = await harness.repository.saveAsset({
        organizationId: enabled.localOrganizationId,
        siteId: site.site.id,
        classification: "SYNTARA_MARKETING_ASSET_REFERENCE",
        sourceSystem: "syntara",
        externalAssetId: "syn_mark_1",
        displayName: "Campaign still",
        modules: MODULES,
      });
      assert.equal(referenced.ok, true);
      if (!referenced.ok) {
        return;
      }

      assert.equal(referenced.asset.storageKey, null);
      assert.equal(referenced.asset.sourceSystem, "syntara");
      const bytes = await harness.repository.readAssetBytes(enabled.localOrganizationId, referenced.asset.id);
      assert.equal(bytes.ok, false);

      const copied = await harness.repository.saveAsset({
        organizationId: enabled.localOrganizationId,
        siteId: site.site.id,
        classification: "COMMERCE_ASSET_REFERENCE",
        sourceSystem: "commerce",
        externalAssetId: "com_1",
        displayName: "Shop still",
        filename: "shop.png",
        mimeType: "image/png",
        bytes: PNG,
        modules: MODULES,
      });
      assert.equal(copied.ok, false);
    } finally {
      await harness.cleanup();
    }
  });
});
