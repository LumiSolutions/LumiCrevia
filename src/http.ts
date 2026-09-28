import { handleBuilderRequest } from "./builder-http.js";
import { CREVIA_APP_KEY } from "./contract.js";
import { authenticateLocalSession, authenticateProductRequest, completeCallback } from "./identity.js";
import { checkStateFromHealth, evaluateReadiness, healthReport } from "./readiness.js";
import type { HttpResponse, ServerDeps } from "./http-types.js";

function infrastructure(deps: ServerDeps): boolean {
  return deps.identityMode === "infrastructure";
}

export type { HttpResponse, ServerDeps } from "./http-types.js";

function json(status: number, body: unknown, headers: Record<string, string> = {}): HttpResponse {
  return {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
    body,
  };
}

async function persistenceChecks(deps: ServerDeps) {
  const database = await deps.repository.health();
  const storage = await deps.storage.health();
  const migration = await deps.repository.migrationHealth();
  return { database, storage, migration };
}

export async function handleRequest(
  input: { method: string; path: string; headers: Record<string, string | undefined>; body?: unknown },
  deps: ServerDeps,
): Promise<HttpResponse> {
  const path = input.path.split("?")[0] ?? input.path;

  if (input.method === "GET" && path === "/api/health") {
    const checks = await persistenceChecks(deps);
    return json(
      200,
      healthReport({
        database: checks.database.ok ? "ok" : "down",
        assetStorage: checks.storage.ok ? "ok" : "down",
      }),
    );
  }

  if (input.method === "GET" && path === "/api/readiness") {
    const checks = await persistenceChecks(deps);
    const report = evaluateReadiness({
      identityMode: deps.identityMode,
      appEnv: deps.appEnv,
      clientId: deps.clientId,
      clientSecret: deps.clientSecret,
      provisioningKey: deps.provisioningKey,
      persistence: checkStateFromHealth(checks.database.ok),
      storage: checkStateFromHealth(checks.storage.ok),
      migration: checkStateFromHealth(checks.migration.ok),
      databaseName: checks.database.databaseName,
    });
    return json(report.status === "not_ready" ? 503 : 200, report);
  }

  if (input.method === "GET" && path === "/api/auth/orbia/callback") {
    if (infrastructure(deps)) {
      return json(403, { ok: false, reason: "infrastructure_mode" });
    }
    const url = new URL(input.path, "http://crevia.local");
    const code = url.searchParams.get("code") ?? "";
    const password = url.searchParams.get("password") ?? undefined;
    const organizationId = url.searchParams.get("creviaOrganizationId") ?? "";
    const organization = await deps.repository.findOrganizationById(organizationId);

    if (!organization || organization.access !== "active") {
      return json(403, { ok: false, reason: "unknown_organization" });
    }

    const opened = await completeCallback({
      code,
      clientId: deps.clientId,
      clientSecret: deps.clientSecret,
      controlPlane: deps.controlPlane,
      sessions: deps.sessions,
      creviaOrganizationId: organization.id,
      secure: deps.secureCookies,
      password,
    });

    if (!opened.ok) {
      return json(401, { ok: false, reason: opened.reason });
    }

    return json(200, { ok: true, context: opened.context }, { "set-cookie": opened.cookie });
  }

  if (input.method === "POST" && path === "/api/internal/orbia/provision") {
    if (infrastructure(deps)) {
      return json(403, { ok: false, reason: "infrastructure_mode" });
    }
    const header = input.headers["x-crevia-provisioning-key"] ?? "";
    const body = (input.body ?? {}) as {
      action?: "enable" | "disable" | "re-enable";
      orbiaOrganizationId?: string;
      displayName?: string;
    };
    const result = await deps.repository.provisionOrganization({
      provisioningKey: header,
      expectedKey: deps.provisioningKey,
      action: body.action ?? "enable",
      orbiaOrganizationId: body.orbiaOrganizationId ?? "",
      displayName: body.displayName,
    });

    if (!result.ok) {
      return json(403, result);
    }

    return json(200, result);
  }

  const builder = await handleBuilderRequest(input, deps);

  if (builder) {
    return builder;
  }

  if (input.method === "GET" && path === "/api/session") {
    if (infrastructure(deps)) {
      return json(403, { ok: false, reason: "infrastructure_mode" });
    }
    const cookie = input.headers.cookie ?? "";
    const local = await authenticateLocalSession({
      cookieHeader: cookie,
      appEnv: deps.appEnv,
      sessions: deps.sessions,
    });
    const session = local.ok
      ? local
      : await authenticateProductRequest({
          cookieHeader: cookie,
          mode: deps.identityMode,
          sessions: deps.sessions,
        });

    if (!session.ok) {
      return json(401, session);
    }

    const organization = await deps.repository.findOrganizationByOrbiaId(session.context.orbiaOrganizationId);

    if (!organization || organization.id !== session.context.creviaOrganizationId) {
      return json(403, { ok: false, reason: "organization_mismatch" });
    }

    return json(200, { ok: true, context: session.context, appKey: CREVIA_APP_KEY });
  }

  return json(404, { ok: false, reason: "not_found" });
}
