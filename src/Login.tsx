import { useState, type FormEvent } from "react";
import { createUserWithEmailAndPassword, sendPasswordResetEmail, signInWithEmailAndPassword, updateProfile } from "firebase/auth";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { auth, db } from "./firebase";
import "./Login.css";

type Mode="login"|"register"|"reset";
function friendly(e:unknown){const c=(e as {code?:string})?.code||""; if(c.includes("email-already"))return"Diese E-Mail ist bereits registriert.";if(c.includes("weak-password"))return"Das Passwort muss mindestens 6 Zeichen haben.";if(c.includes("invalid-credential"))return"E-Mail oder Passwort ist falsch.";if(c.includes("invalid-email"))return"Bitte eine gültige E-Mail eingeben.";return"Das hat leider nicht funktioniert. Bitte nochmals versuchen."}
export default function Login({onPublicGames}:{onPublicGames?:()=>void}){
 const [mode,setMode]=useState<Mode>("login"),[name,setName]=useState(""),[email,setEmail]=useState(""),[password,setPassword]=useState(""),[invite,setInvite]=useState(""),[busy,setBusy]=useState(false),[msg,setMsg]=useState(""),[err,setErr]=useState("");
 async function submit(e:FormEvent){e.preventDefault();setBusy(true);setErr("");setMsg("");try{
  if(mode==="reset"){await sendPasswordResetEmail(auth,email.trim());setMsg("E-Mail zum Zurücksetzen wurde versendet.");return}
  if(mode==="login"){await signInWithEmailAndPassword(auth,email.trim(),password);return}
  if(name.trim().length<3)throw new Error("Bitte Vor- und Nachnamen eingeben.");
  const cred=await createUserWithEmailAndPassword(auth,email.trim(),password);await updateProfile(cred.user,{displayName:name.trim()});
  await setDoc(doc(db,"users",cred.user.uid),{name:name.trim(),email:email.trim().toLowerCase(),role:"pending",approved:false,active:true,teamIds:[],inviteCode:invite.trim().toUpperCase(),createdAt:serverTimestamp()});
 }catch(e){setErr(e instanceof Error&&!('code' in e)?e.message:friendly(e))}finally{setBusy(false)}}
 return <main className="auth-shell"><section className="auth-card"><img src="/tsu-ainet-logo.png" alt="TSU Ainet" className="auth-logo"/><span className="auth-kicker">Offizielle Vereins-App</span><h1>TSU Ainet</h1><p className="auth-sub">Fußball. Gemeinschaft. Ainet.</p>
 <div className="auth-tabs"><button className={mode==="login"?"active":""} onClick={()=>setMode("login")}>Anmelden</button><button className={mode==="register"?"active":""} onClick={()=>setMode("register")}>Registrieren</button></div>
 <form onSubmit={submit}>{mode==="register"&&<input placeholder="Vor- und Nachname" value={name} onChange={e=>setName(e.target.value)} required/>}<input type="email" placeholder="E-Mail" value={email} onChange={e=>setEmail(e.target.value)} required/>{mode!=="reset"&&<input type="password" placeholder="Passwort" value={password} onChange={e=>setPassword(e.target.value)} minLength={6} required/>}{mode==="register"&&<input placeholder="Einladungscode (optional)" value={invite} onChange={e=>setInvite(e.target.value)}/>} {err&&<div className="auth-error">{err}</div>}{msg&&<div className="auth-success">{msg}</div>}<button className="auth-primary" disabled={busy}>{busy?"Bitte warten …":mode==="login"?"Anmelden":mode==="register"?"Konto erstellen":"Link senden"}</button></form>
 <button className="auth-link" onClick={()=>setMode(mode==="reset"?"login":"reset")}>{mode==="reset"?"Zurück zur Anmeldung":"Passwort vergessen?"}</button>{onPublicGames&&<button type="button" className="auth-public" onClick={onPublicGames}>⚽ Spiele & Tabellen ohne Anmeldung</button>}<small className="auth-note">Neue Konten werden aus Sicherheitsgründen von der Sektionsleitung freigegeben.</small></section></main>
}
