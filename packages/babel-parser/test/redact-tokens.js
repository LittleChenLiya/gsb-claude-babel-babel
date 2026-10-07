import { parse } from "../lib/index.js";

// Short regression tests for the local token-level redaction export adapter.
// It masks only the `value` of the selected token types, preserves
// type/start/end/loc, configures comments independently and never mutates the
// original AST (the code generation input).
describe("redactTokens option", () => {
  const CODE = [
    "// leading",
    'const s = "secret"; // trailing',
    "const n = 42;",
  ].join("\n");

  const opts = {
    sourceType: "module",
    tokens: true,
    redactTokens: { types: ["string"], comments: true },
  };

  it("masks selected string tokens and comments, keeps the number", () => {
    const { tokens } = parse(CODE, opts);

    const stringTok = tokens.find(t => t.type.label === "string");
    expect(stringTok.value).toBe("[redacted]");
    // type/range/loc are preserved
    expect(stringTok.start).toBe(CODE.indexOf('"secret"'));
    expect(stringTok.end).toBe(stringTok.start + '"secret"'.length);
    expect(stringTok.loc.start).toMatchObject({ line: 2, column: 10 });

    const numTok = tokens.find(t => t.type.label === "num");
    expect(numTok.value).toBe(42);

    for (const comment of tokens.filter(
      t => t.type === "CommentLine" || t.type === "CommentBlock",
    )) {
      expect(comment.value).toBe("[redacted]");
    }
  });

  it("does not leak source content through raw/extra side channels", () => {
    const { tokens } = parse(CODE, opts);
    for (const token of tokens) {
      const label =
        typeof token.type === "string" ? token.type : token.type.label;
      if (label === "string" || label.startsWith("Comment")) {
        expect(Object.keys(token).sort()).toEqual([
          "end",
          "loc",
          "start",
          "type",
          "value",
        ]);
        expect(JSON.stringify(token)).not.toContain("secret");
      }
    }
  });

  it("leaves the original AST and shared comment objects untouched", () => {
    const ast = parse(CODE, opts);

    const literal = ast.program.body[0].declarations[0].init;
    expect(literal.value).toBe("secret");
    expect(literal.extra.raw).toBe('"secret"');
    expect(ast.comments.map(c => c.value)).toEqual([" leading", " trailing"]);

    for (const token of ast.tokens) {
      if (typeof token.type === "string") {
        expect(ast.comments).not.toContain(token);
      }
    }
  });

  it("keeps unselected token values, comments off by default", () => {
    const { tokens } = parse(CODE, {
      sourceType: "module",
      tokens: true,
      redactTokens: { types: ["name"] },
    });
    expect(tokens.find(t => t.type.label === "string").value).toBe("secret");
    expect(tokens.find(t => t.type.label === "num").value).toBe(42);
    for (const comment of tokens.filter(t => typeof t.type === "string")) {
      expect(comment.value).not.toBe("[redacted]");
    }
  });

  it("supports a custom placeholder and object-valued regexp tokens", () => {
    const { tokens } = parse("const re = /a+b/gi;", {
      sourceType: "module",
      tokens: true,
      redactTokens: { types: ["regexp"], placeholder: "?" },
    });
    const reTok = tokens.find(t => t.type.label === "regexp");
    expect(reTok.value).toBe("?");
  });

  it("throws when configured without a types array", () => {
    expect(() => parse("1", { tokens: true, redactTokens: {} })).toThrow(
      /types/,
    );
  });
});
