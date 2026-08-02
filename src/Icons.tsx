import type { SVGProps } from "react";
export type IconName = "ball"|"shield"|"users"|"target"|"rocket"|"sparkles"|"bell"|"calendar"|"clock"|"location"|"map"|"weather"|"send"|"news"|"settings"|"sync"|"table"|"person"|"document"|"star"|"video"|"gallery"|"sponsor"|"live";
const paths: Record<IconName, React.ReactNode> = {
ball:<><circle cx="12" cy="12" r="9"/><path d="m12 7 3 2-1 4h-4L9 9l3-2Z"/><path d="m5 9 4 .2M15 9.2 19 9M10 13l-2.5 4M14 13l2.5 4M8 17h8"/></>,
shield:<><path d="M12 3 20 6v5c0 5-3.5 8-8 10-4.5-2-8-5-8-10V6l8-3Z"/><path d="m9 12 2 2 4-5"/></>,
users:<><circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2"/><path d="M16 5a3 3 0 0 1 0 6M18 14a5 5 0 0 1 3 4v2"/></>,
target:<><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/></>,
rocket:<><path d="M14 4c3-1 5-1 6-1 0 1 0 3-1 6l-6 6-4-4 5-7Z"/><path d="m9 11-4 1-2 2 5 1M13 15l-1 4-2 2-1-5M5 19c1-2 2-3 4-4"/></>,
sparkles:<><path d="m12 3 1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3Z"/><path d="m19 15 .8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15Z"/></>,
bell:<><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/></>,
calendar:<><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4M16 3v4M3 10h18"/></>,
clock:<><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
location:<><path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></>,
map:<><path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3V6Z"/><path d="M9 3v15M15 6v15"/></>,
weather:<><path d="M8 19h9a4 4 0 1 0-.7-7.9A6 6 0 0 0 5 13a3 3 0 0 0 3 6Z"/><path d="M12 3v2M4.2 7.2l1.4 1.4M19.8 7.2l-1.4 1.4"/></>,
send:<><path d="m22 2-7 20-4-9-9-4 20-7Z"/><path d="M22 2 11 13"/></>,
news:<><path d="M5 4h12a2 2 0 0 1 2 2v14H7a2 2 0 0 1-2-2V4Z"/><path d="M19 8h2v10a2 2 0 0 1-2 2M8 8h7M8 12h7M8 16h4"/></>,
settings:<><circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1l2-1.5-2-3.5-2.5 1a7 7 0 0 0-1.7-1L14.4 3h-4.8L9.3 6a7 7 0 0 0-1.7 1L5.1 6 3 9.5 5.1 11a7 7 0 0 0 0 2L3 14.5 5.1 18l2.5-1a7 7 0 0 0 1.7 1l.3 3h4.8l.3-3a7 7 0 0 0 1.7-1l2.5 1 2.1-3.5-2.1-1.5c.1-.3.1-.7.1-1Z"/></>,
sync:<><path d="M20 7h-6V1"/><path d="M20 7a9 9 0 1 0 1 8"/></>,
table:<><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M9 4v16"/></>,
person:<><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></>,
document:<><path d="M6 3h9l4 4v14H6V3Z"/><path d="M14 3v5h5M9 13h6M9 17h6"/></>,
star:<><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3l-5.6 2.9 1.1-6.2L3 9.6l6.2-.9L12 3Z"/></>,
video:<><rect x="3" y="5" width="14" height="14" rx="3"/><path d="m17 10 4-2v8l-4-2"/></>,
gallery:<><rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="2"/><path d="m3 17 5-5 4 4 3-3 6 6"/></>,
sponsor:<><path d="M8 12h8M12 8v8"/><path d="M5 5h14v14H5z"/></>,
live:<><circle cx="12" cy="12" r="2"/><path d="M8.5 8.5a5 5 0 0 0 0 7M15.5 8.5a5 5 0 0 1 0 7M5.5 5.5a9 9 0 0 0 0 13M18.5 5.5a9 9 0 0 1 0 13"/></>
};
export function Icon({name,...props}:{name:IconName}&SVGProps<SVGSVGElement>){return <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{paths[name]}</svg>}
