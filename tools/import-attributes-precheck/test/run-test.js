/**
 * @file Small, deterministic acceptance tests for the import-attributes
 * pre-check. Runs against plain fixtures only:
 *
 *   node test/run-test.js
 *
 * Parser resolution can be redirected with IMPORT_ATTR_PARSER_PATH.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  DIALECTS,
  loadParser,
  precheckSource,
  resolveDialect,
} from "../src/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const examples = path.join(here, "..", "examples");
const read = name => readFile(path.join(examples, name), "utf8");

const parser = await loadParser(
  process.env.IMPORT_ATTR_PARSER_PATH
    ? { parserPath: process.env.IMPORT_ATTR_PARSER_PATH }
    : {},
);

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`  ok - ${name}`);
}

// ---- Acceptance case 1: two equivalent type keys are rejected --------
test("equivalent type keys (one unicode-escape spelling) are rejected", () => {
  const code = `import data from "./data.json" with { type: "json", "\\u0074ype": "json" };`;
  const report = precheckSource(code, {
    parser,
    dialect: resolveDialect("attributes"),
  });
  assert.equal(report.ok, false);
  assert.equal(report.dialect, "attributes");
  assert.equal(report.duplicates.length, 1);
  const dup = report.duplicates[0];
  assert.equal(dup.key, "type");
  assert.equal(dup.clause, "static");
  // Decoded equality despite different raw spellings.
  assert.equal(dup.firstRaw, "type");
  assert.equal(dup.duplicateRaw, '"\\u0074ype"');
  // Error carries BOTH locations.
  assert.deepEqual(dup.firstLoc, { line: 1, column: 38, index: 38 });
  assert.deepEqual(dup.duplicateLoc, { line: 1, column: 52, index: 52 });
  assert.notDeepEqual(dup.firstLoc, dup.duplicateLoc);
});

test("ordinary textual duplicate type:type is rejected too", () => {
  const code = `import a from "./a.json" with { type: "json", type: "json" };`;
  const report = precheckSource(code, {
    parser,
    dialect: resolveDialect("attributes"),
  });
  assert.equal(report.ok, false);
  assert.equal(report.duplicates.length, 1);
  assert.equal(report.duplicates[0].key, "type");
});

// ---- Acceptance case 2: different keys pass -------------------------
test("different decoded keys pass", () => {
  const code = `import data from "./data.json" with { type: "json", webpack: "all" };`;
  const report = precheckSource(code, {
    parser,
    dialect: resolveDialect("attributes"),
  });
  assert.equal(report.ok, true);
  assert.deepEqual(
    report.entries.map(e => e.key),
    ["type", "webpack"],
  );
  assert.equal(report.duplicates.length, 0);
});

test("same spelling via identifier vs string literal but equal decoded key is rejected", () => {
  const code = `import a from "./a.json" with { type: "json", "type": "json" };`;
  const report = precheckSource(code, {
    parser,
    dialect: resolveDialect("attributes"),
  });
  assert.equal(report.duplicates.length, 1);
  assert.equal(report.duplicates[0].key, "type");
});

// ---- Acceptance case 3: dynamic spread is unconfirmable -------------
test("dynamic import with spread is not statically confirmable", () => {
  const code = `function f(opts){ return import("./a.json", { with: { ...opts } }); }`;
  const report = precheckSource(code, {
    parser,
    dialect: resolveDialect("attributes"),
  });
  assert.equal(report.duplicates.length, 0);
  assert.equal(report.unconfirmable.length, 1);
  assert.match(report.unconfirmable[0].reason, /spread/);
});

test("dynamic import with fully literal duplicate keys IS detected", () => {
  const code = `import("./a.json", { with: { type: "json", type: "wasm" } });`;
  const report = precheckSource(code, {
    parser,
    dialect: dialectOr("attributes"),
  });
  assert.equal(report.duplicates.length, 1);
  assert.equal(report.duplicates[0].clause, "dynamic");
  assert.equal(report.duplicates[0].firstLoc.line, 1);
  assert.notDeepEqual(
    report.duplicates[0].firstLoc,
    report.duplicates[0].duplicateLoc,
  );
});

test("dynamic import without options is confirmable and clean", () => {
  const code = `import("./a.json");`;
  const report = precheckSource(code, {
    parser,
    dialect: resolveDialect("attributes"),
  });
  assert.equal(report.ok, true);
  assert.equal(report.unconfirmable.length, 0);
});

// ---- Expression evaluation count is always 0 ------------------------
test("expression evaluation count stays 0 even with value expressions", () => {
  const code = [
    `const key = "type";`,
    `import("./a.json", { with: { [key]: "json" } });`,
    `import("./b.json", { with: { type: ("json") } });`,
  ].join("\n");
  const report = precheckSource(code, {
    parser,
    dialect: resolveDialect("attributes"),
  });
  assert.equal(report.expressionsEvaluated, 0);
  // computed key -> unconfirmable; parenthesized string literal value is
  // not an object-literal property of the clause... check neither throws
  // and nothing was evaluated.
  assert.ok(report.unconfirmable.length >= 1);
});

// ---- Dialect separation --------------------------------------------
test("assertions dialect reads assert clause and never with semantics", () => {
  const code = `import a from "./a.json" assert { type: "json", type: "json" };`;
  const report = precheckSource(code, {
    parser,
    dialect: resolveDialect("assertions"),
  });
  assert.equal(report.dialect, "assertions");
  assert.equal(report.duplicates.length, 1);
  assert.equal(report.duplicates[0].key, "type");
});

test("attributes dialect does not treat assert as its own clause", () => {
  // Under importAttributes (no deprecatedAssertSyntax) `assert` is a
  // parse error in a static clause; it must not be silently checked with
  // `with` semantics.
  const code = `import a from "./a.json" assert { type: "json" };`;
  const report = precheckSource(code, {
    parser,
    dialect: resolveDialect("attributes"),
  });
  assert.equal(report.entries.length, 0);
  assert.ok(report.parseErrors.length >= 1);
});

test("dynamic: assert option key only recognized in assertions dialect", () => {
  const code = `import("./a.json", { assert: { type: "json", type: "x" } });`;
  const assertionsReport = precheckSource(code, {
    parser,
    dialect: resolveDialect("assertions"),
  });
  assert.equal(assertionsReport.duplicates.length, 1);

  const attributesReport = precheckSource(code, {
    parser,
    dialect: resolveDialect("attributes"),
  });
  // `assert` is a foreign option for the attributes dialect.
  assert.equal(attributesReport.duplicates.length, 0);
  assert.equal(attributesReport.unconfirmable.length, 0);
});

test("dynamic: with option key is foreign under assertions dialect", () => {
  const code = `import("./a.json", { with: { type: "json", type: "x" } });`;
  const report = precheckSource(code, {
    parser,
    dialect: resolveDialect("assertions"),
  });
  assert.equal(report.duplicates.length, 0);
  assert.equal(report.unconfirmable.length, 0);
});

test("dialect descriptors map to distinct plugins and keywords", () => {
  assert.equal(DIALECTS.attributes.keyword, "with");
  assert.equal(DIALECTS.attributes.astField, "attributes");
  assert.equal(DIALECTS.assertions.keyword, "assert");
  assert.equal(DIALECTS.assertions.astField, "assertions");
  assert.notEqual(
    JSON.stringify(DIALECTS.attributes.parserPlugin),
    JSON.stringify(DIALECTS.assertions.parserPlugin),
  );
});

// ---- Fixture files round-trip ---------------------------------------
test("the three committed examples classify as expected", async () => {
  const dup = precheckSource(await read("duplicate-type.js"), {
    parser,
    dialect: resolveDialect("attributes"),
    filename: "duplicate-type.js",
  });
  assert.equal(dup.ok, false);
  assert.equal(dup.duplicates[0].key, "type");

  const distinct = precheckSource(await read("distinct-keys.js"), {
    parser,
    dialect: resolveDialect("attributes"),
  });
  assert.equal(distinct.ok, true);

  const spread = precheckSource(await read("dynamic-spread.js"), {
    parser,
    dialect: resolveDialect("attributes"),
  });
  assert.equal(spread.ok, true);
  assert.equal(spread.duplicates.length, 0);
  assert.equal(spread.unconfirmable.length, 1);
  assert.equal(spread.expressionsEvaluated, 0);
});

function dialectOr(id) {
  return resolveDialect(id);
}

console.log(`\n${passed} acceptance tests passed.`);
