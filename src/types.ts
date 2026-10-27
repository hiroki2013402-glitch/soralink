export type Visibility = "public" | "followers" | "close_friends";

export type User = { id:string; display_name:string; email:string|null; avatar_url:string|null; cover_url?:string|null; bio?:string|null; website?:string|null; created_at?:string };
// media_type / media_url are null for text-only posts. visibility defaults to public on older rows.
// A @mention in a post: the name as written, and the user it points to.
export type Mention = { user_id:string; name:string };
// Poll attached to a post (text-only posts). myVote is the option id the viewer picked, or null.
export type PollOption = { id:string; label:string; votes:number };
export type Poll = { options:PollOption[]; total:number; myVote:string|null };
export type Post = { id:string; user_id:string; media_type:"image"|"video"|null; media_url:string|null; caption:string; visibility?:Visibility; created_at:string; display_name:string; avatar_url:string|null; likes_count:number; comments_count?:number; liked?:number|boolean; mentions?:Mention[]; poll?:Poll|null };
export type Comment = { id:string; user_id:string; body:string; created_at:string; display_name:string; avatar_url:string|null };
export type Person = {id:string;display_name:string;avatar_url:string|null;bio?:string|null};
export type FollowerRow = Person & { close: boolean };
export type Notice = {
  id:string;
  kind:"like"|"follow";
  post_id:string|null;
  created_at:string;
  read_at:string|null;
  actor_id:string;
  display_name:string;
  avatar_url:string|null;
  post_caption?:string|null;
  post_media_type?:"image"|"video"|null;
  post_media_url?:string|null;
};
export type SearchResults = { users: Person[]; posts: Post[] };
export type SuggestPost = { id:string; caption:string; media_type:"image"|"video"|null; display_name:string };
export type Suggestions = { users: Person[]; posts: SuggestPost[] };

// Roles only exist in group chats. last_read_at is when the member last opened the chat; joined_at bounds read receipts.
export type DmRole = "owner" | "sub_admin" | "member";
export type DmMember = { id:string; display_name:string; avatar_url:string|null; role?:DmRole; joined_at?:string; last_read_at?:string|null };
// last_preview is the newest message's text (or a photo placeholder); last_sender_id tells the list who wrote it.
export type DmConversation = { id:string; is_group:boolean; title:string|null; icon_url?:string|null; last_message_at:string; last_preview:string|null; last_sender_id:string|null; members:DmMember[] };
// Header data for one conversation. my_role and description are set for group chats.
export type DmDetailConversation = { id:string; is_group:boolean; title:string|null; description?:string|null; icon_url?:string|null; my_role?:DmRole; members:DmMember[] };
// One reaction: the emoji and who reacted. The viewer's own reactions are found by user_id.
export type DmReaction = { emoji:string; user_id:string };
// reply_to is the message this one answers; edited_at is set once a text message has been edited.
export type DmMessage = { id:string; sender_id:string; created_at:string; kind:"text"|"image"; body:string|null; image_url:string|null; reply_to?:string|null; edited_at?:string|null; reactions?:DmReaction[]; status?:"sending"|"failed" };
// A note is a short status shown for 24 hours above the author's avatar in the message list.
export type DmNote = { user_id:string; body:string; created_at:string; expires_at:string; display_name:string; avatar_url:string|null };

// Site-wide announcement from the admin, shown as a banner.
export type Announcement = { id:string; title:string; body:string; created_at:string };

// ---- Admin area ----
export type AdminUser = { id:string; display_name:string; email:string|null; avatar_url:string|null; created_at:string; banned_at:string|null; banned_reason:string|null };
export type AdminPost = { id:string; user_id?:string; display_name?:string; avatar_url?:string|null; media_type:"image"|"video"|null; media_url:string|null; caption:string; visibility:Visibility; created_at:string };
export type AdminUserDetail = {
  user: AdminUser & { cover_url?:string|null; bio?:string|null; website?:string|null };
  posts: AdminPost[];
  followers: number;
  following: number;
  activeSessions: number;
};
export type AdminDmMember = { id:string; display_name:string; avatar_url:string|null; role?:string };
export type AdminDmConversation = { id:string; is_group:boolean; title:string|null; last_message_at:string; last_preview:string|null; last_sender_name:string|null; members:AdminDmMember[] };
export type AdminDmMessage = { id:string; sender_id:string; sender_name:string; created_at:string; kind:"text"|"image"; body:string|null; image_url:string|null };
export type AdminDmDetail = {
  conversation: { id:string; is_group:boolean; title:string|null; description:string|null; members:AdminDmMember[] };
  messages: AdminDmMessage[];
  hasMore: boolean;
};
export type AuditEntry = { id:string; action:string; target:string|null; detail:string|null; created_at:string; admin_name:string|null };
