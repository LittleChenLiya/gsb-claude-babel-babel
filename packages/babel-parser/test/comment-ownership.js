import { parse, parseExpression } from "../lib/index.js";

describe("commentOwnership", () => {
  it("is not present when the option is not enabled", () => {
    const ast = parse("/* c */\nfoo();");
    expect("commentOwnership" in ast).toBe(false);
    // The original interface keeps working as before.
    expect(ast.comments).toHaveLength(1);
    expect(ast.program.body[0].leadingComments).toHaveLength(1);
  });

  it("attributes a comment before a block as leading", () => {
    const ast = parse("/* 1 */\nfunction f() {}", {
      commentOwnership: true,
    });
    expect(ast.commentOwnership).toEqual([
      {
        kind: "leading",
        comment: { type: "CommentBlock", start: 0, end: 7 },
        owner: { type: "FunctionDeclaration", start: 8, end: 23 },
      },
    ]);
  });

  it("attributes a comment inside a block as dangling", () => {
    const ast = parse("function f() {\n  /* inner */\n}", {
      commentOwnership: true,
    });
    expect(ast.commentOwnership).toEqual([
      {
        kind: "dangling",
        comment: { type: "CommentBlock", start: 17, end: 28 },
        owner: { type: "BlockStatement", start: 13, end: 30 },
      },
    ]);
  });

  it("attributes a trailing comment at the end of input", () => {
    const ast = parse("foo();\n/* tail */", { commentOwnership: true });
    expect(ast.commentOwnership).toEqual([
      {
        kind: "trailing",
        comment: { type: "CommentBlock", start: 7, end: 17 },
        owner: { type: "ExpressionStatement", start: 0, end: 6 },
      },
    ]);
  });

  it("never counts one comment under multiple owners", () => {
    const code = "a();\n/* mid */\nb();";
    const ast = parse(code, { commentOwnership: true });
    // The comment is both the trailing comment of `a();` and the leading
    // comment of `b();`, but the ownership view reports it exactly once,
    // preferring the "leading" attachment.
    expect(ast.commentOwnership).toEqual([
      {
        kind: "leading",
        comment: { type: "CommentBlock", start: 5, end: 14 },
        owner: { type: "ExpressionStatement", start: 15, end: 19 },
      },
    ]);
    // Every parsed comment is owned exactly once.
    const owned = new Set(
      ast.commentOwnership.map(record => record.comment.start),
    );
    expect(owned.size).toBe(ast.comments.length);
  });

  it("is explicitly empty when attachComment is false", () => {
    const ast = parse("/* c */\nfoo();", {
      commentOwnership: true,
      attachComment: false,
    });
    expect(ast.commentOwnership).toEqual([]);
  });

  it("is empty when the input has no comments", () => {
    const ast = parse("foo();", { commentOwnership: true });
    expect(ast.commentOwnership).toEqual([]);
  });

  it("is read-only", () => {
    const ast = parse("/* c */\nfoo();", { commentOwnership: true });
    expect(Object.isFrozen(ast.commentOwnership)).toBe(true);
    expect(Object.isFrozen(ast.commentOwnership[0])).toBe(true);
    expect(Object.isFrozen(ast.commentOwnership[0].comment)).toBe(true);
    expect(Object.isFrozen(ast.commentOwnership[0].owner)).toBe(true);
  });

  it("works with parseExpression", () => {
    const expr = parseExpression("/* c */\nfoo", { commentOwnership: true });
    expect(expr.commentOwnership).toEqual([
      {
        kind: "leading",
        comment: { type: "CommentBlock", start: 0, end: 7 },
        owner: { type: "Identifier", start: 8, end: 11 },
      },
    ]);
  });
});
