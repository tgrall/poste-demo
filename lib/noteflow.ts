export type ThemeSetting = "system" | "light" | "dark";

export type View =
  | { type: "all" }
  | { type: "notebook"; notebookId: string }
  | { type: "tag"; tag: string }
  | { type: "trash" };

export type Id = string;

export interface Settings {
  theme: ThemeSetting;
  isFirstLaunch: boolean;
}

export interface Notebook {
  id: Id;
  name: string;
  createdAt: string;
  updatedAt: string;
  sortOrder: number;
}

export interface Note {
  id: Id;
  notebookId: Id;
  title: string;
  content: string; // rich HTML
  plainText: string; // mirror for search + preview
  tags: string[];
  isPinned: boolean;
  isDeleted: boolean;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  sortOrder: number;
}

export interface NoteFlowState {
  settings: Settings;
  notebooks: Notebook[];
  notes: Note[];
}

export const STORAGE_KEY = "noteflow";

export function nowIso() {
  return new Date().toISOString();
}

export function normalizeTag(raw: string) {
  const t = raw.trim().replace(/^#+/, "");
  return t.toLowerCase();
}

export function uniq<T>(items: T[]) {
  return Array.from(new Set(items));
}

export function safeJsonParse<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function estimateBytesForStorage(state: unknown) {
  // localStorage stores UTF-16; rough estimate is 2 bytes per char.
  const json = JSON.stringify(state);
  return json.length * 2;
}

function makeSampleContent() {
  const welcome = `
<h1>Welcome to NoteFlow</h1>
<p><strong>NoteFlow</strong> is privacy-first: everything stays on your device.</p>
<p>Try: <em>pinning</em>, <u>formatting</u>, <s>strikethrough</s>, tags, and search.</p>
<hr />
<h2>Keyboard shortcuts</h2>
<ul>
  <li><strong>Ctrl+N</strong> — new note</li>
  <li><strong>Ctrl+Shift+N</strong> — new notebook</li>
  <li><strong>Ctrl+F</strong> — focus search</li>
</ul>
`;

  const tasks = `
<h2>Task list</h2>
<ul data-type="taskList">
  <li data-type="taskItem" data-checked="false"><label><input type="checkbox"><span></span></label><div><p>Write meeting notes</p></div></li>
  <li data-type="taskItem" data-checked="true"><label><input type="checkbox" checked><span></span></label><div><p>Pin important notes</p></div></li>
  <li data-type="taskItem" data-checked="false"><label><input type="checkbox"><span></span></label><div><p>Export as Markdown</p></div></li>
</ul>
<p><blockquote>Tip: tags work across notebooks.</blockquote></p>
`;

  const code = `
<h2>Code snippet</h2>
<p>Store everything locally:</p>
<pre><code class="language-js">localStorage.setItem('noteflow', JSON.stringify(data))</code></pre>
`;

  return { welcome, tasks, code };
}

export function createInitialState(uuid: () => string): NoteFlowState {
  const createdAt = nowIso();
  const nbId = uuid();
  const { welcome, tasks, code } = makeSampleContent();

  return {
    settings: {
      theme: "system",
      isFirstLaunch: false,
    },
    notebooks: [
      {
        id: nbId,
        name: "Welcome",
        createdAt,
        updatedAt: createdAt,
        sortOrder: 0,
      },
    ],
    notes: [
      {
        id: uuid(),
        notebookId: nbId,
        title: "Start here",
        content: welcome,
        plainText:
          "Welcome to NoteFlow. NoteFlow is privacy-first: everything stays on your device. Keyboard shortcuts: Ctrl+N, Ctrl+Shift+N, Ctrl+F.",
        tags: ["welcome", "tips"],
        isPinned: true,
        isDeleted: false,
        deletedAt: null,
        createdAt,
        updatedAt: createdAt,
        sortOrder: 0,
      },
      {
        id: uuid(),
        notebookId: nbId,
        title: "Tasks",
        content: tasks,
        plainText: "Task list. Write meeting notes. Pin important notes. Export as Markdown. Tip: tags work across notebooks.",
        tags: ["todos", "work"],
        isPinned: false,
        isDeleted: false,
        deletedAt: null,
        createdAt,
        updatedAt: createdAt,
        sortOrder: 1,
      },
      {
        id: uuid(),
        notebookId: nbId,
        title: "Code blocks",
        content: code,
        plainText: "Code snippet. Store everything locally: localStorage.setItem('noteflow', JSON.stringify(data))",
        tags: ["code"],
        isPinned: false,
        isDeleted: false,
        deletedAt: null,
        createdAt,
        updatedAt: createdAt,
        sortOrder: 2,
      },
    ],
  };
}

export function loadState(uuid: () => string): NoteFlowState {
  if (typeof window === "undefined") {
    return createInitialState(uuid);
  }

  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return createInitialState(uuid);

  const parsed = safeJsonParse<unknown>(raw);
  if (!parsed) return createInitialState(uuid);

  // Accept both shapes:
  // 1) { noteflow: {...state} } (PRD shape)
  // 2) {...state} (legacy)
  const stateCandidate =
    typeof parsed === "object" && parsed && "noteflow" in parsed
      ? (parsed as { noteflow: unknown }).noteflow
      : parsed;

  const s = stateCandidate as Partial<NoteFlowState> | null;
  const now = nowIso();

  const settings: Settings = {
    theme: s?.settings?.theme ?? "system",
    isFirstLaunch: s?.settings?.isFirstLaunch ?? false,
  };

  const notebooks = Array.isArray(s?.notebooks)
    ? s!.notebooks.map((n) => ({
        id: String((n as Notebook).id),
        name: String((n as Notebook).name ?? "Untitled Notebook"),
        createdAt: String((n as Notebook).createdAt ?? now),
        updatedAt: String((n as Notebook).updatedAt ?? now),
        sortOrder: Number((n as Notebook).sortOrder ?? 0),
      }))
    : [];

  const notes = Array.isArray(s?.notes)
    ? s!.notes.map((n) => ({
        id: String((n as Note).id),
        notebookId: String((n as Note).notebookId),
        title: String((n as Note).title ?? ""),
        content: String((n as Note).content ?? ""),
        plainText: String((n as Note).plainText ?? ""),
        tags: Array.isArray((n as Note).tags)
          ? (n as Note).tags.map((t) => String(t))
          : [],
        isPinned: Boolean((n as Note).isPinned),
        isDeleted: Boolean((n as Note).isDeleted),
        deletedAt: (n as Note).deletedAt ? String((n as Note).deletedAt) : null,
        createdAt: String((n as Note).createdAt ?? now),
        updatedAt: String((n as Note).updatedAt ?? now),
        sortOrder: Number((n as Note).sortOrder ?? 0),
      }))
    : [];

  // Ensure at least one notebook for restoring deleted notes etc.
  if (notebooks.length === 0) {
    const base = createInitialState(uuid);
    return { ...base, settings };
  }

  return { settings, notebooks, notes };
}

export function saveState(state: NoteFlowState) {
  const wrapped = { noteflow: state };
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(wrapped));
}

export function getNotebookById(state: NoteFlowState, notebookId: string) {
  return state.notebooks.find((n) => n.id === notebookId) || null;
}

export function computeTagCounts(state: NoteFlowState) {
  const counts = new Map<string, number>();
  for (const note of state.notes) {
    if (note.isDeleted) continue;
    for (const raw of note.tags) {
      const t = normalizeTag(raw);
      if (!t) continue;
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }
  }
  return counts;
}

export function computeNotebookNoteCounts(state: NoteFlowState) {
  const counts = new Map<string, number>();
  for (const n of state.notebooks) counts.set(n.id, 0);
  for (const note of state.notes) {
    if (note.isDeleted) continue;
    counts.set(note.notebookId, (counts.get(note.notebookId) ?? 0) + 1);
  }
  return counts;
}

export function isNoteMatch(note: Note, query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    note.title.toLowerCase().includes(q) || note.plainText.toLowerCase().includes(q)
  );
}
