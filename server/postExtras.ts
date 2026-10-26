import { db } from "./db.js";

// Data stored next to a post: mentions, hashtags and poll options/votes.
export type PollOption = { id: string; label: string; votes: number };
export type PollView = { options: PollOption[]; total: number; myVote: string | null };
export type Mention = { user_id: string; name: string };

// Adds `mentions` and `poll` to post rows. `poll` is null for posts without one.
export async function attachPostExtras<T extends { id: string }>(rows: T[], viewer: string | null) {
  const ids = rows.map(r => String(r.id));
  if (!ids.length) return [];
  const marks = ids.map(() => "?").join(",");
  const [mentions, options] = await Promise.all([
    db.execute({ sql: `SELECT post_id, user_id, name FROM post_mentions WHERE post_id IN (${marks})`, args: ids }),
    db.execute({
      sql: `SELECT o.id, o.post_id, o.label, o.position,
              (SELECT COUNT(*) FROM poll_votes v WHERE v.option_id = o.id) AS votes,
              (SELECT v2.option_id FROM poll_votes v2 WHERE v2.post_id = o.post_id AND v2.user_id = ?) AS my_vote
            FROM poll_options o WHERE o.post_id IN (${marks}) ORDER BY o.post_id, o.position`,
      args: [viewer ?? "", ...ids]
    })
  ]);

  const mentionsByPost = new Map<string, Mention[]>();
  for (const m of mentions.rows) {
    const list = mentionsByPost.get(String(m.post_id)) ?? [];
    list.push({ user_id: String(m.user_id), name: String(m.name) });
    mentionsByPost.set(String(m.post_id), list);
  }

  const pollByPost = new Map<string, PollView>();
  for (const o of options.rows) {
    const postId = String(o.post_id);
    const poll = pollByPost.get(postId) ?? { options: [], total: 0, myVote: null };
    const votes = Number(o.votes) || 0;
    poll.options.push({ id: String(o.id), label: String(o.label), votes });
    poll.total += votes;
    if (o.my_vote !== null && o.my_vote !== undefined) poll.myVote = String(o.my_vote);
    pollByPost.set(postId, poll);
  }

  return rows.map(r => ({
    ...r,
    mentions: mentionsByPost.get(String(r.id)) ?? [],
    poll: pollByPost.get(String(r.id)) ?? null
  }));
}

// Statements that remove everything stored next to a post. Used by the author's delete and by the admin delete.
export function postCleanupStatements(postId: string) {
  return [
    { sql: "DELETE FROM comments WHERE post_id = ?", args: [postId] },
    { sql: "DELETE FROM likes WHERE post_id = ?", args: [postId] },
    { sql: "DELETE FROM post_mentions WHERE post_id = ?", args: [postId] },
    { sql: "DELETE FROM post_hashtags WHERE post_id = ?", args: [postId] },
    { sql: "DELETE FROM poll_votes WHERE post_id = ?", args: [postId] },
    { sql: "DELETE FROM poll_options WHERE post_id = ?", args: [postId] }
  ];
}
