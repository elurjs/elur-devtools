import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface FakePort {
    messages: unknown[];
    messageListeners: Array<(message: unknown) => void>;
    disconnectListeners: Array<() => void>;
    postMessage(message: unknown): void;
    onMessage: { addListener(listener: (message: unknown) => void): void };
    onDisconnect: { addListener(listener: () => void): void };
}

function createPort(): FakePort {
    const port: FakePort = {
        messages: [],
        messageListeners: [],
        disconnectListeners: [],
        postMessage(message) {
            port.messages.push(message);
        },
        onMessage: {
            addListener(listener) {
                port.messageListeners.push(listener);
            },
        },
        onDisconnect: {
            addListener(listener) {
                port.disconnectListeners.push(listener);
            },
        },
    };
    return port;
}

let navigationListener: (() => void) | undefined;

beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    navigationListener = undefined;
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

function installChrome(connect: () => FakePort): void {
    vi.stubGlobal("chrome", {
        runtime: { connect },
        devtools: {
            inspectedWindow: { tabId: 7 },
            network: {
                onNavigated: {
                    addListener(listener: () => void) {
                        navigationListener = listener;
                    },
                },
            },
        },
    });
}

describe("panel bridge", () => {
    it("registers the tab before sending the protocol handshake", async () => {
        const port = createPort();
        installChrome(() => port);

        await import("./bridge.js");

        expect(port.messages).toEqual([
            { type: "init", tabId: 7 },
            {
                source: "elur-devtools-extension",
                v: 1,
                payload: { type: "handshake:init" },
            },
        ]);
    });

    it("queues commands until the service worker reconnects", async () => {
        const port = createPort();
        let available = false;
        installChrome(() => {
            if (!available) throw new Error("worker unavailable");
            return port;
        });
        const bridge = await import("./bridge.js");

        bridge.sendCommand({ type: "signal:set-value", id: 3, value: 42 });
        available = true;
        await vi.advanceTimersByTimeAsync(1000);

        expect(port.messages).toContainEqual({
            source: "elur-devtools-extension",
            v: 1,
            payload: { type: "signal:set-value", id: 3, value: 42 },
        });
    });

    it("notifies listeners when the inspected page navigates", async () => {
        const port = createPort();
        installChrome(() => port);
        const bridge = await import("./bridge.js");
        const listener = vi.fn();
        bridge.onPageNavigated(listener);

        navigationListener?.();

        expect(listener).toHaveBeenCalledOnce();
    });
});
