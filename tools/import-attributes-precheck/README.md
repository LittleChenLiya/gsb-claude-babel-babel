# import-attributes-precheck

Explicit, static pre-check for import attribute clauses (`with` / `assert`).

See [REPORT.md](./REPORT.md) for the full write-up, acceptance results,
dialect table, targeted Babel parser commands, and the three-import examples.

Quick start (from this directory, no install or build needed):

```
node test/run-tests.mjs                                   # acceptance tests
node cli.mjs examples/three-imports.mjs                   # text report
node cli.mjs --json test/fixtures/dynamic-spread.mjs      # JSON report
node cli.mjs --dialect assertions examples/dialect-assertions.mjs
node cli.mjs --syntax-only test/fixtures/distinct-keys.mjs
```

Properties:

- duplicate keys compared after decoding (quote/escape spelling cannot evade)
- duplicate errors carry both sides' locations
- dynamic `import()` options judged only when statically recognisable;
  spreads/expressions are reported as uncertain, never evaluated
- `attributes` (`with`) and `assertions` (`assert`) chosen by plugin mode,
  semantics never mixed
- zero expression evaluation, zero source modification
