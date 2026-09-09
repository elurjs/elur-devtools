import { beforeEach, describe, expect, it, vi } from "vitest";

const bridge = vi.hoisted(() => ({
    sendCommand: vi.fn(),
}));

vi.mock("./bridge.js", () => ({
    onBackendEvent: vi.fn(() => () => undefined),
    onBridgeDisconnect: vi.fn(() => () => undefined),
    onPageNavigated: vi.fn(() => () => undefined),
    sendCommand: bridge.sendCommand,
}));

async function flushDom(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
}

beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
    bridge.sendCommand.mockClear();
});

describe("devtools panel", () => {
    it("renders valid indentation and keeps keyed signal rows live", async () => {
        const state = await import("./state.js");
        state.resetPanelState();
        await import("./main.js");

        state.applyBackendEvent({
            type: "snapshot",
            snapshot: {
                signals: [
                    {
                        id: 1,
                        name: "count",
                        value: { type: "primitive", preview: "0", editable: true, value: 0 },
                        subscriberCount: 1,
                        createdAt: 1,
                        lastUpdated: 1,
                        history: [],
                    },
                    {
                        id: 2,
                        name: "items",
                        value: {
                            type: "array",
                            preview: "Array(2)",
                            editable: true,
                            value: ["alpha", { id: 2 }],
                            inspection: ["alpha", { id: 2 }],
                        },
                        subscriberCount: 0,
                        createdAt: 0,
                        lastUpdated: 0,
                        history: [],
                    },
                ],
                components: [
                    {
                        id: 1,
                        parentId: null,
                        name: "App",
                        mountedAt: 1,
                        hasDefaultSlot: false,
                        slotNames: [],
                        props: {},
                    },
                    {
                        id: 2,
                        parentId: 1,
                        name: "Child",
                        mountedAt: 2,
                        hasDefaultSlot: false,
                        slotNames: [],
                        props: {},
                    },
                ],
                router: null,
                plugins: {
                    "@elurjs/query": {
                        cacheTime: 300000,
                        activeQueryCount: 1,
                        inflight: [],
                        cache: [
                            {
                                key: "users/list",
                                fetchedAt: 1,
                                ageMs: 20,
                                subscribers: 1,
                                dataPreview: '[{"id":1,"name":"Ada"}]',
                                data: [{ id: 1, name: "Ada" }],
                            },
                        ],
                        commands: [],
                    },
                },
            },
        });
        await flushDom();

        const componentRows = Array.from(document.querySelectorAll<HTMLButtonElement>(".row"));
        expect(componentRows[1]?.style.paddingLeft).toBe("24px");

        const signalsTab = Array.from(document.querySelectorAll<HTMLButtonElement>(".tab")).find(
            (button) => button.textContent?.trim() === "Signals",
        );
        signalsTab?.click();
        await flushDom();

        expect(document.querySelector(".sig-value")?.textContent).toBe("0");

        state.applyBackendEvent({
            type: "signal:written",
            id: 1,
            value: { type: "primitive", preview: "2", editable: true, value: 2 },
            at: 2,
            subscriberCount: 3,
        });
        await flushDom();

        expect(document.querySelector(".sig-value")?.textContent).toBe("2");
        expect(document.querySelector(".row .muted")?.textContent).toContain("3 subs");

        const signalRows = Array.from(document.querySelectorAll<HTMLButtonElement>(".row"));
        const countRow = signalRows.find(
            (button) => button.querySelector(".sig-name")?.textContent === "count",
        );
        countRow?.click();
        await flushDom();
        expect(document.querySelector<HTMLTextAreaElement>(".editor")?.value).toBe("2");

        const arrayRow = signalRows.find(
            (button) => button.querySelector(".sig-name")?.textContent === "items",
        );
        arrayRow?.click();
        await flushDom();
        expect(document.querySelector<HTMLTextAreaElement>(".editor")?.value).toContain('"alpha"');
        expect(document.querySelector(".value-block")?.textContent).toContain('"alpha"');

        const queryTab = Array.from(document.querySelectorAll<HTMLButtonElement>(".tab")).find(
            (button) => button.textContent?.trim() === "query",
        );
        queryTab?.click();
        await flushDom();

        expect(document.body.textContent).toContain("users/list");
        expect(document.body.textContent).toContain("Ada");
        const refetch = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
            (button) => button.textContent?.trim() === "Refetch",
        );
        refetch?.click();
        expect(bridge.sendCommand).toHaveBeenCalledWith({
            type: "plugin:command",
            pluginId: "@elurjs/query",
            command: { type: "refetch", key: "users/list" },
        });
    });
});
