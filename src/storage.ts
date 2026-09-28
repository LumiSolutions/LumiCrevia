import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";

export type AssetStorage = {
  put(key: string, bytes: Buffer): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  health(): Promise<{ ok: boolean; state: "ok" | "down" }>;
};

const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export const CREVIA_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;

export const ALLOWED_ASSET_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "application/pdf",
  "video/mp4",
  "audio/mpeg",
  "text/plain",
  "text/css",
]);

const REJECTED_EXTENSIONS = new Set([
  "svg",
  "js",
  "mjs",
  "cjs",
  "ts",
  "tsx",
  "jsx",
  "html",
  "htm",
  "shtml",
  "xhtml",
  "php",
  "sh",
  "bash",
  "zsh",
  "exe",
  "bat",
  "cmd",
  "com",
  "msi",
  "dll",
  "wasm",
  "py",
  "rb",
  "pl",
  "ps1",
]);

export type UploadValidationFailure =
  | "invalid_filename"
  | "invalid_mime"
  | "asset_too_large"
  | "svg_rejected"
  | "executable_rejected";

export function sanitizeFilename(filename: string): string {
  const base = filename.replace(/\\/g, "/").split("/").pop()?.trim() ?? "";
  const cleaned = base.replace(/[^A-Za-z0-9._-]/g, "_").replace(/^\.+/, "").slice(0, 120);
  return cleaned || "file";
}

export function fileExtension(filename: string): string {
  const match = sanitizeFilename(filename).match(/\.([A-Za-z0-9]+)$/);
  return match?.[1]?.toLowerCase() ?? "";
}

export function validateUpload(input: { filename: string; mimeType: string; size: number }): UploadValidationFailure | null {
  const filename = input.filename.trim();

  if (!filename || filename.includes("\0") || filename.includes("..") || filename.includes("/") || filename.includes("\\")) {
    return "invalid_filename";
  }

  const extension = fileExtension(filename);
  const mime = input.mimeType.trim().toLowerCase();

  if (mime === "image/svg+xml" || extension === "svg") {
    return "svg_rejected";
  }

  if (REJECTED_EXTENSIONS.has(extension) || mime === "application/javascript" || mime === "text/javascript" || mime === "text/html") {
    return "executable_rejected";
  }

  if (!ALLOWED_ASSET_MIME_TYPES.has(mime)) {
    return "invalid_mime";
  }

  if (!Number.isFinite(input.size) || input.size <= 0 || input.size > CREVIA_UPLOAD_MAX_BYTES) {
    return "asset_too_large";
  }

  return null;
}

export function assertSafeId(value: string, label: string): string {
  if (!ID_PATTERN.test(value)) {
    throw new Error(`invalid_${label}`);
  }

  return value;
}

export function buildAssetStorageKey(input: {
  organizationId: string;
  siteId: string;
  assetId: string;
  filename: string;
}): string {
  const organizationId = assertSafeId(input.organizationId, "organization");
  const siteId = assertSafeId(input.siteId, "site");
  const assetId = assertSafeId(input.assetId, "asset");
  const filename = sanitizeFilename(input.filename);
  return `organizations/${organizationId}/sites/${siteId}/assets/${assetId}/${filename}`;
}

export function parseAssetStorageKey(key: string): { organizationId: string; siteId: string; assetId: string } | null {
  const parts = key.split("/");

  if (parts.length < 7 || parts[0] !== "organizations" || parts[2] !== "sites" || parts[4] !== "assets") {
    return null;
  }

  const organizationId = parts[1];
  const siteId = parts[3];
  const assetId = parts[5];

  if (!organizationId || !siteId || !assetId) {
    return null;
  }

  try {
    return {
      organizationId: assertSafeId(organizationId, "organization"),
      siteId: assertSafeId(siteId, "site"),
      assetId: assertSafeId(assetId, "asset"),
    };
  } catch {
    return null;
  }
}

export function storageKeyBelongsTo(organizationId: string, key: string): boolean {
  const parsed = parseAssetStorageKey(key);
  return parsed?.organizationId === organizationId;
}

export function assertRelativeKey(key: string): string {
  if (!key || key.includes("\0") || key.includes("..") || key.startsWith("/") || key.startsWith("\\") || key.includes("://")) {
    throw new Error("invalid_storage_key");
  }

  const parts = key.split("/");

  if (parts.some((part) => part === "" || part === "." || part === "..")) {
    throw new Error("invalid_storage_key");
  }

  return key;
}

export function assertRuntimeStorageKey(key: string): string {
  const safe = assertRelativeKey(key);

  if (safe.startsWith("_health/")) {
    return safe;
  }

  if (!safe.startsWith("organizations/")) {
    throw new Error("invalid_storage_key");
  }

  return safe;
}

export function createUnconfiguredAssetStorage(): AssetStorage {
  return {
    async put() {
      throw new Error("asset_storage_unconfigured");
    },
    async get() {
      return null;
    },
    async delete() {
      return;
    },
    async exists() {
      return false;
    },
    async health() {
      return { ok: false, state: "down" as const };
    },
  };
}

export function defaultAssetStoragePath(appEnv: string): string {
  if (appEnv === "LOCAL" || appEnv === "TEST") {
    return resolve(process.cwd(), "var", "crevia-assets");
  }

  return "";
}

export function createLocalFilesystemAssetStorage(root: string): AssetStorage {
  const resolvedRoot = resolve(root);

  if (!resolvedRoot) {
    throw new Error("asset_storage_path_required");
  }

  function resolveKey(key: string): string {
    const safe = assertRelativeKey(key);
    const target = resolve(resolvedRoot, safe);
    const rel = relative(resolvedRoot, target);

    if (!rel || rel.startsWith("..") || rel.split(sep).includes("..")) {
      throw new Error("invalid_storage_key");
    }

    return target;
  }

  return {
    async put(key, bytes) {
      const target = resolveKey(key);
      const directory = dirname(target);
      await mkdir(directory, { recursive: true });
      const temp = join(directory, `.tmp-${randomBytes(8).toString("hex")}`);
      await writeFile(temp, bytes);

      try {
        await rename(temp, target);
      } catch (error) {
        await rm(temp, { force: true });
        throw error;
      }
    },
    async get(key) {
      try {
        return await readFile(resolveKey(key));
      } catch {
        return null;
      }
    },
    async delete(key) {
      await rm(resolveKey(key), { force: true });
    },
    async exists(key) {
      try {
        await stat(resolveKey(key));
        return true;
      } catch {
        return false;
      }
    },
    async health() {
      try {
        await mkdir(resolvedRoot, { recursive: true });
        const probe = join(resolvedRoot, `.health-${randomBytes(6).toString("hex")}`);
        await writeFile(probe, "ok");
        await rm(probe, { force: true });
        return { ok: true, state: "ok" as const };
      } catch {
        return { ok: false, state: "down" as const };
      }
    },
  };
}

export function hashBytes(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}
