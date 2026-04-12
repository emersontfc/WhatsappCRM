/**
 * Load repo-root `.env` before any module reads `process.env`.
 * Under Vite middleware restarts, `process.cwd()` may not be the project root; `import.meta.url` is stable.
 */
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const backendDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(backendDir, "..");
const envPath = path.join(rootDir, ".env");

if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath, override: false });
} else {
  dotenv.config({ override: false });
}
