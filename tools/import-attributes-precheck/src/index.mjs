// @ts-check
/**
 * Explicit pre-check for import attributes ("with" / "assert" dialects).
 *
 * Design constraints:
 *  - This is a *static* check. It never executes any expression from the
 *    source being checked, and it never modifies the source.
 *  - Duplicate keys are compared after decoding: type, "type", 'type' are
 *    the same key, so two equivalent keys cannot escape the duplicate rule
 *    merely by being spelled differently.
 *  - Dynamic import(...) options are only inspected when they can be
 *    recognised statically (object literals with static keys); a spread or
 *    an expression where the attributes would be is reported as "uncertain"
 *    rather than guessed.
 *  - The attributes ("with") and assertions ("assert") dialects are decided
 *    entirely by the parser plugin mode; their semantics are never mixed.
 *  - Duplicate errors carry the locations of both sides.
 *
 * Works on the AST produced by @babel/parser. Babel 7 uses node.assertions for
 * the importAssertions plugin and node.attributes for importAttributes;
 * Babel 8 uses node.attributes only and rejects assert syntax.
 */

const STATIC_CLAUSE_TYPES = new Set([
  "ImportDeclaration",
  "ExportNamedDeclaration",
  "ExportAllDeclaration",
]);

function locOf(node) {
  const l = node && node.loc && node.loc.start;
  if (!l) return { line: 0, column: 0 };
  return { line: l.line, column: l.column };
}

/**
 * Decode an ImportAttribute key node to its canonical key string.
 * StringLiteral keys are compared by their decoded value (AST value),
 * so quote style and escape sequences cannot be used to dodge the rule.
 */
function decodeKey(keyNode) {
  if (!keyNode) return null;
  if (keyNode.type === "Identifier") return keyNode.name;
  if (keyNode.type === "StringLiteral") return keyNode.value;
  return null;
}

/** Read the statically known name of an object property key. */
function staticPropertyName(keyNode, computed) {
  if (computed) return null;
  if (keyNode.type === "Identifier") return keyNode.name;
  if (keyNode.type === "StringLiteral") return keyNode.value;
  if (keyNode.type === "NumericLiteral") return String(keyNode.value);
  return null;
}

/**
 * Detect duplicate decoded keys inside one attribute list.
 */
function checkAttributeList(attrs, clause, dialect, findings) {
  const seen = new Map();
  for (const attr of attrs || []) {
    const key = decodeKey(attr.key);
    if (key === null) continue;
    const loc = locOf(attr.key);
    const first = seen.get(key);
    if (first) {
      const label =
        dialect === "assertions" ? "import assertion" : "import attribute";
      findings.push({
        kind: "duplicate-key",
        clause,
        dialect,
        key,
        loc,
        firstLoc: first.loc,
        message:
          "Duplicate " + label + " key " + JSON.stringify(key) +
          ": first defined at " + first.loc.line + ":" + first.loc.column +
          ", duplicated at " + loc.line + ":" + loc.column + ".",
      });
    } else {
      seen.set(key, { key, loc });
    }
  }
}

/**
 * Statically inspect a dynamic import options object.
 * Only an object literal with a statically known with/assert object literal
 * can be checked. Anything requiring evaluation is recorded as uncertain.
 */
function checkDynamicOptions(options, dialect, findings, uncertain) {
  const keyName = dialect === "assertions" ? "assert" : "with";

  if (options === null || options === undefined) return;

  if (options.type !== "ObjectExpression") {
    uncertain.push({
      clause: "dynamic-import",
      reason: "non-literal-options",
      loc: locOf(options),
      message:
        "Dynamic import options are not an object literal; the presence of " +
        "duplicate " + keyName + " keys cannot be confirmed statically.",
    });
    return;
  }

  let attrsObject = null;
  for (const prop of options.properties) {
    if (prop.type === "SpreadElement") {
      uncertain.push({
        clause: "dynamic-import",
        reason: "spread",
        loc: locOf(prop),
        message:
          "Spread element in dynamic import options cannot be resolved " +
          "statically; duplicate attributes cannot be confirmed.",
      });
      continue;
    }
    const name = staticPropertyName(prop.key, prop.computed);
    if (name === null) {
      uncertain.push({
        clause: "dynamic-import",
        reason: "computed-key",
        loc: locOf(prop.key),
        message:
          "Computed key in dynamic import options cannot be resolved " +
          "statically.",
      });
      continue;
    }
    if (name === keyName) {
      attrsObject = prop.value;
    }
  }

  if (attrsObject === null) return;

  if (attrsObject.type !== "ObjectExpression") {
    uncertain.push({
      clause: "dynamic-import",
      reason: "non-literal-with-value",
      loc: locOf(attrsObject),
      message:
        "Dynamic import " + JSON.stringify(keyName) + " value is not an " +
        "object literal; duplicate attributes cannot be confirmed statically.",
    });
    return;
  }

  const attrs = [];
  for (const prop of attrsObject.properties) {
    if (prop.type === "SpreadElement") {
      uncertain.push({
        clause: "dynamic-import",
        reason: "spread",
        loc: locOf(prop),
        message:
          "Spread element in dynamic import " + JSON.stringify(keyName) +
          " attributes cannot be resolved statically; duplicate attributes " +
          "cannot be confirmed.",
      });
      continue;
    }
    const name = staticPropertyName(prop.key, prop.computed);
    if (name === null) {
      uncertain.push({
        clause: "dynamic-import",
        reason: "computed-key",
        loc: locOf(prop.key),
        message:
          "Computed key in dynamic import " + JSON.stringify(keyName) +
          " attributes cannot be resolved statically.",
      });
      continue;
    }
    attrs.push({
      key: { type: "Identifier", name, loc: prop.key.loc },
      value: prop.value,
    });
  }
  checkAttributeList(attrs, "dynamic-import", dialect, findings);
}

/** Minimal AST walk without requiring @babel/traverse. */
function walkNodes(node, parent, visitor) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) walkNodes(item, parent, visitor);
    return;
  }
  if (typeof node.type !== "string") return;
  visitor(node, parent);
  for (const key of Object.keys(node)) {
    if (key === "loc" || key === "start" || key === "end" || key === "range") {
      continue;
    }
    walkNodes(node[key], node, visitor);
  }
}

/**
 * Check a parsed AST.
 * @param {any} ast parsed File
 * @param {{dialect?: "attributes"|"assertions"}} [opts]
 * @returns {object} report
 */
export function checkAst(ast, opts = {}) {
  // Dialect is chosen by plugin mode; default is the current standard
  // (with, i.e. import attributes). The two dialects are never mixed.
  const dialect = opts.dialect === "assertions" ? "assertions" : "attributes";

  const findings = [];
  const uncertain = [];
  let staticClauseCount = 0;
  let dynamicImportCount = 0;

  walkNodes(ast.program ?? ast, null, (node) => {
    if (STATIC_CLAUSE_TYPES.has(node.type)) {
      // Babel 8 / importAttributes plugin: node.attributes
      // Babel 7 importAssertions plugin: node.assertions
      const attrs =
        dialect === "assertions"
          ? node.assertions || node.attributes
          : node.attributes;
      if (attrs && attrs.length > 0) {
        staticClauseCount++;
        checkAttributeList(
          attrs,
          node.type === "ImportDeclaration" ? "static-import" : "static-export",
          dialect,
          findings,
        );
      }
    } else if (node.type === "ImportExpression") {
      dynamicImportCount++;
      checkDynamicOptions(node.options, dialect, findings, uncertain);
    }
  });

  // Parser syntax errors (e.g. assert under a with-only plugin mode) are
  // surfaced but kept distinct from semantic duplicate findings. The
  // parser's own single-location duplicate-key error is suppressed because
  // the explicit pre-check above reports the same issue with BOTH locations.
  for (const err of ast.errors || []) {
    if (err.reasonCode === "ModuleAttributesWithDuplicateKeys") continue;
    const l = err.loc || { line: 0, column: 0 };
    findings.push({
      kind: "syntax",
      clause: "static-import",
      dialect,
      loc: { line: l.line, column: l.column },
      firstLoc: { line: 0, column: 0 },
      message: err.reasonCode
        ? "[" + err.reasonCode + "] " + err.message
        : err.message,
    });
  }

  return {
    dialect,
    staticClauseCount,
    dynamicImportCount,
    expressionEvaluationCount: 0,
    sourceModificationCount: 0,
    findings,
    uncertain,
  };
}

/** Format a report as human-readable text. */
export function formatReport(report, filename = "<input>") {
  const kw = report.dialect === "assertions" ? "assert" : "with";
  const dupes = report.findings.filter(f => f.kind === "duplicate-key");
  const lines = [];
  lines.push("import-attributes precheck: " + filename);
  lines.push("  dialect:                 " + report.dialect + " (" + kw + " keyword)");
  lines.push("  static clauses checked:  " + report.staticClauseCount);
  lines.push("  dynamic imports checked: " + report.dynamicImportCount);
  lines.push("  expressions evaluated:   " + report.expressionEvaluationCount);
  lines.push("  source modifications:    " + report.sourceModificationCount);
  lines.push("  duplicate findings:      " + dupes.length);
  lines.push("  statically uncertain:    " + report.uncertain.length);
  for (const f of report.findings) {
    lines.push("  X [" + f.kind + "] " + f.loc.line + ":" + f.loc.column + " " + f.message);
  }
  for (const u of report.uncertain) {
    lines.push("  ? [" + u.reason + "] " + u.loc.line + ":" + u.loc.column + " " + u.message);
  }
  return lines.join("\n");
}
