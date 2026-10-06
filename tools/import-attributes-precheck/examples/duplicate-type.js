// Example 1 (attributes dialect): two equivalent `type` keys.
// The second spelling uses a unicode escape so the raw source text
// differs, but after decoding both keys are "type" -> must be REJECTED.
import data from "./data.json" with { type: "json", "\u0074ype": "json" };
