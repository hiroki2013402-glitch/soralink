import type { Mention } from "../types";
import { tokenize } from "../lib/richText";
import SafeLink from "./SafeLink";

type Props = {
  text: string;
  mentions?: Mention[];
  onMention?: (userId: string) => void;
  onHashtag?: (tag: string) => void;
};

// Renders a caption or message: links (confirmed before opening), @mentions (linked when the name belongs to a user in this post) and #hashtags (search links).
export default function RichText({ text, mentions = [], onMention, onHashtag }: Props) {
  return (
    <>
      {tokenize(text).map((part, index) => {
        if (part.kind === "text") return <span key={index}>{part.value}</span>;
        if (part.kind === "link") return <SafeLink key={index} href={part.href}>{part.value}</SafeLink>;
        if (part.kind === "hashtag") {
          return onHashtag
            ? <button key={index} type="button" className="rich-link" onClick={e => { e.stopPropagation(); onHashtag(part.tag); }}>{part.value}</button>
            : <span key={index}>{part.value}</span>;
        }
        const target = mentions.find(m => m.name.toLowerCase() === part.name.toLowerCase());
        return target && onMention
          ? <button key={index} type="button" className="rich-link" onClick={e => { e.stopPropagation(); onMention(target.user_id); }}>{part.value}</button>
          : <span key={index}>{part.value}</span>;
      })}
    </>
  );
}
