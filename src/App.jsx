import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { createAuth0Client } from "@auth0/auth0-spa-js";
import * as db from "./lib/db.js";
import { supabase, hasSupabase } from "./lib/supabase.js";

// ════════════════════════════════════════
// AUTH0
// ════════════════════════════════════════
const AUTH0_DOMAIN = import.meta.env.VITE_AUTH0_DOMAIN || "";
const AUTH0_CLIENT_ID = import.meta.env.VITE_AUTH0_CLIENT_ID || "";
let _auth0 = null;
async function getAuth0() {
  if (_auth0) return _auth0;
  if (!AUTH0_DOMAIN || !AUTH0_CLIENT_ID) return null;
  _auth0 = await createAuth0Client({
    domain: AUTH0_DOMAIN,
    clientId: AUTH0_CLIENT_ID,
    authorizationParams: { redirect_uri: window.location.origin },
    cacheLocation: "localstorage",
  });
  return _auth0;
}

// ════════════════════════════════════════
// DATA
// ════════════════════════════════════════
const CATS = {
  Party:{bg:"#E6F4EA",dbg:"#1a3424",fg:"#1B7A3D",dfg:"#6EE89E",ac:"#34A853",em:"🎉"},
  Hackathon:{bg:"#DEEEF8",dbg:"#1a2838",fg:"#1A5FA0",dfg:"#7CC0F5",ac:"#4285F4",em:"💻"},
  Meetup:{bg:"#FEF5D4",dbg:"#302816",fg:"#A66D00",dfg:"#F0C44E",ac:"#F9AB00",em:"🤝"},
  Workshop:{bg:"#F0E5F6",dbg:"#281e34",fg:"#7B1FA2",dfg:"#D08AF5",ac:"#AB47BC",em:"🔧"},
  Panel:{bg:"#DDF2EF",dbg:"#182e2a",fg:"#00695C",dfg:"#5DD8C4",ac:"#26A69A",em:"🎙️"},
  "Demo Day":{bg:"#FDE8E0",dbg:"#302018",fg:"#BF360C",dfg:"#F5956A",ac:"#FF7043",em:"🚀"},
  Dinner:{bg:"#FCE4EC",dbg:"#301a28",fg:"#AD1457",dfg:"#F57AA8",ac:"#EC407A",em:"🍽️"},
  Other:{bg:"#ECEFF1",dbg:"#222428",fg:"#455A64",dfg:"#A8B8C4",ac:"#78909C",em:"✨"},
};

const CONFS = [
  {id:"acc26",short:"Accelerate",loc:"Miami, FL",dates:"May 3–9, 2026",emoji:"🌴"},
  {id:"isl26",short:"IslandDAO",loc:"Thailand",dates:"TBA 2026",emoji:"🏝️"},
  {id:"bp26",short:"Breakpoint",loc:"TBA",dates:"TBA 2026",emoji:"⚡"},
];

// ── Check-in codes (rotate every 30 min) ──
function getCheckInCode(eventId) {
  const slot = Math.floor(Date.now() / 1800000);
  const seed = eventId + "-" + slot;
  let hash = 0;
  for (let i = 0; i < seed.length; i++) { hash = ((hash << 5) - hash) + seed.charCodeAt(i); hash |= 0; }
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "", h = Math.abs(hash);
  for (let i = 0; i < 6; i++) { code += chars[h % chars.length]; h = Math.floor(h / chars.length) + (i + 1) * 7; }
  return code;
}
function getTimeUntilRotation() {
  const ms = 1800000 - (Date.now() % 1800000);
  return `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}`;
}

// ── Quests (XP gated behind check-ins, except first RSVP) ──
const QUESTS = [
  {id:"q0",title:"Ready Up",desc:"RSVP to your first event",icon:"🎫",xp:50,check:(ci,evs,cc,rv)=>rv && rv.length>=1},
  {id:"q1",title:"First Steps",desc:"Check in to your first event",icon:"🌱",xp:50,check:(ci)=>ci.length>=1},
  {id:"q2",title:"Social Butterfly",desc:"Check in to 5 events",icon:"🦋",xp:150,check:(ci)=>ci.length>=5},
  {id:"q3",title:"Night Owl",desc:"Check in to 3 events after 6 PM",icon:"🦉",xp:200,check:(ci,evs)=>evs.filter(e=>ci.includes(e.id)&&e.time&&e.time.includes("PM")&&parseInt(e.time)>=6).length>=3},
  {id:"q4",title:"Builder Brain",desc:"Check in to a Workshop + Hackathon",icon:"🧠",xp:250,check:(ci,evs)=>{const c=evs.filter(e=>ci.includes(e.id)).map(e=>e.cat);return c.includes("Workshop")&&c.includes("Hackathon");}},
  {id:"q5",title:"Day One",desc:"Check in on the first day of events",icon:"⚡",xp:100,check:(ci,evs)=>{const sorted=[...evs].sort((a,b)=>a.date.localeCompare(b.date));return sorted.length>0&&evs.filter(e=>ci.includes(e.id)&&e.date===sorted[0].date).length>=1;}},
  {id:"q6",title:"Full Send",desc:"Check in on 5+ different days",icon:"🔥",xp:300,check:(ci,evs)=>new Set(evs.filter(e=>ci.includes(e.id)).map(e=>e.date)).size>=5},
  {id:"q7",title:"Closer",desc:"Check in to the last event of the week",icon:"🌅",xp:100,check:(ci,evs)=>{const sorted=[...evs].sort((a,b)=>b.date.localeCompare(a.date));return sorted.length>0&&ci.includes(sorted[0].id);}},
  {id:"q8",title:"Category King",desc:"Check in to 4 different types",icon:"👑",xp:350,check:(ci,evs)=>new Set(evs.filter(e=>ci.includes(e.id)).map(e=>e.cat)).size>=4},
  {id:"q9",title:"Whale",desc:"Check in to 8+ events",icon:"🐋",xp:500,check:(ci)=>ci.length>=8},
  {id:"q10",title:"Legend",desc:"Complete 8 other quests",icon:"💎",xp:1000,check:(ci,evs,cc)=>cc>=8},
];
const LEVELS=[{n:"Explorer",xp:0},{n:"Attendee",xp:100},{n:"Regular",xp:300},{n:"Builder",xp:600},{n:"Degen",xp:1000},{n:"OG",xp:1500},{n:"Legend",xp:2500},{n:"Solana God",xp:4000}];
const getLevel=(xp)=>{let l=LEVELS[0];for(const lv of LEVELS)if(xp>=lv.xp)l=lv;return l;};
const getNext=(xp)=>{for(const lv of LEVELS)if(xp<lv.xp)return lv;return null;};

const NOTABLE_TAGS=["All","Founders","DeFi","Dev","Infra","NFT","Community","Mobile"];

// ════════════════════════════════════════
// STORAGE (Supabase with localStorage fallback)
// ════════════════════════════════════════
const loadState = db.loadLocal;
const saveState = db.saveLocal;

// ════════════════════════════════════════
// CLIPBOARD
// ════════════════════════════════════════
async function copyText(t) {
  try { if (navigator.clipboard) { await navigator.clipboard.writeText(t); return true; } } catch(e) {}
  try { const a = document.createElement("textarea"); a.value = t; a.style.cssText = "position:fixed;left:-9999px;opacity:0"; document.body.appendChild(a); a.focus(); a.select(); const ok = document.execCommand("copy"); document.body.removeChild(a); return ok; } catch(e) { return false; }
}

// ════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════
const fd = (d) => d ? new Date(d+"T12:00:00").toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric"}) : "";
const dl = (d) => d ? new Date(d+"T12:00:00").toLocaleDateString("en-US",{weekday:"long",month:"short",day:"numeric"}) : "";
const gid = () => Date.now().toString(36) + Math.random().toString(36).slice(2,6);
const ACOLORS = ["#9945FF","#14F195","#F9AB00","#4285F4","#EC407A","#FF7043","#26A69A","#AB47BC"];
const timeAgo = (ts) => { if (!ts) return ""; const d = new Date(ts); const s = Math.floor((Date.now() - d.getTime()) / 1000); if (s < 60) return "just now"; if (s < 3600) return `${Math.floor(s/60)}m ago`; if (s < 86400) return `${Math.floor(s/3600)}h ago`; if (s < 604800) return `${Math.floor(s/86400)}d ago`; return d.toLocaleDateString("en-US",{month:"short",day:"numeric"}); };
const uc = (h) => { let n=0; for(let i=0;i<(h||"").length;i++) n+=h.charCodeAt(i); return ACOLORS[n%ACOLORS.length]; };

const Avatar = ({name,s=32,bg,pfp}) => (
  <div style={{width:s+4,height:s+4,borderRadius:"50%",background:bg?"transparent":"linear-gradient(135deg,#9945FF44,#14F19544)",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,padding:2}}>
    {pfp ? (
      <img src={pfp} alt={name} style={{width:s,height:s,borderRadius:"50%",objectFit:"cover",boxShadow:"0 2px 8px rgba(0,0,0,.1)"}}/>
    ) : (
      <div style={{width:s,height:s,borderRadius:"50%",background:bg||"linear-gradient(135deg,#9945FF,#14F195)",display:"flex",alignItems:"center",justifyContent:"center",color:"white",fontSize:s*.36,fontWeight:800,fontFamily:"var(--fd)",boxShadow:"0 2px 8px rgba(0,0,0,.1)"}}>
        {(name||"?")[0].toUpperCase()}
      </div>
    )}
  </div>
);

// Deterministic barcode (no Math.random on render)
const BARCODE_WIDTHS = [1,1.5,2.5,1,3,1.5,2,1,1,2,1.5,1,3,1,2.5,1.5,1,1.5,2.5,1,3,1.5,2,1,1,2,1.5,1,3,1,2.5,1.5,1,1.5,2.5,1,3,1.5,2,1,1,2,1.5,1,3,1];
const Barcode = () => (
  <svg width="184" height="26" viewBox="0 0 184 26">
    {BARCODE_WIDTHS.map((w,i) => (
      <rect key={i} x={i*4} y="0" width={w} height="26" fill="currentColor" rx=".3" opacity={.5 + (i%3)*.15}/>
    ))}
  </svg>
);

const SkeletonCard = () => (
  <div style={{borderRadius:18,padding:"20px 22px",background:"var(--surface)",border:"1px solid var(--border)",boxShadow:"var(--sh-sm)"}}>
    <div style={{display:"flex",gap:8,marginBottom:12}}>
      <div className="skel" style={{width:70,height:22,borderRadius:100}}/>
      <div className="skel" style={{width:50,height:22,borderRadius:100}}/>
    </div>
    <div className="skel" style={{width:"80%",height:20,borderRadius:8,marginBottom:8}}/>
    <div className="skel" style={{width:"50%",height:14,borderRadius:6,marginBottom:12}}/>
    <div className="skel" style={{width:"100%",height:12,borderRadius:6,marginBottom:6}}/>
    <div className="skel" style={{width:"60%",height:12,borderRadius:6}}/>
  </div>
);

const SolIc = () => (
  <svg width="18" height="14" viewBox="0 0 508 398" fill="none"><path d="M81.3 318.2c3-3 7-4.7 11.3-4.7h401.5c7.1 0 10.7 8.6 5.7 13.6l-79.9 79.2c-3 3-7 4.7-11.3 4.7H7.1c-7.1 0-10.7-8.6-5.7-13.6l79.9-79.2z" fill="url(#sa)"/><path d="M81.3 4.7c3.1-3 7.1-4.7 11.3-4.7h401.5c7.1 0 10.7 8.6 5.7 13.6l-79.9 79.2c-3 3-7 4.7-11.3 4.7H7.1c-7.1 0-10.7-8.6-5.7-13.6L81.3 4.7z" fill="url(#sb)"/><path d="M426.7 160.4c-3-3-7-4.7-11.3-4.7H13.9c-7.1 0-10.7 8.6-5.7 13.6l79.9 79.2c3 3 7 4.7 11.3 4.7h401.5c7.1 0 10.7-8.6 5.7-13.6l-79.9-79.2z" fill="url(#sc)"/><defs><linearGradient id="sa" x1="462" y1="430" x2="109" y2="-40" gradientUnits="userSpaceOnUse"><stop stopColor="#00FFA3"/><stop offset="1" stopColor="#DC1FFF"/></linearGradient><linearGradient id="sb" x1="462" y1="430" x2="109" y2="-40" gradientUnits="userSpaceOnUse"><stop stopColor="#00FFA3"/><stop offset="1" stopColor="#DC1FFF"/></linearGradient><linearGradient id="sc" x1="462" y1="430" x2="109" y2="-40" gradientUnits="userSpaceOnUse"><stop stopColor="#00FFA3"/><stop offset="1" stopColor="#DC1FFF"/></linearGradient></defs></svg>
);
const XI = ({s=14}) => (
  <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
);

// ════════════════════════════════════════
// TOASTS
// ════════════════════════════════════════
let _toastId = 0;
function useToast() {
  const [toasts, setToasts] = useState([]);
  const push = useCallback((msg, type = "success") => {
    const id = ++_toastId;
    setToasts(t => [...t, { id, msg, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 2800);
  }, []);
  return { toasts, push };
}

function Toasts({ toasts }) {
  return (
    <div style={{position:"fixed",top:14,left:"50%",transform:"translateX(-50%)",zIndex:9999,display:"flex",flexDirection:"column",gap:6,pointerEvents:"none",width:"90%",maxWidth:380}}>
      {toasts.map(t => (
        <div key={t.id} style={{
          padding:"13px 18px",borderRadius:16,fontWeight:700,fontSize:13.5,fontFamily:"var(--f)",
          background: t.type==="error"?"#FDE8E0" : t.type==="xp"?"linear-gradient(135deg,rgba(153,69,255,.08),rgba(20,241,149,.06))" : t.type==="info"?"#DEEEF8" : "#E6F4EA",
          color: t.type==="error"?"#B91C1C" : t.type==="xp"?"#7B3FCC" : t.type==="info"?"#0D4F8B" : "#166534",
          boxShadow:"0 8px 32px rgba(0,0,0,.12),0 2px 6px rgba(0,0,0,.06)",animation:"toastIn .35s cubic-bezier(.16,1,.3,1)",
          border: t.type==="xp"?"1.5px solid rgba(153,69,255,.15)":t.type==="error"?"1.5px solid rgba(191,54,12,.12)":t.type==="info"?"1.5px solid rgba(26,95,160,.1)":"1.5px solid rgba(27,122,61,.1)",
          backdropFilter:"blur(12px)",display:"flex",alignItems:"center",gap:8
        }}>
          <span style={{fontSize:16}}>{t.type==="error"?"✕" : t.type==="xp"?"⚡" : t.type==="info"?"ℹ️" : "✓"}</span>{t.msg}
        </div>
      ))}
    </div>
  );
}

// ════════════════════════════════════════
// PULSE TICKER (self-contained, no parent re-render)
// ════════════════════════════════════════
function PulseTicker({ activity, events }) {
  const [idx, setIdx] = useState(0);
  useEffect(() => { if (activity.length > 0) { const i = setInterval(() => setIdx(p => p + 1), 4000); return () => clearInterval(i); } }, [activity.length]);
  if (activity.length === 0) return (
    <div className="pulse-ticker">
      <div className="pulse-dot"/><span className="pulse-live">LIVE</span>
      <div style={{flex:1,fontSize:12,color:"rgba(255,255,255,.5)"}}>Waiting for activity...</div>
    </div>
  );
  const ci = idx % activity.length;
  return (
    <div className="pulse-ticker">
      <div className="pulse-dot"/><span className="pulse-live">LIVE</span>
      <div style={{flex:1,overflow:"hidden"}}>
        {activity.map((p,i) => (
          <div key={i} style={{display:i===ci?"flex":"none",animation:i===ci?"fadeSlide .4s ease":"none",alignItems:"center",gap:3,fontSize:12,whiteSpace:"nowrap"}}>
            <strong>{p.u}</strong>&nbsp;{p.a}&nbsp;<em style={{color:"#14F195"}}>{p.e ? events.find(e=>e.id===p.e)?.title : p.q}</em>&nbsp;<span className="pulse-time">{timeAgo(p.ts)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ════════════════════════════════════════
// HOST CODE (self-contained timer)
// ════════════════════════════════════════
function HostCodeDisplay({ ev, onClose, onCopy }) {
  const code = getCheckInCode(ev.id);
  const [timer, setTimer] = useState(getTimeUntilRotation());
  useEffect(() => { const i = setInterval(() => setTimer(getTimeUntilRotation()), 1000); return () => clearInterval(i); }, []);
  const cat = CATS[ev.cat] || CATS.Other;

  return (<>
    <div className="overlay" onClick={onClose}/>
    <div className="modal" style={{textAlign:"center"}}>
      <div className="mh"><button className="ib" onClick={onClose}>←</button><span/></div>
      <div className="host-code-card">
        <p style={{fontSize:11,fontWeight:700,color:"var(--muted)",textTransform:"uppercase",letterSpacing:"1px",marginBottom:4}}>Check-in Code</p>
        <p style={{fontSize:10,color:"var(--muted)",marginBottom:12}}>Display this at your venue. Attendees enter it to verify attendance.</p>
        <div className="host-code">
          {code.split("").map((c,i) => (
            <span key={i} className="host-code-char" style={{animationDelay:`${i*.06}s`}}>{c}</span>
          ))}
        </div>
        <p style={{fontSize:11,color:"var(--muted)",marginTop:12,fontFamily:"var(--fm)"}}>Rotates in <strong style={{color:"var(--accent)"}}>{timer}</strong></p>
        <div className="host-code-event"><span>{cat.em}</span> {ev.title}</div>
      </div>
      <button className="btn-sm" style={{marginTop:12}} onClick={() => onCopy(code)}>Copy code</button>
    </div>
  </>);
}

// ════════════════════════════════════════
// MAIN APP
// ════════════════════════════════════════
export default function App() {
  const [ready, setReady] = useState(false);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [view, setView] = useState("home");
  const [events, setEvents] = useState([]);
  const [user, setUser] = useState(null);
  const [bmarks, setBmarks] = useState([]);
  const [rsvps, setRsvps] = useState([]);
  const [checkins, setCheckins] = useState([]);
  const [friends, setFriends] = useState([]);
  const [incog, setIncog] = useState([]);
  const [privacy, setPrivacy] = useState({ profilePublic: false });
  const [conf, setConf] = useState("acc26");
  const [catF, setCatF] = useState("All");
  const [dateF, setDateF] = useState("All");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("date");
  const [layout, setLayout] = useState("grid");
  const [calMonth, setCalMonth] = useState(() => new Date(2026, 4, 1)); // May 2026
  const [sel, setSel] = useState(null);
  const [showAuth, setShowAuth] = useState(false);
  const [showSubmit, setShowSubmit] = useState(false);
  const [editing, setEditing] = useState(null);
  const [showSort, setShowSort] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const sortRef = useRef(null);
  useEffect(() => { if (!showSort) return; const h = (e) => { if (sortRef.current && !sortRef.current.contains(e.target)) setShowSort(false); }; document.addEventListener("mousedown", h); return () => document.removeEventListener("mousedown", h); }, [showSort]);
  const [af, setAf] = useState({ email: "", name: "" });
  const [profTab, setProfTab] = useState("quests");
  const [friendView, setFriendView] = useState(null);
  const [addFQ, setAddFQ] = useState("");
  const [questPop, setQuestPop] = useState(null);
  const [showCheckin, setShowCheckin] = useState(null);
  const [showHostCode, setShowHostCode] = useState(null);
  const [checkinInput, setCheckinInput] = useState("");
  const [pendingRequests, setPendingRequests] = useState([]); // event IDs user has requested to join
  const [approvedUsers, setApprovedUsers] = useState({}); // {eventId: [handles]} for host's approved list
  const [friendRequests, setFriendRequests] = useState([]); // incoming friend requests from other users
  const [vips, setVips] = useState([]);
  const [friendsTab, setFriendsTab] = useState("people");
  const [notableFilter, setNotableFilter] = useState("All");
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [onboardStep, setOnboardStep] = useState(0);
  const [dark, setDark] = useState(false);
  const { toasts, push: toast } = useToast();

  // ── Load data (Supabase → localStorage fallback) ──
  // Helper: load user-specific data from Supabase profile JSON
  const loadUserData = useCallback(async (uid) => {
    if (!uid || !hasSupabase()) return;
    try {
      const supaUrl = import.meta.env.VITE_SUPABASE_URL;
      const supaKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
      let token = supaKey;
      try {
        const storageKey = `sb-${new URL(supaUrl).hostname.split('.')[0]}-auth-token`;
        const stored = JSON.parse(localStorage.getItem(storageKey) || "{}");
        if (stored?.access_token) token = stored.access_token;
      } catch(e) {}

      const res = await fetch(`${supaUrl}/rest/v1/profiles?id=eq.${uid}&select=friends_data,vips_data,bmarks_data,rsvps_data,checkins_data,incog_data,pending_requests_data,approved_users_data,friend_requests_data`, {
        headers: { "apikey": supaKey, "Authorization": `Bearer ${token}` },
      });
      if (!res.ok) return;
      const rows = await res.json();
      const data = rows?.[0];
      if (!data) return;
      if (data.friends_data?.length) setFriends(data.friends_data);
      if (data.vips_data?.length) setVips(data.vips_data);
      if (data.bmarks_data?.length) setBmarks(data.bmarks_data);
      if (data.rsvps_data?.length) setRsvps(data.rsvps_data);
      if (data.checkins_data?.length) setCheckins(data.checkins_data);
      if (data.incog_data?.length) setIncog(data.incog_data);
      // Always set pending requests from Supabase (host may have approved/denied)
      setPendingRequests(data.pending_requests_data || []);
      setApprovedUsers(data.approved_users_data || {});
      setFriendRequests(data.friend_requests_data || []);
    } catch(e) {}
  }, []);

  useEffect(() => {
    // Step 1: Load UI prefs + public data immediately → setReady
    setDark(loadState("dark", false));
    if (!loadState("onboarded", false)) setShowOnboarding(true);

    if (hasSupabase()) {
      // Show cached user instantly while Supabase loads
      const cachedUser = loadState("user", null);
      if (cachedUser) setUser(cachedUser);
      // Load public events from Supabase
      db.fetchEvents(conf).then(evs => {
        if (evs && evs.length > 0) setEvents(evs);
        else setEvents(loadState("events", null) || []);
        refreshAttendeeCounts();
        setEventsLoading(false);
      }).catch(() => { setEvents(loadState("events", null) || []); setEventsLoading(false); });
    } else {
      // No Supabase: load everything from localStorage
      setEvents(loadState("events", null) || []);
      setEventsLoading(false);
      setUser(loadState("user", null));
      setBmarks(loadState("bmarks", []));
      setRsvps(loadState("rsvps", []));
      setCheckins(loadState("checkins", []));
      setFriends(loadState("friends", []));
      setIncog(loadState("incog", []));
      setPrivacy(loadState("privacy", { profilePublic: false }));
      setVips(loadState("vips", []));
    }
    setReady(true);

    // Step 2: Set up auth listener BEFORE checking session
    // This catches both: existing sessions on refresh AND new OAuth redirects
    if (hasSupabase()) {
      const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
        if ((event === "SIGNED_IN" || event === "INITIAL_SESSION" || event === "TOKEN_REFRESHED") && session?.user) {
          const u = session.user;
          const meta = u.user_metadata || {};
          // Always set user from session metadata (works even if DB is down)
          const fallbackUser = {
            id: u.id, supaId: u.id,
            name: meta.name || meta.full_name || meta.user_name || "Anon",
            handle: meta.user_name ? `@${meta.user_name}` : u.email || "",
            pfp: meta.avatar_url || meta.picture || "",
            method: u.app_metadata?.provider === "x" ? "x" : "email",
          };
          setUser(fallbackUser);
          saveState("user", fallbackUser);
          // Ensure profile row exists + load user data (raw fetch, avoids hanging client)
          try {
            const supaUrl = import.meta.env.VITE_SUPABASE_URL;
            const supaKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
            let token = supaKey;
            try {
              const storageKey = `sb-${new URL(supaUrl).hostname.split('.')[0]}-auth-token`;
              const stored = JSON.parse(localStorage.getItem(storageKey) || "{}");
              if (stored?.access_token) token = stored.access_token;
            } catch(e) {}
            // Upsert profile via REST
            await fetch(`${supaUrl}/rest/v1/profiles`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "apikey": supaKey,
                "Authorization": `Bearer ${token}`,
                "Prefer": "resolution=merge-duplicates,return=minimal",
              },
              body: JSON.stringify({
                id: u.id, name: fallbackUser.name, handle: fallbackUser.handle,
                pfp: fallbackUser.pfp, method: fallbackUser.method,
              }),
            });
            // Resolve pending friends — update anyone who added this user before they signed up
            fetch(`${supaUrl}/rest/v1/rpc/resolve_pending_friends_json`, {
              method:"POST",
              headers:{"Content-Type":"application/json","apikey":supaKey,"Authorization":`Bearer ${token}`},
              body:JSON.stringify({new_handle:fallbackUser.handle,new_name:fallbackUser.name,new_pfp:fallbackUser.pfp||""})
            }).catch(()=>{});
          } catch(e) {}
          try { await loadUserData(u.id); } catch(e) {}
          initialLoadDone.current = true;
          // Clean up OAuth hash from URL
          if (window.location.hash.includes("access_token")) {
            window.history.replaceState(null, "", window.location.pathname);
          }
        } else if (event === "INITIAL_SESSION" && !session) {
          // No session — user is not signed in, that's fine
        } else if (event === "SIGNED_OUT") {
          setUser(null); saveState("user", null);
          initialLoadDone.current = false; // prevent sync from writing empty data
        }
      });
      return () => subscription.unsubscribe();
    } else {
      // Auth0 callback (only when no Supabase)
      (async () => {
        try {
          const auth0 = await getAuth0();
          if (auth0) {
            const query = window.location.search;
            if (query.includes("code=") && query.includes("state=")) {
              await auth0.handleRedirectCallback();
              window.history.replaceState(null, "", window.location.pathname);
              const auth0User = await auth0.getUser();
              if (auth0User) {
                const xUser = {
                  name: auth0User.name || auth0User.nickname || "Anon",
                  handle: auth0User.nickname ? `@${auth0User.nickname}` : auth0User.email || "",
                  pfp: auth0User.picture || "",
                  method: "x",
                };
                setUser(xUser);
                saveState("user", xUser);
                setTimeout(() => toast("Signed in with X!"), 100);
              }
            }
          }
        } catch(e) {}
      })();
    }
    // Deep link: auto-add friend from shared profile URL (?add=@handle)
    const addParam = new URLSearchParams(window.location.search).get("add");
    if (addParam && user) {
      setTimeout(() => { addFriend(addParam); window.history.replaceState(null, "", window.location.pathname); toast(`Added ${addParam}!`); }, 500);
    } else if (addParam && !user) {
      saveState("pending_add", addParam);
      setTimeout(() => { toast("Sign in to add this friend", "info"); setShowAuth(true); }, 500);
    }
    const pendingAdd = loadState("pending_add", null);
    if (pendingAdd && user) {
      setTimeout(() => { addFriend(pendingAdd); saveState("pending_add", null); toast(`Added ${pendingAdd}!`); }, 500);
    }

    // Deep link: open event from URL hash
    const hash = window.location.hash;
    if (hash.startsWith("#event=")) {
      const eid = hash.slice(7);
      const allEvs = loadState("events", null) || [];
      const found = allEvs.find(e => e.id === eid);
      if (found) setTimeout(() => setSel(found), 100);
    }
  }, []);

  // ── Load user data from Supabase when user is set (independent of auth callback) ──
  const initialLoadDone = useRef(false);
  useEffect(() => {
    if (!user?.supaId || !hasSupabase()) return;
    loadUserData(user.supaId).then(() => { initialLoadDone.current = true; });
    refreshAttendeeCounts();
  }, [user?.supaId]);

  // ── Save to localStorage on changes ──
  useEffect(() => {
    if (sel) { window.history.replaceState(null, "", `#event=${sel.id}`); }
    else if (window.location.hash.startsWith("#event=")) { window.history.replaceState(null, "", window.location.pathname); }
  }, [sel]);
  useEffect(() => { if (ready) saveState("events", events); }, [events, ready]);
  useEffect(() => { if (ready) saveState("user", user); }, [user, ready]);
  useEffect(() => { if (ready) saveState("bmarks", bmarks); }, [bmarks, ready]);
  useEffect(() => { if (ready) saveState("rsvps", rsvps); }, [rsvps, ready]);
  useEffect(() => { if (ready) saveState("checkins", checkins); }, [checkins, ready]);
  useEffect(() => { if (ready) saveState("friends", friends); }, [friends, ready]);
  useEffect(() => { if (ready) saveState("incog", incog); }, [incog, ready]);
  useEffect(() => { if (ready) saveState("pendingRequests", pendingRequests); }, [pendingRequests, ready]);
  useEffect(() => { if (ready) saveState("approvedUsers", approvedUsers); }, [approvedUsers, ready]);
  useEffect(() => { if (ready) saveState("vips", vips); }, [vips, ready]);
  useEffect(() => { if (ready) saveState("privacy", privacy); }, [privacy, ready]);
  useEffect(() => { if (ready) { saveState("dark", dark); const bg = dark ? "#0c0c14" : "#F5F3EE"; document.documentElement.style.background = bg; document.body.style.background = bg; } }, [dark, ready]);

  // ── Sync specific data to Supabase (called on explicit user actions only) ──
  const syncToSupabase = useCallback((fields) => {
    if (!hasSupabase() || !user?.supaId) return;
    const supaUrl = import.meta.env.VITE_SUPABASE_URL;
    const supaKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
    let token = supaKey;
    try { const sk = `sb-${new URL(supaUrl).hostname.split('.')[0]}-auth-token`; const st = JSON.parse(localStorage.getItem(sk)||"{}"); if(st?.access_token) token=st.access_token; } catch(e){}
    fetch(`${supaUrl}/rest/v1/profiles?id=eq.${user.supaId}`, {
      method: "PATCH",
      headers: {"Content-Type":"application/json","apikey":supaKey,"Authorization":`Bearer ${token}`,"Prefer":"return=minimal"},
      body: JSON.stringify(fields),
    }).catch(()=>{});
  }, [user]);

  // ── Quest logic ──
  const completedQuests = useMemo(() => {
    const done = []; let cc = 0;
    for (const q of QUESTS) {
      if (q.id === "q10") { if (q.check(checkins, events, cc, rsvps)) done.push(q.id); }
      else { if (q.check(checkins, events, cc, rsvps)) { done.push(q.id); cc++; } }
    }
    return done;
  }, [checkins, events, rsvps]);

  // ── Category colors (dark-mode aware) ──
  const cbg = (cat) => dark ? cat.dbg : cat.bg;
  const cfg = (cat) => dark ? cat.dfg : cat.fg;

  const totalXP = useMemo(() => QUESTS.filter(q => completedQuests.includes(q.id)).reduce((s, q) => s + q.xp, 0), [completedQuests]);
  const level = getLevel(totalXP);
  const nextLvl = getNext(totalXP);

  // ── Derived data ──
  const cd = CONFS.find(c => c.id === conf);
  const cevs = events.filter(e => e.conf === conf);
  const filtered = cevs.filter(e => {
    if (catF !== "All" && e.cat !== catF) return false;
    if (dateF !== "All" && e.date !== dateF) return false;
    if (search) { const q = search.toLowerCase(); return (e.title+e.host+e.desc+e.loc+e.cat).toLowerCase().includes(q); }
    return true;
  });
  const sortedEvs = [...filtered].sort((a, b) => {
    if (sort === "date") return a.date.localeCompare(b.date) || a.time.localeCompare(b.time);
    if (sort === "popular") return getAtt(b.id) - getAtt(a.id);
    return b.id > a.id ? 1 : -1;
  });
  const uDates = [...new Set(cevs.map(e => e.date))].sort();
  const grouped = {};
  sortedEvs.forEach(e => { (grouped[e.date] = grouped[e.date] || []).push(e); });
  const friendHandles = friends.map(f => f.handle);
  const fGoing = (eid) => friends.filter(f => {
    const realData = friendRsvpMap[f.handle];
    return realData?.rsvps?.includes(eid) || false;
  });
  const vipsGoing = (eid) => fGoing(eid).filter(f => vips.includes(f.handle));
  const notableAtEvent = () => [];
  const togVip = (handle) => { const newVips = vips.includes(handle) ? vips.filter(h => h !== handle) : [...vips, handle]; setVips(newVips); syncToSupabase({ vips_data: newVips }); };
  const removeFriend = (fr) => {
    const newFriends = friends.filter(x => x.handle !== fr.handle);
    const newVips = vips.filter(h => h !== fr.handle);
    setFriends(newFriends);
    setVips(newVips);
    syncToSupabase({ friends_data: newFriends, vips_data: newVips });
    toast("Removed");
  };

  // ── Check quest completions ──
  const checkQuests = useCallback((newCI, newRV) => {
    let cc = 0; const newDone = [];
    for (const q of QUESTS) {
      if (q.id === "q10") { if (q.check(newCI, events, cc, newRV)) newDone.push(q.id); }
      else { if (q.check(newCI, events, cc, newRV)) { newDone.push(q.id); cc++; } }
    }
    const fresh = newDone.filter(qid => !completedQuests.includes(qid));
    if (fresh.length > 0) {
      const q = QUESTS.find(qq => qq.id === fresh[0]);
      if (q) { toast(`Quest complete: ${q.icon} ${q.title} (+${q.xp} XP)`, "xp"); setQuestPop(q); setTimeout(() => setQuestPop(null), 3000); }
    } else {
      // Show hint for next closest quest
      const nextQuest = QUESTS.find(q => !newDone.includes(q.id));
      if (nextQuest) {
        setTimeout(() => {
          if (nextQuest.id === "q1" && newCI.length === 0) toast(`${nextQuest.icon} Check in at an event to earn ${nextQuest.xp} XP`, "info");
          else if (nextQuest.id === "q2") toast(`${nextQuest.icon} ${newCI.length}/5 check-ins for Social Butterfly (+${nextQuest.xp} XP)`, "info");
          else if (nextQuest.id === "q9") toast(`${nextQuest.icon} ${newCI.length}/8 check-ins for Whale (+${nextQuest.xp} XP)`, "info");
        }, 1500);
      }
    }
  }, [events, completedQuests, toast]);

  // ── Actions ──
  // FIX: togBm/togIncog messages were inverted (reading state before update)
  const togBm = (id) => {
    const wasSaved = bmarks.includes(id);
    const newBmarks = wasSaved ? bmarks.filter(x => x !== id) : [...bmarks, id];
    setBmarks(newBmarks);
    syncToSupabase({ bmarks_data: newBmarks });
    toast(wasSaved ? "Removed from saved" : "Event saved", "info");
  };

  // Get real attendee count for an event
  const getAtt = (evId) => attendeeCounts[evId] || 0;

  const togRsvp = async (id) => {
    if (rsvps.includes(id)) {
      const newRsvps = rsvps.filter(x => x !== id);
      setRsvps(newRsvps);
      syncToSupabase({ rsvps_data: newRsvps });
      // Update local count immediately
      setAttendeeCounts(c => ({...c, [id]: Math.max(0, (c[id]||1) - 1)}));
      toast("Left event", "info");
    } else {
      const ev = events.find(e => e.id === id);
      if (ev && ev.capacity && getAtt(id) >= ev.capacity) { toast("Event is full", "error"); return; }
      const newRsvps = [...rsvps, id];
      setRsvps(newRsvps);
      syncToSupabase({ rsvps_data: newRsvps });
      setAttendeeCounts(c => ({...c, [id]: (c[id]||0) + 1}));
      toast("Joined! Check in at the event to earn XP", "info");
      setTimeout(() => checkQuests(checkins, newRsvps), 300);
    }
  };

  const handleCheckin = async (evId, code) => {
    const correct = getCheckInCode(evId);
    if (code.toUpperCase().trim() !== correct) { toast("Wrong code — try again", "error"); return false; }
    if (checkins.includes(evId)) { toast("Already checked in", "info"); return true; }
    const newCI = [...checkins, evId];
    setCheckins(newCI);
    syncToSupabase({ checkins_data: newCI });
    toast("Checked in! ✓ XP unlocked");
    setTimeout(() => checkQuests(newCI, rsvps), 400);
    return true;
  };

  const togIncog = (id) => {
    const wasHidden = incog.includes(id);
    const newIncog = wasHidden ? incog.filter(x => x !== id) : [...incog, id];
    setIncog(newIncog);
    syncToSupabase({ incog_data: newIncog });
    toast(wasHidden ? "Now visible to friends" : "Hidden from friends", "info");
  };

  const delEv = async (id) => { setEvents(es => es.filter(e => e.id !== id)); setSel(null); if (hasSupabase()) await db.deleteEvent(id); toast("Event deleted"); };

  const shareEv = async (ev) => {
    const base = window.location.origin + window.location.pathname;
    const url = `${base}#event=${ev.id}`;
    const text = `${ev.title}\n📅 ${fd(ev.date)} ${ev.time}\n📍 ${ev.loc}\n🎤 ${ev.host}\n\n${url}`;
    // Try native share (mobile)
    if (navigator.share) {
      try { await navigator.share({ title: ev.title, text: `${ev.title} — ${fd(ev.date)} ${ev.time} @ ${ev.loc}`, url }); return; } catch(e) { /* user cancelled or failed, fall through to copy */ }
    }
    const ok = await copyText(text);
    toast(ok ? "Link copied!" : "Copy failed", ok ? "success" : "error");
  };

  const addFriend = (h) => {
    const handle = h.startsWith("@") ? h : `@${h}`;
    if (friendHandles.map(x=>x.toLowerCase()).includes(handle.toLowerCase())) { toast("Already friends", "info"); return; }

    // Add to local state immediately as pending (instant UI feedback)
    const name = handle.slice(1);
    const newFriend = { handle, name, method: "x", role: "", bio: "", notable: false, tags: [], pending: true };
    const newFriends = [...friends, newFriend];
    setFriends(newFriends);
    syncToSupabase({ friends_data: newFriends });
    toast(`Added ${name} — will link when they join!`, "info");

    // Try Supabase in background: look up real profile or store as pending
    if (user?.supaId && hasSupabase()) {
      db.addFriendByHandle(user.supaId, handle).then(result => {
        if (result?.found && result.profile) {
          const upgraded = newFriends.map(fr => fr.handle.toLowerCase() === handle.toLowerCase()
            ? { ...result.profile, is_vip: false, friend_id: result.profile.id, pending: false }
            : fr
          );
          setFriends(upgraded);
          syncToSupabase({ friends_data: upgraded });
          toast(`${result.profile.name} is on SIDE.SOL!`);
        }
      }).catch(() => {});
      // Send friend request notification to the other user
      const supaUrl = import.meta.env.VITE_SUPABASE_URL;
      const supaKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
      let token = supaKey;
      try { const sk = `sb-${new URL(supaUrl).hostname.split('.')[0]}-auth-token`; const st = JSON.parse(localStorage.getItem(sk)||"{}"); if(st?.access_token) token=st.access_token; } catch(e){}
      fetch(`${supaUrl}/rest/v1/rpc/send_friend_request`, {
        method:"POST",
        headers:{"Content-Type":"application/json","apikey":supaKey,"Authorization":`Bearer ${token}`},
        body:JSON.stringify({sender_handle:user.handle,sender_name:user.name,sender_pfp:user.pfp||"",target_handle:handle})
      }).catch(() => {});
    }
  };

  const handleAuth = async (method) => {
    if (hasSupabase()) {
      if (method === "x") {
        await db.signInWithTwitter();
        return;
      }
      if (!af.email) { toast("Email required", "error"); return; }
      await db.signInWithEmail(af.email, af.name || "Anon");
      setShowAuth(false);
      setAf({ email: "", name: "" });
      toast("Check your email for a login link!", "info");
      return;
    }
    // Fallback: Auth0 / local
    if (method === "x") {
      const auth0 = await getAuth0();
      if (!auth0) { toast("Auth not configured", "error"); return; }
      await auth0.loginWithRedirect({ authorizationParams: { connection: "twitter" } });
      return;
    }
    if (!af.email) { toast("Email required", "error"); return; }
    setUser({ name: af.name || "Anon", handle: af.email, method: "email" });
    setShowAuth(false);
    setAf({ email: "", name: "" });
    toast("Signed in!");
  };

  // ── Field ──
  const Fld = ({ l, req, err, children }) => (
    <div style={{display:"flex",flexDirection:"column",gap:5}}>
      <label className="fld-label">{l}{req && <span style={{color:"var(--accent)",marginLeft:2}}> *</span>}</label>
      <div style={{position:"relative"}}>{children}{err && <div style={{position:"absolute",right:12,top:"50%",transform:"translateY(-50%)",fontSize:14,color:"#DC2626"}}>⚠</div>}</div>
      {err && <span role="alert" style={{fontSize:12,color:"#DC2626",fontWeight:600,display:"flex",alignItems:"center",gap:4}}>⚠ {err}</span>}
    </div>
  );

  // ── Submit Modal ──
  const formDraftRef = useRef(null);
  const SubmitModal = ({ initial, onClose }) => {
    const [f, sF] = useState(() => {
      if (initial) return { ...initial, isLuma: !!(initial.lumaEventId || initial.luma?.includes("luma")) };
      if (formDraftRef.current) return formDraftRef.current;
      return { title:"", cat:"Meetup", date:"", time:"", loc:"", host:"", desc:"", rsvp:false, luma:"", conf, banner:"", capacity:0, announcement:"", bannerPos:50, isLuma:false, lumaEventId:"" };
    });
    // Save draft on every change so it survives re-renders / tab switches
    useEffect(() => { if (!initial) formDraftRef.current = f; }, [f, initial]);
    const [errs, sE] = useState({});
    const isE = !!initial?.id;
    const validate = () => {
      const e = {};
      if (!f.title.trim()) e.title = "Required";
      if (!f.date) e.date = "Required";
      if (!f.loc.trim()) e.loc = "Required";
      if (!f.host.trim()) e.host = "Required";
      if (f.luma && !f.luma.startsWith("http")) e.luma = "Must be a URL";
      if (f.isLuma && !f.luma?.includes("luma")) e.luma = "Enter a valid Luma link";
      if (f.isLuma && !f.lumaEventId?.startsWith("evt-")) e.lumaEventId = "Must start with evt-";
      sE(e);
      return !Object.keys(e).length;
    };
    const handleBanner = (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      if (file.size > 500000) { toast("Max 500KB", "error"); return; }
      const reader = new FileReader();
      reader.onload = (ev) => sF(prev => ({...prev, banner: ev.target.result}));
      reader.readAsDataURL(file);
    };
    const submit = async () => {
      if (!validate()) return;
      // Strip internal-only fields before sending to Supabase
      const {isLuma, _lumaLoading, ...cleanData} = f;
      if (hasSupabase()) {
        if (isE) {
          const updated = await db.updateEvent(initial.id, cleanData);
          if (updated) { setEvents(es => es.map(e => e.id === initial.id ? {...e,...updated} : e)); toast("Updated!"); }
          else { toast("Failed to update event", "error"); return; }
        } else {
          const created = await db.createEvent({ ...cleanData, conf }, user?.supaId);
          if (created) { setEvents(es => [created, ...es]); toast("Event created!"); }
          else { toast("Failed to create event", "error"); return; }
        }
      } else {
        if (isE) { setEvents(es => es.map(e => e.id === initial.id ? {...e,...f} : e)); toast("Updated!"); }
        else { setEvents(es => [{ ...f, id: gid(), att: 0, by: user?.handle || "anon", created_by: user?.supaId || null, conf }, ...es]); toast("Submitted!"); }
      }
      formDraftRef.current = null;
      onClose();
    };
    const handleClose = () => { formDraftRef.current = null; onClose(); };
    return (<>
      <div className="overlay" onClick={handleClose}/>
      <div className="modal" role="dialog">
        <div className="mh"><h2 className="mt">{isE ? "Edit" : "Submit Side Event"}</h2><button className="ib" aria-label="Close" onClick={handleClose}>✕</button></div>
        <div style={{display:"flex",flexDirection:"column",gap:12}}>
          <Fld l="Banner image" err={null}>
            <label style={{position:"relative",borderRadius:16,overflow:"hidden",border:`2px dashed ${f.banner?"var(--accent2)":"var(--border)"}`,background:f.banner?"transparent":"var(--bg)",height:f.banner?120:72,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",transition:"all .25s"}}>
              {f.banner ? (<>
                <img src={f.banner} alt="" style={{width:"100%",height:"100%",objectFit:"cover",objectPosition:`center ${f.bannerPos||50}%`}}/>
                <div style={{position:"absolute",inset:0,background:"linear-gradient(180deg,transparent 40%,rgba(0,0,0,.4))",display:"flex",alignItems:"flex-end",justifyContent:"space-between",padding:10}}>
                  <span style={{color:"white",fontSize:11,fontWeight:700}}>Drag to reposition ↕</span>
                  <button onClick={e => { e.preventDefault(); e.stopPropagation(); sF({...f, banner:""}); }} style={{background:"rgba(0,0,0,.5)",color:"white",border:"none",borderRadius:100,padding:"4px 12px",fontSize:11,fontWeight:700,cursor:"pointer"}}>Remove</button>
                </div>
                <input type="range" min="0" max="100" value={f.bannerPos||50}
                  onClick={e => e.preventDefault()}
                  onChange={e => { e.preventDefault(); e.stopPropagation(); sF(prev => ({...prev, bannerPos:parseInt(e.target.value)})); }}
                  style={{position:"absolute",left:10,right:10,bottom:36,height:4,appearance:"auto",opacity:.7,zIndex:5,cursor:"pointer"}}
                />
              </>) : (
                <div style={{textAlign:"center",color:"var(--muted)",padding:20}}>
                  <div style={{width:48,height:48,borderRadius:14,background:"linear-gradient(135deg,rgba(153,69,255,.1),rgba(20,241,149,.08))",display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 8px",fontSize:22}}>📸</div>
                  <p style={{fontSize:13,fontWeight:700,color:"var(--heading)"}}>Add a banner image</p>
                  <p style={{fontSize:10,opacity:.6,marginTop:2}}>PNG, JPG · Max 500KB</p>
                </div>
              )}
              <input type="file" accept="image/png,image/jpeg,image/webp" onChange={handleBanner} style={{position:"absolute",inset:0,opacity:0,cursor:"pointer",width:"100%",height:"100%"}}/>
            </label>
          </Fld>
          <Fld l="Event name" req err={errs.title}><input className="field" placeholder="e.g. Solana Builders Meetup" value={f.title} onChange={e=>sF({...f,title:e.target.value})}/></Fld>
          <div style={{display:"flex",alignItems:"center",gap:10,padding:"4px 0"}}>
            <div onClick={()=>sF({...f,isLuma:!f.isLuma,luma:f.isLuma?"":"https://luma.com/",lumaEventId:f.isLuma?"":f.lumaEventId})} className="tog" data-on={!!f.isLuma}><div className="tog-t" style={{transform:f.isLuma?"translateX(22px)":"translateX(0)"}}/></div>
            <div><span style={{fontSize:13,fontWeight:600}}>Luma Event</span><p style={{fontSize:11,color:"var(--muted)",marginTop:1}}>Registration handled via Luma</p></div>
          </div>
          <div className="r2">
            <Fld l="Category" req><select className="field" value={f.cat} onChange={e=>sF({...f,cat:e.target.value})}>{Object.keys(CATS).map(c=><option key={c} value={c}>{CATS[c].em} {c}</option>)}</select></Fld>
            <Fld l="Hosted by" req err={errs.host}><input className="field" placeholder="Team / person" value={f.host} onChange={e=>sF({...f,host:e.target.value})}/></Fld>
          </div>
          <div className="r2">
            <Fld l="Date" req err={errs.date}><input className="field" type="date" placeholder="Select date" value={f.date} onChange={e=>sF({...f,date:e.target.value})} style={{colorScheme:dark?"dark":"light"}}/></Fld>
            <Fld l="Time"><input className="field" placeholder="6 PM – 10 PM" value={f.time} onChange={e=>sF({...f,time:e.target.value})}/></Fld>
          </div>
          <Fld l="Location" req err={errs.loc}><input className="field" placeholder="Venue, address" value={f.loc} onChange={e=>sF({...f,loc:e.target.value})}/></Fld>
          <Fld l="Description"><textarea className="field" rows={3} placeholder="What's it about?" value={f.desc} onChange={e=>sF({...f,desc:e.target.value})}/></Fld>
          {f.isLuma ? <>
            <Fld l="Luma link" err={errs.luma}>
              <input className="field" placeholder="https://luma.com/your-event" value={f.luma} onChange={e => {
                const val = e.target.value;
                sF(prev => ({...prev, luma: val}));
                // Auto-extract event ID when a valid Luma URL is pasted
                if (val.includes("luma.com/") || val.includes("lu.ma/")) {
                  sF(prev => ({...prev, lumaEventId: "", _lumaLoading: true}));
                  const controller = new AbortController();
                  const timeout = setTimeout(() => controller.abort(), 8000);
                  fetch(`/api/luma-id?url=${encodeURIComponent(val)}`, {signal:controller.signal})
                    .then(r => r.json())
                    .then(d => { clearTimeout(timeout); if (d.eventId) sF(prev => ({...prev, lumaEventId: d.eventId, _lumaLoading: false})); else sF(prev => ({...prev, _lumaLoading: false})); })
                    .catch(() => { clearTimeout(timeout); sF(prev => ({...prev, _lumaLoading: false})); });
                }
              }}/>
            </Fld>
            <div style={{display:"flex",alignItems:"center",gap:8,padding:"6px 0"}}>
              <div style={{flex:1}}>
                <p style={{fontSize:11,fontWeight:700,color:f.lumaEventId?"#0A8F5A":"var(--muted)",fontFamily:"var(--fm)"}}>{f._lumaLoading ? "⏳ Detecting event ID..." : f.lumaEventId ? `✓ ${f.lumaEventId}` : "Paste a Luma link to auto-detect the event ID"}</p>
              </div>
              {f.lumaEventId && <span style={{fontSize:18}}>✅</span>}
            </div>
            {!f.lumaEventId && !f._lumaLoading && f.luma?.includes("luma") && <Fld l="Or enter Luma Event ID manually" err={errs.lumaEventId}>
              <input className="field" placeholder="evt-AbCdEfGh..." value={f.lumaEventId||""} onChange={e=>sF({...f,lumaEventId:e.target.value})}/>
            </Fld>}
          </> : <>
            <Fld l="RSVP link (optional)" err={errs.luma}><input className="field" placeholder="https://..." value={f.luma} onChange={e=>sF({...f,luma:e.target.value})}/></Fld>
          </>}
          <div className="r2">
            {!f.isLuma && <div style={{display:"flex",alignItems:"center",gap:10}}>
              <div onClick={()=>sF({...f,rsvp:!f.rsvp})} className="tog" data-on={f.rsvp}><div className="tog-t" style={{transform:f.rsvp?"translateX(22px)":"translateX(0)"}}/></div>
              <span style={{fontSize:13,fontWeight:600}}>Approval Required</span>
            </div>}
            <Fld l="Max capacity"><input className="field" type="number" min="0" placeholder="0 = unlimited" value={f.capacity||""} onChange={e=>sF({...f,capacity:parseInt(e.target.value)||0})}/></Fld>
          </div>
          {isE && <Fld l="Announcement (visible to attendees)"><input className="field" placeholder="e.g. Venue changed! Now at..." value={f.announcement||""} onChange={e=>sF({...f,announcement:e.target.value})}/></Fld>}
          <button className="btn-glow" onClick={submit}>{isE ? "Save" : "Submit Event"}</button>
        </div>
      </div>
    </>);
  };

  // ── Check-in Modal ──
  const renderCheckinModal = (ev) => {
    const already = checkins.includes(ev.id);
    return (<>
      <div className="overlay" onClick={() => { setShowCheckin(null); setCheckinInput(""); }}/>
      <div className="modal" style={{textAlign:"center"}}>
        <div className="mh"><button className="ib" onClick={() => { setShowCheckin(null); setCheckinInput(""); }}>←</button><span/></div>
        {already ? (
          <div className="checkin-done">
            <div className="checkin-done-icon" style={{animation:"successBurst .6s cubic-bezier(.16,1,.3,1)"}}>✓</div>
            <h3 style={{fontSize:20,fontWeight:800,marginTop:14,fontFamily:"var(--fd)",animation:"fadeUp .4s .2s both"}}>You're in!</h3>
            <p style={{color:"var(--muted)",fontSize:14,marginTop:5,animation:"fadeUp .4s .3s both"}}>XP is counting for this event</p>
            <div style={{marginTop:16,padding:"10px 20px",background:"linear-gradient(135deg,rgba(153,69,255,.06),rgba(20,241,149,.06))",borderRadius:12,display:"inline-block",animation:"fadeUp .4s .4s both"}}>
              <span style={{fontFamily:"var(--fm)",fontWeight:700,color:"var(--accent)",fontSize:13}}>+XP unlocked</span>
            </div>
          </div>
        ) : (
          <div>
            <div style={{fontSize:40,marginBottom:10,animation:"subtleBounce 2s ease infinite"}}>📍</div>
            <h3 style={{fontSize:20,fontWeight:800,fontFamily:"var(--fd)"}}>Check in</h3>
            <p style={{color:"var(--muted)",fontSize:13.5,margin:"6px 0 20px",lineHeight:1.5}}>Enter the 6-letter code displayed at the event</p>
            <input className="checkin-input" maxLength={6} placeholder="ABC123" value={checkinInput}
              onChange={e => setCheckinInput(e.target.value.toUpperCase())} autoFocus
              onKeyDown={e => { if(e.key==="Enter"&&checkinInput.length===6) { if(handleCheckin(ev.id,checkinInput)) { setShowCheckin(null); setCheckinInput(""); } } }}/>
            <p style={{fontSize:11.5,color:"var(--muted)",margin:"10px 0 20px"}}>Ask the host for the code — it rotates every 30 min</p>
            <button className="btn-glow" style={{width:"100%",padding:"15px",fontSize:16}} onClick={() => { if(checkinInput.length<6){toast("Enter 6 characters","error");return;} if(handleCheckin(ev.id,checkinInput)){setShowCheckin(null);setCheckinInput("");} }}>
              Verify Check-in
            </button>
          </div>
        )}
      </div>
    </>);
  };

  // ── Event Card ──
  const renderCard = (ev, i, compact) => {
    const cat = CATS[ev.cat] || CATS.Other;
    const saved = bmarks.includes(ev.id);
    const going = rsvps.includes(ev.id);
    const verified = checkins.includes(ev.id);
    const hot = getAtt(ev.id) >= 100;
    const fg = fGoing(ev.id);
    const vg = fg.filter(f => vips.includes(f.handle));
    const hasBanner = !!ev.banner;

    return (
      <div key={ev.id} className="ev-card" style={{background:cbg(cat),borderLeft:`4px solid ${cat.ac}`,animation:`cardIn .5s cubic-bezier(.16,1,.3,1) ${i*0.06}s both`,padding:hasBanner&&!compact?0:undefined,overflow:"hidden"}} onClick={() => setSel(ev)}>
        {hasBanner && !compact && (
          <div style={{position:"relative",height:82}}>
            <img src={ev.banner} alt="" style={{width:"100%",height:"100%",objectFit:"cover",objectPosition:`center ${ev.bannerPos||50}%`}}/>
            <div style={{position:"absolute",inset:0,background:`linear-gradient(180deg,${cbg(cat)}20 0%,${cbg(cat)}88 55%,${cbg(cat)} 100%)`}}/>
            <div style={{position:"absolute",top:10,left:14,right:14,display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
              <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
                <span className="pill" style={{background:`${cfg(cat)}20`,color:cfg(cat),backdropFilter:"blur(6px)"}}>{cat.em} {ev.cat}</span>
                {verified && <span className="pill verified-pill" style={{backdropFilter:"blur(6px)"}}>✓</span>}
                {!verified && going && <span className="pill going-pill" style={{backdropFilter:"blur(6px)"}}>Going</span>}
              </div>
              <button className="ib-sm" onClick={e => { e.stopPropagation(); togBm(ev.id); }} style={{color:saved?"#F9AB00":"rgba(255,255,255,.8)",textShadow:"0 1px 4px rgba(0,0,0,.4)"}}>{saved ? "★" : "☆"}</button>
            </div>
          </div>
        )}
        <div style={{padding:hasBanner&&!compact?"2px 18px 16px":undefined}}>
          {(!hasBanner || compact) && (
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:8,marginBottom:compact?4:8}}>
              <div style={{display:"flex",gap:5,alignItems:"center",flexWrap:"wrap"}}>
                <span className="pill" style={{background:`${cfg(cat)}10`,color:cfg(cat),border:`1px solid ${cfg(cat)}18`}}>{cat.em} {ev.cat}</span>
                {verified && <span className="pill verified-pill">✓ Verified</span>}
                {!verified && going && <span className="pill going-pill">Going</span>}
                {hot && <span className="pill hot-pill">🔥 Hot</span>}
              </div>
              <button className="ib-sm" onClick={e => { e.stopPropagation(); togBm(ev.id); }} style={{color:saved?"#F9AB00":"var(--muted)"}}>{saved ? "★" : "☆"}</button>
            </div>
          )}
          <h3 className={compact ? "card-t-sm" : "card-t"}>{ev.title}</h3>
          <p className="card-host" style={{color:cfg(cat)}}>{ev.host}</p>
          {!compact && ev.desc && <p className="card-desc">{ev.desc}</p>}
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-end",marginTop:compact?4:2}}>
            <div className="card-mc">
              <span className="card-m">📅 {fd(ev.date)}{ev.time ? ` · ${ev.time}` : ""}</span>
              <span className="card-m">📍 {ev.rsvp && !rsvps.includes(ev.id) ? "Approval required" : ev.loc}</span>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:5,flexWrap:"wrap",justifyContent:"flex-end"}}>
              {vg.length > 0 && <span className="vip-badge">⭐ {vg[0].name}{vg.length > 1 ? ` +${vg.length-1}` : ""}</span>}
              {fg.length > 0 && (
                <div style={{display:"flex",alignItems:"center",gap:4}}>
                  <div style={{display:"flex"}}>{fg.slice(0,3).map((fr,j) => <div key={fr.handle} style={{marginLeft:j?-8:0,zIndex:3-j}}><Avatar name={fr.name} s={22} bg={uc(fr.handle)} pfp={fr.pfp}/></div>)}</div>
                  <span style={{fontSize:10.5,fontWeight:600,color:"var(--accent)"}}>{fg.length <= 2 ? fg.map(f=>f.name.split(" ")[0]).join(" & ") : `${fg.length} friends`}</span>
                </div>
              )}
              {user && !going && !ev.luma?.includes("luma") && !ev.rsvp && <button className="qrsvp" onClick={e => { e.stopPropagation(); togRsvp(ev.id); }}>Join</button>}
              {user && !going && !ev.luma?.includes("luma") && ev.rsvp && !pendingRequests.includes(ev.id) && <button className="qrsvp" onClick={e => { e.stopPropagation(); const np = [...pendingRequests, ev.id]; setPendingRequests(np); syncToSupabase({pending_requests_data:np}); toast("Request sent!", "info"); }}>Request</button>}
              {user && !going && !ev.luma?.includes("luma") && ev.rsvp && pendingRequests.includes(ev.id) && <button className="qrsvp on" style={{fontSize:9,padding:"4px 10px"}} onClick={e => { e.stopPropagation(); }}>Requested</button>}
              {user && !going && ev.luma?.includes("luma") && (ev.lumaEventId ? <button className="luma-checkout--button qrsvp" type="button" data-luma-action="checkout" data-luma-event-id={ev.lumaEventId} onClick={e => { e.stopPropagation(); setTimeout(reloadLumaScript, 50); }} style={{fontSize:9,padding:"5px 12px"}}>Register</button> : <a href={ev.luma} target="_blank" rel="noopener noreferrer" className="qrsvp" onClick={e => { e.stopPropagation(); }} style={{textDecoration:"none",fontSize:9,padding:"5px 12px"}}>Register ↗</a>)}
              {user && going && !verified && <button className="qrsvp on" style={{fontSize:9,padding:"4px 10px"}} onClick={e => { e.stopPropagation(); }}>Going</button>}
              <span className="card-att">👥 {getAtt(ev.id)}</span>
            </div>
          </div>
        </div>
      </div>
    );
  };

  // ── Luma checkout: reload script to detect buttons ──
  const reloadLumaScript = useCallback(() => {
    const existing = document.getElementById("luma-checkout");
    if (existing) existing.remove();
    const s = document.createElement("script");
    s.id = "luma-checkout";
    s.src = "https://embed.lu.ma/checkout-button.js";
    s.async = true;
    document.body.appendChild(s);
  }, []);
  useEffect(() => {
    // Reload Luma script when event detail opens or view changes (so checkout buttons work)
    const hasLumaEvents = events.some(e => e.lumaEventId);
    if (hasLumaEvents) {
      setTimeout(reloadLumaScript, 300);
      // Also reload after a longer delay to catch modal animations
      if (sel) setTimeout(reloadLumaScript, 800);
    }
  }, [sel, view, events, reloadLumaScript]);

  // ── Event Detail ──
  const renderDetail = (ev) => {
    const cat = CATS[ev.cat] || CATS.Other;
    const mine = user && (ev.created_by === user.supaId || ev.by === user.handle);
    const going = rsvps.includes(ev.id);
    const saved = bmarks.includes(ev.id);
    const verified = checkins.includes(ev.id);
    const isInc = incog.includes(ev.id);
    const fg = fGoing(ev.id);
    const notableHere = notableAtEvent(ev.id);

    return (<>
      <div className="overlay" onClick={() => setSel(null)}/>
      <div className="modal" style={{padding:0}}>
        <div className="mh" style={{borderBottom:"1px solid var(--border)",padding:"13px 18px"}}>
          <button className="ib" aria-label="Close" onClick={() => setSel(null)}>←</button>
          <div style={{display:"flex",gap:5}}>
            {mine && <><button className="ib" aria-label="Edit event" onClick={() => { setSel(null); setEditing(ev); }}>✎</button><button className="ib" aria-label="Delete event" onClick={() => delEv(ev.id)} style={{color:"#BF360C"}}>🗑</button></>}
            <button className="ib" aria-label="Share event" onClick={() => shareEv(ev)}>↗</button>
            <button className="ib" aria-label={saved?"Remove bookmark":"Save event"} onClick={() => togBm(ev.id)} style={{color:saved?"#F9AB00":"var(--text)"}}>{saved ? "★" : "☆"}</button>
          </div>
        </div>
        <div style={{padding:"18px 20px 32px"}}>
          <div className="ticket" style={{padding:ev.banner?0:undefined,overflow:ev.banner?"hidden":undefined}}>
            {ev.banner && (
              <div style={{position:"relative",height:110}}>
                <img src={ev.banner} alt="" style={{width:"100%",height:"100%",objectFit:"cover",objectPosition:`center ${ev.bannerPos||50}%`}}/>
                <div style={{position:"absolute",inset:0,background:`linear-gradient(180deg,transparent 20%,${cbg(cat)}cc 65%,${cbg(cat)} 100%)`}}/>
              </div>
            )}
            <div style={{padding:ev.banner?"0 28px 28px":"0"}}>
            <span className="pill" style={{background:`${cfg(cat)}10`,color:cfg(cat),border:`1px solid ${cfg(cat)}18`,marginBottom:10,animation:"fadeUp .4s .1s both",marginTop:ev.banner?-8:0,position:"relative"}}>{cat.em} {ev.cat}</span>
            <h2 className="ticket-t" style={{animation:"fadeUp .4s .15s both"}}>{ev.title}</h2>
            <p style={{color:"var(--muted)",fontSize:13.5,animation:"fadeUp .4s .2s both"}}>by <strong style={{color:"var(--heading)",fontFamily:"var(--fd)"}}>{ev.host}</strong></p>
            <div style={{display:"flex",gap:5,marginTop:10,justifyContent:"center",flexWrap:"wrap",animation:"fadeUp .4s .25s both"}}>
              {verified && <span className="pill verified-pill" style={{animation:"pulseRing 1.5s ease .5s"}}>✓ Verified Attendance</span>}
              {!verified && going && <span className="pill going-pill">Going — check in for XP</span>}
              {ev.rsvp && !going && <span className="pill rsvp-pill">🔒 Approval Required</span>}
              {ev.rsvp && going && <span className="pill" style={{background:"rgba(20,241,149,.1)",color:"#0A8F5A",border:"1px solid rgba(20,241,149,.18)"}}>✓ Approved</span>}
            </div>
            <hr className="dashed"/>
            <div className="r2" style={{marginBottom:8,animation:"fadeUp .4s .3s both"}}>
              <div className="info-cell"><span className="info-l">Date</span><span className="info-v">{fd(ev.date)}</span></div>
              <div className="info-cell"><span className="info-l">Time</span><span className="info-v">{ev.time || "TBA"}</span></div>
            </div>
            <div className="info-cell" style={{marginBottom:12,animation:"fadeUp .4s .35s both"}}><span className="info-l">Location</span><span className="info-v">{ev.rsvp && !going && !mine ? "🔒 Visible after approval" : ev.loc}</span></div>
            {ev.announcement && <div style={{padding:"10px 14px",background:"rgba(249,171,0,.08)",border:"1.5px solid rgba(249,171,0,.2)",borderRadius:14,marginBottom:12,textAlign:"left",animation:"fadeUp .4s .38s both",display:"flex",gap:8,alignItems:"flex-start"}}>
              <span style={{fontSize:14,flexShrink:0}}>📢</span>
              <div><p style={{fontSize:10,fontWeight:700,color:"#A66D00",textTransform:"uppercase",letterSpacing:".5px",marginBottom:2,fontFamily:"var(--fm)"}}>Announcement</p><p style={{fontSize:13,color:"var(--text)",lineHeight:1.5}}>{ev.announcement}</p></div>
            </div>}
            {ev.desc && <p style={{fontSize:13.5,color:"var(--muted)",lineHeight:1.65,marginBottom:12,textAlign:"left",animation:"fadeUp .4s .4s both"}}>{ev.desc}</p>}
            {(fg.length > 0 || notableHere.length > 0) && <>
              <hr className="dashed"/>
              <p className="info-l" style={{marginBottom:8,textAlign:"left"}}>People you know · {fg.length + notableHere.length}</p>
              {fg.length > 0 && <div style={{display:"flex",gap:7,flexWrap:"wrap",marginBottom:notableHere.length?10:0}}>
                {fg.map((fr,fi) => <div key={fr.handle} className={`friend-chip ${vips.includes(fr.handle)?"vip":""}`} style={{animation:`fadeUp .3s ${.45+fi*.05}s both`}} onClick={() => { setSel(null); setFriendView(fr); }}>{vips.includes(fr.handle)&&<span style={{fontSize:10}}>⭐</span>}<Avatar name={fr.name} s={20} bg={uc(fr.handle)} pfp={fr.pfp}/><span>{fr.name}</span>{fr.role&&<span style={{fontSize:9,color:"var(--muted)",marginLeft:2}}>{fr.role.split(",")[0]}</span>}</div>)}
              </div>}
              {notableHere.length > 0 && <>
                <p style={{fontSize:9.5,fontWeight:700,color:"var(--muted)",textTransform:"uppercase",letterSpacing:".8px",marginBottom:6,textAlign:"left",fontFamily:"var(--fm)"}}>Notable attendees</p>
                <div style={{display:"flex",gap:7,flexWrap:"wrap"}}>
                  {notableHere.map((u,ui) => <div key={u.handle} className="friend-chip notable" style={{animation:`fadeUp .3s ${.55+ui*.05}s both`}} onClick={() => { setSel(null); setFriendView(u); }}><Avatar name={u.name} s={20} bg={uc(u.handle)}/><span>{u.name}</span><span style={{fontSize:9,color:"var(--muted)"}}>{u.role.split(",")[0]}</span></div>)}
                </div>
              </>}
            </>}
            <hr className="dashed"/>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <span className="card-att" style={{fontSize:12}}>👥 {getAtt(ev.id)}{ev.capacity ? ` / ${ev.capacity}` : ""} going</span>
              <span style={{fontSize:9,color:"#c4c0b8",fontFamily:"var(--fm)",letterSpacing:".5px"}}>SIDE.SOL</span>
            </div>
            <div style={{textAlign:"center",marginTop:8,opacity:.35}}><Barcode/></div>
            </div>
          </div>

          {going && user && (
            <div className="incog-bar" style={{animation:"fadeUp .4s .5s both"}}>
              <span>{isInc ? "👻" : "👁"}</span>
              <div style={{flex:1}}><p style={{fontSize:13,fontWeight:600}}>Incognito</p><p style={{fontSize:11.5,color:"var(--muted)"}}>Hide from friends</p></div>
              <div onClick={() => togIncog(ev.id)} className="tog" data-on={isInc}><div className="tog-t" style={{transform:isInc?"translateX(22px)":"translateX(0)"}}/></div>
            </div>
          )}

          {/* RSVP Attendee List */}
          {(() => {
            const allRsvp = eventAttendees.length > 0 ? eventAttendees : (rsvps.includes(ev.id) && user ? [user] : []);
            return allRsvp.length > 0 ? (
              <div style={{marginTop:16,animation:"fadeUp .4s .5s both"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                  <p className="info-l">Attendees · {allRsvp.length}{ev.capacity ? ` / ${ev.capacity}` : ""}</p>
                </div>
                <div style={{background:"var(--bg)",borderRadius:16,border:"1px solid var(--border)",overflow:"hidden"}}>
                  {allRsvp.map((u,i) => {
                    const isMe = user && u.handle === user.handle;
                    const isFr = friendHandles.includes(u.handle);
                    return (
                      <div key={u.handle||i} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 14px",borderBottom:i<allRsvp.length-1?"1px solid var(--border)":"none",cursor:isMe?"default":"pointer",transition:"background .15s"}} onClick={() => { if (!isMe) { setSel(null); setFriendView({...u, method:"x"}); } }}>
                        <Avatar name={u.name} s={28} bg={uc(u.handle||"")} pfp={u.pfp}/>
                        <div style={{flex:1,minWidth:0}}>
                          <p style={{fontSize:13,fontWeight:600,fontFamily:"var(--fd)"}}>{u.name}{isMe && <span style={{fontSize:10,color:"var(--muted)",marginLeft:4}}>(you)</span>}</p>
                          <p style={{fontSize:10,color:"var(--muted)"}}>{u.role || u.handle}</p>
                        </div>
                        {!isMe && !isFr && <button className="btn-sm" style={{background:"linear-gradient(135deg,#9945FF,#14F195)",border:"none",padding:"5px 12px",fontSize:10}} onClick={e => { e.stopPropagation(); addFriend(u.handle); }}>+ Add</button>}
                        {isFr && <span style={{fontSize:10,color:"var(--accent)",fontWeight:600}}>👥 Friend</span>}
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null;
          })()}

          {/* Pending Approval Requests (host only) */}
          {mine && ev.rsvp && eventPendingUsers.length > 0 && (
            <div style={{marginTop:16,animation:"fadeUp .4s .52s both"}}>
              <p className="info-l" style={{marginBottom:8}}>Pending Requests · {eventPendingUsers.length}</p>
              <div style={{background:"var(--bg)",borderRadius:16,border:"1.5px solid rgba(249,171,0,.2)",overflow:"hidden"}}>
                {eventPendingUsers.map((u,i) => (
                  <div key={u.handle||i} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 14px",borderBottom:i<eventPendingUsers.length-1?"1px solid var(--border)":"none"}}>
                    <Avatar name={u.name} s={28} bg={uc(u.handle||"")} pfp={u.pfp}/>
                    <div style={{flex:1,minWidth:0}}>
                      <p style={{fontSize:13,fontWeight:600,fontFamily:"var(--fd)"}}>{u.name}</p>
                      <p style={{fontSize:10,color:"var(--muted)"}}>{u.handle}</p>
                    </div>
                    <button className="btn-sm" style={{background:"linear-gradient(135deg,#14F195,#0A8F5A)",padding:"5px 14px",fontSize:11}} onClick={() => {
                      const supaUrl = import.meta.env.VITE_SUPABASE_URL;
                      const supaKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
                      let token = supaKey;
                      try { const sk = `sb-${new URL(supaUrl).hostname.split('.')[0]}-auth-token`; const st = JSON.parse(localStorage.getItem(sk)||"{}"); if(st?.access_token) token=st.access_token; } catch(e){}
                      fetch(`${supaUrl}/rest/v1/rpc/approve_event_request`, {
                        method:"POST",
                        headers:{"Content-Type":"application/json","apikey":supaKey,"Authorization":`Bearer ${token}`},
                        body:JSON.stringify({requester_handle:u.handle,event_id:ev.id})
                      }).then(r => {
                        if(r.ok) {
                          setEventPendingUsers(p=>p.filter(x=>x.handle!==u.handle));
                          setEventAttendees(a=>[...a,u]);
                          setAttendeeCounts(c => ({...c, [ev.id]: (c[ev.id]||0)+1}));
                          toast(`${u.name} approved!`);
                        } else { toast("Approve failed","error"); }
                      });
                    }}>✓ Approve</button>
                    <button className="ib-sm" style={{color:"#BF360C"}} onClick={() => {
                      const supaUrl = import.meta.env.VITE_SUPABASE_URL;
                      const supaKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
                      let token = supaKey;
                      try { const sk = `sb-${new URL(supaUrl).hostname.split('.')[0]}-auth-token`; const st = JSON.parse(localStorage.getItem(sk)||"{}"); if(st?.access_token) token=st.access_token; } catch(e){}
                      fetch(`${supaUrl}/rest/v1/rpc/deny_event_request`, {
                        method:"POST",
                        headers:{"Content-Type":"application/json","apikey":supaKey,"Authorization":`Bearer ${token}`},
                        body:JSON.stringify({requester_handle:u.handle,event_id:ev.id})
                      }).then(r => {
                        if(r.ok) {
                          setEventPendingUsers(p=>p.filter(x=>x.handle!==u.handle));
                          toast(`${u.name} denied`);
                        } else { toast("Deny failed","error"); }
                      });
                    }}>✕</button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div style={{display:"flex",flexDirection:"column",gap:10,marginTop:16,animation:"fadeUp .4s .55s both"}}>
            {user && going && !verified && (
              <button className="btn-checkin" onClick={() => { setSel(null); setShowCheckin(ev); }}>📍 Check In — Earn XP</button>
            )}
            {user && verified && (
              <div className="verified-banner" style={{animation:"pulseRing 1.5s ease"}}>✓ Attendance Verified — XP Earned</div>
            )}
            <div style={{display:"flex",gap:8}}>
              {!going && !ev.luma?.includes("luma") && !ev.rsvp && <button className="btn-glow" style={{flex:1}} onClick={() => togRsvp(ev.id)}>Join</button>}
              {!going && !ev.luma?.includes("luma") && ev.rsvp && !pendingRequests.includes(ev.id) && <button className="btn-glow" style={{flex:1}} onClick={() => { const np = [...pendingRequests, ev.id]; setPendingRequests(np); syncToSupabase({pending_requests_data:np}); toast("Request sent! The host will review it.", "info"); }}>🔒 Request</button>}
              {!going && !ev.luma?.includes("luma") && ev.rsvp && pendingRequests.includes(ev.id) && <button className="btn-outline" style={{flex:1,opacity:.6,cursor:"not-allowed",pointerEvents:"none"}}>Requested — Awaiting Approval</button>}
              {!going && ev.luma?.includes("luma") && <>
                <button className="btn-glow" type="button" style={{flex:1,cursor:"pointer"}} onClick={() => {
                  // Find the working card button and click it, or create one at body level
                  const existing = document.querySelector(`.luma-checkout--button[data-luma-event-id="${ev.lumaEventId}"]`);
                  if (existing && existing !== document.activeElement) { existing.click(); return; }
                  // Fallback: open Luma in new tab
                  window.open(ev.luma, "_blank");
                }}>Register on Luma</button>
                <button className="btn-outline" style={{flex:1}} onClick={() => {
                  togRsvp(ev.id);
                  toast("Marked as going!", "info");
                }}>✓ I've registered</button>
              </>}
              {going && !verified && <button className="btn-outline" style={{flex:1}} onClick={() => togRsvp(ev.id)}>Leave</button>}
              {ev.luma && !ev.luma.includes("luma") && <a href={ev.luma} target="_blank" rel="noopener noreferrer" className="btn-outline" style={{flex:1,textDecoration:"none",textAlign:"center"}}>RSVP ↗</a>}
            </div>
            {mine && <button className="btn-sm" style={{width:"100%",padding:"12px",borderRadius:14,fontSize:13}} onClick={() => { setSel(null); setShowHostCode(ev); }}>🔑 Host Dashboard — Show Check-in Code</button>}
          </div>
        </div>
      </div>
    </>);
  };

  // ── Quests View ──
  const renderQuests = () => {
    const lb = leaderboard.length > 0 ? leaderboard : (user ? [{name:user.name,xp:totalXP,handle:user.handle,pfp:user.pfp}] : []);
    const myRank = user ? lb.findIndex(l => l.handle === user.handle) + 1 : null;
    const progress = nextLvl ? Math.min(100,((totalXP-level.xp)/(nextLvl.xp-level.xp))*100) : 100;

    return (
      <div className="anim-in">
        <div className="xp-hero"><div className="xp-hero-bg"/><div style={{position:"relative",zIndex:1}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14}}>
            <div><p className="xp-ll">Level</p><h2 className="xp-ln">{level.n}</h2></div>
            <div className="xp-badge">{totalXP} XP</div>
          </div>
          {nextLvl && <div style={{marginBottom:8}}>
            <div className="xp-bar-bg"><div className="xp-bar-fill" style={{width:`${progress}%`}}/></div>
            <div style={{display:"flex",justifyContent:"space-between",fontSize:10,color:"rgba(255,255,255,.45)",fontFamily:"var(--fm)",marginTop:4}}>
              <span>{level.n}</span>
              <span>{Math.round(progress)}%</span>
              <span>{nextLvl.n} ({nextLvl.xp})</span>
            </div>
          </div>}
          <div style={{display:"flex",gap:16,marginTop:4}}>
            {myRank && <div style={{fontSize:11,color:"rgba(255,255,255,.5)"}}><span style={{fontFamily:"var(--fm)",fontWeight:700,color:"rgba(255,255,255,.7)"}}>#{myRank}</span> on leaderboard</div>}
            <div style={{fontSize:11,color:"rgba(255,255,255,.5)"}}><span style={{fontFamily:"var(--fm)",fontWeight:700,color:"rgba(255,255,255,.7)"}}>{completedQuests.length}/{QUESTS.length}</span> quests</div>
          </div>
        </div></div>

        <p className="section-label" style={{marginTop:20}}>Side Quests</p>
        <div style={{display:"flex",flexDirection:"column",gap:9}}>
          {QUESTS.map((q,qi) => {
            const done = completedQuests.includes(q.id);
            return (
              <div key={q.id} className={`quest-card ${done ? "done" : ""}`} style={{animation:`cardIn .45s cubic-bezier(.16,1,.3,1) ${qi*0.04}s both`}}>
                <div className="quest-icon">{q.icon}</div>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:8}}>
                    <p className="quest-title">{q.title}</p>
                    <span className={`quest-xp ${done ? "done" : ""}`}>+{q.xp}</span>
                  </div>
                  <p className="quest-desc">{q.desc}</p>
                </div>
                {done && <div className="quest-check">✓</div>}
              </div>
            );
          })}
        </div>

        <p className="section-label" style={{marginTop:24}}>Leaderboard</p>
        <div className="lb-card">
          {lb.slice(0,8).map((l,i) => {
            const isMe = user && l.handle === user.handle;
            return (
              <div key={l.handle+i} className={`lb-row ${isMe ? "me" : ""}`}>
                <span className="lb-rank">{i===0?"🥇":i===1?"🥈":i===2?"🥉":`#${i+1}`}</span>
                <Avatar name={l.name} s={26} bg={uc(l.handle)} pfp={l.pfp}/>
                <div style={{flex:1,minWidth:0}}><p className="lb-name">{l.name}{isMe ? " (you)" : ""}</p><p style={{fontSize:10,color:"var(--muted)",marginTop:1}}>{l.evts||0} event{(l.evts||0)!==1?"s":""} · {l.quests||0} quest{(l.quests||0)!==1?"s":""}</p></div>
                <div className="lb-xp"><span className="lb-lvl">{getLevel(l.xp).n}</span>{l.xp} XP</div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  // ── Pulse View ──
  // ── Calendar View ──
  const renderCalendar = () => {
    const y = calMonth.getFullYear(), m = calMonth.getMonth();
    const firstDay = new Date(y, m, 1).getDay();
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const monthName = calMonth.toLocaleDateString("en-US", { month: "long", year: "numeric" });
    const today = new Date();
    const cells = [];
    for (let i = 0; i < firstDay; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(d);

    const evsByDate = {};
    cevs.forEach(ev => {
      const dp = ev.date;
      if (!evsByDate[dp]) evsByDate[dp] = [];
      evsByDate[dp].push(ev);
    });

    const pad = (n) => String(n).padStart(2, "0");
    const getDateStr = (day) => `${y}-${pad(m + 1)}-${pad(day)}`;

    return (
      <div style={{marginTop:8}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
          <button className="ib" onClick={() => setCalMonth(new Date(y, m - 1, 1))} style={{fontSize:18}}>‹</button>
          <h3 style={{fontSize:17,fontWeight:800,fontFamily:"var(--fd)",letterSpacing:"-.2px"}}>{monthName}</h3>
          <button className="ib" onClick={() => setCalMonth(new Date(y, m + 1, 1))} style={{fontSize:18}}>›</button>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:2,textAlign:"center",marginBottom:8}}>
          {["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map(d => (
            <div key={d} style={{fontSize:10,fontWeight:700,color:"var(--muted)",fontFamily:"var(--fm)",padding:"4px 0",letterSpacing:".5px"}}>{d}</div>
          ))}
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:3}}>
          {cells.map((day, idx) => {
            if (!day) return <div key={`e${idx}`}/>;
            const ds = getDateStr(day);
            const dayEvs = evsByDate[ds] || [];
            const isToday = today.getFullYear() === y && today.getMonth() === m && today.getDate() === day;
            const hasEvs = dayEvs.length > 0;
            const isSelected = dateF === ds;

            return (
              <div key={idx}
                onClick={() => { if (hasEvs) { setDateF(isSelected ? "All" : ds); setLayout("timeline"); } }}
                style={{
                  aspectRatio:"1",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",
                  borderRadius:14,cursor:hasEvs?"pointer":"default",position:"relative",
                  background:isSelected?"var(--dark)":isToday?"rgba(153,69,255,.08)":"transparent",
                  border:isToday&&!isSelected?"1.5px solid var(--accent)":"1.5px solid transparent",
                  transition:"all .2s cubic-bezier(.16,1,.3,1)",
                }}>
                <span style={{fontSize:14,fontWeight:isToday||hasEvs?700:500,color:isSelected?"white":hasEvs?"var(--heading)":"var(--muted)",fontFamily:"var(--fm)",lineHeight:1}}>{day}</span>
                {hasEvs && (
                  <div style={{display:"flex",gap:2,marginTop:3,position:"absolute",bottom:4}}>
                    {dayEvs.slice(0, 4).map((ev, j) => {
                      const c = CATS[ev.cat] || CATS.Other;
                      return <div key={j} style={{width:5,height:5,borderRadius:"50%",background:isSelected?"rgba(255,255,255,.6)":c.ac,boxShadow:isSelected?`0 0 4px rgba(255,255,255,.3)`:`0 0 4px ${c.ac}40`}}/>;
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {dateF !== "All" && evsByDate[dateF] && (
          <div style={{marginTop:16}}>
            <p className="section-label">{dl(dateF)} · {evsByDate[dateF].length} event{evsByDate[dateF].length !== 1 ? "s" : ""}</p>
            <div style={{display:"flex",flexDirection:"column",gap:10}}>
              {evsByDate[dateF].map((ev, i) => renderCard(ev, i, true))}
            </div>
          </div>
        )}
        {dateF === "All" && (
          <p style={{textAlign:"center",color:"var(--muted)",fontSize:13,marginTop:20,lineHeight:1.5}}>Tap a date with events to see what's happening</p>
        )}
      </div>
    );
  };

  const renderPulse = () => {
    const trending = [...cevs].sort((a,b) => getAtt(b.id) - getAtt(a.id)).slice(0,5);
    const allActivity = globalActivity.filter(a => events.find(e => e.id === a.e));
    return (
      <div className="anim-in">
        <h1 className="vt" style={{marginTop:18}}>Activity</h1>
        <p className="vs">Real-time conference activity</p>
        <PulseTicker activity={allActivity} events={events}/>

        {/* Your Stats */}
        {user && <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,margin:"16px 0"}}>
          <div className="stat-box"><p className="stat-num" style={{color:"var(--accent)"}}>{rsvps.length}</p><p className="stat-label">Events</p></div>
          <div className="stat-box"><p className="stat-num" style={{color:"var(--accent2)"}}>{checkins.length}</p><p className="stat-label">Check-ins</p></div>
          <div className="stat-box"><p className="stat-num">{completedQuests.length}<span style={{fontSize:12,color:"var(--muted)"}}>/11</span></p><p className="stat-label">Quests</p></div>
        </div>}

        {/* Activity Feed + Trending side by side on desktop, stacked on mobile */}
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr))",gap:16,marginTop:14}}>
          {/* Activity Feed — primary content */}
          <div>
            <p className="section-label">Activity Feed</p>
            {allActivity.length === 0 ? (
              <div className="empty-msg" style={{padding:"32px 20px"}}>⚡<br/><br/><strong>No activity yet</strong><br/>Join events and add friends to see what's happening</div>
            ) : (
              <div style={{display:"flex",flexDirection:"column",gap:8}}>
                {allActivity.slice(0,15).map((p,i) => (
                  <div key={i} className="act-row" style={{animation:`cardIn .4s cubic-bezier(.16,1,.3,1) ${i*0.06}s both`,borderLeft:`3px solid ${p.a==="created"?"var(--accent)":p.a.includes("RSVP")?"#14F195":"var(--border)"}`}}>
                    <Avatar name={p.u} s={30} bg={uc(p.u)} pfp={p.pfp}/>
                    <div style={{flex:1,minWidth:0}}>
                      <p style={{fontSize:13,lineHeight:1.4}}><strong style={{fontFamily:"var(--fd)"}}>{p.u}</strong> {p.a} <em style={{color:"var(--accent)",fontStyle:"normal",fontWeight:700}}>{p.e ? events.find(e=>e.id===p.e)?.title : p.q}</em></p>
                      <span style={{fontSize:10,color:"var(--muted)",fontFamily:"var(--fm)"}}>{timeAgo(p.ts)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Trending — secondary, sidebar on desktop */}
          {trending.length > 0 && <div>
            <p className="section-label">Trending</p>
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              {trending.map((ev,i) => {
                const cat = CATS[ev.cat] || CATS.Other;
                const fg = fGoing(ev.id);
                return (
                  <div key={ev.id} className="ev-card" style={{background:cbg(cat),borderLeft:`4px solid ${cat.ac}`,cursor:"pointer",padding:"14px 16px",animation:`cardIn .5s cubic-bezier(.16,1,.3,1) ${i*0.08}s both`}} onClick={() => setSel(ev)}>
                    <div style={{display:"flex",alignItems:"center",gap:10}}>
                      <span className="trend-num" style={{fontSize:18}}>#{i+1}</span>
                      <div style={{flex:1,minWidth:0}}>
                        <h4 style={{fontSize:14,fontWeight:700,fontFamily:"var(--fd)",letterSpacing:"-.1px",color:"var(--heading)"}}>{ev.title}</h4>
                        <span className="card-m">{fd(ev.date)} · {ev.host}</span>
                        {fg.length > 0 && <span style={{fontSize:10,color:"var(--accent)",fontWeight:600,display:"block",marginTop:2}}>👥 {fg.map(f=>f.name.split(" ")[0]).join(", ")}</span>}
                      </div>
                      <div style={{textAlign:"right"}}>
                        <span style={{fontSize:16,fontWeight:800,fontFamily:"var(--fm)",color:"var(--heading)"}}>{getAtt(ev.id)}</span>
                        <span style={{fontSize:8,color:"var(--muted)",fontFamily:"var(--fm)",display:"block"}}>going</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>}
        </div>
      </div>
    );
  };

  // ── Friends View ──
  const renderFriends = () => {
    // Smart suggestions: people at events you're going to
    // Suggestions are now based on real Supabase data only
    const suggestedByOverlap = [];
    const otherSuggested = [];

    // Overlap: my RSVPs matched with friends
    const overlapData = rsvps
      .map(eid => { const ev = events.find(e => e.id === eid && e.conf === conf); const fr = fGoing(eid); return {ev, friends: fr}; })
      .filter(d => d.ev && d.friends.length > 0)
      .sort((a,b) => (a.ev.date||"").localeCompare(b.ev.date||""));

    // VIP friends with their next event
    const vipFriends = friends.filter(f => vips.includes(f.handle)).map(f => {
      const realData = friendRsvpMap[f.handle];
      const rsvpList = realData?.rsvps || [];
      const theirEvs = rsvpList.map(eid => events.find(e => e.id === eid && e.conf === conf)).filter(Boolean).sort((a,b) => a.date.localeCompare(b.date));
      return {...f, nextEv: theirEvs[0] || null, evCount: theirEvs.length};
    });

    // Notable people — from real Supabase profiles (coming soon)
    const notableList = [];

    return (
      <div className="anim-in">
        <h1 className="vt" style={{marginTop:18}}>👥 Network</h1>
        <p className="vs">Find the people you want to meet</p>

        <div className="tab-bar" style={{marginBottom:16}}>
          {[{id:"people",l:"👥 People"},{id:"overlap",l:"📍 Overlap"}].map(t => (
            <button key={t.id} className={`tab ${friendsTab===t.id?"on":""}`} onClick={() => setFriendsTab(t.id)}>{t.l}</button>
          ))}
        </div>

        {/* ═══ PEOPLE TAB ═══ */}
        {friendsTab === "people" && <>
          <div className="sbar" style={{marginBottom:16}}>
            <span style={{color:"var(--muted)",fontFamily:"var(--fm)",fontSize:14}}>@</span>
            <input placeholder="Add friend by handle..." value={addFQ} onChange={e => setAddFQ(e.target.value)}
              onKeyDown={e => { if(e.key==="Enter"&&addFQ) { addFriend(addFQ); setAddFQ(""); } }}/>
            {addFQ && <button className="btn-sm" onClick={() => { addFriend(addFQ); setAddFQ(""); }} style={{padding:"8px 18px",flexShrink:0}}>Add</button>}
          </div>

          {/* Incoming Friend Requests */}
          {friendRequests.length > 0 && <>
            <div style={{padding:"12px 16px",background:"linear-gradient(135deg,rgba(153,69,255,.06),rgba(20,241,149,.04))",borderRadius:16,border:"1.5px solid rgba(153,69,255,.15)",marginBottom:16}}>
              <p className="section-label" style={{marginBottom:10}}>Friend Requests · {friendRequests.length}</p>
              <div style={{display:"flex",flexDirection:"column",gap:8}}>
                {friendRequests.map((req,i) => {
                  const alreadyFriend = friendHandles.map(h=>h.toLowerCase()).includes(req.handle?.toLowerCase());
                  const clearRequest = () => {
                    const supaUrl = import.meta.env.VITE_SUPABASE_URL;
                    const supaKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
                    let token = supaKey;
                    try { const sk = `sb-${new URL(supaUrl).hostname.split('.')[0]}-auth-token`; const st = JSON.parse(localStorage.getItem(sk)||"{}"); if(st?.access_token) token=st.access_token; } catch(e){}
                    // Clear via RPC
                    fetch(`${supaUrl}/rest/v1/rpc/clear_friend_request`, {
                      method:"POST",
                      headers:{"Content-Type":"application/json","apikey":supaKey,"Authorization":`Bearer ${token}`},
                      body:JSON.stringify({requester_handle:req.handle,my_handle:user?.handle})
                    }).catch(()=>{});
                    // Also immediately write cleared list to profile (don't wait for debounced sync)
                    const updated = friendRequests.filter(r => r.handle !== req.handle);
                    setFriendRequests(updated);
                    if (user?.supaId) {
                      fetch(`${supaUrl}/rest/v1/profiles?id=eq.${user.supaId}`, {
                        method:"PATCH",
                        headers:{"Content-Type":"application/json","apikey":supaKey,"Authorization":`Bearer ${token}`,"Prefer":"return=minimal"},
                        body:JSON.stringify({friend_requests_data:updated})
                      }).catch(()=>{});
                    }
                  };
                  return (
                  <div key={req.handle} className="friend-row" style={{animation:`cardIn .4s cubic-bezier(.16,1,.3,1) ${i*0.06}s both`,border:`1.5px solid ${alreadyFriend?"rgba(20,241,149,.2)":"rgba(153,69,255,.12)"}`}}>
                    <Avatar name={req.name} s={36} bg={uc(req.handle)} pfp={req.pfp}/>
                    <div style={{flex:1}}>
                      <p style={{fontSize:14,fontWeight:700,fontFamily:"var(--fd)"}}>{req.name}</p>
                      <p style={{fontSize:12,color:"var(--muted)"}}>{req.handle} added you{alreadyFriend ? " back" : ""}</p>
                    </div>
                    {alreadyFriend ? (
                      <button className="btn-sm" style={{background:"rgba(20,241,149,.1)",color:"#0A8F5A",border:"1px solid rgba(20,241,149,.2)",padding:"6px 14px",fontSize:11}} onClick={() => { clearRequest(); toast(`You and ${req.name} are now mutual friends!`); }}>✓ Confirm</button>
                    ) : (<>
                      <button className="btn-sm" style={{background:"linear-gradient(135deg,#9945FF,#14F195)",border:"none",padding:"6px 14px",fontSize:11}} onClick={() => { addFriend(req.handle); clearRequest(); }}>+ Add Back</button>
                      <button className="ib-sm" style={{color:"var(--muted)"}} onClick={() => { clearRequest(); toast("Dismissed"); }}>✕</button>
                    </>)}
                  </div>
                  );
                })}
              </div>
            </div>
          </>}

          {/* VIP / Must Meet Section */}
          {vipFriends.length > 0 && <>
            <p className="section-label">⭐ Must meet · {vipFriends.length}</p>
            <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:20}}>
              {vipFriends.map((fr,i) => {
                const cat = fr.nextEv ? (CATS[fr.nextEv.cat]||CATS.Other) : null;
                return (
                  <div key={fr.handle} className="friend-row vip-row" onClick={() => setFriendView(fr)} style={{animation:`cardIn .4s cubic-bezier(.16,1,.3,1) ${i*0.06}s both`}}>
                    <Avatar name={fr.name} s={42} bg={uc(fr.handle)} pfp={fr.pfp}/>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{display:"flex",alignItems:"center",gap:5}}>
                        <p style={{fontSize:15,fontWeight:700,fontFamily:"var(--fd)"}}>{fr.name}</p>
                        <span style={{fontSize:10,color:"#F9AB00"}}>⭐</span>
                      </div>
                      {fr.role && <p style={{fontSize:11,color:"var(--muted)",marginTop:1}}>{fr.role}</p>}
                      {fr.nextEv && <div style={{marginTop:5,padding:"5px 10px",background:cat?cbg(cat):"var(--bg)",borderRadius:10,borderLeft:`3px solid ${cat?cat.ac:"var(--accent)"}`,display:"inline-flex",alignItems:"center",gap:5,fontSize:11,fontWeight:600}}>
                        <span>{cat?.em}</span> {fr.nextEv.title} · {fd(fr.nextEv.date)}
                      </div>}
                    </div>
                    <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
                      <span style={{fontSize:16,fontWeight:800,fontFamily:"var(--fm)",color:"var(--accent)"}}>{fr.evCount}</span>
                      <span style={{fontSize:9,color:"var(--muted)"}}>events</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </>}

          {/* All Friends */}
          {friends.length > 0 && <>
            <p className="section-label">Your friends · {friends.length}</p>
            <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:20}}>
              {friends.map((fr,i) => {
                const realData = friendRsvpMap[fr.handle];
                const frRsvpList = realData?.rsvps || [];
                const frE = events.filter(e => frRsvpList.includes(e.id));
                const isVip = vips.includes(fr.handle);
                return (
                  <div key={fr.handle} className="friend-row" onClick={() => setFriendView(fr)} style={{animation:`cardIn .4s cubic-bezier(.16,1,.3,1) ${i*0.06}s both`}}>
                    <Avatar name={fr.name} s={38} bg={uc(fr.handle)} pfp={fr.pfp}/>
                    <div style={{flex:1}}>
                      <p style={{fontSize:14,fontWeight:700,fontFamily:"var(--fd)"}}>{fr.name}{fr.pending && <span style={{fontSize:9,marginLeft:6,color:"var(--muted)",background:"var(--surface2)",padding:"2px 7px",borderRadius:100,fontWeight:600,fontFamily:"var(--fm)"}}>pending</span>}</p>
                      <p style={{fontSize:12,color:"var(--muted)",marginTop:1}}>{fr.pending ? `${fr.handle} — will link when they join` : <>{fr.role && <span style={{color:"var(--text)",fontWeight:500}}>{fr.role} · </span>}{fr.handle} · </>}{!fr.pending && <span style={{color:"var(--accent)",fontWeight:600}}>{frE.length} event{frE.length!==1?"s":""}</span>}</p>
                    </div>
                    <div style={{display:"flex",gap:4}}>
                      <button className="ib-sm" onClick={e => { e.stopPropagation(); togVip(fr.handle); }} style={{color:isVip?"#F9AB00":"var(--muted)",fontSize:14}} title="Must meet">{isVip ? "⭐" : "☆"}</button>
                      <button className="ib-sm" onClick={e => { e.stopPropagation(); removeFriend(fr); }} style={{color:"var(--muted)",fontSize:12}}>✕</button>
                    </div>
                  </div>
                );
              })}
            </div>
          </>}

          {/* Smart Suggestions */}
          {suggestedByOverlap.length > 0 && <>
            <p className="section-label">At your events</p>
            <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:20}}>
              {suggestedByOverlap.map((u,i) => (
                <div key={u.handle} className="friend-row" style={{animation:`cardIn .4s cubic-bezier(.16,1,.3,1) ${i*0.06}s both`,border:"1.5px dashed rgba(153,69,255,.2)"}}>
                  <Avatar name={u.name} s={34} bg={uc(u.handle)}/>
                  <div style={{flex:1}}>
                    <p style={{fontSize:14,fontWeight:600,fontFamily:"var(--fd)"}}>{u.name}{u.notable&&<span style={{fontSize:10,marginLeft:4,color:"#F9AB00"}}>⭐</span>}</p>
                    <p style={{fontSize:12,color:"var(--muted)"}}>{u.role || u.handle}</p>
                    <p style={{fontSize:11,color:"var(--accent)",fontWeight:600,marginTop:2}}>{u.shared} mutual event{u.shared!==1?"s":""}</p>
                  </div>
                  <button className="btn-sm" onClick={() => addFriend(u.handle)} style={{background:"linear-gradient(135deg,#9945FF,#14F195)",border:"none",padding:"7px 16px"}}>+ Add</button>
                </div>
              ))}
            </div>
          </>}

          {/* Other Suggestions */}
          {otherSuggested.length > 0 && <>
            <p className="section-label">People you may know</p>
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              {otherSuggested.slice(0,5).map((u,i) => (
                <div key={u.handle} className="friend-row" style={{animation:`cardIn .4s cubic-bezier(.16,1,.3,1) ${i*0.06}s both`,border:"1px dashed var(--border)"}}>
                  <Avatar name={u.name} s={34} bg={uc(u.handle)}/>
                  <div style={{flex:1}}>
                    <p style={{fontSize:14,fontWeight:600,fontFamily:"var(--fd)"}}>{u.name}{u.notable&&<span style={{fontSize:10,marginLeft:4,color:"#F9AB00"}}>⭐</span>}</p>
                    <p style={{fontSize:12,color:"var(--muted)"}}>{u.role || u.handle}</p>
                  </div>
                  <button className="btn-sm" onClick={() => addFriend(u.handle)} style={{background:"linear-gradient(135deg,#9945FF,#14F195)",border:"none",padding:"7px 16px"}}>+ Add</button>
                </div>
              ))}
            </div>
          </>}

          {friends.length === 0 && suggestedByOverlap.length === 0 && <div className="empty-msg"><div style={{fontSize:40,marginBottom:8}}>👥</div><strong style={{fontSize:17}}>No friends yet</strong><p style={{marginTop:6,marginBottom:16}}>Add friends by their X handle to see which events they're attending</p><button className="btn-sm" onClick={() => document.querySelector('.sbar input')?.focus()} style={{background:"linear-gradient(135deg,#9945FF,#14F195)",border:"none",padding:"10px 24px"}}>Add a friend</button></div>}
        </>}

        {/* ═══ OVERLAP TAB ═══ */}
        {friendsTab === "overlap" && (() => {
          // All events where ANY friend is going (regardless of user RSVP)
          const friendEvents = cevs.filter(ev => fGoing(ev.id).length > 0).sort((a,b) => a.date.localeCompare(b.date));
          const myOverlap = friendEvents.filter(ev => rsvps.includes(ev.id));
          const friendOnly = friendEvents.filter(ev => !rsvps.includes(ev.id));

          const renderOverlapCard = (ev, i) => {
            const cat = CATS[ev.cat] || CATS.Other;
            const evFr = fGoing(ev.id);
            const isGoing = rsvps.includes(ev.id);
            return (
              <div key={ev.id} style={{marginBottom:14,animation:`cardIn .4s cubic-bezier(.16,1,.3,1) ${i*0.06}s both`}}>
                <div className="ev-card" style={{background:cbg(cat),borderLeft:`4px solid ${cat.ac}`}} onClick={() => setSel(ev)}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                    <div style={{flex:1}}>
                      <div style={{display:"flex",gap:5,marginBottom:3}}>
                        <span className="pill" style={{background:`${cfg(cat)}14`,color:cfg(cat),fontSize:10}}>{cat.em} {ev.cat}</span>
                        {isGoing && <span className="pill going-pill" style={{fontSize:10}}>Going</span>}
                      </div>
                      <h4 className="card-t-sm">{ev.title}</h4>
                      <span className="card-m">{fd(ev.date)} · {ev.time}</span>
                    </div>
                    {!isGoing && user && <button className="qrsvp" onClick={e => { e.stopPropagation(); togRsvp(ev.id); }} style={{alignSelf:"center"}}>Join</button>}
                  </div>
                  <div style={{display:"flex",gap:6,flexWrap:"wrap",marginTop:10}}>
                    {evFr.map(fr => (
                      <div key={fr.handle} className={`friend-chip ${vips.includes(fr.handle)?"vip":""}`} onClick={e => { e.stopPropagation(); setFriendView(fr); }} style={{fontSize:12}}>
                        {vips.includes(fr.handle)&&<span style={{fontSize:9}}>⭐</span>}
                        <Avatar name={fr.name} s={18} bg={uc(fr.handle)} pfp={fr.pfp}/>
                        <span>{fr.name.split(" ")[0]}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            );
          };

          return friends.length === 0 ? (
            <div className="empty-msg">👥<br/><br/><strong>Add friends first</strong><br/>Go to the People tab to add friends, then see where they'll be</div>
          ) : friendEvents.length === 0 ? (
            <div className="empty-msg">📍<br/><br/><strong>No friend activity yet</strong><br/>Your friends haven't RSVP'd to any events</div>
          ) : <>
            {myOverlap.length > 0 && <>
              <p className="section-label">📍 You + friends · {myOverlap.length} event{myOverlap.length!==1?"s":""}</p>
              {myOverlap.map((ev, i) => renderOverlapCard(ev, i))}
            </>}
            {friendOnly.length > 0 && <>
              <p className="section-label" style={{marginTop:myOverlap.length?20:0}}>👀 Where friends are going · {friendOnly.length}</p>
              <p style={{fontSize:12,color:"var(--muted)",marginBottom:12,lineHeight:1.5}}>Events your friends are attending — RSVP to join them</p>
              {friendOnly.map((ev, i) => renderOverlapCard(ev, i))}
            </>}
          </>;
        })()}

        {/* ═══ NOTABLE TAB ═══ */}
        {friendsTab === "notable" && <>
          <p style={{fontSize:13.5,color:"var(--muted)",marginBottom:14,lineHeight:1.5}}>Solana ecosystem people attending {cd?.short}. Add them to track their events.</p>
          <div className="scr" style={{marginBottom:16}}>
            {NOTABLE_TAGS.map(t => <button key={t} className={`tag ${notableFilter===t?"on":""}`} style={{padding:"5px 12px",fontSize:11.5}} onClick={() => setNotableFilter(t)}>{t}</button>)}
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            {notableList.map((u,i) => {
              const isFriend = friendHandles.includes(u.handle);
              const isVip = vips.includes(u.handle);
              const theirEvs = (friendRsvpMap[u.handle]?.rsvps || []).filter(eid => events.find(e => e.id === eid && e.conf === conf));
              return (
                <div key={u.handle} className="friend-row" onClick={() => setFriendView(u)} style={{animation:`cardIn .4s cubic-bezier(.16,1,.3,1) ${i*0.06}s both`}}>
                  <Avatar name={u.name} s={40} bg={uc(u.handle)}/>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{display:"flex",alignItems:"center",gap:5}}>
                      <p style={{fontSize:14,fontWeight:700,fontFamily:"var(--fd)"}}>{u.name}</p>
                      {u.notable && <span style={{fontSize:9,background:"linear-gradient(135deg,rgba(153,69,255,.1),rgba(20,241,149,.08))",color:"var(--accent)",padding:"2px 7px",borderRadius:100,fontWeight:700,border:"1px solid rgba(153,69,255,.12)"}}>Notable</span>}
                    </div>
                    <p style={{fontSize:12,color:"var(--muted)",marginTop:1}}>{u.role}</p>
                    <p style={{fontSize:11,color:"var(--accent)",fontWeight:600,marginTop:2}}>{theirEvs.length} event{theirEvs.length!==1?"s":""} at {cd?.short}</p>
                  </div>
                  <div style={{display:"flex",gap:4}}>
                    {isFriend && <button className="ib-sm" onClick={e => { e.stopPropagation(); togVip(u.handle); }} style={{color:isVip?"#F9AB00":"var(--muted)",fontSize:14}} title="Must meet">{isVip ? "⭐" : "☆"}</button>}
                    {!isFriend && <button className="btn-sm" onClick={e => { e.stopPropagation(); addFriend(u.handle); }} style={{background:"linear-gradient(135deg,#9945FF,#14F195)",border:"none",padding:"7px 14px",fontSize:11}}>+ Add</button>}
                  </div>
                </div>
              );
            })}
          </div>
        </>}
      </div>
    );
  };

  // ── Friend Profile ──
  const [friendProfileData, setFriendProfileData] = useState(null);
  const [eventAttendees, setEventAttendees] = useState([]);
  const [eventPendingUsers, setEventPendingUsers] = useState([]);
  const [globalActivity, setGlobalActivity] = useState([]);
  const [leaderboard, setLeaderboard] = useState([]);

  // Fetch leaderboard from all profiles
  useEffect(() => {
    if (!hasSupabase()) return;
    (async () => {
      try {
        const supaUrl = import.meta.env.VITE_SUPABASE_URL;
        const supaKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
        let token = supaKey;
        try { const sk = `sb-${new URL(supaUrl).hostname.split('.')[0]}-auth-token`; const st = JSON.parse(localStorage.getItem(sk)||"{}"); if(st?.access_token) token=st.access_token; } catch(e){}
        const res = await fetch(`${supaUrl}/rest/v1/profiles?select=name,handle,pfp,rsvps_data,checkins_data`, {
          headers: {"apikey":supaKey,"Authorization":`Bearer ${token}`}
        });
        if (res.ok) {
          const profiles = await res.json();
          const board = profiles.map(p => {
            const ci = p.checkins_data || [];
            const rv = p.rsvps_data || [];
            let cc = 0; const done = [];
            for (const q of QUESTS) {
              if (q.id === "q10") { if (q.check(ci, events, cc, rv)) done.push(q.id); }
              else { if (q.check(ci, events, cc, rv)) { done.push(q.id); cc++; } }
            }
            const xp = QUESTS.filter(q => done.includes(q.id)).reduce((s,q) => s + q.xp, 0);
            return { name: p.name, handle: p.handle, pfp: p.pfp, xp, evts: rv.length, quests: done.length };
          }).filter(p => p.xp > 0).sort((a,b) => b.xp - a.xp);
          setLeaderboard(board);
        }
      } catch(e) {}
    })();
  }, [events]);
  const [attendeeCounts, setAttendeeCounts] = useState({}); // {eventId: count}

  // Fetch real attendee counts from all profiles
  const refreshAttendeeCounts = useCallback(() => {
    if (!hasSupabase()) return;
    const supaUrl = import.meta.env.VITE_SUPABASE_URL;
    const supaKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
    let token = supaKey;
    try { const sk = `sb-${new URL(supaUrl).hostname.split('.')[0]}-auth-token`; const st = JSON.parse(localStorage.getItem(sk)||"{}"); if(st?.access_token) token=st.access_token; } catch(e){}
    fetch(`${supaUrl}/rest/v1/profiles?select=rsvps_data`, {
      headers: {"apikey":supaKey,"Authorization":`Bearer ${token}`}
    }).then(r=>r.json()).then(profiles => {
      const counts = {};
      (profiles||[]).forEach(p => {
        (p.rsvps_data||[]).forEach(eid => { counts[eid] = (counts[eid]||0) + 1; });
      });
      setAttendeeCounts(counts);
    }).catch(()=>{});
  }, []);

  // Fetch activity from all users
  useEffect(() => {
    if (!hasSupabase()) return;
    (async () => {
      try {
        const supaUrl = import.meta.env.VITE_SUPABASE_URL;
        const supaKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
        let token = supaKey;
        try {
          const storageKey = `sb-${new URL(supaUrl).hostname.split('.')[0]}-auth-token`;
          const stored = JSON.parse(localStorage.getItem(storageKey) || "{}");
          if (stored?.access_token) token = stored.access_token;
        } catch(e) {}
        // Fetch events with creators for activity feed (accurate timestamps)
        const evRes = await fetch(`${supaUrl}/rest/v1/events?select=id,title,created_at,created_by,att,profiles(name,handle,pfp)&created_by=not.is.null&order=created_at.desc&limit=50`, {
          headers: { "apikey": supaKey, "Authorization": `Bearer ${token}` },
        });
        // Fetch all profiles for RSVP activity
        const profRes = await fetch(`${supaUrl}/rest/v1/profiles?select=name,handle,pfp,rsvps_data`, {
          headers: { "apikey": supaKey, "Authorization": `Bearer ${token}` },
        });
        const feed = [];
        if (evRes.ok) {
          const evRows = await evRes.json();
          evRows.forEach(ev => {
            if (ev.profiles) {
              feed.push({ u: ev.profiles.name, a: "created", e: ev.id, pfp: ev.profiles.pfp, handle: ev.profiles.handle, ts: ev.created_at });
            }
            // Build RSVP activity from profiles that have this event in rsvps_data
            // Use event's created_at as approximate time (RSVPs happen after creation)
          });
          // Add RSVP activity — use event created_at + small offset per profile
          if (profRes.ok) {
            const profiles = await profRes.json();
            profiles.forEach(p => {
              (p.rsvps_data || []).forEach(eid => {
                const ev = evRows.find(e => e.id === eid);
                if (ev) {
                  // Use event creation time + 1min offset so RSVPs appear after "created"
                  const rsvpTs = new Date(new Date(ev.created_at).getTime() + 60000).toISOString();
                  feed.push({ u: p.name, a: "RSVP'd to", e: eid, pfp: p.pfp, handle: p.handle, ts: rsvpTs });
                }
              });
            });
          }
        }
        feed.sort((a, b) => new Date(b.ts || 0) - new Date(a.ts || 0));
        setGlobalActivity(feed);
      } catch(e) {}
    })();
  }, [events]);

  // Fetch all attendees for selected event (when host views it)
  useEffect(() => {
    if (!sel || !hasSupabase()) { setEventAttendees([]); return; }
    (async () => {
      try {
        const supaUrl = import.meta.env.VITE_SUPABASE_URL;
        const supaKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
        let token = supaKey;
        try {
          const storageKey = `sb-${new URL(supaUrl).hostname.split('.')[0]}-auth-token`;
          const stored = JSON.parse(localStorage.getItem(storageKey) || "{}");
          if (stored?.access_token) token = stored.access_token;
        } catch(e) {}
        const eid = sel.id;
        const res = await fetch(`${supaUrl}/rest/v1/profiles?rsvps_data=cs.[${eid}]&select=name,handle,pfp,role`, {
          headers: { "apikey": supaKey, "Authorization": `Bearer ${token}` },
        });
        if (res.ok) {
          const rows = await res.json();
          setEventAttendees(rows || []);
        }
        // Also fetch users who have pending requests for this event
        const pendRes = await fetch(`${supaUrl}/rest/v1/profiles?pending_requests_data=cs.[${eid}]&select=name,handle,pfp,role`, {
          headers: { "apikey": supaKey, "Authorization": `Bearer ${token}` },
        });
        if (pendRes.ok) {
          const pendRows = await pendRes.json();
          setEventPendingUsers(pendRows || []);
        }
      } catch(e) { setEventAttendees([]); setEventPendingUsers([]); }
    })();
  }, [sel]);
  const [friendRsvpMap, setFriendRsvpMap] = useState({});
  // Fetch all friends' RSVP data in bulk
  useEffect(() => {
    if (!hasSupabase() || friends.length === 0) return;
    const realFriends = friends.filter(f => !friendRsvpMap[f.handle]);
    if (realFriends.length === 0) return;
    (async () => {
      try {
        const supaUrl = import.meta.env.VITE_SUPABASE_URL;
        const supaKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
        let token = supaKey;
        try {
          const storageKey = `sb-${new URL(supaUrl).hostname.split('.')[0]}-auth-token`;
          const stored = JSON.parse(localStorage.getItem(storageKey) || "{}");
          if (stored?.access_token) token = stored.access_token;
        } catch(e) {}
        const handles = realFriends.map(f => encodeURIComponent(f.handle)).join(",");
        const res = await fetch(`${supaUrl}/rest/v1/profiles?handle=in.(${handles})&select=handle,rsvps_data,checkins_data`, {
          headers: { "apikey": supaKey, "Authorization": `Bearer ${token}` },
        });
        if (res.ok) {
          const rows = await res.json();
          const map = {};
          rows.forEach(r => { map[r.handle] = { rsvps: r.rsvps_data || [], checkins: r.checkins_data || [] }; });
          setFriendRsvpMap(prev => ({ ...prev, ...map }));
        }
      } catch(e) {}
    })();
  }, [friends]);
  useEffect(() => {
    if (!friendView || !hasSupabase()) { setFriendProfileData(null); return; }
    // Fetch friend's profile data (rsvps, checkins, etc.) from Supabase
    (async () => {
      try {
        const supaUrl = import.meta.env.VITE_SUPABASE_URL;
        const supaKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
        let token = supaKey;
        try {
          const storageKey = `sb-${new URL(supaUrl).hostname.split('.')[0]}-auth-token`;
          const stored = JSON.parse(localStorage.getItem(storageKey) || "{}");
          if (stored?.access_token) token = stored.access_token;
        } catch(e) {}
        // Look up friend's profile by handle
        const handle = encodeURIComponent(friendView.handle);
        const res = await fetch(`${supaUrl}/rest/v1/profiles?handle=eq.${handle}&select=rsvps_data,checkins_data,friends_data`, {
          headers: { "apikey": supaKey, "Authorization": `Bearer ${token}` },
        });
        if (res.ok) {
          const rows = await res.json();
          if (rows?.[0]) { setFriendProfileData(rows[0]); return; }
        }
      } catch(e) {}
      setFriendProfileData(null);
    })();
  }, [friendView]);

  const renderFriendProfile = (fr) => {
    const isFrFriend = friendHandles.includes(fr.handle);
    const realRsvps = friendProfileData?.rsvps_data || [];
    const realCheckins = friendProfileData?.checkins_data || [];
    const frRsvpIds = realRsvps.filter(eid => !incog.includes(eid));
    const frE = events.filter(e => frRsvpIds.includes(e.id) && e.conf === conf);
    const frCheckinCount = realCheckins.length;
    // Calculate XP using the real quest system (same logic as user's own XP)
    const frCompleted = [];
    let frCC = 0;
    for (const q of QUESTS) {
      if (q.id === "q10") { if (q.check(realCheckins, events, frCC, realRsvps)) frCompleted.push(q.id); }
      else { if (q.check(realCheckins, events, frCC, realRsvps)) { frCompleted.push(q.id); frCC++; } }
    }
    const frXP = QUESTS.filter(q => frCompleted.includes(q.id)).reduce((s, q) => s + q.xp, 0);
    const frLevel = getLevel(frXP);
    const frNext = getNext(frXP);
    const frCats = [...new Set(events.filter(e => frRsvpIds.includes(e.id)).map(e => e.cat))];
    const frDays = [...new Set(events.filter(e => frRsvpIds.includes(e.id)).map(e => e.date))];

    return (<>
      <div className="overlay" onClick={() => setFriendView(null)}/>
      <div className="modal" style={{padding:0}}>
        <div className="mh" style={{padding:"13px 16px",borderBottom:"1px solid var(--border)"}}>
          <button className="ib" aria-label="Close" onClick={() => setFriendView(null)}>←</button>
          <div style={{display:"flex",gap:6}}>
            {isFrFriend && <button className="ib" onClick={() => togVip(fr.handle)} style={{color:vips.includes(fr.handle)?"#F9AB00":"var(--muted)",fontSize:16}} title="Must meet">{vips.includes(fr.handle)?"⭐":"☆"}</button>}
            {isFrFriend ? <button className="ib-sm" onClick={() => { removeFriend(fr); setFriendView(null); }} style={{color:"#BF360C",fontSize:12}}>Remove</button>
            : <button className="btn-sm" onClick={() => { addFriend(fr.handle); }} style={{background:"linear-gradient(135deg,#9945FF,#14F195)",border:"none",padding:"7px 16px",fontSize:12}}>+ Add</button>}
          </div>
        </div>
        <div style={{padding:"0 16px 28px"}}>
          <div className="profile-hero" style={{marginTop:8}}>
            <div className="profile-hero-bg"/>
            <div style={{position:"relative",zIndex:1}}>
              <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:14}}>
                <Avatar name={fr.name} s={52} bg={uc(fr.handle)} pfp={fr.pfp}/>
                <div style={{flex:1}}>
                  <div style={{display:"flex",alignItems:"center",gap:6}}>
                    <h2 style={{fontSize:18,fontWeight:800,color:"white"}}>{fr.name}</h2>
                    {fr.notable && <span style={{fontSize:9,background:"rgba(249,171,0,.15)",color:"#F9AB00",padding:"2px 7px",borderRadius:100,fontWeight:700}}>Notable</span>}
                  </div>
                  <p style={{fontSize:12,color:"rgba(255,255,255,.6)",display:"flex",alignItems:"center",gap:3}}>{fr.handle}{fr.handle?.startsWith("@") && <a href={`https://x.com/${fr.handle.slice(1)}`} target="_blank" rel="noopener noreferrer" onClick={e=>e.stopPropagation()} style={{display:"inline-flex",alignItems:"center",justifyContent:"center",width:22,height:22,borderRadius:8,background:"rgba(255,255,255,.1)",marginLeft:4,color:"rgba(255,255,255,.7)",transition:"all .2s",textDecoration:"none"}}><XI s={11}/></a>}</p>
                  {fr.role && <p style={{fontSize:11,color:"rgba(255,255,255,.45)",marginTop:3}}>{fr.role}</p>}
                  {fr.bio && <p style={{fontSize:11,color:"rgba(255,255,255,.35)",marginTop:2,fontStyle:"italic"}}>{fr.bio}</p>}
                  <div style={{display:"flex",gap:5,marginTop:6}}><span className="prof-stat">{frLevel.n}</span><span className="prof-stat">{frXP} XP</span></div>
                </div>
              </div>
              {frNext && <div>
                <div className="xp-bar-bg"><div className="xp-bar-fill" style={{width:`${Math.min(100,((frXP-frLevel.xp)/(frNext.xp-frLevel.xp))*100)}%`}}/></div>
                <div style={{display:"flex",justifyContent:"space-between",fontSize:9,color:"rgba(255,255,255,.45)",fontFamily:"var(--fm)",marginTop:3}}><span>{frLevel.n}</span><span>{frNext.n}</span></div>
              </div>}
            </div>
          </div>

          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:6,marginBottom:16}}>
            <div className="stat-box"><p className="stat-num" style={{color:"var(--accent)"}}>{frRsvpIds.length}</p><p className="stat-label">RSVPs</p></div>
            <div className="stat-box"><p className="stat-num" style={{color:"var(--accent2)"}}>{frCheckinCount}</p><p className="stat-label">Check-ins</p></div>
            <div className="stat-box"><p className="stat-num">{frDays.length}</p><p className="stat-label">Days</p></div>
          </div>

          {frCats.length > 0 && <div style={{marginBottom:16}}>
            <p className="section-label">Categories</p>
            <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
              {frCats.map(c => { const cat = CATS[c]||CATS.Other; return <span key={c} className="pill" style={{background:`${cfg(cat)}14`,color:cfg(cat),padding:"4px 10px",fontSize:11}}>{cat.em} {c}</span>; })}
            </div>
          </div>}

          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
            <p className="section-label" style={{marginBottom:0}}>Attending {cd?.short} ({frE.length})</p>
            {user && frE.length > 0 && (() => {
              const notJoined = frE.filter(ev => !rsvps.includes(ev.id) && !pendingRequests.includes(ev.id));
              return notJoined.length > 0 ? (
                <button className="btn-sm" style={{background:"linear-gradient(135deg,#9945FF,#14F195)",border:"none",padding:"6px 14px",fontSize:11}} onClick={() => {
                  let joined = 0, requested = 0;
                  let newPending = [...pendingRequests];
                  notJoined.forEach(ev => {
                    if (ev.rsvp) {
                      newPending.push(ev.id);
                      requested++;
                    } else {
                      togRsvp(ev.id);
                      joined++;
                    }
                  });
                  if (requested > 0) { setPendingRequests(newPending); syncToSupabase({pending_requests_data:newPending}); }
                  const parts = [];
                  if (joined) parts.push(`Joined ${joined}`);
                  if (requested) parts.push(`Requested ${requested}`);
                  toast(parts.join(", ") + ` event${joined+requested>1?"s":""}!`, "info");
                }}>Join all ({notJoined.length})</button>
              ) : <span style={{fontSize:10,color:"var(--accent)",fontWeight:600}}>✓ Going to all</span>;
            })()}
          </div>
          {frE.length === 0 ? <div className="empty-msg">No visible events</div> : (
            <div style={{display:"flex",flexDirection:"column",gap:7}}>
              {frE.map((ev) => {
                const cat = CATS[ev.cat]||CATS.Other;
                return (
                  <div key={ev.id} className="ev-card" style={{background:cbg(cat),borderLeft:`3px solid ${cat.ac}`,cursor:"pointer"}} onClick={() => { setFriendView(null); setSel(ev); }}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                      <div>
                        <span className="pill" style={{background:`${cfg(cat)}14`,color:cfg(cat),fontSize:10,marginBottom:3}}>{cat.em} {ev.cat}</span>
                        <h4 className="card-t-sm">{ev.title}</h4>
                        <p className="card-host" style={{color:cfg(cat),marginBottom:2}}>{ev.host}</p>
                        <span className="card-m">{fd(ev.date)} · {ev.time}</span>
                      </div>
                      <span className="card-att">{getAtt(ev.id)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </>);
  };

  // ── Profile View ──
  const renderProfile = () => {
    if (!user) return (
      <div className="anim-in" style={{textAlign:"center",padding:"60px 24px"}}>
        <div style={{width:72,height:72,borderRadius:22,background:"linear-gradient(135deg,rgba(153,69,255,.1),rgba(20,241,149,.08))",display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 16px",border:"2px dashed var(--border)"}}><span style={{fontSize:32}}>🏆</span></div>
        <p style={{fontWeight:800,fontSize:20,marginBottom:6,fontFamily:"var(--fd)",letterSpacing:"-.3px"}}>Join the game</p>
        <p style={{color:"var(--muted)",fontSize:14,marginBottom:24,lineHeight:1.5}}>Sign in to unlock Side Quests,<br/>earn XP, and climb the leaderboard</p>
        <button className="btn-glow" onClick={() => setShowAuth(true)} style={{padding:"14px 36px",fontSize:16}}>Sign In</button>
      </div>
    );

    const myEvs = events.filter(e => e.created_by === user.supaId || e.by === user.handle);
    const savedEvs = events.filter(e => bmarks.includes(e.id));
    const verEvs = events.filter(e => checkins.includes(e.id));
    const rsvpEvs = events.filter(e => rsvps.includes(e.id));

    return (
      <div className="anim-in">
        <div className="profile-hero">
          <div className="profile-hero-bg"/>
          <div style={{position:"relative",zIndex:1}}>
            <div style={{display:"flex",alignItems:"center",gap:14}}>
              <Avatar name={user.name} s={54} pfp={user.pfp}/>
              <div style={{flex:1}}>
                <h2 style={{fontSize:20,fontWeight:800,color:"white",fontFamily:"var(--fd)",letterSpacing:"-.3px"}}>{user.name}</h2>
                <p style={{fontSize:12.5,color:"rgba(255,255,255,.55)",display:"flex",alignItems:"center",gap:4,marginTop:2}}>{user.handle}{user.handle?.startsWith("@") && <a href={`https://x.com/${user.handle.slice(1)}`} target="_blank" rel="noopener noreferrer" style={{display:"inline-flex",alignItems:"center",justifyContent:"center",width:22,height:22,borderRadius:8,background:"rgba(255,255,255,.1)",color:"rgba(255,255,255,.7)",textDecoration:"none"}}><XI s={11}/></a>}</p>
                <div style={{display:"flex",gap:6,marginTop:7}}>
                  <span className="prof-stat">{level.n}</span>
                  <span className="prof-stat">{totalXP} XP</span>
                  <span className="prof-stat">{completedQuests.length}/{QUESTS.length} ⚡</span>
                </div>
              </div>
              <div style={{display:"flex",gap:6,flexDirection:"column",alignItems:"flex-end"}}>
                <button onClick={async () => {
                  const url = `${window.location.origin}?add=${encodeURIComponent(user.handle)}`;
                  const text = `Add me on SIDE.SOL! ${url}`;
                  if (navigator.share) { try { await navigator.share({title:"Add me on SIDE.SOL",text:user.handle,url}); return; } catch(e){} }
                  const ok = await copyText(text);
                  toast(ok ? "Profile link copied!" : "Copy failed", ok ? "success" : "error");
                }} style={{background:"rgba(255,255,255,.12)",border:"1px solid rgba(255,255,255,.1)",color:"white",backdropFilter:"blur(4px)",borderRadius:100,padding:"6px 14px",fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"var(--f)",display:"flex",alignItems:"center",gap:5}}>↗ Share</button>
                <button onClick={() => setShowPrivacy(true)} style={{background:"rgba(255,255,255,.12)",border:"1px solid rgba(255,255,255,.1)",color:"white",backdropFilter:"blur(4px)",borderRadius:100,padding:"6px 14px",fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"var(--f)",display:"flex",alignItems:"center",gap:5}}>🔒 Privacy</button>
              </div>
            </div>
          </div>
        </div>

        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:8,marginBottom:18}}>
          <div className="stat-box" style={{animation:"scaleIn .4s cubic-bezier(.16,1,.3,1) .1s both"}}><p className="stat-num" style={{color:"var(--accent)"}}>{rsvpEvs.length}</p><p className="stat-label">RSVPs</p></div>
          <div className="stat-box" style={{animation:"scaleIn .4s cubic-bezier(.16,1,.3,1) .17s both"}}><p className="stat-num" style={{color:"var(--accent2)"}}>{verEvs.length}</p><p className="stat-label">Check-ins</p></div>
          <div className="stat-box" style={{animation:"scaleIn .4s cubic-bezier(.16,1,.3,1) .24s both"}}><p className="stat-num">{savedEvs.length}</p><p className="stat-label">Saved</p></div>
          <div className="stat-box" style={{animation:"scaleIn .4s cubic-bezier(.16,1,.3,1) .31s both"}}><p className="stat-num">{myEvs.length}</p><p className="stat-label">Hosted</p></div>
        </div>

        <div className="tab-bar">
          {[{id:"quests",l:"⚡ Quests"},{id:"saved",l:"⭐ Saved"},{id:"verified",l:"✅ Verified"},{id:"mine",l:"📝 Mine"}].map(t => (
            <button key={t.id} className={`tab ${profTab===t.id?"on":""}`} onClick={() => setProfTab(t.id)}>{t.l}</button>
          ))}
        </div>

        {profTab === "quests" && renderQuests()}
        {profTab === "saved" && (savedEvs.length === 0 ? <div className="empty-msg"><div style={{fontSize:40,marginBottom:8}}>⭐</div><strong style={{fontSize:17}}>No saved events yet</strong><p style={{marginTop:6,marginBottom:16}}>Tap the ☆ star on any event to save it for later</p><button className="btn-sm" onClick={() => setView("home")} style={{background:"linear-gradient(135deg,#9945FF,#14F195)",border:"none",padding:"10px 24px"}}>Browse events</button></div> : <div style={{display:"flex",flexDirection:"column",gap:10}}>{savedEvs.map((ev,i) => renderCard(ev,i,true))}</div>)}
        {profTab === "verified" && (verEvs.length === 0 ? <div className="empty-msg"><div style={{fontSize:40,marginBottom:8}}>📍</div><strong style={{fontSize:17}}>No check-ins yet</strong><p style={{marginTop:6,marginBottom:16}}>RSVP to events, then check in at the venue to earn XP</p><button className="btn-sm" onClick={() => setView("home")} style={{background:"linear-gradient(135deg,#9945FF,#14F195)",border:"none",padding:"10px 24px"}}>Browse events</button></div> : <div style={{display:"flex",flexDirection:"column",gap:10}}>{verEvs.map((ev,i) => renderCard(ev,i,true))}</div>)}
        {profTab === "mine" && (myEvs.length === 0 ? <div className="empty-msg">📝<br/><br/><strong>No submitted events</strong><br/>Tap + to submit your own side event</div> : <div style={{display:"flex",flexDirection:"column",gap:10}}>{myEvs.map((ev,i) => renderCard(ev,i,false))}</div>)}

        <button className="btn-outline" onClick={async () => { saveState("user", null); setUser(null); if (hasSupabase()) await db.signOut(); toast("Signed out"); }} style={{width:"100%",marginTop:24,marginBottom:24}}>Sign out</button>
      </div>
    );
  };

  // ── RENDER ──
  if (!ready) {
    const isDark = loadState("dark", false);
    return (
    <div style={{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",background:isDark?"#0c0c14":"#F5F3EE",flexDirection:"column",gap:22}}>
      <div style={{position:"relative"}}>
        <div style={{width:60,height:60,borderRadius:18,background:"linear-gradient(135deg,#9945FF,#14F195)",display:"flex",alignItems:"center",justifyContent:"center",boxShadow:"0 4px 30px rgba(153,69,255,.25),0 0 60px rgba(20,241,149,.1)",animation:"float 2s ease-in-out infinite"}}><SolIc/></div>
        <div style={{position:"absolute",inset:-6,borderRadius:24,border:"2px solid rgba(153,69,255,.15)",animation:"pulseRing 2s ease infinite"}}/>
      </div>
      <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:8}}>
        <span style={{fontSize:17,fontWeight:800,color:isDark?"#f0ede8":"#1e1e2e",fontFamily:"'Bricolage Grotesque','Outfit',system-ui",letterSpacing:"-.2px"}}>SIDE.SOL</span>
        <span style={{fontSize:11,color:isDark?"#6b6875":"#8a8680",fontFamily:"'JetBrains Mono',monospace",letterSpacing:".5px",animation:"breathe 2s ease infinite"}}>Loading events...</span>
      </div>
    </div>
  );}

  return (
    <div className={`root${dark?" dark":""}`}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@400;500;600;700;800&family=Outfit:wght@300;400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500;600;700&display=swap');
        :root{
          --f:'Outfit',system-ui,sans-serif;--fd:'Bricolage Grotesque','Outfit',system-ui,sans-serif;--fm:'JetBrains Mono',monospace;
          --bg:#F5F3EE;--bg2:#FAFAF7;--surface:#FFFFFF;--surface2:#F0EDE6;--dark:#111118;--heading:#111118;--text:#1e1e2e;--muted:#706c66;--border:#e6e2da;
          --accent:#9945FF;--accent2:#14F195;--glow-p:rgba(153,69,255,.2);--glow-g:rgba(20,241,149,.12);
          --sh-sm:0 1px 3px rgba(0,0,0,.04),0 2px 8px rgba(0,0,0,.03);
          --sh-md:0 2px 6px rgba(0,0,0,.05),0 8px 24px rgba(0,0,0,.05);
          --sh-lg:0 4px 12px rgba(0,0,0,.06),0 16px 48px rgba(0,0,0,.07);
          --sh-glow:0 0 0 1px rgba(153,69,255,.06),0 8px 32px rgba(153,69,255,.06);
          --overlay:rgba(17,17,24,.35);--nav-bg:rgba(255,255,255,.92);--on-inv:white;
          --ease:cubic-bezier(.16,1,.3,1);--dur:.3s;
        }
        .dark{
          --bg:#0c0c14;--bg2:#12121e;--surface:#1a1a28;--surface2:#242430;--heading:#f0ede8;--text:#ccc8c2;--muted:#a8a4b0;--border:#38364a;
          --glow-p:rgba(153,69,255,.3);--glow-g:rgba(20,241,149,.2);
          --sh-sm:0 1px 3px rgba(0,0,0,.25),0 2px 8px rgba(0,0,0,.2);
          --sh-md:0 2px 8px rgba(0,0,0,.25),0 8px 28px rgba(0,0,0,.25);
          --sh-lg:0 4px 12px rgba(0,0,0,.3),0 16px 52px rgba(0,0,0,.35);
          --sh-glow:0 0 0 1px rgba(153,69,255,.12),0 8px 32px rgba(153,69,255,.12);
          --overlay:rgba(4,4,8,.7);--nav-bg:rgba(12,12,20,.92);--on-inv:#111118;
        }
        .dark .tag.on,.dark .tab.on{background:linear-gradient(135deg,#9945FF,#14F195);color:white;border-color:transparent;}
        .dark .conf-chip.on{background:linear-gradient(135deg,rgba(153,69,255,.25),rgba(20,241,149,.12));border-color:rgba(153,69,255,.3);color:var(--text);}
        .dark .btn-sm{background:var(--surface2);color:var(--text);border:1px solid var(--border);}
        .dark .btn-outline{background:var(--surface);border-color:var(--border);color:var(--text);}
        .dark .btn-outline:hover{background:var(--surface2);border-color:var(--accent);color:var(--text);}
        .dark .ib{background:var(--surface);border-color:var(--border);color:var(--text);}
        .dark .ev-card{background-image:none;}
        .dark .sbar input::placeholder,.dark .field::placeholder{color:#706880;}
        .dark .card-desc{color:var(--muted);}
        .dark .host-code-char{background:var(--surface2);box-shadow:var(--sh-md);}
        .dark .lb-row:nth-child(1){background:linear-gradient(90deg,rgba(249,171,0,.08),transparent 60%);}
        .dark .lb-row:nth-child(1)::after{background:linear-gradient(90deg,transparent,rgba(249,171,0,.08),transparent);}
        .dark .modal{background:#1a1a2a;}
        .dark .ticket{background:var(--surface);}
        .dark .info-cell{background:var(--bg);border-color:var(--border);}
        .dark .quest-popup{background:linear-gradient(145deg,#181824,#1e1245,#0a2a1a);}
        *{box-sizing:border-box;margin:0;padding:0;}
        .skel{background:linear-gradient(90deg,var(--surface2) 25%,var(--border) 50%,var(--surface2) 75%);background-size:200% 100%;animation:shimmer 1.5s ease infinite;}
        html{background:var(--bg);}
        .root{min-height:100vh;background:var(--bg);font-family:var(--f);color:var(--text);max-width:860px;margin:0 auto;position:relative;padding-bottom:90px;overflow-x:hidden;}
        .root::before{content:'';position:fixed;top:-40%;left:-40%;width:180%;height:180%;background:
          radial-gradient(ellipse at 25% 15%,rgba(153,69,255,.045) 0%,transparent 45%),
          radial-gradient(ellipse at 75% 85%,rgba(20,241,149,.035) 0%,transparent 45%),
          radial-gradient(ellipse at 60% 40%,rgba(249,171,0,.02) 0%,transparent 40%);
          pointer-events:none;z-index:0;animation:bgShift 25s ease-in-out infinite alternate;}
        .root::after{content:'';position:fixed;inset:0;background:url("data:image/svg+xml,%3Csvg viewBox='0 0 512 512' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.65' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='.018'/%3E%3C/svg%3E");pointer-events:none;z-index:0;}

        @keyframes bgShift{0%{transform:translate(0,0) rotate(0deg)}100%{transform:translate(-2%,1.5%) rotate(.5deg)}}
        @keyframes cardIn{0%{opacity:0;transform:translateY(24px) scale(.96)}100%{opacity:1;transform:translateY(0) scale(1)}}
        @keyframes fadeSlide{from{opacity:0;transform:translateX(24px)}to{opacity:1;transform:translateX(0)}}
        @keyframes toastIn{0%{opacity:0;transform:translateY(-16px) scale(.88) rotateX(8deg)}100%{opacity:1;transform:translateY(0) scale(1) rotateX(0)}}
        @keyframes slideUp{from{transform:translateY(100%)}to{transform:translateY(0)}}
        @keyframes modalContent{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
        @keyframes fadeIn{from{opacity:0}to{opacity:1}}
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes glow{0%,100%{box-shadow:0 0 20px var(--glow-p),0 0 60px var(--glow-g),inset 0 1px 0 rgba(255,255,255,.2)}50%{box-shadow:0 0 32px var(--glow-p),0 0 80px var(--glow-g),inset 0 1px 0 rgba(255,255,255,.3)}}
        @keyframes questPop{0%{transform:scale(0) rotate(-20deg);opacity:0}40%{transform:scale(1.15) rotate(4deg)}70%{transform:scale(.95) rotate(-1deg)}100%{transform:scale(1) rotate(0);opacity:1}}
        @keyframes pulseDot{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.35;transform:scale(1.9)}}
        @keyframes charPop{from{opacity:0;transform:scale(0) rotateY(90deg)}to{opacity:1;transform:scale(1) rotateY(0)}}
        @keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}
        @keyframes neonPulse{0%,100%{text-shadow:0 0 8px rgba(20,241,149,.25)}50%{text-shadow:0 0 16px rgba(20,241,149,.5),0 0 32px rgba(20,241,149,.15)}}
        @keyframes shimmer{0%{background-position:-200% 0}100%{background-position:200% 0}}
        @keyframes subtleBounce{0%,100%{transform:translateY(0)}50%{transform:translateY(-2px)}}
        @keyframes borderRotate{0%{--angle:0deg}100%{--angle:360deg}}
        @keyframes countPop{0%{transform:scale(.8);opacity:0}60%{transform:scale(1.05)}100%{transform:scale(1);opacity:1}}
        @keyframes gradientFlow{0%{background-position:0% 50%}50%{background-position:100% 50%}100%{background-position:0% 50%}}
        @keyframes ticketReveal{0%{opacity:0;transform:scale(.92) translateY(16px)}100%{opacity:1;transform:scale(1) translateY(0)}}
        @keyframes pulseRing{0%{box-shadow:0 0 0 0 rgba(20,241,149,.35)}70%{box-shadow:0 0 0 14px rgba(20,241,149,0)}100%{box-shadow:0 0 0 0 rgba(20,241,149,0)}}
        @keyframes wiggle{0%,100%{transform:rotate(0)}20%{transform:rotate(-4deg)}40%{transform:rotate(4deg)}60%{transform:rotate(-2deg)}80%{transform:rotate(2deg)}}
        @keyframes slideInRight{from{opacity:0;transform:translateX(30px)}to{opacity:1;transform:translateX(0)}}
        @keyframes breathe{0%,100%{opacity:.35}50%{opacity:.65}}
        @keyframes barFill{from{width:0%}}
        @keyframes successBurst{0%{transform:scale(0);opacity:0}50%{transform:scale(1.3)}100%{transform:scale(1);opacity:1}}
        @keyframes ripple{0%{transform:scale(1);opacity:.4}100%{transform:scale(2.5);opacity:0}}
        @keyframes heroShine{0%{left:-100%}100%{left:200%}}
        @keyframes typewriter{from{width:0}to{width:100%}}
        @keyframes fadeUp{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
        @keyframes scaleIn{from{opacity:0;transform:scale(.85)}to{opacity:1;transform:scale(1)}}

        .anim-in{animation:cardIn .5s cubic-bezier(.16,1,.3,1) both;}
        .anim-fade-up{animation:fadeUp .4s cubic-bezier(.16,1,.3,1) both;}
        .anim-scale{animation:scaleIn .35s cubic-bezier(.16,1,.3,1) both;}
        .anim-slide-r{animation:slideInRight .4s cubic-bezier(.16,1,.3,1) both;}

        /* ═══ PILLS ═══ */
        .pill{display:inline-flex;align-items:center;gap:5px;padding:6px 13px;border-radius:100px;font-size:11px;font-weight:700;letter-spacing:.15px;font-family:var(--f);white-space:nowrap;backdrop-filter:blur(4px);}
        .rsvp-pill{background:rgba(20,241,149,.1);color:#0A8F5A;border:1px solid rgba(20,241,149,.18);}
        .going-pill{background:rgba(20,241,149,.12);color:#0A8F5A;border:1px solid rgba(20,241,149,.18);pointer-events:none;cursor:default;}
        .hot-pill{background:rgba(255,112,67,.1);color:#BF360C;border:1px solid rgba(255,112,67,.15);}
        .verified-pill{background:linear-gradient(135deg,rgba(153,69,255,.1),rgba(20,241,149,.08));color:#7B3FCC;border:1px solid rgba(153,69,255,.18);font-weight:800;}

        /* ═══ EVENT CARDS ═══ */
        .ev-card{border-radius:18px;padding:20px 22px;cursor:pointer;position:relative;
          transition:transform .35s cubic-bezier(.16,1,.3,1),box-shadow .35s ease,border-color .35s ease;
          box-shadow:var(--sh-md);border:1px solid var(--border);
          background:var(--surface);backdrop-filter:blur(8px);}
        .ev-card:hover{transform:translateY(-6px) scale(1.01);box-shadow:var(--sh-lg),var(--sh-glow);border-color:rgba(153,69,255,.12);}
        .ev-card:active{transform:translateY(-2px) scale(.998);transition-duration:.12s;box-shadow:var(--sh-sm);}
        .card-t{font-size:20px;font-weight:800;line-height:1.2;letter-spacing:-.4px;color:var(--heading);margin-bottom:5px;font-family:var(--fd);}
        .card-t-sm{font-size:17px;font-weight:700;line-height:1.2;letter-spacing:-.3px;color:var(--heading);margin-bottom:3px;font-family:var(--fd);}
        .card-host{font-size:13.5px;font-weight:600;opacity:.8;margin-bottom:8px;}
        .card-desc{font-size:14px;color:var(--muted);line-height:1.6;margin-bottom:12px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}
        .card-mc{display:flex;flex-direction:column;gap:4px;} .card-m{font-size:12px;color:var(--muted);font-family:var(--fm);letter-spacing:-.2px;}
        .card-att{font-size:12px;color:var(--muted);font-family:var(--fm);font-weight:600;}
        .qrsvp{padding:8px 16px;border-radius:100px;font-size:12px;font-weight:700;min-height:36px;border:1.5px solid var(--accent);background:transparent;color:var(--accent);cursor:pointer;font-family:var(--f);transition:all .2s;white-space:nowrap;}
        .qrsvp:hover{background:var(--accent);color:white;transform:scale(1.05);box-shadow:0 4px 16px rgba(153,69,255,.25);}
        .qrsvp:active{transform:scale(.95);}
        .qrsvp.on{background:rgba(20,241,149,.1);color:#0A8F5A;border-color:rgba(20,241,149,.3);cursor:default;font-size:11px;padding:5px 12px;pointer-events:none;}

        /* ═══ FORM FIELDS ═══ */
        .field{width:100%;padding:14px 18px;border:1.5px solid var(--border);border-radius:12px;font-size:15px;font-family:var(--f);background:var(--surface);color:var(--text);outline:none;transition:all .3s cubic-bezier(.16,1,.3,1);}
        .field:focus{border-color:var(--accent);background:var(--surface);box-shadow:0 0 0 4px rgba(153,69,255,.06),0 4px 16px rgba(153,69,255,.04);}
        .field::placeholder{color:#a09a90;} select.field{appearance:none;padding-right:36px;}
        textarea.field{resize:vertical;min-height:80px;line-height:1.5;}
        .field-error{border-color:#DC2626!important;box-shadow:0 0 0 3px rgba(220,38,38,.1)!important;}
        .fld-label{font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:1px;font-family:var(--fm);}

        /* ═══ BUTTONS ═══ */
        .btn-glow{padding:16px 32px;background:linear-gradient(135deg,#9945FF 0%,#7B3FD9 35%,#19D998 100%);color:white;border:none;border-radius:14px;font-size:16px;min-height:48px;font-weight:700;cursor:pointer;font-family:var(--fd);transition:all .25s cubic-bezier(.16,1,.3,1);display:inline-flex;align-items:center;justify-content:center;gap:8px;animation:glow 4s ease infinite;text-shadow:0 1px 3px rgba(0,0,0,.25);position:relative;overflow:hidden;letter-spacing:.2px;}
        .btn-glow::before{content:'';position:absolute;inset:0;background:linear-gradient(90deg,transparent,rgba(255,255,255,.18),transparent);background-size:200% 100%;animation:shimmer 2.5s linear infinite;}
        .btn-glow:hover{transform:translateY(-4px) scale(1.02);filter:brightness(1.1);box-shadow:0 8px 32px rgba(153,69,255,.35);}
        .btn-glow:active{transform:translateY(-1px) scale(.98);filter:brightness(.95);}
        .btn-checkin{padding:16px 28px;background:linear-gradient(135deg,#9945FF 0%,#6B2FD9 40%,#19D998 100%);color:white;border:none;border-radius:18px;font-size:17px;font-weight:800;cursor:pointer;font-family:var(--fd);transition:all .25s;animation:glow 2.5s ease infinite;width:100%;letter-spacing:.3px;text-shadow:0 2px 4px rgba(0,0,0,.25);position:relative;overflow:hidden;}
        .btn-checkin::before{content:'';position:absolute;inset:0;background:linear-gradient(90deg,transparent,rgba(255,255,255,.12),transparent);background-size:200% 100%;animation:shimmer 2.5s linear infinite;}
        .btn-checkin:hover{transform:translateY(-3px);}
        .btn-outline{padding:14px 26px;background:var(--surface);color:var(--heading);border:1.5px solid var(--border);border-radius:12px;font-size:15px;min-height:48px;font-weight:700;cursor:pointer;font-family:var(--f);transition:all .25s cubic-bezier(.16,1,.3,1);display:inline-flex;align-items:center;justify-content:center;gap:6px;box-shadow:var(--sh-sm);}
        .btn-outline:hover{background:var(--dark);color:white;border-color:var(--dark);box-shadow:var(--sh-lg);transform:translateY(-2px);}
        .btn-outline:active{transform:translateY(0);box-shadow:none;}
        .btn-sm{padding:9px 20px;background:var(--dark);color:white;border:none;border-radius:100px;font-size:13px;min-height:36px;font-weight:700;cursor:pointer;font-family:var(--f);transition:all .2s;box-shadow:var(--sh-sm);}
        .btn-sm:hover{background:#2a2a3e;transform:translateY(-1px);box-shadow:var(--sh-md);}
        .btn-sm:active{transform:translateY(0);}

        /* ═══ ICON BUTTONS ═══ */
        .ib{width:44px;height:44px;border-radius:12px;background:var(--surface);border:1px solid var(--border);cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all .2s cubic-bezier(.16,1,.3,1);color:var(--text);flex-shrink:0;font-size:15px;box-shadow:var(--sh-sm);}
        .ib:hover{background:var(--surface2);box-shadow:var(--sh-md);transform:translateY(-2px);}
        .ib:active{transform:translateY(0);box-shadow:none;}
        .ib-sm{width:40px;height:40px;border-radius:10px;background:transparent;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;font-size:15px;transition:all .2s;color:var(--muted);}
        .ib-sm:hover{background:var(--surface2);color:var(--heading);transform:scale(1.06);}
        .ib-sm:active{transform:scale(.94);}

        /* ═══ TAGS ═══ */
        .tag{padding:10px 18px;border-radius:100px;font-size:13px;min-height:40px;font-weight:600;border:1.5px solid var(--border);background:var(--surface);cursor:pointer;transition:all .25s cubic-bezier(.16,1,.3,1);color:var(--text);white-space:nowrap;font-family:var(--f);box-shadow:var(--sh-sm);}
        .tag:hover{border-color:var(--dark);box-shadow:var(--sh-md);transform:translateY(-1px);}
        .tag:active{transform:translateY(0);box-shadow:none;}
        .tag.on{background:var(--dark);color:white;border-color:var(--dark);box-shadow:0 4px 16px rgba(17,17,24,.15);font-weight:700;transform:translateY(-1px);}

        /* ═══ MODALS ═══ */
        .overlay{position:fixed;inset:0;background:var(--overlay);z-index:100;animation:fadeIn .25s;backdrop-filter:blur(20px) saturate(1.5);-webkit-backdrop-filter:blur(20px) saturate(1.5);}
        .modal{position:fixed;bottom:0;left:0;right:0;max-height:92vh;max-width:860px;margin:0 auto;background:var(--surface);border-radius:28px 28px 0 0;z-index:101;overflow-y:auto;animation:slideUp .5s cubic-bezier(.22,.68,0,1);padding:0 24px calc(48px + env(safe-area-inset-bottom, 0px));box-shadow:0 -8px 40px rgba(0,0,0,.1),0 -2px 8px rgba(0,0,0,.04);}
        .modal::before{content:'';display:block;width:36px;height:4px;background:var(--border);border-radius:100px;margin:14px auto 22px;transition:background .2s;}
        .modal:hover::before{background:var(--muted);}
        .mh{display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;animation:modalContent .4s .15s both;}
        .mt{font-size:20px;font-weight:800;letter-spacing:-.3px;font-family:var(--fd);}

        /* ═══ TICKET ═══ */
        .ticket{background:var(--surface);border-radius:22px;padding:30px;text-align:center;border:1px solid var(--border);position:relative;overflow:hidden;box-shadow:var(--sh-lg);background-image:linear-gradient(180deg,rgba(153,69,255,.02) 0%,transparent 50%);animation:ticketReveal .5s cubic-bezier(.16,1,.3,1) both;}
        .ticket::before,.ticket::after{content:'';position:absolute;width:24px;height:24px;background:var(--bg);border-radius:50%;top:50%;box-shadow:inset 0 2px 8px rgba(0,0,0,.05);}
        .ticket::before{left:-12px;} .ticket::after{right:-12px;}
        .ticket-t{font-size:26px;font-weight:800;letter-spacing:-.5px;line-height:1.15;margin-bottom:8px;font-family:var(--fd);color:var(--heading);}
        .dashed{border:none;border-top:2px dashed var(--border);margin:16px 0;}
        .r2{display:grid;grid-template-columns:1fr 1fr;gap:10px;}

        /* ═══ INFO CELLS ═══ */
        .info-cell{background:var(--bg);border-radius:13px;padding:12px;text-align:center;display:flex;flex-direction:column;gap:3px;border:1px solid rgba(0,0,0,.02);}
        .info-l{font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--muted);font-weight:700;font-family:var(--fm);}
        .info-v{font-size:13px;font-weight:700;font-family:var(--fm);color:var(--text);}

        /* ═══ TOGGLES ═══ */
        .tog{width:46px;height:26px;border-radius:100px;background:#d4d0c8;cursor:pointer;position:relative;transition:all .3s cubic-bezier(.16,1,.3,1);flex-shrink:0;}
        .tog[data-on="true"]{background:#14F195;box-shadow:0 0 12px rgba(20,241,149,.25);}
        .tog-t{width:20px;height:20px;border-radius:50%;background:white;position:absolute;top:3px;left:3px;transition:transform .3s cubic-bezier(.16,1,.3,1);box-shadow:0 1px 4px rgba(0,0,0,.15),0 2px 8px rgba(0,0,0,.06);}

        /* ═══ SCROLLERS ═══ */
        .scr{display:flex;gap:7px;overflow-x:auto;padding-bottom:4px;-ms-overflow-style:none;scrollbar-width:none;} .scr::-webkit-scrollbar{display:none;}

        /* ═══ CONFERENCE CHIPS ═══ */
        .conf-chip{padding:11px 18px;border-radius:16px;border:1.5px solid var(--border);background:var(--surface);cursor:pointer;transition:all .25s cubic-bezier(.16,1,.3,1);white-space:nowrap;display:flex;align-items:center;gap:9px;font-size:13.5px;font-weight:600;box-shadow:var(--sh-sm);}
        .conf-chip:hover{border-color:var(--dark);box-shadow:var(--sh-md);transform:translateY(-2px);}
        .conf-chip:active{transform:translateY(0);}
        .conf-chip.on{background:var(--dark);color:white;border-color:var(--dark);box-shadow:0 4px 20px rgba(17,17,24,.18);transform:translateY(-1px);}
        .conf-chip.on .cm{color:rgba(255,255,255,.5);}

        /* ═══ SEARCH BAR ═══ */
        .sbar{display:flex;align-items:center;gap:10px;background:var(--surface);border:1.5px solid var(--border);border-radius:16px;padding:6px 6px 6px 18px;transition:all .3s cubic-bezier(.16,1,.3,1);box-shadow:var(--sh-sm);}
        .sbar:focus-within{border-color:var(--accent);box-shadow:0 0 0 4px rgba(153,69,255,.06),var(--sh-md);transform:translateY(-2px);}
        .sbar input{flex:1;border:none;outline:none;font-size:15px;font-family:var(--f);background:transparent;color:var(--text);padding:10px 0;}
        .sbar input::placeholder{color:#a09a90;}

        /* ═══ SECTION LABELS ═══ */
        .section-label{font-size:12px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:14px;font-family:var(--fm);}
        .vt{font-size:32px;font-weight:800;letter-spacing:-.7px;font-family:var(--fd);line-height:1.1;} .vs{color:var(--muted);font-size:16px;margin-bottom:22px;line-height:1.5;}

        /* ═══ TIMELINE ═══ */
        .dh{font-size:12px;font-weight:700;color:var(--muted);margin:24px 0 10px;padding-bottom:10px;border-bottom:1.5px solid var(--border);display:flex;justify-content:space-between;align-items:center;font-family:var(--fm);text-transform:uppercase;letter-spacing:.6px;}

        /* ═══ SORT DROPDOWN ═══ */
        .sdrop{position:absolute;top:100%;right:0;margin-top:6px;background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:6px;z-index:10;min-width:165px;box-shadow:var(--sh-lg);animation:cardIn .25s cubic-bezier(.16,1,.3,1);}
        .sopt{width:100%;padding:11px 14px;border:none;background:transparent;cursor:pointer;font-family:var(--f);font-size:13.5px;font-weight:500;color:var(--text);border-radius:11px;text-align:left;transition:all .15s;}
        .sopt:hover{background:var(--bg);transform:translateX(2px);} .sopt.on{font-weight:700;color:var(--accent);background:rgba(153,69,255,.04);}

        /* ═══ INCOGNITO BAR ═══ */
        .incog-bar{display:flex;align-items:center;gap:14px;margin-top:16px;padding:14px 18px;background:var(--bg);border-radius:16px;border:1px solid var(--border);font-size:18px;}

        /* ═══ FRIENDS ═══ */
        .friend-chip{display:flex;align-items:center;gap:7px;background:var(--surface);border-radius:100px;padding:5px 14px 5px 5px;cursor:pointer;font-size:12.5px;font-weight:600;transition:all .2s cubic-bezier(.16,1,.3,1);border:1px solid var(--border);box-shadow:var(--sh-sm);}
        .friend-chip:hover{border-color:var(--accent);box-shadow:var(--sh-glow);transform:translateY(-1px);}
        .friend-chip.vip{border-color:rgba(249,171,0,.25);background:linear-gradient(135deg,rgba(249,171,0,.06),rgba(153,69,255,.04));}
        .friend-chip.notable{border:1px dashed var(--border);}
        .friend-row{display:flex;align-items:center;gap:14px;background:var(--surface);border-radius:14px;padding:16px 20px;border:1px solid var(--border);cursor:pointer;transition:all .25s cubic-bezier(.16,1,.3,1);box-shadow:var(--sh-sm);}
        .friend-row:hover{border-color:rgba(153,69,255,.15);box-shadow:var(--sh-lg),var(--sh-glow);transform:translateY(-4px);}
        .friend-row:active{transform:translateY(-1px);box-shadow:var(--sh-sm);}
        .vip-row{border-color:rgba(249,171,0,.2);background:linear-gradient(135deg,rgba(249,171,0,.04),rgba(153,69,255,.02));box-shadow:0 0 0 1px rgba(249,171,0,.06),var(--sh-sm);}
        .vip-badge{font-size:10px;font-weight:700;color:#F9AB00;background:linear-gradient(135deg,rgba(249,171,0,.1),rgba(153,69,255,.06));padding:3px 9px;border-radius:100px;white-space:nowrap;border:1px solid rgba(249,171,0,.15);}
        .empty-msg{text-align:center;padding:48px 28px;color:var(--muted);font-size:14px;line-height:1.7;background:var(--surface);border-radius:20px;border:1.5px dashed var(--border);}

        /* ═══ TABS ═══ */
        .tab-bar{display:flex;gap:4px;margin-bottom:18px;background:var(--bg);border-radius:14px;padding:5px;border:1px solid var(--border);}
        .tab{flex:1;padding:12px 10px;border-radius:10px;border:none;background:transparent;font-size:13px;min-height:44px;font-weight:600;cursor:pointer;font-family:var(--f);color:var(--muted);transition:all .25s cubic-bezier(.16,1,.3,1);}
        .tab:hover{color:var(--text);}
        .tab.on{background:var(--dark);color:white;box-shadow:0 3px 12px rgba(17,17,24,.12);font-weight:700;}

        /* ═══ XP HERO ═══ */
        .xp-hero{position:relative;border-radius:22px;padding:24px;overflow:hidden;}
        .xp-hero-bg{position:absolute;inset:0;background:linear-gradient(145deg,#0d0d16 0%,#1a1040 35%,#0a2a1a 100%);border-radius:22px;border:1px solid rgba(153,69,255,.1);}
        .xp-hero-bg::before{content:'';position:absolute;inset:-1px;border-radius:22px;background:linear-gradient(135deg,rgba(153,69,255,.2),transparent 50%,rgba(20,241,149,.15));z-index:-1;filter:blur(1px);}
        .xp-hero-bg::after{content:'';position:absolute;inset:0;background:
          radial-gradient(ellipse at 80% 15%,rgba(153,69,255,.22) 0%,transparent 50%),
          radial-gradient(ellipse at 15% 85%,rgba(20,241,149,.14) 0%,transparent 50%),
          radial-gradient(circle at 50% 50%,rgba(255,255,255,.02) 0%,transparent 30%);border-radius:22px;}
        .xp-ll{font-size:10px;color:rgba(255,255,255,.4);text-transform:uppercase;letter-spacing:1.5px;font-weight:700;font-family:var(--fm);}
        .xp-ln{font-size:28px;font-weight:800;color:white;letter-spacing:-.5px;font-family:var(--fd);text-shadow:0 2px 12px rgba(0,0,0,.4);}
        .xp-badge{background:linear-gradient(135deg,#9945FF,#14F195);padding:8px 18px;border-radius:100px;font-size:16px;font-weight:800;color:white;font-family:var(--fm);box-shadow:0 4px 24px rgba(153,69,255,.35),inset 0 1px 0 rgba(255,255,255,.2);animation:float 3.5s ease-in-out infinite;}
        .xp-bar-bg{height:8px;background:rgba(255,255,255,.1);border-radius:100px;overflow:hidden;box-shadow:inset 0 1px 3px rgba(0,0,0,.2);}
        .xp-bar-fill{height:100%;background:linear-gradient(90deg,#9945FF,#14F195);border-radius:100px;transition:width 1s cubic-bezier(.16,1,.3,1);box-shadow:0 0 16px rgba(20,241,149,.35);animation:barFill 1.2s cubic-bezier(.16,1,.3,1) both;}

        /* ═══ QUEST CARDS ═══ */
        .quest-card{display:flex;align-items:center;gap:16px;background:var(--surface);border-radius:14px;padding:18px 20px;border:1.5px solid var(--border);transition:all .25s cubic-bezier(.16,1,.3,1);box-shadow:var(--sh-sm);}
        .quest-card:hover{border-color:rgba(153,69,255,.15);box-shadow:var(--sh-lg),var(--sh-glow);transform:translateY(-3px);}
        .quest-card:active{transform:translateY(0);}
        .quest-card.done{border-color:rgba(20,241,149,.25);background:linear-gradient(135deg,rgba(20,241,149,.04),rgba(153,69,255,.02));box-shadow:0 0 0 1px rgba(20,241,149,.08),var(--sh-sm);}
        .quest-icon{font-size:26px;width:46px;height:46px;display:flex;align-items:center;justify-content:center;background:var(--bg);border-radius:14px;flex-shrink:0;border:1px solid var(--border);transition:all .25s;}
        .quest-card:hover .quest-icon{transform:scale(1.06) rotate(-2deg);}
        .quest-card.done .quest-icon{background:linear-gradient(135deg,rgba(20,241,149,.08),rgba(153,69,255,.04));border-color:rgba(20,241,149,.2);box-shadow:0 0 10px rgba(20,241,149,.06);}
        .quest-title{font-size:14.5px;font-weight:700;letter-spacing:-.1px;font-family:var(--fd);}
        .quest-desc{font-size:12px;color:var(--muted);margin-top:3px;line-height:1.4;}
        .quest-xp{font-size:12.5px;font-weight:700;color:var(--accent);font-family:var(--fm);white-space:nowrap;padding:2px 8px;background:rgba(153,69,255,.05);border-radius:6px;}
        .quest-xp.done{color:#0A8F5A;background:rgba(20,241,149,.06);}
        .quest-check{width:26px;height:26px;border-radius:50%;background:linear-gradient(135deg,#14F195,#0A8F5A);color:white;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:800;flex-shrink:0;box-shadow:0 3px 12px rgba(10,143,90,.3);animation:countPop .4s cubic-bezier(.16,1,.3,1);}

        /* ═══ LEADERBOARD ═══ */
        .lb-card{background:var(--surface);border-radius:20px;border:1px solid var(--border);overflow:hidden;box-shadow:var(--sh-md);}
        .lb-row{display:flex;align-items:center;gap:12px;padding:13px 18px;border-bottom:1px solid var(--border);transition:all .15s;}
        .lb-row:last-child{border-bottom:none;}
        .lb-row.me{background:linear-gradient(135deg,rgba(153,69,255,.04),rgba(20,241,149,.03));border-left:3px solid var(--accent);}
        .lb-row:nth-child(1){background:linear-gradient(90deg,rgba(249,171,0,.06),rgba(249,171,0,.02),transparent 70%);position:relative;overflow:hidden;}
        .lb-row:nth-child(1)::after{content:'';position:absolute;top:0;width:60px;height:100%;background:linear-gradient(90deg,transparent,rgba(249,171,0,.06),transparent);animation:heroShine 4s ease-in-out infinite;}
        .lb-row:nth-child(1) .lb-rank{color:#D4A017;font-size:16px;text-shadow:0 1px 4px rgba(212,160,23,.2);}
        .lb-row:nth-child(2) .lb-rank{color:#A0A0A0;font-size:14px;}
        .lb-row:nth-child(3) .lb-rank{color:#CD7F32;font-size:14px;}
        .lb-rank{font-size:13px;font-weight:800;color:var(--muted);font-family:var(--fm);width:32px;text-align:center;}
        .lb-name{font-size:14px;font-weight:600;font-family:var(--fd);}
        .lb-xp{font-size:13px;font-weight:700;font-family:var(--fm);color:var(--accent);text-align:right;display:flex;flex-direction:column;align-items:flex-end;}
        .lb-lvl{font-size:9.5px;color:var(--muted);font-family:var(--f);font-weight:600;}

        /* ═══ PULSE ═══ */
        .pulse-ticker{display:flex;align-items:center;gap:12px;background:linear-gradient(135deg,#111118 0%,#171230 60%,#0a1a18 100%);color:white;border-radius:20px;padding:16px 20px;font-size:13px;overflow:hidden;box-shadow:0 6px 32px rgba(17,17,24,.2),inset 0 1px 0 rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.06);}
        .pulse-dot{width:10px;height:10px;border-radius:50%;background:#14F195;animation:pulseDot 1.5s ease infinite;flex-shrink:0;box-shadow:0 0 10px rgba(20,241,149,.5);}
        .pulse-live{font-size:10.5px;font-weight:800;color:#14F195;font-family:var(--fm);letter-spacing:2px;flex-shrink:0;animation:neonPulse 2.5s ease infinite;}
        .pulse-time{font-size:10px;color:rgba(255,255,255,.3);font-family:var(--fm);margin-left:6px;}
        .act-row{display:flex;align-items:center;gap:14px;background:var(--surface);border-radius:14px;padding:14px 18px;border:1px solid var(--border);box-shadow:var(--sh-sm);transition:all .25s cubic-bezier(.16,1,.3,1);}
        .act-row:hover{box-shadow:var(--sh-md);transform:translateY(-2px);}
        .trend-num{font-size:22px;font-weight:900;background:linear-gradient(135deg,var(--accent),var(--accent2));-webkit-background-clip:text;-webkit-text-fill-color:transparent;font-family:var(--fm);width:38px;text-align:center;}

        /* ═══ PROFILE ═══ */
        .profile-hero{position:relative;border-radius:24px;padding:26px;margin-top:16px;margin-bottom:22px;overflow:hidden;}
        .profile-hero-bg{position:absolute;inset:0;background:linear-gradient(145deg,#0d0d16 0%,#1a1040 45%,#0a2a1a 100%);border-radius:22px;border:1px solid rgba(153,69,255,.1);}
        .profile-hero-bg::before{content:'';position:absolute;inset:-1px;border-radius:22px;background:linear-gradient(135deg,rgba(153,69,255,.2),transparent 50%,rgba(20,241,149,.15));z-index:-1;filter:blur(1px);}
        .profile-hero-bg::after{content:'';position:absolute;inset:0;background:
          radial-gradient(ellipse at 70% 25%,rgba(153,69,255,.18) 0%,transparent 50%),
          radial-gradient(ellipse at 25% 75%,rgba(20,241,149,.12) 0%,transparent 50%);border-radius:22px;}
        .prof-stat{font-size:11px;font-weight:700;color:rgba(255,255,255,.75);background:rgba(255,255,255,.08);padding:4px 12px;border-radius:100px;backdrop-filter:blur(4px);border:1px solid rgba(255,255,255,.06);}
        .stat-box{background:var(--surface);border-radius:16px;padding:14px 12px;text-align:center;border:1px solid var(--border);box-shadow:var(--sh-sm);transition:all .2s;}
        .stat-box:hover{box-shadow:var(--sh-md);transform:translateY(-2px);}
        .stat-num{font-size:22px;font-weight:800;font-family:var(--fm);animation:countPop .5s cubic-bezier(.16,1,.3,1) both;}
        .stat-label{font-size:11px;color:var(--muted);margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}

        /* ═══ BOTTOM NAV ═══ */
        .bnav{position:fixed;bottom:0;left:0;right:0;max-width:860px;margin:0 auto;background:var(--nav-bg);backdrop-filter:blur(28px) saturate(1.5);-webkit-backdrop-filter:blur(28px) saturate(1.5);border-top:1px solid var(--border);display:flex;padding:6px 16px calc(10px + env(safe-area-inset-bottom, 0px));gap:2px;z-index:50;}
        .bnav button{flex:1;padding:10px 4px 8px;border-radius:12px;border:none;background:transparent;cursor:pointer;font-family:var(--f);font-size:11px;font-weight:600;color:var(--muted);display:flex;flex-direction:column;align-items:center;gap:3px;transition:all .25s cubic-bezier(.16,1,.3,1);position:relative;}
        .bnav button:active{transform:scale(.92);}
        .bnav button.on{color:var(--accent);font-weight:700;background:linear-gradient(135deg,rgba(153,69,255,.1),rgba(20,241,149,.05));border:1px solid rgba(153,69,255,.15);}
        .bnav button.on::after{content:'';width:20px;height:3px;border-radius:100px;background:linear-gradient(90deg,var(--accent),var(--accent2));box-shadow:0 0 8px rgba(153,69,255,.4);}
        .fab{width:54px;height:54px;border-radius:50%;background:linear-gradient(135deg,#9945FF 0%,#7B3FD9 35%,#14F195 100%);border:2px solid rgba(255,255,255,.15);cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 6px 28px rgba(153,69,255,.35),0 0 56px rgba(20,241,149,.1),inset 0 1px 0 rgba(255,255,255,.2);margin-top:-20px;transition:all .3s cubic-bezier(.16,1,.3,1);font-size:26px;color:white;position:relative;overflow:hidden;}
        .fab::before{content:'';position:absolute;inset:0;border-radius:50%;background:linear-gradient(90deg,transparent,rgba(255,255,255,.1),transparent);background-size:200% 100%;animation:shimmer 3s linear infinite;}
        .fab:hover{transform:scale(1.14) translateY(-2px);box-shadow:0 6px 36px rgba(153,69,255,.4),0 0 64px rgba(20,241,149,.12);}
        .fab:active{transform:scale(.9);}

        /* ═══ QUEST POPUP ═══ */
        .quest-popup{position:fixed;top:56px;left:50%;transform:translateX(-50%);z-index:9998;animation:questPop .65s cubic-bezier(.16,1,.3,1);background:linear-gradient(145deg,#0f0f1a,#1e1245,#0a2a1a);color:white;padding:24px 32px;border-radius:22px;text-align:center;box-shadow:0 16px 56px rgba(153,69,255,.35),0 0 0 1px rgba(153,69,255,.15),inset 0 1px 0 rgba(255,255,255,.06);backdrop-filter:blur(12px);}

        /* ═══ HOST CODE ═══ */
        .host-code-card{background:var(--bg);border-radius:22px;padding:32px;border:1.5px solid var(--border);box-shadow:var(--sh-md);}
        .host-code{display:flex;gap:10px;justify-content:center;margin:14px 0;}
        .host-code-char{display:inline-flex;align-items:center;justify-content:center;width:48px;height:60px;background:var(--dark);color:#14F195;font-size:28px;font-weight:900;font-family:var(--fm);border-radius:14px;animation:charPop .4s cubic-bezier(.16,1,.3,1) both;box-shadow:var(--sh-lg);text-shadow:0 0 12px rgba(20,241,149,.3);}
        .host-code-event{margin-top:18px;padding:12px 18px;background:var(--surface);border-radius:14px;border:1px solid var(--border);font-size:15px;font-weight:600;box-shadow:var(--sh-sm);font-family:var(--fd);}

        /* ═══ CHECKIN ═══ */
        .checkin-input{width:100%;padding:20px;font-size:32px;font-weight:900;font-family:var(--fm);text-align:center;letter-spacing:14px;border:2.5px solid var(--border);border-radius:20px;background:var(--bg);color:var(--heading);outline:none;transition:all .3s cubic-bezier(.16,1,.3,1);text-transform:uppercase;}
        .checkin-input:focus{border-color:var(--accent);box-shadow:0 0 0 5px rgba(153,69,255,.06),0 4px 24px rgba(153,69,255,.06);}
        .verified-banner{text-align:center;padding:16px;background:linear-gradient(135deg,rgba(153,69,255,.04),rgba(20,241,149,.06));border:1.5px solid rgba(20,241,149,.2);border-radius:18px;font-size:16px;font-weight:700;color:#0A8F5A;font-family:var(--fd);}
        .checkin-done{padding:28px;}
        .checkin-done-icon{width:64px;height:64px;border-radius:50%;background:linear-gradient(135deg,#14F195,#0A8F5A);color:white;display:flex;align-items:center;justify-content:center;font-size:28px;font-weight:800;margin:0 auto;box-shadow:0 4px 24px rgba(10,143,90,.3),0 0 48px rgba(20,241,149,.15);animation:countPop .5s cubic-bezier(.16,1,.3,1);}

        /* ═══ ACCESSIBILITY ═══ */
        @media(prefers-reduced-motion:reduce){
          *,.ev-card,.btn-glow,.btn-checkin,.fab,.quest-popup,.checkin-done-icon,.skel{animation:none!important;transition-duration:0.01ms!important;}
          .root::before{animation:none!important;}
          .pulse-dot{animation:none!important;}
        }
        .modal{role:dialog;}
      `}</style>
      <Toasts toasts={toasts}/>
      {questPop && <div className="quest-popup"><div style={{fontSize:44,marginBottom:8,animation:"wiggle .6s ease .2s both,float 2s ease-in-out .8s infinite"}}>{questPop.icon}</div><div style={{fontSize:18,fontWeight:800,letterSpacing:"-.2px",fontFamily:"var(--fd)",animation:"fadeUp .3s .15s both"}}>Quest Complete!</div><div style={{fontSize:14,fontWeight:600,opacity:.7,marginTop:3,animation:"fadeUp .3s .2s both"}}>{questPop.title}</div><div style={{fontSize:16,color:"#14F195",fontWeight:800,fontFamily:"var(--fm)",marginTop:10,background:"rgba(20,241,149,.12)",padding:"6px 18px",borderRadius:100,display:"inline-block",border:"1px solid rgba(20,241,149,.2)",animation:"scaleIn .4s .3s both"}}>+{questPop.xp} XP</div></div>}

      {/* HEADER */}
      <div style={{position:"relative",zIndex:1}}>
        <div style={{padding:"calc(16px + env(safe-area-inset-top, 0px)) 20px 12px",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <div style={{display:"flex",alignItems:"center",gap:9}}>
            <div style={{width:32,height:32,borderRadius:11,background:"linear-gradient(135deg,#9945FF,#14F195)",display:"flex",alignItems:"center",justifyContent:"center",boxShadow:"0 2px 12px rgba(153,69,255,.2)",animation:"float 4s ease-in-out infinite"}}><SolIc/></div>
            <div>
              <span style={{fontFamily:"var(--fd)",fontWeight:800,fontSize:15,letterSpacing:"-.2px",color:"var(--heading)",display:"block",lineHeight:1}}>SIDE.SOL</span>
              <span style={{fontFamily:"var(--fm)",fontSize:9,color:"var(--muted)",letterSpacing:".5px"}}>{cd?.short?.toUpperCase()} 2026</span>
            </div>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:6}}>
            <button className="ib" onClick={() => setDark(d => !d)} style={{fontSize:16,width:34,height:34,borderRadius:10}} title="Toggle dark mode">{dark ? "☀️" : "🌙"}</button>
            {user ? (
              <button onClick={() => setView("profile")} style={{display:"flex",alignItems:"center",gap:8,padding:"7px 16px 7px 7px",borderRadius:100,background:dark?"var(--surface2)":"var(--dark)",color:dark?"var(--text)":"white",border:dark?"1px solid var(--border)":"none",cursor:"pointer",fontSize:12.5,fontWeight:700,fontFamily:"var(--fd)",boxShadow:"var(--sh-sm)",transition:"all .25s cubic-bezier(.16,1,.3,1)"}}>
                {user.pfp ? <img src={user.pfp} alt="" style={{width:24,height:24,borderRadius:"50%",objectFit:"cover"}}/> : <div style={{width:24,height:24,borderRadius:"50%",background:"linear-gradient(135deg,#9945FF,#14F195)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:800,color:"white"}}>{user.name[0]}</div>}
                {user.name}
                <span style={{fontSize:10,color:"#14F195",fontFamily:"var(--fm)",background:"rgba(20,241,149,.12)",padding:"2px 8px",borderRadius:100,border:"1px solid rgba(20,241,149,.12)",animation:"subtleBounce 2s ease infinite"}}>{totalXP}</span>
              </button>
            ) : <button className="btn-sm" onClick={() => setShowAuth(true)} style={{padding:"9px 20px",fontSize:13.5}}>Sign In</button>}
          </div>
        </div>
        <div style={{height:2,background:"linear-gradient(90deg,transparent,#9945FF40,#14F19540,#F9AB0020,transparent)",backgroundSize:"200% 100%",animation:"gradientFlow 4s linear infinite",margin:"0 20px"}}/>
      </div>

      <div style={{padding:"0 18px",position:"relative",zIndex:1}}>
        {/* HOME */}
        {view === "home" && (
          <div className="anim-in">
            <div style={{margin:"14px 0 6px"}}>
              <h1 style={{fontSize:24,fontWeight:900,letterSpacing:"-.6px",fontFamily:"var(--fd)",lineHeight:1.1}}>Discover <span style={{background:"linear-gradient(135deg,#9945FF,#6B2FD9,#14F195)",backgroundSize:"200% 100%",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",backgroundClip:"text",animation:"gradientFlow 5s linear infinite"}}>side events</span></h1>
              <p style={{color:"var(--muted)",fontSize:12.5,marginTop:4,display:"flex",alignItems:"center",gap:5}}><span style={{width:6,height:6,borderRadius:"50%",background:"#14F195",flexShrink:0,animation:"pulseDot 2s ease infinite"}}/>{cd?.loc} · {cd?.dates}</p>
            </div>
            <div className="scr" style={{gap:6,marginBottom:10}}>{CONFS.map(c => <button key={c.id} onClick={() => { setConf(c.id); setCatF("All"); setDateF("All"); }} style={{padding:"8px 16px",borderRadius:100,border:conf===c.id?"none":"1px solid var(--border)",background:conf===c.id?"var(--dark)":"var(--surface)",color:conf===c.id?"white":"var(--text)",cursor:"pointer",fontFamily:"var(--f)",fontSize:12,fontWeight:conf===c.id?700:500,whiteSpace:"nowrap",transition:"all .2s",display:"flex",alignItems:"center",gap:5,boxShadow:conf===c.id?"0 2px 8px rgba(0,0,0,.1)":"none"}}><span style={{fontSize:14}}>{c.emoji}</span>{c.short}</button>)}</div>
            <div style={{display:"flex",gap:6,marginBottom:8}}>
              <div className="sbar" style={{flex:1,padding:"3px 3px 3px 14px"}}><span style={{color:"var(--muted)",fontSize:13}}>🔍</span><input placeholder="Search events, hosts..." value={search} onChange={e => setSearch(e.target.value)} style={{padding:"7px 0"}}/>{search && <button className="ib-sm" onClick={() => setSearch("")}>✕</button>}</div>
              <button className="btn-sm" onClick={() => setShowFilters(!showFilters)} style={{flexShrink:0,fontSize:12,background:showFilters||(catF!=="All"||dateF!=="All")?"var(--accent)":"var(--dark)",padding:"10px 16px"}}>Filter{(catF!=="All"||dateF!=="All")?" ✓":""}</button>
            </div>
            {showFilters && <>
              <div className="scr" style={{marginBottom:4}}>{["All",...Object.keys(CATS)].map(c => <button key={c} className={`tag ${catF===c?"on":""}`} style={{padding:"5px 12px",fontSize:11.5}} onClick={() => setCatF(c)}>{c!=="All"?(CATS[c]?.em+" "):""}{c}</button>)}</div>
              <div className="scr" style={{marginBottom:6}}><button className={`tag ${dateF==="All"?"on":""}`} style={{padding:"5px 12px",fontSize:11.5}} onClick={() => setDateF("All")}>All days</button>{uDates.map(d => <button key={d} className={`tag ${dateF===d?"on":""}`} style={{padding:"5px 12px",fontSize:11.5}} onClick={() => setDateF(d)}>{fd(d)}</button>)}</div>
            </>}

            {/* ═══ FRIENDS GOING — Surface the killer feature ═══ */}
            {user && friends.length > 0 && (() => {
              const friendEvs = cevs.filter(ev => fGoing(ev.id).length > 0).slice(0, 4);
              return friendEvs.length > 0 ? (
                <div style={{marginBottom:12,padding:"14px 16px",background:"linear-gradient(135deg,rgba(153,69,255,.05),rgba(20,241,149,.03))",borderRadius:18,border:"1px solid rgba(153,69,255,.1)"}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                    <p style={{fontSize:12,fontWeight:700,fontFamily:"var(--fm)",color:"var(--accent)",textTransform:"uppercase",letterSpacing:".8px"}}>👥 Friends are going</p>
                    <button style={{fontSize:11,fontWeight:600,color:"var(--accent)",background:"none",border:"none",cursor:"pointer",fontFamily:"var(--f)"}} onClick={() => { setView("friends"); setFriendsTab("overlap"); }}>See all →</button>
                  </div>
                  <div style={{display:"flex",gap:10,overflowX:"auto",paddingBottom:4}} className="scr">
                    {friendEvs.map(ev => {
                      const cat = CATS[ev.cat] || CATS.Other;
                      const fg = fGoing(ev.id);
                      return (
                        <div key={ev.id} onClick={() => setSel(ev)} style={{minWidth:200,flexShrink:0,background:cbg(cat),borderRadius:14,padding:"12px 14px",borderLeft:`3px solid ${cat.ac}`,cursor:"pointer",transition:"all .2s",boxShadow:"var(--sh-sm)"}}>
                          <div style={{display:"flex",gap:4,marginBottom:4}}>
                            {fg.slice(0,4).map((fr,j) => <div key={fr.handle} style={{marginLeft:j?-6:0,zIndex:4-j}}><Avatar name={fr.name} s={20} bg={uc(fr.handle)} pfp={fr.pfp}/></div>)}
                          </div>
                          <p style={{fontSize:13,fontWeight:700,fontFamily:"var(--fd)",color:"var(--heading)",lineHeight:1.2,marginBottom:2}}>{ev.title}</p>
                          <p style={{fontSize:10,color:"var(--muted)",fontFamily:"var(--fm)"}}>{fd(ev.date)} · {fg.length} friend{fg.length!==1?"s":""}</p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null;
            })()}

            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",margin:"2px 0 8px"}}>
              <span style={{fontSize:11,color:"var(--muted)",fontFamily:"var(--fm)"}}>{sortedEvs.length} event{sortedEvs.length!==1?"s":""}</span>
              <div style={{display:"flex",alignItems:"center",gap:2}}>
                {[{id:"grid",icon:"⊞",tip:"Grid"},{id:"timeline",icon:"☰",tip:"Timeline"},{id:"calendar",icon:"📅",tip:"Calendar"},...(user&&rsvps.length>0?[{id:"schedule",icon:"🗓",tip:"My Schedule"}]:[])].map(v => (
                  <button key={v.id} className="ib-sm" onClick={() => setLayout(v.id)} title={v.tip} style={{opacity:layout===v.id?1:.45,background:layout===v.id?"var(--surface2)":"transparent",fontSize:14}}>{v.icon}</button>
                ))}
                <div style={{width:1,height:16,background:"var(--border)",margin:"0 3px"}}/>
                <div style={{position:"relative"}} ref={sortRef}>
                  <button className="ib-sm" onClick={() => setShowSort(!showSort)}>⇅</button>
                  {showSort && <div className="sdrop">{[{id:"date",l:"By date"},{id:"popular",l:"Popular"},{id:"newest",l:"Recent"}].map(s => <button key={s.id} className={`sopt ${sort===s.id?"on":""}`} onClick={() => { setSort(s.id); setShowSort(false); }}>{s.l}{sort===s.id?" ✓":""}</button>)}</div>}
                </div>
              </div>
            </div>
            {layout === "schedule" ? (() => {
              const myEvs = events.filter(e => rsvps.includes(e.id) && e.conf === conf).sort((a,b) => a.date.localeCompare(b.date) || (a.time||"").localeCompare(b.time||""));
              const myGrouped = {}; myEvs.forEach(e => { (myGrouped[e.date] = myGrouped[e.date] || []).push(e); });
              return myEvs.length === 0 ? <div className="empty-msg">🗓<br/><br/><strong>No events in your schedule</strong><br/>RSVP to events to build your schedule</div>
                : <div>
                  <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:16,padding:"12px 16px",background:"linear-gradient(135deg,rgba(153,69,255,.06),rgba(20,241,149,.04))",borderRadius:16,border:"1px solid rgba(153,69,255,.1)"}}>
                    <span style={{fontSize:20}}>🗓</span>
                    <div><p style={{fontSize:14,fontWeight:700,fontFamily:"var(--fd)"}}>My Schedule</p><p style={{fontSize:11,color:"var(--muted)"}}>{myEvs.length} event{myEvs.length!==1?"s":""} across {Object.keys(myGrouped).length} day{Object.keys(myGrouped).length!==1?"s":""}</p></div>
                  </div>
                  {Object.keys(myGrouped).sort().map(date => {
                    const fg = myGrouped[date].flatMap(ev => fGoing(ev.id));
                    const uniqueFriends = [...new Map(fg.map(f => [f.handle, f])).values()];
                    return <div key={date}>
                      <div className="dh">{dl(date)}<span style={{fontSize:10,background:"var(--surface)",padding:"3px 9px",borderRadius:100,border:"1px solid var(--border)"}}>{myGrouped[date].length}</span></div>
                      {uniqueFriends.length > 0 && <div style={{display:"flex",gap:4,marginBottom:8,flexWrap:"wrap"}}>{uniqueFriends.slice(0,5).map(fr => <span key={fr.handle} style={{fontSize:10,color:"var(--accent)",fontWeight:600}}>👥 {fr.name.split(" ")[0]}</span>)}{uniqueFriends.length > 5 && <span style={{fontSize:10,color:"var(--muted)"}}>+{uniqueFriends.length-5} more</span>}</div>}
                      <div style={{display:"flex",flexDirection:"column",gap:10}}>{myGrouped[date].map((ev,i) => renderCard(ev,i,true))}</div>
                    </div>;
                  })}
                </div>;
            })()
            : layout === "calendar" ? renderCalendar()
            : eventsLoading ? <div style={{display:"flex",flexDirection:"column",gap:16}}>{[0,1,2].map(i => <SkeletonCard key={i}/>)}</div>
            : sortedEvs.length === 0 ? <div className="empty-msg">🔍<br/><br/><strong style={{fontSize:18}}>No events found</strong><br/>Try adjusting your filters or create one with +</div>
              : layout === "grid" ? <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(260px,1fr))",gap:16}}>{sortedEvs.map((ev,i) => renderCard(ev,i,false))}</div>
              : <div>{Object.keys(grouped).sort().map(date => <div key={date}><div className="dh">{dl(date)}<span style={{fontSize:10,background:"var(--surface)",padding:"3px 9px",borderRadius:100,border:"1px solid var(--border)"}}>{grouped[date].length}</span></div><div style={{display:"flex",flexDirection:"column",gap:14}}>{grouped[date].map((ev,i) => renderCard(ev,i,true))}</div></div>)}</div>}
          </div>
        )}
        {view === "pulse" && renderPulse()}
        {view === "friends" && renderFriends()}
        {view === "profile" && renderProfile()}
      </div>

      {/* BOTTOM NAV */}
      <div className="bnav">
        <button className={view==="home"?"on":""} onClick={() => setView("home")}><span style={{fontSize:17}}>🔍</span><span>Explore</span></button>
        <button className={view==="pulse"?"on":""} onClick={() => setView("pulse")}><span style={{fontSize:17}}>📢</span><span>Activity</span></button>
        <button onClick={() => { if(!user) { setShowAuth(true); toast("Sign in first","info"); } else { setEditing(null); setShowSubmit(true); } }} style={{padding:0}}><div className="fab">+</div></button>
        <button className={view==="friends"?"on":""} onClick={() => setView("friends")} style={{position:"relative"}}><span style={{fontSize:17}}>👥</span><span>Network</span>{friendRequests.length > 0 && <span style={{position:"absolute",top:4,right:"calc(50% - 20px)",width:16,height:16,borderRadius:"50%",background:"#FF7043",color:"white",fontSize:9,fontWeight:800,display:"flex",alignItems:"center",justifyContent:"center",boxShadow:"0 2px 6px rgba(255,112,67,.4)"}}>{friendRequests.length}</span>}</button>
        <button className={view==="profile"?"on":""} onClick={() => setView("profile")}><span style={{fontSize:17}}>🏆</span><span>Profile</span></button>
      </div>

      {/* MODALS */}
      {sel && renderDetail(sel)}
      {(showSubmit || editing) && <SubmitModal initial={editing ? {id:editing.id,title:editing.title,cat:editing.cat,date:editing.date,time:editing.time,loc:editing.loc,host:editing.host,desc:editing.desc,rsvp:editing.rsvp,luma:editing.luma,conf:editing.conf} : null} onClose={() => { setShowSubmit(false); setEditing(null); }}/>}
      {friendView && renderFriendProfile(friendView)}
      {showCheckin && renderCheckinModal(showCheckin)}
      {showHostCode && <HostCodeDisplay ev={showHostCode} onClose={() => setShowHostCode(null)} onCopy={async (code) => { const ok = await copyText(code); toast(ok?"Code copied!":"Failed","info"); }}/>}
      {showPrivacy && (<>
        <div className="overlay" onClick={() => setShowPrivacy(false)}/>
        <div className="modal" role="dialog">
          <div className="mh"><h2 className="mt">Privacy</h2><button className="ib" aria-label="Close" onClick={() => setShowPrivacy(false)}>✕</button></div>
          <div style={{display:"flex",flexDirection:"column",gap:12}}>
            <div className="incog-bar">
              <span>{privacy.profilePublic ? "👁" : "🔒"}</span>
              <div style={{flex:1}}><p style={{fontSize:13,fontWeight:600}}>Public profile</p><p style={{fontSize:11,color:"var(--muted)"}}>Anyone can see your RSVPs</p></div>
              <div onClick={() => setPrivacy(p => ({...p, profilePublic: !p.profilePublic}))} className="tog" data-on={privacy.profilePublic}><div className="tog-t" style={{transform:privacy.profilePublic?"translateX(20px)":"translateX(0)"}}/></div>
            </div>
            <div className="incog-bar" style={{flexDirection:"column",alignItems:"stretch",gap:8}}>
              <div style={{display:"flex",alignItems:"center",gap:10}}><span>👻</span><div style={{flex:1}}><p style={{fontSize:13,fontWeight:600}}>Hidden events ({incog.length})</p><p style={{fontSize:11,color:"var(--muted)"}}>Invisible to friends</p></div></div>
              {incog.length > 0 && <div style={{display:"flex",flexWrap:"wrap",gap:4}}>{incog.map(eid => { const ev = events.find(e => e.id === eid); return ev ? <span key={eid} className="pill" style={{background:"var(--surface)",border:"1px solid var(--border)",cursor:"pointer"}} onClick={() => togIncog(eid)}>{ev.title} ✕</span> : null; })}</div>}
            </div>
          </div>
        </div>
      </>)}
      {showOnboarding && (<>
        <div className="overlay" onClick={() => {}}/>
        <div className="modal" style={{maxHeight:"75vh",textAlign:"center"}}>
          {onboardStep === 0 ? (
            <div style={{padding:"24px 8px",animation:"fadeUp .4s ease both"}}>
              <div style={{width:64,height:64,borderRadius:20,background:"linear-gradient(135deg,#9945FF,#14F195)",display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 20px",boxShadow:"0 8px 32px rgba(153,69,255,.3)",animation:"float 2.5s ease-in-out infinite"}}><SolIc/></div>
              <h2 style={{fontSize:26,fontWeight:800,fontFamily:"var(--fd)",letterSpacing:"-.4px",marginBottom:6}}>Welcome to SIDE.SOL</h2>
              <p style={{color:"var(--muted)",fontSize:15,lineHeight:1.6,maxWidth:320,margin:"0 auto 8px"}}>The side event app for Solana conferences</p>
              <div style={{display:"flex",flexDirection:"column",gap:12,margin:"24px 0",textAlign:"left",maxWidth:300,marginLeft:"auto",marginRight:"auto"}}>
                <div style={{display:"flex",gap:12,alignItems:"center"}}><span style={{fontSize:22,width:36,textAlign:"center"}}>🔍</span><div><p style={{fontSize:14,fontWeight:700,fontFamily:"var(--fd)"}}>Find events</p><p style={{fontSize:12,color:"var(--muted)"}}>Browse, RSVP, and build your schedule</p></div></div>
                <div style={{display:"flex",gap:12,alignItems:"center"}}><span style={{fontSize:22,width:36,textAlign:"center"}}>👥</span><div><p style={{fontSize:14,fontWeight:700,fontFamily:"var(--fd)"}}>Find your people</p><p style={{fontSize:12,color:"var(--muted)"}}>See which friends are going where</p></div></div>
                <div style={{display:"flex",gap:12,alignItems:"center"}}><span style={{fontSize:22,width:36,textAlign:"center"}}>⚡</span><div><p style={{fontSize:14,fontWeight:700,fontFamily:"var(--fd)"}}>Earn XP</p><p style={{fontSize:12,color:"var(--muted)"}}>Check in at events, complete quests</p></div></div>
              </div>
              {user ? (
                <button className="btn-glow" onClick={() => setOnboardStep(1)} style={{padding:"15px 44px",fontSize:16,width:"100%",maxWidth:320}}>Next</button>
              ) : (
                <button className="btn-glow" onClick={() => { setShowOnboarding(false); saveState("onboarded", true); setShowAuth(true); }} style={{padding:"15px 44px",fontSize:16,width:"100%",maxWidth:320}}>Sign in with X to start</button>
              )}
              <button style={{background:"none",border:"none",color:"var(--muted)",cursor:"pointer",marginTop:12,fontSize:12,fontFamily:"var(--f)"}} onClick={() => { setShowOnboarding(false); saveState("onboarded", true); }}>Browse first</button>
            </div>
          ) : (
            <div style={{padding:"24px 8px",animation:"fadeUp .4s ease both"}}>
              <div style={{fontSize:48,marginBottom:12,animation:"float 2s ease-in-out infinite"}}>👥</div>
              <h2 style={{fontSize:22,fontWeight:800,fontFamily:"var(--fd)",letterSpacing:"-.3px",marginBottom:6}}>Add your first friend</h2>
              <p style={{color:"var(--muted)",fontSize:14,lineHeight:1.6,maxWidth:300,margin:"0 auto 20px"}}>Type their X handle to see which events they're attending. Share your profile so they can add you back.</p>
              <div style={{display:"flex",gap:8,maxWidth:320,margin:"0 auto 16px"}}>
                <div className="sbar" style={{flex:1}}>
                  <span style={{color:"var(--muted)",fontFamily:"var(--fm)",fontSize:14}}>@</span>
                  <input placeholder="Their X handle..." value={addFQ} onChange={e => setAddFQ(e.target.value)}
                    onKeyDown={e => { if(e.key==="Enter"&&addFQ) { addFriend(addFQ); setAddFQ(""); } }}/>
                </div>
                <button className="btn-sm" onClick={() => { if(addFQ) { addFriend(addFQ); setAddFQ(""); } }} style={{padding:"10px 20px"}}>Add</button>
              </div>
              {friends.length > 0 && <div style={{display:"flex",gap:6,justifyContent:"center",flexWrap:"wrap",marginBottom:16}}>
                {friends.slice(0,5).map(fr => <div key={fr.handle} className="friend-chip"><Avatar name={fr.name} s={18} bg={uc(fr.handle)} pfp={fr.pfp}/><span>{fr.name}</span></div>)}
              </div>}
              <button className="btn-glow" onClick={() => { setShowOnboarding(false); saveState("onboarded", true); }} style={{padding:"15px 44px",fontSize:16,width:"100%",maxWidth:320}}>{friends.length > 0 ? "Let's go!" : "Skip for now"}</button>
            </div>
          )}
        </div>
      </>)}
      {showAuth && (<>
        <div className="overlay" onClick={() => setShowAuth(false)}/>
        <div className="modal" style={{maxHeight:"62vh"}}>
          <div style={{textAlign:"center",marginBottom:24}}>
            <div style={{width:52,height:52,borderRadius:16,background:"linear-gradient(135deg,#9945FF,#14F195)",margin:"0 auto 12px",display:"flex",alignItems:"center",justifyContent:"center",boxShadow:"0 6px 24px rgba(153,69,255,.25)"}}><SolIc/></div>
            <h2 style={{fontSize:20,fontWeight:800,letterSpacing:"-.3px"}}>Welcome to SIDE.SOL</h2>
            <p style={{color:"var(--muted)",fontSize:13,marginTop:4,lineHeight:1.5}}>Unlock Side Quests, earn XP, climb the leaderboard</p>
          </div>
          <button onClick={() => handleAuth("x")} style={{width:"100%",padding:"14px",borderRadius:14,background:"var(--dark)",color:"white",border:"none",cursor:"pointer",fontSize:15,fontWeight:700,fontFamily:"var(--f)",display:"flex",alignItems:"center",justifyContent:"center",gap:8,boxShadow:"0 2px 12px rgba(0,0,0,.1)",transition:"all .2s"}}>
            <XI s={16}/> Continue with X
          </button>
          <div style={{display:"flex",alignItems:"center",gap:12,margin:"18px 0",color:"#b8b4ac",fontSize:12}}>
            <div style={{flex:1,height:1,background:"var(--border)"}}/> or <div style={{flex:1,height:1,background:"var(--border)"}}/>
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:10}}>
            <input className="field" placeholder="Display name" autoComplete="name" value={af.name} onChange={e => setAf({...af, name: e.target.value})}/>
            <input className="field" placeholder="Email" type="email" autoComplete="email" value={af.email} onChange={e => setAf({...af, email: e.target.value})}/>
            <button className="btn-glow" onClick={() => handleAuth("email")} style={{width:"100%",padding:"14px",fontSize:15}}>Continue with Email</button>
          </div>
        </div>
      </>)}
    </div>
  );
}
