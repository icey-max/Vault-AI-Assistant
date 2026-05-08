import esbuild from "esbuild";
import { spawnSync } from "node:child_process";
import { readdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";

const tempDir = await mkdtemp(path.join(tmpdir(), "vault-ai-chat-tests-"));
const entrypoint = path.join(tempDir, "chat-tests-entry.mjs");
const outfile = path.join(tempDir, "chat-tests.cjs");
const testPatterns = ["chat-*.test.ts", "vault-*.test.ts", "system-prompts.test.ts"];
const nodeTestCommand = "node --test";
const testRegexes = testPatterns.map(
  (pattern) => new RegExp(`^${pattern.replace(".", "\\.").replace("*", ".*")}$`)
);

try {
  const testFiles = (await readdir("test"))
    .filter((file) => testRegexes.some((testRegex) => testRegex.test(file)))
    .map((file) => path.join("test", file));

  await writeFile(
    entrypoint,
    testFiles.map((file) => `import ${JSON.stringify(path.resolve(file))};`).join("\n")
  );

  await esbuild.build({
    entryPoints: [entrypoint],
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node18",
    outfile,
    external: ["node:*"]
  });

  const result = spawnSync(process.execPath, [outfile], {
    encoding: "utf8",
    env: { ...process.env, NODE_TEST_COMMAND: nodeTestCommand }
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
