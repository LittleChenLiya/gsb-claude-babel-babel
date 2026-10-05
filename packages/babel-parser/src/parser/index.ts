import type * as N from "../types.ts";
import { getOptions, OptionFlags } from "../options.ts";
import StatementParser from "./statement.ts";
import ScopeHandler from "../util/scope.ts";
import type {
  ParserOptions,
  ParseResult,
  RecoverySegment,
  File,
} from "@babel/parser";

export type PluginsMap = Map<string, Record<string, any>>;

export default class Parser extends StatementParser {
  constructor(
    options: ParserOptions | undefined | null,
    input: string,
    pluginsMap: PluginsMap,
  ) {
    const normalizedOptions = getOptions(options);
    super(normalizedOptions, input);

    this.options = normalizedOptions;
    this.initializeScopes();
    this.plugins = pluginsMap;
    this.filename = normalizedOptions.sourceFilename;
    this.startIndex = normalizedOptions.startIndex;

    let optionFlags = 0;
    if (normalizedOptions.allowAwaitOutsideFunction) {
      optionFlags |= OptionFlags.AllowAwaitOutsideFunction;
    }
    if (normalizedOptions.allowReturnOutsideFunction) {
      optionFlags |= OptionFlags.AllowReturnOutsideFunction;
    }
    if (normalizedOptions.allowImportExportEverywhere) {
      optionFlags |= OptionFlags.AllowImportExportEverywhere;
    }
    if (normalizedOptions.allowSuperOutsideMethod) {
      optionFlags |= OptionFlags.AllowSuperOutsideMethod;
    }
    if (normalizedOptions.allowUndeclaredExports) {
      optionFlags |= OptionFlags.AllowUndeclaredExports;
    }
    if (normalizedOptions.allowNewTargetOutsideFunction) {
      optionFlags |= OptionFlags.AllowNewTargetOutsideFunction;
    }
    if (normalizedOptions.allowYieldOutsideFunction) {
      optionFlags |= OptionFlags.AllowYieldOutsideFunction;
    }
    if (normalizedOptions.ranges) {
      optionFlags |= OptionFlags.Ranges;
    }
    if (normalizedOptions.locations === true) {
      optionFlags |= OptionFlags.Locations;
    }
    if (normalizedOptions.tokens) {
      optionFlags |= OptionFlags.Tokens;
    }
    if (normalizedOptions.createImportExpressions) {
      optionFlags |= OptionFlags.CreateImportExpressions;
    }
    if (normalizedOptions.createParenthesizedExpressions) {
      optionFlags |= OptionFlags.CreateParenthesizedExpressions;
    }
    if (normalizedOptions.errorRecovery) {
      optionFlags |= OptionFlags.ErrorRecovery;
    }
    if (normalizedOptions.attachComment) {
      optionFlags |= OptionFlags.AttachComment;
    }
    if (normalizedOptions.annexB) {
      optionFlags |= OptionFlags.AnnexB;
    }

    this.optionFlags = optionFlags;
  }

  // This can be overwritten, for example, by the TypeScript plugin.
  getScopeHandler(): new (...args: any) => ScopeHandler {
    return ScopeHandler;
  }

  parse(): ParseResult<File> {
    this.enterInitialScopes();
    const file = this.startNode<N.File>();
    const program = this.startNode<N.Program>();
    this.nextToken();
    // @ts-expect-error "errors" does not exist on type "File"
    file.errors = [];
    const result = this.parseTopLevel(file, program) as ParseResult<File>;
    result.errors = this.state.errors;
    if (this.optionFlags & OptionFlags.ErrorRecovery) {
      result.recoverySegments = this.buildRecoverySegments(result);
    }
    // @ts-expect-error todo: check if comments exist when `options.attachComment` is false
    result.comments.length = this.state.commentsLen;
    return result;
  }

  /**
   * Build the explicit recovery segment report for `errorRecovery` mode.
   *
   * The report partitions the whole file into alternating reliable and
   * recovery segments, using the recovery ranges recorded along the parser
   * state during the single parse pass (no second parse is performed to
   * infer positions). Recovered errors that are not covered by any
   * statement-level recovery segment (e.g. raised after the last statement
   * was parsed) are covered by point segments at the error position.
   */
  buildRecoverySegments(result: ParseResult<File>): RecoverySegment[] {
    const { errors, recoverySegments } = this.state;
    const merged: Array<{ start: number; end: number }> = [];

    if (errors.length > 0) {
      const raw = recoverySegments.slice();
      for (const error of errors) {
        const pos = error.pos;
        let covered = false;
        for (const segment of raw) {
          if (segment.start <= pos && pos < segment.end) {
            covered = true;
            break;
          }
        }
        if (!covered) {
          raw.push({ start: pos, end: pos + 1 });
        }
      }
      raw.sort((a, b) => a.start - b.start || a.end - b.end);
      for (const segment of raw) {
        const last = merged[merged.length - 1];
        if (last !== undefined && segment.start <= last.end) {
          if (segment.end > last.end) last.end = segment.end;
        } else {
          merged.push({ start: segment.start, end: segment.end });
        }
      }
    }

    // The file node is already finished at this point, so its range is set.
    const fileStart = result.start!;
    let fileEnd = result.end!;
    for (const segment of merged) {
      if (segment.end > fileEnd) fileEnd = segment.end;
    }

    const report: RecoverySegment[] = [];
    let cursor = fileStart;
    for (const segment of merged) {
      const start = Math.max(segment.start, cursor);
      if (start > cursor) {
        report.push({ start: cursor, end: start, reliable: true });
      }
      report.push({ start, end: segment.end, reliable: false });
      cursor = segment.end;
    }
    if (cursor < fileEnd) {
      report.push({ start: cursor, end: fileEnd, reliable: true });
    }
    return report;
  }
}
