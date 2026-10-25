import { LoaderCircle, Clock3, Send, Upload, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api";
type Props = { onCreate: (input: { mediaType:"image"|"video"; mediaUrl:string; caption:string; kind:"post"|"story" }) => Promise<void> };
export default function CreatePost({onCreate}:Props){
 const [kind,setKind]=useState<"post"|"story">("post"),[file,setFile]=useState<File|null>(null),[caption,setCaption]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState(""); const inputRef=useRef<HTMLInputElement>(null);
 const mediaType = file?.type.startsWith("video/") ? "video" : "image";
 const previewUrl = useMemo(() => file ? URL.createObjectURL(file) : "", [file]);
 useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);
 async function submit(e:React.FormEvent){e.preventDefault();setError("");if(!file){setError("投稿する画像または動画を選択してください。");return}setBusy(true);try{const body=new FormData();body.append("file",file);const uploaded=await api<{url:string}>("/media/upload",{method:"POST",body});await onCreate({kind,mediaType,mediaUrl:uploaded.url,caption:caption.trim()});setFile(null);setCaption("");if(inputRef.current)inputRef.current.value="";}catch(err){setError(err instanceof Error?err.message:"投稿できませんでした。");}finally{setBusy(false)}}
 return <form className="composer card facebook-composer" onSubmit={submit}><div className="section-heading"><div><span className="eyebrow">SHARE A MOMENT</span><h2>投稿を作成</h2></div><span className="pill">{kind==="story"?"24時間で消えます":"プロフィールに残ります"}</span></div>
 <div className="media-toggle"><button type="button" className={kind==="post"?"selected":""} onClick={()=>setKind("post")}><Send size={16}/>投稿</button><button type="button" className={kind==="story"?"selected":""} onClick={()=>setKind("story")}><Clock3 size={16}/>ストーリー</button></div>
 <button type="button" className={`upload-dropzone ${file?"has-file":""}`} onClick={()=>inputRef.current?.click()}><Upload size={24}/><strong>{file?file.name:"写真・動画を追加"}</strong><span>{file ? `${(file.size/1024/1024).toFixed(1)} MB · 選択し直す` : "端末から直接アップロード（最大20MB）"}</span></button>
 <input ref={inputRef} className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime" onChange={e=>setFile(e.target.files?.[0]||null)}/>
 {file&&<div className="upload-preview">{mediaType==="image"?<img src={previewUrl} alt="投稿プレビュー"/>:<video src={previewUrl} controls/>}<button type="button" aria-label="ファイルを削除" onClick={()=>{setFile(null);if(inputRef.current)inputRef.current.value=""}}><X size={16}/></button></div>}
 <label className="field-label" htmlFor="caption">キャプション</label><textarea id="caption" value={caption} maxLength={500} onChange={e=>setCaption(e.target.value)} placeholder="今の気持ちをシェアしよう…" rows={3}/>{error&&<p className="error-text">{error}</p>}
 <div className="composer-footer"><span>{caption.length}/500</span><button className="primary-button" disabled={busy||!file}>{busy?<LoaderCircle className="spin" size={17}/>:null}{kind==="story"?"ストーリーを公開":"投稿する"}</button></div></form>
}
