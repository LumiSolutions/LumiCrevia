import { useEffect, useState } from "react";
import { listSites, openFixture } from "./api";
import { Builder } from "./builder/Builder";

export function App() {
  const path = window.location.pathname;
  const builder = path.match(/^\/app\/sites\/([^/]+)\/builder$/);
  const [sites, setSites] = useState<Array<{ id: string; name: string }>>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (builder) {
      return;
    }

    void (async () => {
      const fixture = await openFixture();

      if (!fixture.ok) {
        setError(fixture.reason ?? "fixture_failed");
        return;
      }

      const listed = await listSites();
      setSites(listed.sites ?? []);
    })();
  }, [builder]);

  if (builder) {
    return <Builder siteId={decodeURIComponent(builder[1]!)} />;
  }

  const orbiaHq = (window as Window & { __CREVIA_ORBIA_HQ__?: string }).__CREVIA_ORBIA_HQ__;

  return (
    <div className="sites">
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <h1>Crevia</h1>
        {orbiaHq ? (
          <button
            type="button"
            onClick={() => {
              const w = window.open(orbiaHq, "LumiOrbia");
              if (!w) window.open(orbiaHq, "_blank", "noopener,noreferrer");
              else w.focus();
            }}
          >
            Zu Orbia
          </button>
        ) : null}
      </header>
      <p>Local visual editor on the Wave 7A foundation. Fixture mode only.</p>
      {error ? <p>{error}</p> : null}
      {sites.map((site) => (
        <div className="site-card" key={site.id}>
          <div>
            <strong>{site.name}</strong>
            <div className="hint">{site.id}</div>
          </div>
          <button type="button" onClick={() => (window.location.href = `/app/sites/${site.id}/builder`)}>
            Open builder
          </button>
        </div>
      ))}
    </div>
  );
}
