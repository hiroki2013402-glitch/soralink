import { ImagePlus, Link2, LoaderCircle, Video, Clock3, Send } from "lucide-react";
import { useState } from "react";
type Props = { onCreate: (input: { mediaType:"image"|"video"; mediaUrl:string; caption:string; kind:"post"|"story" }) => Promise<void> };
export default function CreatePost({onCreate}:Props){
 const [kind,setKind]=useState<"post"|"story">("post"),[mediaType,setMediaType]=useState<"image"|"video">("image"),[mediaUrl,setMediaUrl]=useState(""),[caption,setCaption]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState("");
 async function submit(e:React.FormEvent){e.preventDefault();setError("");setBusy(true);try{await onCreate({kind,mediaType,mediaUrl:mediaUrl.trim(),caption:caption.trim()});setMediaUrl("");setCaption("");}catch(err){setError(err instanceof Error?err.message:"投稿できませんでした。");}finally{setBusy(false)}}
 return <form className="composer card" onSubmit={submit}><div className="section-heading"><div><span className="eyebrow">SHARE A MOMENT</span><h2>作成</h2></div><span className="pill">{kind==="story"?"24時間で消えます":"プロフィールに残ります"}</span></div>
 <div className="media-toggle"><button type="button" className={kind==="post"?"selected":""} onClick={()=>setKind("post")}><Send size={16}/>投稿</button><button type="button" className={kind==="story"?"selected":""} onClick={()=>setKind("story")}><Clock3 size={16}/>ストーリー</button></div>
 <div className="media-toggle"><button type="button" className={mediaType==="image"?"selected":""} onClick={()=>setMediaType("image")}><ImagePlus size={16}/>画像</button><button type="button" className={mediaType==="video"?"selected":""} onClick={()=>setMediaType("video")}><Video size={16}/>動画</button></div>
 <label className="field-label" htmlFor="mediaUrl">メディアURL（HTTPS）</label><div className="input-with-icon"><Link2 size={17}/><input id="mediaUrl" type="url" required value={mediaUrl} onChange={e=>setMediaUrl(e.target.value)} placeholder={mediaType==="image"?"https://example.com/photo.jpg":"https://example.com/video.mp4"}/></div>
 <label className="field-label" htmlFor="caption">キャプション</label><textarea id="caption" value={caption} maxLength={500} onChange={e=>setCaption(e.target.value)} placeholder="今の気持ちをシェアしよう…" rows={3}/>{error&&<p className="error-text">{error}</p>}
 <div className="composer-footer"><span>{caption.length}/500</span><button className="primary-button" disabled={busy||!mediaUrl.trim()}>{busy?<LoaderCircle className="spin" size={17}/>:null}{kind==="story"?"ストーリーを公開":"投稿する"}</button></div></form>
}
