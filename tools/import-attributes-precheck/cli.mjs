#!/usr/bin/env node
// @ts-check
/**
 * import-attributes-precheck
 *
 * Statically pre-check import attribute clauses before any build step:
 *   node cli.mjs [--dialect attributes|assertions] [--json] file ...
 *
 * The checker never executes expressions from the checked source and never
 * rewrites it. Exit code is 1 when duplicate-key findings exist.
 */
import { readFile } from "node:fs/promises";
import { parseCode } from "./src/parse.mjs";
import { checkAst, formatReport } from "./src/index.mjs";

function usage() {
  console.log(`usage:
  import-attributes-precheck [options] <file.js> [...]

options:
  --dialect <attributes|assertions>
                        Keyword dialect, selected like a parser plugin:
                          attributes  -> "with"  (import attributes, default)
                          assertions  -> "assert" (import assertions)
                        The two dialects are never mixed.
  --source-type <module|script>
                        Parser source type (default: module).
  --json                Emit a JSON report instead of text.
  --syntax-only         Ordinary syntax switch: only run the parser and
                        report syntax errors, skip the semantic pre-check.
  -h, --help            Show this help.
`);
}

async function main() {
  const args = process.argv.slice(2);
  const files = [];
  let dialect = "attributes";
  let sourceType = "module";
  let json = false;
  let syntaxOnly = false;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "-h" || a === "--help") {
      usage();
      return 0;
    } else if (a === "--dialect") {
      dialect = args[++i];
    } else if (a === "--source-type") {
      sourceType = args[++i];
    } else if (a === "--json") {
      json = true;
    } else if (a === "--syntax-only") {
      syntaxOnly = true;
    } else if (a.startsWith("--")) {
      console.error("unknown option: " + a);
      usage();
      return 2;
    } else {
      files.push(a);
    }
  }

  if (dialect !== "attributes" && dialect !== "assertions") {
    console.error("--dialect must be 'attributes' or 'assertions'");
    return 2;
  }
  if (files.length === 0) {
    usage();
    return 2;
  }

  const reports = [];
  let failed = false;

  for (const file of files) {
    // Read-only: the source is parsed, never executed or modified.
    const code = await readFile(file, "utf8");
    const ast = await parseCode(code, { dialect, sourceType });
    const report = syntaxOnly
      ? {
          dialect,
          staticClauseCount: 0,
          dynamicImportCount: 0,
          expressionEvaluationCount: 0,
          sourceModificationCount: 0,
          findings: (ast.errors || []).map(err => ({
            kind: "syntax",
            clause: "static-import",
            dialect,
            loc: err.loc || { line: 0, column: 0 },
            firstLoc: { line: 0, column: 0 },
            message: err.reasonCode
              ? "[" + err.reasonCode + "] " + err.message
              : err.message,
          })),
          uncertain: [],
        }
      : checkAst(ast, { dialect });
    report.file = file;
    reports.push(report);
    if (report.findings.some(
      f => f.kind === "duplicate-key" || f.kind === "syntax",
    )) {
      failed = true;
    }
    if (!json) console.log(formatReport(report, file) + "\n");
  }

  if (json) {
    console.log(JSON.stringify(reports, null, 2));
  }

  return failed ? 1 : 0;
}

main().then(code => process.exit(code), err => {
  console.error(err);
  process.exit(2);
});
