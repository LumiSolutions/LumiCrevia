import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { PrismaClient } from "@prisma/client";

import { createPostgresRepository } from "../../src/postgres-repository.ts";
import { createPostgresSessionStore } from "../../src/postgres-sessions.ts";
import { createLocalFilesystemAssetStorage } from "../../src/storage.ts";
import { BUILDER_MODULES } from "../../src/builder/fixtures.ts";

const execFileAsync = promisify(execFile);

export const TEST_DATABASE_URL =
  process.env.CREVIA_TEST_DATABASE_URL?.trim() ||
  "postgresql://crevia:crevia_local_only@127.0.0.1:5432/crevia_test";

export const RESTORE_DATABASE_URL =
  process.env.CREVIA_RESTORE_DATABASE_URL?.trim() ||
  "postgresql://crevia:crevia_local_only@127.0.0.1:5432/crevia_restore";

export const MODULES = BUILDER_MODULES;

export async function createTestPrisma(url = TEST_DATABASE_URL): Promise<PrismaClient> {
  const prisma = new PrismaClient({ datasources: { db: { url } }, log: [] });
  await prisma.$connect();
  return prisma;
}

export async function resetDatabase(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "ProductSession",
      "PreviewToken",
      "Asset",
      "Theme",
      "Domain",
      "Publication",
      "SiteRevision",
      "Page",
      "Site",
      "ProductOrganization"
    RESTART IDENTITY CASCADE
  `);
}

const TEST_LOCK = 7_462_821;

export async function createPersistenceHarness() {
  const lock = await createTestPrisma();
  await lock.$executeRaw`SELECT pg_advisory_lock(${TEST_LOCK})`;
  const prisma = await createTestPrisma();
  await resetDatabase(prisma);
  const root = await mkdtemp(join(tmpdir(), "crevia-assets-"));
  const storage = createLocalFilesystemAssetStorage(root);
  const repository = createPostgresRepository(prisma, storage);
  const sessions = createPostgresSessionStore(prisma);
  return {
    prisma,
    storage,
    repository,
    sessions,
    root,
    async cleanup() {
      try {
        await prisma.$disconnect();
      } catch {
        // already closed by a restart test
      }

      await rm(root, { recursive: true, force: true });
      await lock.$executeRaw`SELECT pg_advisory_unlock(${TEST_LOCK})`;
      await lock.$disconnect();
    },
  };
}

export async function dumpDatabase(url: string, file: string): Promise<void> {
  const parsed = new URL(url);
  await execFileAsync("pg_dump", ["-Fc", "-f", file, url], {
    env: { ...process.env, PGPASSWORD: decodeURIComponent(parsed.password) },
  });
}

export async function restoreDatabase(url: string, file: string): Promise<void> {
  const parsed = new URL(url);
  await execFileAsync(
    "pg_restore",
    ["--clean", "--if-exists", "--no-owner", "--dbname", url, file],
    { env: { ...process.env, PGPASSWORD: decodeURIComponent(parsed.password) } },
  );
}
