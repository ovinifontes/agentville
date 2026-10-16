// Shared by every incremental JSONL reader: a read of the bytes appended since the cached
// offset can land mid-append — partway through the line still being written, and possibly
// partway through a multi-byte UTF-8 character. The split is made on the raw bytes: 0x0A
// never occurs inside a multi-byte UTF-8 sequence, so the byte count consumed is exact.
// Measuring a held-back tail after decoding is not: a torn character decodes to U+FFFD
// (3 bytes), so the offset lands 1-2 bytes short — or negative when the whole chunk is one
// torn line, after which every read throws.

export interface CompleteLines {
  /** The decoded complete lines, without their '\n'. Empty when the chunk holds none. */
  lines: string[];
  /** Bytes those lines span, final '\n' included: how far the offset may advance. */
  bytes: number;
}

export function splitCompleteLines(chunk: Buffer): CompleteLines {
  const lastNewline = chunk.lastIndexOf(0x0a);
  if (lastNewline === -1) {
    return { lines: [], bytes: 0 };
  }
  const text = chunk.subarray(0, lastNewline).toString('utf8');
  return { lines: text.split('\n'), bytes: lastNewline + 1 };
}
