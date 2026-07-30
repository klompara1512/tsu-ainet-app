export type AppRole = "admin" | "section" | "trainer" | "board" | "player" | "member" | "fan" | "pending";
export type Permission = "manageUsers"|"managePeople"|"manageMatches"|"manageStandings"|"manageEvents"|"manageNews"|"manageDocuments"|"manageSponsors"|"manageTeams"|"manageTasks";
export type UserProfile = { name:string; email:string; active:boolean; approved:boolean; role:AppRole; teamIds:string[] };
const ROLE_LABELS:Record<AppRole,string>={admin:"Administrator",section:"Sektionsleitung",trainer:"Trainer",board:"Vorstand",player:"Spieler",member:"Mitglied",fan:"Fan",pending:"Wartet auf Freigabe"};
const PERMISSIONS:Record<AppRole,readonly Permission[]>={
 admin:["manageUsers","managePeople","manageMatches","manageStandings","manageEvents","manageNews","manageDocuments","manageSponsors","manageTeams","manageTasks"],
 section:["manageUsers","managePeople","manageMatches","manageStandings","manageEvents","manageNews","manageDocuments","manageSponsors","manageTeams","manageTasks"],
 trainer:["managePeople","manageMatches","manageStandings","manageEvents","manageTeams","manageTasks"],
 board:["manageEvents","manageNews","manageDocuments","manageSponsors","manageTasks"],
 player:[],member:[],fan:[],pending:[]};
export function normalizeRole(v:unknown):AppRole{return typeof v==="string"&&v in ROLE_LABELS?v as AppRole:"pending"}
export function roleLabel(r:AppRole){return ROLE_LABELS[r]}
export function hasPermission(r:AppRole,p:Permission){return PERMISSIONS[r].includes(p)}
