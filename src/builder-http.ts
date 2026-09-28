import { existsSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";

import { BUILDER_MODULES, createBuilderFixtureOn, FIXTURE_ORBIA_ORG, FIXTURE_USER } from "./builder/fixtures.js";
import { pageFromSnapshot, renderPage } from "./builder/render.js";
import {
  authenticateLocalSession,
  authenticateProductRequest,
  authorizeSensitiveWrite,
  openLocalSession,
  type ProductContext,
} from "./identity.js";
import type { HttpResponse, ServerDeps } from "./http-types.js";
import { inspectSnapshot, type SiteSnapshot } from "./validation.js";

function json(status: number, body: unknown, headers: Record<string, string> = {}): HttpResponse {
  return {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
    body,
  };
}

const WEB_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
};

function serveWeb(path: string): HttpResponse {
  const root = join(process.cwd(), "dist/web");
  const requested = path.startsWith("/assets/") ? path.slice(1) : "index.html";
  const file = join(root, requested);

  if (existsSync(file)) {
    const type = WEB_TYPES[extname(file)] ?? "application/octet-stream";
    return { status: 200, headers: { "content-type": type }, body: readFileSync(file) };
  }

  return html(
    200,
    `<!doctype html><html><body style="font:14px/1.5 sans-serif;padding:40px">
      <h1>Crevia builder</h1>
      <p>The visual client is not built yet. Run <code>npm run build:web</code>.</p>
    </body></html>`,
  );
}

function html(status: number, body: string): HttpResponse {
  return {
    status,
    headers: { "content-type": "text/html; charset=utf-8" },
    body,
  };
}

async function authenticate(deps: ServerDeps, cookie: string) {
  const local = await authenticateLocalSession({
    cookieHeader: cookie,
    appEnv: deps.appEnv,
    sessions: deps.sessions,
  });

  if (local.ok) {
    return local;
  }

  return authenticateProductRequest({
    cookieHeader: cookie,
    mode: deps.identityMode,
    sessions: deps.sessions,
  });
}

function hasModule(context: ProductContext, key: ProductContext["modules"][number]) {
  return context.modules.includes(key);
}

async function siteOwned(deps: ServerDeps, context: ProductContext, siteId: string) {
  const site = await deps.repository.readSite(context.creviaOrganizationId, siteId);

  if (!site.ok) {
    return { ok: false as const, reason: "not_found" as const };
  }

  if (site.site.organizationId !== context.creviaOrganizationId) {
    return { ok: false as const, reason: "not_found" as const };
  }

  return site;
}

export async function handleBuilderRequest(
  input: { method: string; path: string; headers: Record<string, string | undefined>; body?: unknown },
  deps: ServerDeps,
): Promise<HttpResponse | null> {
  const url = new URL(input.path, "http://crevia.local");
  const path = url.pathname;

  if (input.method === "GET" && (path === "/" || path === "/app" || path.startsWith("/app/") || path.startsWith("/assets/"))) {
    if (deps.identityMode === "infrastructure") {
      return json(403, { ok: false, reason: "infrastructure_mode" });
    }

    return serveWeb(path);
  }

  if (input.method === "POST" && path === "/api/dev/fixture") {
    if (deps.identityMode === "infrastructure" || (deps.appEnv !== "LOCAL" && deps.appEnv !== "TEST")) {
      return json(403, { ok: false, reason: "dev_actor_forbidden" });
    }

    const fixture = await createBuilderFixtureOn(deps.repository, deps.provisioningKey);

    if (!fixture.ok) {
      return json(403, fixture);
    }

    const opened = await openLocalSession({
      sessions: deps.sessions,
      appEnv: deps.appEnv,
      orbiaUserId: FIXTURE_USER,
      orbiaOrganizationId: FIXTURE_ORBIA_ORG,
      creviaOrganizationId: fixture.organizationId,
      membershipRole: "admin",
      modules: BUILDER_MODULES,
      secure: deps.secureCookies,
    });

    if (!opened.ok) {
      return json(403, opened);
    }

    return json(200, { ...fixture, context: opened.context }, { "set-cookie": opened.cookie });
  }

  if (input.method === "GET" && path === "/api/sites") {
    const session = await authenticate(deps, input.headers.cookie ?? "");

    if (!session.ok) {
      return json(401, session);
    }

    if (!hasModule(session.context, "crevia.sites")) {
      return json(403, { ok: false, reason: "module_disabled" });
    }

    return json(200, { ok: true, sites: await deps.repository.listSites(session.context.creviaOrganizationId) });
  }

  const siteMatch = path.match(/^\/api\/sites\/([^/]+)$/);

  if (input.method === "GET" && siteMatch) {
    const session = await authenticate(deps, input.headers.cookie ?? "");

    if (!session.ok) {
      return json(401, session);
    }

    const site = await siteOwned(deps, session.context, decodeURIComponent(siteMatch[1]!));

    if (!site.ok) {
      return json(404, site);
    }

    const draft = await deps.repository.latestDraft(session.context.creviaOrganizationId, site.site.id);
    return json(200, {
      ok: true,
      site: site.site,
      draft: draft.ok ? draft.revision : null,
      publication: await deps.repository.latestPublication(session.context.creviaOrganizationId, site.site.id),
      assets: hasModule(session.context, "crevia.assets")
        ? await deps.repository.listAssets(session.context.creviaOrganizationId, site.site.id)
        : [],
    });
  }

  const draftMatch = path.match(/^\/api\/sites\/([^/]+)\/draft$/);

  if (draftMatch && input.method === "POST") {
    const session = await authenticate(deps, input.headers.cookie ?? "");

    if (!session.ok) {
      return json(401, session);
    }

    if (!hasModule(session.context, "crevia.builder")) {
      return json(403, { ok: false, reason: "module_disabled" });
    }

    const siteId = decodeURIComponent(draftMatch[1]!);
    const site = await siteOwned(deps, session.context, siteId);

    if (!site.ok) {
      return json(404, site);
    }

    const body = (input.body ?? {}) as { expectedVersion?: number; snapshot?: SiteSnapshot };
    const snapshot = body.snapshot;
    const expectedVersion = body.expectedVersion;

    if (!snapshot || typeof expectedVersion !== "number") {
      return json(400, { ok: false, reason: "invalid_block" });
    }

    const inspected = inspectSnapshot(snapshot);

    if (inspected) {
      return json(400, { ok: false, reason: inspected });
    }

    const saved = await deps.repository.saveDraft({
      organizationId: session.context.creviaOrganizationId,
      siteId,
      expectedVersion,
      createdBy: session.context.orbiaUserId,
      snapshot,
      modules: session.context.modules,
    });

    if (!saved.ok) {
      return json(saved.reason === "conflict" ? 409 : 400, saved);
    }

    if (hasModule(session.context, "crevia.themes")) {
      await deps.repository.updateTheme({
        organizationId: session.context.creviaOrganizationId,
        siteId,
        tokens: snapshot.theme,
        modules: session.context.modules,
      });
    }

    return json(200, { ok: true, revision: saved.revision, publishedRevisionId: saved.publishedRevisionId });
  }

  const publishMatch = path.match(/^\/api\/sites\/([^/]+)\/publish$/);

  if (publishMatch && input.method === "POST") {
    const session = await authenticate(deps, input.headers.cookie ?? "");

    if (!session.ok) {
      return json(401, session);
    }

    const authorized = authorizeSensitiveWrite({
      context: session.context,
      directory: {
        organizationStatus: "active",
        membershipStatus: "active",
        appEnabled: true,
        modules: session.context.modules,
        creviaOrganizationId: session.context.creviaOrganizationId,
        evaluatedAt: session.context.evaluatedAt,
      },
      action: "publish",
    });

    if (!authorized.ok) {
      return json(403, authorized);
    }

    const siteId = decodeURIComponent(publishMatch[1]!);
    const site = await siteOwned(deps, authorized.context, siteId);

    if (!site.ok) {
      return json(404, site);
    }

    const draft = await deps.repository.latestDraft(authorized.context.creviaOrganizationId, siteId);

    if (!draft.ok) {
      return json(404, draft);
    }

    const published = await deps.repository.publishSite({
      organizationId: authorized.context.creviaOrganizationId,
      siteId,
      revisionId: draft.revision.revisionId,
      target: "local-fixture",
      createdBy: authorized.context.orbiaUserId,
      modules: authorized.context.modules,
    });

    if (!published.ok) {
      return json(400, published);
    }

    return json(200, { ok: true, publication: published.publication, published: published.published });
  }

  const previewIssue = path.match(/^\/api\/sites\/([^/]+)\/preview-token$/);

  if (previewIssue && input.method === "POST") {
    const session = await authenticate(deps, input.headers.cookie ?? "");

    if (!session.ok) {
      return json(401, session);
    }

    if (!hasModule(session.context, "crevia.preview")) {
      return json(403, { ok: false, reason: "module_disabled" });
    }

    const siteId = decodeURIComponent(previewIssue[1]!);
    const site = await siteOwned(deps, session.context, siteId);

    if (!site.ok) {
      return json(404, site);
    }

    const body = (input.body ?? {}) as { kind?: "editor" | "draft" | "published" };
    const kind = body.kind ?? "draft";
    const draft = await deps.repository.latestDraft(session.context.creviaOrganizationId, siteId);
    const revisionId = kind === "published" ? site.site.publishedRevisionId : draft.ok ? draft.revision.revisionId : null;

    if (!revisionId) {
      return json(404, { ok: false, reason: "not_found" });
    }

    const token = await deps.repository.issuePreviewToken({
      organizationId: session.context.creviaOrganizationId,
      siteId,
      revisionId,
      kind,
    });

    if (!token.ok) {
      return json(400, token);
    }

    return json(200, { ok: true, token: token.token, kind });
  }

  const assetUpload = path.match(/^\/api\/sites\/([^/]+)\/assets$/);

  if (assetUpload && input.method === "POST") {
    const session = await authenticate(deps, input.headers.cookie ?? "");

    if (!session.ok) {
      return json(401, session);
    }

    if (!hasModule(session.context, "crevia.assets")) {
      return json(403, { ok: false, reason: "module_disabled" });
    }

    const site = await siteOwned(deps, session.context, decodeURIComponent(assetUpload[1]!));

    if (!site.ok) {
      return json(404, site);
    }

    const body = (input.body ?? {}) as {
      classification?: "CREVIA_WEBSITE_ASSET" | "SYNTARA_MARKETING_ASSET_REFERENCE" | "COMMERCE_ASSET_REFERENCE" | "PLATFORM_BRANDING_REFERENCE";
      sourceSystem?: string | null;
      externalAssetId?: string | null;
      displayName?: string;
      filename?: string;
      mimeType?: string;
      bytesBase64?: string;
    };
    const classification = body.classification ?? "CREVIA_WEBSITE_ASSET";
    let bytes: Buffer | undefined;

    if (body.bytesBase64) {
      try {
        bytes = Buffer.from(body.bytesBase64, "base64");
      } catch {
        return json(400, { ok: false, reason: "invalid_filename" });
      }
    }

    const saved = await deps.repository.saveAsset({
      organizationId: session.context.creviaOrganizationId,
      siteId: site.site.id,
      classification,
      sourceSystem: body.sourceSystem ?? null,
      externalAssetId: body.externalAssetId ?? null,
      displayName: body.displayName ?? body.filename ?? "Asset",
      filename: body.filename,
      mimeType: body.mimeType,
      bytes,
      modules: session.context.modules,
    });

    if (!saved.ok) {
      return json(400, saved);
    }

    return json(200, { ok: true, asset: saved.asset });
  }

  const assetBytes = path.match(/^\/api\/assets\/([^/]+)\/content$/);

  if (assetBytes && input.method === "GET") {
    const session = await authenticate(deps, input.headers.cookie ?? "");

    if (!session.ok) {
      return json(401, session);
    }

    if (!hasModule(session.context, "crevia.assets")) {
      return json(403, { ok: false, reason: "module_disabled" });
    }

    const loaded = await deps.repository.readAssetBytes(session.context.creviaOrganizationId, decodeURIComponent(assetBytes[1]!));

    if (!loaded.ok) {
      return json(404, loaded);
    }

    return {
      status: 200,
      headers: { "content-type": loaded.asset.mimeType ?? "application/octet-stream" },
      body: loaded.bytes,
    };
  }

  const assetMatch = path.match(/^\/api\/assets\/([^/]+)$/);

  if (assetMatch && input.method === "GET") {
    const session = await authenticate(deps, input.headers.cookie ?? "");

    if (!session.ok) {
      return json(401, session);
    }

    if (!hasModule(session.context, "crevia.assets")) {
      return json(403, { ok: false, reason: "module_disabled" });
    }

    const asset = await deps.repository.readAsset(session.context.creviaOrganizationId, decodeURIComponent(assetMatch[1]!));
    return asset.ok ? json(200, { ok: true, asset: asset.asset }) : json(404, asset);
  }

  if (assetMatch && input.method === "DELETE") {
    const session = await authenticate(deps, input.headers.cookie ?? "");

    if (!session.ok) {
      return json(401, session);
    }

    const authorized = authorizeSensitiveWrite({
      context: session.context,
      directory: {
        organizationStatus: "active",
        membershipStatus: "active",
        appEnabled: true,
        modules: session.context.modules,
        creviaOrganizationId: session.context.creviaOrganizationId,
        evaluatedAt: session.context.evaluatedAt,
      },
      action: "asset.delete",
    });

    if (!authorized.ok) {
      return json(403, authorized);
    }

    const archived = await deps.repository.archiveAsset(
      authorized.context.creviaOrganizationId,
      decodeURIComponent(assetMatch[1]!),
      authorized.context.modules,
    );
    return archived.ok ? json(200, { ok: true, asset: archived.asset }) : json(404, archived);
  }

  if (input.method === "GET" && path.startsWith("/preview/")) {
    const siteId = decodeURIComponent(path.slice("/preview/".length));
    const token = url.searchParams.get("token") ?? "";
    const session = await authenticate(deps, input.headers.cookie ?? "");

    if (!session.ok) {
      return json(401, session);
    }

    if (!hasModule(session.context, "crevia.preview")) {
      return json(403, { ok: false, reason: "module_disabled" });
    }

    const preview = await deps.repository.readPreview({ token, organizationId: session.context.creviaOrganizationId });

    if (!preview.ok || preview.revision.siteId !== siteId) {
      return json(404, { ok: false, reason: "not_found" });
    }

    const page = pageFromSnapshot(preview.revision.snapshot, url.searchParams.get("page"));

    if (!page) {
      return json(404, { ok: false, reason: "not_found" });
    }

    return html(200, renderPage(page, preview.revision.snapshot));
  }

  const publishedMatch = path.match(/^\/p\/([^/]+)(?:\/(.*))?$/);

  if (input.method === "GET" && publishedMatch) {
    const siteId = decodeURIComponent(publishedMatch[1]!);
    const slug = publishedMatch[2] ? decodeURIComponent(publishedMatch[2]) : null;
    const rendered = await deps.repository.publicPublishedRender(siteId);

    if (!rendered.ok) {
      return json(404, rendered);
    }

    const page = pageFromSnapshot(rendered.snapshot, slug);

    if (!page) {
      return json(404, { ok: false, reason: "not_found" });
    }

    return html(200, renderPage(page, rendered.snapshot));
  }

  return null;
}
