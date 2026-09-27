import type { BlockNode, PageSnapshot, SiteSnapshot } from "../validation.js";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function styleAttr(block: BlockNode, viewport: "desktop" | "tablet" | "mobile"): string {
  const styles = {
    ...(block.styles ?? {}),
    ...(block.responsive.desktop ?? {}),
    ...(viewport !== "desktop" ? (block.responsive[viewport] ?? {}) : {}),
  };
  const css = Object.entries(styles)
    .filter(([, value]) => typeof value === "string" && value)
    .map(([key, value]) => `${key.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)}:${value}`)
    .join(";");
  return css ? ` style="${escapeHtml(css)}"` : "";
}

function hrefFor(value: unknown): string {
  if (typeof value !== "string") {
    return "#";
  }

  const trimmed = value.trim();

  if (!trimmed || trimmed.toLowerCase().startsWith("javascript:") || trimmed.toLowerCase().startsWith("data:")) {
    return "#";
  }

  return escapeHtml(trimmed);
}

export function renderBlock(block: BlockNode, viewport: "desktop" | "tablet" | "mobile" = "desktop"): string {
  const style = styleAttr(block, viewport);

  if (block.type === "text") {
    const content = String(block.props.content ?? block.props.html ?? "");
    return `<p class="block text"${style}>${escapeHtml(content)}</p>`;
  }

  if (block.type === "button") {
    return `<a class="block button" href="${hrefFor(block.props.href)}"${style}>${escapeHtml(String(block.props.label ?? "Button"))}</a>`;
  }

  if (block.type === "media") {
    const src = hrefFor(block.props.src);
    const alt = escapeHtml(String(block.props.alt ?? ""));
    return src === "#"
      ? `<div class="block media empty"${style}>${escapeHtml(String(block.props.assetId || "No asset"))}</div>`
      : `<img class="block media" src="${src}" alt="${alt}"${style} />`;
  }

  if (block.type === "navigation") {
    const links = Array.isArray(block.props.links) ? block.props.links : [];
    const items = links
      .map((entry) => {
        const record = entry && typeof entry === "object" ? (entry as { label?: string; href?: string }) : {};
        return `<a href="${hrefFor(record.href)}" data-internal="${escapeHtml(String(record.href ?? ""))}">${escapeHtml(String(record.label ?? "Link"))}</a>`;
      })
      .join("");
    return `<nav class="block navigation"${style}>${items}</nav>`;
  }

  const children = block.children.map((child) => renderBlock(child, viewport)).join("");
  return `<section class="block ${escapeHtml(block.type)}"${style}>${children}</section>`;
}

export function renderPage(page: PageSnapshot, snapshot: SiteSnapshot, viewport: "desktop" | "tablet" | "mobile" = "desktop"): string {
  const theme = snapshot.theme;
  const background = theme.colors.background ?? "#fff";
  const text = theme.colors.text ?? "#111";
  const font = theme.typography.fontFamily ?? "Georgia, serif";
  const body = page.blocks.map((block) => renderBlock(block, viewport)).join("");
  const nav = snapshot.pages
    .filter((item) => item.navigationVisible)
    .sort((left, right) => left.sortOrder - right.sortOrder)
    .map((item) => `<a href="/${escapeHtml(item.slug)}" data-internal="/${escapeHtml(item.slug)}">${escapeHtml(item.title)}</a>`)
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(page.seo.title || page.title)}</title>
  <meta name="description" content="${escapeHtml(page.seo.description)}" />
  <meta name="robots" content="${escapeHtml(page.seo.robots)}" />
  <style>
    body { margin: 0; background: ${escapeHtml(background)}; color: ${escapeHtml(text)}; font-family: ${escapeHtml(font)}; }
    .wrap { max-width: 920px; margin: 0 auto; padding: 32px 24px 80px; }
    nav.site a, nav.block a { margin-right: 16px; color: inherit; }
    .block.text { margin: 0 0 16px; }
    .block.button { display: inline-block; padding: 8px 14px; background: ${escapeHtml(theme.colors.accent ?? "#1f6b4a")}; color: #fff; text-decoration: none; }
    .block.media.empty { min-height: 160px; background: #111; color: #fff; display: grid; place-items: center; }
    .block.section, .block.container { margin: 0 0 24px; }
  </style>
</head>
<body data-preview="1">
  <div class="wrap">
    <nav class="site">${nav}</nav>
    ${body}
  </div>
  <script>
    document.addEventListener("click", (event) => {
      const link = event.target.closest("a[data-internal]");
      if (!link) return;
      const href = link.getAttribute("data-internal") || "";
      if (!href.startsWith("/")) return;
      event.preventDefault();
      const url = new URL(window.location.href);
      url.searchParams.set("page", href.replace(/^\\//, "") || "home");
      window.location.replace(url.toString());
    });
  </script>
</body>
</html>`;
}

export function pageFromSnapshot(snapshot: SiteSnapshot, slug?: string | null): PageSnapshot | null {
  if (slug) {
    return snapshot.pages.find((page) => page.slug === slug) ?? null;
  }

  return snapshot.pages.find((page) => page.homepage) ?? snapshot.pages[0] ?? null;
}
