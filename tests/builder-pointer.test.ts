import assert from "node:assert/strict";
import { createServer } from "node:http";
import { describe, it } from "node:test";

import { createBlock } from "../src/builder/blocks.ts";
import { resolvePointerDrop } from "../src/builder/dnd.ts";
import { moveBlock } from "../src/builder/tree.ts";
import { handleRequest } from "../src/http.ts";
import { createSessionStore } from "../src/identity.ts";
import { createFoundationStore } from "../src/store.ts";
import type { ServerDeps } from "../src/http-types.ts";

describe("pointer drag and drop", () => {
  it("moves a heading under the body with pointer geometry and keeps selection dirty", () => {
    const heading = createBlock("text");
    const body = createBlock("text");
    heading.props.content = "Heading";
    body.props.content = "Body";
    const tree = [heading, body];
    const resolved = resolvePointerDrop({
      tree,
      draggingId: heading.id,
      overId: body.id,
      overKind: "block",
      pointerY: 190,
      overRect: { top: 120, height: 80 },
    });
    assert.equal(resolved.ok, true);
    if (!resolved.ok) {
      return;
    }
    assert.equal(resolved.indicator.edge, "after");
    const moved = moveBlock(tree, heading.id, resolved.indicator.placement);
    assert.ok(moved);
    assert.equal(moved[0]?.id, body.id);
    assert.equal(moved[1]?.id, heading.id);
    assert.equal(moved[1]?.id === heading.id, true);
  });

  it("activates a real HTTP builder session used by the canvas", async () => {
    const deps: ServerDeps = {
      store: createFoundationStore(),
      sessions: createSessionStore(),
      controlPlane: { async exchange() { return { ok: false as const, reason: "live_orbia_disabled" as const }; } },
      provisioningKey: "local-fixture-key",
      clientId: "c",
      clientSecret: "s",
      identityMode: "dev",
      appEnv: "TEST",
      secureCookies: false,
    };
    const server = createServer(async (request, response) => {
      const result = await handleRequest(
        { method: request.method ?? "GET", path: request.url ?? "/", headers: { cookie: request.headers.cookie } },
        deps,
      );
      response.writeHead(result.status, result.headers);
      response.end(JSON.stringify(result.body));
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const opened = await fetch(`http://127.0.0.1:${address.port}/api/dev/fixture`, { method: "POST" });
    assert.equal(opened.status, 200);
    const body = (await opened.json()) as { siteId: string };
    const cookie = opened.headers.get("set-cookie") ?? "";
    const site = await fetch(`http://127.0.0.1:${address.port}/api/sites/${body.siteId}`, { headers: { cookie } });
    assert.equal(site.status, 200);
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  });
});
