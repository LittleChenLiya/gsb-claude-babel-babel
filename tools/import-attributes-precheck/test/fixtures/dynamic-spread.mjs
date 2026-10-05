// Spread in dynamic import options: statically unconfirmable, zero evaluation.
const attrs = { type: "json" };
const mod = import("./a.json", { with: { ...attrs } });
