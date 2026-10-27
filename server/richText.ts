// @mentions and #hashtags in post captions. The client uses the same rule (src/lib/richText.ts), so keep them in sync.
// A name or tag is letters, digits or underscore. "@" and "#" must start a word, so "C#" or "a@b" are not matched.
const TOKEN = /(^|[^\p{L}\p{N}_@#&])([@#])([\p{L}\p{N}_]{1,50})/gu;
// Links are not mentions or hashtags: a "#top" inside a URL must not count as a hashtag.
const URL = /https?:\/\/[^\s<>"'`]+/giu;
const plainOf = (text: string) => text.replace(URL, " ");
const MAX_MENTIONS = 10;
const MAX_HASHTAGS = 20;

export function extractMentionNames(text: string): string[] {
  const names = new Set<string>();
  for (const m of plainOf(text).matchAll(TOKEN)) {
    if (m[2] === "@") names.add(m[3]);
    if (names.size >= MAX_MENTIONS) break;
  }
  return [...names];
}

export function extractHashtags(text: string): string[] {
  const tags = new Set<string>();
  for (const m of plainOf(text).matchAll(TOKEN)) {
    if (m[2] === "#") tags.add(m[3].toLowerCase());
    if (tags.size >= MAX_HASHTAGS) break;
  }
  return [...tags];
}
