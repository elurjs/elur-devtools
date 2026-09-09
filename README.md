# Elur DevTools

Official browser DevTools for the [elur](https://elur.dev) ecosystem — a Chrome/Firefox
extension that inspects components, signals, stores and the router of any elur app.

## Repository layout

| Package | npm name | Purpose |
| --- | --- | --- |
| `packages/protocol` | `@elurjs/devtools-protocol` | Message types shared by the page backend and the extension. Transport-agnostic. |
| `packages/backend` | `@elurjs/devtools-backend` | In-page backend. Hooks into `@elurjs/core` debug APIs and streams state to the extension. |
| `packages/extension` | (private) | MV3 browser extension: content script, background worker and the DevTools panel UI (built with elur itself). |

## Architecture

```
┌─ page (the inspected app) ─────────────────────────────┐
│  @elurjs/devtools-backend                              │
│  · signal hooks via Symbol.for("@elurjs/core/          │
│    reactivity-state") — works with any core copy       │
│  · component hooks via @elurjs/core/lifecycle          │
│  · router snapshots via @elurjs/core/router            │
│  · publishes window.__ELUR_DEVTOOLS_HOOK__             │
└──────────────┬─────────────────────────────────────────┘
               │ window.postMessage envelopes (v1 protocol)
┌─ extension ──┴─────────────────────────────────────────┐
│  content-script  ⇄  background worker  ⇄  devtools panel│
└─────────────────────────────────────────────────────────┘
```

The panel is a plain elur app (signals + `html` templates + `repeat`), bundled with Vite.

## Usage

1. **Automatic (recommended)** — with `@elurjs/vite-plugin-elur` >= 2.1 the
   backend is injected automatically during `vite dev` (`devtools: "auto"`,
   the default). Ecosystem plugins (`@elurjs/query`, `@elurjs/i18n`,
   `@elurjs/auth`, `@elurjs/ionic`) are injected too when installed. Nothing
   is ever added to production builds.

   Manual alternative (any bundler): add `import "@elurjs/devtools-backend/auto";`
   as the first import of your app entry, dev only.

2. **Build the extension**:

   ```bash
   npm install
   npm run build
   ```

3. **Load it**: open `chrome://extensions`, enable Developer mode, "Load unpacked"
   and select `packages/extension/dist`.

4. Open the browser DevTools on an elur app — there is a new **Elur** panel with
   Components / Signals / Router tabs, plus one tab per detected ecosystem
   plugin (Query, i18n, Auth, Ionic).

5. Try it against `examples/demo`: `npm run dev -w elur-devtools-demo`.

## What you get today

- **Components**: live tree of mounted class components (name via `_debugName` /
  `setDebugName()` or class name), props, slots, mount time.
- **Signals**: every signal created, with value, subscriber count and a capped
  write history. Values that are JSON-safe can be **edited from the panel**.
  When the app runs under `@elurjs/vite-plugin-elur` dev, signals get stable
  names (`src/store.ts:count`) resolved from the HMR runtime.
- **Router**: current path, params, query, matched route and active guards.
- **Plugins**: `window.__ELUR_DEVTOOLS_HOOK__.registerPlugin()` is the extension
  point for ecosystem packages. Built-in plugins ship as dev-only subpaths:
  `@elurjs/query/devtools` (cache, in-flight, commands), `@elurjs/i18n/devtools`
  (locale, namespaces, key counts), `@elurjs/auth/devtools` (session state,
  tokens redacted) and `@elurjs/ionic/devtools` (outlet caches, tab stacks).

## Store release

Generate a validated Chrome/Edge upload package with:

```bash
npm run release:extension
```

The command type-checks and builds the extension, validates its manifest and icon dimensions, rejects development-only files, and writes `release/elur-devtools-v<version>.zip` with `manifest.json` at the archive root. Store copy, reviewer instructions, privacy declarations, and asset paths are maintained in `STORE-LISTING.md`; the privacy policy source is `PRIVACY.md`.

## Known limitations (v0)

- Core >= 3.6.0 has multi-subscriber debug hooks, so the overlay
  (`enableDevTools()`) and this backend coexist. On older cores the hooks are
  single-slot: the last installer wins.
- Only **class components** appear in the tree (function components leave no
  runtime trace). There is no component ↔ DOM node link yet (no "highlight on
  page").
- Signal write events are batched every 100 ms; the panel is near-real-time, not
  per-write exact.

## Development

```bash
npm install
npm run build        # builds protocol, backend and extension
npm test             # backend unit tests (happy-dom + real @elurjs/core)
npm run typecheck
```

For panel iteration: `npm run dev -w @elurjs/devtools-extension` rebuilds on change;
reload the unpacked extension after each build.

## Roadmap

- **Fase 3**: signal time-travel, performance profiler (effect durations),
  component ↔ DOM highlight, navigation timeline, rich per-plugin panel UIs
  (today plugin payloads render as generic JSON), stable component names and
  real sourcemaps from the compiler.
