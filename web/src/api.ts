export type ApiError = { ok: false; reason?: string; currentVersion?: number };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  return (await response.json()) as T;
}

export function openFixture() {
  return request<{ ok: boolean; siteId?: string; organizationId?: string; reason?: string }>("/api/dev/fixture", {
    method: "POST",
    body: "{}",
  });
}

export function listSites() {
  return request<{ ok: boolean; sites: Array<{ id: string; name: string; draftVersion: number; publishedRevisionId: string | null }> }>(
    "/api/sites",
  );
}

export function loadSite(siteId: string) {
  return request<{
    ok: boolean;
    reason?: string;
    site: { id: string; name: string; draftVersion: number; publishedRevisionId: string | null; organizationId: string };
    draft: { revisionId: string; version: number; snapshot: import("../../src/validation.ts").SiteSnapshot } | null;
    publication: { status: string; revisionId: string } | null;
    assets: Array<{ id: string; displayName: string; classification: string; sourceSystem: string | null }>;
  }>(`/api/sites/${siteId}`);
}

export function saveDraft(siteId: string, expectedVersion: number, snapshot: unknown) {
  return request<{ ok: boolean; reason?: string; currentVersion?: number; revision?: { version: number } }>(
    `/api/sites/${siteId}/draft`,
    { method: "POST", body: JSON.stringify({ expectedVersion, snapshot }) },
  );
}

export function publishSite(siteId: string) {
  return request<{ ok: boolean; publication?: { status: string }; reason?: string }>(`/api/sites/${siteId}/publish`, {
    method: "POST",
    body: "{}",
  });
}

export function issuePreviewToken(siteId: string, kind: "draft" | "published") {
  return request<{ ok: boolean; token?: string; reason?: string }>(`/api/sites/${siteId}/preview-token`, {
    method: "POST",
    body: JSON.stringify({ kind }),
  });
}
