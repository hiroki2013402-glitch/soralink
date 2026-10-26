export type ProfileForm = { displayName: string; bio: string; website: string; avatarUrl: string; coverUrl: string };
export type ProfileImageField = "avatarUrl" | "coverUrl";

export const blankProfile: ProfileForm = { displayName: "", bio: "", website: "", avatarUrl: "", coverUrl: "" };
