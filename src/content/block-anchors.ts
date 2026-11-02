/**
 * Obsidian anchors carried by a chunk: a trailing block id (`text ^block-id`, or a
 * line holding only `^block-id`) and highlighted text (`==text==`, `<mark>`).
 * Pure functions over the chunk text so the index and the schema migration agree.
 */
export interface ChunkAnchors {
  /** The trailing block id including its caret (for example `^abc-1`), or null. */
  blockId: string | null;
  hasHighlight: boolean;
}

const BLOCK_ID_AT_END = /(?:^|\s)(\^[A-Za-z0-9-]+)\s*$/;
const FENCE_LINE = /^ {0,3}(`{3,}|~{3,})/;
const INLINE_CODE = /`[^`\n]*`/g;
const MARKDOWN_HIGHLIGHT = /==(?!\s)(?:(?!==)[^\n])+?(?<!\s)==/;
const HTML_MARK = /<mark\b[^>]*>/i;

/** Text outside fenced code; `endsInCode` is true when the last non-empty line is code. */
function visibleText(text: string): { visible: string; endsInCode: boolean } {
  const kept: string[] = [];
  let fence: string | null = null;
  let endsInCode = false;
  for (const line of text.split('\n')) {
    const marker = FENCE_LINE.exec(line)?.[1];
    if (fence === null) {
      if (marker) {
        fence = marker;
        if (line.trim()) endsInCode = true;
        continue;
      }
      kept.push(line);
      if (line.trim()) endsInCode = false;
    } else {
      if (line.trim()) endsInCode = true;
      if (marker && marker[0] === fence[0] && marker.length >= fence.length) fence = null;
    }
  }
  return { visible: kept.join('\n').replace(INLINE_CODE, ''), endsInCode };
}

export function extractChunkAnchors(text: string): ChunkAnchors {
  const { visible, endsInCode } = visibleText(text);
  const match = endsInCode ? null : BLOCK_ID_AT_END.exec(text.trimEnd());
  return {
    blockId: match ? match[1]! : null,
    hasHighlight: MARKDOWN_HIGHLIGHT.test(visible) || HTML_MARK.test(visible),
  };
}
