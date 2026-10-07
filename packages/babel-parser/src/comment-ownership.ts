import type {
  Comment,
  CommentOwnershipKind,
  CommentOwnershipRecord,
  Node,
} from "./types.ts";

export type { CommentOwnershipKind, CommentOwnershipRecord };

// Node properties that never contain descendant AST nodes and are therefore
// not worth traversing when collecting the attached comments.
const skippedKeys = new Set([
  "leadingComments",
  "trailingComments",
  "innerComments",
  "loc",
  "comments",
  "tokens",
  "errors",
  "locData",
]);

type RawAttachment = {
  kind: CommentOwnershipKind;
  comment: Comment;
  owner: Node;
};

function isNode(value: unknown): value is Node {
  return (
    typeof (value as Node).type === "string" &&
    typeof (value as Node).start === "number" &&
    typeof (value as Node).end === "number"
  );
}

/**
 * Build a read-only comment ownership view for a finished parse result.
 *
 * The view reuses the existing comment attachment data (`leadingComments`,
 * `trailingComments` and `innerComments`) produced by the parser. Every
 * parsed comment is reported exactly once: when a comment is attached to
 * two adjacent nodes (as the trailing comment of the previous node and as
 * the leading comment of the next one), the "leading" attachment wins, and
 * "trailing" wins over "dangling".
 *
 * The returned records are sorted by the comment start offset and frozen,
 * together with the array itself.
 */
export function buildCommentOwnership(
  root: Node,
): readonly CommentOwnershipRecord[] {
  const attachments: RawAttachment[] = [];
  const visited = new Set<object>();
  const stack: unknown[] = [root];

  while (stack.length > 0) {
    const value = stack.pop();
    if (value === null || typeof value !== "object" || visited.has(value)) {
      continue;
    }
    visited.add(value);
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        stack.push(value[i]);
      }
      continue;
    }
    if (!isNode(value)) {
      continue;
    }
    const { leadingComments, trailingComments, innerComments } = value;
    if (leadingComments != null) {
      for (const comment of leadingComments) {
        attachments.push({ kind: "leading", comment: comment as Comment, owner: value });
      }
    }
    if (trailingComments != null) {
      for (const comment of trailingComments) {
        attachments.push({ kind: "trailing", comment: comment as Comment, owner: value });
      }
    }
    if (innerComments != null) {
      for (const comment of innerComments) {
        attachments.push({ kind: "dangling", comment: comment as Comment, owner: value });
      }
    }
    for (const key of Object.keys(value)) {
      if (!skippedKeys.has(key)) {
        stack.push((value as unknown as Record<string, unknown>)[key]);
      }
    }
  }

  // Claim every comment exactly once, preferring "leading" over "trailing"
  // over "dangling" when a comment is attached to multiple nodes.
  const claimed = new Set<Comment>();
  const records: CommentOwnershipRecord[] = [];
  for (const kind of ["leading", "trailing", "dangling"] as const) {
    for (const attachment of attachments) {
      const { comment, owner } = attachment;
      if (attachment.kind !== kind || claimed.has(comment)) {
        continue;
      }
      claimed.add(comment);
      records.push(
        Object.freeze({
          kind,
          comment: Object.freeze({
            type: comment.type,
            start: comment.start!,
            end: comment.end!,
          }),
          owner: Object.freeze({
            type: owner.type,
            start: owner.start!,
            end: owner.end!,
          }),
        }),
      );
    }
  }

  records.sort((a, b) => a.comment.start - b.comment.start);
  return Object.freeze(records);
}
