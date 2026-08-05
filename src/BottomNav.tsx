import "./BottomNav.css";

type BottomNavProps = { activePage: string; onPageChange: (page: string) => void };
type IconName = "home" | "calendar" | "teams" | "news" | "more";

function NavIcon({ name }: { name: IconName }) {
  const common = { width: 25, height: 25, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.9, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  if (name === "home") return <svg {...common}><path d="m3 10 9-7 9 7"/><path d="M5 9.5V21h14V9.5"/><path d="M9 21v-7h6v7"/></svg>;
  if (name === "calendar") return <svg {...common}><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4M16 3v4M3 10h18"/><path d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01"/></svg>;
  if (name === "teams") return <svg {...common}><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>;
  if (name === "news") return <svg {...common}><path d="M5 4h11a3 3 0 0 1 3 3v13H7a2 2 0 0 1-2-2V4Z"/><path d="M19 8h2v10a2 2 0 0 1-2 2M8 8h7M8 12h7M8 16h4"/></svg>;
  return <svg {...common}><path d="M4 7h16M4 12h16M4 17h16"/></svg>;
}

const items: Array<{page:string; label:string; icon:IconName}> = [
  {page:"start",label:"Start",icon:"home"},{page:"kalender",label:"Spiele",icon:"calendar"},{page:"teams",label:"Teams",icon:"teams"},{page:"news",label:"Ankündigungen",icon:"news"},{page:"mehr",label:"Mehr",icon:"more"}
];

export default function BottomNav({ activePage, onPageChange }: BottomNavProps) {
  return <nav className="bottom-nav" aria-label="Hauptnavigation">{items.map(item => <button key={item.page} type="button" className={activePage===item.page?"active":""} onClick={()=>onPageChange(item.page)} aria-current={activePage===item.page?"page":undefined}><span className="bottom-nav-icon"><NavIcon name={item.icon}/></span><span>{item.label}</span></button>)}</nav>;
}
