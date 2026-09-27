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

  return (
    <div className="sites">
      <h1>Crevia</h1>
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
