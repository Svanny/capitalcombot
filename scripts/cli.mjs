#!/usr/bin/env node
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { callRunningApp } from "./cli/client.mjs";
import { HELP, parseCommand } from "./cli/commands.mjs";

async function main() {
  const command = parseCommand(process.argv.slice(2));
  if (command.help) {
    stdout.write(HELP);
    return;
  }

  let confirmed = command.assumeYes;
  if (command.requiresConfirmation && !confirmed) {
    if (!stdin.isTTY || !stdout.isTTY) {
      throw new Error("This action requires confirmation. Re-run it with --yes for non-interactive use.");
    }
    const terminal = createInterface({ input: stdin, output: stdout });
    const answer = await terminal.question(`Confirm ${command.method}? [y/N] `);
    terminal.close();
    confirmed = answer.trim().toLowerCase() === "y" || answer.trim().toLowerCase() === "yes";
    if (!confirmed) throw new Error("Command cancelled.");
  }

  const result = await callRunningApp({
    method: command.method,
    input: command.input,
    confirmed,
  });
  stdout.write(`${JSON.stringify(result, null, command.compact ? 0 : 2)}\n`);
}

main().catch((error) => {
  const code = error && typeof error === "object" && "code" in error ? `${error.code}: ` : "";
  process.stderr.write(`${code}${error instanceof Error ? error.message : String(error)}\n`);
  if (error && typeof error === "object" && "detail" in error && error.detail) {
    process.stderr.write(`${error.detail}\n`);
  }
  process.exitCode = 1;
});
