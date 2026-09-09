/**
 * Bridge between the devtools panel and the background worker.
 * The panel identifies itself with the inspected tab id on connect.
 *
 * MV3 service workers are killed after ~30s of inactivity, which silently
 * severs the port. Both sides reconnect: on disconnect we wait briefly and
 * open a fresh port, then re-run the handshake so the backend re-sends a
 * full snapshot.
 */
import {
    ELUR_DEVTOOLS_PROTOCOL_VERSION,
    EXTENSION_SOURCE,
    isBackendEnvelope,
} from "@elurjs/devtools-protocol";
import type { BackendEvent, DevtoolsCommand } from "@elurjs/devtools-protocol";

const tabId = chrome.devtools.inspectedWindow.tabId;

type Listener = (event: BackendEvent) => void;
type VoidListener = () => void;
const listeners = new Set<Listener>();
const disconnectListeners = new Set<VoidListener>();
const navigationListeners = new Set<VoidListener>();

let port: chrome.runtime.Port | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
const pendingCommands: DevtoolsCommand[] = [];

function postCommand(target: chrome.runtime.Port, payload: DevtoolsCommand): boolean {
    try {
        target.postMessage({
            source: EXTENSION_SOURCE,
            v: ELUR_DEVTOOLS_PROTOCOL_VERSION,
            payload,
        });
        return true;
    } catch {
        return false;
    }
}

function queueCommand(command: DevtoolsCommand): void {
    if (command.type === "get:snapshot" && pendingCommands.some((item) => item.type === command.type)) {
        return;
    }
    if (command.type === "signal:set-value") {
        const index = pendingCommands.findIndex(
            (item) => item.type === "signal:set-value" && item.id === command.id,
        );
        if (index >= 0) pendingCommands.splice(index, 1);
    }
    pendingCommands.push(command);
}

function connect(): void {
    if (port) return;
    if (reconnectTimer != null) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }

    let nextPort: chrome.runtime.Port;
    try {
        nextPort = chrome.runtime.connect({ name: "elur-devtools-panel" });
    } catch {
        scheduleReconnect();
        return;
    }
    port = nextPort;

    nextPort.onMessage.addListener((envelope: unknown) => {
        if (!isBackendEnvelope(envelope)) return;
        for (const listener of listeners) listener(envelope.payload);
    });

    nextPort.onDisconnect.addListener(() => {
        if (port !== nextPort) return;
        port = null;
        for (const listener of disconnectListeners) listener();
        scheduleReconnect();
    });

    try {
        nextPort.postMessage({ type: "init", tabId });
    } catch {
        if (port === nextPort) port = null;
        scheduleReconnect();
        return;
    }
    // Re-handshake on every (re)connect so the page backend re-sends its snapshot.
    if (!postCommand(nextPort, { type: "handshake:init" })) {
        if (port === nextPort) port = null;
        scheduleReconnect();
        return;
    }
    while (pendingCommands.length > 0) {
        const command = pendingCommands.shift();
        if (!command) break;
        if (!postCommand(nextPort, command)) {
            pendingCommands.unshift(command);
            if (port === nextPort) port = null;
            scheduleReconnect();
            return;
        }
    }
}

function scheduleReconnect(): void {
    if (reconnectTimer != null) return;
    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
    }, 1000);
}

export function onBackendEvent(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

export function onBridgeDisconnect(listener: VoidListener): () => void {
    disconnectListeners.add(listener);
    return () => disconnectListeners.delete(listener);
}

export function onPageNavigated(listener: VoidListener): () => void {
    navigationListeners.add(listener);
    return () => navigationListeners.delete(listener);
}

export function sendCommand(payload: DevtoolsCommand): void {
    if (port && postCommand(port, payload)) return;
    queueCommand(payload);
    port = null;
    connect();
}

chrome.devtools.network.onNavigated.addListener(() => {
    for (const listener of navigationListeners) listener();
});

connect();
