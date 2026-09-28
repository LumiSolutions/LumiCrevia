import type { FoundationRepository, SaveAssetInput } from "./repository.js";
import {
  archiveAsset,
  archivePage,
  archiveSite,
  createPage,
  createSite,
  findOrganizationByOrbiaId,
  issuePreviewToken,
  latestDraft,
  latestPublication,
  listAssets,
  listSites,
  provisionOrganization,
  publicPublishedRender,
  publishedOutput,
  publishSite,
  readAsset,
  readPreview,
  readSite,
  readTheme,
  saveAsset,
  saveDomain,
  saveDraft,
  updateTheme,
  type FoundationStore,
} from "./store.js";
import {
  buildAssetStorageKey,
  createLocalFilesystemAssetStorage,
  defaultAssetStoragePath,
  storageKeyBelongsTo,
  validateUpload,
  type AssetStorage,
} from "./storage.js";

export function createMemoryRepository(
  store: FoundationStore,
  storage: AssetStorage = createLocalFilesystemAssetStorage(defaultAssetStoragePath("TEST")),
): FoundationRepository {
  const repository: FoundationRepository = {
    storage,
    async provisionOrganization(input) {
      return provisionOrganization(store, input);
    },
    async findOrganizationByOrbiaId(orbiaOrganizationId) {
      return findOrganizationByOrbiaId(store, orbiaOrganizationId);
    },
    async findOrganizationById(organizationId) {
      return store.organizations.find((row) => row.id === organizationId) ?? null;
    },
    async createSite(input) {
      return createSite(store, input);
    },
    async readSite(organizationId, siteId) {
      return readSite(store, organizationId, siteId);
    },
    async listSites(organizationId) {
      return listSites(store, organizationId);
    },
    async archiveSite(organizationId, siteId, modules) {
      return archiveSite(store, organizationId, siteId, modules);
    },
    async createPage(input) {
      return createPage(store, input);
    },
    async archivePage(organizationId, pageId) {
      return archivePage(store, organizationId, pageId);
    },
    async saveDraft(input) {
      return saveDraft(store, input);
    },
    async latestDraft(organizationId, siteId) {
      return latestDraft(store, organizationId, siteId);
    },
    async publishSite(input) {
      return publishSite(store, input);
    },
    async publishedOutput(organizationId, siteId) {
      return publishedOutput(store, organizationId, siteId);
    },
    async publicPublishedRender(siteId) {
      return publicPublishedRender(store, siteId);
    },
    async issuePreviewToken(input) {
      return issuePreviewToken(store, input);
    },
    async readPreview(input) {
      return readPreview(store, input);
    },
    async saveAsset(input: SaveAssetInput) {
      if (input.bytes) {
        const filename = input.filename ?? "file";
        const mimeType = input.mimeType ?? "application/octet-stream";
        const invalid = validateUpload({ filename, mimeType, size: input.bytes.byteLength });

        if (invalid) {
          return { ok: false as const, reason: invalid };
        }

        if (input.classification !== "CREVIA_WEBSITE_ASSET") {
          return { ok: false as const, reason: "bytes_not_allowed" as const };
        }
      }

      const saved = saveAsset(store, {
        ...input,
        size: input.bytes?.byteLength ?? null,
      });

      if (!saved.ok || !input.bytes) {
        return saved;
      }

      const storageKey = buildAssetStorageKey({
        organizationId: saved.asset.organizationId,
        siteId: saved.asset.siteId,
        assetId: saved.asset.id,
        filename: input.filename ?? "file",
      });

      try {
        await storage.put(storageKey, input.bytes);
      } catch {
        saved.asset.status = "archived";
        return { ok: false as const, reason: "storage_write_failed" as const };
      }

      saved.asset.storageKey = storageKey;
      saved.asset.filename = input.filename ?? "file";
      saved.asset.mimeType = input.mimeType ?? null;
      saved.asset.size = input.bytes.byteLength;
      return saved;
    },
    async readAsset(organizationId, assetId) {
      return readAsset(store, organizationId, assetId);
    },
    async listAssets(organizationId, siteId) {
      return listAssets(store, organizationId, siteId);
    },
    async archiveAsset(organizationId, assetId, modules) {
      const existing = readAsset(store, organizationId, assetId);
      const archived = archiveAsset(store, organizationId, assetId, modules);

      if (archived.ok && existing.ok && existing.asset.storageKey && storageKeyBelongsTo(organizationId, existing.asset.storageKey)) {
        await storage.delete(existing.asset.storageKey);
      }

      return archived;
    },
    async readAssetBytes(organizationId, assetId) {
      const asset = readAsset(store, organizationId, assetId);

      if (!asset.ok) {
        return asset;
      }

      if (!asset.asset.storageKey || !storageKeyBelongsTo(organizationId, asset.asset.storageKey)) {
        return { ok: false as const, reason: "not_found" as const };
      }

      const bytes = await storage.get(asset.asset.storageKey);

      if (!bytes) {
        return { ok: false as const, reason: "storage_missing" as const };
      }

      return { ok: true as const, bytes, asset: asset.asset };
    },
    async updateTheme(input) {
      return updateTheme(store, input);
    },
    async readTheme(organizationId, siteId) {
      return readTheme(store, organizationId, siteId);
    },
    async saveDomain(input) {
      return saveDomain(store, input);
    },
    async latestPublication(organizationId, siteId) {
      return latestPublication(store, organizationId, siteId);
    },
    async health() {
      return { ok: true, state: "ok", databaseName: "memory" };
    },
    async migrationHealth() {
      return { ok: true, state: "ok" };
    },
    async tableCounts() {
      return {
        organizations: store.organizations.length,
        sites: store.sites.length,
        pages: store.pages.length,
        revisions: store.revisions.length,
        publications: store.publications.length,
        assets: store.assets.length,
        themes: store.themes.length,
        sessions: 0,
        previews: store.previews.length,
      };
    },
    async disconnect() {
      return;
    },
  };

  return repository;
}
