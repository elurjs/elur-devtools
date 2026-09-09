/**
 * Background service worker: routes messages between the content script
 * attached to a tab and the devtools panels inspecting that tab.
 *
 * Topology per tab: panel <-port-> background <-port-> content script.
 */
(function () {
    "use strict";

    /** @type {Map<number, chrome.runtime.Port>} tabId -> content script port */
    const contentPorts = new Map();
    /** @type {Map<number, Set<chrome.runtime.Port>>} tabId -> panel ports */
    const panelPorts = new Map();

    chrome.runtime.onConnect.addListener((port) => {
        if (port.name === "elur-devtools-content") {
            const tabId = port.sender && port.sender.tab && port.sender.tab.id;
            if (tabId == null) return;

            contentPorts.set(tabId, port);

            port.onMessage.addListener((message) => {
                const panels = panelPorts.get(tabId);
                if (!panels) return;
                for (const panel of panels) {
                    try {
                        panel.postMessage(message);
                    } catch {
                        // panel closed mid-delivery
                    }
                }
            });

            port.onDisconnect.addListener(() => {
                if (contentPorts.get(tabId) === port) contentPorts.delete(tabId);
            });
            return;
        }

        if (port.name === "elur-devtools-panel") {
            let tabId = null;

            port.onMessage.addListener((message) => {
                // First message from a panel carries the inspected tab id.
                if (message && message.type === "init" && typeof message.tabId === "number") {
                    tabId = message.tabId;
                    let set = panelPorts.get(tabId);
                    if (!set) {
                        set = new Set();
                        panelPorts.set(tabId, set);
                    }
                    set.add(port);
                    return;
                }
                // Everything else is a command for the page backend.
                if (tabId == null) return;
                const content = contentPorts.get(tabId);
                if (content) {
                    try {
                        content.postMessage(message);
                    } catch {
                        // tab navigated away mid-delivery
                    }
                }
            });

            port.onDisconnect.addListener(() => {
                if (tabId == null) return;
                const set = panelPorts.get(tabId);
                if (!set) return;
                set.delete(port);
                if (set.size === 0) panelPorts.delete(tabId);
            });
        }
    });
})();
