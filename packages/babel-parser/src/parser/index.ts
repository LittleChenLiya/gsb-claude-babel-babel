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
    if (normalizedOptions.recoverySegments) {
      optionFlags |= OptionFlags.RecoverySegments;
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
    if (this.optionFlags & OptionFlags.RecoverySegments) {
      result.recoverySegments = this.buildRecoverySegments(result);
    }
    // @ts-expect-error todo: check if comments exist when `options.attachComment` is false
    result.comments.length = this.state.commentsLen;
    return result;
  }

  /**
   * Build the public `recoverySegments` report from the recovery segment
   * marks recorded in the parser state while parsing top-level statements.
   * Adjacent marks with the same reliability are merged into a single
   * segment. Errors reported outside of any top-level statement (for
   * example `ModuleExportUndefined`, reported after the program body has
   * been parsed) flag the segment containing their position as recovered,
   * so that consumers never mistake unreliable output for reliable AST.
   */
  buildRecoverySegments(result: ParseResult<File>): RecoverySegment[] {
    const marks = this.state.recoverySegmentMarks;
    let accountedErrors = 0;
    for (const mark of marks) {
      accountedErrors += mark.errors;
    }
    // Errors appended to `state.errors` after the last top-level statement
    // was parsed are not attributed to any mark yet.
    const unaccountedErrors = this.state.errors.slice(accountedErrors);
    const isWithin = (pos: number, start: number, end: number) =>
      pos >= start && pos <= end;

    const segments: RecoverySegment[] = [];
    for (const mark of marks) {
      const recovered =
        mark.recovered ||
        unaccountedErrors.some(error =>
          isWithin(error.pos, mark.start, mark.end),
        );
      const last = segments[segments.length - 1];
      if (last !== undefined && last.recovered === recovered) {
        last.end = mark.end;
      } else {
        segments.push({ start: mark.start, end: mark.end, recovered });
      }
    }
    // Unaccounted errors whose position is not covered by any statement
    // (for example an error reported at the end of the input) get their
    // own trailing recovered segment.
    if (
      unaccountedErrors.some(
        error => !marks.some(mark => isWithin(error.pos, mark.start, mark.end)),
      )
    ) {
      const programEnd = result.program.end ?? this.input.length;
      const last = segments[segments.length - 1];
      if (last !== undefined && last.recovered) {
        last.end = programEnd;
      } else {
        segments.push({
          start: last === undefined ? (result.program.start ?? 0) : last.end,
          end: programEnd,
          recovered: true,
        });
      }
    }
    return segments;
  }
}
