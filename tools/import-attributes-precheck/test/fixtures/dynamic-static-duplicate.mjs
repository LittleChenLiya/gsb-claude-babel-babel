// Dynamic import with a statically recognisable duplicate key.
const mod = import("./a.json", { with: { type: "json", "type": "css" } });
