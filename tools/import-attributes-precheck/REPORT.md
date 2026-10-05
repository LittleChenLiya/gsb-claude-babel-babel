# Import Attributes — Explicit Static Pre-check

## What this adds

An explicit pre-check for import attribute clauses
(`with { ... }` / `assert { ... }`) implemented as a self-contained tool under
`tools/import-attributes-precheck/`:

- **Decoded-name duplicate detection.** Two attribute keys are compared *after
  decoding*, so `type`, `"type"`, `'type'` and any escape-sequence spelling
  (`"type"`) all collapse to the same key. Different quote/escape spellings
  cannot be used to sneak a duplicate past the check.
- **Both-side locations.** A duplicate finding records both the location of
  the first key and the location of the repeated key.
- **Dynamic `import()` options are checked only when statically recognisable.**
  The second argument is inspected only if it is an object literal containing
  a statically named `with`/`assert` object literal with static keys. A spread
  (`...attrs`), a computed key, or a non-literal expression is reported as
  *statically uncertain* instead of being guessed.
- **No execution, no rewriting.** The source is read and parsed only. The
  report always carries `expressionEvaluationCount: 0` and
  `sourceModificationCount: 0`. Expressions are never evaluated and the source
  is never modified.
- **Dialects are selected by plugin mode, never mixed.** `attributes` (the
  `with` keyword, parser plugin `importAttributes`) and `assertions` (the
  legacy `assert` keyword, parser plugin `importAssertions`) are distinct
  modes. `assert` input under `attributes` mode is a syntax error; it is not
  reinterpreted semantically as `with`.
- **Ordinary syntax switch retained.** `--syntax-only` runs just the parser
  and reports syntax errors, skipping the semantic pre-check.

## Layout

```
tools/import-attributes-precheck/
  cli.mjs                      # CLI entry
  src/parse.mjs                # parser adapter (dialect -> parser plugin)
  src/index.mjs                # static checker + report formatter
  vendor/babel-parser.mjs      # @babel/parser 8.0.6 bundle (ESM, "with")
  vendor/babel-parser-7.cjs    # @babel/parser 7.28.5 bundle (CJS, "assert")
  examples/three-imports.mjs   # the three import forms
  examples/dialect-assertions.mjs
  test/run-tests.mjs           # dependency-free acceptance tests
  test/fixtures/*.mjs
```

The vendored bundles let the tool run without bootstrapping the monorepo.
They are verbatim published builds of @babel/parser (8.0.6 and 7.28.5).

## Acceptance results

Run from `tools/import-attributes-precheck/`:

```
node test/run-tests.mjs
```

Required acceptance cases:

| Requirement | Fixture | Result |
| --- | --- | --- |
| Two equivalent `type` keys rejected | `test/fixtures/equivalent-type-keys.mjs` (`type` + `"type"`) | 1 duplicate finding, both locations, exit 1 |
| Different keys pass | `test/fixtures/distinct-keys.mjs` (`type` + `flavor`) | 0 findings, exit 0 |
| Dynamic spread is statically unconfirmable | `test/fixtures/dynamic-spread.mjs` (`{ ...attrs }`) | 1 `spread` uncertain finding, 0 duplicates |
| Expression evaluation count is 0 | every fixture | `expressionEvaluationCount: 0` |

All 9 tests pass.

## Dialect section (reported separately)

The dialect is its own field in every report (`"dialect": "attributes"` or
`"dialect": "assertions"`) and the first line after the filename in the text
report. The semantic routines never mix them:

| Dialect | Keyword | Parser plugin | AST field | Parser |
| --- | --- | --- | --- | --- |
| `attributes` (default) | `with` | `importAttributes` | `node.attributes` | Babel 8.0.6 |
| `assertions` | `assert` | `importAssertions` | `node.assertions` | Babel 7.28.5 |

Babel 8 removed the `importAssertions` plugin, so the `assert` dialect is
parsed with the Babel 7 vendored bundle when `--dialect assertions` is
selected. Feeding `assert` syntax to the default `attributes` mode produces
syntax findings (no semantic reinterpretation).

## Targeted Babel parser commands

These short commands parse the three import forms directly with the
Babel parser, showing what is and is not statically visible. They target
only the vendored bundles and parse strings only — no project build.

Attributes dialect (Babel 8, `with`):

```
node --input-type=module -e "
import { parse } from './vendor/babel-parser.mjs';
const ast = parse(\`import d from './d.json' with { type: 'json' };\`, {
  sourceType: 'module', plugins: ['importAttributes'], errorRecovery: true,
});
console.log(ast.program.body[0].attributes);
"
```

Assertions dialect (Babel 7, `assert`):

```
node --input-type=module -e "
import { createRequire } from 'node:module';
const { parse } = createRequire(import.meta.url)('./vendor/babel-parser-7.cjs');
const ast = parse(\`import d from './d.json' assert { type: 'json' };\`, {
  sourceType: 'module', plugins: ['importAssertions'], errorRecovery: true,
});
console.log(ast.program.body[0].assertions);
"
```

Duplicate key at the parser level (the parser already sees it; our pre-check
adds the *first* location and decoded-name semantics):

```
node --input-type=module -e "
import { parse } from './vendor/babel-parser.mjs';
const ast = parse(\`import d from './d.json' with { type: 'json', \\\"type\\\": 'css' };\`, {
  sourceType: 'module', plugins: ['importAttributes'], errorRecovery: true,
});
console.log(ast.errors.map(e => e.reasonCode));
"
```

## The three import examples (`examples/three-imports.mjs`)

1. **Static import — static attribute list**
   `import data from "./data.json" with { type: "json" };` — fully checked.
2. **Dynamic import — statically recognisable options**
   `import("./other.json", { with: { type: "json" } })` — fully checked;
   a duplicate static key inside is reported.
3. **Dynamic import — spread options**
   `import("./third.json", { with: { ...attrs } })` — reported as
   *statically uncertain* (`spread`); `attrs` is never evaluated.

Run it:

```
node cli.mjs examples/three-imports.mjs
```

JSON output (the dialect appears per report):

```
node cli.mjs --json test/fixtures/dynamic-spread.mjs
```

Legacy dialect:

```
node cli.mjs --dialect assertions examples/dialect-assertions.mjs
```

Ordinary syntax switch:

```
node cli.mjs --syntax-only test/fixtures/distinct-keys.mjs
```
