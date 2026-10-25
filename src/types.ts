export type User = { id:string; display_name:string; email:string|null; avatar_url:string|null; cover_url?:string|null; bio?:string|null; website?:string|null; created_at?:string };
export type Post = { id:string; user_id:string; media_type:"image"|"video"; media_url:string; caption:string; created_at:string; display_name:string; avatar_url:string|null; likes_count:number };
export type Story = { id:string; user_id:string; media_type:"image"|"video"; media_url:string; caption:string; created_at:string; expires_at:string; display_name:string; avatar_url:string|null };
export type Person = {id:string;display_name:string;avatar_url:string|null;bio?:string|null};
export type Notice = {id:string;kind:"like"|"follow";post_id:string|null;created_at:string;read_at:string|null;actor_id:string;display_name:string;avatar_url:string|null};
