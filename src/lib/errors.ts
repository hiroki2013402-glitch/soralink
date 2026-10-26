export const errorMessage = (e: unknown, fallback = "処理できませんでした。") =>
  e instanceof Error ? e.message : fallback;
