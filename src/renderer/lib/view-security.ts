// Security helpers shared by the file surfaces (.db, .canvas). Surface
// documents are user-authored; treat every URL and every document as
// untrusted input even though they live in the user's own workspace — synced
// folders and shared workspaces mean someone else may have written them.

/** Byte ceiling for a single surface document (parse refusal, not truncation). */
export const MAX_DOC_BYTES = 2 * 1024 * 1024;
/** Max rendered nodes in one surface tree — beyond this is a mistake or an attack. */
export const MAX_NODES = 2000;
/** Max nesting depth for a surface tree. */
export const MAX_DEPTH = 40;

/**
 * Returns the URL if its scheme is safe to render as a link/image, else null.
 * Blocks javascript:, file:, data:, vbscript:, and anything else surprising.
 * Scheme-less strings are rejected too — views must be explicit.
 */
export function safeUrl(url: unknown): string | null {
  if (typeof url !== 'string' || url.length === 0 || url.length > 2048) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' || parsed.protocol === 'mailto:' ? url : null;
  } catch {
    return null;
  }
}

/** True when a document's raw text is within the size budget. */
export function withinDocBudget(text: string): boolean {
  return text.length <= MAX_DOC_BYTES;
}
