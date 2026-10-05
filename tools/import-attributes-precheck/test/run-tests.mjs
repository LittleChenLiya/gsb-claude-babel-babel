// @ts-check
/**
 * Small, dependency-free acceptance tests for the import attributes precheck.
 * Run: node test/run-tests.mjs
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { parseCode } from "../src/parse.mjs";
import { checkAst } from "../src/index.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.join(here, "fixtures");

async function runFixture(name, dialect = "attributes") {
  const code = await readFile(path.join(fixtures, name), "utf8");
  const ast = await parseCode(code, { dialect });
  const report = checkAst(ast, { dialect });
  return report;
}

let passed = 0;
function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed++;
      console.log("  ok - " + name);
    });
}

await test("acceptance: two equivalent type keys are rejected", async () => {
  const r = await runFixture("equivalent-type-keys.mjs");
  const dupes = r.findings.filter(f => f.kind === "duplicate-key");
  assert.equal(dupes.length, 1, "one duplicate finding");
  assert.equal(dupes[0].key, "type");
  // error carries both locations
  assert.ok(
    dupes[0].firstLoc.line > 0 && dupes[0].loc.line > 0,
    "both sides located",
  );
  assert.notDeepEqual(dupes[0].loc, dupes[0].firstLoc);
});

await test("acceptance: different decoded keys pass", async () => {
  const r = await runFixture("distinct-keys.mjs");
  assert.equal(
    r.findings.filter(f => f.kind === "duplicate-key").length,
    0,
  );
});

await test("acceptance: dynamic spread is marked statically unconfirmable", async () => {
  const r = await runFixture("dynamic-spread.mjs");
  assert.equal(
    r.findings.filter(f => f.kind === "duplicate-key").length,
    0,
  );
  assert.ok(
    r.uncertain.some(u => u.reason === "spread" && u.clause === "dynamic-import"),
    "spread reported as uncertain",
  );
});

await test("acceptance: expression evaluation count is 0 and no modification", async () => {
  for (const f of [
    "equivalent-type-keys.mjs",
    "distinct-keys.mjs",
    "dynamic-spread.mjs",
  ]) {
    const r = await runFixture(f);
    assert.equal(r.expressionEvaluationCount, 0, f + ": eval count");
    assert.equal(r.sourceModificationCount, 0, f + ": modification count");
  }
});

await test("escape-sequence spellings of the same key are rejected", async () => {
  const r = await runFixture("escaped-keys.mjs");
  const dupes = r.findings.filter(f => f.kind === "duplicate-key");
  assert.equal(dupes.length, 1);
  assert.equal(dupes[0].key, "type");
});

await test("dynamic import with static options: duplicate is found", async () => {
  const r = await runFixture("dynamic-static-duplicate.mjs");
  const dupes = r.findings.filter(f => f.kind === "duplicate-key");
  assert.equal(dupes.length, 1);
  assert.equal(dupes[0].clause, "dynamic-import");
  assert.equal(r.uncertain.length, 0);
});

await test("dialect: assertions mode checks node.assertions for assert keyword", async () => {
  const r = await runFixture("dialect-assert-dup.mjs", "assertions");
  const dupes = r.findings.filter(f => f.kind === "duplicate-key");
  assert.equal(dupes.length, 1);
  assert.equal(dupes[0].dialect, "assertions");
  assert.equal(dupes[0].key, "type");
});

await test("dialect: assert syntax under attributes mode is a syntax finding, not a mixed semantic", async () => {
  const r = await runFixture("dialect-assert-dup.mjs", "attributes");
  const syntax = r.findings.filter(f => f.kind === "syntax");
  assert.ok(syntax.length >= 1, "syntax error surfaced");
  // the checker itself does not reinterpret `assert` as `with`
  const semanticDupes = r.findings.filter(
    f => f.kind === "duplicate-key" && f.dialect === "attributes",
  );
  assert.equal(semanticDupes.length, 0);
});

await test("non-literal dynamic options are uncertain, never evaluated", async () => {
  const code = "const opts = {}; import('./a.json', opts);";
  const ast = await parseCode(code, { dialect: "attributes" });
  const r = checkAst(ast, { dialect: "attributes" });
  assert.ok(r.uncertain.some(u => u.reason === "non-literal-options"));
  assert.equal(r.expressionEvaluationCount, 0);
});

console.log("\n" + passed + " tests passed");
