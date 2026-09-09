import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "packages/extension/dist");
const release = join(root, "release");
const manifestPath = join(dist, "manifest.json");

function fail(message) {
    console.error(`Extension package error: ${message}`);
    process.exit(1);
}

function walk(directory) {
    return readdirSync(directory, { withFileTypes: true })
        .flatMap((entry) => {
            const path = join(directory, entry.name);
            return entry.isDirectory() ? walk(path) : [relative(dist, path).replaceAll("\\", "/")];
        })
        .sort();
}

function pngSize(path) {
    const data = readFileSync(path);
    if (data.length < 24 || data.toString("ascii", 1, 4) !== "PNG") fail(`${path} is not a PNG`);
    return [data.readUInt32BE(16), data.readUInt32BE(20)];
}

if (!existsSync(manifestPath)) fail("dist/manifest.json is missing; run the extension build first");

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
if (manifest.manifest_version !== 3) fail("manifest_version must be 3");
if (!/^\d+\.\d+\.\d+(?:\.\d+)?$/.test(manifest.version ?? "")) {
    fail(`invalid manifest version: ${String(manifest.version)}`);
}

const required = [
    "manifest.json",
    "background.js",
    "content-script.js",
    "devtools.html",
    "devtools.js",
    "panel/index.html",
    "icons/icon-16.png",
    "icons/icon-32.png",
    "icons/icon-48.png",
    "icons/icon-128.png",
];
for (const file of required) {
    if (!existsSync(join(dist, file))) fail(`required file is missing: ${file}`);
}

for (const size of [16, 32, 48, 128]) {
    const dimensions = pngSize(join(dist, `icons/icon-${size}.png`));
    if (dimensions[0] !== size || dimensions[1] !== size) {
        fail(`icon-${size}.png must be ${size}x${size}, received ${dimensions.join("x")}`);
    }
}

const files = walk(dist);
const forbidden = files.filter((file) =>
    /(^|\/)(node_modules|src|tests?|__tests__)(\/|$)|\.(map|ts|tsx|log)$/i.test(file),
);
if (forbidden.length > 0) fail(`forbidden release files: ${forbidden.join(", ")}`);

mkdirSync(release, { recursive: true });
const output = join(release, `elur-devtools-v${manifest.version}.zip`);
rmSync(output, { force: true });

const zip = spawnSync("zip", ["-X", "-q", output, ...files], {
    cwd: dist,
    encoding: "utf8",
});
if (zip.error) fail(`could not run zip: ${zip.error.message}`);
if (zip.status !== 0) fail(zip.stderr.trim() || `zip exited with status ${zip.status}`);

const bytes = statSync(output).size;
console.log(`Created ${relative(root, output)} (${(bytes / 1024).toFixed(1)} KiB, ${files.length} files)`);
