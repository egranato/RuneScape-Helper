# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

QuickTools: a personal Electron toolbox app. A single window shell with a
sidebar; each sidebar entry is an independent, self-contained utility tool
(e.g. an OSRS decanting profit calculator). No frameworks, no bundler, no
build step — tools are plain `<script>` tags loaded directly by the HTML.

## Commands

```
npm install     # install deps (electron, electron-builder)
npm start       # run the app (electron .)
npm run dist    # build a portable Windows .exe -> build/
```

There is no test suite, lint config, or type checker in this repo.

## Architecture

Standard Electron main/renderer split, deliberately minimal:

- [src/main/main.js](src/main/main.js) — creates the `BrowserWindow` and
  handles all IPC that needs Node/network access: filesystem/dialog
  (`dialog:openFile`, `dialog:saveFile`, `fs:readFile`, `fs:writeFile`) and,
  for the decanting tool, OSRS Wiki Grand Exchange price data (`ge:mapping`,
  `ge:latest`, `ge:volume1h` against `prices.runescape.wiki/api/v1/osrs`,
  with the required descriptive `User-Agent` set here). This is the only
  place with Node/fs/network access — a browser `fetch` can't set a custom
  `User-Agent`, which is why GE calls go through main rather than the
  renderer.
- [src/main/preload.js](src/main/preload.js) — exposes those IPC calls as
  `window.api` via `contextBridge` (`contextIsolation` is on, `nodeIntegration`
  is off). Renderer/tool code never touches Node or Electron APIs directly —
  everything goes through `api.openFile/saveFile/readFile/writeFile/geMapping/geLatest/geVolume1h`.
- [src/renderer/registry.js](src/renderer/registry.js) — defines the global
  `window.ToolRegistry` that tool scripts call `.register(tool)` on. Must load
  before any tool script.
- [src/renderer/tools/*.js](src/renderer/tools/) — one file per tool, each
  calling `ToolRegistry.register({ id, name, render(container, api) })` at
  load time. `render` receives the already-cleared `#content` element and the
  `api` bridge, builds its UI by setting `innerHTML` and wiring listeners, and
  may return a `cleanup()` function (torn down when the user switches tools).
- [src/renderer/app.js](src/renderer/app.js) — reads `window.ToolRegistry.tools`
  after all tool scripts have run, builds the sidebar `<li>` list, and handles
  switching between tools (calling the previous tool's cleanup, then the new
  tool's `render`).
- [src/renderer/index.html](src/renderer/index.html) — script load order
  matters: `registry.js`, then each tool script, then `app.js` last.

### Adding a new tool

1. Copy [src/renderer/tools/_example.js.template](src/renderer/tools/_example.js.template)
   to `src/renderer/tools/<name>.js`.
2. Implement `render(container, api)`.
3. Add `<script src="tools/<name>.js"></script>` to `index.html`, before the
   `app.js` script tag.

Each tool is fully self-contained (own markup, styles via shared
[src/renderer/styles.css](src/renderer/styles.css), own event handling) — there
is no shared state or routing between tools beyond the registry list.
