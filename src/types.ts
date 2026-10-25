export type User = { id:string; display_name:string; email:string|null; avatar_url:string|null; cover_url?:string|null; bio?:string|null; website?:string|null; created_at?:string };
// media_type / media_url are null for text-only posts.
export type Post = { id:string; user_id:string; media_type:"image"|"video"|null; media_url:string|null; caption:string; created_at:string; display_name:string; avatar_url:string|null; likes_count:number; comments_count?:number; liked?:number|boolean };
export type Comment = { id:string; user_id:string; body:string; created_at:string; display_name:string; avatar_url:string|null };
export type Person = {id:string;display_name:string;avatar_url:string|null;bio?:string|null};
export type Notice = {id:string;kind:"like"|"follow";post_id:string|null;created_at:string;read_at:string|null;actor_id:string;display_name:string;avatar_url:string|null};
