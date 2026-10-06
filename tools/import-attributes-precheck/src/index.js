/**
 * @file Explicit pre-check for import attributes / import assertions.
 *
 * Design constraints (see ../REPORT.md):
 *  - Duplicate keys are compared on the decoded key string, so
 *    "type" and the escape spelling of type cannot evade duplicate
 *    detection by different textual spellings.
 *  - Dynamic import(...) second-argument options are inspected only
 *    when they can be recognized statically. A spread element or any
 *    non-literal key makes the clause "not statically confirmable".
 *  - The attributes (with) and assertions (assert) dialects are selected
 *    purely by parser plugin mode. A clause of one dialect is never
 *    interpreted with the other dialect semantics.
 *  - Duplicate errors carry BOTH locations (first occurrence and the
 *    duplicate occurrence).
 *  - User expressions are never evaluated, and source code is never
 *    rewritten.
 */

/**
 * Dialect definitions. Each dialect maps 1:1 to a Babel parser plugin and
 * uses its own clause keyword / AST field, so semantics never mix.
 *
 * @typedef {object} Dialect
 * @property {string} id         Canonical dialect id.
 * @property {string} keyword    Clause keyword (with / assert).
 * @property {string} astField   Static declaration AST array field.
 * @property {"with"|"assert"} optionKey Dynamic-import option object key.
 * @property {Array|string} parserPlugin Babel parser plugin descriptor.
 */
export const DIALECTS = Object.freeze({
  /** Import Attributes proposal, `with { ... }` clause. */
  attributes: Object.freeze({
    id: "attributes",
    keyword: "with",
    astField: "attributes",
    optionKey: "with",
    parserPlugin: ["importAttributes", { deprecatedAssertSyntax: false }],
  }),
  /** Legacy Import Assertions proposal, `assert { ... }` clause. */
  assertions: Object.freeze({
    id: "assertions",
    keyword: "assert",
    astField: "assertions",
    optionKey: "assert",
    parserPlugin: "importAssertions",
  }),
});

/**
 * Resolve the Babel parser instance.
 *
 * The Babel monorepo worktree does not ship installed node_modules, so an
 * explicit search path may be supplied through options.parserPath. This
 * module never downloads anything.
 *
 * @param {object} [options]
 * @param {string} [options.parserPath] Extra directory to resolve from.
 * @returns {Promise<typeof import("@babel/parser")>}
 */
export async function loadParser(options = {}) {
  const { createRequire } = await import("node:module");
  const { fileURLToPath } = await import("node:url");
  const here = fileURLToPath(import.meta.url);
  const bases = [];
  if (options.parserPath) bases.push(options.parserPath);
  bases.push(process.cwd(), here);
  let lastError;
  for (const base of bases) {
    try {
      const scope = base.endsWith("/") || base.endsWith(".js") ? base : `${base}/`;
      return createRequire(scope)("@babel/parser");
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(
    "Unable to resolve @babel/parser. Pass parserPath or run where it is installed.",
    { cause: lastError },
  );
}

/**
 * Decode an attribute key to its semantic (unescaped) string form.
 *
 * Babel already unescapes StringLiteral tokens, and Identifier keys carry
 * their decoded name. Only decoded values participate in duplicate
 * detection; raw source spelling is retained separately for display.
 *
 * @param {object} keyNode ImportAttribute.key node.
 * @returns {{name: string, raw: string}}
 */
function decodeKey(keyNode) {
  if (keyNode.type === "StringLiteral") {
    return {
      name: keyNode.value,
      raw: keyNode.extra?.raw ?? JSON.stringify(keyNode.value),
    };
  }
  return { name: keyNode.name, raw: keyNode.name };
}

function positionOf(locPoint) {
  if (!locPoint) return null;
  return { line: locPoint.line, column: locPoint.column, index: locPoint.index };
}

function locStart(node) {
  return node?.loc ? positionOf(node.loc.start) : null;
}

function locEnd(node) {
  return node?.loc ? positionOf(node.loc.end) : null;
}

/**
 * Inspect a list of ImportAttribute nodes for duplicate decoded keys.
 *
 * @param {Array} attrs Attribute array from the AST.
 * @param {"static"|"dynamic"} clauseKind
 * @returns {{duplicates: Array, entries: Array}}
 */
function checkAttributeList(attrs, clauseKind) {
  const seen = new Map();
  const entries = [];
  const duplicates = [];

  for (const attr of attrs) {
    const { name, raw } = decodeKey(attr.key);
    const entry = {
      clause: clauseKind,
      key: name,
      rawKey: raw,
      keyLoc: locStart(attr.key),
      attrLoc: { start: locStart(attr), end: locEnd(attr) },
    };
    entries.push(entry);
    if (seen.has(name)) {
      const first = seen.get(name);
      duplicates.push({
        key: name,
        clause: clauseKind,
        // The error carries BOTH locations.
        firstLoc: first.keyLoc,
        duplicateLoc: entry.keyLoc,
        firstRaw: first.rawKey,
        duplicateRaw: raw,
        message:
          `Duplicate import attribute key "${name}" ` +
          `(first at ${first.keyLoc.line}:${first.keyLoc.column}, ` +
          `duplicate at ${entry.keyLoc.line}:${entry.keyLoc.column})`,
      });
    } else {
      seen.set(name, entry);
    }
  }
  return { duplicates, entries };
}

/**
 * Statically analyze the options object of a dynamic
 * import(specifier, options) call.
 *
 * Only an object literal whose dialect-keyed property value is itself an
 * object literal with literal keys can be confirmed statically. Spread
 * elements, computed keys, method/getter/setter properties, or repeated
 * dialect properties make the clause non-confirmable. No expression is
 * evaluated.
 *
 * @param {object|null} optionsNode Second argument node.
 * @param {Dialect} dialect
 * @returns {{static: boolean, reason?: string, duplicates?: Array, entries?: Array}}
 */
function analyzeDynamicOptions(optionsNode, dialect) {
  if (optionsNode == null) {
    return { static: true, duplicates: [], entries: [] };
  }
  if (optionsNode.type !== "ObjectExpression") {
    return { static: false, reason: "dynamic-import options argument is not an object literal" };
  }

  const foreignKey = dialect.id === "attributes" ? "assert" : "with";
  const ownClauses = [];
  for (const prop of optionsNode.properties) {
    if (prop.type === "SpreadElement") {
      return { static: false, reason: "options object contains a spread element" };
    }
    if (prop.computed || prop.method || (prop.kind != null && prop.kind !== "init")) {
      return { static: false, reason: "options object has a computed or accessor property" };
    }
    const keyName =
      prop.key.type === "Identifier"
        ? prop.key.name
        : prop.key.type === "StringLiteral"
          ? prop.key.value
          : null;
    if (keyName === null) {
      return { static: false, reason: "options object has a non-literal property key" };
    }
    // The other dialect key must not be interpreted with the active
    // dialect semantics; ignore it as a foreign option.
    if (keyName === foreignKey) continue;
    if (keyName === dialect.optionKey) ownClauses.push(prop);
    // Unknown keys (e.g. signal) are irrelevant to attribute checks.
  }

  if (ownClauses.length > 1) {
    return { static: false, reason: `multiple "${dialect.optionKey}" option properties` };
  }
  if (ownClauses.length === 0) {
    return { static: true, duplicates: [], entries: [] };
  }

  const valueNode = ownClauses[0].value;
  if (valueNode.type !== "ObjectExpression") {
    return {
      static: false,
      reason: `"${dialect.optionKey}" option value is not an object literal`,
    };
  }
  for (const prop of valueNode.properties) {
    if (prop.type === "SpreadElement") {
      return {
        static: false,
        reason: `"${dialect.optionKey}" clause contains a spread element`,
      };
    }
    if (prop.computed || prop.method || (prop.kind != null && prop.kind !== "init")) {
      return {
        static: false,
        reason: `"${dialect.optionKey}" clause has a computed or accessor key`,
      };
    }
    if (prop.key.type !== "Identifier" && prop.key.type !== "StringLiteral") {
      return { static: false, reason: `"${dialect.optionKey}" clause has a non-literal key` };
    }
    // Property values are never evaluated.
  }
  return { static: true, ...checkAttributeList(valueNode.properties, "dynamic") };
}

/** Minimal AST walker (no dependency on @babel/traverse). */
function walk(node, visit) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit);
    return;
  }
  if (typeof node.type !== "string") return;
  visit(node);
  for (const key of Object.keys(node)) {
    if (key === "loc" || key === "start" || key === "end" || key === "range" || key === "extra") {
      continue;
    }
    const value = node[key];
    if (Array.isArray(value)) {
      for (const child of value) {
        if (child && typeof child.type === "string") walk(child, visit);
      }
    } else if (value && typeof value.type === "string") {
      walk(value, visit);
    }
  }
}

/**
 * Run the pre-check over source text. The source is never modified.
 *
 * @param {string} code Source text.
 * @param {object} config
 * @param {import("@babel/parser")} config.parser Parser module.
 * @param {Dialect} config.dialect Resolved dialect descriptor.
 * @param {string} [config.filename] File name for reporting.
 * @returns {object} Structured report.
 */
export function precheckSource(code, { parser, dialect, filename = "<source>" }) {
  // errorRecovery keeps both duplicate attribute nodes in the AST so the
  // report can anchor BOTH occurrences; the parser error is surfaced too.
  let ast;
  try {
    ast = parser.parse(code, {
      sourceType: "module",
      plugins: [dialect.parserPlugin],
      errorRecovery: true,
    });
  } catch (error) {
    return {
      filename,
      dialect: dialect.id,
      ok: false,
      parseErrors: [{ message: error.message, loc: error.loc ?? null }],
      duplicates: [],
      unconfirmable: [],
      expressionsEvaluated: 0,
    };
  }

  const duplicates = [];
  const entries = [];
  const unconfirmable = [];
  const parseErrors = (ast.errors ?? []).map(error => ({
    reasonCode: error.reasonCode ?? null,
    message: error.message,
    loc: error.loc ? positionOf(error.loc) : null,
  }));

  // Babel keeps a foreign-dialect static clause in the same AST array but
  // raises a dialect-mismatch parse error. Locate such clauses so their
  // attributes are never checked with the active dialect semantics.
  const foreignReason =
    dialect.id === "attributes" ? "ImportAttributesUseAssert" : null;
  const foreignClauseRanges = foreignReason
    ? parseErrors
        .filter(e => e.reasonCode === foreignReason && e.loc)
        .map(e => e.loc.index)
    : [];

  for (const stmt of ast.program.body) {
    const isForeignClause =
      foreignClauseRanges.some(
        index => stmt.start <= index && index < stmt.end,
      );

    if (
      !isForeignClause &&
      Array.isArray(stmt[dialect.astField]) &&
      stmt[dialect.astField].length
    ) {
      const result = checkAttributeList(stmt[dialect.astField], "static");
      duplicates.push(...result.duplicates);
      entries.push(...result.entries);
    }

    walk(stmt, node => {
      if (node.type === "CallExpression" && node.callee?.type === "Import") {
        const optionsNode = node.arguments[1] ?? null;
        const result = analyzeDynamicOptions(optionsNode, dialect);
        if (result.static) {
          duplicates.push(...(result.duplicates ?? []));
          entries.push(...(result.entries ?? []));
        } else {
          unconfirmable.push({ loc: locStart(node), reason: result.reason });
        }
      }
    });
  }

  return {
    filename,
    dialect: dialect.id,
    ok: duplicates.length === 0,
    parseErrors,
    duplicates,
    entries,
    unconfirmable,
    // This pre-check never evaluates source expressions.
    expressionsEvaluated: 0,
  };
}

/**
 * Resolve a dialect id to its descriptor.
 *
 * @param {"attributes"|"assertions"} id
 * @returns {Dialect}
 */
export function resolveDialect(id) {
  const dialect = DIALECTS[id];
  if (!dialect) {
    throw new Error('Unknown dialect. Expected "attributes" or "assertions".');
  }
  return dialect;
}
