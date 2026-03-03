import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

const ROOT = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));

type CommandResult = {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
};

const runCommand = (command: string, args: readonly string[]): Promise<CommandResult> =>
  new Promise((resolve, reject) => {
    const child = spawn(command, [...args], {
      cwd: ROOT,
      env: process.env,
      stdio: "pipe",
    });

    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf-8");
    child.stderr.setEncoding("utf-8");

    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
  });

test("smoke: project builds", { timeout: 180_000 }, async () => {
  const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
  const result = await runCommand(npmCmd, ["run", "build"]);

  assert.equal(
    result.code,
    0,
    `npm run build failed\nstdout:\n${result.stdout}\n\nstderr:\n${result.stderr}`
  );
});
