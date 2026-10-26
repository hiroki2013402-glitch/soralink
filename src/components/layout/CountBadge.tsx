type Props = { count: number };

// Red count bubble for unread notifications and messages. Renders nothing when the count is zero.
export default function CountBadge({ count }: Props) {
  if (count <= 0) return null;
  return <span className="count-badge" aria-label={`未読${count}件`}>{count > 99 ? "99+" : count}</span>;
}
