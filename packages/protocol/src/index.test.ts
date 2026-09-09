import { describe, expect, it } from "vitest";
import {
    BACKEND_SOURCE,
    ELUR_DEVTOOLS_PROTOCOL_VERSION,
    EXTENSION_SOURCE,
    isBackendEnvelope,
    isCommandEnvelope,
} from "./index.js";

describe("protocol envelope guards", () => {
    it("accepts valid backend and command envelopes", () => {
        expect(
            isBackendEnvelope({
                source: BACKEND_SOURCE,
                v: ELUR_DEVTOOLS_PROTOCOL_VERSION,
                payload: { type: "hook:ready" },
            }),
        ).toBe(true);
        expect(
            isCommandEnvelope({
                source: EXTENSION_SOURCE,
                v: ELUR_DEVTOOLS_PROTOCOL_VERSION,
                payload: { type: "get:snapshot" },
            }),
        ).toBe(true);
    });

    it.each([null, [], {}, { type: 1 }])("rejects invalid payload %j", (payload) => {
        expect(
            isBackendEnvelope({
                source: BACKEND_SOURCE,
                v: ELUR_DEVTOOLS_PROTOCOL_VERSION,
                payload,
            }),
        ).toBe(false);
        expect(
            isCommandEnvelope({
                source: EXTENSION_SOURCE,
                v: ELUR_DEVTOOLS_PROTOCOL_VERSION,
                payload,
            }),
        ).toBe(false);
    });

    it("rejects wrong sources and protocol versions", () => {
        expect(
            isBackendEnvelope({
                source: EXTENSION_SOURCE,
                v: ELUR_DEVTOOLS_PROTOCOL_VERSION,
                payload: { type: "hook:ready" },
            }),
        ).toBe(false);
        expect(
            isCommandEnvelope({
                source: EXTENSION_SOURCE,
                v: ELUR_DEVTOOLS_PROTOCOL_VERSION + 1,
                payload: { type: "get:snapshot" },
            }),
        ).toBe(false);
    });
});
