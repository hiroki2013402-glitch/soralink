import type { Visibility } from "../types";

export const VISIBILITY_OPTIONS: { value: Visibility; label: string; hint: string }[] = [
  { value: "public", label: "公開", hint: "誰でも見られます" },
  { value: "followers", label: "フォロワーのみ", hint: "フォロワーだけに表示されます" },
  { value: "close_friends", label: "親しい友達", hint: "親しい友達に選んだ人だけに表示されます。親しい友達はフォロワーの中から設定で追加できます" }
];

export const visibilityLabel = (value?: Visibility) => VISIBILITY_OPTIONS.find(o => o.value === value)?.label ?? "公開";
