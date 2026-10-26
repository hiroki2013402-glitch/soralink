export type Visibility = "public" | "followers" | "close_friends";

export type User = { id:string; display_name:string; email:string|null; avatar_url:string|null; cover_url?:string|null; bio?:string|null; website?:string|null; created_at?:string };
// media_type / media_url are null for text-only posts. visibility defaults to public on older rows.
export type Post = { id:string; user_id:string; media_type:"image"|"video"|null; media_url:string|null; caption:string; visibility?:Visibility; created_at:string; display_name:string; avatar_url:string|null; likes_count:number; comments_count?:number; liked?:number|boolean };
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
export type DmMessage = { id:string; sender_id:string; created_at:string; kind:"text"|"image"; body:string|null; image_url:string|null };
// A note is a short status shown for 24 hours above the author's avatar in the message list.
export type DmNote = { user_id:string; body:string; created_at:string; expires_at:string; display_name:string; avatar_url:string|null };
