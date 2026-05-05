import esbuild from "esbuild";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";

const tempDir = await mkdtemp(path.join(tmpdir(), "vault-ai-context-tests-"));
const outfile = path.join(tempDir, "context-utils.test.cjs");

try {
  await esbuild.build({
    entryPoints: ["test/context-utils.test.ts"],
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node18",
    outfile,
    external: ["node:*"]
  });

  const result = spawnSync(process.execPath, ["--test", outfile], {
    encoding: "utf8"
  });

  if (result.stdout) {
    process.stdout.write(result.stdout);
  }

  if (result.stderr) {
    process.stderr.write(result.stderr);
  }

  process.exit(result.status ?? 1);
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
