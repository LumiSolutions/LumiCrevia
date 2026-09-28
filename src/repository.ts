import type { CreviaModuleKey } from "./contract.js";
import type { AssetStorage } from "./storage.js";
import type {
  AssetClass,
  AssetRecord,
  PreviewToken,
  ProductOrganization,
  PublicationRecord,
  SiteRecord,
} from "./store.js";
import type { SiteSnapshot } from "./validation.js";

export type PersistenceHealth = { ok: boolean; state: "ok" | "down"; databaseName?: string };

export type ProvisionInput = {
  provisioningKey: string;
  expectedKey: string;
  action: "enable" | "disable" | "re-enable";
  orbiaOrganizationId: string;
  displayName?: string;
};

export type SaveDraftInput = {
  organizationId: string;
  siteId: string;
  expectedVersion: number;
  createdBy: string;
  snapshot: SiteSnapshot;
  modules: readonly CreviaModuleKey[];
  now?: string;
};

export type PublishInput = {
  organizationId: string;
  siteId: string;
  revisionId: string;
  target: string;
  createdBy: string;
  modules: readonly CreviaModuleKey[];
  now?: string;
};

export type SaveAssetInput = {
  organizationId: string;
  siteId: string;
  classification: AssetClass;
  sourceSystem: string | null;
  externalAssetId: string | null;
  displayName: string;
  modules: readonly CreviaModuleKey[];
  filename?: string;
  mimeType?: string;
  bytes?: Buffer;
};

export type TableCounts = {
  organizations: number;
  sites: number;
  pages: number;
  revisions: number;
  publications: number;
  assets: number;
  themes: number;
  sessions: number;
  previews: number;
};

export type FoundationRepository = {
  provisionOrganization(input: ProvisionInput): Promise<ReturnType<typeof import("./store.js").provisionOrganization>>;
  findOrganizationByOrbiaId(orbiaOrganizationId: string): Promise<ProductOrganization | null>;
  findOrganizationById(organizationId: string): Promise<ProductOrganization | null>;
  createSite(input: {
    organizationId: string;
    name: string;
    createdBy: string;
    modules: readonly CreviaModuleKey[];
    now?: string;
  }): Promise<ReturnType<typeof import("./store.js").createSite>>;
  readSite(organizationId: string, siteId: string): Promise<ReturnType<typeof import("./store.js").readSite>>;
  listSites(organizationId: string): Promise<SiteRecord[]>;
  archiveSite(
    organizationId: string,
    siteId: string,
    modules: readonly CreviaModuleKey[],
  ): Promise<ReturnType<typeof import("./store.js").archiveSite>>;
  createPage(input: {
    organizationId: string;
    siteId: string;
    title: string;
    slug: string;
    sortOrder: number;
    navigationVisible: boolean;
    homepage?: boolean;
    modules: readonly CreviaModuleKey[];
  }): Promise<ReturnType<typeof import("./store.js").createPage>>;
  archivePage(organizationId: string, pageId: string): Promise<ReturnType<typeof import("./store.js").archivePage>>;
  saveDraft(input: SaveDraftInput): Promise<ReturnType<typeof import("./store.js").saveDraft>>;
  latestDraft(organizationId: string, siteId: string): Promise<ReturnType<typeof import("./store.js").latestDraft>>;
  publishSite(input: PublishInput): Promise<ReturnType<typeof import("./store.js").publishSite>>;
  publishedOutput(organizationId: string, siteId: string): Promise<ReturnType<typeof import("./store.js").publishedOutput>>;
  publicPublishedRender(siteId: string): Promise<ReturnType<typeof import("./store.js").publicPublishedRender>>;
  issuePreviewToken(input: {
    organizationId: string;
    siteId: string;
    revisionId: string;
    kind: PreviewToken["kind"];
  }): Promise<ReturnType<typeof import("./store.js").issuePreviewToken>>;
  readPreview(input: { token: string; organizationId: string }): Promise<ReturnType<typeof import("./store.js").readPreview>>;
  saveAsset(input: SaveAssetInput): Promise<
    | ReturnType<typeof import("./store.js").saveAsset>
    | { ok: false; reason: string }
  >;
  readAsset(organizationId: string, assetId: string): Promise<ReturnType<typeof import("./store.js").readAsset>>;
  listAssets(organizationId: string, siteId: string): Promise<AssetRecord[]>;
  archiveAsset(
    organizationId: string,
    assetId: string,
    modules: readonly CreviaModuleKey[],
  ): Promise<ReturnType<typeof import("./store.js").archiveAsset>>;
  readAssetBytes(
    organizationId: string,
    assetId: string,
  ): Promise<{ ok: true; bytes: Buffer; asset: AssetRecord } | { ok: false; reason: "not_found" | "storage_missing" }>;
  updateTheme(input: {
    organizationId: string;
    siteId: string;
    tokens: SiteSnapshot["theme"];
    modules: readonly CreviaModuleKey[];
  }): Promise<ReturnType<typeof import("./store.js").updateTheme>>;
  readTheme(organizationId: string, siteId: string): Promise<ReturnType<typeof import("./store.js").readTheme>>;
  saveDomain(input: {
    organizationId: string;
    siteId: string;
    hostname: string;
    modules: readonly CreviaModuleKey[];
  }): Promise<ReturnType<typeof import("./store.js").saveDomain>>;
  latestPublication(organizationId: string, siteId: string): Promise<PublicationRecord | null>;
  health(): Promise<PersistenceHealth>;
  migrationHealth(): Promise<PersistenceHealth>;
  tableCounts(): Promise<TableCounts>;
  disconnect(): Promise<void>;
  storage?: AssetStorage;
};
