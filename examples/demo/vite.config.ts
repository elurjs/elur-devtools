import { defineConfig } from "vite";
import elurJsPlugin from "@elurjs/vite-plugin-elur";

// `devtools: "auto"` (the default) injects @elurjs/devtools-backend and the
// @elurjs/query devtools plugin into index.html during `vite dev` only.
// Production builds are untouched.
export default defineConfig({
    plugins: [elurJsPlugin()],
    resolve: {
        // This workspace links local checkouts of elur packages; some of them
        // carry their own nested copy of @elurjs/core in their node_modules.
        // Dedupe so the app always runs a single core instance.
        dedupe: ["@elurjs/core"],
    },
});
