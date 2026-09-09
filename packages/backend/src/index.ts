/**
 * @elurjs/devtools-backend
 *
 * In-page backend for the elur DevTools browser extension.
 *
 * How it works:
 * - Signal tracking hooks into the shared reactivity state at
 *   `Symbol.for("@elurjs/core/reactivity-state")` (`signalDebugHooks`).
 *   Because that state is global, this works regardless of how many copies
 *   of `@elurjs/core` the page bundles and regardless of module identity.
 * - Component tracking uses `_setComponentDebugHooks` from
 *   `@elurjs/core/lifecycle` (dynamic import). In Vite dev the import is
 *   deduped with the app's own copy, so mount/unmount events flow.
 * - Router snapshots use `_debugGetRouterInternal` from `@elurjs/core/router`.
 * - Everything is published on `window.__ELUR_DEVTOOLS_HOOK__` and streamed
 *   to the extension via `window.postMessage` envelopes (see
 *   `@elurjs/devtools-protocol`).
 *
 * Known limitation (v0): the core debug hooks are single-slot. Do not run
 * this backend together with the in-page overlay (`enableDevTools()`);
 * the last one to install wins. Multi-subscriber hooks are planned in core.
 */

import {
    BACKEND_SOURCE,
    ELUR_DEVTOOLS_PROTOCOL_VERSION,
    GLOBAL_HOOK_KEY,
    isCommandEnvelope,
} from "@elurjs/devtools-protocol";
import type {
    BackendEvent,
    ComponentNode,
    DevtoolsCommand,
    DevtoolsPluginDescriptor,
    ElurDevToolsHook,
    RouterSnapshot,
    SnapshotPayload,
    SignalSnapshot,
    SerializedValue,
} from "@elurjs/devtools-protocol";
import type { ElurComponent } from "@elurjs/core";
import { serializeValue } from "./serialize.js";
import { createSignalNameResolver, type SignalNameResolver } from "./names.js";

// ---------------------------------------------------------------------------
// Options & handle
// ---------------------------------------------------------------------------

export interface ElurDevToolsBackendOptions {
    /** Max entries kept per signal history. Default 50. */
    historyLimit?: number;
    /**
     * Optional router accessor override. When omitted, the backend tries
     * `_debugGetRouterInternal` from `@elurjs/core/router`.
     */
    routerSnapshot?: () => RouterSnapshot | null;
    /**
     * Optional transport override (testing, non-extension consumers).
     * When provided, events are delivered here INSTEAD of postMessage.
     */
    emit?: (event: BackendEvent) => void;
    /** Write batching window for `signal:written` events, in ms. Default 100. */
    writeBatchMs?: number;
}

export interface ElurDevToolsBackendHandle {
    /** Resolves when async hook installation (components/router) finished. */
    ready: Promise<void>;
    uninstall(): void;
}

// ---------------------------------------------------------------------------
// Core interop types (structural, version-agnostic)
// ---------------------------------------------------------------------------

/**
 * Structural shape of a core Signal. Deliberately NOT the `Signal` class
 * type: the backend must work with any copy/version of `@elurjs/core`
 * loaded in the page, so it never relies on module identity.
 */
interface SignalLike {
    peek(): unknown;
    value: unknown;
    _subs?: Set<() => void>;
}

interface SignalDebugHooksLike {
    onCreate?: (signal: SignalLike, initialValue: unknown) => void;
    onWrite?: (signal: SignalLike, value: unknown) => void;
}

interface ReactivityGlobalStateLike {
    signalDebugHooks: SignalDebugHooksLike | null;
}

const REACTIVITY_STATE_KEY = Symbol.for("@elurjs/core/reactivity-state");

function getReactivityState(): ReactivityGlobalStateLike | null {
    const state = (globalThis as Record<PropertyKey, unknown>)[REACTIVITY_STATE_KEY];
    return state && typeof state === "object" ? (state as ReactivityGlobalStateLike) : null;
}

interface ComponentDebugHooksLike {
    onMountStart?: (inst: ElurComponent) => void;
    onMountEnd?: (inst: ElurComponent) => void;
    onUnmount?: (inst: ElurComponent) => void;
}

interface SignalsModuleLike {
    /** Present on @elurjs/core >= 3.6.0. */
    _addSignalDebugHooks?(hooks: SignalDebugHooksLike): () => void;
}

interface LifecycleModuleLike {
    _setComponentDebugHooks(hooks: ComponentDebugHooksLike | null): void;
    /** Present on @elurjs/core >= 3.6.0. */
    _addComponentDebugHooks?(hooks: ComponentDebugHooksLike): () => void;
}

interface RouterModuleLike {
    _debugGetRouterInternal(): RouterSnapshot | null;
}

// ---------------------------------------------------------------------------
// Backend
// ---------------------------------------------------------------------------

interface SignalMeta {
    id: number;
    createdAt: number;
    lastUpdated: number;
    history: Array<{ at: number; value: SerializedValue }>;
}

interface ComponentRecord extends ComponentNode {
    ref: { deref(): ElurComponent | undefined };
}

export function installElurDevToolsBackend(
    options: ElurDevToolsBackendOptions = {},
): ElurDevToolsBackendHandle {
    const requestedHistoryLimit = Math.trunc(options.historyLimit ?? 50);
    const requestedWriteBatchMs = Math.trunc(options.writeBatchMs ?? 100);
    const historyLimit = Number.isFinite(requestedHistoryLimit)
        ? Math.max(1, requestedHistoryLimit)
        : 50;
    const writeBatchMs = Number.isFinite(requestedWriteBatchMs)
        ? Math.max(16, requestedWriteBatchMs)
        : 100;

    // --- signal state -------------------------------------------------------
    const signalRefs = new Set<{ deref(): SignalLike | undefined }>();
    const signalMeta = new WeakMap<SignalLike, SignalMeta>();
    const signalById = new Map<number, { deref(): SignalLike | undefined }>();
    let signalSeq = 1;
    const resolveName: SignalNameResolver = createSignalNameResolver();

    // --- component state ----------------------------------------------------
    const componentIds = new WeakMap<ElurComponent, number>();
    const componentMounted = new Map<number, ComponentRecord>();
    const componentMountStack: number[] = [];
    let componentSeq = 1;

    // --- plugins ------------------------------------------------------------
    const plugins = new Map<string, DevtoolsPluginDescriptor>();

    // --- transport ------------------------------------------------------------
    const emit = (event: BackendEvent): void => {
        try {
            if (options.emit) {
                options.emit(event);
                return;
            }
            if (typeof window !== "undefined") {
                window.postMessage(
                    { source: BACKEND_SOURCE, v: ELUR_DEVTOOLS_PROTOCOL_VERSION, payload: event },
                    "*",
                );
            }
        } catch {
            return;
        }
    };

    // --- signal tracking ------------------------------------------------------
    function ensureSignalMeta(signal: SignalLike, value: unknown): SignalMeta {
        const existing = signalMeta.get(signal);
        if (existing) {
            if (existing.history.length > historyLimit) {
                existing.history.splice(0, existing.history.length - historyLimit);
            }
            return existing;
        }
        const now = Date.now();
        const ref =
            typeof WeakRef !== "undefined"
                ? new WeakRef(signal)
                : { deref: () => signal as SignalLike | undefined };
        const meta: SignalMeta = {
            id: signalSeq++,
            createdAt: now,
            lastUpdated: now,
            history: [{ at: now, value: serializeValue(value) }],
        };
        signalMeta.set(signal, meta);
        signalRefs.add(ref);
        signalById.set(meta.id, ref);
        return meta;
    }

    function signalSnapshot(signal: SignalLike, meta: SignalMeta): SignalSnapshot {
        return {
            id: meta.id,
            name: resolveName(signal),
            value: serializeValue(safePeek(signal)),
            subscriberCount: signal._subs?.size ?? 0,
            createdAt: meta.createdAt,
            lastUpdated: meta.lastUpdated,
            history: meta.history.slice(),
        };
    }

    function safePeek(signal: SignalLike): unknown {
        try {
            return signal.peek();
        } catch {
            return undefined;
        }
    }

    // Batched delivery of high-frequency write events.
    const pendingWrites = new Map<
        number,
        { value: SerializedValue; at: number; subscriberCount: number }
    >();
    let writeFlushTimer: ReturnType<typeof setTimeout> | null = null;

    function flushWrites(): void {
        writeFlushTimer = null;
        for (const [id, write] of pendingWrites) {
            emit({ type: "signal:written", id, ...write });
        }
        pendingWrites.clear();
    }

    function onSignalCreate(signal: SignalLike, initialValue: unknown): void {
        const meta = ensureSignalMeta(signal, initialValue);
        emit({ type: "signal:created", signal: signalSnapshot(signal, meta) });
    }

    function onSignalWrite(signal: SignalLike, value: unknown): void {
        const meta = ensureSignalMeta(signal, value);
        const now = Date.now();
        meta.lastUpdated = now;
        meta.history.push({ at: now, value: serializeValue(value) });
        if (meta.history.length > historyLimit) {
            meta.history.splice(0, meta.history.length - historyLimit);
        }
        pendingWrites.set(meta.id, {
            value: serializeValue(value),
            at: now,
            subscriberCount: signal._subs?.size ?? 0,
        });
        if (writeFlushTimer == null) {
            writeFlushTimer = setTimeout(flushWrites, writeBatchMs);
        }
    }

    async function installSignalHooks(): Promise<() => void> {
        const hooks: SignalDebugHooksLike = {
            onCreate: onSignalCreate,
            onWrite: onSignalWrite,
        };
        // Preferred path (core >= 3.6.0): additive, multi-subscriber hooks.
        try {
            const mod = (await import("@elurjs/core/signals")) as unknown as SignalsModuleLike;
            if (typeof mod._addSignalDebugHooks === "function") {
                return mod._addSignalDebugHooks(hooks);
            }
        } catch {
            // fall through to the legacy global-state path
        }
        // Legacy path (core < 3.6.0): single-slot hooks on the shared global
        // state; chain with any previously installed hooks.
        const state = getReactivityState();
        if (!state) return () => undefined;
        const previous = state.signalDebugHooks;
        const combined: SignalDebugHooksLike = {
            onCreate(signal, initialValue) {
                previous?.onCreate?.(signal as SignalLike, initialValue);
                onSignalCreate(signal as SignalLike, initialValue);
            },
            onWrite(signal, value) {
                previous?.onWrite?.(signal as SignalLike, value);
                onSignalWrite(signal as SignalLike, value);
            },
        };
        state.signalDebugHooks = combined;
        return () => {
            if (state.signalDebugHooks === combined) state.signalDebugHooks = previous;
        };
    }

    // --- component tracking ---------------------------------------------------
    function componentName(inst: ElurComponent): string {
        const debugName = (inst as { _debugName?: string })._debugName;
        if (debugName && debugName.trim()) return debugName;
        const ctor = (inst as { constructor?: { name?: string } }).constructor;
        return ctor?.name && ctor.name.trim() ? ctor.name : "AnonymousComponent";
    }

    function componentSlotNames(inst: ElurComponent): string[] {
        const slots = (inst as unknown as { _slots?: unknown })._slots;
        if (!(slots instanceof Map)) return [];
        return Array.from(slots.keys()).map((k) => String(k));
    }

    function componentProps(inst: ElurComponent): Record<string, SerializedValue> {
        const out: Record<string, SerializedValue> = {};
        for (const key of Object.keys(inst as unknown as Record<string, unknown>)) {
            if (
                key === "__isElurComponent" ||
                key === "children" ||
                key === "_debugName" ||
                key.startsWith("_")
            ) {
                continue;
            }
            const value = (inst as unknown as Record<string, unknown>)[key];
            if (typeof value === "function") continue;
            out[key] = serializeValue(value);
        }
        return out;
    }

    function toComponentNode(record: ComponentRecord): ComponentNode {
        const { ref: _ref, ...node } = record;
        return node;
    }

    function removeComponentSubtree(id: number): void {
        if (!componentMounted.has(id)) return;
        for (const [childId, record] of Array.from(componentMounted)) {
            if (record.parentId === id) removeComponentSubtree(childId);
        }
        componentMounted.delete(id);
        emit({ type: "component:unmounted", id, at: Date.now() });
    }

    const componentHooks: ComponentDebugHooksLike = {
        onMountStart(inst) {
            let id = componentIds.get(inst);
            if (id == null) {
                id = componentSeq++;
                componentIds.set(inst, id);
            }
            const parentId =
                componentMountStack.length > 0
                    ? componentMountStack[componentMountStack.length - 1] ?? null
                    : null;
            const ref =
                typeof WeakRef !== "undefined"
                    ? new WeakRef(inst)
                    : { deref: () => inst as ElurComponent | undefined };
            const record: ComponentRecord = {
                id,
                parentId,
                name: componentName(inst),
                mountedAt: Date.now(),
                hasDefaultSlot: inst.children != null,
                slotNames: componentSlotNames(inst),
                props: componentProps(inst),
                ref,
            };
            componentMounted.set(id, record);
            componentMountStack.push(id);
            emit({ type: "component:mounted", component: toComponentNode(record) });
        },
        onMountEnd(inst) {
            const id = componentIds.get(inst);
            if (id == null) return;
            const entry = componentMounted.get(id);
            if (entry) {
                entry.name = componentName(inst);
                entry.hasDefaultSlot = inst.children != null;
                entry.slotNames = componentSlotNames(inst);
                entry.props = componentProps(inst);
                emit({ type: "component:mounted", component: toComponentNode(entry) });
            }
            if (componentMountStack[componentMountStack.length - 1] === id) {
                componentMountStack.pop();
                return;
            }
            const idx = componentMountStack.lastIndexOf(id);
            if (idx >= 0) componentMountStack.splice(idx, 1);
        },
        onUnmount(inst) {
            const id = componentIds.get(inst);
            if (id == null) return;
            removeComponentSubtree(id);
            const idx = componentMountStack.lastIndexOf(id);
            if (idx >= 0) componentMountStack.splice(idx, 1);
        },
    };

    async function installComponentHooks(): Promise<(() => void) | null> {
        try {
            const mod = (await import("@elurjs/core/lifecycle")) as unknown as LifecycleModuleLike;
            // Preferred path (core >= 3.6.0): additive hooks.
            if (typeof mod._addComponentDebugHooks === "function") {
                return mod._addComponentDebugHooks(componentHooks);
            }
            if (typeof mod._setComponentDebugHooks !== "function") return null;
            mod._setComponentDebugHooks(componentHooks);
            return () => mod._setComponentDebugHooks(null);
        } catch {
            return null; // components tab will stay empty; signals still work
        }
    }

    // --- router ---------------------------------------------------------------
    async function loadRouterSnapshotter(): Promise<() => RouterSnapshot | null> {
        if (options.routerSnapshot) return options.routerSnapshot;
        try {
            const mod = (await import("@elurjs/core/router")) as unknown as RouterModuleLike;
            if (typeof mod._debugGetRouterInternal !== "function") return () => null;
            return () => {
                try {
                    return mod._debugGetRouterInternal();
                } catch {
                    return null;
                }
            };
        } catch {
            return () => null;
        }
    }

    let routerSnapshotter: () => RouterSnapshot | null = () => null;

    // --- snapshots --------------------------------------------------------------
    function listSignals(): SignalSnapshot[] {
        const out: SignalSnapshot[] = [];
        for (const ref of Array.from(signalRefs)) {
            const signal = ref.deref();
            if (!signal) {
                signalRefs.delete(ref);
                continue;
            }
            const meta = signalMeta.get(signal);
            if (!meta) continue;
            out.push(signalSnapshot(signal, meta));
        }
        out.sort((a, b) => b.lastUpdated - a.lastUpdated);
        return out;
    }

    function getPluginSnapshot(plugin: DevtoolsPluginDescriptor): unknown {
        try {
            return structuredClone(plugin.getSnapshot?.());
        } catch {
            return null;
        }
    }

    function emitPluginSnapshot(id: string, plugin: DevtoolsPluginDescriptor): void {
        emit({ type: "plugin:event", pluginId: id, payload: getPluginSnapshot(plugin) });
    }

    function getSnapshot(): SnapshotPayload {
        const pluginPayloads: Record<string, unknown> = {};
        for (const [id, plugin] of plugins) pluginPayloads[id] = getPluginSnapshot(plugin);
        let router: RouterSnapshot | null = null;
        try {
            router = routerSnapshotter();
        } catch {
            router = null;
        }
        return {
            signals: listSignals(),
            components: Array.from(componentMounted.values()).map(toComponentNode),
            router,
            plugins: pluginPayloads,
        };
    }

    // --- commands ---------------------------------------------------------------
    function handleCommand(command: DevtoolsCommand): void {
        switch (command.type) {
            case "handshake:init":
                emit({ type: "hook:ready" });
                emit({ type: "snapshot", snapshot: getSnapshot() });
                break;
            case "get:snapshot":
                emit({ type: "snapshot", snapshot: getSnapshot() });
                break;
            case "signal:set-value": {
                const ref = signalById.get(command.id);
                const signal = ref?.deref();
                if (!signal) return;
                try {
                    signal.value = command.value;
                } catch {
                    // read-only/computed signals may throw on write; ignore
                }
                break;
            }
            case "plugin:command": {
                const plugin = plugins.get(command.pluginId);
                if (!plugin?.onCommand) return;
                try {
                    const result = plugin.onCommand(command.command);
                    emitPluginSnapshot(command.pluginId, plugin);
                    if (result instanceof Promise) {
                        const emitSettledSnapshot = (): void => {
                            if (plugins.get(command.pluginId) === plugin) {
                                emitPluginSnapshot(command.pluginId, plugin);
                            }
                        };
                        void result.then(emitSettledSnapshot, emitSettledSnapshot);
                    }
                } catch {
                    emitPluginSnapshot(command.pluginId, plugin);
                }
                break;
            }
        }
    }

    function onWindowMessage(event: MessageEvent): void {
        if (event.source !== window) return;
        if (!isCommandEnvelope(event.data)) return;
        handleCommand(event.data.payload);
    }

    // --- install ------------------------------------------------------------------
    let uninstallSignalHooks: () => void = () => undefined;
    let uninstallComponentHooks: (() => void) | null = null;
    let uninstalled = false;

    const ready = (async () => {
        const [uninstallSignals, uninstallComponents, snapshotter] = await Promise.all([
            installSignalHooks(),
            installComponentHooks(),
            loadRouterSnapshotter(),
        ]);
        if (uninstalled) {
            uninstallSignals();
            uninstallComponents?.();
            return;
        }
        uninstallSignalHooks = uninstallSignals;
        uninstallComponentHooks = uninstallComponents;
        routerSnapshotter = snapshotter;
    })();

    if (typeof window !== "undefined") {
        window.addEventListener("message", onWindowMessage);
    }

    const hook: ElurDevToolsHook = {
        version: ELUR_DEVTOOLS_PROTOCOL_VERSION,
        emit,
        getSnapshot,
        registerPlugin(plugin) {
            plugins.set(plugin.id, plugin);
            emitPluginSnapshot(plugin.id, plugin);
            return () => {
                if (plugins.get(plugin.id) !== plugin) return;
                plugins.delete(plugin.id);
                emit({ type: "plugin:event", pluginId: plugin.id, payload: undefined });
            };
        },
    };

    if (typeof window !== "undefined") {
        (window as unknown as Record<string, unknown>)[GLOBAL_HOOK_KEY] = hook;

        // Drain plugins registered before the backend was installed
        // (ecosystem packages push here when the hook is not present yet).
        const pendingKey = "__ELUR_DEVTOOLS_PENDING_PLUGINS__";
        const pending = (window as unknown as Record<string, unknown>)[pendingKey];
        if (Array.isArray(pending)) {
            for (const plugin of pending) {
                if (plugin && typeof plugin.id === "string") {
                    plugins.set(plugin.id, plugin as DevtoolsPluginDescriptor);
                }
            }
            pending.length = 0;
        }
    }

    // Announce ourselves so an already-open panel can connect without reload.
    void ready.then(() => {
        if (uninstalled) return;
        emit({ type: "hook:ready" });
        emit({ type: "snapshot", snapshot: getSnapshot() });
    });

    return {
        ready,
        uninstall() {
            if (uninstalled) return;
            uninstalled = true;
            if (writeFlushTimer != null) {
                clearTimeout(writeFlushTimer);
                writeFlushTimer = null;
            }
            pendingWrites.clear();
            uninstallSignalHooks();
            uninstallComponentHooks?.();
            if (typeof window !== "undefined") {
                window.removeEventListener("message", onWindowMessage);
                const w = window as unknown as Record<string, unknown>;
                if (w[GLOBAL_HOOK_KEY] === hook) delete w[GLOBAL_HOOK_KEY];
            }
        },
    };
}
