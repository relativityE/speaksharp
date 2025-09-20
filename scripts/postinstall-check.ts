// scripts/postinstall-check.js
import { existsSync } from "fs";
import { execSync } from "child_process";
import path from "path";

const isCI = process.env.CI === "true";
const cacheDir = path.join(process.cwd(), "node_modules", ".cache", "ms-playwright");

if (isCI || !existsSync(cacheDir)) {
  console.log(`🧩 ${isCI ? "CI mode —" : ""} Installing Playwright browsers...`);
  execSync("pnpm exec playwright install --with-deps", { stdio: "inherit" });
} else {
  console.log("✅ Playwright browsers already installed — skipping.");
}
