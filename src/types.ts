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

export type DmMember = { id:string; display_name:string; avatar_url:string|null };
export type DmConversation = { id:string; is_group:boolean; title:string|null; last_message_at:string; members:DmMember[] };
export type DmMessage = { id:string; sender_id:string; created_at:string; image_url:string };
