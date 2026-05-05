import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const targetDirValue = process.env.TEST_VAULT_PLUGIN_DIR;

if (!targetDirValue) {
  console.error("TEST_VAULT_PLUGIN_DIR is required");
  process.exit(1);
}

const projectRoot = process.cwd();
const targetDir = path.resolve(targetDirValue);

if (
  targetDir === path.parse(targetDir).root ||
  targetDir === projectRoot ||
  path.basename(targetDir) !== "vault-ai-assistant"
) {
  console.error("TEST_VAULT_PLUGIN_DIR must end with vault-ai-assistant and must not be the project root");
  process.exit(1);
}

await mkdir(targetDir, { recursive: true });

for (const file of ["main.js", "manifest.json", "styles.css"]) {
  await copyFile(path.join(projectRoot, file), path.join(targetDir, file));
}

console.log(`Copied Vault AI Assistant plugin to ${targetDir}`);
