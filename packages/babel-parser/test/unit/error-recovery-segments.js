import { parse } from "../../lib/index.js";

// A small JS file whose first function parses cleanly and whose second
// function contains a recoverable syntax error (a duplicate lexical
// declaration), followed by another clean function.
const threeFunctions = `function good() {
  return 1;
}
function bad() {
  let x;
  let x;
}
function after() {
  return 3;
}
`;

describe("errorRecovery recovery segment report", () => {
  it("marks reliable and recovery ranges in a three-segment example", () => {
    const ast = parse(threeFunctions, { errorRecovery: true });

    expect(ast.errors).toHaveLength(1);
    expect(ast.errors[0].reasonCode).toBe("VarRedeclaration");

    // The report partitions the whole file: the reliable ranges around the
    // recovered statement and the recovery range containing it.
    const badStatementStart = threeFunctions.indexOf("  let x;\n}") + 2;
    const badStatementEnd = badStatementStart + "let x;".length;
    expect(ast.recoverySegments).toEqual([
      { start: 0, end: badStatementStart, reliable: true },
      { start: badStatementStart, end: badStatementEnd, reliable: false },
      { start: badStatementEnd, end: threeFunctions.length, reliable: true },
    ]);

    // The first and third functions are fully inside reliable ranges,
    // while the recovered error sits inside the recovery range.
    const [good, bad, after] = ast.program.body;
    const [reliableHead, recovery, reliableTail] = ast.recoverySegments;
    expect(good.start).toBeGreaterThanOrEqual(reliableHead.start);
    expect(good.end).toBeLessThanOrEqual(reliableHead.end);
    expect(after.start).toBeGreaterThanOrEqual(reliableTail.start);
    expect(after.end).toBeLessThanOrEqual(reliableTail.end);
    expect(ast.errors[0].pos).toBeGreaterThanOrEqual(recovery.start);
    expect(ast.errors[0].pos).toBeLessThan(recovery.end);
    expect(bad.start).toBeLessThan(recovery.start);
    expect(bad.end).toBeGreaterThan(recovery.end);
  });

  it("marks the whole function when recovery happens at function level", () => {
    const source = `function good() { return 1; }
function bad() { "use strict"; 010; }
function after() { return 3; }
`;
    const ast = parse(source, { errorRecovery: true });

    expect(ast.errors).toHaveLength(1);
    const bad = ast.program.body[1];
    expect(ast.recoverySegments).toEqual([
      { start: 0, end: bad.start, reliable: true },
      { start: bad.start, end: bad.end, reliable: false },
      { start: bad.end, end: source.length, reliable: true },
    ]);
  });

  it("keeps fatal errors fatal and does not produce a pseudo AST", () => {
    const source = "function a() {}\nfunction b( {}";
    let recoveredError;
    try {
      parse(source, { errorRecovery: true });
    } catch (error) {
      recoveredError = error;
    }
    let defaultError;
    try {
      parse(source);
    } catch (error) {
      defaultError = error;
    }
    // Fatal errors still reject in both modes, and the reported error
    // positions are identical to the original ones.
    expect(recoveredError).toBeInstanceOf(SyntaxError);
    expect(defaultError).toBeInstanceOf(SyntaxError);
    expect(recoveredError.pos).toBe(defaultError.pos);
    expect(recoveredError.loc).toEqual(defaultError.loc);
    expect(recoveredError.message).toBe(defaultError.message);
  });

  it("reports recovered errors at the same positions as thrown errors", () => {
    const source = "function f() { let x; let x; }";
    const ast = parse(source, { errorRecovery: true });
    let thrown;
    try {
      parse(source);
    } catch (error) {
      thrown = error;
    }
    expect(ast.errors).toHaveLength(1);
    expect(ast.errors[0].pos).toBe(thrown.pos);
    expect(ast.errors[0].loc).toEqual(thrown.loc);
    expect(ast.errors[0].message).toBe(thrown.message);
  });

  it("preserves the default return structure", () => {
    const ast = parse("1 + 1;");
    expect(ast).not.toHaveProperty("recoverySegments");

    const cleanAst = parse("1 + 1;", { errorRecovery: true });
    expect(cleanAst.errors).toHaveLength(0);
    // With errorRecovery enabled the report is explicit even when every
    // range is reliable.
    expect(cleanAst.recoverySegments).toEqual([
      { start: 0, end: 6, reliable: true },
    ]);
  });

  it("covers program-level recovered errors with a point segment", () => {
    const source = "export { foo };\n";
    const ast = parse(source, { errorRecovery: true, sourceType: "module" });
    expect(ast.errors).toHaveLength(1);
    const pos = ast.errors[0].pos;
    expect(ast.recoverySegments).toEqual([
      { start: 0, end: pos, reliable: true },
      { start: pos, end: pos + 1, reliable: false },
      { start: pos + 1, end: source.length, reliable: true },
    ]);
  });

  it("uses the same plugin configuration as a normal parse", () => {
    const source = `const el = <div />;
function bad() { let y; let y; }
`;
    const options = { errorRecovery: true, plugins: ["jsx"] };
    const ast = parse(source, options);
    expect(ast.program.body[0].declarations[0].init.type).toBe("JSXElement");
    expect(ast.errors).toHaveLength(1);
    const bad = ast.program.body[1];
    const recovery = ast.recoverySegments.find(segment => !segment.reliable);
    expect(recovery).toBeDefined();
    expect(ast.errors[0].pos).toBeGreaterThanOrEqual(recovery.start);
    expect(ast.errors[0].pos).toBeLessThan(recovery.end);
    expect(bad.start).toBeLessThanOrEqual(recovery.start);
    expect(bad.end).toBeGreaterThanOrEqual(recovery.end);

    // A normal parse with the same plugins still throws on the error.
    expect(() => parse(source, { plugins: ["jsx"] })).toThrow(SyntaxError);
  });
});
