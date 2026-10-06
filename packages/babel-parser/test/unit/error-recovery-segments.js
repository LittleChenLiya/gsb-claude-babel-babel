import { parse } from "../../lib/index.js";

describe("errorRecovery recovery segments", () => {
  // Three-fragment example: a well-formed function, a function whose body
  // contains a recoverable syntax error, and another well-formed function.
  const threeFragmentCode = [
    "function first() { return 1; }",
    "function second() { return 1 return 2; }",
    "function third() { return 3; }",
  ].join("\n");

  const recoveryOptions = { errorRecovery: true, recoverySegments: true };

  it("reports reliable and recovered ranges for the three-fragment example", () => {
    const result = parse(threeFragmentCode, recoveryOptions);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].reasonCode).toBe("MissingSemicolon");

    const [first, second, third] = result.program.body;

    // The normal fragments are reliable, the broken one is flagged as
    // recovered: the whole AST must not be treated as successful.
    expect(result.recoverySegments).toEqual([
      { start: first.start, end: first.end, recovered: false },
      { start: second.start, end: second.end, recovered: true },
      { start: third.start, end: third.end, recovered: false },
    ]);

    // The recovered segment covers the broken function's source text.
    const brokenSource = threeFragmentCode.slice(
      result.recoverySegments[1].start,
      result.recoverySegments[1].end,
    );
    expect(brokenSource).toBe("function second() { return 1 return 2; }");
    // The error position lies inside the recovered segment.
    const errorPos = result.errors[0].pos;
    expect(errorPos).toBeGreaterThanOrEqual(result.recoverySegments[1].start);
    expect(errorPos).toBeLessThanOrEqual(result.recoverySegments[1].end);
  });

  it("keeps error positions identical to a plain errorRecovery parse", () => {
    const withSegments = parse(threeFragmentCode, recoveryOptions);
    const plain = parse(threeFragmentCode, { errorRecovery: true });

    expect(
      withSegments.errors.map(({ pos, loc, message, reasonCode }) => ({
        pos,
        loc,
        message,
        reasonCode,
      })),
    ).toEqual(
      plain.errors.map(({ pos, loc, message, reasonCode }) => ({
        pos,
        loc,
        message,
        reasonCode,
      })),
    );
    // Same AST apart from the extra report property.
    const { recoverySegments, ...rest } = withSegments;
    expect(rest).toEqual(plain);
  });

  it("still throws on fatal errors instead of producing a fake AST", () => {
    expect(() => parse("function )", recoveryOptions)).toThrow(
      /Unexpected token/,
    );
    expect(() =>
      parse("function first() {} function )", recoveryOptions),
    ).toThrow(/Unexpected token/);
  });

  it("does not add recoverySegments to the default return structure", () => {
    const recovered = parse(threeFragmentCode, { errorRecovery: true });
    expect("recoverySegments" in recovered).toBe(false);

    const plain = parse("1 + 1");
    expect("recoverySegments" in plain).toBe(false);
  });

  it("requires errorRecovery to be enabled", () => {
    expect(() => parse("1 + 1", { recoverySegments: true })).toThrow(
      /recoverySegments.*errorRecovery/,
    );
  });

  it("marks every segment reliable when there is nothing to recover", () => {
    const result = parse("const a = 1;\nconst b = 2;\n", recoveryOptions);
    expect(result.errors).toHaveLength(0);
    expect(result.recoverySegments).toEqual([
      {
        start: result.program.start,
        end: result.program.body[1].end,
        recovered: false,
      },
    ]);
  });

  it("uses the same plugin configuration as a normal parse", () => {
    const code = [
      "const el = <div>{1}</div>;",
      "function mid() { return 1 return 2; }",
      "const other = <span />;",
    ].join("\n");
    const plugins = ["jsx"];

    const withSegments = parse(code, { ...recoveryOptions, plugins });
    const plain = parse(code, { errorRecovery: true, plugins });

    expect(withSegments.errors).toHaveLength(1);
    expect(withSegments.errors[0].pos).toBe(plain.errors[0].pos);
    expect(withSegments.errors[0].message).toBe(plain.errors[0].message);

    const [first, second, third] = withSegments.program.body;
    expect(withSegments.recoverySegments).toEqual([
      { start: first.start, end: first.end, recovered: false },
      { start: second.start, end: second.end, recovered: true },
      { start: third.start, end: third.end, recovered: false },
    ]);
  });

  it("attributes errors reported outside top-level statements to a recovered segment", () => {
    // `ModuleExportUndefined` is reported after the whole program body has
    // been parsed, so it is not attached to any statement mark; the segment
    // containing its position is flagged as recovered instead.
    const result = parse("export { und };", {
      ...recoveryOptions,
      sourceType: "module",
    });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].reasonCode).toBe("ModuleExportUndefined");
    expect(result.recoverySegments).toEqual([
      {
        start: result.program.body[0].start,
        end: result.program.body[0].end,
        recovered: true,
      },
    ]);
  });
});
