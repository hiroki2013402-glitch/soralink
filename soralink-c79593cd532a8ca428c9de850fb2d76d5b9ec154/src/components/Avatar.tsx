export default function Avatar({ url, name, size = "normal" }: { url: string | null | undefined; name: string; size?: "normal" | "large" | "small" }) {
  return <span className={`avatar ${size}`}>{url ? <img src={url} alt="" loading="lazy" /> : (name?.slice(0, 1) || "S")}</span>;
}
