# Token-level redaction acceptance

These files cover the `redactTokens` parser option and its token export
adapter (`src/tokenizer/redact-tokens.ts`, hooked in
`createExportedTokens`).

## What is asserted

A small program containing a string literal, comments and an ordinary
number is parsed with `tokens: true` and:

- only the `value` of the selected token types is masked;
- token `type`, `start`/`end` (range) and `loc` are preserved and match the
  unredacted parse one-to-one;
- comments are controlled independently (`redactTokens.comments`), they are
  never masked through `types`;
- token types that are not selected (e.g. the number `42`) keep their
  original value;
- redacted tokens expose only the public fields (`type`, `value`, `start`,
  `end`, `loc`), so the source text cannot survive in `raw`/`extra`-like
  side channels, and JSON serialization contains no secret;
- the original AST (`StringLiteral.value`, `extra.raw`, `File.comments` and
  comments attached to nodes) is unchanged, so the code generation input
  is byte-for-byte identical to a parse without redaction;
- comment tokens are redacted on cloned objects, never on the shared
  `File.comments` / AST comment references.

## Entries

- `../redact-tokens.js` — short Jest regression test on the public
  `parse` interface (run by the repository Jest configuration, which
  imports the built `../lib/index.js`).
- `acceptance.mjs` — standalone deterministic harness with no
  repository bootstrapping. It runs against a single-file bundle of the
  modified `@babel/parser`:

  ```sh
  BABEL_PARSER_BUNDLE=/path/to/babel-parser.mjs \
    node packages/babel-parser/test/redaction/acceptance.mjs
  ```

