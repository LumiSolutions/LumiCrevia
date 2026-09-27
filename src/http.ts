import { CREVIA_APP_KEY } from "./contract.js";
import {
  authenticateProductRequest,
  completeCallback,
  type ControlPlane,
  type SessionStore,
} from "./identity.js";
import { evaluateReadiness, healthReport } from "./readiness.js";
import { findOrganizationByOrbiaId, provisionOrganization, type FoundationStore } from "./store.js";

export type HttpResponse = {
  status: number;
  headers: Record<string, string>;
  body: unknown;
};

export type ServerDeps = {
  store: FoundationStore;
  sessions: SessionStore;
  controlPlane: ControlPlane;
  provisioningKey: string;
  clientId: string;
  clientSecret: string;
  identityMode: "dev" | "orbia";
  appEnv: string;
  secureCookies: boolean;
};

function json(status: number, body: unknown, headers: Record<string, string> = {}): HttpResponse {
  return {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
    body,
  };
}

export async function handleRequest(
  input: { method: string; path: string; headers: Record<string, string | undefined>; body?: unknown },
  deps: ServerDeps,
): Promise<HttpResponse> {
  const path = input.path.split("?")[0] ?? input.path;

  if (input.method === "GET" && path === "/api/health") {
    return json(200, healthReport());
  }

  if (input.method === "GET" && path === "/api/readiness") {
    const report = evaluateReadiness({
      identityMode: deps.identityMode,
      appEnv: deps.appEnv,
      clientId: deps.clientId,
      clientSecret: deps.clientSecret,
      provisioningKey: deps.provisioningKey,
    });
    return json(report.status === "not_ready" ? 503 : 200, report);
  }

  if (input.method === "GET" && path === "/api/auth/orbia/callback") {
    const url = new URL(input.path, "http://crevia.local");
    const code = url.searchParams.get("code") ?? "";
    const password = url.searchParams.get("password") ?? undefined;
    const organizationId = url.searchParams.get("creviaOrganizationId") ?? "";
    const organization = deps.store.organizations.find((row) => row.id === organizationId);

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

    return json(
      200,
      { ok: true, context: opened.context },
      { "set-cookie": opened.cookie },
    );
  }

  if (input.method === "POST" && path === "/api/internal/orbia/provision") {
    const header = input.headers["x-crevia-provisioning-key"] ?? "";
    const body = (input.body ?? {}) as {
      action?: "enable" | "disable" | "re-enable";
      orbiaOrganizationId?: string;
      displayName?: string;
    };
    const result = provisionOrganization(deps.store, {
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

  if (input.method === "GET" && path === "/api/session") {
    const cookie = input.headers.cookie ?? "";
    const session = authenticateProductRequest({
      cookieHeader: cookie,
      mode: deps.identityMode,
      sessions: deps.sessions,
    });

    if (!session.ok) {
      return json(401, session);
    }

    const organization = findOrganizationByOrbiaId(deps.store, session.context.orbiaOrganizationId);

    if (!organization || organization.id !== session.context.creviaOrganizationId) {
      return json(403, { ok: false, reason: "organization_mismatch" });
    }

    return json(200, { ok: true, context: session.context, appKey: CREVIA_APP_KEY });
  }

  return json(404, { ok: false, reason: "not_found" });
}
