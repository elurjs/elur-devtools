/**
 * Side-effect entry: installs the backend as soon as the module is imported.
 *
 * Usage in an app entry point (dev only):
 *   import "@elurjs/devtools-backend/auto";
 */
import {
    installElurDevToolsBackend,
    type ElurDevToolsBackendHandle,
} from "./index.js";

if (typeof window !== "undefined") {
    const key = "__ELUR_DEVTOOLS_BACKEND_HANDLE__";
    const target = window as unknown as Record<string, unknown>;
    (target[key] as ElurDevToolsBackendHandle | undefined)?.uninstall();
    target[key] = installElurDevToolsBackend();
}
