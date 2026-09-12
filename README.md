# QuickTools

A personal toolbox app: a single window shell with a sidebar of small,
one-off utility tools you can add over time.

## Run it

```
npm install
npm start
```

## Build a portable .exe

```
npm run dist
```

The output lands in `build/` as a single portable `QuickTools *.exe` —
no installer, just copy it and double-click to launch.

## Adding a new tool

1. Copy `src/renderer/tools/_example.js.template` to `src/renderer/tools/<name>.js`.
2. Fill in `render(container, api)` to build the tool's UI.
3. Add `<script src="tools/<name>.js"></script>` to `src/renderer/index.html`,
   right before `app.js`.

Each tool registers itself via `ToolRegistry.register({ id, name, render })`.
`render` gets an already-cleared content container and the `api` bridge
(`api.openFile`, `api.saveFile`, `api.readFile`, `api.writeFile`) for any
file-based tools. Return a cleanup function from `render` if the tool sets
up listeners/timers that need to be torn down when the user switches tools.

No build step or bundler is used — tools are loaded as plain `<script>`
tags, so adding one is just: drop a file in, add one line to `index.html`.
