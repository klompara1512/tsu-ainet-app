import { deleteToken, getMessaging, getToken, isSupported, onMessage } from "firebase/messaging";
import { deleteDoc, doc, serverTimestamp, setDoc } from "firebase/firestore";
import { auth, db, app } from "./firebase";
export const PUSH_TOPICS = ["all","km","challenge","u17","u12","u10","u8","news","events","results"] as const;
export type PushTopic = typeof PUSH_TOPICS[number];
function tokenId(token:string){return btoa(token).replace(/[^a-zA-Z0-9]/g,"").slice(-120)}
export async function enablePush(topics:PushTopic[]){
 if(!(await isSupported())) throw new Error("Push wird auf diesem Browser nicht unterstützt.");
 if(!auth.currentUser) throw new Error("Bitte zuerst anmelden.");
 const key=import.meta.env.VITE_FIREBASE_VAPID_KEY as string|undefined;
 if(!key) throw new Error("VAPID-Schlüssel fehlt. Bitte VITE_FIREBASE_VAPID_KEY in .env eintragen.");
 const registration=await navigator.serviceWorker.register("/firebase-messaging-sw.js");
 const permission=await Notification.requestPermission();
 if(permission!=="granted") throw new Error("Benachrichtigungen wurden nicht erlaubt.");
 const token=await getToken(getMessaging(app),{vapidKey:key,serviceWorkerRegistration:registration});
 if(!token) throw new Error("Kein Push-Token erhalten.");
 await setDoc(doc(db,"fcmTokens",`${auth.currentUser.uid}_${tokenId(token)}`),{uid:auth.currentUser.uid,token,topics,active:true,userAgent:navigator.userAgent,updatedAt:serverTimestamp()},{merge:true});
 return token;
}
export async function disablePush(){
 if(!(await isSupported())||!auth.currentUser)return;
 const messaging=getMessaging(app); const token=await getToken(messaging).catch(()=>"");
 if(token){await deleteDoc(doc(db,"fcmTokens",`${auth.currentUser.uid}_${tokenId(token)}`)).catch(()=>{}); await deleteToken(messaging).catch(()=>{});}
}
export async function listenForeground(cb:(title:string,body:string)=>void){if(await isSupported())return onMessage(getMessaging(app),p=>cb(p.notification?.title||"TSU Ainet",p.notification?.body||"Neue Nachricht")); return ()=>{};}
