/**
 * @elurjs/devtools-protocol
 *
 * Message protocol shared between the in-page devtools backend
 * (`@elurjs/devtools-backend`) and the browser extension.
 *
 * Transport: `window.postMessage` between the page and the extension's
 * content script, then extension ports (`chrome.runtime.Port`) between
 * content script, background worker and devtools panel. Every message is
 * wrapped in a {@link MessageEnvelope} tagged with a `source` so each side
 * only consumes messages addressed to it.
 */

export const ELUR_DEVTOOLS_PROTOCOL_VERSION = 1;

/** Envelope source used by the in-page backend (page -> extension). */
export const BACKEND_SOURCE = "elur-devtools-backend";
/** Envelope source used by the extension (extension -> page). */
export const EXTENSION_SOURCE = "elur-devtools-extension";

/** Global key (`window.__ELUR_DEVTOOLS_HOOK__`) where the backend publishes itself. */
export const GLOBAL_HOOK_KEY = "__ELUR_DEVTOOLS_HOOK__";

// ---------------------------------------------------------------------------
// Value serialization
// ---------------------------------------------------------------------------

export type SerializedValueType =
    | "primitive"
    | "array"
    | "object"
    | "function"
    | "dom"
    | "promise"
    | "other";

export interface SerializedValue {
    type: SerializedValueType;
    /** Short, human-readable rendering (e.g. `"42"`, `"Array(3)"`, `{…}`). */
    preview: string;
    /** True when `value` holds a JSON-safe copy the panel can write back. */
    editable: boolean;
    /** JSON-safe copy of the value. Only present when `editable` is true. */
    value?: unknown;
    /** JSON-safe, depth-limited representation used by expandable inspectors. */
    inspection?: unknown;
}

// ---------------------------------------------------------------------------
// Snapshots
// ---------------------------------------------------------------------------

export interface SignalSnapshot {
    id: number;
    /** Stable name from the Vite HMR runtime (`file:name`) when available. */
    name: string | null;
    value: SerializedValue;
    subscriberCount: number;
    createdAt: number;
    lastUpdated: number;
    history: Array<{ at: number; value: SerializedValue }>;
}

export interface ComponentNode {
    id: number;
    parentId: number | null;
    name: string;
    mountedAt: number;
    hasDefaultSlot: boolean;
    slotNames: string[];
    props: Record<string, SerializedValue>;
}

export interface RouterSnapshot {
    mode: string;
    base: string;
    currentPath: string;
    params: Record<string, string>;
    query: Record<string, string>;
    matchedPath: string | null;
    activeGuards: { globalCount: number; hasRouteGuard: boolean; names: string[] };
}

export interface SnapshotPayload {
    signals: SignalSnapshot[];
    components: ComponentNode[];
    router: RouterSnapshot | null;
    /** Per-plugin payloads, keyed by plugin id (e.g. "@elurjs/query"). */
    plugins: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Events (backend -> extension)
// ---------------------------------------------------------------------------

export type BackendEvent =
    | { type: "hook:ready" }
    | { type: "signal:created"; signal: SignalSnapshot }
    | {
        type: "signal:written";
        id: number;
        value: SerializedValue;
        at: number;
        subscriberCount: number;
    }
    | { type: "component:mounted"; component: ComponentNode }
    | { type: "component:unmounted"; id: number; at: number }
    | { type: "snapshot"; snapshot: SnapshotPayload }
    | { type: "plugin:event"; pluginId: string; payload: unknown };

// ---------------------------------------------------------------------------
// Commands (extension -> backend)
// ---------------------------------------------------------------------------

export type DevtoolsCommand =
    | { type: "handshake:init" }
    | { type: "get:snapshot" }
    | { type: "signal:set-value"; id: number; value: unknown }
    | { type: "plugin:command"; pluginId: string; command: unknown };

// ---------------------------------------------------------------------------
// Envelope + global hook
// ---------------------------------------------------------------------------

export interface MessageEnvelope<T> {
    source: typeof BACKEND_SOURCE | typeof EXTENSION_SOURCE;
    v: number;
    payload: T;
}

export type BackendEnvelope = MessageEnvelope<BackendEvent> & { source: typeof BACKEND_SOURCE };
export type CommandEnvelope = MessageEnvelope<DevtoolsCommand> & { source: typeof EXTENSION_SOURCE };

/**
 * Descriptor provided by ecosystem packages (query, i18n, auth, ionic, ...)
 * so the extension can render a tab per installed plugin.
 */
export interface DevtoolsPluginDescriptor {
    id: string;
    /** Human-readable tab label. Defaults to `id`. */
    label?: string;
    /** Returns a JSON-safe snapshot of the plugin's inspectable state. */
    getSnapshot?(): unknown;
    /** Handles an extension command and optionally waits for its side effects. */
    onCommand?(command: unknown): void | Promise<void>;
}

/** Object the backend publishes at `window.__ELUR_DEVTOOLS_HOOK__`. */
export interface ElurDevToolsHook {
    version: number;
    emit(event: BackendEvent): void;
    getSnapshot(): SnapshotPayload;
    /** Registers an ecosystem plugin. Returns an unregister function. */
    registerPlugin(plugin: DevtoolsPluginDescriptor): () => void;
}

/** Type guard for messages coming from the in-page backend. */
export function isBackendEnvelope(data: unknown): data is BackendEnvelope {
    return (
        typeof data === "object" &&
        data !== null &&
        (data as { source?: unknown }).source === BACKEND_SOURCE &&
        (data as { v?: unknown }).v === ELUR_DEVTOOLS_PROTOCOL_VERSION &&
        typeof (data as { payload?: unknown }).payload === "object" &&
        (data as { payload?: unknown }).payload !== null &&
        !Array.isArray((data as { payload?: unknown }).payload) &&
        typeof (data as { payload?: { type?: unknown } }).payload?.type === "string"
    );
}

/** Type guard for messages coming from the extension. */
export function isCommandEnvelope(data: unknown): data is CommandEnvelope {
    return (
        typeof data === "object" &&
        data !== null &&
        (data as { source?: unknown }).source === EXTENSION_SOURCE &&
        (data as { v?: unknown }).v === ELUR_DEVTOOLS_PROTOCOL_VERSION &&
        typeof (data as { payload?: unknown }).payload === "object" &&
        (data as { payload?: unknown }).payload !== null &&
        !Array.isArray((data as { payload?: unknown }).payload) &&
        typeof (data as { payload?: { type?: unknown } }).payload?.type === "string"
    );
}
