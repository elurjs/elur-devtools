/**
 * Best-effort signal naming via the Vite plugin HMR runtime.
 *
 * In dev, `@elurjs/vite-plugin-elur` keeps `window.__elurHmrRuntime.signals`
 * (a `Map<stableId, { id, signal }>`) with ids like `src/store.ts:count`.
 * Matching by object identity lets the panel show real names instead of
 * `signal #N` without any compile-time metadata.
 */

interface HmrSignalRecord {
    id: string;
    signal: unknown;
}

interface HmrRuntimeLike {
    signals?: Map<string, HmrSignalRecord>;
}

declare global {
    interface Window {
        __elurHmrRuntime?: HmrRuntimeLike;
    }
}

export type SignalNameResolver = (signal: object) => string | null;

export function createSignalNameResolver(): SignalNameResolver {
    const cache = new WeakMap<object, string>();
    let scannedSignals: Map<string, HmrSignalRecord> | null = null;
    let scannedSize = -1;

    function rescan(): void {
        if (typeof window === "undefined") return;
        const runtime = window.__elurHmrRuntime;
        const signals = runtime?.signals;
        if (
            !(signals instanceof Map) ||
            (signals === scannedSignals && signals.size === scannedSize)
        ) {
            return;
        }
        scannedSignals = signals;
        scannedSize = signals.size;
        for (const record of signals.values()) {
            const sig = record?.signal;
            if (sig && typeof sig === "object" && !cache.has(sig)) {
                cache.set(sig, record.id);
            }
        }
    }

    return (signal: object) => {
        const cached = cache.get(signal);
        if (cached !== undefined) return cached;
        rescan();
        return cache.get(signal) ?? null;
    };
}
