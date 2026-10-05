// Two equivalent type keys with different string spellings.
// After decoding both are the key "type" and must be rejected.
import a from "./a.json" with { type: "json", "type": "css" };
