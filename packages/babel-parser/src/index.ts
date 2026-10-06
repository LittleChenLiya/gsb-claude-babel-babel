import type { Options } from "./options.ts";
import {
  validatePlugins,
  mixinPluginNames,
  mixinPlugins,
} from "./plugin-utils.ts";
export type {
  PluginConfig as ParserPlugin,
  FlowPluginOptions,
  PipelineOperatorPluginOptions,
  TypeScriptPluginOptions,
} from "./typings.d.ts";
import Parser, { type PluginsMap } from "./parser/index.ts";
import type { ParseError } from "./parse-error.ts";
export type { ParseError };

import type { ExportedTokenType } from "./tokenizer/types.ts";
import {
  getExportedToken,
  tt as internalTokenTypes,
  type InternalTokenTypes,
} from "./tokenizer/types.ts";
export type { Token } from "./tokenizer/index.ts";

// TODO: Rather than type-casting the internal AST definitions to the
// @babel/types one, we should actually unify them.
import type { Expression, File } from "@babel/types";
export type { Expression, File };

export type ParserOptions = Partial<Options>;

/**
 * A segment of the source text reported by the `recoverySegments` option.
 * Segments describe which ranges of the input were parsed cleanly and which
 * ranges contain AST nodes recovered from parse errors.
 */
export interface RecoverySegment {
  /** Start index (inclusive) of the covered source range. */
  start: number;
  /** End index (exclusive) of the covered source range. */
  end: number;
  /**
   * `true` if this range contains AST nodes recovered from parse errors and
   * thus should not be fully trusted; `false` if this range was parsed
   * without any recovered error.
   */
  recovered: boolean;
}

export type ParseResult<Result extends File | Expression = File> = Result & {
  comments: File["comments"];
  errors: ParseError[];
  tokens?: File["tokens"];
  /**
   * Only present when the `recoverySegments` option is enabled (it requires
   * `errorRecovery: true`): an explicit report of which source ranges are
   * reliable and which contain recovered AST nodes. When the option is not
   * enabled, this property is not added to the result.
   */
  recoverySegments?: RecoverySegment[];
};

/**
 * Parse the provided code as an entire ECMAScript program.
 */
export function parse(
  input: string,
  options?: ParserOptions,
): ParseResult<File> {
  if (options?.sourceType === "unambiguous") {
    options = {
      ...options,
    };
    try {
      options.sourceType = "module";
      const parser = getParser(options, input);
      const ast = parser.parse();

      if (parser.sawUnambiguousESM) {
        return ast;
      }

      if (parser.ambiguousScriptDifferentAst) {
        // Top level await introduces code which can be both a valid script and
        // a valid module, but which produces different ASTs:
        //    await
        //    0
        // can be parsed either as an AwaitExpression, or as two ExpressionStatements.
        try {
          options.sourceType = "script";
          return getParser(options, input).parse();
        } catch {}
      } else {
        // This is both a valid module and a valid script, but
        // we parse it as a script by default
        ast.program.sourceType = "script";
      }

      return ast;
    } catch (moduleError) {
      try {
        options.sourceType = "script";
        return getParser(options, input).parse();
      } catch {}

      throw moduleError;
    }
  } else {
    return getParser(options, input).parse();
  }
}

export function parseExpression(
  input: string,
  options?: ParserOptions,
): ParseResult<Expression> {
  const parser = getParser(options, input);
  if (parser.options.strictMode) {
    parser.state.strict = true;
  }
  return parser.getExpression();
}

function generateExportedTokenTypes(
  internalTokenTypes: InternalTokenTypes,
): Record<string, ExportedTokenType> {
  const tokenTypes: Record<string, ExportedTokenType> = {};
  for (const typeName of Object.keys(
    internalTokenTypes,
  ) as (keyof InternalTokenTypes)[]) {
    tokenTypes[typeName] = getExportedToken(internalTokenTypes[typeName]);
  }
  return tokenTypes;
}

export const tokTypes = generateExportedTokenTypes(internalTokenTypes);

function getParser(
  options: ParserOptions | undefined | null,
  input: string,
): Parser {
  let cls = Parser;
  const pluginsMap: PluginsMap = new Map();
  if (options?.plugins) {
    for (const plugin of options.plugins) {
      let name, opts;
      if (typeof plugin === "string") {
        name = plugin;
      } else {
        [name, opts] = plugin;
      }
      if (!pluginsMap.has(name)) {
        pluginsMap.set(name, opts || {});
      }
    }
    validatePlugins(pluginsMap);
    cls = getParserClass(pluginsMap);
  }

  return new cls(options, input, pluginsMap);
}

const parserClassCache = new Map<string, new (...args: any) => Parser>();

/** Get a Parser class with plugins applied. */
function getParserClass(
  pluginsMap: Map<string, any>,
): new (...args: any) => Parser {
  const pluginList = [];
  for (const name of mixinPluginNames) {
    if (pluginsMap.has(name)) {
      pluginList.push(name);
    }
  }
  const key = pluginList.join("|");
  let cls = parserClassCache.get(key)!;
  if (!cls) {
    cls = Parser;
    for (const plugin of pluginList) {
      // @ts-expect-error todo(flow->ts)
      cls = mixinPlugins[plugin](cls);
    }
    parserClassCache.set(key, cls);
  }
  return cls;
}

export function getLine(locData: Uint32Array, pos: number): number {
  if (pos < 0 || pos * 2 >= locData.length) {
    throw new Error(`Position ${pos} is out of bounds for location data.`);
  }
  return locData[pos * 2];
}

export function getColumn(locData: Uint32Array, pos: number): number {
  if (pos < 0 || pos * 2 + 1 >= locData.length) {
    throw new Error(`Position ${pos} is out of bounds for location data.`);
  }
  return locData[pos * 2 + 1];
}
