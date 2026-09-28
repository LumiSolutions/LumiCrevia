import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CREVIA_APP_KEY, type CreviaModuleKey } from "../src/contract.ts";
import { createMemoryServerDeps } from "../src/deps.ts";
import { handleRequest } from "../src/http.ts";
import {
  createMemoryControlPlane,
  createOrbiaExchangeClient,
  type ExchangeGrant,
} from "../src/identity.ts";
import { evaluateReadiness } from "../src/readiness.ts";

const CLIENT_ID = "crevia-client";
const CLIENT_SECRET = "crevia-identity-secret";
const PROVISIONING_KEY = "crevia-provisioning-key";

function grant(): ExchangeGrant {
  return {
    orbiaUserId: "user_1",
    orbiaOrganizationId: "org_fixture_a",
    membershipRole: "owner",
    modules: [
      "crevia.sites",
      "crevia.pages",
      "crevia.builder",
      "crevia.assets",
      "crevia.themes",
      "crevia.preview",
      "crevia.publishing",
      "crevia.domains",
    ] as CreviaModuleKey[],
    organizationStatus: "active",
    membershipStatus: "active",
    appEnabled: true,
    evaluatedAt: "2026-09-28T00:00:00.000Z",
  };
}

describe("live orbia client", () => {
  it("stays disabled until a base URL is configured", async () => {
    assert.deepEqual(
      await createOrbiaExchangeClient().exchange({
        code: "code",
        appKey: CREVIA_APP_KEY,
        clientId: CLIENT_ID,
        clientSecret: CLIENT_SECRET,
      }),
      { ok: false, reason: "live_orbia_disabled" },
    );
  });

  it("exchanges and introspects through Orbia without trusting a browser identity", async () => {
    const calls: string[] = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      calls.push(String(url));
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("x-orbia-client-secret"), CLIENT_SECRET);
      const body = JSON.parse(String(init?.body));
      if (String(url).endsWith("/exchange")) {
        assert.equal(body.code, "one-use");
        assert.equal(body.appKey, "crevia");
        return new Response(JSON.stringify({ ok: true, ...grant(), app: { enabled: true }, organizationId: grant().orbiaOrganizationId, userId: grant().orbiaUserId }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({
        ok: true,
        ...grant(),
        app: { enabled: true },
        organizationId: grant().orbiaOrganizationId,
        userId: grant().orbiaUserId,
        membershipStatus: "active",
        organizationStatus: "active",
      }), { status: 200, headers: { "content-type": "application/json" } });
    };
    const client = createOrbiaExchangeClient({ baseUrl: "https://orbia.example.test", fetchImpl });
    const exchanged = await client.exchange({
      code: "one-use",
      appKey: CREVIA_APP_KEY,
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
    });
    assert.equal(exchanged.ok, true);
    const inspected = await client.introspect?.({
      orbiaUserId: "user_1",
      organizationId: "org_fixture_a",
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
    });
    assert.equal(inspected?.ok, true);
    assert.equal(calls.length, 2);
    assert.equal(JSON.stringify(calls).includes(CLIENT_SECRET), false);
  });

  it("rejects the wrong client, a missing code, and an orbia-mode write without introspection", async () => {
    const fetchImpl: typeof fetch = async () => new Response(JSON.stringify({ ok: false, reason: "wrong_client" }), { status: 401 });
    const client = createOrbiaExchangeClient({ baseUrl: "https://orbia.example.test", fetchImpl });
    assert.deepEqual(
      await client.exchange({ code: "x", appKey: CREVIA_APP_KEY, clientId: CLIENT_ID, clientSecret: "wrong" }),
      { ok: false, reason: "wrong_client" },
    );

    const plane = createMemoryControlPlane({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET });
    const deps = createMemoryServerDeps({
      provisioningKey: PROVISIONING_KEY,
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      identityMode: "orbia",
      appEnv: "TEST",
      orbiaBaseUrl: "https://orbia.example.test",
    });
    deps.controlPlane = plane;
    const missing = await handleRequest({ method: "GET", path: "/api/auth/orbia/callback", headers: {} }, deps);
    assert.equal(missing.status, 403);
    const provision = await handleRequest({
      method: "POST",
      path: "/api/internal/orbia/provision",
      headers: { "x-crevia-provisioning-key": PROVISIONING_KEY },
      body: { action: "enable", orbiaOrganizationId: "org_fixture_a", displayName: "Fixture" },
    }, deps);
    assert.equal(provision.status, 200);
    const created = provision.body as { localOrganizationId: string; sites: number };
    assert.equal(created.sites, 0);
    const callback = await handleRequest({
      method: "GET",
      path: `/api/auth/orbia/callback?code=${plane.issue(grant())}&creviaOrganizationId=${created.localOrganizationId}`,
      headers: {},
    }, deps);
    assert.equal(callback.status, 200);
    const cookie = callback.headers["set-cookie"] ?? "";
    assert.equal(cookie.includes("crevia_session="), true);
    const stored = await deps.sessions.values();
    assert.equal(stored.length, 1);
    assert.equal(cookie.includes(stored[0]!.tokenHash), false);
    const publish = await handleRequest({
      method: "POST",
      path: "/api/sites/missing/publish",
      headers: { cookie },
      body: {},
    }, deps);
    assert.equal(publish.status, 403);
    assert.equal((publish.body as { reason: string }).reason, "introspection_unavailable");
  });

  it("reports identity and provisioning only when orbia mode is configured", () => {
    const ready = evaluateReadiness({
      identityMode: "orbia",
      appEnv: "staging",
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      provisioningKey: PROVISIONING_KEY,
      orbiaBaseUrl: "https://orbia.example.test",
      persistence: "ready",
      storage: "ready",
      migration: "ready",
    });
    assert.equal(ready.status, "degraded");
    assert.equal(ready.checks.identity, "ready");
    assert.equal(ready.checks.provisioning, "ready");
    assert.equal(ready.checks.publishing, "degraded");
    assert.equal(ready.checks.builder, "ready");
    assert.equal(ready.mode, undefined);

    const closed = evaluateReadiness({
      identityMode: "orbia",
      appEnv: "staging",
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      provisioningKey: CLIENT_SECRET,
      orbiaBaseUrl: "",
    });
    assert.equal(closed.checks.identity, "missing");
    assert.equal(closed.checks.provisioning, "missing");
    assert.equal(closed.status, "not_ready");
  });
});
