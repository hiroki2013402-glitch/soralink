// Splits a caption or message into text, links, @mentions and #hashtags. Same rules as server/richText.ts: keep them in sync.
export type Segment =
  | { kind: "text"; value: string }
  | { kind: "mention"; value: string; name: string }
  | { kind: "hashtag"; value: string; tag: string }
  | { kind: "link"; value: string; href: string };

const TOKEN = /(^|[^\p{L}\p{N}_@#&])([@#])([\p{L}\p{N}_]{1,50})/gu;
// http(s) links only. Characters that usually close a sentence or a bracket are left out of the link.
export const URL_PATTERN = /https?:\/\/[^\s<>"'`]+/giu;
const TRAILING_PUNCTUATION = /[.,!?;:)\]}>」』）】、。]+$/u;

function splitLinks(text: string): { value: string; isLink: boolean }[] {
  const out: { value: string; isLink: boolean }[] = [];
  let last = 0;
  for (const m of text.matchAll(URL_PATTERN)) {
    const start = m.index ?? 0;
    const raw = m[0];
    const value = raw.replace(TRAILING_PUNCTUATION, "");
    if (value.length <= "https://".length) continue;
    if (start > last) out.push({ value: text.slice(last, start), isLink: false });
    out.push({ value, isLink: true });
    last = start + value.length;
  }
  if (last < text.length) out.push({ value: text.slice(last), isLink: false });
  return out;
}

function tokenizePlain(text: string): Segment[] {
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

export function tokenize(text: string): Segment[] {
  const out: Segment[] = [];
  for (const part of splitLinks(text)) {
    if (part.isLink) out.push({ kind: "link", value: part.value, href: part.value });
    else out.push(...tokenizePlain(part.value));
  }
  return out;
}

// Feed cards load a smaller copy of an uploaded image. Old posts without one fall back to the original on the server.
export function thumbUrl(mediaUrl: string) {
  return mediaUrl.startsWith("/api/media/") ? `${mediaUrl}?size=thumb` : mediaUrl;
}
