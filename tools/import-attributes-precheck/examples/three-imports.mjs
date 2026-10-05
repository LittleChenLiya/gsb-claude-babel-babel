// Three import forms exercised by the precheck.
//
// 1. Static import with a static attribute list.
// 2. Dynamic import with a *statically recognisable* options object.
// 3. Dynamic import with a spread, which cannot be confirmed statically.

// 1) static
import data from "./data.json" with { type: "json" };

// 2) dynamic, statically recognisable options
const mod = await import("./other.json", { with: { type: "json" } });

// 3) dynamic, spread: the checker reports "uncertain", it does NOT guess and
//    it does not evaluate `attrs`.
const attrs = { type: "json" };
const maybe = await import("./third.json", { with: { ...attrs } });

export { data, mod, maybe };
