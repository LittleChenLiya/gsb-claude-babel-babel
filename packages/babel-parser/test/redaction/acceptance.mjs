// Local deterministic acceptance for the token-level redaction export adapter.
//
// This is intentionally a standalone, dependency-free harness so it can run
// against a small single-file bundle of @babel/parser (see README.md in this
// directory) without bootstrapping the whole monorepo:
//
//   node packages/babel-parser/test/redaction/acceptance.mjs
//
// Set BABEL_PARSER_BUNDLE to point at another built @babel/parser entry.
import assert from "node:assert/strict";

const bundlePath =
  process.env.BABEL_PARSER_BUNDLE ??
  "../../../../../redact-accept/dist/babel-parser.mjs";
const { parse, parseExpression } = await import(
  new URL(bundlePath, import.meta.url).href
);

let passed = 0;
const test = (name, fn) => {
  fn();
  passed++;
  console.log(`  ok - ${name}`);
};

// A small program containing a string, comments and an ordinary number.
const CODE = [
  "// leading line comment",
  'const secret = "s3cr3t"; // trailing note',
  "/* block comment */",
  "const count = 42;",
].join("\n");

const PARSER_OPTS = {
  sourceType: "module",
  tokens: true,
  ranges: true,
  locations: true,
};

const summarize = tokens =>
  tokens.map(t => ({
    type: typeof t.type === "string" ? t.type : t.type.label,
    value: t.value,
    start: t.start,
    end: t.end,
    loc: t.loc && {
      sl: t.loc.start.line,
      sc: t.loc.start.column,
      el: t.loc.end.line,
      ec: t.loc.end.column,
    },
  }));

// ---------------------------------------------------------------------------
// 1. Small program: selected string values masked; type/range/loc kept
// ---------------------------------------------------------------------------
console.log("1) string + comments + number, types:[string], comments:true");

const plain = parse(CODE, PARSER_OPTS);
const redacted = parse(CODE, {
  ...PARSER_OPTS,
  redactTokens: { types: ["string"], comments: true },
});

test("range/loc/type of every token match the unredacted parse", () => {
  const a = plain.tokens;
  const b = redacted.tokens;
  assert.equal(b.length, a.length, "token count differs");
  for (let i = 0; i < a.length; i++) {
    assert.equal(b[i].start, a[i].start, `start mismatch at #${i}`);
    assert.equal(b[i].end, a[i].end, `end mismatch at #${i}`);
    assert.deepEqual(
      [
        b[i].loc.start.line,
        b[i].loc.start.column,
        b[i].loc.end.line,
        b[i].loc.end.column,
      ],
      [
        a[i].loc.start.line,
        a[i].loc.start.column,
        a[i].loc.end.line,
        a[i].loc.end.column,
      ],
      `loc mismatch at #${i}`,
    );
    assert.equal(
      typeof b[i].type === "string" ? b[i].type : b[i].type.label,
      typeof a[i].type === "string" ? a[i].type : a[i].type.label,
      `type label mismatch at #${i}`,
    );
  }
});

test("only the string token value is masked; the number 42 is retained", () => {
  const rows = summarize(redacted.tokens);
  const stringTok = rows.find(t => t.type === "string");
  const numTok = rows.find(t => t.type === "num");
  assert.equal(stringTok.value, "[redacted]");
  assert.equal(
    numTok.value,
    42,
    "unselected numeric token must keep its value",
  );
  // Offsets still cover the whole string literal including the quotes.
  assert.equal(CODE.slice(stringTok.start, stringTok.end), '"s3cr3t"');
});

test("comments are masked independently but keep type/range/loc", () => {
  const rows = summarize(redacted.tokens).filter(t =>
    t.type.startsWith("Comment"),
  );
  assert.equal(rows.length, 3);
  for (const c of rows) {
    assert.equal(c.value, "[redacted]");
    const raw = CODE.slice(c.start, c.end);
    assert.ok(raw.startsWith("//") || raw.startsWith("/*"), raw);
  }
  assert.equal(rows[0].type, "CommentLine");
  assert.equal(rows[1].type, "CommentLine");
  assert.equal(rows[2].type, "CommentBlock");
});

test("no raw side channel: only public fields on redacted tokens", () => {
  for (const t of redacted.tokens) {
    const label = typeof t.type === "string" ? t.type : t.type.label;
    if (!(label === "string" || label.startsWith("Comment"))) continue;
    assert.deepEqual(
      Object.keys(t).sort(),
      ["end", "loc", "start", "type", "value"],
      `unexpected side-channel fields on ${label}: ${Object.keys(t)}`,
    );
    assert.equal("raw" in t, false);
    assert.equal("rawValue" in t, false);
    assert.equal("extra" in t, false);
    const serialized = JSON.stringify(t);
    assert.equal(serialized.includes("s3cr3t"), false, serialized);
    assert.equal(/leading|trailing|block comment/.test(serialized), false);
  }
});

test("original AST literals and comment nodes keep source text", () => {
  const literal = redacted.program.body[0].declarations[0].init;
  assert.equal(literal.type, "StringLiteral");
  assert.equal(literal.value, "s3cr3t");
  assert.equal(literal.extra.raw, '"s3cr3t"');
  // File.comments are the original comment objects.
  assert.equal(redacted.comments[0].value, " leading line comment");
  assert.equal(redacted.comments[1].value, " trailing note");
  assert.equal(redacted.comments[2].value, " block comment ");
  // The trailing comment attached to the statement still carries raw text.
  const stmt = redacted.program.body[0];
  assert.equal(stmt.trailingComments[0].value, " trailing note");
});

test("redacted comment tokens are clones of AST comment objects", () => {
  for (const t of redacted.tokens) {
    if (typeof t.type === "string") {
      assert.equal(
        redacted.comments.includes(t),
        false,
        "AST comment object must not be mutated",
      );
    }
  }
  // Without redaction, token comments keep being the same object references.
  for (const t of plain.tokens) {
    if (typeof t.type === "string") {
      assert.ok(plain.comments.includes(t));
    }
  }
});

// ---------------------------------------------------------------------------
// 2. Unselected token types keep original values (comments default off)
// ---------------------------------------------------------------------------
console.log(
  "2) types:[name] -> identifiers masked, strings/numbers/comments kept",
);

const onlyNames = parse(CODE, {
  ...PARSER_OPTS,
  redactTokens: { types: ["name"] },
});
test("selected names masked; string/number/comment values retained", () => {
  const rows = summarize(onlyNames.tokens);
  const names = rows.filter(t => t.type === "name");
  assert.deepEqual(
    names.map(t => t.value),
    ["[redacted]", "[redacted]"],
  );
  assert.equal(rows.find(t => t.type === "string").value, "s3cr3t");
  assert.equal(rows.find(t => t.type === "num").value, 42);
  for (const c of rows.filter(t => t.type.startsWith("Comment"))) {
    assert.notEqual(c.value, "[redacted]");
  }
});

test("without the option, tokens are unchanged (identity kept)", () => {
  const rows = summarize(plain.tokens);
  assert.equal(rows.find(t => t.type === "string").value, "s3cr3t");
  assert.equal(rows.find(t => t.type === "num").value, 42);
});

// ---------------------------------------------------------------------------
// 3. Object-valued regexp token, bigint and custom placeholder
// ---------------------------------------------------------------------------
console.log("3) regexp/bigint value masking with a custom placeholder");

const CODE2 = "const re = /ab+c/gi; const tpl = `x-${1}`; 9n;";
const extra = parse(CODE2, {
  sourceType: "module",
  tokens: true,
  redactTokens: {
    types: ["regexp", "bigint"],
    comments: false,
    placeholder: "?",
  },
});
test("regexp/bigint masked wholesale, template tokens kept", () => {
  const rows = summarize(extra.tokens);
  const re = rows.find(t => t.type === "regexp");
  assert.equal(re.value, "?");
  const reTok = extra.tokens.find(
    t => typeof t.type !== "string" && t.type.label === "regexp",
  );
  assert.deepEqual(Object.keys(reTok).sort(), [
    "end",
    "loc",
    "start",
    "type",
    "value",
  ]);
  assert.equal(rows.find(t => t.type === "bigint").value, "?");
  // Template pieces and the number inside the template stay intact. Their
  // exported labels are "...`" / "...${" (and "`" for empty templates).
  const tmpls = rows.filter(
    t => t.type === "..." || t.type.startsWith("...") || t.type === "`",
  );
  assert.ok(tmpls.length >= 1);
  for (const t of tmpls) assert.notEqual(t.value, "?");
});

// ---------------------------------------------------------------------------
// 4. parseExpression path and invalid option validation
// ---------------------------------------------------------------------------
console.log("4) parseExpression path and option validation");

test("parseExpression applies redaction too", () => {
  const expr = parseExpression('"abc" + 1', {
    tokens: true,
    redactTokens: { types: ["string"] },
  });
  const rows = summarize(expr.tokens);
  assert.equal(rows.find(t => t.type === "string").value, "[redacted]");
  assert.equal(rows.find(t => t.type === "num").value, 1);
});

test("redactTokens without types throws", () => {
  assert.throws(() => parse("1", { tokens: true, redactTokens: {} }), /types/);
});

console.log(`\nAll ${passed} checks passed.`);
