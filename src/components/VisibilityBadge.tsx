import { Star, Users } from "lucide-react";
import { visibilityLabel } from "../lib/visibility";
import type { Visibility } from "../types";

// Small label next to the post time. Public posts show nothing.
export default function VisibilityBadge({ visibility }: { visibility?: Visibility }) {
  if (!visibility || visibility === "public") return null;
  const Icon = visibility === "close_friends" ? Star : Users;
  return (
    <span className={`vis-badge ${visibility}`} title={visibilityLabel(visibility)}>
      <Icon size={12} />
      {visibilityLabel(visibility)}
    </span>
  );
}
