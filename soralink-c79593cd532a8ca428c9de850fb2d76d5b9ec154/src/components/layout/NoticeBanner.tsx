import { X } from "lucide-react";

type Props = { text: string; onClose: () => void };

// Short status message shown at the top of the main column; dismissed by the X button or after a few seconds.
export default function NoticeBanner({ text, onClose }: Props) {
  return (
    <div className="notice" role="status">{text}<button onClick={onClose} aria-label="閉じる"><X size={15} /></button></div>
  );
}
