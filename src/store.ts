import { randomBytes, timingSafeEqual } from "node:crypto";

import type { CreviaModuleKey } from "./contract.js";
import { hashToken } from "./identity.js";
import { emptySnapshot, inspectSnapshot, type SiteSnapshot } from "./validation.js";

export type AccessStatus = "active" | "disabled";

export type ProductOrganization = {
  id: string;
  orbiaOrganizationId: string;
  displayName: string;
  access: AccessStatus;
  sites: number;
  pages: number;
  assets: number;
  themes: number;
  users: number;
};

export type SiteRecord = {
  id: string;
  organizationId: string;
  name: string;
  status: "active" | "archived";
  homepagePageId: string | null;
  draftVersion: number;
  publishedRevisionId: string | null;
  createdAt: string;
};

export type PageRecord = {
  id: string;
  organizationId: string;
  siteId: string;
  title: string;
  slug: string;
  status: "active" | "archived";
  navigationVisible: boolean;
  sortOrder: number;
  homepage: boolean;
};

export type SiteRevision = {
  revisionId: string;
  siteId: string;
  organizationId: string;
  version: number;
  status: "DRAFT" | "PUBLISHED";
  createdAt: string;
  createdBy: string;
  snapshot: SiteSnapshot;
};

export type PublicationStatus = "QUEUED" | "BUILDING" | "PUBLISHED" | "FAILED";

export type PublicationRecord = {
  id: string;
  siteId: string;
  organizationId: string;
  revisionId: string;
  target: string;
  status: PublicationStatus;
  createdAt: string;
  completedAt: string | null;
  error: string | null;
};

export type DomainRecord = {
  id: string;
  organizationId: string;
  siteId: string;
  hostname: string;
  verificationStatus: "unverified" | "pending" | "verified";
  sslStatus: "none" | "pending" | "active";
  publicationTarget: string | null;
};

export type AssetClass =
  | "CREVIA_WEBSITE_ASSET"
  | "SYNTARA_MARKETING_ASSET_REFERENCE"
  | "COMMERCE_ASSET_REFERENCE"
  | "PLATFORM_BRANDING_REFERENCE";

export type AssetRecord = {
  id: string;
  organizationId: string;
  siteId: string;
  classification: AssetClass;
  sourceSystem: string | null;
  externalAssetId: string | null;
  displayName: string;
  status: "active" | "archived";
};

export type ThemeRecord = {
  id: string;
  organizationId: string;
  siteId: string;
  tokens: SiteSnapshot["theme"];
};

export type PreviewToken = {
  tokenHash: string;
  organizationId: string;
  siteId: string;
  revisionId: string;
  kind: "editor" | "draft" | "published";
};

export type FoundationStore = {
  organizations: ProductOrganization[];
  sites: SiteRecord[];
  pages: PageRecord[];
  revisions: SiteRevision[];
  publications: PublicationRecord[];
  domains: DomainRecord[];
  assets: AssetRecord[];
  themes: ThemeRecord[];
  previews: PreviewToken[];
};

export function createFoundationStore(): FoundationStore {
  return {
    organizations: [],
    sites: [],
    pages: [],
    revisions: [],
    publications: [],
    domains: [],
    assets: [],
    themes: [],
    previews: [],
  };
}

function keysMatch(presented: string, expected: string): boolean {
  if (!presented || !expected) {
    return false;
  }

  const left = Buffer.from(presented);
  const right = Buffer.from(expected);

  if (left.length !== right.length) {
    return false;
  }

  return timingSafeEqual(left, right);
}

function id(prefix: string): string {
  return `${prefix}_${randomBytes(8).toString("base64url")}`;
}

function emptyOrganization(orbiaOrganizationId: string, displayName: string): ProductOrganization {
  return {
    id: id("corg"),
    orbiaOrganizationId,
    displayName,
    access: "active",
    sites: 0,
    pages: 0,
    assets: 0,
    themes: 0,
    users: 0,
  };
}

export function organizationSeedCounts(organization: ProductOrganization) {
  return {
    sites: organization.sites,
    pages: organization.pages,
    assets: organization.assets,
    themes: organization.themes,
    users: organization.users,
  };
}

export function provisionOrganization(
  store: FoundationStore,
  input: {
    provisioningKey: string;
    expectedKey: string;
    action: "enable" | "disable" | "re-enable";
    orbiaOrganizationId: string;
    displayName?: string;
  },
) {
  if (!keysMatch(input.provisioningKey, input.expectedKey)) {
    return { ok: false as const, reason: "provisioning_key_rejected" as const };
  }

  const orbiaOrganizationId = input.orbiaOrganizationId.trim();

  if (!orbiaOrganizationId) {
    return { ok: false as const, reason: "missing_organization" as const };
  }

  const matches = store.organizations.filter((row) => row.orbiaOrganizationId === orbiaOrganizationId);

  if (matches.length > 1) {
    return { ok: false as const, reason: "duplicate_orbia_organization" as const };
  }

  const existing = matches[0];

  if (input.action === "disable") {
    if (!existing) {
      return { ok: false as const, reason: "unknown_organization" as const };
    }

    existing.access = "disabled";
    return {
      ok: true as const,
      localOrganizationId: existing.id,
      reused: true,
      status: "disabled" as const,
      seeded: false,
      sites: store.sites.filter((site) => site.organizationId === existing.id).length,
    };
  }

  if (existing) {
    existing.access = "active";
    return {
      ok: true as const,
      localOrganizationId: existing.id,
      reused: true,
      status: "active" as const,
      seeded: false,
      sites: store.sites.filter((site) => site.organizationId === existing.id).length,
    };
  }

  const created = emptyOrganization(orbiaOrganizationId, input.displayName?.trim() || "Crevia");
  store.organizations.push(created);

  return {
    ok: true as const,
    localOrganizationId: created.id,
    reused: false,
    status: "active" as const,
    seeded: false,
    sites: 0,
  };
}

export function findOrganizationByOrbiaId(store: FoundationStore, orbiaOrganizationId: string) {
  return store.organizations.find((row) => row.orbiaOrganizationId === orbiaOrganizationId) ?? null;
}

function requireActiveOrg(store: FoundationStore, organizationId: string) {
  const organization = store.organizations.find((row) => row.id === organizationId);

  if (!organization) {
    return { ok: false as const, reason: "not_found" as const };
  }

  if (organization.access !== "active") {
    return { ok: false as const, reason: "disabled" as const };
  }

  return { ok: true as const, organization };
}

function siteForOrg(store: FoundationStore, organizationId: string, siteId: string) {
  return store.sites.find((site) => site.id === siteId && site.organizationId === organizationId) ?? null;
}

function requireWritable(store: FoundationStore, organizationId: string) {
  return requireActiveOrg(store, organizationId);
}

export function createSite(
  store: FoundationStore,
  input: {
    organizationId: string;
    name: string;
    createdBy: string;
    modules: readonly CreviaModuleKey[];
    now?: string;
  },
) {
  if (!input.modules.includes("crevia.sites")) {
    return { ok: false as const, reason: "module_disabled" as const };
  }

  const organization = requireActiveOrg(store, input.organizationId);

  if (!organization.ok) {
    return organization;
  }

  const name = input.name.trim();

  if (!name) {
    return { ok: false as const, reason: "invalid_site" as const };
  }

  const now = input.now ?? new Date().toISOString();
  const site: SiteRecord = {
    id: id("site"),
    organizationId: organization.organization.id,
    name,
    status: "active",
    homepagePageId: null,
    draftVersion: 1,
    publishedRevisionId: null,
    createdAt: now,
  };
  const revision: SiteRevision = {
    revisionId: id("rev"),
    siteId: site.id,
    organizationId: site.organizationId,
    version: 1,
    status: "DRAFT",
    createdAt: now,
    createdBy: input.createdBy,
    snapshot: emptySnapshot(),
  };
  store.sites.push(site);
  store.revisions.push(revision);
  organization.organization.sites += 1;

  return { ok: true as const, site, revision };
}

export function readSite(store: FoundationStore, organizationId: string, siteId: string) {
  const site = siteForOrg(store, organizationId, siteId);

  if (!site || site.status === "archived") {
    return { ok: false as const, reason: "not_found" as const };
  }

  return { ok: true as const, site };
}

export function archiveSite(
  store: FoundationStore,
  organizationId: string,
  siteId: string,
  modules: readonly CreviaModuleKey[],
) {
  if (!modules.includes("crevia.sites")) {
    return { ok: false as const, reason: "module_disabled" as const };
  }

  const site = siteForOrg(store, organizationId, siteId);

  if (!site) {
    return { ok: false as const, reason: "not_found" as const };
  }

  site.status = "archived";
  return { ok: true as const, site, revisionsKept: store.revisions.filter((row) => row.siteId === site.id).length };
}

export function createPage(
  store: FoundationStore,
  input: {
    organizationId: string;
    siteId: string;
    title: string;
    slug: string;
    sortOrder: number;
    navigationVisible: boolean;
    homepage?: boolean;
    modules: readonly CreviaModuleKey[];
  },
) {
  if (!input.modules.includes("crevia.pages")) {
    return { ok: false as const, reason: "module_disabled" as const };
  }

  const writable = requireWritable(store, input.organizationId);

  if (!writable.ok) {
    return writable;
  }

  const site = readSite(store, input.organizationId, input.siteId);

  if (!site.ok) {
    return site;
  }

  const slug = input.slug.trim();

  if (!slug || store.pages.some((page) => page.siteId === site.site.id && page.slug === slug && page.status === "active")) {
    return { ok: false as const, reason: "invalid_page" as const };
  }

  if (input.homepage) {
    for (const page of store.pages) {
      if (page.siteId === site.site.id && page.organizationId === input.organizationId) {
        page.homepage = false;
      }
    }
  }

  const page: PageRecord = {
    id: id("page"),
    organizationId: input.organizationId,
    siteId: site.site.id,
    title: input.title.trim(),
    slug,
    status: "active",
    navigationVisible: input.navigationVisible,
    sortOrder: input.sortOrder,
    homepage: input.homepage === true,
  };
  store.pages.push(page);

  if (page.homepage) {
    site.site.homepagePageId = page.id;
  }

  const organization = store.organizations.find((row) => row.id === input.organizationId);

  if (organization) {
    organization.pages += 1;
  }

  return { ok: true as const, page };
}

export function archivePage(store: FoundationStore, organizationId: string, pageId: string) {
  const page = store.pages.find((row) => row.id === pageId && row.organizationId === organizationId);

  if (!page) {
    return { ok: false as const, reason: "not_found" as const };
  }

  page.status = "archived";
  return { ok: true as const, page };
}

export function saveDraft(
  store: FoundationStore,
  input: {
    organizationId: string;
    siteId: string;
    expectedVersion: number;
    createdBy: string;
    snapshot: SiteSnapshot;
    modules: readonly CreviaModuleKey[];
    now?: string;
  },
) {
  if (!input.modules.includes("crevia.builder")) {
    return { ok: false as const, reason: "module_disabled" as const };
  }

  const writable = requireWritable(store, input.organizationId);

  if (!writable.ok) {
    return writable;
  }

  const site = readSite(store, input.organizationId, input.siteId);

  if (!site.ok) {
    return site;
  }

  if (site.site.draftVersion !== input.expectedVersion) {
    return {
      ok: false as const,
      reason: "conflict" as const,
      status: 409 as const,
      currentVersion: site.site.draftVersion,
    };
  }

  const inspected = inspectSnapshot(input.snapshot);

  if (inspected) {
    return { ok: false as const, reason: inspected };
  }

  const now = input.now ?? new Date().toISOString();
  const version = site.site.draftVersion + 1;
  const revision: SiteRevision = {
    revisionId: id("rev"),
    siteId: site.site.id,
    organizationId: site.site.organizationId,
    version,
    status: "DRAFT",
    createdAt: now,
    createdBy: input.createdBy,
    snapshot: structuredClone(input.snapshot),
  };
  store.revisions.push(revision);
  site.site.draftVersion = version;

  return { ok: true as const, revision, publishedRevisionId: site.site.publishedRevisionId };
}

export function publishSite(
  store: FoundationStore,
  input: {
    organizationId: string;
    siteId: string;
    revisionId: string;
    target: string;
    createdBy: string;
    modules: readonly CreviaModuleKey[];
    now?: string;
  },
) {
  if (!input.modules.includes("crevia.publishing")) {
    return { ok: false as const, reason: "module_disabled" as const };
  }

  const writable = requireWritable(store, input.organizationId);

  if (!writable.ok) {
    return writable;
  }

  const site = readSite(store, input.organizationId, input.siteId);

  if (!site.ok) {
    return site;
  }

  const revision = store.revisions.find(
    (row) =>
      row.revisionId === input.revisionId &&
      row.siteId === site.site.id &&
      row.organizationId === input.organizationId,
  );

  if (!revision) {
    return { ok: false as const, reason: "not_found" as const };
  }

  const now = input.now ?? new Date().toISOString();
  const published: SiteRevision = {
    ...revision,
    status: "PUBLISHED",
    snapshot: structuredClone(revision.snapshot),
  };
  const existing = store.revisions.find((row) => row.revisionId === revision.revisionId);

  if (existing) {
    existing.status = "PUBLISHED";
    existing.snapshot = published.snapshot;
  }

  const publication: PublicationRecord = {
    id: id("pub"),
    siteId: site.site.id,
    organizationId: input.organizationId,
    revisionId: revision.revisionId,
    target: input.target,
    status: "PUBLISHED",
    createdAt: now,
    completedAt: now,
    error: null,
  };
  store.publications.push(publication);
  site.site.publishedRevisionId = revision.revisionId;

  return { ok: true as const, publication, published };
}

export function publishedOutput(store: FoundationStore, organizationId: string, siteId: string) {
  const site = siteForOrg(store, organizationId, siteId);

  if (!site || !site.publishedRevisionId) {
    return { ok: false as const, reason: "not_found" as const };
  }

  const revision = store.revisions.find(
    (row) => row.revisionId === site.publishedRevisionId && row.organizationId === organizationId,
  );

  if (!revision || revision.status !== "PUBLISHED") {
    return { ok: false as const, reason: "not_found" as const };
  }

  return { ok: true as const, revision };
}

export function issuePreviewToken(
  store: FoundationStore,
  input: { organizationId: string; siteId: string; revisionId: string; kind: PreviewToken["kind"] },
) {
  const revision = store.revisions.find(
    (row) =>
      row.revisionId === input.revisionId &&
      row.siteId === input.siteId &&
      row.organizationId === input.organizationId,
  );

  if (!revision) {
    return { ok: false as const, reason: "not_found" as const };
  }

  if (input.kind === "published" && revision.status !== "PUBLISHED") {
    return { ok: false as const, reason: "draft_not_public" as const };
  }

  const token = randomBytes(24).toString("base64url");
  store.previews.push({
    tokenHash: hashToken(token),
    organizationId: input.organizationId,
    siteId: input.siteId,
    revisionId: input.revisionId,
    kind: input.kind,
  });
  return { ok: true as const, token };
}

export function readPreview(store: FoundationStore, input: { token: string; organizationId: string }) {
  const match = store.previews.find((row) => row.tokenHash === hashToken(input.token));

  if (!match || match.organizationId !== input.organizationId) {
    return { ok: false as const, reason: "not_found" as const };
  }

  const revision = store.revisions.find(
    (row) => row.revisionId === match.revisionId && row.organizationId === input.organizationId,
  );

  if (!revision) {
    return { ok: false as const, reason: "not_found" as const };
  }

  return { ok: true as const, kind: match.kind, revision };
}

export function publicPublishedRender(store: FoundationStore, siteId: string) {
  const site = store.sites.find((row) => row.id === siteId && row.status === "active");

  if (!site || !site.publishedRevisionId) {
    return { ok: false as const, reason: "not_found" as const };
  }

  const revision = store.revisions.find((row) => row.revisionId === site.publishedRevisionId);

  if (!revision || revision.status !== "PUBLISHED") {
    return { ok: false as const, reason: "not_found" as const };
  }

  return {
    ok: true as const,
    siteId: site.id,
    revisionId: revision.revisionId,
    version: revision.version,
    snapshot: revision.snapshot,
  };
}

export function saveAsset(
  store: FoundationStore,
  input: {
    organizationId: string;
    siteId: string;
    classification: AssetClass;
    sourceSystem: string | null;
    externalAssetId: string | null;
    displayName: string;
    modules: readonly CreviaModuleKey[];
  },
) {
  if (!input.modules.includes("crevia.assets")) {
    return { ok: false as const, reason: "module_disabled" as const };
  }

  const writable = requireWritable(store, input.organizationId);

  if (!writable.ok) {
    return writable;
  }

  const site = readSite(store, input.organizationId, input.siteId);

  if (!site.ok) {
    return site;
  }

  if (input.classification !== "CREVIA_WEBSITE_ASSET" && (!input.sourceSystem || !input.externalAssetId)) {
    return { ok: false as const, reason: "external_reference_required" as const };
  }

  const asset: AssetRecord = {
    id: id("asset"),
    organizationId: input.organizationId,
    siteId: site.site.id,
    classification: input.classification,
    sourceSystem: input.sourceSystem,
    externalAssetId: input.externalAssetId,
    displayName: input.displayName,
    status: "active",
  };
  store.assets.push(asset);
  const organization = store.organizations.find((row) => row.id === input.organizationId);

  if (organization) {
    organization.assets += 1;
  }

  return { ok: true as const, asset };
}

export function readAsset(store: FoundationStore, organizationId: string, assetId: string) {
  const asset = store.assets.find(
    (row) => row.id === assetId && row.organizationId === organizationId && row.status === "active",
  );

  if (!asset) {
    return { ok: false as const, reason: "not_found" as const };
  }

  return { ok: true as const, asset };
}

export function archiveAsset(
  store: FoundationStore,
  organizationId: string,
  assetId: string,
  modules: readonly CreviaModuleKey[],
) {
  if (!modules.includes("crevia.assets")) {
    return { ok: false as const, reason: "module_disabled" as const };
  }

  const asset = store.assets.find((row) => row.id === assetId && row.organizationId === organizationId);

  if (!asset) {
    return { ok: false as const, reason: "not_found" as const };
  }

  asset.status = "archived";
  return { ok: true as const, asset };
}

export function updateTheme(
  store: FoundationStore,
  input: {
    organizationId: string;
    siteId: string;
    tokens: SiteSnapshot["theme"];
    modules: readonly CreviaModuleKey[];
  },
) {
  if (!input.modules.includes("crevia.themes")) {
    return { ok: false as const, reason: "module_disabled" as const };
  }

  const writable = requireWritable(store, input.organizationId);

  if (!writable.ok) {
    return writable;
  }

  const site = readSite(store, input.organizationId, input.siteId);

  if (!site.ok) {
    return site;
  }

  const existing = store.themes.find(
    (row) => row.siteId === site.site.id && row.organizationId === input.organizationId,
  );

  if (existing) {
    existing.tokens = input.tokens;
    return { ok: true as const, theme: existing };
  }

  const theme: ThemeRecord = {
    id: id("theme"),
    organizationId: input.organizationId,
    siteId: site.site.id,
    tokens: input.tokens,
  };
  store.themes.push(theme);
  const organization = store.organizations.find((row) => row.id === input.organizationId);

  if (organization) {
    organization.themes += 1;
  }

  return { ok: true as const, theme };
}

export function readTheme(store: FoundationStore, organizationId: string, siteId: string) {
  const theme = store.themes.find((row) => row.organizationId === organizationId && row.siteId === siteId);

  if (!theme) {
    return { ok: false as const, reason: "not_found" as const };
  }

  return { ok: true as const, theme };
}

export function saveDomain(
  store: FoundationStore,
  input: {
    organizationId: string;
    siteId: string;
    hostname: string;
    modules: readonly CreviaModuleKey[];
  },
) {
  if (!input.modules.includes("crevia.domains")) {
    return { ok: false as const, reason: "module_disabled" as const };
  }

  const writable = requireWritable(store, input.organizationId);

  if (!writable.ok) {
    return writable;
  }

  const site = readSite(store, input.organizationId, input.siteId);

  if (!site.ok) {
    return site;
  }

  const hostname = input.hostname.trim().toLowerCase();

  if (!hostname || hostname.includes("://") || hostname.includes("/")) {
    return { ok: false as const, reason: "invalid_hostname" as const };
  }

  const domain: DomainRecord = {
    id: id("domain"),
    organizationId: input.organizationId,
    siteId: site.site.id,
    hostname,
    verificationStatus: "unverified",
    sslStatus: "none",
    publicationTarget: null,
  };
  store.domains.push(domain);
  return { ok: true as const, domain, dnsMutated: false as const };
}

export function importTemplate(input: { snapshot: SiteSnapshot; customJs?: string }) {
  if (input.customJs && input.customJs.trim()) {
    return { ok: false as const, reason: "custom_js_rejected" as const };
  }

  const inspected = inspectSnapshot(input.snapshot);

  if (inspected) {
    return { ok: false as const, reason: inspected };
  }

  return { ok: true as const };
}
