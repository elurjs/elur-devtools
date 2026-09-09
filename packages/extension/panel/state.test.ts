import { beforeEach, describe, expect, it } from "vitest";
import type { ComponentNode, SignalSnapshot } from "@elurjs/devtools-protocol";
import {
    activeTab,
    applyBackendEvent,
    componentMap,
    connected,
    flatComponentTree,
    pluginSnapshots,
    resetPanelState,
    selectedComponentId,
    selectedSignalId,
    signalMap,
} from "./state.js";

function component(id: number, parentId: number | null, mountedAt = id): ComponentNode {
    return {
        id,
        parentId,
        name: `Component${id}`,
        mountedAt,
        hasDefaultSlot: false,
        slotNames: [],
        props: {},
    };
}

function signalSnapshot(id: number, value: number, lastUpdated = id): SignalSnapshot {
    return {
        id,
        name: `signal${id}`,
        value: { type: "primitive", preview: String(value), editable: true, value },
        subscriberCount: 0,
        createdAt: id,
        lastUpdated,
        history: [],
    };
}

beforeEach(() => {
    resetPanelState();
    activeTab.value = "components";
});

describe("panel state", () => {
    it("applies snapshots and clears stale selections", () => {
        selectedSignalId.value = 99;
        selectedComponentId.value = 99;
        activeTab.value = "plugin:removed";

        applyBackendEvent({
            type: "snapshot",
            snapshot: {
                signals: [signalSnapshot(1, 1)],
                components: [component(1, null)],
                router: null,
                plugins: { query: { status: "ready" } },
            },
        });

        expect(connected.value).toBe(true);
        expect(signalMap.value.has(1)).toBe(true);
        expect(componentMap.value.has(1)).toBe(true);
        expect(selectedSignalId.value).toBeNull();
        expect(selectedComponentId.value).toBeNull();
        expect(activeTab.value).toBe("components");
    });

    it("updates and removes live plugin snapshots", () => {
        applyBackendEvent({ type: "plugin:event", pluginId: "query", payload: { count: 1 } });
        activeTab.value = "plugin:query";

        expect(pluginSnapshots.value.query).toEqual({ count: 1 });

        applyBackendEvent({ type: "plugin:event", pluginId: "query", payload: undefined });

        expect(pluginSnapshots.value).toEqual({});
        expect(activeTab.value).toBe("components");
    });

    it("keeps orphaned and cyclic components visible without recursing forever", () => {
        componentMap.value = new Map([
            [1, component(1, 2)],
            [2, component(2, 1)],
            [3, component(3, 99)],
        ]);

        expect(flatComponentTree.value.map((row) => row.node.id)).toEqual([3, 1, 2]);
    });

    it("removes a component subtree and its selection", () => {
        componentMap.value = new Map([
            [1, component(1, null)],
            [2, component(2, 1)],
            [3, component(3, 2)],
        ]);
        selectedComponentId.value = 3;

        applyBackendEvent({ type: "component:unmounted", id: 1, at: 10 });

        expect(componentMap.value.size).toBe(0);
        expect(selectedComponentId.value).toBeNull();
    });
});
