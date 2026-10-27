import { Copy, CornerUpLeft, Pencil, Trash2 } from "lucide-react";
import type { DmMessage } from "../../types";

// Reactions a member can pick. Keep in sync with REACTIONS on the server (server/dm.ts).
export const DM_REACTIONS = ["❤️", "👍", "😂", "😮", "😢", "🙏"] as const;

type Props = {
  message: DmMessage;
  mine: boolean;
  onClose: () => void;
  onReact: (emoji: string) => void;
  onReply: () => void;
  onCopy: () => void;
  onEdit: () => void;
  onUnsend: () => void;
};

// Action sheet opened by long-pressing (or right-clicking) a message. Each action closes the sheet first.
export default function MessageMenu({ message, mine, onClose, onReact, onReply, onCopy, onEdit, onUnsend }: Props) {
  const isText = message.kind === "text";
  const run = (action: () => void) => () => {
    onClose();
    action();
  };

  return (
    <div className="dm-sheet-scrim" onClick={onClose} onContextMenu={e => e.preventDefault()}>
      <div className="dm-sheet" role="dialog" aria-modal="true" aria-label="メッセージの操作" onClick={e => e.stopPropagation()}>
        <div className="dm-sheet-reactions" role="group" aria-label="リアクション">
          {DM_REACTIONS.map(emoji => (
            <button key={emoji} type="button" onClick={run(() => onReact(emoji))} aria-label={`${emoji}でリアクション`}>{emoji}</button>
          ))}
        </div>
        <div className="dm-sheet-list">
          <button type="button" onClick={run(onReply)}><CornerUpLeft size={18} />返信</button>
          {isText && <button type="button" onClick={run(onCopy)}><Copy size={18} />コピー</button>}
          {mine && isText && <button type="button" onClick={run(onEdit)}><Pencil size={18} />編集</button>}
          {mine && <button type="button" className="danger" onClick={run(onUnsend)}><Trash2 size={18} />送信を取り消す</button>}
        </div>
        <button type="button" className="dm-sheet-cancel" onClick={onClose}>閉じる</button>
      </div>
    </div>
  );
}
