process.env.TZ = "Europe/Vienna";
const admin = require("firebase-admin");
const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT fehlt.");
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) });
const db = admin.firestore();

function isoLocal(date) {
  const y=date.getFullYear(), m=String(date.getMonth()+1).padStart(2,"0"), d=String(date.getDate()).padStart(2,"0");
  return `${y}-${m}-${d}`;
}
function weekRange() {
  const now=new Date(); const monday=new Date(now.getFullYear(),now.getMonth(),now.getDate(),12);
  monday.setDate(monday.getDate()-((monday.getDay()+6)%7)); const sunday=new Date(monday); sunday.setDate(monday.getDate()+6);
  return { start:isoLocal(monday), end:isoLocal(sunday), key:isoLocal(monday) };
}
function norm(v){return String(v||"").toLowerCase().replace(/[^a-z0-9]+/g,"");}
function teamAlias(v){const t=norm(v);if(["km","kampfmannschaft","kampfmannschaft1"].includes(t))return"km";if(["challenge","reserve","res","kampfmannschaftreserve"].includes(t))return"challenge";if(["u17","u017"].includes(t))return"u17";if(["u12","u012"].includes(t))return"u12";if(["u10","u010"].includes(t))return"u10";if(["u8","u08","u008"].includes(t))return"u8";return t;}
function youthKey(team){const id=teamAlias(team.id),name=teamAlias(team.name);for(const key of ["u17","u12","u10","u8"]){if(id===key||name===key)return key;}return"";}

async function main(){
  const week=weekRange();
  const [teamsSnap, bookingsSnap, trainersSnap, tokensSnap] = await Promise.all([
    db.collection("teams").get(),
    db.collection("trainingBookings").where("date",">=",week.start).where("date","<=",week.end).get(),
    db.collection("users").where("role","==","trainer").get(),
    db.collection("fcmTokens").where("active","==",true).get(),
  ]);
  const teams=new Map(teamsSnap.docs.map(d=>[d.id,{id:d.id,name:String(d.data().name||d.id)}]));
  const planned=new Set(bookingsSnap.docs.filter(d=>String(d.data().kind||"training")!=="block").map(d=>String(d.data().teamId||"")));
  const tokensByUid=new Map();
  for(const d of tokensSnap.docs){const x=d.data();if(!x.uid||!x.token)continue;const a=tokensByUid.get(x.uid)||[];a.push({token:x.token,ref:d.ref});tokensByUid.set(x.uid,a);}
  let trainersReminded=0, delivered=0;
  for(const trainerDoc of trainersSnap.docs){
    const profile=trainerDoc.data();
    if(profile.active===false || profile.approved===false) continue;
    const assigned=new Set((Array.isArray(profile.teamIds)?profile.teamIds:[]).map(teamAlias));
    const relevant=[...teams.values()].filter(team=>assigned.has(teamAlias(team.id))||assigned.has(teamAlias(team.name))).filter(team=>youthKey(team));
    const missing=relevant.filter(team=>!planned.has(team.id));
    if(!missing.length) continue;
    const logRef=db.doc(`trainingReminderLog/${week.key}_${trainerDoc.id}`);
    if((await logRef.get()).exists && process.env.FORCE_REMINDER!=="true") continue;
    const entries=tokensByUid.get(trainerDoc.id)||[];
    if(!entries.length){await logRef.set({week:week.key,uid:trainerDoc.id,missingTeams:missing.map(t=>t.id),status:"no-token",createdAt:admin.firestore.FieldValue.serverTimestamp()});continue;}
    const body=`Bitte Training für ${missing.map(t=>t.name).join(", ")} für diese Woche eintragen.`;
    let success=0;
    for(let i=0;i<entries.length;i+=500){
      const chunk=entries.slice(i,i+500);
      const res=await admin.messaging().sendEachForMulticast({
        tokens:chunk.map(x=>x.token), notification:{title:"Training diese Woche eintragen",body},
        data:{link:"https://tsu-ainet-fussball.web.app/",type:"training-week-reminder"},
        webpush:{headers:{Urgency:"normal"},notification:{icon:"/icon-192.png",badge:"/favicon-64.png",tag:`training-${week.key}`,renotify:false},fcmOptions:{link:"https://tsu-ainet-fussball.web.app/"}}
      });
      success+=res.successCount;
    }
    await logRef.set({week:week.key,uid:trainerDoc.id,missingTeams:missing.map(t=>t.id),status:"sent",success,createdAt:admin.firestore.FieldValue.serverTimestamp()});
    trainersReminded++; delivered+=success;
  }
  console.log(`Trainings-Erinnerung ${week.start}–${week.end}: ${trainersReminded} Trainer erinnert, ${delivered} Push zugestellt.`);
}
main().catch(e=>{console.error(e);process.exitCode=1;});
