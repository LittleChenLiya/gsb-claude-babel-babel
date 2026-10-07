import type {
  Comment,
  CommentBlock,
  CommentLine,
  ExportedToken,
} from "../types.ts";

/**
 * Token labels that can be selected for redaction through
 * `redactTokens.types`. The labels are the same values exposed on
 * `token.type.label` when `tokens: true` is enabled.
 */
export type RedactableTokenType =
  | "name"
  | "string"
  | "num"
  | "bigint"
  | "regexp"
  | "`"
  | "...`"
  | "...${"
  | "#!...";

/**
 * The token-level redaction options. Only token `value`s are masked:
 * `type`, `start`/`end` (and therefore the covered range) and `loc` are
 * always preserved. Comments are not part of `types` and are controlled
 * independently via the `comments` option.
 */
export interface RedactTokensOptions {
  /**
   * Labels of the lexical token types whose `value` must be masked, e.g.
   * `["string"]` to only redact string literals. Tokens whose label is
   * not listed keep their original value untouched.
   */
  types: ReadonlyArray<RedactableTokenType | string>;
  /**
   * Independently controls whether comment tokens interleaved in the
   * token stream are redacted. Defaults to `false`; in that case comment
   * tokens are left untouched.
   */
  comments?: boolean;
  /**
   * The placeholder used to replace redacted values. It is always a
   * string so that the exported token shape stays stable regardless of
   * the original value type (string, number, bigint or an object such as
   * the regexp `{ pattern, flags }` value).
   */
  placeholder?: string;
}

type ResolvedRedactTokensOptions = {
  types: ReadonlySet<string>;
  comments: boolean;
  placeholder: string;
};

export const DEFAULT_REDACTION_PLACEHOLDER = "[redacted]";

/**
 * Resolve the user provided redaction options into a fast internal shape.
 * Returns `null` when redaction is disabled so the export path stays
 * allocation-free.
 */
export function resolveRedactTokensOptions(
  options: RedactTokensOptions | null | undefined,
): ResolvedRedactTokensOptions | null {
  if (options == null) return null;

  const types = options.types;
  if (types == null) {
    throw new Error(
      "The `redactTokens` option requires a non-empty `types` array.",
    );
  }
  if (!Array.isArray(types)) {
    throw new Error("The `redactTokens.types` option must be an array.");
  }

  return {
    types: new Set(types),
    comments: options.comments === true,
    placeholder:
      typeof options.placeholder === "string"
        ? options.placeholder
        : DEFAULT_REDACTION_PLACEHOLDER,
  };
}

function isCommentToken(
  token: ExportedToken | Comment,
): token is CommentBlock | CommentLine {
  return token.type === "CommentBlock" || token.type === "CommentLine";
}

/**
 * Token export adapter applying local, value-only redaction.
 *
 * The exported token array is rebuilt instead of mutated, and every
 * redacted token/comment is shallow-cloned: comments pushed into the
 * token stream are the very same object references stored in
 * `File.comments` and attached to AST nodes, so cloning guarantees that
 * the original AST (and thus the input later fed to the code generator)
 * is never modified.
 *
 * Cloned tokens intentionally copy only `type`, `value`, `start`, `end`
 * and `loc`. Any non-standard side channel such as `extra`/`raw` is not
 * copied, so the redacted source text cannot leak through raw bypasses.
 */
export function redactExportedTokens(
  tokens: ReadonlyArray<ExportedToken | Comment>,
  options: ResolvedRedactTokensOptions,
): (ExportedToken | Comment)[] {
  const { types, comments, placeholder } = options;
  const result: (ExportedToken | Comment)[] = new Array(tokens.length);

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];

    const isComment = isCommentToken(token);
    const shouldRedact = isComment ? comments : types.has(token.type.label);

    if (!shouldRedact) {
      // Tokens that are not selected for redaction are returned as-is,
      // preserving their original value and object identity.
      result[i] = token;
      continue;
    }

    // Recreate the token from its public fields only. `type`/`range`/`loc`
    // are preserved verbatim while the source content held by `value` is
    // replaced; no other property (raw/extra) is carried over. Branching on
    // the discriminated union keeps the optional comment positions
    // (`start`/`end`/`loc`) assignable, while regular tokens always carry
    // numeric positions.
    if (isComment) {
      result[i] = {
        type: token.type,
        value: placeholder,
        start: token.start,
        end: token.end,
        loc: token.loc,
      };
    } else {
      result[i] = {
        type: token.type,
        value: placeholder,
        start: token.start,
        end: token.end,
        loc: token.loc,
      };
    }
  }

  return result;
}
