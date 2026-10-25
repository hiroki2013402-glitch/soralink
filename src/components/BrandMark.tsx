import { Link2 } from "lucide-react";

export default function BrandMark({ size = 23 }: { size?: number }) {
  return <span className="brand-mark" aria-label="SoraLink"><Link2 size={size} strokeWidth={2.4} /></span>;
}
