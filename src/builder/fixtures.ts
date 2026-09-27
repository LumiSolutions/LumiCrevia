import { capabilitiesForOrbiaRole, MODULE_DESCRIPTORS, type CreviaModuleKey } from "../contract.js";
import {
  createFoundationStore,
  createSite,
  provisionOrganization,
  saveAsset,
  saveDraft,
  type FoundationStore,
} from "../store.js";
import { starterSnapshot } from "./blocks.js";

export const FIXTURE_ORBIA_ORG = "org_fixture_a";
export const FIXTURE_USER = "fixture_orbia_user";

export const BUILDER_MODULES = MODULE_DESCRIPTORS.filter((module) => module.serverGate).map(
  (module) => module.key,
) as CreviaModuleKey[];

export function createBuilderFixture(store: FoundationStore, provisioningKey: string) {
  const provisioned = provisionOrganization(store, {
    provisioningKey,
    expectedKey: provisioningKey,
    action: "enable",
    orbiaOrganizationId: FIXTURE_ORBIA_ORG,
    displayName: "Fixture A",
  });

  if (!provisioned.ok) {
    return provisioned;
  }

  const existing = store.sites.find((site) => site.organizationId === provisioned.localOrganizationId && site.status === "active");

  if (existing) {
    return { ok: true as const, organizationId: provisioned.localOrganizationId, siteId: existing.id, seeded: false };
  }

  const created = createSite(store, {
    organizationId: provisioned.localOrganizationId,
    name: "Studio Site",
    createdBy: FIXTURE_USER,
    modules: BUILDER_MODULES,
  });

  if (!created.ok) {
    return created;
  }

  const snapshot = starterSnapshot();
  const saved = saveDraft(store, {
    organizationId: provisioned.localOrganizationId,
    siteId: created.site.id,
    expectedVersion: created.site.draftVersion,
    createdBy: FIXTURE_USER,
    snapshot,
    modules: BUILDER_MODULES,
  });

  if (!saved.ok) {
    return saved;
  }

  saveAsset(store, {
    organizationId: provisioned.localOrganizationId,
    siteId: created.site.id,
    classification: "CREVIA_WEBSITE_ASSET",
    sourceSystem: null,
    externalAssetId: null,
    displayName: "Hero panel",
    modules: BUILDER_MODULES,
  });
  saveAsset(store, {
    organizationId: provisioned.localOrganizationId,
    siteId: created.site.id,
    classification: "SYNTARA_MARKETING_ASSET_REFERENCE",
    sourceSystem: "syntara",
    externalAssetId: "syn_mark_1",
    displayName: "Syntara mark",
    modules: BUILDER_MODULES,
  });
  saveAsset(store, {
    organizationId: provisioned.localOrganizationId,
    siteId: created.site.id,
    classification: "COMMERCE_ASSET_REFERENCE",
    sourceSystem: "commerce",
    externalAssetId: "com_hero_1",
    displayName: "Commerce still",
    modules: BUILDER_MODULES,
  });
  saveAsset(store, {
    organizationId: provisioned.localOrganizationId,
    siteId: created.site.id,
    classification: "PLATFORM_BRANDING_REFERENCE",
    sourceSystem: "orbia",
    externalAssetId: "brand_ref_1",
    displayName: "Platform brand",
    modules: BUILDER_MODULES,
  });

  return {
    ok: true as const,
    organizationId: provisioned.localOrganizationId,
    siteId: created.site.id,
    seeded: true,
    revisionId: saved.revision.revisionId,
    version: saved.revision.version,
  };
}

export function fixtureActor() {
  return {
    orbiaUserId: FIXTURE_USER,
    orbiaOrganizationId: FIXTURE_ORBIA_ORG,
    membershipRole: "admin" as const,
    capabilities: capabilitiesForOrbiaRole("admin"),
    modules: BUILDER_MODULES,
  };
}

export function emptyStoreWithFixture(provisioningKey: string) {
  const store = createFoundationStore();
  const fixture = createBuilderFixture(store, provisioningKey);
  return { store, fixture };
}
