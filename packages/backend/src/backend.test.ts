import { describe, expect, it, vi } from "vitest";
import { ElurComponent, html, mount, signal } from "@elurjs/core";
import type { BackendEvent, SnapshotPayload } from "@elurjs/devtools-protocol";
import { installElurDevToolsBackend } from "./index.js";

function wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

class ChildCard extends ElurComponent {
    render() {
        return html`<span>child</span>`;
    }
}

class ParentView extends ElurComponent {
    title = "hello";
    render() {
        return html`<div>${new ChildCard()}</div>`;
    }
}

describe("installElurDevToolsBackend", () => {
    it("emits signal:created and signal:written for core signals", async () => {
        const events: BackendEvent[] = [];
        const handle = installElurDevToolsBackend({
            emit: (e) => events.push(e),
            writeBatchMs: 16,
        });
        try {
            await handle.ready;
            const count = signal(0);
            expect(events.some((e) => e.type === "hook:ready")).toBe(true);
            const created = events.find((e) => e.type === "signal:created");
            expect(created).toBeDefined();

            count.value = 42;
            await wait(50);
            const written = events.find(
                (e) => e.type === "signal:written" && (e.value.value as number) === 42,
            );
            expect(written).toBeDefined();
        } finally {
            handle.uninstall();
        }
    });

    it("tracks the mounted component tree with parent ids", async () => {
        const events: BackendEvent[] = [];
        const handle = installElurDevToolsBackend({ emit: (e) => events.push(e) });
        try {
            await handle.ready;

            const container = document.createElement("div");
            document.body.appendChild(container);
            const app = mount(new ParentView(), container);

            const mounted = events.filter((e) => e.type === "component:mounted");
            const names = mounted.map((e) => e.component.name);
            expect(names).toContain("ParentView");
            expect(names).toContain("ChildCard");

            const parent = mounted.find((e) => e.component.name === "ParentView");
            const child = mounted.find((e) => e.component.name === "ChildCard");
            expect(parent?.component.parentId).toBeNull();
            expect(child?.component.parentId).toBe(parent?.component.id);
            expect(parent?.component.props.title?.preview).toBe('"hello"');

            app.unmount();
            const unmounted = events.filter((e) => e.type === "component:unmounted");
            expect(unmounted.some((e) => e.id === parent?.component.id)).toBe(true);
            expect(unmounted.some((e) => e.id === child?.component.id)).toBe(true);

            container.remove();
        } finally {
            handle.uninstall();
        }
    });

    it("publishes the global hook and serves snapshots", async () => {
        const handle = installElurDevToolsBackend({ emit: () => undefined });
        try {
            await handle.ready;
            const hook = (window as unknown as Record<string, unknown>).__ELUR_DEVTOOLS_HOOK__ as
                | { getSnapshot(): SnapshotPayload; version: number }
                | undefined;
            expect(hook).toBeDefined();
            expect(hook?.version).toBe(1);

            const probe = signal("probe-value");
            const snapshot = hook?.getSnapshot();
            const listed = snapshot?.signals.find(
                (s) => s.value.preview === '"probe-value"',
            );
            expect(listed).toBeDefined();
            void probe;
        } finally {
            handle.uninstall();
        }
    });

    it("applies signal:set-value commands coming from the extension channel", async () => {
        const handle = installElurDevToolsBackend({ emit: () => undefined });
        try {
            await handle.ready;
            const count = signal(1);
            // Find the signal id via the hook snapshot.
            const hook = (window as unknown as Record<string, unknown>).__ELUR_DEVTOOLS_HOOK__ as {
                getSnapshot(): SnapshotPayload;
            };
            const entry = hook.getSnapshot().signals.find((s) => s.value.value === 1);
            expect(entry).toBeDefined();

            window.dispatchEvent(
                new window.MessageEvent("message", {
                    source: window,
                    data: {
                        source: "elur-devtools-extension",
                        v: 1,
                        payload: { type: "signal:set-value", id: entry?.id, value: 99 },
                    },
                }),
            );
            expect(count.value).toBe(99);
        } finally {
            handle.uninstall();
        }
    });

    it("streams plugin lifecycle and routes commands from an open panel", async () => {
        const events: BackendEvent[] = [];
        const onCommand = vi.fn();
        const handle = installElurDevToolsBackend({ emit: (event) => events.push(event) });
        try {
            await handle.ready;
            const hook = (window as unknown as Record<string, unknown>).__ELUR_DEVTOOLS_HOOK__ as {
                registerPlugin(plugin: {
                    id: string;
                    getSnapshot(): unknown;
                    onCommand(command: unknown): void;
                }): () => void;
            };
            const unregister = hook.registerPlugin({
                id: "query",
                getSnapshot: () => ({ count: 1 }),
                onCommand,
            });

            expect(events).toContainEqual({
                type: "plugin:event",
                pluginId: "query",
                payload: { count: 1 },
            });

            window.dispatchEvent(
                new window.MessageEvent("message", {
                    source: window,
                    data: {
                        source: "elur-devtools-extension",
                        v: 1,
                        payload: {
                            type: "plugin:command",
                            pluginId: "query",
                            command: { type: "invalidate", key: "users" },
                        },
                    },
                }),
            );
            await Promise.resolve();
            expect(onCommand).toHaveBeenCalledWith({ type: "invalidate", key: "users" });

            unregister();
            expect(events).toContainEqual({
                type: "plugin:event",
                pluginId: "query",
                payload: undefined,
            });
        } finally {
            handle.uninstall();
        }
    });

    it("keeps snapshots available when a custom router snapshot throws", async () => {
        const handle = installElurDevToolsBackend({
            emit: () => undefined,
            routerSnapshot: () => {
                throw new Error("router unavailable");
            },
        });
        try {
            await handle.ready;
            const hook = (window as unknown as Record<string, unknown>).__ELUR_DEVTOOLS_HOOK__ as {
                getSnapshot(): SnapshotPayload;
            };

            expect(hook.getSnapshot().router).toBeNull();
        } finally {
            handle.uninstall();
        }
    });
});
