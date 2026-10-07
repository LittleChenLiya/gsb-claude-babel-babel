import type { Comment, File, Node } from "../types.ts";

/**
 * How a comment relates to its owner AST node:
 * - `"leading"`: the comment is in the owner node's `leadingComments`
 * - `"trailing"`: the comment is in the owner node's `trailingComments`
 * - `"inner"`: the comment is in the owner node's `innerComments`
 * - `"detached"`: the comment is not attached to any AST node
 */
export type CommentOwnershipKind = "leading" | "trailing" | "inner" | "detached";

/**
 * Read-only info about the AST node owning a comment.
 */
export interface CommentOwner {
  /**
   * The `type` of the owner AST node, e.g. `"ExpressionStatement"`.
   */
  type: string;
  /**
   * The start offset of the owner node.
   */
  start: number;
  /**
   * The end offset of the owner node.
   */
  end: number;
}

/**
 * A read-only record describing which AST node owns a given comment.
 */
export interface CommentOwnershipRecord {
  /**
   * The owned (or detached) comment. Its own `start`/`end` offsets
   * describe the comment range.
   */
  comment: Comment;
  /**
   * How the comment is attached to its owner node.
   */
  kind: CommentOwnershipKind;
  /**
   * The owner node info, or `null` when the comment is detached.
   */
  owner: CommentOwner | null;
}

// Babel can attach one comment whitespace to both the preceding node
// (as `trailingComments`) and the following node (as `leadingComments`).
// To guarantee that every comment is counted against exactly one owner,
// attachments are deduplicated by comment identity with a deterministic
// priority: leading > trailing > inner.
const kindPriority: Record<CommentOwnershipKind, number> = {
  leading: 0,
  trailing: 1,
  inner: 2,
  detached: 3,
};

// Keys whose values never contain AST nodes that can own comments.
// Skipping them keeps the walk cheap and prevents comment objects
// (which also have a string `type`) from being mistaken for AST nodes.
const skippedKeys = new Set([
  "leadingComments",
  "trailingComments",
  "innerComments",
  "comments",
  "tokens",
  "errors",
  "loc",
  "extra",
  "range",
]);

type CommentAttachment = {
  kind: CommentOwnershipKind;
  owner: CommentOwner;
};

function isNodeLike(value: unknown): value is Node {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Node).type === "string"
  );
}

/**
 * Compute a read-only ownership view for the comments of a parsed AST.
 *
 * The view reuses the existing attachment data (`leadingComments`,
 * `trailingComments` and `innerComments`) produced by the parser and
 * assigns every comment in `ast.comments` to exactly one owner node,
 * or marks it as `"detached"` when it is not attached to any node.
 *
 * The input AST is not modified. When the AST carries no comments
 * (e.g. it was parsed with `attachComment: false` and no comments were
 * recorded, or the input simply has no comments), the result is empty.
 */
export function getCommentOwnership(
  ast: (File | Node) & { comments?: Comment[] | null },
): CommentOwnershipRecord[] {
  const allComments = ast.comments;
  if (allComments == null || allComments.length === 0) {
    return [];
  }

  const attachments = new Map<Comment, CommentAttachment>();

  const register = (
    comments: Comment[] | null | undefined,
    kind: CommentOwnershipKind,
    node: Node,
  ) => {
    if (comments == null) return;
    for (const comment of comments) {
      const existing = attachments.get(comment);
      if (
        existing === undefined ||
        kindPriority[kind] < kindPriority[existing.kind]
      ) {
        attachments.set(comment, {
          kind,
          owner: {
            type: node.type,
            start: node.start!,
            end: node.end!,
          },
        });
      }
    }
  };

  const stack: Node[] = [ast];
  while (stack.length > 0) {
    const node = stack.pop()!;
    register(node.leadingComments, "leading", node);
    register(node.trailingComments, "trailing", node);
    register(node.innerComments, "inner", node);

    for (const key of Object.keys(node)) {
      if (skippedKeys.has(key)) continue;
      const value = (node as any)[key];
      if (Array.isArray(value)) {
        for (let i = value.length - 1; i >= 0; i--) {
          if (isNodeLike(value[i])) {
            stack.push(value[i]);
          }
        }
      } else if (isNodeLike(value)) {
        stack.push(value);
      }
    }
  }

  const records: CommentOwnershipRecord[] = [];
  for (const comment of allComments) {
    const attachment = attachments.get(comment);
    if (attachment === undefined) {
      records.push({ comment, kind: "detached", owner: null });
    } else {
      records.push({ comment, kind: attachment.kind, owner: attachment.owner });
    }
  }
  return records;
}
