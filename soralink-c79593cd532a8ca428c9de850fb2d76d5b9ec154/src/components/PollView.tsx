import { useState } from "react";
import { api } from "../lib/api";
import { errorMessage } from "../lib/errors";
import type { Poll } from "../types";

type Props = {
  postId: string;
  poll: Poll;
  signedIn: boolean;
  onNotice: (text: string) => void;
};

// A poll under a post. Anyone signed in can vote, and voting again changes the vote. Results show after the first vote.
export default function PollView({ postId, poll: initial, signedIn, onNotice }: Props) {
  const [poll, setPoll] = useState(initial);
  const [busy, setBusy] = useState(false);
  const answered = poll.myVote !== null;

  const vote = async (optionId: string) => {
    if (!signedIn) return onNotice("投票するにはログインしてください。");
    if (busy || optionId === poll.myVote) return;
    setBusy(true);
    try {
      const r = await api<{ poll: Poll }>(`/posts/${encodeURIComponent(postId)}/vote`, { method: "POST", body: JSON.stringify({ optionId }) });
      setPoll(r.poll);
    } catch (e) {
      onNotice(errorMessage(e, "投票できませんでした。"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="poll" role="group" aria-label="投票">
      {poll.options.map(option => {
        const percent = poll.total ? Math.round((option.votes / poll.total) * 100) : 0;
        const mine = poll.myVote === option.id;
        return (
          <button
            key={option.id}
            type="button"
            className={`poll-option ${mine ? "mine" : ""} ${answered ? "answered" : ""}`}
            onClick={e => { e.stopPropagation(); void vote(option.id); }}
            disabled={busy}
            aria-pressed={mine}
          >
            {answered && <span className="poll-bar" style={{ width: `${percent}%` }} aria-hidden="true" />}
            <span className="poll-label">{option.label}</span>
            {answered && <span className="poll-percent">{percent}%</span>}
          </button>
        );
      })}
      <small className="poll-meta">{poll.total}票{answered ? "・ 別の選択肢をタップすると投票を変更できます" : "・ 選択肢をタップして投票"}</small>
    </div>
  );
}
