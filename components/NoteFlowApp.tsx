"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import TurndownService from "turndown";
import { formatDistanceToNowStrict } from "date-fns";

import RichEditor from "@/components/RichEditor";
import {
  Note,
  NoteFlowState,
  STORAGE_KEY,
  View,
  computeNotebookNoteCounts,
  computeTagCounts,
  estimateBytesForStorage,
  getNotebookById,
  isNoteMatch,
  loadState,
  normalizeTag,
  nowIso,
  saveState,
  uniq,
} from "@/lib/noteflow";
import { downloadTextFile, safeFilename } from "@/lib/download";

type Panel = "sidebar" | "list" | "editor";

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return isMobile;
}

function highlight(text: string, query: string) {
  const q = query.trim();
  if (!q) return text;
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx === -1) return text;
  const before = text.slice(0, idx);
  const match = text.slice(idx, idx + q.length);
  const after = text.slice(idx + q.length);
  return (
    <>
      {before}
      <mark className="rounded bg-[color-mix(in_oklab,var(--accent)_18%,transparent)] px-1">
        {match}
      </mark>
      {after}
    </>
  );
}

function relativeTime(iso: string) {
  try {
    return formatDistanceToNowStrict(new Date(iso), { addSuffix: true });
  } catch {
    return "";
  }
}

function firstNonDeletedNoteId(notes: Note[]) {
  const n = notes.find((x) => !x.isDeleted);
  return n?.id ?? null;
}

export default function NoteFlowApp() {
  const isMobile = useIsMobile();
  const [panel, setPanel] = useState<Panel>("sidebar");

  const [state, setState] = useState<NoteFlowState | null>(null);
  const [view, setView] = useState<View>({ type: "all" });
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const [editingNotebookId, setEditingNotebookId] = useState<string | null>(null);
  const [editingNotebookName, setEditingNotebookName] = useState("");

  const editorRef = useRef<import("@tiptap/react").Editor | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  // Hydrate from localStorage.
  useEffect(() => {
    const s = loadState(uuidv4);
    setState(s);
    setSelectedNoteId((prev) => prev ?? firstNonDeletedNoteId(s.notes));
    setPanel("sidebar");
  }, []);

  // Apply theme.
  useEffect(() => {
    if (!state) return;

    const setting = state.settings.theme;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");

    const apply = () => {
      const resolved =
        setting === "system" ? (mq.matches ? "dark" : "light") : setting;
      document.documentElement.dataset.theme = resolved;
      document.documentElement.classList.toggle("dark", resolved === "dark");
    };

    apply();

    if (setting === "system") {
      mq.addEventListener("change", apply);
      return () => mq.removeEventListener("change", apply);
    }
  }, [state]);

  // Auto-save to localStorage (debounced).
  useEffect(() => {
    if (!state) return;
    const handle = window.setTimeout(() => {
      saveState(state);
    }, 500);
    return () => window.clearTimeout(handle);
  }, [state]);

  // Keyboard shortcuts.
  useEffect(() => {
    if (!state) return;

    const onKeyDown = (e: KeyboardEvent) => {
      const isMod = e.ctrlKey || e.metaKey;
      if (!isMod) {
        if (e.key === "Escape") {
          if (searchQuery) setSearchQuery("");
        }
        return;
      }

      const key = e.key.toLowerCase();

      if (key === "f") {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }

      if (key === "n" && !e.shiftKey) {
        e.preventDefault();
        createNote();
        return;
      }

      if (key === "n" && e.shiftKey) {
        e.preventDefault();
        createNotebook();
        return;
      }

      // Rich text shortcuts not covered by TipTap defaults.
      if (e.shiftKey && key === "x") {
        if (editorRef.current?.isFocused) {
          e.preventDefault();
          editorRef.current.chain().focus().toggleStrike().run();
        }
        return;
      }

      if (e.shiftKey && ["1", "2", "3"].includes(key)) {
        if (editorRef.current?.isFocused) {
          e.preventDefault();
          const level = Number(key) as 1 | 2 | 3;
          editorRef.current.chain().focus().toggleHeading({ level }).run();
        }
        return;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, searchQuery, selectedNoteId, view]);

  const storageBytes = useMemo(() => {
    if (!state) return 0;
    return estimateBytesForStorage({ noteflow: state });
  }, [state]);

  const storageWarning = storageBytes >= 4 * 1024 * 1024;

  const notebookCounts = useMemo(() => {
    if (!state) return new Map<string, number>();
    return computeNotebookNoteCounts(state);
  }, [state]);

  const tagCounts = useMemo(() => {
    if (!state) return new Map<string, number>();
    return computeTagCounts(state);
  }, [state]);

  const allTags = useMemo(() => {
    return Array.from(tagCounts.keys()).sort((a, b) => a.localeCompare(b));
  }, [tagCounts]);

  const filteredNotes = useMemo(() => {
    if (!state) return [] as Note[];

    let notes = state.notes;

    if (view.type === "trash") {
      notes = notes.filter((n) => n.isDeleted);
    } else {
      notes = notes.filter((n) => !n.isDeleted);
    }

    if (view.type === "notebook") {
      notes = notes.filter((n) => n.notebookId === view.notebookId);
    }

    if (view.type === "tag") {
      const t = normalizeTag(view.tag);
      notes = notes.filter((n) => n.tags.map(normalizeTag).includes(t));
    }

    notes = notes.filter((n) => isNoteMatch(n, searchQuery));

    // Sort pinned first, then most recently updated.
    notes = [...notes].sort((a, b) => {
      if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
      const ad = new Date(a.updatedAt).getTime();
      const bd = new Date(b.updatedAt).getTime();
      return bd - ad;
    });

    return notes;
  }, [state, view, searchQuery]);

  const selectedNote = useMemo(() => {
    if (!state || !selectedNoteId) return null;
    return state.notes.find((n) => n.id === selectedNoteId) ?? null;
  }, [state, selectedNoteId]);

  const setActiveView = useCallback(
    (v: View) => {
      setView(v);
      if (isMobile) setPanel("list");
    },
    [isMobile],
  );

  const selectNote = useCallback(
    (noteId: string) => {
      setSelectedNoteId(noteId);
      if (isMobile) setPanel("editor");
    },
    [isMobile],
  );

  const mutate = useCallback((fn: (s: NoteFlowState) => NoteFlowState) => {
    setState((prev) => {
      if (!prev) return prev;
      return fn(prev);
    });
  }, []);

  const createNotebook = useCallback(() => {
    mutate((s) => {
      const id = uuidv4();
      const ts = nowIso();
      const nb = {
        id,
        name: "Untitled Notebook",
        createdAt: ts,
        updatedAt: ts,
        sortOrder: s.notebooks.length,
      };
      // Select the new notebook view.
      setView({ type: "notebook", notebookId: id });
      setEditingNotebookId(id);
      setEditingNotebookName(nb.name);
      if (isMobile) setPanel("sidebar");
      return { ...s, notebooks: [nb, ...s.notebooks] };
    });
  }, [isMobile, mutate]);

  const commitNotebookRename = useCallback(() => {
    if (!editingNotebookId) return;
    const name = editingNotebookName.trim() || "Untitled Notebook";
    mutate((s) => {
      const ts = nowIso();
      return {
        ...s,
        notebooks: s.notebooks.map((n) =>
          n.id === editingNotebookId
            ? { ...n, name, updatedAt: ts }
            : n,
        ),
      };
    });
    setEditingNotebookId(null);
  }, [editingNotebookId, editingNotebookName, mutate]);

  const deleteNotebook = useCallback(
    (notebookId: string) => {
      if (!state) return;
      const nb = getNotebookById(state, notebookId);
      if (!nb) return;
      const ok = window.confirm(
        `Delete notebook "${nb.name}"? All its notes will be moved to Trash.`,
      );
      if (!ok) return;

      mutate((s) => {
        const ts = nowIso();
        return {
          ...s,
          notebooks: s.notebooks.filter((n) => n.id !== notebookId),
          notes: s.notes.map((n) =>
            n.notebookId === notebookId
              ? { ...n, isDeleted: true, deletedAt: ts, updatedAt: ts }
              : n,
          ),
        };
      });

      setView({ type: "all" });
    },
    [mutate, state],
  );

  const createNote = useCallback(() => {
    if (!state) return;

    const ts = nowIso();

    const notebookId =
      view.type === "notebook"
        ? view.notebookId
        : state.notebooks[0]?.id ?? null;

    if (!notebookId) {
      createNotebook();
      return;
    }

    const id = uuidv4();
    const newNote: Note = {
      id,
      notebookId,
      title: "Untitled",
      content: "",
      plainText: "",
      tags: [],
      isPinned: false,
      isDeleted: false,
      deletedAt: null,
      createdAt: ts,
      updatedAt: ts,
      sortOrder: 0,
    };

    mutate((s) => ({ ...s, notes: [newNote, ...s.notes] }));
    setSelectedNoteId(id);
    if (isMobile) setPanel("editor");
  }, [createNotebook, isMobile, mutate, state, view]);

  const updateNote = useCallback(
    (noteId: string, patch: Partial<Note>, touchUpdatedAt = true) => {
      mutate((s) => {
        const ts = nowIso();
        return {
          ...s,
          notes: s.notes.map((n) =>
            n.id === noteId
              ? { ...n, ...patch, updatedAt: touchUpdatedAt ? ts : n.updatedAt }
              : n,
          ),
        };
      });
    },
    [mutate],
  );

  const softDeleteSelected = useCallback(() => {
    if (!selectedNote) return;
    const ts = nowIso();
    updateNote(selectedNote.id, { isDeleted: true, deletedAt: ts });
    setView({ type: "trash" });
    setSelectedNoteId(null);
    if (isMobile) setPanel("list");
  }, [isMobile, selectedNote, updateNote]);

  const restoreSelected = useCallback(() => {
    if (!selectedNote || !state) return;

    let notebookId = selectedNote.notebookId;
    if (!getNotebookById(state, notebookId)) {
      // If notebook no longer exists, restore into a new notebook.
      const id = uuidv4();
      const ts = nowIso();
      mutate((s) => ({
        ...s,
        notebooks: [
          {
            id,
            name: "Recovered",
            createdAt: ts,
            updatedAt: ts,
            sortOrder: s.notebooks.length,
          },
          ...s.notebooks,
        ],
      }));
      notebookId = id;
    }

    updateNote(selectedNote.id, {
      isDeleted: false,
      deletedAt: null,
      notebookId,
    });
    setView({ type: "all" });
  }, [mutate, selectedNote, state, updateNote]);

  const deleteForeverSelected = useCallback(() => {
    if (!selectedNote) return;
    const ok = window.confirm("Permanently delete this note? This cannot be undone.");
    if (!ok) return;

    mutate((s) => ({
      ...s,
      notes: s.notes.filter((n) => n.id !== selectedNote.id),
    }));
    setSelectedNoteId(null);
  }, [mutate, selectedNote]);

  const togglePinSelected = useCallback(() => {
    if (!selectedNote) return;
    updateNote(selectedNote.id, { isPinned: !selectedNote.isPinned });
  }, [selectedNote, updateNote]);

  const setTheme = useCallback(
    (theme: NoteFlowState["settings"]["theme"]) => {
      mutate((s) => ({ ...s, settings: { ...s.settings, theme } }));
    },
    [mutate],
  );

  const cycleTheme = useCallback(() => {
    if (!state) return;
    const t = state.settings.theme;
    const next = t === "system" ? "light" : t === "light" ? "dark" : "system";
    setTheme(next);
  }, [setTheme, state]);

  const exportSelected = useCallback(
    (kind: "md" | "txt") => {
      if (!selectedNote) return;
      const base = safeFilename(selectedNote.title, "note");

      if (kind === "txt") {
        downloadTextFile(`${base}.txt`, selectedNote.plainText, "text/plain;charset=utf-8");
        return;
      }

      const turndown = new TurndownService({
        headingStyle: "atx",
        codeBlockStyle: "fenced",
      });

      const mdBody = turndown.turndown(selectedNote.content || "");
      const md = `# ${selectedNote.title || "Untitled"}\n\n${mdBody}\n`;
      downloadTextFile(`${base}.md`, md, "text/markdown;charset=utf-8");
    },
    [selectedNote],
  );

  const removeTagFromSelected = useCallback(
    (tag: string) => {
      if (!selectedNote) return;
      const t = normalizeTag(tag);
      updateNote(selectedNote.id, {
        tags: selectedNote.tags.filter((x) => normalizeTag(x) !== t),
      });
    },
    [selectedNote, updateNote],
  );

  const addTagToSelected = useCallback(
    (raw: string) => {
      if (!selectedNote) return;
      const t = normalizeTag(raw);
      if (!t) return;
      const next = uniq([...selectedNote.tags.map(normalizeTag), t]);
      updateNote(selectedNote.id, { tags: next });
    },
    [selectedNote, updateNote],
  );

  const noteCountAll = useMemo(() => {
    if (!state) return 0;
    return state.notes.filter((n) => !n.isDeleted).length;
  }, [state]);

  const noteCountTrash = useMemo(() => {
    if (!state) return 0;
    return state.notes.filter((n) => n.isDeleted).length;
  }, [state]);

  if (!state) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-[var(--muted)]">
        Loading…
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-[var(--bg)] text-[var(--text)]">
      <header className="sticky top-0 z-10 border-b border-[var(--border)] bg-[var(--bg)]">
        <div className="mx-auto max-w-[1400px] px-3 sm:px-4 py-3 flex items-center gap-3">
          <div className="font-semibold tracking-tight">NoteFlow</div>

          <div className="flex-1" />

          <div className="hidden sm:flex items-center gap-2">
            <div className="relative">
              <input
                ref={searchRef}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search…"
                className="h-10 w-[320px] rounded-lg border border-[var(--border)] bg-transparent px-3 text-sm outline-none focus:ring-2 focus:ring-[color-mix(in_oklab,var(--accent)_35%,transparent)]"
                aria-label="Search"
              />
              {searchQuery ? (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-[var(--muted)] hover:text-[var(--text)]"
                  aria-label="Clear search"
                >
                  Esc
                </button>
              ) : null}
            </div>

            <button
              type="button"
              onClick={createNote}
              className="h-10 rounded-lg bg-[var(--accent)] px-3 text-sm font-medium text-white hover:opacity-95"
            >
              New note
            </button>

            <button
              type="button"
              onClick={cycleTheme}
              className="h-10 rounded-lg border border-[var(--border)] px-3 text-sm hover:bg-[var(--hover)]"
              aria-label="Toggle theme"
              title="Toggle theme"
            >
              Theme: {state.settings.theme}
            </button>
          </div>

          <div className="flex sm:hidden items-center gap-2 ml-auto">
            <button
              type="button"
              onClick={() => setPanel(panel === "sidebar" ? "list" : "sidebar")}
              className="h-10 rounded-lg border border-[var(--border)] px-3 text-sm hover:bg-[var(--hover)]"
            >
              {panel === "sidebar" ? "List" : "Sidebar"}
            </button>
            <button
              type="button"
              onClick={createNote}
              className="h-10 rounded-lg bg-[var(--accent)] px-3 text-sm font-medium text-white"
            >
              +
            </button>
          </div>
        </div>

        {storageWarning ? (
          <div className="border-t border-[var(--border)] bg-[color-mix(in_oklab,var(--danger)_10%,transparent)]">
            <div className="mx-auto max-w-[1400px] px-3 sm:px-4 py-2 text-xs text-[var(--text)]">
              Storage warning: you’re approaching browser localStorage limits (~5MB). Consider exporting notes. ({
              Math.round(storageBytes / 1024)}
              KB stored under <code>{STORAGE_KEY}</code>)
            </div>
          </div>
        ) : null}

        <div className="sm:hidden border-t border-[var(--border)]">
          <div className="px-3 py-2 flex items-center gap-2">
            <input
              ref={searchRef}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search…"
              className="h-10 flex-1 rounded-lg border border-[var(--border)] bg-transparent px-3 text-sm outline-none"
              aria-label="Search"
            />
            <button
              type="button"
              onClick={cycleTheme}
              className="h-10 rounded-lg border border-[var(--border)] px-3 text-sm"
              aria-label="Toggle theme"
            >
              {state.settings.theme}
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1">
        <div className="mx-auto max-w-[1400px]">
          <div className="noteflow-grid">
            {/* Sidebar */}
            <aside
              className={`noteflow-panel border-r border-[var(--border)] bg-[var(--panel)] ${
                isMobile && panel !== "sidebar" ? "hidden" : "block"
              }`}
            >
              <div className="p-3 flex items-center justify-between">
                <div className="text-xs font-semibold tracking-wide text-[var(--muted)] uppercase">
                  Library
                </div>
                <button
                  type="button"
                  onClick={createNotebook}
                  className="text-xs rounded-md border border-[var(--border)] px-2 py-1 hover:bg-[var(--hover)]"
                >
                  + Notebook
                </button>
              </div>

              <nav className="px-2 pb-3">
                <button
                  type="button"
                  onClick={() => setActiveView({ type: "all" })}
                  className={`w-full flex items-center justify-between rounded-lg px-3 py-2 text-sm hover:bg-[var(--hover)] ${
                    view.type === "all" ? "bg-[var(--hover)]" : ""
                  }`}
                >
                  <span>All Notes</span>
                  <span className="text-xs text-[var(--muted)]">{noteCountAll}</span>
                </button>

                <div className="mt-3 mb-1 px-3 text-xs font-semibold tracking-wide text-[var(--muted)] uppercase">
                  Notebooks
                </div>

                <div className="flex flex-col gap-1">
                  {state.notebooks.map((nb) => {
                    const isActive = view.type === "notebook" && view.notebookId === nb.id;
                    const isEditing = editingNotebookId === nb.id;

                    return (
                      <div
                        key={nb.id}
                        className={`group w-full rounded-lg px-3 py-2 hover:bg-[var(--hover)] ${
                          isActive ? "bg-[var(--hover)]" : ""
                        }`}
                        onDoubleClick={() => {
                          setEditingNotebookId(nb.id);
                          setEditingNotebookName(nb.name);
                        }}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          setEditingNotebookId(nb.id);
                          setEditingNotebookName(nb.name);
                        }}
                      >
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setActiveView({ type: "notebook", notebookId: nb.id })}
                            className="flex-1 text-left"
                          >
                            {isEditing ? (
                              <input
                                value={editingNotebookName}
                                onChange={(e) => setEditingNotebookName(e.target.value)}
                                onBlur={commitNotebookRename}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") commitNotebookRename();
                                  if (e.key === "Escape") setEditingNotebookId(null);
                                }}
                                autoFocus
                                className="w-full h-8 rounded-md border border-[var(--border)] bg-transparent px-2 text-sm outline-none"
                                aria-label="Notebook name"
                              />
                            ) : (
                              <div className="text-sm truncate">{nb.name}</div>
                            )}
                          </button>

                          <div className="text-xs text-[var(--muted)]">
                            {notebookCounts.get(nb.id) ?? 0}
                          </div>

                          <button
                            type="button"
                            onClick={() => deleteNotebook(nb.id)}
                            className="opacity-0 group-hover:opacity-100 text-xs rounded-md px-2 py-1 hover:bg-[color-mix(in_oklab,var(--danger)_12%,transparent)]"
                            aria-label="Delete notebook"
                            title="Delete notebook"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="mt-3 mb-1 px-3 text-xs font-semibold tracking-wide text-[var(--muted)] uppercase">
                  Tags
                </div>

                <div className="flex flex-col gap-1">
                  {allTags.length === 0 ? (
                    <div className="px-3 py-2 text-sm text-[var(--muted)]">
                      No tags yet.
                    </div>
                  ) : (
                    allTags.map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setActiveView({ type: "tag", tag: t })}
                        className={`w-full flex items-center justify-between rounded-lg px-3 py-2 text-sm hover:bg-[var(--hover)] ${
                          view.type === "tag" && normalizeTag(view.tag) === normalizeTag(t)
                            ? "bg-[var(--hover)]"
                            : ""
                        }`}
                      >
                        <span className="truncate">#{t}</span>
                        <span className="text-xs text-[var(--muted)]">{tagCounts.get(t)}</span>
                      </button>
                    ))
                  )}
                </div>

                <div className="mt-3">
                  <button
                    type="button"
                    onClick={() => setActiveView({ type: "trash" })}
                    className={`w-full flex items-center justify-between rounded-lg px-3 py-2 text-sm hover:bg-[var(--hover)] ${
                      view.type === "trash" ? "bg-[var(--hover)]" : ""
                    }`}
                  >
                    <span>Trash</span>
                    <span className="text-xs text-[var(--muted)]">{noteCountTrash}</span>
                  </button>
                </div>
              </nav>
            </aside>

            {/* Notes list */}
            <section
              className={`noteflow-panel border-r border-[var(--border)] ${
                isMobile && panel !== "list" ? "hidden" : "block"
              }`}
            >
              <div className="p-3 flex items-center justify-between border-b border-[var(--border)]">
                <div className="text-sm font-semibold">
                  {view.type === "all"
                    ? "All Notes"
                    : view.type === "trash"
                      ? "Trash"
                      : view.type === "tag"
                        ? `Tag: #${normalizeTag(view.tag)}`
                        : `Notebook: ${getNotebookById(state, view.notebookId)?.name ?? ""}`}
                </div>
                <button
                  type="button"
                  onClick={createNote}
                  className="text-xs rounded-md border border-[var(--border)] px-2 py-1 hover:bg-[var(--hover)]"
                >
                  + Note
                </button>
              </div>

              <div className="p-2">
                {filteredNotes.length === 0 ? (
                  <div className="p-4 text-sm text-[var(--muted)]">
                    {searchQuery
                      ? "No notes match your search."
                      : view.type === "trash"
                        ? "Trash is empty."
                        : "No notes here yet. Create one with Ctrl+N."}
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    {filteredNotes.map((n) => {
                      const isActive = n.id === selectedNoteId;
                      const title = n.title || "Untitled";
                      const preview = (n.plainText || "").slice(0, 100);

                      return (
                        <button
                          key={n.id}
                          type="button"
                          onClick={() => selectNote(n.id)}
                          className={`w-full text-left rounded-xl border px-3 py-3 transition ${
                            isActive
                              ? "border-[var(--accent)] bg-[var(--hover)]"
                              : "border-[var(--border)] hover:bg-[var(--hover)]"
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                {n.isPinned ? (
                                  <span
                                    className="text-xs rounded bg-[color-mix(in_oklab,var(--accent)_16%,transparent)] px-2 py-0.5"
                                    title="Pinned"
                                  >
                                    Pinned
                                  </span>
                                ) : null}
                                <div className="font-medium truncate">
                                  {highlight(title, searchQuery)}
                                </div>
                              </div>
                              <div className="mt-1 text-sm text-[var(--muted)] line-clamp-2">
                                {highlight(preview, searchQuery)}
                              </div>
                            </div>
                            <div className="text-xs text-[var(--muted)] whitespace-nowrap">
                              {relativeTime(n.updatedAt)}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </section>

            {/* Editor */}
            <section
              className={`noteflow-panel ${isMobile && panel !== "editor" ? "hidden" : "block"}`}
            >
              {!selectedNote ? (
                <div className="p-6 text-sm text-[var(--muted)]">
                  Select a note to start editing.
                </div>
              ) : (
                <div className="p-4 flex flex-col gap-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <input
                        value={selectedNote.title}
                        onChange={(e) => updateNote(selectedNote.id, { title: e.target.value })}
                        className="w-full text-xl font-semibold bg-transparent border-b border-[var(--border)] pb-2 outline-none focus:border-[var(--accent)]"
                        placeholder="Note title"
                        aria-label="Note title"
                      />
                      <div className="mt-2 text-xs text-[var(--muted)]">
                        Created {relativeTime(selectedNote.createdAt)} · Updated {relativeTime(selectedNote.updatedAt)}
                      </div>
                    </div>

                    <div className="flex flex-col items-end gap-2">
                      <button
                        type="button"
                        onClick={togglePinSelected}
                        className="h-9 rounded-lg border border-[var(--border)] px-3 text-sm hover:bg-[var(--hover)]"
                      >
                        {selectedNote.isPinned ? "Unpin" : "Pin"}
                      </button>

                      {selectedNote.isDeleted ? (
                        <>
                          <button
                            type="button"
                            onClick={restoreSelected}
                            className="h-9 rounded-lg bg-[var(--accent)] px-3 text-sm font-medium text-white"
                          >
                            Restore
                          </button>
                          <button
                            type="button"
                            onClick={deleteForeverSelected}
                            className="h-9 rounded-lg border border-[var(--border)] px-3 text-sm hover:bg-[color-mix(in_oklab,var(--danger)_12%,transparent)]"
                          >
                            Delete forever
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={softDeleteSelected}
                          className="h-9 rounded-lg border border-[var(--border)] px-3 text-sm hover:bg-[color-mix(in_oklab,var(--danger)_12%,transparent)]"
                        >
                          Move to Trash
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <div className="text-xs font-semibold tracking-wide text-[var(--muted)] uppercase">
                      Tags
                    </div>
                    {selectedNote.tags.length === 0 ? (
                      <span className="text-sm text-[var(--muted)]">No tags</span>
                    ) : null}

                    {selectedNote.tags.map((t) => (
                      <span
                        key={t}
                        className="inline-flex items-center gap-2 rounded-full bg-[var(--tag)] px-3 py-1 text-sm"
                      >
                        <button
                          type="button"
                          onClick={() => setActiveView({ type: "tag", tag: t })}
                          className="hover:underline"
                          title="Filter by tag"
                        >
                          #{normalizeTag(t)}
                        </button>
                        <button
                          type="button"
                          onClick={() => removeTagFromSelected(t)}
                          className="text-xs opacity-70 hover:opacity-100"
                          aria-label={`Remove tag ${t}`}
                        >
                          ×
                        </button>
                      </span>
                    ))}

                    <div className="flex-1" />

                    <TagInput onAdd={addTagToSelected} suggestions={allTags} />
                  </div>

                  <RichEditor
                    noteId={selectedNote.id}
                    content={selectedNote.content}
                    onReady={(ed) => {
                      editorRef.current = ed;
                    }}
                    onChange={(html, plainText) => {
                      updateNote(selectedNote.id, { content: html, plainText });
                    }}
                  />

                  <div className="flex flex-wrap gap-2 pt-2 border-t border-[var(--border)]">
                    <button
                      type="button"
                      onClick={() => exportSelected("md")}
                      className="h-9 rounded-lg border border-[var(--border)] px-3 text-sm hover:bg-[var(--hover)]"
                    >
                      Export .md
                    </button>
                    <button
                      type="button"
                      onClick={() => exportSelected("txt")}
                      className="h-9 rounded-lg border border-[var(--border)] px-3 text-sm hover:bg-[var(--hover)]"
                    >
                      Export .txt
                    </button>

                    <div className="flex-1" />

                    <button
                      type="button"
                      onClick={() => {
                        // quick reset for demo/testing
                        const ok = window.confirm(
                          "Reset all local data (including sample notes)?",
                        );
                        if (!ok) return;
                        window.localStorage.removeItem(STORAGE_KEY);
                        const fresh = loadState(uuidv4);
                        setState(fresh);
                        setView({ type: "all" });
                        setSelectedNoteId(firstNonDeletedNoteId(fresh.notes));
                      }}
                      className="h-9 rounded-lg border border-[var(--border)] px-3 text-sm hover:bg-[var(--hover)]"
                      title="Delete sample data like any other data by deleting notebooks/notes; this is a convenience reset."
                    >
                      Reset demo data
                    </button>
                  </div>
                </div>
              )}
            </section>
          </div>
        </div>
      </main>

      <footer className="border-t border-[var(--border)] bg-[var(--bg)]">
        <div className="mx-auto max-w-[1400px] px-3 sm:px-4 py-3 text-xs text-[var(--muted)]">
          Offline-first (after initial load). Data stored locally in your browser.
        </div>
      </footer>
    </div>
  );
}

function TagInput({
  onAdd,
  suggestions,
}: {
  onAdd: (tag: string) => void;
  suggestions: string[];
}) {
  const [value, setValue] = useState("");

  return (
    <div className="flex items-center gap-2">
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            onAdd(value);
            setValue("");
          }
        }}
        placeholder="Add tag…"
        className="h-9 w-[160px] rounded-lg border border-[var(--border)] bg-transparent px-3 text-sm outline-none focus:ring-2 focus:ring-[color-mix(in_oklab,var(--accent)_35%,transparent)]"
        list="tag-suggestions"
        aria-label="Add tag"
      />
      <datalist id="tag-suggestions">
        {suggestions.map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>
      <button
        type="button"
        onClick={() => {
          onAdd(value);
          setValue("");
        }}
        className="h-9 rounded-lg border border-[var(--border)] px-3 text-sm hover:bg-[var(--hover)]"
      >
        Add
      </button>
    </div>
  );
}
