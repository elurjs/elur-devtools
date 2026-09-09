import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
    base: "./",
    publicDir: "public",
    build: {
        outDir: "dist",
        emptyOutDir: true,
        target: "es2022",
        rollupOptions: {
            input: {
                panel: fileURLToPath(new URL("./panel/index.html", import.meta.url)),
            },
        },
    },
});
