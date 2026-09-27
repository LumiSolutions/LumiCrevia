import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { createBlock, type LibraryType } from "../../../src/builder/blocks.ts";
import { resolvePointerDrop, type DropIndicator } from "../../../src/builder/dnd.ts";
import {
  commitDocument,
  createEditorSession,
  markClean,
  markConflict,
  markError,
  markSaved,
  markSaving,
  redoEditor,
  undoEditor,
  type EditorSession,
} from "../../../src/builder/editor.ts";
import {
  addPage,
  archivePageInSnapshot,
  duplicatePage,
  markHomepage,
  pageById,
  renamePage,
  replacePage,
  sortedPages,
} from "../../../src/builder/pages.ts";
import { insertBlock, moveBlock, removeBlock, updateBlock } from "../../../src/builder/tree.ts";
import type { BlockNode, PageSnapshot } from "../../../src/validation.ts";
import { issuePreviewToken, loadSite, openFixture, publishSite, saveDraft } from "../api";

const VIEWPORTS = ["desktop", "tablet", "mobile"] as const;

export function Builder({ siteId }: { siteId: string }) {
  const [session, setSession] = useState<EditorSession | null>(null);
  const [siteName, setSiteName] = useState("Site");
  const [assets, setAssets] = useState<Array<{ id: string; displayName: string; classification: string }>>([]);
  const [publishStatus, setPublishStatus] = useState("draft");
  const [preview, setPreview] = useState<"editor" | "draft" | "published">("editor");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [indicator, setIndicator] = useState<DropIndicator | null>(null);
  const pointerY = useRef(0);
  const saveTimer = useRef<number | null>(null);
  const saving = useRef(false);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  useEffect(() => {
    void (async () => {
      await openFixture();
      const loaded = await loadSite(siteId);

      if (!loaded.ok || !loaded.draft) {
        return;
      }

      setSiteName(loaded.site.name);
      setAssets(loaded.assets);
      setPublishStatus(loaded.publication?.status ?? (loaded.site.publishedRevisionId ? "published" : "draft"));
      setSession(createEditorSession(loaded.draft.snapshot, loaded.site.draftVersion));
    })();
  }, [siteId]);

  const persist = useCallback(
    async (next: EditorSession) => {
      if (saving.current || next.saveState === "conflict") {
        return next;
      }

      saving.current = true;
      const savingState = markSaving(next);
      setSession(savingState);
      const result = await saveDraft(siteId, next.expectedVersion, next.document.snapshot);
      saving.current = false;

      if (result.ok && result.revision) {
        const saved = markClean(markSaved(savingState, result.revision.version));
        setSession(saved);
        return saved;
      }

      if (result.reason === "conflict") {
        const conflicted = markConflict(savingState, result.currentVersion ?? next.expectedVersion);
        setSession(conflicted);
        return conflicted;
      }

      const failed = markError(savingState, result.reason ?? "save_failed");
      setSession(failed);
      return failed;
    },
    [siteId],
  );

  const scheduleSave = useCallback(
    (next: EditorSession) => {
      if (saveTimer.current) {
        window.clearTimeout(saveTimer.current);
      }

      saveTimer.current = window.setTimeout(() => {
        void persist(next);
      }, 1600);
    },
    [persist],
  );

  const change = (document: EditorSession["document"]) => {
    if (!session) {
      return;
    }

    const next = commitDocument(session, document);
    setSession(next);
    scheduleSave(next);
  };

  const page = session ? pageById(session.document.snapshot, session.document.pageId) : null;

  const applyPage = (nextPage: PageSnapshot) => {
    if (!session) {
      return;
    }

    change({
      ...session.document,
      snapshot: replacePage(session.document.snapshot, nextPage),
    });
  };

  const onDragStart = (event: DragStartEvent) => {
    setDraggingId(String(event.active.id));
  };

  const onDragMove = (event: DragMoveEvent) => {
    if (!page || !draggingId) {
      return;
    }

    pointerY.current = event.activatorEvent instanceof PointerEvent ? event.activatorEvent.clientY + event.delta.y : pointerY.current + event.delta.y;
    const overId = event.over ? String(event.over.id) : null;
    const rect = event.over?.rect ? { top: event.over.rect.top, height: event.over.rect.height } : null;
    const kind = overId === "canvas" ? "canvas" : event.over?.data.current?.kind ?? null;
    const resolved = resolvePointerDrop({
      tree: page.blocks,
      draggingId,
      overId,
      overKind: kind,
      pointerY: pointerY.current,
      overRect: rect,
    });
    setIndicator(resolved.ok ? resolved.indicator : null);
  };

  const onDragEnd = (event: DragEndEvent) => {
    const id = draggingId;
    setDraggingId(null);
    const drop = indicator;
    setIndicator(null);

    if (!session || !page || !id || !drop || !event.over) {
      return;
    }

    let nextBlocks = page.blocks;

    if (id.startsWith("lib:")) {
      const type = id.slice(4) as LibraryType;
      const created = createBlock(type);
      nextBlocks = insertBlock(page.blocks, created, drop.placement);
      change({
        ...session.document,
        snapshot: replacePage(session.document.snapshot, { ...page, blocks: nextBlocks }),
        selectedBlockId: created.id,
      });
      return;
    }

    const moved = moveBlock(page.blocks, id, drop.placement);

    if (!moved) {
      return;
    }

    change({
      ...session.document,
      snapshot: replacePage(session.document.snapshot, { ...page, blocks: moved }),
      selectedBlockId: id,
    });
  };

  const addFromLibrary = (type: LibraryType) => {
    if (!session || !page) {
      return;
    }

    const created = createBlock(type);
    change({
      ...session.document,
      snapshot: replacePage(session.document.snapshot, { ...page, blocks: [...page.blocks, created] }),
      selectedBlockId: created.id,
    });
  };

  if (!session || !page) {
    return <div className="sites">Loading builder…</div>;
  }

  const selected = findSelected(page.blocks, session.document.selectedBlockId);

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">Crevia</div>
        <div className="crumb">
          {siteName} / {page.title}
        </div>
        <div className="grow" />
        <div className="seg">
          {VIEWPORTS.map((item) => (
            <button
              key={item}
              className={session.document.viewport === item ? "active" : ""}
              type="button"
              onClick={() => setSession({ ...session, document: { ...session.document, viewport: item } })}
            >
              {item}
            </button>
          ))}
        </div>
        <div className="seg">
          {(["editor", "draft", "published"] as const).map((item) => (
            <button
              key={item}
              className={preview === item ? "active" : ""}
              type="button"
              onClick={() => {
                setPreview(item);
                if (item === "editor") {
                  setPreviewUrl(null);
                  return;
                }
                void issuePreviewToken(siteId, item).then((token) => {
                  if (token.ok && token.token) {
                    setPreviewUrl(`/preview/${siteId}?token=${token.token}&page=${page.slug}`);
                  }
                });
              }}
            >
              {item}
            </button>
          ))}
        </div>
        <span className={`state ${session.saveState}`}>{session.saveState}</span>
        <button type="button" className="action" onClick={() => setSession(undoEditor(session))}>
          Undo
        </button>
        <button type="button" className="action" onClick={() => setSession(redoEditor(session))}>
          Redo
        </button>
        <button type="button" className="action" onClick={() => void persist(session)}>
          Save
        </button>
        <button
          type="button"
          className="action primary"
          onClick={() => {
            setPublishStatus("queued");
            void persist(session).then(async (saved) => {
              setPublishStatus("building");
              const published = await publishSite(siteId);
              setPublishStatus(published.publication?.status ?? (published.ok ? "published" : "failed"));
              return saved;
            });
          }}
        >
          Publish
        </button>
        <span className="state">{publishStatus}</span>
      </header>
      {session.saveState === "conflict" ? (
        <div className="banner">
          This site changed elsewhere.
          <button type="button" onClick={() => window.location.reload()}>
            Reload latest
          </button>
          <button type="button">Keep local copy</button>
          <button type="button">Compare later</button>
        </div>
      ) : null}
      {preview !== "editor" && previewUrl ? (
        <iframe className="preview-frame" title={`${preview} preview`} src={previewUrl} />
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={pointerWithin}
          onDragStart={onDragStart}
          onDragMove={onDragMove}
          onDragEnd={onDragEnd}
        >
          <div className="body">
            <aside className="left">
              <section className="rail">
                <h2>Pages</h2>
                {sortedPages(session.document.snapshot).map((item) => (
                  <button
                    key={item.id}
                    className={`row ${item.id === page.id ? "active" : ""}`}
                    type="button"
                    onClick={() => setSession({ ...session, document: { ...session.document, pageId: item.id, selectedBlockId: null } })}
                  >
                    <span>{item.title}</span>
                    {item.homepage ? <small>home</small> : null}
                  </button>
                ))}
                <button type="button" className="action" onClick={() => change({ ...session.document, snapshot: addPage(session.document.snapshot, { title: "New page", slug: "page" }) })}>
                  New page
                </button>
                <button type="button" onClick={() => change({ ...session.document, snapshot: renamePage(session.document.snapshot, page.id, `${page.title} *`) })}>
                  Rename
                </button>
                <button type="button" onClick={() => change({ ...session.document, snapshot: duplicatePage(session.document.snapshot, page.id) })}>
                  Duplicate
                </button>
                <button type="button" onClick={() => change({ ...session.document, snapshot: markHomepage(session.document.snapshot, page.id) })}>
                  Homepage
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const next = archivePageInSnapshot(session.document.snapshot, page.id);
                    change({ ...session.document, snapshot: next, pageId: next.pages[0]?.id ?? "" });
                  }}
                >
                  Archive
                </button>
              </section>
              <section className="rail">
                <h2>Structure</h2>
                <Tree
                  blocks={page.blocks}
                  selectedId={session.document.selectedBlockId}
                  onSelect={(id) => setSession({ ...session, document: { ...session.document, selectedBlockId: id } })}
                />
              </section>
              <section className="rail">
                <h2>Library</h2>
                <div className="lib">
                  {(["section", "text", "media", "navigation", "button", "container"] as const).map((type) => (
                    <LibraryItem key={type} type={type} onAdd={() => addFromLibrary(type)} />
                  ))}
                </div>
              </section>
            </aside>
            <Canvas
              page={page}
              viewport={session.document.viewport}
              selectedId={session.document.selectedBlockId}
              indicator={indicator}
              onSelect={(id) => setSession({ ...session, document: { ...session.document, selectedBlockId: id } })}
            />
            <aside className="right">
              <Inspector
                page={page}
                selected={selected}
                assets={assets}
                viewport={session.document.viewport}
                theme={session.document.snapshot.theme}
                onPage={(next) => applyPage(next)}
                onBlock={(next) => applyPage({ ...page, blocks: updateBlock(page.blocks, next.id, () => next) })}
                onTheme={(theme) => change({ ...session.document, snapshot: { ...session.document.snapshot, theme } })}
                onDelete={() => {
                  if (!selected) {
                    return;
                  }
                  applyPage({ ...page, blocks: removeBlock(page.blocks, selected.id).nodes });
                }}
              />
            </aside>
          </div>
          <DragOverlay>{draggingId ? <div className="row active">Moving block</div> : null}</DragOverlay>
        </DndContext>
      )}
    </div>
  );
}

function findSelected(blocks: BlockNode[], id: string | null): BlockNode | null {
  if (!id) {
    return null;
  }

  for (const block of blocks) {
    if (block.id === id) {
      return block;
    }

    const nested = findSelected(block.children, id);

    if (nested) {
      return nested;
    }
  }

  return null;
}

function Tree({
  blocks,
  selectedId,
  onSelect,
}: {
  blocks: BlockNode[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <ul className="tree">
      {blocks.map((block) => (
        <li key={block.id}>
          <button className={`row ${selectedId === block.id ? "active" : ""}`} type="button" onClick={() => onSelect(block.id)}>
            {block.type}
          </button>
          {block.children.length ? <Tree blocks={block.children} selectedId={selectedId} onSelect={onSelect} /> : null}
        </li>
      ))}
    </ul>
  );
}

function LibraryItem({ type, onAdd }: { type: LibraryType; onAdd: () => void }) {
  const drag = useDraggable({ id: `lib:${type}`, data: { kind: "library", type } });
  return (
    <button ref={drag.setNodeRef} type="button" onClick={onAdd} {...drag.listeners} {...drag.attributes}>
      {type}
    </button>
  );
}

function Canvas({
  page,
  viewport,
  selectedId,
  indicator,
  onSelect,
}: {
  page: PageSnapshot;
  viewport: "desktop" | "tablet" | "mobile";
  selectedId: string | null;
  indicator: DropIndicator | null;
  onSelect: (id: string) => void;
}) {
  const drop = useDroppable({ id: "canvas", data: { kind: "canvas" } });
  return (
    <main className="canvas-wrap">
      <div
        ref={drop.setNodeRef}
        className={`canvas ${viewport}`}
        data-testid="canvas"
        onClick={() => onSelect("")}
      >
        {page.blocks.length === 0 ? <div className="canvas-empty">Drop a block onto the canvas</div> : null}
        {page.blocks.map((block) => (
          <BlockView key={block.id} block={block} selectedId={selectedId} indicator={indicator} viewport={viewport} onSelect={onSelect} />
        ))}
      </div>
    </main>
  );
}

function BlockView({
  block,
  selectedId,
  indicator,
  viewport,
  onSelect,
}: {
  block: BlockNode;
  selectedId: string | null;
  indicator: DropIndicator | null;
  viewport: "desktop" | "tablet" | "mobile";
  onSelect: (id: string) => void;
}) {
  const drag = useDraggable({ id: block.id, data: { kind: "block" } });
  const drop = useDroppable({
    id: block.id,
    data: { kind: block.type === "section" || block.type === "container" ? "container" : "block" },
  });
  const styles = {
    ...(block.styles as React.CSSProperties),
    ...((block.responsive.desktop ?? {}) as React.CSSProperties),
    ...(viewport !== "desktop" ? ((block.responsive[viewport] ?? {}) as React.CSSProperties) : {}),
  };
  const show = indicator?.overId === block.id;

  return (
    <div
      ref={(node) => {
        drag.setNodeRef(node);
        drop.setNodeRef(node);
      }}
      className={`block ${block.type} ${selectedId === block.id ? "selected" : ""}`}
      data-block-id={block.id}
      data-block-type={block.type}
      style={styles}
      onClick={(event) => {
        event.stopPropagation();
        onSelect(block.id);
      }}
    >
      <button className="handle" type="button" data-testid={`handle-${block.id}`} {...drag.listeners} {...drag.attributes} />
      {show && indicator?.edge !== "inside" ? <div className={`indicator ${indicator.edge}`} style={{ top: indicator.edge === "before" ? 0 : undefined, bottom: indicator.edge === "after" ? 0 : undefined }} /> : null}
      {show && indicator?.edge === "inside" ? <div className="indicator inside" /> : null}
      <BlockBody block={block} />
      {block.children.map((child) => (
        <BlockView key={child.id} block={child} selectedId={selectedId} indicator={indicator} viewport={viewport} onSelect={onSelect} />
      ))}
    </div>
  );
}

function BlockBody({ block }: { block: BlockNode }) {
  if (block.type === "text") {
    return <p className="text">{String(block.props.content ?? block.props.html ?? "")}</p>;
  }

  if (block.type === "button") {
    return <span className="button-block">{String(block.props.label ?? "Button")}</span>;
  }

  if (block.type === "media") {
    return <div className="media">{String(block.props.alt || block.props.assetId || "Media")}</div>;
  }

  if (block.type === "navigation") {
    const links = Array.isArray(block.props.links) ? block.props.links : [];
    return (
      <nav className="nav">
        {links.map((entry, index) => {
          const record = entry && typeof entry === "object" ? (entry as { label?: string }) : {};
          return <span key={index}>{record.label ?? "Link"}</span>;
        })}
      </nav>
    );
  }

  return null;
}

function Inspector({
  page,
  selected,
  assets,
  viewport,
  theme,
  onPage,
  onBlock,
  onTheme,
  onDelete,
}: {
  page: PageSnapshot;
  selected: BlockNode | null;
  assets: Array<{ id: string; displayName: string; classification: string }>;
  viewport: "desktop" | "tablet" | "mobile";
  theme: import("../../../src/validation.ts").SiteSnapshot["theme"];
  onPage: (page: PageSnapshot) => void;
  onBlock: (block: BlockNode) => void;
  onTheme: (theme: import("../../../src/validation.ts").SiteSnapshot["theme"]) => void;
  onDelete: () => void;
}) {
  const styleTarget = selected ? { ...(selected.styles ?? {}), ...((selected.responsive[viewport] ?? {}) as object) } : {};

  return (
    <div className="rail">
      <h2>{selected ? selected.type : "Page"}</h2>
      {!selected ? (
        <>
          <label className="field">
            Title
            <input value={page.title} onChange={(event) => onPage({ ...page, title: event.target.value })} />
          </label>
          <label className="field">
            Slug
            <input value={page.slug} onChange={(event) => onPage({ ...page, slug: event.target.value })} />
          </label>
          <label className="field">
            SEO title
            <input value={page.seo.title} onChange={(event) => onPage({ ...page, seo: { ...page.seo, title: event.target.value } })} />
          </label>
          <label className="field">
            Description
            <textarea value={page.seo.description} onChange={(event) => onPage({ ...page, seo: { ...page.seo, description: event.target.value } })} />
          </label>
          <label className="field">
            Canonical
            <input value={page.seo.canonical} onChange={(event) => onPage({ ...page, seo: { ...page.seo, canonical: event.target.value } })} />
          </label>
          <label className="field">
            Robots
            <input value={page.seo.robots} onChange={(event) => onPage({ ...page, seo: { ...page.seo, robots: event.target.value } })} />
          </label>
          <label className="field">
            OG image
            <input value={page.seo.ogImage} onChange={(event) => onPage({ ...page, seo: { ...page.seo, ogImage: event.target.value } })} />
          </label>
          <label className="field">
            Navigation
            <input type="checkbox" checked={page.navigationVisible} onChange={(event) => onPage({ ...page, navigationVisible: event.target.checked })} />
          </label>
        </>
      ) : (
        <>
          {selected.type === "text" ? (
            <label className="field">
              Content
              <textarea
                value={String(selected.props.content ?? "")}
                onChange={(event) => onBlock({ ...selected, props: { ...selected.props, content: event.target.value } })}
              />
            </label>
          ) : null}
          {selected.type === "button" ? (
            <>
              <label className="field">
                Label
                <input value={String(selected.props.label ?? "")} onChange={(event) => onBlock({ ...selected, props: { ...selected.props, label: event.target.value } })} />
              </label>
              <label className="field">
                Link
                <input value={String(selected.props.href ?? "")} onChange={(event) => onBlock({ ...selected, props: { ...selected.props, href: event.target.value } })} />
              </label>
            </>
          ) : null}
          {selected.type === "media" ? (
            <label className="field">
              Asset
              <select
                value={String(selected.props.assetId ?? "")}
                onChange={(event) => onBlock({ ...selected, props: { ...selected.props, assetId: event.target.value } })}
              >
                <option value="">None</option>
                {assets.map((asset) => (
                  <option key={asset.id} value={asset.id}>
                    {asset.displayName} · {asset.classification}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {["fontSize", "color", "padding", "margin", "border", "textAlign", "width", "background"].map((key) => (
            <label className="field" key={key}>
              {key} ({viewport})
              <input
                value={String((styleTarget as Record<string, unknown>)[key] ?? "")}
                onChange={(event) =>
                  onBlock({
                    ...selected,
                    responsive: {
                      ...selected.responsive,
                      [viewport]: { ...(selected.responsive[viewport] ?? {}), [key]: event.target.value },
                    },
                  })
                }
              />
            </label>
          ))}
          <button type="button" onClick={onDelete}>
            Delete block
          </button>
        </>
      )}
      <h2>Theme</h2>
      <label className="field">
        Text
        <input value={theme.colors.text ?? ""} onChange={(event) => onTheme({ ...theme, colors: { ...theme.colors, text: event.target.value } })} />
      </label>
      <label className="field">
        Accent
        <input value={theme.colors.accent ?? ""} onChange={(event) => onTheme({ ...theme, colors: { ...theme.colors, accent: event.target.value } })} />
      </label>
      <label className="field">
        Font
        <input
          value={theme.typography.fontFamily ?? ""}
          onChange={(event) => onTheme({ ...theme, typography: { ...theme.typography, fontFamily: event.target.value } })}
        />
      </label>
      <p className="hint">Platform branding reference is not overwritten.</p>
      <h2>Assets</h2>
      {assets.map((asset) => (
        <div className="row" key={asset.id}>
          <span>{asset.displayName}</span>
          <small>{asset.classification}</small>
        </div>
      ))}
      <p className="hint">Upload is disabled until storage is chosen. Metadata only.</p>
    </div>
  );
}

