# NoteFlow (demo)

A modern, privacy-first note-taking application that runs entirely in the browser.

## Features (v1.0 MVP)

- 3-panel layout: sidebar, notes list, editor
- Notebooks: create / rename (dbl-click) / delete (moves notes to Trash)
- Notes: create, rich edit, pin, soft-delete
- Tags: add/remove + filter by tag
- Full-text search (title + content mirror)
- Trash: restore + permanent delete
- Theme: system/light/dark toggle (persisted)
- Export: Markdown (.md) and plain text (.txt)

## Local development

```bash
pnpm install
pnpm dev
```

## Data storage

All data is stored locally under the `localStorage` key `noteflow`.

## GitHub Pages

This repo includes a GitHub Actions workflow that builds a static export (`next.config.ts` uses `output: "export"`) and deploys to GitHub Pages.
