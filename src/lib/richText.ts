// Splits a caption into text, @mentions and #hashtags. Same rule as server/richText.ts: keep them in sync.
export type Segment =
  | { kind: "text"; value: string }
  | { kind: "mention"; value: string; name: string }
  | { kind: "hashtag"; value: string; tag: string };

const TOKEN = /(^|[^\p{L}\p{N}_@#&])([@#])([\p{L}\p{N}_]{1,50})/gu;

export function tokenize(text: string): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const m of text.matchAll(TOKEN)) {
    const start = (m.index ?? 0) + m[1].length;
    const value = m[2] + m[3];
    if (start > last) out.push({ kind: "text", value: text.slice(last, start) });
    out.push(m[2] === "@" ? { kind: "mention", value, name: m[3] } : { kind: "hashtag", value, tag: m[3] });
    last = start + value.length;
  }
  if (last < text.length) out.push({ kind: "text", value: text.slice(last) });
  return out;
}

// Feed cards load a smaller copy of an uploaded image. Old posts without one fall back to the original on the server.
export function thumbUrl(mediaUrl: string) {
  return mediaUrl.startsWith("/api/media/") ? `${mediaUrl}?size=thumb` : mediaUrl;
}
