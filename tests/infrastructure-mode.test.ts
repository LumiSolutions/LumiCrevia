import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { cloudStartupAllowed } from "../src/contract.ts";
import { createMemoryServerDeps } from "../src/deps.ts";
import { handleRequest } from "../src/http.ts";
import { evaluateReadiness } from "../src/readiness.ts";

function infraDeps() {
  return createMemoryServerDeps({
    identityMode: "infrastructure",
    appEnv: "staging",
    provisioningKey: "must-not-work",
    clientId: "",
    clientSecret: "",
  });
}

describe("infrastructure identity mode", () => {
  it("allows staging infrastructure startup and rejects production infrastructure", () => {
    assert.equal(cloudStartupAllowed("staging", "infrastructure"), true);
    assert.equal(cloudStartupAllowed("STAGING", "infrastructure"), true);
    assert.equal(cloudStartupAllowed("production", "infrastructure"), false);
    assert.equal(cloudStartupAllowed("production", "dev"), false);
    assert.equal(cloudStartupAllowed("LOCAL", "dev"), true);
  });

  it("reports skipped identity and provisioning while keeping infrastructure ready", () => {
    const report = evaluateReadiness({
      identityMode: "infrastructure",
      appEnv: "staging",
      clientId: "",
      clientSecret: "",
      provisioningKey: "",
      persistence: "ready",
      storage: "ready",
      migration: "ready",
      databaseName: "lumicrevia",
    });
    assert.equal(report.status, "degraded");
    assert.equal(report.mode, "infrastructure");
    assert.equal(report.checks.identity, "skipped");
    assert.equal(report.checks.provisioning, "skipped");
    assert.equal(report.checks.publishing, "degraded");
    assert.equal(report.checks.builder, "ready");
    assert.equal(report.checks.database, "ready");
    assert.equal(report.proof?.database, "lumicrevia");
    assert.equal(JSON.stringify(report).includes("postgresql://"), false);
  });

  it("denies login, provisioning, builder UI, and business writes", async () => {
    const deps = infraDeps();
    const denied = [
      await handleRequest({ method: "GET", path: "/", headers: {} }, deps),
      await handleRequest({ method: "GET", path: "/app", headers: {} }, deps),
      await handleRequest({ method: "POST", path: "/api/dev/fixture", headers: {} }, deps),
      await handleRequest({ method: "GET", path: "/api/auth/orbia/callback?code=x&creviaOrganizationId=corg_x", headers: {} }, deps),
      await handleRequest({
        method: "POST",
        path: "/api/internal/orbia/provision",
        headers: { "x-crevia-provisioning-key": "must-not-work" },
        body: { action: "enable", orbiaOrganizationId: "org_fixture_a" },
      }, deps),
      await handleRequest({ method: "GET", path: "/api/session", headers: {} }, deps),
      await handleRequest({ method: "GET", path: "/api/sites", headers: {} }, deps),
      await handleRequest({
        method: "POST",
        path: "/api/sites/site_guess/draft",
        headers: {},
        body: { expectedVersion: 1, snapshot: { pages: [], theme: {} } },
      }, deps),
      await handleRequest({ method: "POST", path: "/api/sites/site_guess/publish", headers: {}, body: {} }, deps),
      await handleRequest({
        method: "POST",
        path: "/api/sites/site_guess/assets",
        headers: {},
        body: { filename: "a.png", mimeType: "image/png", bytesBase64: "QQ==" },
      }, deps),
    ];

    assert.equal(denied.every((row) => row.status === 401 || row.status === 403), true);
    const orgs = await deps.repository.tableCounts();
    assert.equal(orgs.organizations, 0);
    assert.equal(orgs.sites, 0);

    const health = await handleRequest({ method: "GET", path: "/api/health", headers: {} }, deps);
    assert.equal(health.status, 200);
    const readiness = await handleRequest({ method: "GET", path: "/api/readiness", headers: {} }, deps);
    assert.equal(readiness.status, 200);
    const body = readiness.body as { checks: { identity: string; provisioning: string }; mode?: string };
    assert.equal(body.mode, "infrastructure");
    assert.equal(body.checks.identity, "skipped");
    assert.equal(body.checks.provisioning, "skipped");
  });
});
