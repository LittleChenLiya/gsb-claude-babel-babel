// Example 3 (attributes dialect): dynamic import with a spread inside
// the `with` option -> cannot be confirmed statically (no expression is
// evaluated; expression evaluation count stays 0).
function load(opts) {
  return import("./data.json", { with: { ...opts } });
}
