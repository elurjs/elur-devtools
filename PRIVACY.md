# Elur DevTools Privacy Policy

Last updated: August 30, 2026

Elur DevTools is a browser developer tool for inspecting Elur applications during development. This policy describes how the extension handles information visible in the inspected page.

## Data handling

Elur DevTools does not collect, sell, transmit, or store personal information or browsing history. It does not use analytics, advertising, tracking pixels, telemetry, or remote code.

When the browser DevTools panel is open, the extension can inspect development information exposed by an Elur application, including component metadata, signal values, router state, and registered ecosystem plugin snapshots. This information is processed locally in the browser and is exchanged only between the inspected page, the extension background worker, and the DevTools panel.

Signal edits and Query cache commands initiated by the user are sent locally to the inspected Elur application. They are not transmitted to Elur or any third party.

## Website access

The extension uses a content script on HTTP and HTTPS pages so it can detect the Elur DevTools backend and connect an inspected page to its DevTools panel. The content script ignores unrelated page messages and does not read page content for any other purpose.

## Data retention

The extension does not persist inspected application data. Temporary snapshots remain in memory while the DevTools panel is open and are discarded when the panel or browser context closes.

## Third parties

Elur DevTools does not send information to third-party services. The extension does not include third-party analytics or advertising services.

## Changes

Material changes to this policy will be published with an updated date before a corresponding extension release.

## Contact

Questions about this policy can be submitted through the Elur project repository or the contact channels published at https://elur.dev/.
