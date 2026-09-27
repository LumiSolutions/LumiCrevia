import { Prisma, PrismaClient } from "@prisma/client";
import { randomBytes } from "node:crypto";

import { PREVIEW_TTL_MS } from "./contract.js";
import { createId } from "./ids.js";
import { hashToken } from "./identity.js";
import type { FoundationRepository, SaveAssetInput, TableCounts } from "./repository.js";
import type {
  AccessStatus,
  AssetRecord,
  DomainRecord,
  PageRecord,
  ProductOrganization,
  PublicationRecord,
  PublicationStatus,
  SiteRecord,
  SiteRevision,
  ThemeRecord,
} from "./store.js";
import {
  buildAssetStorageKey,
  storageKeyBelongsTo,
  validateUpload,
  type AssetStorage,
} from "./storage.js";
import { emptySnapshot, inspectSnapshot, type SiteSnapshot } from "./validation.js";

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function nowDate(value?: string): Date {
  return value ? new Date(value) : new Date();
}

function mapOrganization(
  row: {
    id: string;
    orbiaOrganizationId: string;
    displayName: string;
    accessStatus: string;
    createdAt: Date;
    updatedAt: Date;
  },
  counts: { sites: number; pages: number; assets: number; themes: number },
): ProductOrganization {
  return {
    id: row.id,
    orbiaOrganizationId: row.orbiaOrganizationId,
    displayName: row.displayName,
    access: row.accessStatus as AccessStatus,
    sites: counts.sites,
    pages: counts.pages,
    assets: counts.assets,
    themes: counts.themes,
    users: 0,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function mapSite(row: {
  id: string;
  organizationId: string;
  name: string;
  status: string;
  homepagePageId: string | null;
  draftVersion: number;
  publishedRevisionId: string | null;
  createdAt: Date;
  updatedAt: Date;
}): SiteRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    name: row.name,
    status: row.status as SiteRecord["status"],
    homepagePageId: row.homepagePageId,
    draftVersion: row.draftVersion,
    publishedRevisionId: row.publishedRevisionId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function mapPage(row: {
  id: string;
  organizationId: string;
  siteId: string;
  title: string;
  slug: string;
  status: string;
  navigationVisible: boolean;
  sortOrder: number;
  homepage: boolean;
  createdAt: Date;
  updatedAt: Date;
}): PageRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    siteId: row.siteId,
    title: row.title,
    slug: row.slug,
    status: row.status as PageRecord["status"],
    navigationVisible: row.navigationVisible,
    sortOrder: row.sortOrder,
    homepage: row.homepage,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function mapRevision(row: {
  revisionId: string;
  siteId: string;
  organizationId: string;
  version: number;
  status: string;
  createdAt: Date;
  createdBy: string;
  snapshot: Prisma.JsonValue;
}): SiteRevision {
  return {
    revisionId: row.revisionId,
    siteId: row.siteId,
    organizationId: row.organizationId,
    version: row.version,
    status: row.status as SiteRevision["status"],
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdBy,
    snapshot: row.snapshot as SiteSnapshot,
  };
}

function mapPublication(row: {
  id: string;
  siteId: string;
  organizationId: string;
  revisionId: string;
  target: string;
  status: string;
  createdAt: Date;
  completedAt: Date | null;
  error: string | null;
}): PublicationRecord {
  return {
    id: row.id,
    siteId: row.siteId,
    organizationId: row.organizationId,
    revisionId: row.revisionId,
    target: row.target,
    status: row.status as PublicationStatus,
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
    error: row.error,
  };
}

function mapTheme(row: { id: string; organizationId: string; siteId: string; tokens: Prisma.JsonValue }): ThemeRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    siteId: row.siteId,
    tokens: row.tokens as SiteSnapshot["theme"],
  };
}

function mapAsset(row: {
  id: string;
  organizationId: string;
  siteId: string | null;
  classification: string;
  sourceSystem: string | null;
  externalAssetId: string | null;
  displayName: string;
  status: string;
  filename: string | null;
  mimeType: string | null;
  size: number | null;
  storageKey: string | null;
  createdAt: Date;
  updatedAt: Date;
}): AssetRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    siteId: row.siteId ?? "",
    classification: row.classification as AssetRecord["classification"],
    sourceSystem: row.sourceSystem,
    externalAssetId: row.externalAssetId,
    displayName: row.displayName,
    status: row.status as AssetRecord["status"],
    filename: row.filename,
    mimeType: row.mimeType,
    size: row.size,
    storageKey: row.storageKey,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function mapDomain(row: {
  id: string;
  organizationId: string;
  siteId: string;
  hostname: string;
  verificationStatus: string;
  sslStatus: string;
  publicationTarget: string | null;
}): DomainRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    siteId: row.siteId,
    hostname: row.hostname,
    verificationStatus: row.verificationStatus as DomainRecord["verificationStatus"],
    sslStatus: row.sslStatus as DomainRecord["sslStatus"],
    publicationTarget: row.publicationTarget,
  };
}

async function organizationCounts(tx: Prisma.TransactionClient | PrismaClient, organizationId: string) {
  const [sites, pages, assets, themes] = await Promise.all([
    tx.site.count({ where: { organizationId } }),
    tx.page.count({ where: { organizationId } }),
    tx.asset.count({ where: { organizationId } }),
    tx.theme.count({ where: { organizationId } }),
  ]);
  return { sites, pages, assets, themes };
}

async function requireActiveOrg(tx: Prisma.TransactionClient | PrismaClient, organizationId: string) {
  const organization = await tx.productOrganization.findFirst({ where: { id: organizationId } });

  if (!organization) {
    return { ok: false as const, reason: "not_found" as const };
  }

  if (organization.accessStatus !== "active") {
    return { ok: false as const, reason: "disabled" as const };
  }

  return { ok: true as const, organization };
}

async function loadActiveSite(tx: Prisma.TransactionClient | PrismaClient, organizationId: string, siteId: string) {
  const site = await tx.site.findFirst({
    where: { id: siteId, organizationId, status: "active" },
  });

  if (!site) {
    return { ok: false as const, reason: "not_found" as const };
  }

  return { ok: true as const, site };
}

async function syncPages(
  tx: Prisma.TransactionClient,
  organizationId: string,
  siteId: string,
  snapshot: SiteSnapshot,
) {
  const seen = new Set<string>();
  const now = new Date();

  for (const page of snapshot.pages) {
    seen.add(page.id);
    await tx.page.updateMany({
      where: { siteId, organizationId, slug: page.slug, id: { not: page.id }, status: "active" },
      data: { status: "archived", updatedAt: now },
    });
    await tx.page.upsert({
      where: { id: page.id },
      update: {
        title: page.title,
        slug: page.slug,
        sortOrder: page.sortOrder,
        navigationVisible: page.navigationVisible,
        homepage: page.homepage,
        status: "active",
        updatedAt: now,
      },
      create: {
        id: page.id,
        organizationId,
        siteId,
        title: page.title,
        slug: page.slug,
        status: "active",
        navigationVisible: page.navigationVisible,
        sortOrder: page.sortOrder,
        homepage: page.homepage,
        createdAt: now,
        updatedAt: now,
      },
    });
  }

  await tx.page.updateMany({
    where: { siteId, organizationId, id: { notIn: [...seen] } },
    data: { status: "archived", updatedAt: now },
  });

  const homepage = snapshot.pages.find((page) => page.homepage);
  await tx.site.update({
    where: { id: siteId },
    data: { homepagePageId: homepage?.id ?? null },
  });
}

export function createPostgresRepository(prisma: PrismaClient, storage: AssetStorage): FoundationRepository {
  return {
    storage,
    async provisionOrganization(input) {
      const presented = Buffer.from(input.provisioningKey);
      const expected = Buffer.from(input.expectedKey);

      if (!input.provisioningKey || !input.expectedKey || presented.length !== expected.length) {
        return { ok: false as const, reason: "provisioning_key_rejected" as const };
      }

      const { timingSafeEqual } = await import("node:crypto");

      if (!timingSafeEqual(presented, expected)) {
        return { ok: false as const, reason: "provisioning_key_rejected" as const };
      }

      const orbiaOrganizationId = input.orbiaOrganizationId.trim();

      if (!orbiaOrganizationId) {
        return { ok: false as const, reason: "missing_organization" as const };
      }

      if (input.action === "disable") {
        const existing = await prisma.productOrganization.findUnique({ where: { orbiaOrganizationId } });

        if (!existing) {
          return { ok: false as const, reason: "unknown_organization" as const };
        }

        const updated = await prisma.productOrganization.update({
          where: { id: existing.id },
          data: { accessStatus: "disabled", updatedAt: new Date() },
        });
        const sites = await prisma.site.count({ where: { organizationId: updated.id } });
        return {
          ok: true as const,
          localOrganizationId: updated.id,
          reused: true,
          status: "disabled" as const,
          seeded: false,
          sites,
        };
      }

      const existing = await prisma.productOrganization.findUnique({ where: { orbiaOrganizationId } });

      if (existing) {
        const updated = await prisma.productOrganization.update({
          where: { id: existing.id },
          data: { accessStatus: "active", updatedAt: new Date() },
        });
        const sites = await prisma.site.count({ where: { organizationId: updated.id } });
        return {
          ok: true as const,
          localOrganizationId: updated.id,
          reused: true,
          status: "active" as const,
          seeded: false,
          sites,
        };
      }

      const now = new Date();

      try {
        const created = await prisma.productOrganization.create({
          data: {
            id: createId("corg"),
            orbiaOrganizationId,
            displayName: input.displayName?.trim() || "Crevia",
            accessStatus: "active",
            createdAt: now,
            updatedAt: now,
          },
        });
        return {
          ok: true as const,
          localOrganizationId: created.id,
          reused: false,
          status: "active" as const,
          seeded: false,
          sites: 0,
        };
      } catch (error) {
        if (!isUniqueViolation(error)) {
          throw error;
        }

        const raced = await prisma.productOrganization.findUnique({ where: { orbiaOrganizationId } });

        if (!raced) {
          throw error;
        }

        const updated = await prisma.productOrganization.update({
          where: { id: raced.id },
          data: { accessStatus: "active", updatedAt: new Date() },
        });
        const sites = await prisma.site.count({ where: { organizationId: updated.id } });
        return {
          ok: true as const,
          localOrganizationId: updated.id,
          reused: true,
          status: "active" as const,
          seeded: false,
          sites,
        };
      }
    },
    async findOrganizationByOrbiaId(orbiaOrganizationId) {
      const row = await prisma.productOrganization.findUnique({ where: { orbiaOrganizationId } });

      if (!row) {
        return null;
      }

      return mapOrganization(row, await organizationCounts(prisma, row.id));
    },
    async findOrganizationById(organizationId) {
      const row = await prisma.productOrganization.findUnique({ where: { id: organizationId } });

      if (!row) {
        return null;
      }

      return mapOrganization(row, await organizationCounts(prisma, row.id));
    },
    async createSite(input) {
      if (!input.modules.includes("crevia.sites")) {
        return { ok: false as const, reason: "module_disabled" as const };
      }

      const name = input.name.trim();

      if (!name) {
        return { ok: false as const, reason: "invalid_site" as const };
      }

      return prisma.$transaction(async (tx) => {
        const organization = await requireActiveOrg(tx, input.organizationId);

        if (!organization.ok) {
          return organization;
        }

        const now = nowDate(input.now);
        const siteId = createId("site");
        const revisionId = createId("rev");
        const site = await tx.site.create({
          data: {
            id: siteId,
            organizationId: organization.organization.id,
            name,
            status: "active",
            homepagePageId: null,
            draftVersion: 1,
            publishedRevisionId: null,
            createdAt: now,
            updatedAt: now,
          },
        });
        const revision = await tx.siteRevision.create({
          data: {
            revisionId,
            siteId: site.id,
            organizationId: site.organizationId,
            version: 1,
            status: "DRAFT",
            createdAt: now,
            createdBy: input.createdBy,
            snapshot: emptySnapshot() as unknown as Prisma.InputJsonValue,
          },
        });
        return { ok: true as const, site: mapSite(site), revision: mapRevision(revision) };
      });
    },
    async readSite(organizationId, siteId) {
      const site = await loadActiveSite(prisma, organizationId, siteId);
      return site.ok ? { ok: true as const, site: mapSite(site.site) } : site;
    },
    async listSites(organizationId) {
      const rows = await prisma.site.findMany({
        where: { organizationId, status: "active" },
        orderBy: { createdAt: "asc" },
      });
      return rows.map(mapSite);
    },
    async archiveSite(organizationId, siteId, modules) {
      if (!modules.includes("crevia.sites")) {
        return { ok: false as const, reason: "module_disabled" as const };
      }

      const site = await prisma.site.findFirst({ where: { id: siteId, organizationId } });

      if (!site) {
        return { ok: false as const, reason: "not_found" as const };
      }

      const updated = await prisma.site.update({
        where: { id: site.id },
        data: { status: "archived", updatedAt: new Date() },
      });
      const revisionsKept = await prisma.siteRevision.count({ where: { siteId: site.id } });
      return { ok: true as const, site: mapSite(updated), revisionsKept };
    },
    async createPage(input) {
      if (!input.modules.includes("crevia.pages")) {
        return { ok: false as const, reason: "module_disabled" as const };
      }

      const slug = input.slug.trim();

      if (!slug) {
        return { ok: false as const, reason: "invalid_page" as const };
      }

      try {
        return await prisma.$transaction(async (tx) => {
          const organization = await requireActiveOrg(tx, input.organizationId);

          if (!organization.ok) {
            return organization;
          }

          const site = await loadActiveSite(tx, input.organizationId, input.siteId);

          if (!site.ok) {
            return site;
          }

          const duplicate = await tx.page.findFirst({
            where: { siteId: site.site.id, slug, status: "active" },
          });

          if (duplicate) {
            return { ok: false as const, reason: "invalid_page" as const };
          }

          const now = new Date();

          if (input.homepage) {
            await tx.page.updateMany({
              where: { siteId: site.site.id, organizationId: input.organizationId },
              data: { homepage: false, updatedAt: now },
            });
          }

          const page = await tx.page.create({
            data: {
              id: createId("page"),
              organizationId: input.organizationId,
              siteId: site.site.id,
              title: input.title.trim(),
              slug,
              status: "active",
              navigationVisible: input.navigationVisible,
              sortOrder: input.sortOrder,
              homepage: input.homepage === true,
              createdAt: now,
              updatedAt: now,
            },
          });

          if (page.homepage) {
            await tx.site.update({
              where: { id: site.site.id },
              data: { homepagePageId: page.id, updatedAt: now },
            });
          }

          return { ok: true as const, page: mapPage(page) };
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          return { ok: false as const, reason: "invalid_page" as const };
        }

        throw error;
      }
    },
    async archivePage(organizationId, pageId) {
      const page = await prisma.page.findFirst({ where: { id: pageId, organizationId } });

      if (!page) {
        return { ok: false as const, reason: "not_found" as const };
      }

      const updated = await prisma.page.update({
        where: { id: page.id },
        data: { status: "archived", updatedAt: new Date() },
      });
      return { ok: true as const, page: mapPage(updated) };
    },
    async saveDraft(input) {
      if (!input.modules.includes("crevia.builder")) {
        return { ok: false as const, reason: "module_disabled" as const };
      }

      const inspected = inspectSnapshot(input.snapshot);

      if (inspected) {
        return { ok: false as const, reason: inspected };
      }

      return prisma.$transaction(async (tx) => {
        const organization = await requireActiveOrg(tx, input.organizationId);

        if (!organization.ok) {
          return organization;
        }

        const guarded = await tx.site.updateMany({
          where: {
            id: input.siteId,
            organizationId: input.organizationId,
            status: "active",
            draftVersion: input.expectedVersion,
          },
          data: {
            draftVersion: { increment: 1 },
            updatedAt: nowDate(input.now),
          },
        });

        if (guarded.count !== 1) {
          const current = await tx.site.findFirst({
            where: { id: input.siteId, organizationId: input.organizationId },
          });

          if (!current || current.status !== "active") {
            return { ok: false as const, reason: "not_found" as const };
          }

          return {
            ok: false as const,
            reason: "conflict" as const,
            status: 409 as const,
            currentVersion: current.draftVersion,
          };
        }

        const site = await tx.site.findFirstOrThrow({
          where: { id: input.siteId, organizationId: input.organizationId },
        });
        const now = nowDate(input.now);
        const revision = await tx.siteRevision.create({
          data: {
            revisionId: createId("rev"),
            siteId: site.id,
            organizationId: site.organizationId,
            version: site.draftVersion,
            status: "DRAFT",
            createdAt: now,
            createdBy: input.createdBy,
            snapshot: structuredClone(input.snapshot) as unknown as Prisma.InputJsonValue,
          },
        });
        await syncPages(tx, site.organizationId, site.id, input.snapshot);
        return {
          ok: true as const,
          revision: mapRevision(revision),
          publishedRevisionId: site.publishedRevisionId,
        };
      });
    },
    async latestDraft(organizationId, siteId) {
      const site = await loadActiveSite(prisma, organizationId, siteId);

      if (!site.ok) {
        return site;
      }

      const revision = await prisma.siteRevision.findFirst({
        where: { siteId: site.site.id, organizationId, version: site.site.draftVersion },
      });

      if (!revision) {
        return { ok: false as const, reason: "not_found" as const };
      }

      return { ok: true as const, site: mapSite(site.site), revision: mapRevision(revision) };
    },
    async publishSite(input) {
      if (!input.modules.includes("crevia.publishing")) {
        return { ok: false as const, reason: "module_disabled" as const };
      }

      return prisma.$transaction(async (tx) => {
        const organization = await requireActiveOrg(tx, input.organizationId);

        if (!organization.ok) {
          return organization;
        }

        const site = await loadActiveSite(tx, input.organizationId, input.siteId);

        if (!site.ok) {
          return site;
        }

        const revision = await tx.siteRevision.findFirst({
          where: {
            revisionId: input.revisionId,
            siteId: site.site.id,
            organizationId: input.organizationId,
          },
        });

        if (!revision) {
          return { ok: false as const, reason: "not_found" as const };
        }

        const now = nowDate(input.now);
        const published = await tx.siteRevision.update({
          where: { revisionId: revision.revisionId },
          data: { status: "PUBLISHED" },
        });
        const publication = await tx.publication.create({
          data: {
            id: createId("pub"),
            siteId: site.site.id,
            organizationId: input.organizationId,
            revisionId: revision.revisionId,
            target: input.target,
            status: "PUBLISHED",
            createdAt: now,
            completedAt: now,
            error: null,
          },
        });
        await tx.site.update({
          where: { id: site.site.id },
          data: { publishedRevisionId: revision.revisionId, updatedAt: now },
        });
        return {
          ok: true as const,
          publication: mapPublication(publication),
          published: mapRevision(published),
        };
      });
    },
    async publishedOutput(organizationId, siteId) {
      const site = await prisma.site.findFirst({ where: { id: siteId, organizationId } });

      if (!site || !site.publishedRevisionId) {
        return { ok: false as const, reason: "not_found" as const };
      }

      const revision = await prisma.siteRevision.findFirst({
        where: { revisionId: site.publishedRevisionId, organizationId, status: "PUBLISHED" },
      });

      if (!revision) {
        return { ok: false as const, reason: "not_found" as const };
      }

      return { ok: true as const, revision: mapRevision(revision) };
    },
    async publicPublishedRender(siteId) {
      const site = await prisma.site.findFirst({
        where: { id: siteId, status: "active" },
      });

      if (!site || !site.publishedRevisionId) {
        return { ok: false as const, reason: "not_found" as const };
      }

      const revision = await prisma.siteRevision.findFirst({
        where: { revisionId: site.publishedRevisionId, status: "PUBLISHED" },
      });

      if (!revision) {
        return { ok: false as const, reason: "not_found" as const };
      }

      return {
        ok: true as const,
        siteId: site.id,
        revisionId: revision.revisionId,
        version: revision.version,
        snapshot: revision.snapshot as SiteSnapshot,
      };
    },
    async issuePreviewToken(input) {
      const revision = await prisma.siteRevision.findFirst({
        where: {
          revisionId: input.revisionId,
          siteId: input.siteId,
          organizationId: input.organizationId,
        },
      });

      if (!revision) {
        return { ok: false as const, reason: "not_found" as const };
      }

      if (input.kind === "published" && revision.status !== "PUBLISHED") {
        return { ok: false as const, reason: "draft_not_public" as const };
      }

      const token = randomBytes(24).toString("base64url");
      const now = new Date();
      await prisma.previewToken.create({
        data: {
          id: createId("pvt"),
          tokenHash: hashToken(token),
          organizationId: input.organizationId,
          siteId: input.siteId,
          revisionId: input.revisionId,
          kind: input.kind,
          createdAt: now,
          expiresAt: new Date(now.getTime() + PREVIEW_TTL_MS),
        },
      });
      return { ok: true as const, token };
    },
    async readPreview(input) {
      const match = await prisma.previewToken.findUnique({
        where: { tokenHash: hashToken(input.token) },
      });

      if (!match || match.organizationId !== input.organizationId || match.expiresAt.getTime() <= Date.now()) {
        return { ok: false as const, reason: "not_found" as const };
      }

      const revision = await prisma.siteRevision.findFirst({
        where: { revisionId: match.revisionId, organizationId: input.organizationId },
      });

      if (!revision) {
        return { ok: false as const, reason: "not_found" as const };
      }

      return {
        ok: true as const,
        kind: match.kind as "editor" | "draft" | "published",
        revision: mapRevision(revision),
      };
    },
    async saveAsset(input: SaveAssetInput) {
      if (!input.modules.includes("crevia.assets")) {
        return { ok: false as const, reason: "module_disabled" as const };
      }

      if (input.classification !== "CREVIA_WEBSITE_ASSET" && (!input.sourceSystem || !input.externalAssetId)) {
        return { ok: false as const, reason: "external_reference_required" as const };
      }

      if (input.classification !== "CREVIA_WEBSITE_ASSET" && input.bytes) {
        return { ok: false as const, reason: "bytes_not_allowed" as const };
      }

      let storageKey: string | null = null;
      const assetId = createId("asset");

      if (input.bytes) {
        const filename = input.filename ?? "file";
        const mimeType = input.mimeType ?? "application/octet-stream";
        const invalid = validateUpload({ filename, mimeType, size: input.bytes.byteLength });

        if (invalid) {
          return { ok: false as const, reason: invalid };
        }

        storageKey = buildAssetStorageKey({
          organizationId: input.organizationId,
          siteId: input.siteId,
          assetId,
          filename,
        });
        await storage.put(storageKey, input.bytes);
      }

      try {
        return await prisma.$transaction(async (tx) => {
          const organization = await requireActiveOrg(tx, input.organizationId);

          if (!organization.ok) {
            return organization;
          }

          const site = await loadActiveSite(tx, input.organizationId, input.siteId);

          if (!site.ok) {
            return site;
          }

          const now = new Date();
          const asset = await tx.asset.create({
            data: {
              id: assetId,
              organizationId: input.organizationId,
              siteId: site.site.id,
              classification: input.classification,
              sourceSystem: input.sourceSystem,
              externalAssetId: input.externalAssetId,
              displayName: input.displayName,
              filename: input.filename ?? null,
              mimeType: input.mimeType ?? null,
              size: input.bytes?.byteLength ?? null,
              storageKey,
              status: "active",
              createdAt: now,
              updatedAt: now,
            },
          });
          return { ok: true as const, asset: mapAsset(asset) };
        });
      } catch (error) {
        if (storageKey) {
          await storage.delete(storageKey);
        }

        throw error;
      }
    },
    async readAsset(organizationId, assetId) {
      const asset = await prisma.asset.findFirst({
        where: { id: assetId, organizationId, status: "active" },
      });

      if (!asset) {
        return { ok: false as const, reason: "not_found" as const };
      }

      return { ok: true as const, asset: mapAsset(asset) };
    },
    async listAssets(organizationId, siteId) {
      const rows = await prisma.asset.findMany({
        where: { organizationId, siteId, status: "active" },
        orderBy: { createdAt: "asc" },
      });
      return rows.map(mapAsset);
    },
    async archiveAsset(organizationId, assetId, modules) {
      if (!modules.includes("crevia.assets")) {
        return { ok: false as const, reason: "module_disabled" as const };
      }

      const asset = await prisma.asset.findFirst({ where: { id: assetId, organizationId } });

      if (!asset) {
        return { ok: false as const, reason: "not_found" as const };
      }

      const updated = await prisma.asset.update({
        where: { id: asset.id },
        data: { status: "archived", updatedAt: new Date() },
      });

      if (updated.storageKey && storageKeyBelongsTo(organizationId, updated.storageKey)) {
        await storage.delete(updated.storageKey);
      }

      return { ok: true as const, asset: mapAsset(updated) };
    },
    async readAssetBytes(organizationId, assetId) {
      const asset = await prisma.asset.findFirst({
        where: { id: assetId, organizationId, status: "active" },
      });

      if (!asset || !asset.storageKey || !storageKeyBelongsTo(organizationId, asset.storageKey)) {
        return { ok: false as const, reason: "not_found" as const };
      }

      const bytes = await storage.get(asset.storageKey);

      if (!bytes) {
        return { ok: false as const, reason: "storage_missing" as const };
      }

      return { ok: true as const, bytes, asset: mapAsset(asset) };
    },
    async updateTheme(input) {
      if (!input.modules.includes("crevia.themes")) {
        return { ok: false as const, reason: "module_disabled" as const };
      }

      return prisma.$transaction(async (tx) => {
        const organization = await requireActiveOrg(tx, input.organizationId);

        if (!organization.ok) {
          return organization;
        }

        const site = await loadActiveSite(tx, input.organizationId, input.siteId);

        if (!site.ok) {
          return site;
        }

        const now = new Date();
        const theme = await tx.theme.upsert({
          where: {
            organizationId_siteId: {
              organizationId: input.organizationId,
              siteId: site.site.id,
            },
          },
          update: { tokens: input.tokens as unknown as Prisma.InputJsonValue, updatedAt: now },
          create: {
            id: createId("theme"),
            organizationId: input.organizationId,
            siteId: site.site.id,
            tokens: input.tokens as unknown as Prisma.InputJsonValue,
            createdAt: now,
            updatedAt: now,
          },
        });
        return { ok: true as const, theme: mapTheme(theme) };
      });
    },
    async readTheme(organizationId, siteId) {
      const theme = await prisma.theme.findFirst({ where: { organizationId, siteId } });

      if (!theme) {
        return { ok: false as const, reason: "not_found" as const };
      }

      return { ok: true as const, theme: mapTheme(theme) };
    },
    async saveDomain(input) {
      if (!input.modules.includes("crevia.domains")) {
        return { ok: false as const, reason: "module_disabled" as const };
      }

      const hostname = input.hostname.trim().toLowerCase();

      if (!hostname || hostname.includes("://") || hostname.includes("/")) {
        return { ok: false as const, reason: "invalid_hostname" as const };
      }

      return prisma.$transaction(async (tx) => {
        const organization = await requireActiveOrg(tx, input.organizationId);

        if (!organization.ok) {
          return organization;
        }

        const site = await loadActiveSite(tx, input.organizationId, input.siteId);

        if (!site.ok) {
          return site;
        }

        const domain = await tx.domain.create({
          data: {
            id: createId("domain"),
            organizationId: input.organizationId,
            siteId: site.site.id,
            hostname,
            verificationStatus: "unverified",
            sslStatus: "none",
            publicationTarget: null,
            createdAt: new Date(),
          },
        });
        return { ok: true as const, domain: mapDomain(domain), dnsMutated: false as const };
      });
    },
    async latestPublication(organizationId, siteId) {
      const row = await prisma.publication.findFirst({
        where: { organizationId, siteId },
        orderBy: { createdAt: "desc" },
      });
      return row ? mapPublication(row) : null;
    },
    async health() {
      try {
        await Promise.race([
          prisma.$queryRaw`SELECT 1`,
          new Promise((_, reject) => {
            setTimeout(() => reject(new Error("database_health_timeout")), 2000);
          }),
        ]);
        return { ok: true, state: "ok" };
      } catch {
        return { ok: false, state: "down" };
      }
    },
    async migrationHealth() {
      try {
        const rows = await Promise.race([
          prisma.$queryRaw<Array<{ finished_at: Date | null }>>`
            SELECT finished_at FROM "_prisma_migrations" ORDER BY finished_at DESC NULLS LAST LIMIT 1
          `,
          new Promise<Array<{ finished_at: Date | null }>>((_, reject) => {
            setTimeout(() => reject(new Error("migration_health_timeout")), 2000);
          }),
        ]);
        return rows[0]?.finished_at ? { ok: true, state: "ok" } : { ok: false, state: "down" };
      } catch {
        return { ok: false, state: "down" };
      }
    },
    async tableCounts(): Promise<TableCounts> {
      const [organizations, sites, pages, revisions, publications, assets, themes, sessions, previews] = await Promise.all([
        prisma.productOrganization.count(),
        prisma.site.count(),
        prisma.page.count(),
        prisma.siteRevision.count(),
        prisma.publication.count(),
        prisma.asset.count(),
        prisma.theme.count(),
        prisma.productSession.count(),
        prisma.previewToken.count(),
      ]);
      return { organizations, sites, pages, revisions, publications, assets, themes, sessions, previews };
    },
    async disconnect() {
      await prisma.$disconnect();
    },
  };
}
