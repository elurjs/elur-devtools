import { html, mount, ref, repeat, signal } from "@elurjs/core";
import type { ElurTemplate } from "@elurjs/core";
import type {
    ComponentNode,
    SerializedValue,
    SignalSnapshot,
} from "@elurjs/devtools-protocol";
import {
    onBackendEvent,
    onBridgeDisconnect,
    onPageNavigated,
    sendCommand,
} from "./bridge.js";
import {
    activeTab,
    applyBackendEvent,
    componentMap,
    connected,
    flatComponentTree,
    pluginIds,
    pluginSnapshots,
    resetPanelState,
    routerState,
    selectedComponentId,
    selectedSignalId,
    signalList,
    signalMap,
    type FlatTreeRow,
    type TabId,
} from "./state.js";

onBackendEvent(applyBackendEvent);
onBridgeDisconnect(() => {
    connected.value = false;
});
onPageNavigated(resetPanelState);
// The bridge module connects on import and sends the initial handshake.

function formatTime(at: number): string {
    const date = new Date(at);
    const pad = (value: number): string => String(value).padStart(2, "0");
    return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function formatDuration(ms: number): string {
    if (ms < 1000) return `${ms} ms`;
    if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
    return `${(ms / 60_000).toFixed(1)} min`;
}

function formatPrimitive(value: unknown): string {
    if (typeof value === "string") return JSON.stringify(value);
    if (value === null) return "null";
    return String(value);
}

function renderInspectable(value: unknown, label = "value", depth = 0): ElurTemplate {
    if (typeof value !== "object" || value === null) {
        return html`
            <div class="json-leaf">
                <span class="json-key">${label}</span>
                <code>${formatPrimitive(value)}</code>
            </div>
        `;
    }

    const entries: Array<readonly [string, unknown]> = Array.isArray(value)
        ? value.map((item, index) => [String(index), item] as const)
        : Object.entries(value as Record<string, unknown>);
    const summary = Array.isArray(value) ? `Array(${entries.length})` : `{${entries.length}}`;

    return html`
        <details class="json-node" open=${depth === 0}>
            <summary>
                <span class="json-key">${label}</span>
                <span class="muted">${summary}</span>
            </summary>
            <div class="json-children">
                ${() => repeat(
        entries,
        ([key]) => key,
        ([key, item]) => renderInspectable(item, key, depth + 1),
    )}
            </div>
        </details>
    `;
}

function renderSerializedValue(value: SerializedValue): ElurTemplate {
    if (value.inspection !== undefined) return renderInspectable(value.inspection);
    if (value.value !== undefined) return renderInspectable(value.value);
    return html`<code>${value.preview}</code>`;
}

// ---------------------------------------------------------------------------
// Components tab
// ---------------------------------------------------------------------------

function renderComponentRow(row: FlatTreeRow): ElurTemplate {
    const id = row.node.id;
    return html`
        <button
            type="button"
            aria-pressed=${() => (selectedComponentId.value === id ? "true" : "false")}
            class=${() =>
            "row" + (selectedComponentId.value === id ? " row-selected" : "")}
            style=${`padding-left: ${8 + row.depth * 16}px`}
            @click=${() => {
            selectedComponentId.value = id;
        }}
        >
            <span class="cmp-name">${row.node.name}</span>
            <span class="muted">#${id}</span>
        </button>
    `;
}

function renderComponentDetail(): ElurTemplate {
    const id = selectedComponentId.value;
    const node: ComponentNode | undefined = id === null ? undefined : componentMap.value.get(id);
    if (!node) return html`<div class="empty">Select a component to inspect it.</div>`;

    const propKeys = Object.keys(node.props);
    return html`
        <div class="detail">
            <div class="detail-header">
                <strong>${node.name}</strong>
                <span class="muted">#${node.id} · mounted ${formatTime(node.mountedAt)}</span>
            </div>
            <h4>Props</h4>
            ${propKeys.length === 0
            ? html`<div class="muted">No props.</div>`
            : repeat(
                propKeys,
                (key) => key,
                (key) => html`
                          <div class="row">
                              <span class="prop-key">${key}</span>
                              <code>${node.props[key]?.preview ?? ""}</code>
                          </div>
                      `,
            )}
            <h4>Slots</h4>
            <div class="muted">
                ${node.hasDefaultSlot ? "default " : ""}${node.slotNames.join(", ")}${!node.hasDefaultSlot && node.slotNames.length === 0 ? "none" : ""}
            </div>
        </div>
    `;
}

function ComponentsPanel(): ElurTemplate {
    return html`
        <div class="split">
            <div class="pane">
                ${() =>
            flatComponentTree.value.length === 0
                ? html`<div class="empty">No elur class components mounted yet.</div>`
                : repeat(
                    flatComponentTree.value,
                    (row) => `${row.node.id}:${row.depth}:${row.node.name}`,
                    renderComponentRow,
                )}
            </div>
            <div class="pane">${() => renderComponentDetail()}</div>
        </div>
    `;
}

// ---------------------------------------------------------------------------
// Signals tab
// ---------------------------------------------------------------------------

let signalDraft = "";
const signalEditorRef = ref<HTMLTextAreaElement>();
const signalEditError = signal<string | null>(null);

/** Push the draft into the textarea once it is mounted (ref is set on mount). */
function syncEditorDraft(id: number, draft: string): void {
    const element = signalEditorRef.el;
    if (element?.dataset.signalId !== String(id)) return;
    if (element.value !== draft) element.value = draft;
}

function applySignalEdit(id: number): void {
    if (!signalMap.peek().get(id)?.value.editable) {
        signalEditError.value = "This signal value is no longer editable.";
        return;
    }
    try {
        const value = JSON.parse(signalDraft) as unknown;
        signalEditError.value = null;
        sendCommand({ type: "signal:set-value", id, value });
    } catch {
        // invalid JSON in the editor; keep the draft for the user to fix
        signalEditError.value = "Enter valid JSON before applying the value.";
    }
}

function renderSignalRow(snapshot: SignalSnapshot): ElurTemplate {
    return html`
        <button
            type="button"
            aria-pressed=${() =>
            selectedSignalId.value === snapshot.id ? "true" : "false"}
            class=${() =>
            "row" + (selectedSignalId.value === snapshot.id ? " row-selected" : "")}
            @click=${() => {
            selectedSignalId.value = snapshot.id;
        }}
        >
            <span class="sig-name">${snapshot.name ?? `signal #${snapshot.id}`}</span>
            <code class="sig-value">${snapshot.value.preview}</code>
            <span class="muted">${snapshot.subscriberCount} subs</span>
        </button>
    `;
}

/**
 * The detail skeleton only depends on `selectedSignalId` so writes coming
 * from the app do NOT recreate the textarea while the user is typing.
 * Live values (preview, subscribers, history) are nested bindings that read
 * `signalMap` reactively; static reads use `peek()`.
 */
function renderSignalDetail(): ElurTemplate {
    const id = selectedSignalId.value;
    if (id === null) return html`<div class="empty">Select a signal to inspect it.</div>`;

    const snapshot = signalMap.peek().get(id);
    if (!snapshot) return html`<div class="empty">Signal #${id} is not available yet.</div>`;

    signalDraft = snapshot.value.editable
        ? (JSON.stringify(snapshot.value.value, null, 2) ?? "")
        : "";
    const initialDraft = signalDraft;
    signalEditError.value = null;
    queueMicrotask(() => syncEditorDraft(id, initialDraft));

    const current = (): SignalSnapshot | undefined => signalMap.value.get(id);

    return html`
        <div class="detail">
            <div class="detail-header">
                <strong>${() => current()?.name ?? `signal #${snapshot.id}`}</strong>
                <span class="muted">
                    ${() => {
            const value = current();
            return value
                ? `${value.subscriberCount} subscribers · updated ${formatTime(value.lastUpdated)}`
                : "";
        }}
                </span>
            </div>
            <h4>Value</h4>
            <div class="value-block">
                ${() => {
            const value = current()?.value;
            return value ? renderSerializedValue(value) : null;
        }}
            </div>
            ${snapshot.value.editable
            ? html`
                      <h4>Edit</h4>
                      <textarea
                          ref=${signalEditorRef}
                          data-signal-id=${String(id)}
                          class="editor"
                          rows="5"
                          aria-invalid=${() => (signalEditError.value ? "true" : "false")}
                          @input=${(event: Event) => {
                    signalDraft = (event.target as HTMLTextAreaElement).value;
                    signalEditError.value = null;
                }}
                      ></textarea>
                      ${() =>
                    signalEditError.value
                        ? html`<div class="error">${signalEditError.value}</div>`
                        : null}
                      <button
                          type="button"
                          class="btn"
                          @click=${() => applySignalEdit(id)}
                      >
                          Apply
                      </button>
                  `
            : null}
            <h4>History</h4>
            ${() => {
            const history = (current()?.history ?? [])
                .map((entry, index) => ({
                    entry,
                    key: `${entry.at}:${index}:${entry.value.preview}`,
                }))
                .reverse();
            return history.length === 0
                ? html`<div class="muted">No writes recorded.</div>`
                : repeat(
                    history,
                    (item) => item.key,
                    (item) => html`
                              <div class="history-entry">
                                  <span class="muted">${formatTime(item.entry.at)}</span>
                                  ${renderSerializedValue(item.entry.value)}
                              </div>
                          `,
                );
        }}
        </div>
    `;
}

function SignalsPanel(): ElurTemplate {
    return html`
        <div class="split">
            <div class="pane">
                ${() =>
            signalList.value.length === 0
                ? html`<div class="empty">No signals tracked yet.</div>`
                : repeat(
                    signalList.value,
                    (snapshot) =>
                        `${snapshot.id}:${snapshot.lastUpdated}:${snapshot.subscriberCount}:${snapshot.value.preview}`,
                    renderSignalRow,
                )}
            </div>
            <div class="pane">${() => renderSignalDetail()}</div>
        </div>
    `;
}

// ---------------------------------------------------------------------------
// Router tab
// ---------------------------------------------------------------------------

function RouterPanel(): ElurTemplate {
    return html`
        <div class="pane-full">
            ${() => {
            const router = routerState.value;
            if (!router) return html`<div class="empty">No router detected in this page.</div>`;
            const paramKeys = Object.keys(router.params);
            const queryKeys = Object.keys(router.query);
            return html`
                    <div class="detail">
                        <div class="detail-header">
                            <strong>${router.currentPath}</strong>
                            <button
                                type="button"
                                class="btn"
                                @click=${() => sendCommand({ type: "get:snapshot" })}
                            >
                                Refresh inspector
                            </button>
                        </div>
                        <div class="kv"><span>mode</span><code>${router.mode}</code></div>
                        <div class="kv"><span>base</span><code>${router.base}</code></div>
                        <div class="kv"><span>matched</span><code>${router.matchedPath ?? "—"}</code></div>
                        <h4>Params</h4>
                        ${paramKeys.length === 0
                    ? html`<div class="muted">No params.</div>`
                    : repeat(
                        paramKeys,
                        (key) => key,
                        (key) => html`<div class="row"><span class="prop-key">${key}</span><code>${router.params[key] ?? ""}</code></div>`,
                    )}
                        <h4>Query</h4>
                        ${queryKeys.length === 0
                    ? html`<div class="muted">No query params.</div>`
                    : repeat(
                        queryKeys,
                        (key) => key,
                        (key) => html`<div class="row"><span class="prop-key">${key}</span><code>${router.query[key] ?? ""}</code></div>`,
                    )}
                        <h4>Guards</h4>
                        <div class="muted">
                            ${router.activeGuards.globalCount} global${router.activeGuards.hasRouteGuard ? " + route guard" : ""}${router.activeGuards.names.length > 0 ? ` · ${router.activeGuards.names.join(", ")}` : ""}
                        </div>
                    </div>
                `;
        }}
        </div>
    `;
}

// ---------------------------------------------------------------------------
// Plugin tabs (ecosystem packages: query, i18n, auth, ionic, ...)
// ---------------------------------------------------------------------------

function pluginLabel(id: string): string {
    return id.replace(/^@elurjs\//, "");
}

interface QueryCacheEntryPanel {
    key: string;
    fetchedAt: number;
    ageMs: number;
    subscribers: number;
    dataPreview: string;
    data?: unknown;
}

interface QueryCommandPanel {
    key: string;
    hasQueue: boolean;
    hasInflightLatest: boolean;
    replayLocked: boolean;
}

interface QuerySnapshotPanel {
    cacheTime: number;
    activeQueryCount: number;
    inflight: string[];
    cache: QueryCacheEntryPanel[];
    commands: QueryCommandPanel[];
}

function isQuerySnapshot(value: unknown): value is QuerySnapshotPanel {
    if (!value || typeof value !== "object") return false;
    const snapshot = value as Partial<QuerySnapshotPanel>;
    return (
        typeof snapshot.cacheTime === "number" &&
        typeof snapshot.activeQueryCount === "number" &&
        Array.isArray(snapshot.inflight) &&
        Array.isArray(snapshot.cache) &&
        Array.isArray(snapshot.commands)
    );
}

function sendQueryCommand(command: unknown): void {
    sendCommand({ type: "plugin:command", pluginId: "@elurjs/query", command });
}

function QueryPanel(): ElurTemplate {
    return html`
        <div class="pane-full query-panel">
            ${() => {
            const value = pluginSnapshots.value["@elurjs/query"];
            if (!isQuerySnapshot(value)) {
                return html`<div class="empty">Query has not reported a valid snapshot yet.</div>`;
            }
            return renderQuerySnapshot(value);
        }}
        </div>
    `;
}

function renderQuerySnapshot(snapshot: QuerySnapshotPanel): ElurTemplate {
    return html`
        <div class="detail">
            <div class="detail-header query-header">
                <div>
                    <strong>Query inspector</strong>
                    <div class="muted">Cache, requests and command queues</div>
                </div>
                <div class="detail-actions">
                    <button
                        type="button"
                        class="btn btn-secondary"
                        @click=${() => sendCommand({ type: "get:snapshot" })}
                    >
                        Refresh inspector
                    </button>
                    <button
                        type="button"
                        class="btn btn-danger"
                        @click=${() => sendQueryCommand({ type: "clear-all" })}
                    >
                        Clear cache
                    </button>
                </div>
            </div>
            <div class="metric-grid">
                <div class="metric-card"><span class="metric-value">${snapshot.activeQueryCount}</span><span class="muted">active queries</span></div>
                <div class="metric-card"><span class="metric-value">${snapshot.cache.length}</span><span class="muted">cached entries</span></div>
                <div class="metric-card"><span class="metric-value">${snapshot.inflight.length}</span><span class="muted">in flight</span></div>
                <div class="metric-card"><span class="metric-value">${formatDuration(snapshot.cacheTime)}</span><span class="muted">cache retention</span></div>
            </div>
            <h4>In-flight requests</h4>
            ${snapshot.inflight.length === 0
            ? html`<div class="muted section-empty">No requests in flight.</div>`
            : repeat(
                snapshot.inflight,
                (key) => key,
                (key) => html`<div class="status-line"><span class="pulse"></span>${key}</div>`,
            )}
            <h4>Cache entries</h4>
            ${snapshot.cache.length === 0
            ? html`<div class="empty compact">The query cache is empty.</div>`
            : repeat(
                snapshot.cache,
                (entry) => `${entry.key}:${entry.fetchedAt}:${entry.ageMs}:${entry.dataPreview}`,
                renderQueryEntry,
            )}
            <h4>Commands</h4>
            ${snapshot.commands.length === 0
            ? html`<div class="muted section-empty">No queued or latest commands are active.</div>`
            : repeat(
                snapshot.commands,
                (command) => command.key,
                (command) => html`
                          <div class="command-row">
                              <strong>${command.key}</strong>
                              ${command.hasQueue ? html`<span class="badge">queued</span>` : null}
                              ${command.hasInflightLatest ? html`<span class="badge">latest in flight</span>` : null}
                              ${command.replayLocked ? html`<span class="badge">replaying</span>` : null}
                          </div>
                      `,
            )}
        </div>
    `;
}

function renderQueryEntry(entry: QueryCacheEntryPanel): ElurTemplate {
    const data = "data" in entry ? entry.data : entry.dataPreview;
    return html`
        <article class="query-entry">
            <div class="query-entry-header">
                <div>
                    <strong>${entry.key}</strong>
                    <div class="muted">
                        ${entry.subscribers} subscribers · fetched ${formatDuration(entry.ageMs)} ago
                    </div>
                </div>
                <div class="detail-actions">
                    <button
                        type="button"
                        class="btn btn-secondary"
                        @click=${() => sendQueryCommand({ type: "refetch", key: entry.key })}
                    >
                        Refetch
                    </button>
                    <button
                        type="button"
                        class="btn btn-danger"
                        @click=${() => sendQueryCommand({ type: "clear", key: entry.key })}
                    >
                        Clear
                    </button>
                </div>
            </div>
            <div class="query-data">${renderInspectable(data, "data")}</div>
        </article>
    `;
}

function PluginPanel(pluginId: string): ElurTemplate {
    return html`
        <div class="pane-full">
            ${() => {
            const data = pluginSnapshots.value[pluginId];
            return html`
                    <div class="detail">
                        <div class="detail-header">
                            <strong>${pluginLabel(pluginId)}</strong>
                            <span class="muted">${pluginId}</span>
                            <button
                                type="button"
                                class="btn"
                                @click=${() => sendCommand({ type: "get:snapshot" })}
                            >
                                Refresh inspector
                            </button>
                        </div>
                        ${data === undefined || data === null
                    ? html`<div class="empty">This plugin reported no state. Is the package in use?</div>`
                    : html`<div class="json-view">${renderInspectable(data)}</div>`}
                    </div>
                `;
        }}
        </div>
    `;
}

// ---------------------------------------------------------------------------
// App shell
// ---------------------------------------------------------------------------

const TABS: Array<{ id: TabId; label: string }> = [
    { id: "components", label: "Components" },
    { id: "signals", label: "Signals" },
    { id: "router", label: "Router" },
];

function renderTabButton(id: string, label: string): ElurTemplate {
    return html`
        <button
            type="button"
            role="tab"
            aria-selected=${() => (activeTab.value === id ? "true" : "false")}
            tabindex=${() => (activeTab.value === id ? "0" : "-1")}
            class=${() => "tab" + (activeTab.value === id ? " tab-active" : "")}
            @click=${() => {
            activeTab.value = id;
            // Router and plugin tabs render snapshot-only data: ask for a
            // fresh snapshot when the user opens them.
            if (id === "router" || id.startsWith("plugin:")) {
                sendCommand({ type: "get:snapshot" });
            }
        }}
        >
            ${label}
        </button>
    `;
}

function renderActivePanel(): ElurTemplate {
    const tab = activeTab.value;
    if (tab === "components") return ComponentsPanel();
    if (tab === "signals") return SignalsPanel();
    if (tab === "router") return RouterPanel();
    if (tab === "plugin:@elurjs/query") return QueryPanel();
    if (tab.startsWith("plugin:")) return PluginPanel(tab.slice("plugin:".length));
    return ComponentsPanel();
}

function App(): ElurTemplate {
    return html`
        <div class="shell">
            <header class="topbar">
                <span class="brand">elur</span>
                <nav class="tabs" role="tablist" aria-label="Inspector views">
                    ${() => repeat(TABS, (tab) => tab.id, (tab) => renderTabButton(tab.id, tab.label))}
                    ${() =>
            repeat(
                pluginIds.value,
                (id) => id,
                (id) => renderTabButton(`plugin:${id}`, pluginLabel(id)),
            )}
                </nav>
                <span
                    role="status"
                    aria-live="polite"
                    aria-atomic="true"
                    class=${() =>
            "status " + (connected.value ? "status-ok" : "status-wait")}
                >
                    ${() => (connected.value ? "connected" : "waiting for an elur app…")}
                </span>
            </header>
            <main class="content" role="tabpanel">
                ${() =>
            connected.value
                ? renderActivePanel()
                : html`
                              <div class="empty big">
                                  <p>No elur devtools backend detected on this page.</p>
                                  <p>
                                      Use <code>@elurjs/vite-plugin-elur</code> in development or
                                      import <code>@elurjs/devtools-backend/auto</code>, then reload.
                                  </p>
                              </div>
                          `}
            </main>
        </div>
    `;
}

mount(App(), "#app");
