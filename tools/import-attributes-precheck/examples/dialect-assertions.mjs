// The legacy "assert" dialect. This file is only valid input when the
// precheck runs in --dialect assertions (parser plugin importAssertions).
// Under the default attributes ("with") mode the parser rejects it with an
// ImportAttributesUseAssert syntax error; the two dialects never mix.
import data from "./data.json" assert { type: "json" };
export default data;
