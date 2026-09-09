# Elur DevTools — Store Listing

## Product details

- **Name:** Elur DevTools
- **Category:** Developer Tools
- **Language:** English
- **Version:** Keep synchronized with `packages/extension/public/manifest.json`
- **Homepage:** https://elur.dev/
- **Privacy policy:** https://elur.dev/privacy/devtools.html

## Short description

Inspect Elur components, signals, router state, Query caches, and ecosystem plugins directly in browser DevTools.

## Detailed description

Elur DevTools adds an Elur panel to browser developer tools for debugging Elur applications with live runtime data.

Use it to:

- Explore the mounted class-component tree and inspect component props and slots.
- Inspect signals, subscriber counts, nested values, and write history.
- Edit JSON-safe signal values directly in the inspected application.
- Review the active router path, params, query values, matched route, and guards.
- Inspect Elur Query cache entries, in-flight requests, and command queues.
- Refetch or clear Query cache entries from the panel.
- View snapshots exposed by Elur ecosystem plugins.

The extension is intended for local development. Inspected values remain inside the browser and are not collected or transmitted to Elur or third parties.

For automatic development integration, use `@elurjs/vite-plugin-elur`. Other environments can load `@elurjs/devtools-backend/auto` in development builds.

## Single purpose

Provide local debugging and runtime inspection tools for applications built with the Elur JavaScript framework.

## Host access justification

Elur DevTools runs a small content-script bridge on HTTP and HTTPS pages so a DevTools panel can communicate with the Elur debugging backend in the inspected page. The bridge only accepts versioned Elur DevTools protocol messages from the same window and origin. It does not collect browsing history, transmit page data, or inspect unrelated content.

## Remote code declaration

Elur DevTools does not execute remote code. All executable JavaScript is included in the uploaded extension package.

## Data-use declarations

- Personally identifiable information: not collected.
- Health information: not collected.
- Financial and payment information: not collected.
- Authentication information: not collected by the extension.
- Personal communications: not collected.
- Location: not collected.
- Web history: not collected or stored.
- User activity: not collected or transmitted.
- Website content: development snapshots are processed locally only when exposed by the Elur backend.

## Reviewer test instructions

1. Install the extension.
2. From the `elur-devtools` source directory, run `npm install` and `npm run dev -w elur-devtools-demo`.
3. Open the local URL printed by Vite.
4. Open browser DevTools and select the **Elur** panel.
5. Use the demo navigation and verify Components, Signals, Router, and Query tabs.
6. In Signals, select a JSON-safe value, edit its JSON, and click **Apply**.
7. In Query, click **Refetch** on an active cache entry and verify its fetched age resets.

No account or external service is required.

## Visual assets

- Store icon: `packages/extension/public/icons/icon-128.png`
- Screenshot: `store-assets/screenshot-signals-1280x800.png`
- Small promotional tile: `store-assets/promotional-tile-440x280.png`

## Release checklist

- Update the manifest version.
- Run `npm run release:extension`.
- Load the generated ZIP as an unpacked extension and run the reviewer test instructions.
- Confirm the ZIP has `manifest.json` at its root.
- Upload the ZIP from `release/`.
- Upload the screenshot and promotional tile from `store-assets/`.
- Reconfirm the privacy and data-use declarations before submission.
