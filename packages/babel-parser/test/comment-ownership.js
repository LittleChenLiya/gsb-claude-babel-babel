import { parse, getCommentOwnership } from "../lib/index.js";

function ownershipOf(code, options) {
  return parse(code, { ...options, commentOwnership: true }).commentOwnership;
}

function summarize(records) {
  return records.map(record => ({
    comment: record.comment.value,
    commentRange: [record.comment.start, record.comment.end],
    kind: record.kind,
    owner:
      record.owner === null
        ? null
        : [record.owner.type, record.owner.start, record.owner.end],
  }));
}

function deepFreeze(value, seen = new Set()) {
  if (value === null || typeof value !== "object" || seen.has(value)) {
    return;
  }
  seen.add(value);
  for (const key of Object.keys(value)) {
    deepFreeze(value[key], seen);
  }
  Object.freeze(value);
}

describe("commentOwnership option", () => {
  it("attributes a comment before a statement as leading", () => {
    expect(summarize(ownershipOf("/* before */\nfoo();"))).toEqual([
      {
        comment: " before ",
        commentRange: [0, 12],
        kind: "leading",
        owner: ["ExpressionStatement", 13, 19],
      },
    ]);
  });

  it("attributes a comment inside an empty block as inner", () => {
    expect(summarize(ownershipOf("function f() { /* inner */ }"))).toEqual([
      {
        comment: " inner ",
        commentRange: [15, 26],
        kind: "inner",
        owner: ["BlockStatement", 13, 28],
      },
    ]);
  });

  it("attributes a comment at the end of the input as trailing", () => {
    expect(summarize(ownershipOf("foo(); // done"))).toEqual([
      {
        comment: " done",
        commentRange: [7, 14],
        kind: "trailing",
        owner: ["ExpressionStatement", 0, 6],
      },
    ]);
  });

  it("counts a comment attached to two nodes only once", () => {
    const ast = parse("a();\n/* mid */\nb();", { commentOwnership: true });
    const [first, second] = ast.program.body;
    // The raw attachment data references the comment from both nodes...
    expect(first.trailingComments).toHaveLength(1);
    expect(second.leadingComments).toHaveLength(1);
    expect(first.trailingComments[0]).toBe(second.leadingComments[0]);
    // ...but the ownership view assigns it to exactly one owner.
    expect(ast.commentOwnership).toHaveLength(ast.comments.length);
    expect(new Set(ast.commentOwnership.map(r => r.comment)).size).toBe(
      ast.comments.length,
    );
    expect(summarize(ast.commentOwnership)).toEqual([
      {
        comment: " mid ",
        commentRange: [5, 14],
        kind: "leading",
        owner: ["ExpressionStatement", 15, 19],
      },
    ]);
  });

  it("is explicitly empty when comments are not attached", () => {
    const ast = parse("// x\nfoo();", {
      commentOwnership: true,
      attachComment: false,
    });
    expect(ast.comments).toHaveLength(1);
    expect(ast.commentOwnership).toEqual([]);
  });

  it("is empty when the input has no comments", () => {
    expect(ownershipOf("foo();")).toEqual([]);
  });

  it("does not change the parse result when the option is not enabled", () => {
    const ast = parse("// x\nfoo();");
    expect(ast.commentOwnership).toBeUndefined();
    expect(ast.comments).toHaveLength(1);
    expect(ast.errors).toHaveLength(0);
    expect(ast.program.body[0].leadingComments).toHaveLength(1);
  });
});

describe("getCommentOwnership", () => {
  it("computes the same view from an AST parsed without the option", () => {
    const ast = parse("/* before */\nfoo();");
    expect(summarize(getCommentOwnership(ast))).toEqual([
      {
        comment: " before ",
        commentRange: [0, 12],
        kind: "leading",
        owner: ["ExpressionStatement", 13, 19],
      },
    ]);
  });

  it("reports comments as detached when they are not attached to any node", () => {
    const ast = parse("a(); // c", { attachComment: false });
    expect(summarize(getCommentOwnership(ast))).toEqual([
      {
        comment: " c",
        commentRange: [5, 9],
        kind: "detached",
        owner: null,
      },
    ]);
  });

  it("returns an empty view when the AST has no comments", () => {
    expect(getCommentOwnership(parse("foo();"))).toEqual([]);
  });

  it("is read-only and does not modify the AST", () => {
    const ast = parse("/* before */\nfoo();");
    deepFreeze(ast);
    expect(() => getCommentOwnership(ast)).not.toThrow();
    expect(ast.commentOwnership).toBeUndefined();
  });
});
