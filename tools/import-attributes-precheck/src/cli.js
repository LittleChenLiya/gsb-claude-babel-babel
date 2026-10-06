#!/usr/bin/env node
/**
 * @file CLI for the import-attributes pre-check.
 *
 * Usage:
 *   node src/cli.js --dialect attributes file1.js file2.mjs ...
 *   node src/cli.js --dialect assertions --json file.js
 *
 * Flags:
 *   --dialect <attributes|assertions>  Plugin-mode dialect (required).
 *   --parser-path <dir>                Extra location to resolve
 *                                      @babel/parser from.
 *   --json                             Emit the raw JSON report instead
 *                                      of a human-readable report.
 *   --quiet                            Report dialect only on stderr.
 *
 * The source files are read but never modified or executed.
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadParser, precheckSource, resolveDialect } from "./index.js";

function parseArgs(argv) {
  const args = { dialect: null, parserPath: null, json: false, quiet: false, files: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dialect") args.dialect = argv[++i];
    else if (arg === "--parser-path") args.parserPath = argv[++i];
    else if (arg === "--json") args.json = true;
    else if (arg === "--quiet") args.quiet = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else if (arg.startsWith("--")) throw new Error(`Unknown flag: ${arg}`);
    else args.files.push(arg);
  }
  return args;
}

const HELP = [
  "import-attributes-precheck - explicit duplicate-key pre-check",
  "",
  "Usage: cli.js --dialect <attributes|assertions> [--json] [--parser-path DIR] FILE ...",
  "",
  "Dialects map 1:1 to Babel parser plugins and never share semantics:",
  "  attributes  plugin importAttributes, clause `with`, option key `with`",
  "  assertions  plugin importAssertions, clause `assert`, option key `assert`",
].join("\n");

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(HELP + "\n");
    return;
  }
  if (!args.dialect) throw new Error("Missing required --dialect flag.");
  if (args.files.length === 0) throw new Error("No input files.");

  const dialect = resolveDialect(args.dialect);
  const parser = await loadParser(args.parserPath ? { parserPath: resolve(args.parserPath) } : {});

  const reports = [];
  for (const file of args.files) {
    const code = await readFile(file, "utf8");
    reports.push(precheckSource(code, { parser, dialect, filename: file }));
  }

  // Dialect is reported on its own line/section, never mixed in with
  // per-file findings.
  const summary = {
    dialect: dialect.id,
    files: reports.length,
    duplicates: reports.reduce((n, r) => n + r.duplicates.length, 0),
    unconfirmable: reports.reduce((n, r) => n + r.unconfirmable.length, 0),
    expressionsEvaluated: 0,
    ok: reports.every(r => r.ok),
  };

  if (args.json) {
    process.stdout.write(JSON.stringify({ summary, reports }, null, 2) + "\n");
  } else {
    const lines = [];
    lines.push(`dialect: ${dialect.id} (plugin: ${JSON.stringify(dialect.parserPlugin)}, keyword: ${dialect.keyword})`);
    for (const report of reports) {
      lines.push(`\nfile: ${report.filename}`);
      for (const d of report.duplicates) {
        lines.push(`  ERROR [${d.clause}] ${d.message}`);
        lines.push(`         first:     ${JSON.stringify(d.firstRaw)} @ ${fmt(d.firstLoc)}`);
        lines.push(`         duplicate: ${JSON.stringify(d.duplicateRaw)} @ ${fmt(d.duplicateLoc)}`);
      }
      for (const u of report.unconfirmable) {
        lines.push(`  UNCONFIRMED @ ${fmt(u.loc)}: ${u.reason}`);
      }
      if (report.duplicates.length === 0 && report.unconfirmable.length === 0) {
        lines.push("  ok");
      }
    }
    lines.push(`\nexpressions evaluated: ${summary.expressionsEvaluated}`);
    process.stdout.write(lines.join("\n") + "\n");
  }

  if (!summary.ok) process.exitCode = 1;
}

function fmt(loc) {
  return loc ? `${loc.line}:${loc.column}` : "?";
}

main().catch(error => {
  process.stderr.write(`${error.message}\n`);
  process.exit(2);
});
