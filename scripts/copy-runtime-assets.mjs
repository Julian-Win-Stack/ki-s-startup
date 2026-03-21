import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const ASSETS_DEST = path.join(ROOT, "dist", "assets");
await fs.mkdir(ASSETS_DEST, { recursive: true });
await fs.copyFile(path.join(ROOT, "node_modules", "htmx.org", "dist", "htmx.min.js"), path.join(ASSETS_DEST, "htmx.min.js"));
await fs.copyFile(path.join(ROOT, "src", "client", "factory-client.js"), path.join(ASSETS_DEST, "factory-client.js"));
