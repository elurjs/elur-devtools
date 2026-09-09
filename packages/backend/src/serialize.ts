import type { SerializedValue, SerializedValueType } from "@elurjs/devtools-protocol";

const MAX_DEPTH = 8;
const MAX_INSPECTION_DEPTH = 8;
const MAX_KEYS = 25;
const MAX_ITEMS = 25;
const MAX_STRING = 200;
const MAX_PREVIEW = 120;

function truncate(text: string, max = MAX_PREVIEW): string {
    return text.length > max ? text.slice(0, max - 1) + "…" : text;
}

function isDomNode(value: unknown): boolean {
    return (
        typeof Node !== "undefined" &&
        value instanceof Node
    );
}

function isPromiseLike(value: unknown): boolean {
    return (
        typeof value === "object" &&
        value !== null &&
        typeof (value as { then?: unknown }).then === "function"
    );
}

/**
 * Produces a JSON-safe copy of `value` (depth-limited, circular-safe).
 * Returns `undefined` when the value is not safely copyable.
 */
function toJsonSafe(value: unknown, depth: number, seen: WeakSet<object>): unknown {
    if (value === null) return null;
    if (typeof value === "string") {
        return value.length > MAX_STRING ? undefined : value;
    }
    if (typeof value === "number" || typeof value === "boolean") return value;
    if (typeof value !== "object") return undefined;

    if (isDomNode(value) || isPromiseLike(value)) return undefined;

    const obj = value as object;
    if (seen.has(obj)) return undefined;
    if (depth >= MAX_DEPTH) return undefined;

    seen.add(obj);
    try {
        if (Array.isArray(value)) {
            if (value.length > MAX_ITEMS) return undefined;
            const out: unknown[] = [];
            for (let i = 0; i < value.length; i++) {
                const copy = toJsonSafe(value[i], depth + 1, seen);
                if (copy === undefined) return undefined;
                out.push(copy);
            }
            return out;
        }
        if (value instanceof Map || value instanceof Set) return undefined;
        if (value instanceof Date) return value.toISOString();
        if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
            // Class instance: not safely writable back.
            return undefined;
        }
        const out: Record<string, unknown> = {};
        const keys = Object.keys(value as Record<string, unknown>);
        if (keys.length > MAX_KEYS) return undefined;
        for (const key of keys) {
            const copy = toJsonSafe((value as Record<string, unknown>)[key], depth + 1, seen);
            if (copy === undefined) return undefined;
            out[key] = copy;
        }
        return out;
    } finally {
        seen.delete(obj);
    }
}

function toInspection(value: unknown, depth: number, seen: WeakSet<object>): unknown {
    if (value === null) return null;
    if (typeof value === "string") return truncate(value, MAX_STRING);
    if (typeof value === "number" || typeof value === "boolean") return value;
    if (typeof value === "undefined") return "undefined";
    if (typeof value === "bigint") return `${value}n`;
    if (typeof value === "symbol") return String(value);
    if (typeof value === "function") return `[Function ${(value as { name?: string }).name ?? "anonymous"}]`;
    if (isDomNode(value)) {
        const node = value as Element;
        const tag = node.tagName?.toLowerCase() ?? "node";
        return `<${tag}${(node as HTMLElement).id ? `#${(node as HTMLElement).id}` : ""}>`;
    }
    if (isPromiseLike(value)) return "Promise {…}";
    if (value instanceof Date) return value.toISOString();
    if (depth >= MAX_INSPECTION_DEPTH) return "[Max depth]";

    const object = value as object;
    if (seen.has(object)) return "[Circular]";
    seen.add(object);
    try {
        if (Array.isArray(value)) {
            const items = value
                .slice(0, MAX_ITEMS)
                .map((item) => toInspection(item, depth + 1, seen));
            if (value.length > MAX_ITEMS) items.push(`[… ${value.length - MAX_ITEMS} more items]`);
            return items;
        }
        if (value instanceof Map) {
            return Array.from(value.entries())
                .slice(0, MAX_ITEMS)
                .map(([key, item]) => [
                    toInspection(key, depth + 1, seen),
                    toInspection(item, depth + 1, seen),
                ]);
        }
        if (value instanceof Set) {
            return Array.from(value.values())
                .slice(0, MAX_ITEMS)
                .map((item) => toInspection(item, depth + 1, seen));
        }

        const output: Record<string, unknown> = {};
        const keys = Object.keys(value as Record<string, unknown>);
        for (const key of keys.slice(0, MAX_KEYS)) {
            try {
                output[key] = toInspection(
                    (value as Record<string, unknown>)[key],
                    depth + 1,
                    seen,
                );
            } catch {
                output[key] = "[Unreadable]";
            }
        }
        if (keys.length > MAX_KEYS) output["…"] = `${keys.length - MAX_KEYS} more keys`;
        return output;
    } finally {
        seen.delete(object);
    }
}

function previewOf(value: unknown, type: SerializedValueType): string {
    switch (type) {
        case "primitive":
            if (typeof value === "string") return truncate(JSON.stringify(value));
            return truncate(String(value));
        case "array": {
            const copy = toJsonSafe(value, MAX_DEPTH - 1, new WeakSet());
            return copy === undefined
                ? `Array(${(value as unknown[]).length})`
                : truncate(`Array(${(value as unknown[]).length}) ${JSON.stringify(copy)}`);
        }
        case "function": {
            const name = (value as { name?: string }).name;
            return name ? `ƒ ${name}()` : "ƒ ()";
        }
        case "dom": {
            const el = value as Element;
            const tag = el.tagName ? el.tagName.toLowerCase() : "node";
            const id = (el as HTMLElement).id ? `#${(el as HTMLElement).id}` : "";
            return `<${tag}${id}>`;
        }
        case "promise":
            return "Promise {…}";
        case "object":
            return truncate(JSON.stringify(toJsonSafe(value, MAX_DEPTH - 1, new WeakSet())) ?? "{…}");
        default:
            try {
                return truncate(String(value));
            } catch {
                return "[unserializable]";
            }
    }
}

function typeOf(value: unknown): SerializedValueType {
    if (value === null) return "primitive";
    const t = typeof value;
    if (t === "string" || t === "number" || t === "boolean" || t === "undefined" || t === "bigint") {
        return "primitive";
    }
    if (t === "function") return "function";
    if (t === "symbol") return "other";
    if (isDomNode(value)) return "dom";
    if (isPromiseLike(value)) return "promise";
    if (Array.isArray(value)) return "array";
    if (value instanceof Date || value instanceof Map || value instanceof Set) return "other";
    if (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null) {
        return "object";
    }
    return "other";
}

/**
 * Serializes an arbitrary runtime value into a panel-friendly shape.
 * Never throws: devtools must survive inspecting hostile objects.
 */
export function serializeValue(value: unknown): SerializedValue {
    try {
        const type = typeOf(value);
        const copy = toJsonSafe(value, 0, new WeakSet());
        const editable = copy !== undefined && (type === "primitive" || type === "array" || type === "object");
        const result: SerializedValue = {
            type,
            preview: previewOf(value, type),
            editable,
            inspection: toInspection(value, 0, new WeakSet()),
        };
        if (editable) result.value = copy;
        return result;
    } catch {
        return { type: "other", preview: "[serialization error]", editable: false };
    }
}
