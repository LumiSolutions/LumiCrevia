import type { PrismaClient } from "@prisma/client";

import type { CreviaCapability, CreviaModuleKey, OrbiaMembershipRole } from "./contract.js";
import { hashToken, type SessionStore, type StoredSession } from "./identity.js";

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function toSession(row: {
  id: string;
  tokenHash: string;
  orbiaUserId: string;
  orbiaOrganizationId: string;
  creviaOrganizationId: string;
  membershipRole: string;
  modules: unknown;
  capabilities: unknown;
  evaluatedAt: Date;
  expiresAt: Date;
  createdAt: Date;
  revokedAt: Date | null;
}): StoredSession {
  return {
    id: row.id,
    tokenHash: row.tokenHash,
    orbiaUserId: row.orbiaUserId,
    orbiaOrganizationId: row.orbiaOrganizationId,
    creviaOrganizationId: row.creviaOrganizationId,
    membershipRole: row.membershipRole as OrbiaMembershipRole,
    modules: asStringArray(row.modules) as CreviaModuleKey[],
    capabilities: asStringArray(row.capabilities) as CreviaCapability[],
    evaluatedAt: row.evaluatedAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    revokedAt: row.revokedAt?.toISOString() ?? null,
  };
}

export function createPostgresSessionStore(prisma: PrismaClient): SessionStore {
  return {
    async save(session) {
      await prisma.productSession.upsert({
        where: { tokenHash: session.tokenHash },
        create: {
          id: session.id,
          tokenHash: session.tokenHash,
          orbiaUserId: session.orbiaUserId,
          orbiaOrganizationId: session.orbiaOrganizationId,
          creviaOrganizationId: session.creviaOrganizationId,
          membershipRole: session.membershipRole,
          modules: session.modules,
          capabilities: session.capabilities,
          evaluatedAt: new Date(session.evaluatedAt),
          expiresAt: new Date(session.expiresAt),
          createdAt: new Date(session.createdAt ?? session.evaluatedAt),
          revokedAt: session.revokedAt ? new Date(session.revokedAt) : null,
        },
        update: {
          revokedAt: session.revokedAt ? new Date(session.revokedAt) : null,
          expiresAt: new Date(session.expiresAt),
          modules: session.modules,
          capabilities: session.capabilities,
          evaluatedAt: new Date(session.evaluatedAt),
        },
      });
    },
    async find(token) {
      const row = await prisma.productSession.findUnique({
        where: { tokenHash: hashToken(token) },
      });
      return row ? toSession(row) : null;
    },
    async values() {
      const rows = await prisma.productSession.findMany();
      return rows.map(toSession);
    },
  };
}
