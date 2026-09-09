/**
 * Content script: bridges the page (where the elur devtools backend lives)
 * with the extension background worker.
 *
 * page --window.postMessage--> content script --Port--> background --> panel
 * panel --> background --Port--> content script --window.postMessage--> page
 *
 * MV3 service workers are killed after ~30s of inactivity, severing the port
 * silently. On disconnect we reconnect (which also wakes the worker) and
 * re-announce the extension so the page backend re-handshakes.
 */
(function () {
    "use strict";

    var BACKEND_SOURCE = "elur-devtools-backend";
    var EXTENSION_SOURCE = "elur-devtools-extension";
    var PROTOCOL_VERSION = 1;

    var port = null;
    var reconnectTimer = null;

    function announce() {
        window.postMessage(
            {
                source: EXTENSION_SOURCE,
                v: PROTOCOL_VERSION,
                payload: { type: "handshake:init" },
            },
            "*",
        );
    }

    function scheduleReconnect() {
        if (reconnectTimer != null) return;
        reconnectTimer = setTimeout(function () {
            reconnectTimer = null;
            connect();
        }, 1000);
    }

    function connect() {
        if (port) return;
        if (reconnectTimer != null) {
            clearTimeout(reconnectTimer);
            reconnectTimer = null;
        }
        var nextPort;
        try {
            nextPort = chrome.runtime.connect({ name: "elur-devtools-content" });
        } catch {
            scheduleReconnect();
            return;
        }
        port = nextPort;

        // Extension -> page
        nextPort.onMessage.addListener(function (envelope) {
            if (
                port !== nextPort ||
                !envelope ||
                envelope.source !== EXTENSION_SOURCE ||
                envelope.v !== PROTOCOL_VERSION
            ) {
                return;
            }
            window.postMessage(envelope, "*");
        });

        nextPort.onDisconnect.addListener(function () {
            if (port !== nextPort) return;
            port = null;
            scheduleReconnect();
        });

        // Announce the extension so a backend installed later (or one that was
        // talking to a dead worker) can handshake again.
        announce();
    }

    // Page -> extension
    window.addEventListener("message", function (event) {
        if (event.source !== window || event.origin !== window.location.origin) return;
        var data = event.data;
        if (
            !data ||
            data.source !== BACKEND_SOURCE ||
            data.v !== PROTOCOL_VERSION ||
            typeof data.payload !== "object"
        ) {
            return;
        }
        if (!port) return; // reconnecting; the panel re-handshakes once back
        try {
            port.postMessage(data);
        } catch {
            port = null;
            scheduleReconnect();
        }
    });

    connect();
})();
