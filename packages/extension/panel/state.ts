/**
 * Panel state: a set of elur signals fed by backend events.
 */
import { computed, signal } from "@elurjs/core";
import type {
    BackendEvent,
    ComponentNode,
    RouterSnapshot,
    SignalSnapshot,
} from "@elurjs/devtools-protocol";

export type TabId = "components" | "signals" | "router";

export const connected = signal(false);
/** Builtin tab id, or `plugin:<id>` for ecosystem plugins. */
export const activeTab = signal<string>("components");

export const signalMap = signal(new Map<number, SignalSnapshot>());
export const componentMap = signal(new Map<number, ComponentNode>());
export const routerState = signal<RouterSnapshot | null>(null);
export const pluginSnapshots = signal<Record<string, unknown>>({});

export const selectedSignalId = signal<number | null>(null);
export const selectedComponentId = signal<number | null>(null);

/** Ids of ecosystem plugins present in the latest snapshot (e.g. "@elurjs/query"). */
export const pluginIds = computed(() => Object.keys(pluginSnapshots.value).sort());

export const signalList = computed(() =>
    Array.from(signalMap.value.values()).sort((a, b) => b.lastUpdated - a.lastUpdated),
);

export interface FlatTreeRow {
    node: ComponentNode;
    depth: number;
}

export const flatComponentTree = computed(() => {
    const components = componentMap.value;
    const byParent = new Map<number | null, ComponentNode[]>();
    for (const node of components.values()) {
        const list = byParent.get(node.parentId) ?? [];
        list.push(node);
        byParent.set(node.parentId, list);
    }
    for (const list of byParent.values()) {
        list.sort((a, b) => a.mountedAt - b.mountedAt);
    }
    const rows: FlatTreeRow[] = [];
    const visited = new Set<number>();
    const visit = (node: ComponentNode, depth: number): void => {
        if (visited.has(node.id)) return;
        visited.add(node.id);
        rows.push({ node, depth });
        for (const child of byParent.get(node.id) ?? []) visit(child, depth + 1);
    };
    for (const node of components.values()) {
        if (node.parentId === null || !components.has(node.parentId)) visit(node, 0);
    }
    for (const node of components.values()) visit(node, 0);
    return rows;
});

function applySnapshot(snapshot: {
    signals: SignalSnapshot[];
    components: ComponentNode[];
    router: RouterSnapshot | null;
    plugins: Record<string, unknown>;
}): void {
    const nextSignals = new Map<number, SignalSnapshot>();
    for (const s of snapshot.signals) nextSignals.set(s.id, s);

    const nextComponents = new Map<number, ComponentNode>();
    for (const c of snapshot.components) nextComponents.set(c.id, c);

    signalMap.value = nextSignals;
    componentMap.value = nextComponents;
    routerState.value = snapshot.router;
    pluginSnapshots.value = snapshot.plugins;
    if (selectedSignalId.value !== null && !nextSignals.has(selectedSignalId.value)) {
        selectedSignalId.value = null;
    }
    if (selectedComponentId.value !== null && !nextComponents.has(selectedComponentId.value)) {
        selectedComponentId.value = null;
    }
    if (
        activeTab.value.startsWith("plugin:") &&
        !(activeTab.value.slice("plugin:".length) in snapshot.plugins)
    ) {
        activeTab.value = "components";
    }
    connected.value = true;
}

export function resetPanelState(): void {
    connected.value = false;
    signalMap.value = new Map();
    componentMap.value = new Map();
    routerState.value = null;
    pluginSnapshots.value = {};
    selectedSignalId.value = null;
    selectedComponentId.value = null;
    if (activeTab.value.startsWith("plugin:")) activeTab.value = "components";
}

export function applyBackendEvent(event: BackendEvent): void {
    switch (event.type) {
        case "hook:ready":
            break;
        case "snapshot":
            applySnapshot(event.snapshot);
            break;
        case "signal:created": {
            const next = new Map(signalMap.value);
            next.set(event.signal.id, event.signal);
            signalMap.value = next;
            break;
        }
        case "signal:written": {
            const existing = signalMap.value.get(event.id);
            const next = new Map(signalMap.value);
            next.set(event.id, {
                id: event.id,
                name: existing?.name ?? null,
                value: event.value,
                subscriberCount: event.subscriberCount,
                createdAt: existing?.createdAt ?? event.at,
                lastUpdated: event.at,
                history: [
                    ...(existing?.history ?? []),
                    { at: event.at, value: event.value },
                ].slice(-50),
            });
            signalMap.value = next;
            break;
        }
        case "component:mounted": {
            const next = new Map(componentMap.value);
            next.set(event.component.id, event.component);
            componentMap.value = next;
            break;
        }
        case "component:unmounted": {
            const next = new Map(componentMap.value);
            const removed = new Set([event.id]);
            let changed = true;
            while (changed) {
                changed = false;
                for (const component of next.values()) {
                    if (
                        component.parentId !== null &&
                        removed.has(component.parentId) &&
                        !removed.has(component.id)
                    ) {
                        removed.add(component.id);
                        changed = true;
                    }
                }
            }
            for (const id of removed) next.delete(id);
            componentMap.value = next;
            if (selectedComponentId.value !== null && removed.has(selectedComponentId.value)) {
                selectedComponentId.value = null;
            }
            break;
        }
        case "plugin:event": {
            const next = { ...pluginSnapshots.value };
            if (event.payload === undefined) delete next[event.pluginId];
            else next[event.pluginId] = event.payload;
            pluginSnapshots.value = next;
            if (event.payload === undefined && activeTab.value === `plugin:${event.pluginId}`) {
                activeTab.value = "components";
            }
            break;
        }
    }
}
