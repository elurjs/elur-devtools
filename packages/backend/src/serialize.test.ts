import { describe, expect, it } from "vitest";
import { serializeValue } from "./serialize.js";

describe("serializeValue", () => {
    it("keeps small JSON-safe values editable and inspectable without changing them", () => {
        const value = { title: "hello", items: [1, true, null] };

        expect(serializeValue(value)).toMatchObject({
            type: "object",
            editable: true,
            value,
            inspection: value,
        });
    });

    it("does not expose truncated values as editable", () => {
        const longString = "x".repeat(201);
        const longArray = Array.from({ length: 26 }, (_, index) => index);
        const largeObject = Object.fromEntries(
            Array.from({ length: 26 }, (_, index) => [`key${index}`, index]),
        );

        expect(serializeValue(longString)).toMatchObject({ editable: false, inspection: expect.any(String) });
        expect(serializeValue(longArray)).toMatchObject({ editable: false, inspection: expect.any(Array) });
        expect(serializeValue(largeObject)).toMatchObject({
            editable: false,
            inspection: expect.any(Object),
        });
    });

    it("keeps common nested arrays and objects editable on their first snapshot", () => {
        const users = [
            {
                id: 1,
                profile: {
                    location: "London",
                    skills: ["Mathematics", "Algorithms"],
                    preferences: { notifications: { email: true } },
                },
            },
        ];

        expect(serializeValue(users)).toMatchObject({ editable: true, value: users });
        expect(serializeValue({ settings: users[0] })).toMatchObject({
            editable: true,
            value: { settings: users[0] },
        });
    });

    it("does not expose lossy circular or unsupported nested values as editable", () => {
        const circular: { self?: unknown } = {};
        circular.self = circular;

        expect(serializeValue(circular).editable).toBe(false);
        expect(serializeValue({ missing: undefined }).editable).toBe(false);
        expect(serializeValue([1, undefined]).editable).toBe(false);
    });
});
