// @ts-check
/**
 * Parser adapter. The dialect (import attributes vs import assertions) is
 * determined solely by the requested plugin mode, keeping the two keyword
 * semantics separate.
 *
 * Vendored parser bundles are used so that the tool runs in this worktree
 * without installing or building the whole monorepo:
 *   vendor/babel-parser.mjs      @babel/parser 8.x (ESM)
 *   vendor/babel-parser-7.cjs    @babel/parser 7.x (CJS)
 */
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));

let parser8;
let parser7;

/**
 * Babel 8 can throw a hard SyntaxError for unsupported `assert` syntax even
 * with errorRecovery enabled. Normalise that into a File-shaped object whose
 * `errors` array carries the syntax finding, so the dialect boundary is
 * reported instead of crashing.
 */
function normalizeThrown(err) {
  return {
    program: { type: "Program", body: [], sourceType: "module" },
    errors: [
      {
        reasonCode: err.reasonCode || "ParseError",
        message: err.message,
        loc: err.loc
          ? { line: err.loc.line, column: err.loc.column }
          : { line: 0, column: 0 },
      },
    ],
  };
}

async function getParser8() {
  if (!parser8) {
    parser8 = await import(
      pathToFileURL(path.resolve(here, "../vendor/babel-parser.mjs")).href
    );
  }
  return parser8;
}

function getParser7() {
  if (!parser7) {
    parser7 = require(path.resolve(here, "../vendor/babel-parser-7.cjs"));
  }
  return parser7;
}

/**
 * @param {string} code
 * @param {object} opts
 * @param {"attributes"|"assertions"} opts.dialect
 * @param {string} [opts.sourceType]
 * @returns {Promise<any>} parsed File (with errorRecovery enabled)
 */
export async function parseCode(code, opts) {
  const dialect = opts.dialect === "assertions" ? "assertions" : "attributes";
  const sourceType = opts.sourceType || "module";

  if (dialect === "assertions") {
    const { parse } = getParser7();
    try {
      return parse(code, {
        sourceType,
        plugins: ["importAssertions"],
        createImportExpressions: true,
        errorRecovery: true,
      });
    } catch (err) {
      return normalizeThrown(err);
    }
  }

  const { parse } = await getParser8();
  try {
    return parse(code, {
      sourceType,
      plugins: ["importAttributes"],
      errorRecovery: true,
    });
  } catch (err) {
    return normalizeThrown(err);
  }
}
