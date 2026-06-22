import { useState, useEffect, useRef, useCallback, createContext, useContext } from "react";
import { api } from "./api/index";
import { AreaChart, Area, BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ZAxis } from "recharts";
import { Users, BarChart3, MessageSquare, Zap, Settings, LogOut, ChevronRight, Search, Plus, ArrowUpRight, ArrowDownRight, Eye, Send, CheckCheck, Clock, Star, Crown, UserPlus, UserMinus, Gift, TrendingUp, Bell, Menu, X, ChevronLeft, Mail, Phone, Building, Globe, CreditCard, Shield, Palette, Play, Edit, Target, Heart, Check, LayoutDashboard, Image, Paperclip, FileText, ArrowLeft, RefreshCw, CircleCheck, Info, WifiOff, Database, Brain, Activity, AlertTriangle, Table, Terminal, Layers, Download, Wifi, Tag, Link, Type, MousePointer, Cpu, Award, Repeat, RotateCcw, Sliders, Gift as GiftIcon, Star as StarIcon, Zap as ZapIcon, ChevronDown, ChevronUp, Hash, DollarSign, ShoppingBag, MoreVertical, Filter, Copy, Trash2, Smartphone, Lock, ShoppingCart, Receipt, Printer, CheckCircle, XCircle, Wifi as WifiIcon, QrCode, ScanLine, ExternalLink, UserCheck } from "lucide-react";

// ════════════════════════════════════════════════════════════════
// SCHEMA ENUMS (mirrors Prisma schema)
// ════════════════════════════════════════════════════════════════
const SEG_COLORS = { NEW:"#3b82f6", LOYAL:"#22c55e", VIP:"#f59e0b", AT_RISK:"#ef4444", LOST:"#6b7280", BIG_SPENDER:"#06b6d4", COUPON_HUNTER:"#ec4899" };
const STATUS_COLORS = { PENDING:"#f59e0b", QUEUED:"#3b82f6", SENT:"#22c55e", DELIVERED:"#10b981", READ:"#06b6d4", FAILED:"#ef4444", CONSENT_REVOKED:"#6b7280", DROPPED_COOLDOWN:"#8b5cf6", DROPPED_QUOTA:"#f97316" };
const ROLE_COLORS = { PLATFORM_ADMINISTRATOR:"#ef4444", TENANT_OWNER:"#f59e0b", BRANCH_MANAGER:"#8b5cf6", CASHIER:"#3b82f6", MARKETING_STAFF:"#22c55e", CUSTOMER:"#06b6d4" };
const TIER_COLORS = { FREE:"#6b7280", STARTER:"#3b82f6", GROWTH:"#22c55e", PROFESSIONAL:"#8b5cf6", ENTERPRISE:"#f59e0b" };
const C = { primary:"#8b5cf6", accent:"#06b6d4", green:"#22c55e", red:"#ef4444", amber:"#f59e0b", pink:"#ec4899", blue:"#3b82f6" };

// ── Global design tokens ──────────────────────────────────────────
const GS  = "rgba(255,255,255,0.08)";
const GSB = "1px solid rgba(255,255,255,0.18)";
const BG  = "linear-gradient(135deg,#080612 0%,#0f0a1e 50%,#080d1a 100%)";
const INP = { background:"rgba(255,255,255,0.07)", border:"1px solid rgba(255,255,255,0.15)" };
const CARD: React.CSSProperties = {
  background:"rgba(255,255,255,0.07)",
  backdropFilter:"blur(16px)",
  WebkitBackdropFilter:"blur(16px)",
  borderRadius:"16px",
  border:"1px solid rgba(255,255,255,0.18)",
  boxShadow:"0 8px 32px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.25), inset 0 -1px 0 rgba(255,255,255,0.05)",
};

// ════════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════════
const timeAgo = (d: string | Date) => {
  const diff = Date.now() - new Date(d).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "Just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hr ago`;
  return `${Math.floor(h / 24)} days ago`;
};

// Map API customer to UI shape
const mapCustomer = (c: any) => ({
  id:           c.id,
  name:         c.fullName,
  phone:        c.phone ?? c.whatsappNumber ?? "",
  email:        c.email ?? "",
  visits:       c.visitCount ?? 0,
  lastVisit:    c.lastVisitAt ? timeAgo(c.lastVisitAt) : "Never",
  spent:        Number(c.totalSpend ?? 0),
  avg:          c.visitCount ? Math.round(Number(c.totalSpend ?? 0) / c.visitCount) : 0,
  segment:      c.segment ?? "NEW",
  status:       c.segment === "LOST" ? "Churned" : c.segment === "AT_RISK" ? "At Risk" : "Active",
  churnRisk:    0,
  clv:          Math.round(Number(c.totalSpend ?? 0) * 1.8),
  points:       c.pointsBalance ?? c.currentPointsBalance ?? 0,
  tier:         c.currentTier?.name ?? (c.currentTierId ? "Member" : "Bronze"),
  referralCode: c.referralCode ?? "",
});

// ════════════════════════════════════════════════════════════════
// MICRO COMPONENTS
// ════════════════════════════════════════════════════════════════
const Badge=({children,color,size="sm"})=><span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold" style={{background:color+"22",color,border:`1px solid ${color}33`}}>{children}</span>;
const KPI=({icon:Icon,label,value,change,positive,color,sub})=>(
  <div className="gc rounded-2xl p-5 relative overflow-hidden" style={CARD}>
    <div className="absolute top-0 right-0 w-28 h-28 rounded-full opacity-[0.06]" style={{background:color,transform:"translate(35%,-35%)"}}/>
    <div className="flex items-start justify-between mb-4">
      <div className="w-11 h-11 rounded-xl flex items-center justify-center" style={{background:color+"18"}}><Icon size={20} style={{color}}/></div>
      {change&&<span className={`text-xs font-semibold flex items-center gap-0.5 px-2 py-1 rounded-lg ${positive?"text-emerald-400 bg-emerald-400/10":"text-red-400 bg-red-400/10"}`}>{positive?<ArrowUpRight size={11}/>:<ArrowDownRight size={11}/>}{change}</span>}
    </div>
    <div className="text-3xl font-bold text-white mb-1 tracking-tight">{value}</div>
    <div className="text-xs font-medium text-slate-400">{label}</div>
    {sub&&<div className="text-xs text-slate-600 mt-0.5">{sub}</div>}
  </div>
);
const WAIcon=({size=18,className=""})=><svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>;
const inp="w-full px-4 py-2.5 rounded-xl text-sm text-white placeholder-slate-500 outline-none focus:ring-2 focus:ring-violet-500/40 transition-all";
const btn="px-4 py-2.5 rounded-xl text-xs font-semibold text-white transition-all hover:opacity-90";

// ════════════════════════════════════════════════════════════════
// ROLE SYSTEM — 4 tiers
// ════════════════════════════════════════════════════════════════
// Roles: TENANT_OWNER > BRANCH_MANAGER > MARKETING_STAFF > KITCHEN
const ROLES={OWNER:"TENANT_OWNER",MANAGER:"BRANCH_MANAGER",STAFF:"MARKETING_STAFF",KITCHEN:"KITCHEN"};
const getRole=():string=>localStorage.getItem("userRole")||ROLES.OWNER;
const useRole=()=>{const[role,setRole]=useState(getRole);useEffect(()=>{const fn=()=>setRole(getRole());window.addEventListener("storage",fn);return()=>window.removeEventListener("storage",fn);},[]);return role;};
const can=(role:string,action:"viewAnalytics"|"viewRevenue"|"viewOrders"|"editMenu"|"editOrders"|"changeSettings"|"viewKitchen"|"newSale")=>{
  if(role===ROLES.OWNER)return true;
  if(role===ROLES.MANAGER)return!["viewAnalytics","viewRevenue","changeSettings"].includes(action);
  if(role===ROLES.STAFF)return["newSale","viewKitchen"].includes(action);
  if(role===ROLES.KITCHEN)return action==="viewKitchen";
  return false;
};

// Business category → POS type mapping (set in Settings)
const BIZ_CAT_MAP:Record<string,string>={
  "Café & Restaurant":"restaurant","Restaurant":"restaurant","Café":"restaurant","Coffee Shop":"restaurant","Bar":"restaurant",
  "Hair Salon":"salon","Beauty Salon":"salon","Salon":"salon","Spa":"salon","Barbershop":"salon","Nail Studio":"salon",
  "Gym":"gym","Fitness":"gym","CrossFit":"gym","Yoga Studio":"gym","Sports Club":"gym",
  "Retail":"retail","Shop":"retail","Store":"retail","Boutique":"retail","Pharmacy":"retail","Supermarket":"retail",
};
const getPosBizType=():string=>{
  const stored=localStorage.getItem("pos_biztype_override");if(stored)return stored;
  const industry=localStorage.getItem("biz_industry")||"";
  for(const[key,val]of Object.entries(BIZ_CAT_MAP)){if(industry.toLowerCase().includes(key.toLowerCase()))return val;}
  return "";
};

// ════════════════════════════════════════════════════════════════
// SIDEBAR
// ════════════════════════════════════════════════════════════════
const NAV_ALL=[
  {id:"dashboard",icon:LayoutDashboard,label:"Dashboard",roles:[ROLES.OWNER]},
  {id:"customers",icon:Users,label:"Customers & Loyalty",roles:[ROLES.OWNER,ROLES.MANAGER]},
  {id:"pos",icon:ShoppingCart,label:"POS",roles:[ROLES.OWNER,ROLES.MANAGER,ROLES.STAFF,ROLES.KITCHEN]},
  {id:"messages",icon:MessageSquare,label:"Messages",roles:[ROLES.OWNER,ROLES.MANAGER,ROLES.STAFF]},
  {id:"campaigns",icon:Send,label:"Campaigns",roles:[ROLES.OWNER,ROLES.MANAGER]},
  {id:"automations",icon:Zap,label:"Automations",roles:[ROLES.OWNER,ROLES.MANAGER]},
  {id:"datahub",icon:Database,label:"Data Hub",roles:[ROLES.OWNER]},
  {id:"ai",icon:Brain,label:"AI Insights",roles:[ROLES.OWNER]},
  {id:"settings",icon:Settings,label:"Settings",roles:[ROLES.OWNER,ROLES.MANAGER]},
];
const Sidebar=({page,setPage,col,setCol,onLogout,wa,role})=>{
  const NAV=NAV_ALL.filter(it=>it.roles.includes(role));
  return(
  <div className={`fixed left-0 top-0 h-full z-50 flex flex-col transition-all duration-300 ${col?"w-[72px]":"w-[240px]"}`} style={{background:"linear-gradient(180deg,#0a0414 0%,#0d0520 60%,#0a0414 100%)",backdropFilter:"blur(32px)",WebkitBackdropFilter:"blur(32px)",borderRight:"1px solid rgba(139,92,246,0.12)",boxShadow:"4px 0 32px rgba(0,0,0,0.4)"}}>
    {/* Logo area */}
    <div className={`flex items-center gap-3 px-4 pt-5 pb-4 ${col?"justify-center flex-col":""}`}>
      <div className="relative flex-shrink-0">
        <div className="absolute inset-0 rounded-xl blur-md opacity-40" style={{background:"linear-gradient(135deg,#8b5cf6,#06b6d4)"}}/>
        <div className="relative w-9 h-9 rounded-xl flex items-center justify-center" style={{background:"linear-gradient(135deg,rgba(139,92,246,0.3),rgba(6,182,212,0.2))",border:"1px solid rgba(139,92,246,0.3)"}}>
          <img src="/logo.svg" alt="Loyable" className="w-6 h-6 object-contain"/>
        </div>
      </div>
      {!col&&<div className="flex-1 min-w-0">
        <div className="text-white font-bold text-sm tracking-tight">Loyable</div>
        <div className="text-slate-500 text-[9px] tracking-wide uppercase">CRM Platform</div>
      </div>}
      {!col&&<button onClick={()=>setCol(!col)} className="text-slate-600 hover:text-slate-300 transition-colors p-1 rounded-lg hover:bg-white/5"><ChevronLeft size={14}/></button>}
      {col&&<button onClick={()=>setCol(!col)} className="text-slate-600 hover:text-slate-300 transition-colors p-1 rounded-lg hover:bg-white/5 mt-1"><ChevronRight size={14}/></button>}
    </div>
    {/* Business badge */}
    {!col&&<div className="mx-3 mb-1 px-3 py-2 rounded-xl flex items-center gap-2" style={{background:"rgba(34,197,94,0.06)",border:"1px solid rgba(34,197,94,0.1)"}}>
      <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0 animate-pulse"/>
      <span className="text-xs text-emerald-400 font-medium truncate">{localStorage.getItem("biz_name")||"Your Business"}</span>
    </div>}
    {!col&&<div className="mx-3 mb-4 px-2 py-0.5 rounded-md inline-flex"><span className="text-[9px] font-bold uppercase tracking-widest" style={{color:ROLE_COLORS[role]||"#8b5cf6"}}>{role?.replace(/_/g," ")}</span></div>}
    {col&&<div className="mx-2 mb-3 h-px" style={{background:"linear-gradient(90deg,transparent,rgba(139,92,246,0.3),transparent)"}}/>}
    {/* Nav items */}
    <nav className="flex-1 px-2 space-y-0.5 overflow-y-auto scrollbar-hide">{NAV.map(it=>{
      const active=page===it.id;
      return(
        <button key={it.id} onClick={()=>setPage(it.id)} title={col?it.label:undefined}
          className={`w-full flex items-center gap-3 py-2.5 rounded-xl text-xs font-medium transition-all duration-200 ${col?"justify-center px-0":"px-3"} ${active?"text-white":"text-slate-500 hover:text-slate-200 hover:bg-white/[0.04]"}`}
          style={active?{background:"linear-gradient(135deg,rgba(139,92,246,0.18),rgba(6,182,212,0.06))",boxShadow:"inset 0 0 0 1px rgba(139,92,246,0.2)",paddingLeft:col?undefined:"10px"}:{}}>
          <it.icon size={16} className={`flex-shrink-0 ${active?"text-violet-400":""}`}/>
          {!col&&<span className="flex-1 text-left">{it.label}</span>}
          {!col&&it.id==="messages"&&wa&&<div className="w-1.5 h-1.5 rounded-full bg-emerald-400"/>}
          {!col&&it.id==="ai"&&<span className="text-[9px] font-bold px-1.5 py-0.5 rounded-md" style={{background:"rgba(6,182,212,0.12)",color:"#06b6d4"}}>AI</span>}
        </button>
      );
    })}</nav>
    {/* Divider */}
    <div className="mx-3 h-px mb-2" style={{background:"linear-gradient(90deg,transparent,rgba(255,255,255,0.06),transparent)"}}/>
    <div className="p-2.5">
      <button onClick={onLogout} className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs text-slate-600 hover:text-red-400 hover:bg-red-400/5 transition-all duration-200 ${col?"justify-center":""}`}><LogOut size={15}/>{!col&&<span>Sign Out</span>}</button>
    </div>
  </div>
  );
};

// ════════════════════════════════════════════════════════════════
// LOGIN
// ════════════════════════════════════════════════════════════════
// Sync biz_industry / biz_name from server so any device gets the right POS config
const hydrateFromApi=async()=>{
  try{
    const d=await api.settings.get();
    const biz=d?.user?.business??d?.business;
    if(biz?.industry)localStorage.setItem("biz_industry",biz.industry);
    if(biz?.name)localStorage.setItem("biz_name",biz.name);
    if(biz?.slug)localStorage.setItem("biz_slug",biz.slug);
  }catch{}
};

// ════════════════════════════════════════════════════════════════
// AUTH PAGES  (Login · Sign Up · Forgot Password)
// ════════════════════════════════════════════════════════════════
const OAUTH_ERROR_MSGS:Record<string,string>={
  google_denied:"Google sign-in was cancelled.",
  google_not_configured:"Google sign-in is not set up yet.",
  google_email_not_verified:"Your Google account email is not verified.",
  apple_not_configured:"Apple sign-in is not set up yet.",
  apple_not_implemented:"Apple sign-in is coming soon.",
  oauth_failed:"Social sign-in failed. Please try email instead.",
  oauth_invalid:"Invalid sign-in response. Please try again.",
  oauth_state_mismatch:"Sign-in session expired. Please try again.",
};

const GoogleIcon=()=>(
  <svg width="18" height="18" viewBox="0 0 24 24">
    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
  </svg>
);
const AppleIcon=()=>(
  <svg width="18" height="18" viewBox="0 0 24 24" fill="white">
    <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/>
  </svg>
);

type AuthView = "landing"|"login"|"signup"|"forgot"|"forgot-sent";

const ThemeCtx = createContext<{dark:boolean}>({dark:true});
const useTheme = ()=>useContext(ThemeCtx);

const AuthBg=()=>(
  <div className="absolute inset-0 overflow-hidden pointer-events-none">
    <div className="absolute top-1/4 left-1/3 w-96 h-96 rounded-full opacity-[0.06] blur-3xl" style={{background:"#8b5cf6"}}/>
    <div className="absolute bottom-1/3 right-1/4 w-80 h-80 rounded-full opacity-[0.06] blur-3xl" style={{background:"#06b6d4"}}/>
    <div className="absolute top-3/4 left-1/4 w-64 h-64 rounded-full opacity-[0.04] blur-3xl" style={{background:"#ec4899"}}/>
  </div>
);

const SocialButtons=({loading,socialLoading,onSocial}:{loading:boolean,socialLoading:"google"|"apple"|null,onSocial:(p:"google"|"apple")=>void})=>{
  const {dark}=useTheme();
  return(
    <div className="flex flex-col gap-3 mb-5">
      {(["google","apple"] as const).map(p=>(
        <button key={p} onClick={()=>onSocial(p)} disabled={!!socialLoading||loading}
          className="flex items-center justify-center gap-2.5 py-3 rounded-xl text-sm font-semibold transition-all hover:opacity-90 active:scale-95 disabled:opacity-50"
          style={{background:dark?"rgba(255,255,255,0.07)":"#ffffff",border:`1px solid ${dark?"rgba(255,255,255,0.12)":"rgba(0,0,0,0.1)"}`,color:dark?"white":"#374151"}}>
          {socialLoading===p?<RefreshCw size={16} className="animate-spin"/>:(p==="google"?<GoogleIcon/>:<svg width="18" height="18" viewBox="0 0 24 24" fill={dark?"white":"#374151"}><path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/></svg>)}
          <span>{p==="google"?"Sign up with Google":"Sign up with Apple"}</span>
        </button>
      ))}
    </div>
  );
};

const Divider=({text="or"}:{text?:string})=>{
  const {dark}=useTheme();
  return(
    <div className="flex items-center gap-3 mb-5">
      <div className="flex-1 h-px" style={{background:dark?"rgba(255,255,255,0.08)":"rgba(0,0,0,0.08)"}}/>
      <span className="text-xs" style={{color:dark?"#64748b":"#9ca3af"}}>{text}</span>
      <div className="flex-1 h-px" style={{background:dark?"rgba(255,255,255,0.08)":"rgba(0,0,0,0.08)"}}/>
    </div>
  );
};

const ErrBox=({msg}:{msg:string})=>msg?(
  <div className="mb-4 px-4 py-2.5 rounded-xl text-xs text-red-500" style={{background:"rgba(239,68,68,0.08)",border:"1px solid rgba(239,68,68,0.2)"}}>{msg}</div>
):null;

const OkBox=({msg}:{msg:string})=>msg?(
  <div className="mb-4 px-4 py-2.5 rounded-xl text-xs text-green-600" style={{background:"rgba(34,197,94,0.08)",border:"1px solid rgba(34,197,94,0.2)"}}>{msg}</div>
):null;

const Field=({label,type="text",value,onChange,onEnter,placeholder}:{label:string,type?:string,value:string,onChange:(v:string)=>void,onEnter?:()=>void,placeholder?:string})=>{
  const {dark}=useTheme();
  const s:React.CSSProperties={background:dark?"rgba(255,255,255,0.07)":"#f9f8ff",border:`1px solid ${dark?"rgba(255,255,255,0.14)":"rgba(124,58,237,0.2)"}`,borderRadius:"10px",padding:"11px 14px",fontSize:"14px",width:"100%",outline:"none",color:dark?"white":"#1a1035",transition:"border-color .2s"};
  return(
    <div>
      <label className="text-xs font-medium mb-1.5 block" style={{color:dark?"#94a3b8":"#6b7280"}}>{label}</label>
      <input value={value} onChange={ev=>onChange(ev.target.value)} onKeyDown={ev=>ev.key==="Enter"&&onEnter?.()} type={type} placeholder={placeholder} style={s}/>
    </div>
  );
};

const Btn=({onClick,disabled,loading:ld,children}:{onClick:()=>void,disabled?:boolean,loading?:boolean,children:React.ReactNode})=>(
  <button onClick={onClick} disabled={disabled||ld}
    className="w-full py-3 rounded-xl text-sm font-bold text-white disabled:opacity-60 flex items-center justify-center gap-2 transition-all hover:opacity-90 active:scale-[.98] shadow-sm"
    style={{background:"linear-gradient(135deg,#8b5cf6,#7c3aed)"}}>
    {ld&&<RefreshCw size={14} className="animate-spin"/>}{children}
  </button>
);

const TIMEZONES = [
  {v:"Asia/Karachi",l:"Pakistan (PKT)"},
  {v:"Asia/Dubai",l:"UAE (GST)"},
  {v:"America/New_York",l:"US East (EST)"},
  {v:"America/Chicago",l:"US Central (CST)"},
  {v:"America/Los_Angeles",l:"US West (PST)"},
  {v:"Europe/London",l:"London (GMT)"},
  {v:"Europe/Berlin",l:"Europe (CET)"},
  {v:"Asia/Kolkata",l:"India (IST)"},
  {v:"Asia/Singapore",l:"Singapore (SGT)"},
  {v:"Australia/Sydney",l:"Sydney (AEST)"},
  {v:"UTC",l:"UTC"},
];
const CURRENCIES=[{v:"PKR",l:"PKR – Pakistani Rupee"},{v:"USD",l:"USD – US Dollar"},{v:"EUR",l:"EUR – Euro"},{v:"GBP",l:"GBP – British Pound"},{v:"AED",l:"AED – UAE Dirham"},{v:"INR",l:"INR – Indian Rupee"},{v:"SAR",l:"SAR – Saudi Riyal"},{v:"SGD",l:"SGD – Singapore Dollar"}];
const COUNTRIES=[{v:"PK",l:"Pakistan"},{v:"US",l:"United States"},{v:"GB",l:"United Kingdom"},{v:"AE",l:"UAE"},{v:"IN",l:"India"},{v:"SA",l:"Saudi Arabia"},{v:"SG",l:"Singapore"},{v:"AU",l:"Australia"},{v:"CA",l:"Canada"},{v:"DE",l:"Germany"}];

// ── Login View ────────────────────────────────────────────────────
const LoginView=({onLogin,onView}:{onLogin:(u:any)=>void,onView:(v:AuthView)=>void})=>{
  const [e,setE]=useState("");
  const [p,setP]=useState("");
  const oauthErr=new URLSearchParams(window.location.search).get("error");
  const [err,setErr]=useState(oauthErr?OAUTH_ERROR_MSGS[oauthErr]??`Sign-in error: ${oauthErr}`:"");
  const [loading,setLoading]=useState(false);
  const [socialLoading,setSocialLoading]=useState<"google"|"apple"|null>(null);
  const submit=async()=>{
    if(!e||!p){setErr("Please enter your email and password.");return;}
    setErr("");setLoading(true);
    try{
      const d=await api.auth.login(e,p);
      localStorage.setItem("accessToken",d.accessToken);
      if((d as any).sessionId)localStorage.setItem("sessionId",(d as any).sessionId);
      if(d.user?.id)localStorage.setItem("userId",d.user.id);
      if((d.user as any)?.businessSlug)localStorage.setItem("biz_slug",(d.user as any).businessSlug);
      if((d.user as any)?.businessName)localStorage.setItem("biz_name",(d.user as any).businessName);
      if((d.user as any)?.businessIndustry)localStorage.setItem("biz_industry",(d.user as any).businessIndustry);
      await hydrateFromApi();
      onLogin(d.user);
    }catch(ex){setErr((ex as Error).message==="INVALID_CREDENTIALS"?"Incorrect email or password.":(ex as Error).message);}
    finally{setLoading(false);}
  };
  const {dark}=useTheme();
  const fldLbl:React.CSSProperties={display:"block",fontSize:"12px",fontWeight:600,marginBottom:"6px",color:dark?"#94a3b8":"#374151"};
  const fldInp:React.CSSProperties={background:dark?"rgba(255,255,255,0.07)":"#f9f8ff",border:`1px solid ${dark?"rgba(255,255,255,0.14)":"rgba(124,58,237,0.2)"}`,borderRadius:"10px",padding:"11px 14px",fontSize:"14px",width:"100%",outline:"none",color:dark?"white":"#1a1035"};
  return(
    <div>
      <SocialButtons loading={loading} socialLoading={socialLoading} onSocial={p=>{setSocialLoading(p);window.location.href=`/api/auth/${p}`;}}/>
      <Divider/>
      <div className="space-y-4 mb-5">
        <div><label style={fldLbl}>Email Address</label><input value={e} onChange={ev=>setE(ev.target.value)} type="email" placeholder="you@business.com" style={fldInp}/></div>
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label style={fldLbl}>Password</label>
            <button onClick={()=>onView("forgot")} className="text-xs font-semibold transition-colors" style={{color:"#8b5cf6"}}>Forgot password?</button>
          </div>
          <input value={p} onChange={ev=>setP(ev.target.value)} onKeyDown={ev=>ev.key==="Enter"&&submit()} type="password" placeholder="••••••••" style={fldInp}/>
        </div>
      </div>
      <ErrBox msg={err}/>
      <Btn onClick={submit} loading={loading} disabled={!!socialLoading}>Sign In</Btn>
      <p className="mt-5 text-center text-xs" style={{color:dark?"#64748b":"#9ca3af"}}>Don't have an account? <button onClick={()=>onView("signup")} className="font-semibold" style={{color:"#8b5cf6"}}>Sign up free</button></p>
    </div>
  );
};

// ── Sign Up View ──────────────────────────────────────────────────
const SignupView=({onLogin,onView}:{onLogin:(u:any)=>void,onView:(v:AuthView)=>void})=>{
  const [bizName,setBizName]=useState("");
  const [name,setName]=useState("");
  const [email,setEmail]=useState("");
  const [pass,setPass]=useState("");
  const [confirm,setConfirm]=useState("");
  const [country,setCountry]=useState("PK");
  const [tz,setTz]=useState("Asia/Karachi");
  const [currency,setCurrency]=useState("PKR");
  const [industry,setIndustry]=useState("restaurant");
  const [err,setErr]=useState("");
  const [loading,setLoading]=useState(false);
  const [socialLoading,setSocialLoading]=useState<"google"|"apple"|null>(null);
  const selStyle={...INP,width:"100%",appearance:"none" as const,padding:"10px 16px",borderRadius:"12px",color:"white",fontSize:"14px"};
  const submit=async()=>{
    if(!bizName||!name||!email||!pass){setErr("Please fill in all required fields.");return;}
    if(pass!==confirm){setErr("Passwords do not match.");return;}
    if(pass.length<8){setErr("Password must be at least 8 characters.");return;}
    if(!/[A-Z]/.test(pass)){setErr("Password must contain an uppercase letter.");return;}
    if(!/[0-9]/.test(pass)){setErr("Password must contain a number.");return;}
    if(!/[^A-Za-z0-9]/.test(pass)){setErr("Password must contain a special character (e.g. ! @ # $).");return;}
    setErr("");setLoading(true);
    try{
      const d=await api.auth.register({businessName:bizName,ownerName:name,ownerEmail:email,ownerPassword:pass,country,timezone:tz,currency,industry});
      localStorage.setItem("accessToken",d.accessToken);
      if(d.user?.id)localStorage.setItem("userId",d.user.id);
      await hydrateFromApi();
      onLogin(d.user);
    }catch(ex){
      const m=(ex as Error).message;
      setErr(m==="BUSINESS_SLUG_TAKEN"?"A business with that name already exists. Try a different name.":m==="USER_ALREADY_EXISTS_IN_BUSINESS"?"An account with that email already exists. Try signing in.":m);
    }
    finally{setLoading(false);}
  };
  const {dark}=useTheme();
  const fldLbl:React.CSSProperties={display:"block",fontSize:"12px",fontWeight:600,marginBottom:"6px",color:dark?"#94a3b8":"#374151"};
  const fldInp:React.CSSProperties={background:dark?"rgba(255,255,255,0.07)":"#f9f8ff",border:`1px solid ${dark?"rgba(255,255,255,0.14)":"rgba(124,58,237,0.2)"}`,borderRadius:"10px",padding:"11px 14px",fontSize:"14px",width:"100%",outline:"none",color:dark?"white":"#1a1035"};
  const selSt={...fldInp,appearance:"none" as const};
  const optBg=dark?"#1a1035":"white";
  return(
    <div>
      <SocialButtons loading={loading} socialLoading={socialLoading} onSocial={p=>{setSocialLoading(p);window.location.href=`/api/auth/${p}`;}}/>
      <Divider text="or sign up with email"/>
      <div className="space-y-3 mb-5">
        <div className="grid grid-cols-2 gap-3">
          <div><label style={fldLbl}>First Name</label><input value={name.split(" ")[0]} onChange={ev=>setName(ev.target.value+" "+(name.split(" ")[1]||""))} placeholder="First Name" style={fldInp}/></div>
          <div><label style={fldLbl}>Last Name</label><input value={name.split(" ")[1]||""} onChange={ev=>setName((name.split(" ")[0]||"")+" "+ev.target.value)} placeholder="Last Name" style={fldInp}/></div>
        </div>
        <div><label style={fldLbl}>Business Name *</label><input value={bizName} onChange={ev=>setBizName(ev.target.value)} placeholder="Your Business Name" style={fldInp}/></div>
        <div><label style={fldLbl}>Email Address *</label><input value={email} onChange={ev=>setEmail(ev.target.value)} type="email" placeholder="you@example.com" style={fldInp}/></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label style={fldLbl}>Country</label><select value={country} onChange={ev=>setCountry(ev.target.value)} style={selSt}>{COUNTRIES.map(c=><option key={c.v} value={c.v} style={{background:optBg}}>{c.l}</option>)}</select></div>
          <div><label style={fldLbl}>Currency</label><select value={currency} onChange={ev=>setCurrency(ev.target.value)} style={selSt}>{CURRENCIES.map(c=><option key={c.v} value={c.v} style={{background:optBg}}>{c.v}</option>)}</select></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label style={fldLbl}>Timezone</label><select value={tz} onChange={ev=>setTz(ev.target.value)} style={selSt}>{TIMEZONES.map(t=><option key={t.v} value={t.v} style={{background:optBg}}>{t.l}</option>)}</select></div>
          <div><label style={fldLbl}>Business Type</label><select value={industry} onChange={ev=>setIndustry(ev.target.value)} style={selSt}>{[{v:"restaurant",l:"Restaurant"},{v:"salon",l:"Salon / Spa"},{v:"gym",l:"Gym / Fitness"},{v:"retail",l:"Retail"},{v:"cafe",l:"Café"},{v:"pharmacy",l:"Pharmacy"},{v:"other",l:"Other"}].map(o=><option key={o.v} value={o.v} style={{background:optBg}}>{o.l}</option>)}</select></div>
        </div>
        <div><label style={fldLbl}>Password *</label><input value={pass} onChange={ev=>setPass(ev.target.value)} type="password" placeholder="Create a strong password" style={fldInp}/></div>
        <div><label style={fldLbl}>Confirm Password *</label><input value={confirm} onChange={ev=>setConfirm(ev.target.value)} onKeyDown={ev=>ev.key==="Enter"&&submit()} type="password" placeholder="Confirm your password" style={fldInp}/></div>
      </div>
      <ErrBox msg={err}/>
      <Btn onClick={submit} loading={loading} disabled={!!socialLoading}>Create Account</Btn>
      <p className="mt-5 text-center text-xs" style={{color:dark?"#64748b":"#9ca3af"}}>Already have an account? <button onClick={()=>onView("login")} className="font-semibold" style={{color:"#8b5cf6"}}>Sign in</button></p>
      <div className="mt-4 flex flex-wrap justify-center gap-4">
        {[{icon:"🛡️",l:"GDPR Compliant"},{icon:"🔒",l:"Secure & Encrypted"},{icon:"⭐",l:"Trusted by Businesses"}].map(b=>(
          <div key={b.l} className="flex items-center gap-1.5 text-[11px]" style={{color:dark?"#64748b":"#9ca3af"}}><span>{b.icon}</span>{b.l}</div>
        ))}
      </div>
    </div>
  );
};

// ── Forgot Password View ──────────────────────────────────────────
const ForgotView=({onView}:{onView:(v:AuthView)=>void})=>{
  const [email,setEmail]=useState("");
  const [err,setErr]=useState("");
  const [loading,setLoading]=useState(false);
  const [sent,setSent]=useState(false);
  const submit=async()=>{
    if(!email){setErr("Please enter your email address.");return;}
    setErr("");setLoading(true);
    try{
      await api.auth.forgotPassword(email);
      setSent(true);
    }catch(ex){setErr((ex as Error).message);}
    finally{setLoading(false);}
  };
  if(sent)return(
    <div className="gc rounded-2xl p-8 text-center" style={CARD}>
      <div className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-4" style={{background:"rgba(34,197,94,0.12)",border:"1px solid rgba(34,197,94,0.2)"}}>
        <Mail size={24} className="text-green-400"/>
      </div>
      <h3 className="text-white font-semibold text-lg mb-2">Check your inbox</h3>
      <p className="text-slate-400 text-sm mb-6">If an account exists for <span className="text-white">{email}</span>, you'll receive a password reset link within a few minutes.</p>
      <button onClick={()=>onView("login")} className="text-violet-400 hover:text-violet-300 text-sm font-medium flex items-center gap-1 mx-auto"><ArrowLeft size={14}/> Back to sign in</button>
    </div>
  );
  return(
    <div className="gc rounded-2xl p-6" style={CARD}>
      <div className="mb-5">
        <h3 className="text-white font-semibold text-base mb-1">Reset your password</h3>
        <p className="text-slate-400 text-xs">Enter your email and we'll send you a reset link.</p>
      </div>
      <div className="mb-5">
        <Field label="Email address" type="email" value={email} onChange={setEmail} onEnter={submit} placeholder="you@business.com"/>
      </div>
      <ErrBox msg={err}/>
      <Btn onClick={submit} loading={loading}>Send Reset Link</Btn>
      <p className="mt-4 text-center text-xs text-slate-500"><button onClick={()=>onView("login")} className="text-violet-400 hover:text-violet-300 font-medium flex items-center gap-1 mx-auto"><ArrowLeft size={12}/> Back to sign in</button></p>
    </div>
  );
};

// ════════════════════════════════════════════════════════════════
// LANDING PAGE  (marketing website — full redesign)
// ════════════════════════════════════════════════════════════════
const LandingPage=({onLogin}:{onLogin:(u:any)=>void})=>{
  const [view,setView]=useState<AuthView>("landing");
  const [dark,setDark]=useState(true);
  const [mobileNav,setMobileNav]=useState(false);
  const [pricingYearly,setPricingYearly]=useState(false);
  const [testimonialIdx,setTestimonialIdx]=useState(0);

  const D=dark;
  const bg    = D?"#0f0a1e":"#f8f7ff";
  const bg2   = D?"#130d24":"#f0eeff";
  const card  = D?"rgba(255,255,255,0.06)":"#ffffff";
  const cardB = D?"rgba(255,255,255,0.1)":"rgba(124,58,237,0.12)";
  const tx    = D?"#ffffff":"#1a1035";
  const tx2   = D?"#94a3b8":"#6b7280";
  const tx3   = D?"#64748b":"#9ca3af";
  const bdr   = D?"rgba(255,255,255,0.08)":"rgba(0,0,0,0.07)";
  const inpBg = D?"rgba(255,255,255,0.07)":"#f9f8ff";
  const inpBd = D?"rgba(255,255,255,0.14)":"rgba(124,58,237,0.2)";
  const navBg = D?"rgba(15,10,30,0.9)":"rgba(255,255,255,0.92)";

  const LS_FEATURES=[
    {icon:"🔲",title:"QR Check-In",desc:"Easy QR scanning for customer visits."},
    {icon:"👥",title:"Loyalty Programs",desc:"Create membership tiers & reward loyalty."},
    {icon:"⭐",title:"Points System",desc:"Reward points for every visit or purchase."},
    {icon:"🎟️",title:"Coupons & Offers",desc:"Create powerful coupons & discounts."},
    {icon:"📣",title:"Automated Campaigns",desc:"WhatsApp, Email & SMS automation."},
    {icon:"📋",title:"Customer Timeline",desc:"Complete history of customer interactions."},
    {icon:"🧠",title:"AI Segmentation",desc:"Smart segments to target right customers."},
    {icon:"🎂",title:"Birthday Rewards",desc:"Automated birthday wishes & rewards."},
    {icon:"🔗",title:"Referral Program",desc:"Grow your business with referrals."},
    {icon:"📊",title:"Analytics & Reports",desc:"Real-time insights to grow your business."},
    {icon:"🏢",title:"Multi-Location",desc:"Manage multiple locations with ease."},
    {icon:"👤",title:"Staff Management",desc:"Roles & permissions for your team."},
    {icon:"⭐",title:"Review Management",desc:"Get more reviews and grow reputation."},
    {icon:"🔌",title:"Integrations",desc:"Connect with POS, APIs & more."},
    {icon:"📱",title:"Mobile App",desc:"Your customers can view & redeem rewards."},
  ];

  const STEPS=[
    {icon:"🏪",n:"1. Customer Visits",d:"Customer visits your business."},
    {icon:"📱",n:"2. Scan QR Code",d:"They scan the QR code to check-in."},
    {icon:"⭐",n:"3. Earn Points",d:"Points are added to their account."},
    {icon:"🎁",n:"4. Get Rewards",d:"They redeem points & claim rewards."},
    {icon:"🔄",n:"5. Visit Again",d:"They come back & become loyal."},
  ];

  const INDUSTRIES=[
    {icon:"🍽️",l:"Restaurants"},{icon:"☕",l:"Cafés"},{icon:"🍰",l:"Dessert Shops"},
    {icon:"✂️",l:"Salons"},{icon:"💈",l:"Barbers"},{icon:"🏋️",l:"Gyms"},
    {icon:"🛍️",l:"Retail Stores"},{icon:"🚗",l:"Car Washes"},{icon:"🏥",l:"Clinics"},{icon:"💆",l:"Spas"},
  ];

  const TESTIMONIALS=[
    {stars:5,text:"Loyable increased our repeat customers by 60%. The WhatsApp campaigns and rewards system work like magic!!!!",name:"Michael Brown",biz:"Casa Bistro",avatar:"MB"},
    {stars:5,text:"Finally, a loyalty platform that is simple, powerful and affordable. Our customers love the rewards!",name:"Sarah Johnson",biz:"The Coffee House",avatar:"SJ"},
    {stars:5,text:"The analytics help us understand our customers better. Our business has grown 35% since using Loyable.",name:"James Williams",biz:"Urban Cuts Barbershop",avatar:"JW"},
  ];

  const PRICING=[
    {name:"Free",monthly:0,yearly:0,desc:"Perfect for getting started",features:["Up to 200 Customers","200 Messages / month","QR Check-in","Basic Analytics"],cta:"Get Started",highlight:false},
    {name:"Starter",monthly:19,yearly:15,desc:"For small businesses",features:["Up to 1,000 Customers","1,000 Messages / month","Campaigns","Coupons & Campaigns","Email Support"],cta:"Start Free Trial",highlight:false},
    {name:"Growth",monthly:49,yearly:39,desc:"For growing businesses",features:["Up to 10,000 Customers","10,000 Messages / month","Multi-Location","Advanced Analytics","AI Insights","Priority Support"],cta:"Start Free Trial",highlight:true},
    {name:"Pro",monthly:99,yearly:79,desc:"For large businesses",features:["Unlimited Customers","Unlimited Messages","Multi-Location","AI Insights","White Label","Priority Support"],cta:"Start Free Trial",highlight:false},
  ];

  const BRANDS=["Casa Bistro","The Coffee House","Urban Cuts","FitLife Gym","Blossom Salon","Sweet Treats","AutoShine"];

  const LightInp:React.CSSProperties={background:inpBg,border:`1px solid ${inpBd}`,borderRadius:"10px",padding:"11px 14px",fontSize:"14px",width:"100%",outline:"none",color:tx,transition:"border-color .2s"};
  const selStyle={...LightInp,appearance:"none" as const};

  const nav=(v:AuthView)=>{setView(v);window.scrollTo({top:0,behavior:"smooth"});};

  // ── Auth form card (right panel) ─────────────────────────────
  const AuthFormCard=()=>{
    if(view==="login")return(
      <div>
        <h2 className="text-2xl font-bold mb-1" style={{color:tx}}>Welcome Back</h2>
        <p className="text-sm mb-6" style={{color:tx2}}>Sign in to your Loyable account</p>
        <LoginView onLogin={onLogin} onView={nav}/>
      </div>
    );
    if(view==="signup")return(
      <div>
        <h2 className="text-2xl font-bold mb-1" style={{color:tx}}>Sign Up</h2>
        <p className="text-sm mb-6" style={{color:tx2}}>Start your 14-day free trial. No credit card required.</p>
        <SignupView onLogin={onLogin} onView={nav}/>
      </div>
    );
    if(view==="forgot"||view==="forgot-sent")return <ForgotView onView={nav}/>;
    return null;
  };

  // ── Split-screen auth layout ─────────────────────────────────
  if(view!=="landing"){
    return(
      <ThemeCtx.Provider value={{dark}}>
      <div className="min-h-screen flex flex-col lg:flex-row" style={{background:bg}}>
        {/* Left panel — marketing */}
        <div className="hidden lg:flex flex-col justify-between w-[48%] min-h-screen p-10 relative overflow-hidden" style={{background:"linear-gradient(145deg,#6d28d9 0%,#7c3aed 40%,#4f46e5 100%)"}}>
          <div className="absolute inset-0 opacity-10" style={{backgroundImage:"radial-gradient(circle at 20% 50%,#fff 0%,transparent 50%),radial-gradient(circle at 80% 20%,#c4b5fd 0%,transparent 40%)"}}/>
          <div className="relative z-10">
            <button onClick={()=>setView("landing")} className="flex items-center gap-2 mb-12">
              <img src="/logo.svg" alt="Loyable" className="w-10 h-10 object-contain"/>
            </button>
            <h1 className="text-3xl font-black text-white mb-3 leading-tight">
              {view==="signup"?"Create Your Loyable Account":"Welcome Back to Loyable"}
            </h1>
            <p className="text-purple-200 text-sm mb-8 leading-relaxed">Join thousands of businesses that are turning one-time customers into loyal customers.</p>
            {[
              {icon:"👥",t:"Grow Your Customers",d:"Track visits, understand behavior and build stronger relationships."},
              {icon:"🎁",t:"Reward Loyalty",d:"Create loyalty programs, points, and exclusive rewards that keep customers coming back."},
              {icon:"📣",t:"Automate & Save Time",d:"Send automated WhatsApp messages, birthday wishes, offers, and win-back campaigns."},
              {icon:"📊",t:"Powerful Insights",d:"Get real-time analytics and AI insights to grow your business smarter."},
            ].map((f,i)=>(
              <div key={i} className="flex gap-3 mb-5">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 text-lg" style={{background:"rgba(255,255,255,0.15)"}}>{f.icon}</div>
                <div>
                  <div className="text-white font-semibold text-sm">{f.t}</div>
                  <div className="text-purple-200 text-xs mt-0.5 leading-relaxed" dangerouslySetInnerHTML={{__html:f.d.replace("keep customers coming back","keep <strong>customers coming back</strong>")}}/>
                </div>
              </div>
            ))}
          </div>
          {/* Dashboard mockup preview */}
          <div className="relative z-10 mt-6 rounded-2xl overflow-hidden shadow-2xl" style={{background:"rgba(255,255,255,0.12)",border:"1px solid rgba(255,255,255,0.2)"}}>
            <div className="flex items-center gap-2 px-4 py-3 border-b" style={{borderColor:"rgba(255,255,255,0.1)"}}>
              <img src="/logo.svg" alt="Loyable" className="w-5 h-5 object-contain"/>
              <span className="text-white text-xs font-semibold">Dashboard</span>
              <div className="ml-auto flex items-center gap-1"><div className="w-6 h-6 rounded-full" style={{background:"rgba(255,255,255,0.2)"}}/><span className="text-purple-200 text-[10px]">Davita ▾</span></div>
            </div>
            <div className="p-4 grid grid-cols-4 gap-2">
              {[{l:"Total Customers",v:"12,458",c:"+12.5%"},{l:"Active Customers",v:"8,215",c:"+8.3%"},{l:"Repeat Customers",v:"6,125",c:"+15.2%"},{l:"Revenue Recovered",v:"£23,560",c:"+18.7%"}].map((k,i)=>(
                <div key={i} className="rounded-lg p-2" style={{background:"rgba(255,255,255,0.1)"}}>
                  <div className="text-purple-200 text-[9px]">{k.l}</div>
                  <div className="text-white font-bold text-sm">{k.v}</div>
                  <div className="text-green-300 text-[9px]">{k.c}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
        {/* Right panel — form */}
        <div className="flex-1 flex flex-col" style={{background:bg}}>
          <div className="flex items-center justify-between px-6 py-4 border-b" style={{borderColor:bdr}}>
            <button onClick={()=>setView("landing")} className="lg:hidden flex items-center gap-2">
              <img src="/logo.svg" alt="Loyable" className="w-8 h-8 object-contain"/>
            </button>
            <div className="lg:ml-auto flex items-center gap-2">
              {view==="signup"&&<><span className="text-sm" style={{color:tx2}}>Already have an account?</span><button onClick={()=>nav("login")} className="text-sm font-semibold" style={{color:"#7c3aed"}}>Log in</button></>}
              {view==="login"&&<><span className="text-sm" style={{color:tx2}}>New to Loyable?</span><button onClick={()=>nav("signup")} className="text-sm font-semibold" style={{color:"#7c3aed"}}>Sign up free</button></>}
              {(view==="forgot"||view==="forgot-sent")&&<button onClick={()=>nav("login")} className="text-sm font-semibold flex items-center gap-1" style={{color:"#7c3aed"}}><ArrowLeft size={13}/>Back to login</button>}
            </div>
          </div>
          <div className="flex-1 flex items-center justify-center px-6 py-10">
            <div className="w-full max-w-md">
              <AuthFormCard/>
            </div>
          </div>
          <div className="px-6 py-4 text-center text-xs" style={{color:tx3}}>
            By signing up, you agree to our <a href="#" className="underline" style={{color:"#7c3aed"}}>Terms</a> and <a href="#" className="underline" style={{color:"#7c3aed"}}>Privacy Policy</a>
          </div>
        </div>
      </div>
      </ThemeCtx.Provider>
    );
  }

  // ── Full marketing landing page ──────────────────────────────
  return(
    <ThemeCtx.Provider value={{dark}}>
    <div className="min-h-screen overflow-x-hidden" style={{background:bg,color:tx}}>

      {/* ── Nav ─────────────────────────────────────────────── */}
      <nav className="fixed top-0 left-0 right-0 z-50 transition-colors" style={{background:navBg,backdropFilter:"blur(20px)",WebkitBackdropFilter:"blur(20px)",borderBottom:`1px solid ${bdr}`}}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-[62px] flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5 flex-shrink-0">
            <img src="/logo.svg" alt="Loyable" className="w-9 h-9 object-contain"/>
          </div>
          <div className="hidden lg:flex items-center gap-1 text-sm font-medium" style={{color:tx2}}>
            {["Home","Features","Pricing"].map(l=>(
              <a key={l} href={`#${l.toLowerCase()}`} className="px-3 py-2 rounded-lg transition-colors hover:opacity-80" style={{color:tx2}}>{l}</a>
            ))}
            {["Industries","Resources","Company"].map(l=>(
              <button key={l} className="px-3 py-2 rounded-lg transition-colors hover:opacity-80 flex items-center gap-1" style={{color:tx2}}>{l}<ChevronDown size={13}/></button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={()=>setDark(!dark)} className="w-9 h-9 rounded-xl flex items-center justify-center transition-all hover:opacity-80" style={{background:D?"rgba(255,255,255,0.08)":"rgba(0,0,0,0.06)",color:tx2}}>
              {D?<span className="text-base">☀️</span>:<span className="text-base">🌙</span>}
            </button>
            <button onClick={()=>nav("login")} className="hidden sm:block px-4 py-2 rounded-xl text-sm font-semibold transition-all hover:opacity-80" style={{color:tx}}>Log in</button>
            <button onClick={()=>nav("signup")} className="px-4 py-2 rounded-xl text-sm font-semibold text-white transition-all hover:opacity-90" style={{background:"linear-gradient(135deg,#8b5cf6,#7c3aed)"}}>Sign Up Free</button>
            <button className="lg:hidden p-1.5" onClick={()=>setMobileNav(!mobileNav)} style={{color:tx}}>{mobileNav?<X size={20}/>:<Menu size={20}/>}</button>
          </div>
        </div>
        {mobileNav&&(
          <div className="lg:hidden border-t px-4 pb-4 pt-3 space-y-2" style={{background:navBg,borderColor:bdr}}>
            {["Home","Features","Pricing","Industries"].map(l=>(
              <a key={l} href={`#${l.toLowerCase()}`} onClick={()=>setMobileNav(false)} className="block text-sm py-2" style={{color:tx2}}>{l}</a>
            ))}
            <div className="grid grid-cols-2 gap-2 pt-2">
              <button onClick={()=>{setMobileNav(false);nav("login");}} className="py-2.5 rounded-xl text-sm font-semibold border" style={{color:tx,borderColor:bdr}}>Log in</button>
              <button onClick={()=>{setMobileNav(false);nav("signup");}} className="py-2.5 rounded-xl text-sm font-semibold text-white" style={{background:"linear-gradient(135deg,#8b5cf6,#7c3aed)"}}>Sign Up Free</button>
            </div>
          </div>
        )}
      </nav>

      {/* ── Hero ────────────────────────────────────────────── */}
      <section id="home" className="pt-[80px]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-16 lg:py-24">
          <div className="grid lg:grid-cols-2 gap-10 lg:gap-16 items-center">
            <div>
              <div className="flex items-center gap-3 mb-6">
                <img src="/logo.svg" alt="Loyable" className="w-14 h-14 object-contain"/>
                <span className="text-3xl font-black" style={{color:tx}}>Loyable</span>
              </div>
              <h1 className="text-4xl sm:text-5xl lg:text-[52px] font-black leading-[1.1] mb-5 tracking-tight" style={{color:tx}}>
                Turn One-Time Customers Into<br/>
                <span style={{background:"linear-gradient(135deg,#8b5cf6,#7c3aed)",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent"}}>Loyal Customers</span>
              </h1>
              <p className="text-base mb-8 leading-relaxed max-w-lg" style={{color:tx2}}>
                Loyable helps businesses track visits, reward loyalty, automate marketing and bring customers back – all in one powerful platform.
              </p>
              <div className="flex flex-wrap gap-3 mb-8">
                <button onClick={()=>nav("signup")} className="px-6 py-3 rounded-xl text-sm font-bold text-white transition-all hover:opacity-90 hover:scale-105 shadow-lg" style={{background:"linear-gradient(135deg,#8b5cf6,#7c3aed)"}}>Start Free Trial</button>
                <button className="px-6 py-3 rounded-xl text-sm font-bold border-2 transition-all hover:opacity-80" style={{color:tx,borderColor:D?"rgba(255,255,255,0.15)":"rgba(124,58,237,0.3)"}}>Book a Demo</button>
              </div>
              <div className="flex flex-wrap items-center gap-5 text-xs" style={{color:tx3}}>
                {["14-Day Free Trial","No Credit Card","Setup in 2 Minutes"].map(l=>(
                  <span key={l} className="flex items-center gap-1.5"><Check size={13} className="text-violet-500"/>{l}</span>
                ))}
              </div>
            </div>
            {/* Dashboard hero image */}
            <div className="relative">
              <div className="absolute -inset-4 rounded-3xl opacity-20 blur-2xl" style={{background:"linear-gradient(135deg,#8b5cf6,#7c3aed)"}}/>
              <div className="relative rounded-2xl overflow-hidden shadow-2xl border" style={{background:D?"#1a1035":"#ffffff",borderColor:bdr}}>
                <div className="flex items-center gap-2 px-4 py-3 border-b" style={{background:D?"rgba(255,255,255,0.04)":"#f8f7ff",borderColor:bdr}}>
                  <img src="/logo.svg" alt="Loyable" className="w-5 h-5 object-contain"/>
                  <span className="font-bold text-xs" style={{color:tx}}>Dashboard</span>
                  <div className="ml-auto flex items-center gap-2"><span className="text-xs" style={{color:tx2}}>Davita ▾</span><div className="w-6 h-6 rounded-full" style={{background:"linear-gradient(135deg,#8b5cf6,#7c3aed)"}}/></div>
                </div>
                <div className="p-4">
                  <div className="grid grid-cols-4 gap-2 mb-4">
                    {[{l:"Total Customers",v:"12,458",c:"+12.5%"},{l:"Active Customers",v:"8,215",c:"+8.3%"},{l:"Repeat Customers",v:"6,125",c:"+15.2%"},{l:"Revenue Recovered",v:"£23,560",c:"+18.7%"}].map((k,i)=>(
                      <div key={i} className="rounded-xl p-3 border" style={{background:D?"rgba(255,255,255,0.05)":"#f9f8ff",borderColor:bdr}}>
                        <div className="text-[9px] mb-1" style={{color:tx3}}>{k.l}</div>
                        <div className="font-bold text-base" style={{color:tx}}>{k.v}</div>
                        <div className="text-[9px] text-emerald-500 font-semibold">{k.c}</div>
                      </div>
                    ))}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-xl p-3 border" style={{background:D?"rgba(255,255,255,0.03)":"#f9f8ff",borderColor:bdr}}>
                      <div className="text-xs font-semibold mb-2" style={{color:tx}}>Customer Visits Overview</div>
                      <div className="h-20 flex items-end gap-1">
                        {[40,55,35,70,50,85,60,75,45,90,65,80].map((h,i)=>(
                          <div key={i} className="flex-1 rounded-sm opacity-70" style={{height:`${h}%`,background:"linear-gradient(to top,#8b5cf6,#a78bfa)"}}/>
                        ))}
                      </div>
                    </div>
                    <div className="rounded-xl p-3 border" style={{background:D?"rgba(255,255,255,0.03)":"#f9f8ff",borderColor:bdr}}>
                      <div className="text-xs font-semibold mb-2" style={{color:tx}}>Top Campaigns</div>
                      {[{l:"Birthday Offer",w:75,c:"#8b5cf6"},{l:"Weekend Promo",w:55,c:"#06b6d4"},{l:"Win Back",w:35,c:"#ec4899"},{l:"New Menu",w:20,c:"#f59e0b"}].map((b,i)=>(
                        <div key={i} className="mb-1.5">
                          <div className="flex justify-between text-[9px] mb-0.5" style={{color:tx3}}><span>{b.l}</span></div>
                          <div className="h-1.5 rounded-full" style={{background:D?"rgba(255,255,255,0.06)":"#ede9fe"}}><div className="h-full rounded-full" style={{width:`${b.w}%`,background:b.c}}/></div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
              {/* Floating loyalty card */}
              <div className="absolute -bottom-4 -left-6 w-36 rounded-2xl p-3 shadow-xl border" style={{background:"linear-gradient(135deg,#7c3aed,#8b5cf6)",borderColor:"rgba(255,255,255,0.2)"}}>
                <div className="flex items-center gap-1.5 mb-2"><div className="w-4 h-4 rounded-md" style={{background:"rgba(255,255,255,0.25)"}}/><span className="text-white text-[9px] font-bold">Loyable</span></div>
                <div className="text-white font-black text-lg">2,450</div>
                <div className="text-purple-200 text-[9px]">Loyalty Points</div>
                <div className="mt-2 h-1 rounded-full" style={{background:"rgba(255,255,255,0.2)"}}><div className="h-full w-3/4 rounded-full" style={{background:"rgba(255,255,255,0.7)"}}/></div>
              </div>
            </div>
          </div>
        </div>
        {/* Trusted by */}
        <div className="border-t border-b py-5 overflow-hidden" style={{borderColor:bdr}}>
          <div className="max-w-7xl mx-auto px-4">
            <p className="text-center text-xs font-medium mb-4" style={{color:tx3}}>Trusted by 1,000+ businesses worldwide</p>
            <div className="flex items-center justify-center flex-wrap gap-8">
              {BRANDS.map(b=><span key={b} className="text-sm font-bold tracking-tight opacity-40" style={{color:tx}}>{b}</span>)}
            </div>
          </div>
        </div>
      </section>

      {/* ── Features ────────────────────────────────────────── */}
      <section id="features" className="py-20 px-4 sm:px-6">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-14">
            <p className="text-xs font-bold uppercase tracking-widest mb-2" style={{color:"#8b5cf6"}}>POWERFUL FEATURES</p>
            <h2 className="text-3xl sm:text-4xl font-black mb-3" style={{color:tx}}>Everything You Need to Build Loyalty</h2>
            <p className="max-w-md mx-auto text-sm" style={{color:tx2}}>All the tools you need to engage, reward and retain your customers.</p>
          </div>
          <div className="grid sm:grid-cols-3 lg:grid-cols-5 gap-4">
            {LS_FEATURES.map((f,i)=>(
              <div key={i} className="p-4 rounded-2xl border transition-all hover:shadow-md hover:-translate-y-0.5" style={{background:card,borderColor:bdr}}>
                <div className="w-9 h-9 rounded-xl flex items-center justify-center mb-3 text-lg" style={{background:D?"rgba(139,92,246,0.15)":"#ede9fe"}}>{f.icon}</div>
                <div className="font-semibold text-sm mb-1" style={{color:tx}}>{f.title}</div>
                <div className="text-xs leading-relaxed" style={{color:tx2}}>{f.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── How it Works ────────────────────────────────────── */}
      <section className="py-20 px-4 sm:px-6" style={{background:bg2}}>
        <div className="max-w-7xl mx-auto">
          <div className="mb-10">
            <p className="text-xs font-bold uppercase tracking-widest mb-2" style={{color:"#8b5cf6"}}>HOW IT WORKS</p>
            <h2 className="text-3xl font-black mb-2" style={{color:tx}}>Simple Steps, Big Results</h2>
            <p className="text-sm mb-6" style={{color:tx2}}>Loyable makes customer retention easy in just 5 steps.</p>
            <button onClick={()=>nav("signup")} className="px-5 py-2.5 rounded-xl text-sm font-bold text-white" style={{background:"linear-gradient(135deg,#8b5cf6,#7c3aed)"}}>Get Started Free</button>
          </div>
          <div className="flex flex-wrap justify-center gap-4">
            {STEPS.map((s,i)=>(
              <div key={i} className="flex items-center gap-3">
                <div className="flex flex-col items-center">
                  <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-2xl shadow-lg" style={{background:"linear-gradient(135deg,#8b5cf6,#7c3aed)"}}>{s.icon}</div>
                  <div className="text-xs font-bold mt-2 text-center max-w-[90px]" style={{color:tx}}>{s.n}</div>
                  <div className="text-[10px] text-center max-w-[90px]" style={{color:tx2}}>{s.d}</div>
                </div>
                {i<STEPS.length-1&&<ChevronRight size={20} className="text-violet-400 flex-shrink-0 mt-[-28px]"/>}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Industries ──────────────────────────────────────── */}
      <section id="industries" className="py-20 px-4 sm:px-6">
        <div className="max-w-7xl mx-auto text-center">
          <h2 className="text-3xl font-black mb-3" style={{color:tx}}>Perfect for Every Business</h2>
          <div className="flex flex-wrap justify-center gap-8 mt-10">
            {INDUSTRIES.map(ind=>(
              <div key={ind.l} className="flex flex-col items-center gap-2 cursor-pointer group">
                <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-2xl transition-all group-hover:scale-110 group-hover:shadow-lg" style={{background:D?"rgba(139,92,246,0.15)":"#ede9fe"}}>{ind.icon}</div>
                <span className="text-xs font-medium" style={{color:tx2}}>{ind.l}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Testimonials ────────────────────────────────────── */}
      <section className="py-20 px-4 sm:px-6" style={{background:bg2}}>
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-12">
            <p className="text-xs font-bold uppercase tracking-widest mb-2" style={{color:"#8b5cf6"}}>WHAT OUR CUSTOMERS SAY</p>
            <h2 className="text-3xl font-black" style={{color:tx}}>Loved by Businesses, Trusted by Thousands</h2>
          </div>
          <div className="grid sm:grid-cols-3 gap-6">
            {TESTIMONIALS.map((t,i)=>(
              <div key={i} className="p-6 rounded-2xl border" style={{background:card,borderColor:bdr}}>
                <div className="flex gap-0.5 mb-4">{Array(t.stars).fill(0).map((_,j)=><Star key={j} size={14} className="text-yellow-400 fill-yellow-400"/>)}</div>
                <p className="text-sm leading-relaxed mb-5" style={{color:tx2}}>"{t.text}"</p>
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-bold" style={{background:"linear-gradient(135deg,#8b5cf6,#7c3aed)"}}>{t.avatar}</div>
                  <div><div className="text-sm font-semibold" style={{color:tx}}>{t.name}</div><div className="text-xs" style={{color:tx2}}>{t.biz}</div></div>
                </div>
              </div>
            ))}
          </div>
          <div className="flex justify-center gap-2 mt-6">
            {TESTIMONIALS.map((_,i)=>(
              <button key={i} onClick={()=>setTestimonialIdx(i)} className="w-2.5 h-2.5 rounded-full transition-all" style={{background:i===testimonialIdx?"#8b5cf6":"rgba(139,92,246,0.25)"}}/>
            ))}
          </div>
        </div>
      </section>

      {/* ── Pricing ─────────────────────────────────────────── */}
      <section id="pricing" className="py-20 px-4 sm:px-6">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-12">
            <p className="text-xs font-bold uppercase tracking-widest mb-2" style={{color:"#8b5cf6"}}>SIMPLE, TRANSPARENT PRICING</p>
            <h2 className="text-3xl font-black mb-8" style={{color:tx}}>Choose the Perfect Plan for Your Business</h2>
            {/* Monthly/Yearly toggle */}
            <div className="inline-flex items-center gap-1 p-1 rounded-xl border" style={{background:D?"rgba(255,255,255,0.05)":"#f3f4f6",borderColor:bdr}}>
              <button onClick={()=>setPricingYearly(false)} className="px-4 py-2 rounded-lg text-sm font-semibold transition-all" style={{background:!pricingYearly?"linear-gradient(135deg,#8b5cf6,#7c3aed)":"transparent",color:!pricingYearly?"white":tx2}}>Monthly</button>
              <button onClick={()=>setPricingYearly(true)} className="px-4 py-2 rounded-lg text-sm font-semibold transition-all flex items-center gap-2" style={{background:pricingYearly?"linear-gradient(135deg,#8b5cf6,#7c3aed)":"transparent",color:pricingYearly?"white":tx2}}>
                Yearly <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full" style={{background:"rgba(34,197,94,0.15)",color:"#22c55e"}}>Save 20%</span>
              </button>
            </div>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {PRICING.map((plan,i)=>{
              const price=pricingYearly?plan.yearly:plan.monthly;
              return(
                <div key={i} className="rounded-2xl p-6 flex flex-col relative border transition-all hover:shadow-xl hover:-translate-y-1" style={{background:plan.highlight?"linear-gradient(135deg,rgba(139,92,246,0.1),rgba(124,58,237,0.05))":card,borderColor:plan.highlight?"#8b5cf6":bdr}}>
                  {plan.highlight&&<div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full text-[10px] font-black text-white" style={{background:"linear-gradient(135deg,#8b5cf6,#7c3aed)"}}>Most Popular</div>}
                  <div className="mb-5">
                    <h3 className="font-black text-lg mb-0.5" style={{color:tx}}>{plan.name}</h3>
                    <p className="text-xs mb-4" style={{color:tx2}}>{plan.desc}</p>
                    <div className="flex items-baseline gap-1">
                      <span className="text-sm" style={{color:tx2}}>£</span>
                      <span className="text-4xl font-black" style={{color:tx}}>{price}</span>
                      <span className="text-sm" style={{color:tx2}}>/month</span>
                    </div>
                  </div>
                  <ul className="space-y-2.5 flex-1 mb-6">
                    {plan.features.map((f,j)=>(
                      <li key={j} className="flex items-start gap-2 text-xs" style={{color:tx2}}>
                        <Check size={13} className="text-violet-500 mt-0.5 flex-shrink-0"/>{f}
                      </li>
                    ))}
                  </ul>
                  <button onClick={()=>nav("signup")} className="w-full py-2.5 rounded-xl text-sm font-bold transition-all hover:opacity-90" style={{background:plan.highlight?"linear-gradient(135deg,#8b5cf6,#7c3aed)":"transparent",color:plan.highlight?"white":"#8b5cf6",border:plan.highlight?"none":`2px solid #8b5cf6`}}>
                    {plan.cta}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── CTA Banner ──────────────────────────────────────── */}
      <section className="py-16 px-4 sm:px-6" style={{background:"linear-gradient(135deg,#7c3aed 0%,#8b5cf6 50%,#6d28d9 100%)"}}>
        <div className="max-w-4xl mx-auto">
          <div className="flex flex-col lg:flex-row items-center justify-between gap-8">
            <div>
              <h2 className="text-2xl sm:text-3xl font-black text-white mb-2">Ready to Turn Visitors into Loyal Customers?</h2>
              <p className="text-purple-200 text-sm">Start your 14-day free trial today. No credit card required.</p>
              <div className="flex flex-wrap gap-4 mt-3 text-xs text-purple-200">
                {["14-Day Free Trial","No Credit Card","Cancel Anytime"].map(l=><span key={l} className="flex items-center gap-1.5"><Check size={11}/>{l}</span>)}
              </div>
            </div>
            <div className="flex flex-col sm:flex-row gap-3 w-full lg:w-auto">
              <input type="email" placeholder="Enter your business email" className="flex-1 lg:w-60 px-4 py-3 rounded-xl text-sm outline-none" style={{background:"rgba(255,255,255,0.15)",border:"1px solid rgba(255,255,255,0.3)",color:"white"}}/>
              <button onClick={()=>nav("signup")} className="px-6 py-3 rounded-xl text-sm font-bold text-violet-700 transition-all hover:opacity-90 whitespace-nowrap" style={{background:"#ffffff"}}>Start Free Trial</button>
            </div>
          </div>
        </div>
      </section>

      {/* ── Footer ──────────────────────────────────────────── */}
      <footer className="py-14 px-4 sm:px-6 border-t" style={{background:D?"#080510":"#1a1035",borderColor:"rgba(255,255,255,0.06)"}}>
        <div className="max-w-7xl mx-auto">
          <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-10 mb-10">
            <div className="lg:col-span-2">
              <div className="flex items-center gap-2 mb-3">
                <img src="/logo.svg" alt="Loyable" className="w-9 h-9 object-contain"/>
              </div>
              <p className="text-slate-400 text-xs leading-relaxed mb-4">The all-in-one loyalty and customer retention marketing platform for businesses that want to grow.</p>
              <div className="flex gap-3">
                {["f","in","tw","yt"].map(s=><div key={s} className="w-8 h-8 rounded-lg flex items-center justify-center cursor-pointer hover:opacity-80 transition-opacity" style={{background:"rgba(255,255,255,0.08)"}}><span className="text-white text-xs font-bold">{s}</span></div>)}
              </div>
            </div>
            {[
              {h:"Product",links:["Features","Pricing","Integrations","Changelog","API"]},
              {h:"Company",links:["About Us","Careers","Blog","Press","Contact"]},
              {h:"Legal",links:["Privacy Policy","Terms of Service","GDPR Compliance","Security"]},
            ].map(col=>(
              <div key={col.h}>
                <h4 className="text-white font-bold text-sm mb-4">{col.h}</h4>
                <ul className="space-y-2">{col.links.map(l=><li key={l}><a href="#" className="text-slate-400 text-xs hover:text-white transition-colors">{l}</a></li>)}</ul>
              </div>
            ))}
          </div>
          <div className="border-t pt-6 flex flex-col sm:flex-row items-center justify-between gap-3" style={{borderColor:"rgba(255,255,255,0.06)"}}>
            <p className="text-slate-500 text-xs">© 2024 Loyable. All rights reserved.</p>
            <div className="flex items-center gap-2">
              <button onClick={()=>setDark(!dark)} className="w-8 h-8 rounded-lg flex items-center justify-center hover:opacity-80 transition-opacity" style={{background:"rgba(255,255,255,0.06)"}}><span className="text-sm">{D?"☀️":"🌙"}</span></button>
              <span className="text-slate-500 text-xs">Switch to {D?"Light":"Dark"} Mode</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
    </ThemeCtx.Provider>
  );
};

const LoginPage=({onLogin}:{onLogin:(u:any)=>void})=><LandingPage onLogin={onLogin}/>;

// ════════════════════════════════════════════════════════════════
// LOADING SKELETON
// ════════════════════════════════════════════════════════════════
const Skeleton=({h="h-4",w="w-full",className=""}:{h?:string,w?:string,className?:string})=>(
  <div className={`${h} ${w} ${className} rounded-xl animate-pulse`} style={{background:"rgba(255,255,255,0.05)"}}/>
);

// ════════════════════════════════════════════════════════════════
// DASHBOARD
// ════════════════════════════════════════════════════════════════
const DashboardPage=({setPage}: {setPage:(p:string)=>void})=>{
  const [dash,setDash]=useState<any>(null);
  const [loading,setLoading]=useState(true);
  const [customers,setCustomers]=useState<any[]>([]);
  const [snapshot,setSnapshot]=useState<any[]>([]);
  const [analyticsLoading,setAnalyticsLoading]=useState(true);
  useEffect(()=>{
    api.dashboard.get().then(setDash).catch(()=>{}).finally(()=>setLoading(false));
    api.customers.list({segment:"AT_RISK",limit:4}).then(d=>setCustomers(d.customers.map(mapCustomer))).catch(()=>{});
    api.analytics.snapshot(30).then(d=>setSnapshot(Array.isArray(d)?d:[])).catch(()=>{}).finally(()=>setAnalyticsLoading(false));
  },[]);
  const k=dash?.kpis;
  const visitTrend=(dash?.visitTrend??[]).map((d:any)=>({day:d.day?.slice(5),v:d.visits,r:d.revenue}));
  const segData=(dash?.segments??[]).map((s:any)=>({...s,color:SEG_COLORS[s.name as keyof typeof SEG_COLORS]||"#8b5cf6"}));
  const quotaPct=k&&k.quotaTotal>0?Math.round((k.quotaUsed/k.quotaTotal)*100):0;
  return(
    <div className="space-y-5">
      <div className="flex items-center justify-between"><div><h1 className="text-xl font-bold text-white">Dashboard</h1><p className="text-xs text-slate-400 mt-0.5">{new Date().toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"})}</p></div><div className="flex items-center gap-2"><Badge color={C.green}>Live</Badge></div></div>
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        {loading?[...Array(6)].map((_,i)=><Skeleton key={i} h="h-24"/>):<>
          <KPI icon={Users} label="Total Customers" value={k?.totalCustomers?.toLocaleString()??"-"} change={`+${k?.newThisMonth??0} this month`} positive color={C.primary}/>
          <KPI icon={Eye} label="Active Customers" value={k?.activeCustomers?.toLocaleString()??"-"} change="30-day window" positive color={C.accent}/>
          <KPI icon={TrendingUp} label="Revenue (30d)" value={`£${(k?.revenue??0).toLocaleString()}`} change={`${k?.revenueChange>=0?"+":""}${k?.revenueChange??0}%`} positive={k?.revenueChange>=0} color={C.green}/>
          <KPI icon={Send} label="Messages (30d)" value={k?.messagesThisMonth?.toLocaleString()??"-"} change={`${quotaPct}% quota used`} positive={quotaPct<80} color={C.blue}/>
          <KPI icon={AlertTriangle} label="At Risk" value={segData.find((s:any)=>s.name==="AT_RISK")?.value??"-"} change="need attention" positive={false} color={C.red}/>
          <KPI icon={Heart} label="Retention Score" value={k&&k.totalCustomers>0?`${Math.round((k.activeCustomers/k.totalCustomers)*100)}%`:"-"} change="active/total ratio" positive color={C.pink}/>
        </>}
      </div>
      {/* Quota bar */}
      {k&&k.quotaTotal>0&&<div className="gc rounded-xl p-4" style={CARD}>
        <div className="flex items-center justify-between mb-2"><span className="text-xs text-slate-400">Monthly Message Quota</span><span className="text-xs font-medium text-white">{k.quotaUsed?.toLocaleString()} / {k.quotaTotal?.toLocaleString()}</span></div>
        <div className="h-2 rounded-full" style={{background:"rgba(255,255,255,0.08)"}}><div className="h-full rounded-full transition-all" style={{width:`${Math.min(quotaPct,100)}%`,background:quotaPct>90?"#ef4444":quotaPct>75?"#f59e0b":"#8b5cf6"}}/></div>
        {quotaPct>80&&<p className="text-xs text-amber-400 mt-1">⚠️ {quotaPct}% quota used — consider upgrading</p>}
      </div>}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="gc rounded-xl p-4" style={CARD}>
          <h3 className="text-sm font-semibold text-white mb-3">Visits & Revenue (7 days)</h3>
          {loading?<Skeleton h="h-[200px]"/>:<ResponsiveContainer width="100%" height={200}><AreaChart data={visitTrend.length?visitTrend:[{day:"No data",v:0,r:0}]}><defs><linearGradient id="gv2" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.3}/><stop offset="100%" stopColor="#8b5cf6" stopOpacity={0}/></linearGradient><linearGradient id="gr2" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#06b6d4" stopOpacity={0.3}/><stop offset="100%" stopColor="#06b6d4" stopOpacity={0}/></linearGradient></defs><CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)"/><XAxis dataKey="day" tick={{fill:"#64748b",fontSize:11}} axisLine={false} tickLine={false}/><YAxis tick={{fill:"#64748b",fontSize:11}} axisLine={false} tickLine={false}/><Tooltip contentStyle={{background:"#1e1e2d",border:"1px solid rgba(255,255,255,0.1)",borderRadius:8,fontSize:12,color:"#fff"}}/><Area type="monotone" dataKey="v" name="Visits" stroke="#8b5cf6" fill="url(#gv2)" strokeWidth={2}/><Area type="monotone" dataKey="r" name="Revenue £" stroke="#06b6d4" fill="url(#gr2)" strokeWidth={2}/></AreaChart></ResponsiveContainer>}
        </div>
        <div className="gc rounded-xl p-4" style={CARD}>
          <div className="flex items-center justify-between mb-3"><h3 className="text-sm font-semibold text-white">Customer Segments</h3></div>
          {loading?<Skeleton h="h-[200px]"/>:segData.length>0?(
            <ResponsiveContainer width="100%" height={200}><PieChart><Pie data={segData} cx="50%" cy="50%" innerRadius={55} outerRadius={80} dataKey="value" nameKey="name">{segData.map((s:any,i:number)=><Cell key={i} fill={s.color}/>)}</Pie><Tooltip contentStyle={{background:"#1e1e2d",border:"1px solid rgba(255,255,255,0.1)",borderRadius:8,fontSize:12,color:"#fff"}}/></PieChart></ResponsiveContainer>
          ):<div className="h-[200px] flex items-center justify-center text-slate-500 text-sm">No segment data yet — add customers first</div>}
        </div>
      </div>
      <div className="gc rounded-xl p-4" style={CARD}>
        <div className="flex items-center justify-between mb-3"><h3 className="text-sm font-semibold text-white">High Churn Risk Customers</h3><button onClick={()=>setPage("customers")} className="text-xs text-violet-400">View all →</button></div>
        {customers.length===0?<p className="text-xs text-slate-500 text-center py-4">No at-risk customers found</p>:<div className="space-y-2">{customers.filter(c=>c.churnRisk>0).sort((a:any,b:any)=>b.churnRisk-a.churnRisk).slice(0,4).map((c:any,i:number)=>(
          <div key={i} className="flex items-center gap-3 p-2 rounded-lg" style={{background:"rgba(255,255,255,0.02)"}}>
            <div className="w-8 h-8 rounded-full flex items-center justify-center text-white font-semibold text-xs flex-shrink-0" style={{background:`linear-gradient(135deg,${SEG_COLORS[c.segment as keyof typeof SEG_COLORS]||"#8b5cf6"},${SEG_COLORS[c.segment as keyof typeof SEG_COLORS]||"#8b5cf6"}88)`}}>{c.name.split(" ").map((n:string)=>n[0]).join("")}</div>
            <div className="flex-1 min-w-0"><div className="text-xs text-white font-medium truncate">{c.name}</div><div className="text-xs text-slate-500">{c.segment} · {c.lastVisit}</div></div>
            <div className="text-right"><div className={`text-sm font-bold ${c.churnRisk>75?"text-red-400":c.churnRisk>50?"text-amber-400":"text-green-400"}`}>{c.churnRisk}%</div><div className="text-xs text-slate-500">risk</div></div>
          </div>
        ))}</div>}
      </div>
      {/* Analytics section */}
      <div className="pt-2 border-t border-white/5">
        <h2 className="text-sm font-semibold text-white mb-3 flex items-center gap-2"><BarChart3 size={14} className="text-violet-400"/>Analytics</h2>
        {(()=>{
          const latest=snapshot[snapshot.length-1]??{};
          const msgPerf=snapshot.slice(-8).map((s:any)=>({w:(s.snapshotDate??s.createdAt??"").toString().slice(5,10),sent:s.messagesSent||0,del:s.messagesDelivered||0,read:s.messagesRead||0}));
          const growthData=snapshot.slice(-6).map((s:any)=>({m:(s.snapshotDate??s.createdAt??"").toString().slice(5,10),c:s.totalCustomers||0,ret:s.loyalCustomers||0}));
          const retRate=latest.retentionRate!=null?`${Math.round(Number(latest.retentionRate))}%`:"-";
          const avgLtv=latest.averageLtv!=null?`£${Math.round(Number(latest.averageLtv))}`:"-";
          const avgFreq=latest.repeatVisitRate!=null?`${Number(latest.repeatVisitRate).toFixed(1)}%`:"-";
          return(<>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
              {analyticsLoading?[...Array(4)].map((_,i)=><Skeleton key={i} h="h-24"/>):<>
                <KPI icon={Heart} label="Retention Rate" value={retRate} color={C.pink}/>
                <KPI icon={TrendingUp} label="Avg. LTV" value={avgLtv} color={C.amber}/>
                <KPI icon={Clock} label="Avg. Frequency" value={avgFreq} color={C.accent}/>
                <KPI icon={Users} label="Loyal + VIP" value={((latest.loyalCustomers??0)+(latest.vipCustomers??0)).toLocaleString()||"-"} color={C.green}/>
              </>}
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="gc rounded-xl p-4" style={CARD}>
                <h3 className="text-sm font-semibold text-white mb-3">Customer Segments</h3>
                {analyticsLoading?<Skeleton h="h-[180px]"/>:segData.length===0?<div className="h-[180px] flex items-center justify-center text-slate-500 text-sm">No segment data yet</div>:
                <div className="flex items-center gap-4"><ResponsiveContainer width="45%" height={180}><PieChart><Pie data={segData} cx="50%" cy="50%" innerRadius={45} outerRadius={70} dataKey="value" stroke="none">{segData.map((e:any,i:number)=><Cell key={i} fill={e.color}/>)}</Pie></PieChart></ResponsiveContainer><div className="space-y-1 flex-1">{segData.map((s:any,i:number)=><div key={i} className="flex items-center justify-between text-xs"><span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{background:s.color}}/><span className="text-slate-300">{s.name}</span></span><span className="text-white font-medium">{s.value}</span></div>)}</div></div>}
              </div>
              <div className="gc rounded-xl p-4" style={CARD}>
                <h3 className="text-sm font-semibold text-white mb-3">Message Performance (30 days)</h3>
                {analyticsLoading?<Skeleton h="h-[180px]"/>:msgPerf.length===0?<div className="h-[180px] flex items-center justify-center text-slate-500 text-sm">No snapshot data yet</div>:
                <ResponsiveContainer width="100%" height={180}><BarChart data={msgPerf}><CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)"/><XAxis dataKey="w" tick={{fill:"#64748b",fontSize:11}} axisLine={false} tickLine={false}/><YAxis tick={{fill:"#64748b",fontSize:11}} axisLine={false} tickLine={false}/><Tooltip contentStyle={{background:"#1e1e2d",border:"1px solid rgba(255,255,255,0.1)",borderRadius:8,fontSize:12,color:"#fff"}}/><Bar dataKey="sent" name="Sent" fill="#3b82f6" radius={[3,3,0,0]}/><Bar dataKey="del" name="Delivered" fill="#22c55e" radius={[3,3,0,0]}/><Bar dataKey="read" name="Read" fill="#06b6d4" radius={[3,3,0,0]}/></BarChart></ResponsiveContainer>}
              </div>
            </div>
            <div className="gc rounded-xl p-4 mt-4" style={CARD}>
              <h3 className="text-sm font-semibold text-white mb-3">Customer Growth & Retention</h3>
              {analyticsLoading?<Skeleton h="h-[200px]"/>:growthData.length===0?<div className="h-[200px] flex items-center justify-center text-slate-500 text-sm">No snapshot data yet — snapshots are computed nightly</div>:
              <ResponsiveContainer width="100%" height={200}><BarChart data={growthData}><CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)"/><XAxis dataKey="m" tick={{fill:"#64748b",fontSize:11}} axisLine={false} tickLine={false}/><YAxis tick={{fill:"#64748b",fontSize:11}} axisLine={false} tickLine={false}/><Tooltip contentStyle={{background:"#1e1e2d",border:"1px solid rgba(255,255,255,0.1)",borderRadius:8,fontSize:12,color:"#fff"}}/><Bar dataKey="c" name="Total Customers" fill="#8b5cf6" radius={[4,4,0,0]}/><Bar dataKey="ret" name="Active" fill="#22c55e" radius={[4,4,0,0]}/></BarChart></ResponsiveContainer>}
            </div>
          </>);
        })()}
      </div>
    </div>
  );
};

// ════════════════════════════════════════════════════════════════
// CUSTOMERS
// ════════════════════════════════════════════════════════════════
const CustomersPage=({onSelect}: {onSelect:(c:any)=>void})=>{
  const [q,setQ]=useState("");const [seg,setSeg]=useState("ALL");
  const [customers,setCustomers]=useState<any[]>([]);
  const [total,setTotal]=useState(0);
  const [loading,setLoading]=useState(true);
  const segs=["ALL","NEW","LOYAL","VIP","AT_RISK","BIG_SPENDER","COUPON_HUNTER","LOST"];
  useEffect(()=>{
    setLoading(true);
    const params:any={limit:100};
    if(seg!=="ALL")params.segment=seg;
    if(q)params.q=q;
    api.customers.list(params).then(d=>{setCustomers(d.customers.map(mapCustomer));setTotal(d.total);}).catch(()=>{}).finally(()=>setLoading(false));
  },[q,seg]);
  const filtered=customers;
  return(
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2"><div><h1 className="text-xl font-bold text-white">Customers</h1><p className="text-xs text-slate-400 mt-0.5">{loading?"Loading…":`${total} total · 7 segments`}</p></div></div>
      <div className="flex gap-2 flex-wrap">
        <div className="relative flex-1 min-w-48"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"/><input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search name or phone..." className="w-full pl-9 pr-3 py-2 rounded-lg text-xs text-white placeholder-slate-500 outline-none" style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.08)"}}/></div>
        <div className="flex gap-1 flex-wrap">{segs.map(s=><button key={s} onClick={()=>setSeg(s)} className={`px-2 py-1.5 rounded-lg text-xs transition-all ${seg===s?"text-white":"text-slate-400"}`} style={seg===s?{background:SEG_COLORS[s]||"rgba(139,92,246,0.2)"}:{background:"rgba(255,255,255,0.03)"}}>{s}</button>)}</div>
      </div>
      <div className="gc rounded-xl overflow-hidden" style={CARD}>
        <div className="overflow-x-auto"><table className="w-full text-xs"><thead><tr className="border-b border-white/5"><th className="text-left py-3 px-4 text-slate-400 font-medium">Customer</th><th className="text-left py-3 px-3 text-slate-400 font-medium">Segment</th><th className="text-left py-3 px-3 text-slate-400 font-medium hidden sm:table-cell">Visits</th><th className="text-left py-3 px-3 text-slate-400 font-medium hidden md:table-cell">Churn</th><th className="text-left py-3 px-3 text-slate-400 font-medium hidden md:table-cell">CLV</th><th className="text-left py-3 px-3 text-slate-400 font-medium hidden sm:table-cell">Points</th><th className="text-left py-3 px-3 text-slate-400 font-medium">Status</th></tr></thead>
          <tbody>{filtered.map(c=>(
            <tr key={c.id} onClick={()=>onSelect(c)} className="border-b border-white/3 hover:bg-white/3 cursor-pointer">
              <td className="py-3 px-4"><div className="flex items-center gap-2.5"><div className="w-8 h-8 rounded-full flex items-center justify-center text-white font-semibold text-xs" style={{background:`linear-gradient(135deg,${SEG_COLORS[c.segment]||"#8b5cf6"},${SEG_COLORS[c.segment]||"#8b5cf6"}88)`}}>{c.name.split(" ").map(n=>n[0]).join("")}</div><div><div className="text-white font-medium">{c.name}</div><div className="text-slate-500">{c.phone}</div></div></div></td>
              <td className="py-3 px-3"><Badge color={SEG_COLORS[c.segment]||"#8b5cf6"}>{c.segment}</Badge></td>
              <td className="py-3 px-3 text-slate-300 hidden sm:table-cell">{c.visits}</td>
              <td className="py-3 px-3 hidden md:table-cell"><div className="flex items-center gap-1"><div className="w-12 h-1.5 rounded-full" style={{background:"rgba(255,255,255,0.08)"}}><div className="h-full rounded-full" style={{width:`${c.churnRisk}%`,background:c.churnRisk>75?"#ef4444":c.churnRisk>40?"#f59e0b":"#22c55e"}}/></div><span className="text-xs text-slate-400">{c.churnRisk}%</span></div></td>
              <td className="py-3 px-3 text-slate-300 hidden md:table-cell">£{c.clv.toLocaleString()}</td>
              <td className="py-3 px-3 hidden sm:table-cell"><span className="text-violet-400 font-medium">{c.points.toLocaleString()}</span></td>
              <td className="py-3 px-3"><span className={`font-medium ${c.status==="Active"?"text-green-400":c.status==="At Risk"?"text-amber-400":"text-red-400"}`}>{c.status}</span></td>
            </tr>
          ))}</tbody></table></div>
      </div>
    </div>
  );
};

const CustomerProfile=({customer:c,onBack,onMsg}:{customer:any,onBack:()=>void,onMsg:(c:any)=>void})=>{
  const [ledger,setLedger]=useState<any[]>([]);
  const [msgs,setMsgs]=useState<any[]>([]);
  const [ledgerLoading,setLedgerLoading]=useState(true);
  useEffect(()=>{
    setLedgerLoading(true);
    api.customers.profile(c.id).then(d=>{
      setLedger(d.rewardPointsLedger??[]);
      setMsgs(d.messageQueue??[]);
    }).catch(()=>{}).finally(()=>setLedgerLoading(false));
  },[c.id]);
  return(
  <div className="space-y-4">
    <button onClick={onBack} className="flex items-center gap-1 text-xs text-slate-400 hover:text-white"><ChevronLeft size={14}/>Back</button>
    <div className="gc rounded-xl p-5" style={CARD}>
      <div className="flex items-start gap-4 flex-wrap">
        <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-white font-bold text-lg" style={{background:`linear-gradient(135deg,${SEG_COLORS[c.segment]||"#8b5cf6"},${SEG_COLORS[c.segment]||"#8b5cf6"}88)`}}>{c.name.split(" ").map((n:string)=>n[0]).join("")}</div>
        <div className="flex-1 min-w-48"><div className="flex items-center gap-2 flex-wrap"><h2 className="text-lg font-bold text-white">{c.name}</h2><Badge color={SEG_COLORS[c.segment as keyof typeof SEG_COLORS]||"#8b5cf6"}>{c.segment}</Badge><Badge color={TIER_COLORS[c.tier as keyof typeof TIER_COLORS]||"#6b7280"}>{c.tier}</Badge></div><div className="text-xs text-slate-400 mt-1 flex flex-wrap gap-x-4"><span className="flex items-center gap-1"><Phone size={10}/>{c.phone}</span><span className="flex items-center gap-1"><Mail size={10}/>{c.email}</span></div><div className="mt-2 flex items-center gap-2 text-xs text-slate-500"><Hash size={10}/><span className="font-mono text-violet-300">{c.referralCode}</span></div></div>
        <button onClick={()=>onMsg(c)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-white font-medium" style={{background:"linear-gradient(135deg,#25D366,#128C7E)"}}><WAIcon size={12} className="text-white"/>WhatsApp</button>
      </div>
    </div>
    <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">{[{l:"Visits",v:c.visits},{l:"Total Spent",v:`£${c.spent.toLocaleString()}`},{l:"Avg. Order",v:`£${c.avg}`},{l:"Churn Risk",v:`${c.churnRisk}%`,col:c.churnRisk>50?"#ef4444":"#22c55e"},{l:"Points Balance",v:c.points.toLocaleString()}].map((s,i)=><div key={i} className="gc rounded-xl p-3 text-center" style={CARD}><div className="text-lg font-bold" style={{color:s.col||"white"}}>{s.v}</div><div className="text-xs text-slate-400">{s.l}</div></div>)}</div>
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div className="gc rounded-xl p-4" style={CARD}>
        <h3 className="text-sm font-semibold text-white mb-3">Points Ledger (Append-Only)</h3>
        {ledgerLoading?<Skeleton h="h-20"/>:ledger.length===0?<p className="text-xs text-slate-500 text-center py-6">No points activity yet</p>:
        <div className="space-y-1 max-h-64 overflow-y-auto">{ledger.map((l:any,i:number)=><div key={l.id||i} className="flex items-center gap-3 py-2 px-3 rounded-lg" style={{background:"rgba(255,255,255,0.02)"}}><div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs flex-shrink-0 ${l.type==="CREDIT"?"bg-green-500/20 text-green-400":"bg-red-500/20 text-red-400"}`}>{l.type==="CREDIT"?"+":"-"}</div><div className="flex-1 min-w-0"><div className="text-xs text-white font-medium truncate">{l.reason||"Transaction"}</div><div className="text-xs text-slate-500 font-mono truncate">{l.externalRef||""}</div></div><div className="text-right flex-shrink-0"><div className={`text-xs font-bold ${l.type==="CREDIT"?"text-green-400":"text-red-400"}`}>{l.type==="CREDIT"?"+":"-"}{l.points}pts</div><div className="text-xs text-slate-500">{(l.balanceAfter??0).toLocaleString()} bal</div></div><div className="text-xs text-slate-600 w-14 text-right flex-shrink-0">{l.createdAt?timeAgo(l.createdAt):""}</div></div>)}</div>}
      </div>
      <div className="gc rounded-xl p-4" style={CARD}>
        <h3 className="text-sm font-semibold text-white mb-3">Message History</h3>
        {ledgerLoading?<Skeleton h="h-20"/>:msgs.length===0?<p className="text-xs text-slate-500 text-center py-6">No messages sent yet</p>:
        <div className="space-y-1 max-h-64 overflow-y-auto">{msgs.slice(0,20).map((m:any,i:number)=><div key={m.id||i} className="flex items-center gap-2 py-2 px-3 rounded-lg text-xs" style={{background:"rgba(255,255,255,0.02)"}}><Badge color={STATUS_COLORS[m.status as keyof typeof STATUS_COLORS]||"#6b7280"}>{m.status}</Badge><span className="flex-1 text-slate-300 truncate font-mono">{m.templateName||"—"}</span><span className="text-slate-600 flex-shrink-0">{m.createdAt?timeAgo(m.createdAt):""}</span></div>)}</div>}
      </div>
    </div>
  </div>
  );
};

// ════════════════════════════════════════════════════════════════
// MESSAGES
// ════════════════════════════════════════════════════════════════
const MetaWizard=({onDone,onClose})=>{
  const [step,setStep]=useState(0);const [loading,setLoading]=useState(false);
  const go=()=>{setLoading(true);setTimeout(()=>{setLoading(false);setStep(s=>s+1);},1800);};
  const steps=["Meta Login","Business","Phone","Verify","Done"];
  return(
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" style={{background:"rgba(0,0,0,0.75)",backdropFilter:"blur(8px)"}}>
      <div className="w-full max-w-lg rounded-2xl" style={{background:"#13102b",border:"1px solid rgba(255,255,255,0.08)"}}>
        <div className="p-5 border-b border-white/5"><div className="flex items-center justify-between mb-4"><div className="flex items-center gap-3"><div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{background:"rgba(37,211,102,0.15)"}}><WAIcon size={20} className="text-green-400"/></div><div><h2 className="text-base font-bold text-white">Connect Meta WhatsApp</h2><p className="text-xs text-slate-400">WAHA · Meta Cloud API · Dual gateway</p></div></div><button onClick={onClose} className="text-slate-500 hover:text-white"><X size={18}/></button></div><div className="flex gap-1">{steps.map((s,i)=><div key={i} className="flex-1"><div className={`h-1 rounded-full ${i<step?"bg-green-500":i===step?"bg-violet-500":"bg-white/10"}`}/><div className={`text-xs mt-1 ${i<=step?"text-slate-300":"text-slate-600"}`}>{s}</div></div>)}</div></div>
        <div className="p-5 min-h-[240px] flex flex-col">
          {step===0&&<div className="flex-1 flex flex-col items-center justify-center text-center space-y-4"><div className="w-14 h-14 rounded-2xl flex items-center justify-center" style={{background:"#0668E1"}}><svg width="28" height="28" viewBox="0 0 24 24" fill="white"><path d="M6.915 4.03c-1.968 0-3.286 1.14-4.323 2.89C1.56 8.567 1 10.737 1 12.2c0 2.386.843 4.2 3.111 4.2 1.39 0 2.477-.703 3.672-2.485.862-1.285 1.665-2.924 2.342-4.297l.376-.762c.537-1.084 1.14-2.238 1.86-3.166C13.38 4.353 14.632 3.6 16.1 3.6c1.737 0 3.151.85 4.153 2.372C21.224 7.4 21.8 9.544 21.8 11.8c0 2.812-.757 4.893-2.1 6.272C18.423 19.37 16.6 20 14.467 20v-2.2c1.6 0 2.857-.47 3.756-1.37.912-.912 1.477-2.387 1.477-4.63 0-1.856-.477-3.61-1.328-4.93-.756-1.174-1.725-1.77-2.872-1.77-.968 0-1.706.462-2.474 1.397-.6.73-1.14 1.694-1.735 2.896l-.309.625c-.748 1.512-1.608 3.244-2.588 4.704C7.1 16.64 5.61 17.6 3.811 17.6 1.89 17.6.5 16.527.5 13.8c0-1.3.312-2.9.973-4.385C2.2 7.83 3.2 6.47 4.47 5.53 5.4 4.83 6.467 4.43 7.615 4.43z"/></svg></div><div><h3 className="text-white font-semibold">Sign in with Meta</h3><p className="text-xs text-slate-400 max-w-xs">Connect your Meta Business Suite to access WhatsApp Cloud API with automatic BullMQ queue integration</p></div><button onClick={go} disabled={loading} className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white" style={{background:"#0668E1"}}>{loading?<RefreshCw size={16} className="animate-spin"/>:null}{loading?"Authenticating...":"Continue with Meta"}</button><p className="text-xs text-slate-500 flex items-center gap-1"><Shield size={10}/>OAuth 2.0 · Argon2id stored credentials</p></div>}
          {step===1&&<div className="flex-1 space-y-4"><div className="flex items-center gap-2 p-3 rounded-xl text-xs text-green-300" style={{background:"rgba(34,197,94,0.1)",border:"1px solid rgba(34,197,94,0.15)"}}><CircleCheck size={14}/>Connected to Meta Business Suite</div><div className="p-3 rounded-xl cursor-pointer" style={{background:"rgba(139,92,246,0.1)",border:"1px solid rgba(139,92,246,0.3)"}}><div className="text-sm text-white font-medium">The Coffee House</div><div className="text-xs text-slate-400">WABA ID: 827360646830020 · Phone ID: 944772475375221</div></div><button onClick={()=>setStep(2)} className={`${btn}`} style={{background:"linear-gradient(135deg,#8b5cf6,#7c3aed)"}}>Select this account</button></div>}
          {step===2&&<div className="flex-1 space-y-4"><label className="text-xs text-slate-400">WhatsApp Business Phone (E.164 format)</label><input defaultValue="+44 20 7946 0958" className={`${inp}`} style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.08)"}}/><div className="text-xs text-slate-500 space-y-1">{["Number must not be on WhatsApp Messenger","Must be able to receive SMS verification","Credentials encrypted with AES-256 at rest"].map((r,i)=><div key={i} className="flex items-center gap-1.5"><Check size={10} className="text-amber-400"/>{r}</div>)}</div><button onClick={go} disabled={loading} className={`${btn} flex items-center gap-2`} style={{background:"linear-gradient(135deg,#8b5cf6,#7c3aed)"}}>{loading?<RefreshCw size={12} className="animate-spin"/>:null}{loading?"Sending code...":"Send Verification Code"}</button></div>}
          {step===3&&<div className="flex-1 space-y-4"><p className="text-xs text-cyan-300 flex items-center gap-2"><Phone size={12}/>Code sent to +44 20 7946 0958</p><div className="flex gap-2">{[0,1,2,3,4,5].map(i=><input key={i} maxLength={1} className="w-10 h-12 rounded-lg text-center text-white text-lg font-bold outline-none" style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)"}}/>)}</div><button onClick={go} disabled={loading} className={`${btn} flex items-center gap-2`} style={{background:"linear-gradient(135deg,#8b5cf6,#7c3aed)"}}>{loading?<RefreshCw size={12} className="animate-spin"/>:null}{loading?"Verifying...":"Verify & Activate"}</button></div>}
          {step===4&&<div className="flex-1 flex flex-col items-center justify-center text-center space-y-4"><CircleCheck size={48} className="text-green-400"/><h3 className="text-white font-semibold text-lg">WhatsApp Connected!</h3><div className="text-xs text-slate-400 space-y-1"><div>BullMQ worker activated · Rate limiting: 200 msg/s</div><div>Cooldown interceptor: 72h · GDPR opt-out: active</div></div><button onClick={onDone} className={`${btn} px-6 py-2.5 rounded-xl text-sm font-semibold`} style={{background:"linear-gradient(135deg,#8b5cf6,#7c3aed)"}}>Go to Messages</button></div>}
        </div>
      </div>
    </div>
  );
};

const SendMessageModal=({onClose,onSent}:{onClose:()=>void,onSent:()=>void})=>{
  const [phone,setPhone]=useState("");
  const [message,setMessage]=useState("");
  const [sending,setSending]=useState(false);
  const [err,setErr]=useState<string|null>(null);
  const [customers,setCustomers]=useState<any[]>([]);
  const [search,setSearch]=useState("");
  const [selected,setSelected]=useState<any>(null);

  useEffect(()=>{
    api.customers.list({limit:50,search}).then(d=>setCustomers(d.customers??[])).catch(()=>{});
  },[search]);

  const send=async()=>{
    if(!message.trim()){setErr("Message cannot be empty");return;}
    if(!selected&&!phone.trim()){setErr("Select a customer or enter a phone number");return;}
    setSending(true);setErr(null);
    try{
      const ctrl=new AbortController();
      const timer=setTimeout(()=>ctrl.abort(),12000);
      const r=await fetch('/api/messages/send',{
        method:'POST',
        headers:{'Content-Type':'application/json','Authorization':`Bearer ${localStorage.getItem('accessToken')}`},
        body:JSON.stringify(selected?{customerId:selected.id,message}:{phone,message}),
        signal:ctrl.signal,
      });
      clearTimeout(timer);
      if(!r.ok){
        const d=await r.json().catch(()=>({}));
        const msg=d?.error||'Send failed';
        throw new Error(
          msg.includes('NETWORK_TIMEOUT')||msg.includes('not ready')
            ?'WhatsApp is not connected. Go to Settings → WhatsApp API and connect first.'
            :msg
        );
      }
      onSent();onClose();
    }catch(e:any){
      const msg=e?.name==='AbortError'?'Request timed out — WhatsApp may not be connected.':e.message||'Send failed';
      setErr(msg);
    }finally{
      setSending(false);
    }
  };

  return(
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{background:"rgba(0,0,0,0.7)"}}>
      <div className="w-full max-w-md rounded-2xl p-6 space-y-4" style={{background:"rgba(22,20,40,0.98)",border:"1px solid rgba(255,255,255,0.1)"}}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2"><WAIcon size={18} className="text-green-400"/><span className="font-bold text-white">New WhatsApp Message</span></div>
          <button onClick={onClose} className="text-slate-500 hover:text-white"><X size={16}/></button>
        </div>

        {/* Customer search */}
        <div>
          <label className="text-xs text-slate-400 mb-1 block">Send to customer</label>
          <input value={search} onChange={e=>{setSearch(e.target.value);setSelected(null);}} placeholder="Search by name or phone…" className="w-full px-3 py-2 rounded-lg text-xs text-white outline-none mb-2" style={{background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)"}}/>
          {selected
            ?<div className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{background:"rgba(37,211,102,0.1)",border:"1px solid rgba(37,211,102,0.2)"}}>
              <WAIcon size={12} className="text-green-400"/>
              <span className="text-xs text-green-300 font-medium">{selected.fullName} · {selected.whatsappNumber||selected.phone||"no number"}</span>
              <button onClick={()=>{setSelected(null);setSearch("");}} className="ml-auto text-slate-500 hover:text-white"><X size={12}/></button>
            </div>
            :search&&customers.length>0&&<div className="rounded-lg overflow-hidden max-h-36 overflow-y-auto" style={{background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.08)"}}>
              {customers.slice(0,8).map((c:any)=>(
                <button key={c.id} onClick={()=>{setSelected(c);setSearch(c.fullName);}} className="w-full text-left px-3 py-2 hover:bg-white/5 flex items-center gap-2 border-b border-white/5 last:border-0">
                  <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white" style={{background:"rgba(139,92,246,0.3)"}}>{c.fullName?.[0]}</div>
                  <div><div className="text-xs text-white">{c.fullName}</div><div className="text-xs text-slate-500">{c.whatsappNumber||"no number"}</div></div>
                </button>
              ))}
            </div>
          }
        </div>

        {/* Manual phone fallback */}
        {!selected&&<div>
          <label className="text-xs text-slate-400 mb-1 block">Or enter phone number directly</label>
          <input value={phone} onChange={e=>setPhone(e.target.value)} placeholder="+447700000000" className="w-full px-3 py-2 rounded-lg text-xs text-white outline-none font-mono" style={{background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)"}}/>
        </div>}

        {/* Message */}
        <div>
          <label className="text-xs text-slate-400 mb-1 block">Message</label>
          <textarea value={message} onChange={e=>setMessage(e.target.value)} rows={4} placeholder="Type your message here…" className="w-full px-3 py-2 rounded-lg text-xs text-white outline-none resize-none" style={{background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)"}}/>
          <div className="text-right text-xs text-slate-600 mt-0.5">{message.length} chars</div>
        </div>

        {err&&<div className="text-xs text-red-400 p-2 rounded-lg" style={{background:"rgba(239,68,68,0.1)"}}>{err}</div>}

        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 py-2 rounded-lg text-xs text-slate-400" style={{background:"rgba(255,255,255,0.04)"}}>Cancel</button>
          <button onClick={send} disabled={sending} className="flex-1 py-2 rounded-lg text-xs font-semibold text-white disabled:opacity-50 flex items-center justify-center gap-2" style={{background:"linear-gradient(135deg,#25D366,#128C7E)"}}>
            {sending?<RefreshCw size={12} className="animate-spin"/>:<Send size={12}/>}{sending?"Sending…":"Send Message"}
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Live two-way WhatsApp inbox (pulls real chats from WAHA) ──────
const chatTime=(ts:number|null)=>{if(!ts)return"";const d=new Date(ts);const now=new Date();const sameDay=d.toDateString()===now.toDateString();return sameDay?d.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}):d.toLocaleDateString([],{day:"2-digit",month:"short"});};
const ackLabel=(a:number|null)=>a==null?"":a>=3?"✓✓":a===2?"✓✓":a===1?"✓":"…";
const InboxView=({connected}:{connected:boolean})=>{
  const [convos,setConvos]=useState<any[]>([]);
  const [loadingList,setLoadingList]=useState(true);
  const [active,setActive]=useState<any>(null);
  const [thread,setThread]=useState<any[]>([]);
  const [loadingThread,setLoadingThread]=useState(false);
  const [reply,setReply]=useState("");
  const [sending,setSending]=useState(false);
  const [err,setErr]=useState("");
  const scrollRef=useRef<HTMLDivElement>(null);
  const loadList=useCallback(()=>{api.messages.inbox().then(d=>setConvos(d.conversations??[])).catch(()=>{}).finally(()=>setLoadingList(false));},[]);
  const loadThread=useCallback((chatId:string,quiet=false)=>{if(!quiet)setLoadingThread(true);api.messages.thread(chatId,3).then(d=>setThread(d.messages??[])).catch(()=>{}).finally(()=>setLoadingThread(false));},[]);
  useEffect(()=>{if(!connected)return;loadList();const t=setInterval(loadList,15000);return()=>clearInterval(t);},[connected,loadList]);
  useEffect(()=>{if(!active)return;loadThread(active.chatId);const t=setInterval(()=>loadThread(active.chatId,true),8000);return()=>clearInterval(t);},[active,loadThread]);
  useEffect(()=>{if(scrollRef.current)scrollRef.current.scrollTop=scrollRef.current.scrollHeight;},[thread]);
  const send=async()=>{
    if(!reply.trim()||!active)return;
    setSending(true);setErr("");
    const text=reply.trim();
    setReply("");
    // optimistic append
    setThread(p=>[...p,{id:`tmp${Date.now()}`,body:text,fromMe:true,timestamp:Date.now(),ack:0,type:"chat"}]);
    try{
      await api.messages.send({chatId:active.chatId,message:text});
      loadThread(active.chatId,true);loadList();
    }catch(e:any){setErr(e?.message||"Send failed");}
    finally{setSending(false);}
  };
  if(!connected)return<div className="gc rounded-xl p-10 text-center text-slate-500" style={CARD}>Connect WhatsApp in Settings → WhatsApp API to load your inbox.</div>;
  return(
    <div className="grid grid-cols-1 md:grid-cols-[320px_1fr] gap-3" style={{height:"calc(100vh - 220px)",minHeight:"480px"}}>
      {/* Conversation list */}
      <div className="gc rounded-xl overflow-hidden flex flex-col" style={CARD}>
        <div className="px-4 py-3 border-b border-white/5 flex items-center justify-between"><span className="text-xs font-semibold text-slate-300">Conversations</span><button onClick={loadList} className="text-slate-500 hover:text-white"><RefreshCw size={13}/></button></div>
        <div className="flex-1 overflow-y-auto">
          {loadingList?[...Array(6)].map((_,i)=><div key={i} className="p-3"><Skeleton h="h-10"/></div>):
           convos.length===0?<div className="p-6 text-center text-xs text-slate-500">No conversations in the last 3 days</div>:
           convos.map(c=>(
            <button key={c.chatId} onClick={()=>setActive(c)} className={`w-full text-left px-3 py-2.5 border-b border-white/3 flex items-center gap-3 transition-colors ${active?.chatId===c.chatId?"bg-white/5":"hover:bg-white/2"}`}>
              <div className="w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0" style={{background:"linear-gradient(135deg,#25D366,#128C7E)"}}>{(c.name||"?").slice(0,1).toUpperCase()}</div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2"><span className="text-xs font-medium text-white truncate">{c.name}</span><span className="text-xs text-slate-500 shrink-0">{chatTime(c.timestamp)}</span></div>
                <div className="flex items-center gap-1"><span className="text-xs text-slate-400 truncate">{c.lastFromMe?"You: ":""}{c.lastText||"—"}</span>{c.unread>0&&<span className="ml-auto shrink-0 text-xs font-bold text-white rounded-full px-1.5" style={{background:"#25D366"}}>{c.unread}</span>}</div>
              </div>
            </button>
          ))}
        </div>
      </div>
      {/* Thread */}
      <div className="gc rounded-xl overflow-hidden flex flex-col" style={CARD}>
        {!active?<div className="flex-1 flex items-center justify-center text-slate-500 text-sm">Select a conversation</div>:(
          <>
            <div className="px-4 py-3 border-b border-white/5 flex items-center gap-3">
              <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold" style={{background:"linear-gradient(135deg,#25D366,#128C7E)"}}>{(active.name||"?").slice(0,1).toUpperCase()}</div>
              <div><div className="text-sm font-semibold text-white">{active.name}</div><div className="text-xs text-slate-500">{active.phone}</div></div>
            </div>
            <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-2" style={{background:"rgba(15,15,25,0.4)"}}>
              {loadingThread?[...Array(5)].map((_,i)=><Skeleton key={i} h="h-8"/>):
               thread.length===0?<div className="text-center text-xs text-slate-500 py-6">No messages in the last 3 days</div>:
               thread.map(m=>(
                <div key={m.id} className={`flex ${m.fromMe?"justify-end":"justify-start"}`}>
                  <div className={`max-w-[75%] rounded-2xl px-3 py-2 text-xs ${m.fromMe?"text-white":"text-slate-100"}`} style={{background:m.fromMe?"linear-gradient(135deg,#25D366,#128C7E)":"rgba(255,255,255,0.07)"}}>
                    <div className="whitespace-pre-wrap break-words">{m.body}</div>
                    <div className={`text-xs mt-0.5 flex items-center gap-1 justify-end ${m.fromMe?"text-white/70":"text-slate-500"}`}>{chatTime(m.timestamp)} {m.fromMe&&<span>{ackLabel(m.ack)}</span>}</div>
                  </div>
                </div>
              ))}
            </div>
            {err&&<div className="px-4 py-1.5 text-xs text-red-400">{err}</div>}
            <div className="p-3 border-t border-white/5 flex items-center gap-2">
              <input value={reply} onChange={e=>setReply(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();send();}}} placeholder="Type a message…" className="flex-1 px-3 py-2 rounded-lg text-xs text-white outline-none" style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.08)"}}/>
              <button onClick={send} disabled={sending||!reply.trim()} className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium text-white disabled:opacity-50" style={{background:"linear-gradient(135deg,#25D366,#128C7E)"}}>{sending?<RefreshCw size={13} className="animate-spin"/>:<Send size={13}/>}Send</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

const MessagesPage=({onConnect}:{onConnect:()=>void})=>{
  const [messages,setMessages]=useState<any[]>([]);
  const [loading,setLoading]=useState(true);
  const [statusFilter,setStatusFilter]=useState("ALL");
  const [total,setTotal]=useState(0);
  const [waStatus,setWaStatus]=useState<string>("CHECKING");
  const [showCompose,setShowCompose]=useState(false);
  const [view,setView]=useState<"inbox"|"log">("inbox");
  const statuses=["ALL","SENT","DELIVERED","READ","PENDING","QUEUED","FAILED","DROPPED_COOLDOWN","DROPPED_QUOTA","CONSENT_REVOKED"];
  const load=useCallback(()=>{
    setLoading(true);
    const params:any={limit:50};
    if(statusFilter!=="ALL")params.status=statusFilter;
    api.messages.list(params).then(d=>{setMessages(d.messages??[]);setTotal(d.total??0);}).catch(()=>{}).finally(()=>setLoading(false));
  },[statusFilter]);
  useEffect(()=>{
    load();
    api.whatsapp.status().then(d=>setWaStatus(d?.waha?.status??d?.meta?.configured?"META_OK":"NOT_CONFIGURED")).catch(()=>setWaStatus("NOT_CONFIGURED"));
  },[load]);
  const connected=waStatus==="WORKING"||waStatus==="META_OK";
  const byStatus=Object.entries(STATUS_COLORS).map(([s,c])=>({s,c,n:messages.filter(m=>m.status===s).length})).filter(x=>x.n>0);
  return(
    <div className="space-y-4">
      {showCompose&&<SendMessageModal onClose={()=>setShowCompose(false)} onSent={load}/>}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-bold text-white">Messages</h1>
          <p className="text-xs text-slate-400 flex items-center gap-1.5 mt-0.5">
            <span className={`w-2 h-2 rounded-full ${connected?"bg-green-400":waStatus==="SCAN_QR_CODE"?"bg-amber-400":"bg-red-400"}`}/>
            {connected?"WhatsApp connected · live inbox":waStatus==="SCAN_QR_CODE"?"Scan QR code in Settings → WhatsApp API":"WhatsApp not connected"}
            {view==="log"?` · ${total} logged`:""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!connected&&<button onClick={onConnect} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium text-white" style={{background:"linear-gradient(135deg,#25D366,#128C7E)"}}><WAIcon size={12}/>Connect WhatsApp</button>}
          {connected&&<button onClick={()=>setShowCompose(true)} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium text-white" style={{background:"linear-gradient(135deg,#25D366,#128C7E)"}}><Send size={12}/>New Message</button>}
        </div>
      </div>
      <div className="flex gap-1">
        <button onClick={()=>setView("inbox")} className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${view==="inbox"?"text-white":"text-slate-400"}`} style={view==="inbox"?{background:"linear-gradient(135deg,#25D366,#128C7E)"}:{background:"rgba(255,255,255,0.03)"}}>Inbox</button>
        <button onClick={()=>setView("log")} className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${view==="log"?"text-white":"text-slate-400"}`} style={view==="log"?{background:"rgba(139,92,246,0.3)"}:{background:"rgba(255,255,255,0.03)"}}>Delivery Log</button>
      </div>
      {view==="inbox"?<InboxView connected={connected}/>:(
      <>
      <div className="flex gap-1 flex-wrap">{statuses.map(s=><button key={s} onClick={()=>setStatusFilter(s)} className={`px-2 py-1.5 rounded-lg text-xs transition-all ${statusFilter===s?"text-white":"text-slate-400"}`} style={statusFilter===s?{background:STATUS_COLORS[s as keyof typeof STATUS_COLORS]||"rgba(139,92,246,0.2)"}:{background:"rgba(255,255,255,0.03)"}}>{s}</button>)}</div>
      {byStatus.length>0&&<div className="flex flex-wrap gap-2">{byStatus.map(({s,c,n})=><div key={s} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs" style={{background:c+"14",border:`1px solid ${c}30`}}><div className="w-2 h-2 rounded-full" style={{background:c}}/><span className="text-slate-300">{s}</span><span className="font-bold ml-1" style={{color:c}}>{n}</span></div>)}</div>}
      <div className="gc rounded-xl overflow-hidden" style={CARD}>
        <div className="overflow-x-auto"><table className="w-full text-xs"><thead><tr className="border-b border-white/5"><th className="text-left py-3 px-4 text-slate-400 font-medium">Customer</th><th className="text-left py-3 px-3 text-slate-400 font-medium">Status</th><th className="text-left py-3 px-3 text-slate-400 font-medium hidden md:table-cell">Provider ID</th><th className="text-left py-3 px-3 text-slate-400 font-medium">Sent</th></tr></thead>
          <tbody>{loading?[...Array(6)].map((_,i)=><tr key={i}><td colSpan={4} className="py-2 px-4"><Skeleton h="h-8"/></td></tr>):messages.length===0?<tr><td colSpan={4} className="py-8 text-center text-slate-500">No messages found</td></tr>:messages.map((m:any)=>(
            <tr key={m.id} className="border-b border-white/3 hover:bg-white/2">
              <td className="py-2.5 px-4"><div className="font-medium text-white">{m.customer?.fullName||"—"}</div><div className="text-slate-500">{m.customer?.phone||""}</div></td>
              <td className="py-2.5 px-3"><Badge color={STATUS_COLORS[m.status as keyof typeof STATUS_COLORS]||"#6b7280"}>{m.status}</Badge></td>
              <td className="py-2.5 px-3 text-slate-500 hidden md:table-cell font-mono truncate max-w-[120px]">{m.providerId||<span className="text-slate-700">—</span>}</td>
              <td className="py-2.5 px-3 text-slate-400">{m.createdAt?timeAgo(m.createdAt):"—"}</td>
            </tr>
          ))}</tbody>
        </table></div>
      </div>
      </>
      )}
    </div>
  );
};

// ════════════════════════════════════════════════════════════════
// CAMPAIGN BUILDER (@dnd-kit/core simulation)
// ════════════════════════════════════════════════════════════════
const BLOCK_PALETTE=[{type:"TEXT",icon:Type,label:"Text Block",color:"#3b82f6"},{type:"IMAGE",icon:Image,label:"Image Block",color:"#22c55e"},{type:"COUPON",icon:Tag,label:"Coupon Block",color:"#f59e0b"},{type:"URL_BUTTON",icon:Link,label:"URL Button",color:"#ec4899"},{type:"AI_ASSIST",icon:Brain,label:"AI Assistant",color:"#8b5cf6"}];
const CampaignBuilderPage=({onBack})=>{
  const [blocks,setBlocks]=useState([{id:"b1",type:"TEXT",content:"Hey {name}! 👋 We have something special for you at The Coffee House."},{id:"b2",type:"COUPON",content:"20% OFF — Code: SUMMER20"}]);
  const [dragType,setDragType]=useState(null);const [selBlock,setSelBlock]=useState(null);const [aiPrompt,setAiPrompt]=useState("");const [aiLoading,setAiLoading]=useState(false);
  const dropRef=useRef(null);
  const onDragStart=(type)=>setDragType(type);
  const onDrop=e=>{e.preventDefault();if(!dragType)return;const nb={id:`b${Date.now()}`,type:dragType,content:dragType==="TEXT"?"Enter your text here...":dragType==="IMAGE"?"https://your-image-url.jpg":dragType==="COUPON"?"COUPON_CODE · 10% off":dragType==="URL_BUTTON"?"Book Now → https://...":"AI-generated content..."};setBlocks(p=>[...p,nb]);setDragType(null);};
  const runAI=async()=>{
    if(!aiPrompt.trim())return;
    setAiLoading(true);
    try{
      const d=await api.ai.query(`Write a WhatsApp marketing message for: ${aiPrompt}. Keep it under 100 words, include an emoji, be friendly and personal.`);
      const text=d.answer||"Your message here...";
      const nb={id:`b${Date.now()}`,type:"TEXT",content:text};
      setBlocks(p=>[...p,nb]);setAiPrompt("");
    }catch(e){const nb={id:`b${Date.now()}`,type:"TEXT",content:`✨ ${aiPrompt} — special offer inside!`};setBlocks(p=>[...p,nb]);setAiPrompt("");}
    finally{setAiLoading(false);}
  };
  return(
    <div className="space-y-4">
      <div className="flex items-center gap-3"><button onClick={onBack} className="text-slate-400 hover:text-white"><ChevronLeft size={20}/></button><div><h1 className="text-xl font-bold text-white">Campaign Builder</h1><p className="text-xs text-slate-400 mt-0.5">Drag blocks into the phone preview · layoutJson saved to Prisma Campaign model</p></div></div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Block Palette */}
        <div className="gc rounded-xl p-4" style={CARD}>
          <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2"><MousePointer size={14} className="text-violet-400"/>Block Palette</h3>
          <div className="space-y-2">{BLOCK_PALETTE.map(b=><div key={b.type} draggable onDragStart={()=>onDragStart(b.type)} className="flex items-center gap-3 p-3 rounded-xl cursor-grab active:cursor-grabbing select-none" style={{background:b.color+"12",border:`1px solid ${b.color}25`}}><div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{background:b.color+"20"}}><b.icon size={15} style={{color:b.color}}/></div><div><div className="text-xs font-medium text-white">{b.label}</div><div className="text-xs text-slate-500">{b.type}</div></div><div className="ml-auto text-slate-600"><MoreVertical size={14}/></div></div>)}</div>
          <div className="mt-4 p-3 rounded-xl" style={{background:"rgba(139,92,246,0.08)",border:"1px solid rgba(139,92,246,0.15)"}}>
            <div className="text-xs font-medium text-white mb-2 flex items-center gap-1.5"><Brain size={12} className="text-violet-400"/>AI Assistant</div>
            <input value={aiPrompt} onChange={e=>setAiPrompt(e.target.value)} placeholder='e.g. "10% off for Ramadan with emojis"' className="w-full px-2.5 py-2 rounded-lg text-xs text-white placeholder-slate-500 outline-none mb-2" style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.08)"}}/>
            <button onClick={runAI} disabled={!aiPrompt||aiLoading} className="w-full py-2 rounded-lg text-xs font-medium text-white flex items-center justify-center gap-2 disabled:opacity-40" style={{background:"linear-gradient(135deg,#8b5cf6,#7c3aed)"}}>{aiLoading?<RefreshCw size={12} className="animate-spin"/>:<Zap size={12}/>}{aiLoading?"Generating...":"Generate with AI"}</button>
          </div>
        </div>
        {/* Phone Preview */}
        <div className="flex flex-col items-center gap-3">
          <h3 className="text-sm font-semibold text-white self-start">Phone Preview</h3>
          <div className="w-60 rounded-3xl p-2" style={{background:"#1a1a2e",border:"2px solid rgba(255,255,255,0.1)"}}>
            <div className="h-5 flex items-center justify-center mb-1"><div className="w-16 h-1.5 rounded-full bg-white/20"/></div>
            <div className="rounded-2xl overflow-hidden" style={{background:"#0b1628"}}>
              <div className="flex items-center gap-2 p-2.5" style={{background:"#1e3a2f"}}><div className="w-7 h-7 rounded-full bg-green-500 flex items-center justify-center text-white text-xs font-bold">C</div><div className="text-xs text-white font-medium">The Coffee House</div><div className="ml-auto text-green-400 text-xs">●</div></div>
              <div ref={dropRef} onDragOver={e=>e.preventDefault()} onDrop={onDrop} className="min-h-48 p-2 space-y-2" style={{background:"url('data:image/svg+xml,%3Csvg width=20 height=20 viewBox=0 0 20 20 xmlns=http://www.w3.org/2000/svg%3E%3Ccircle cx=1 cy=1 r=0.5 fill=%23ffffff08/%3E%3C/svg%3E')"}}>
                {blocks.length===0&&<div className="flex flex-col items-center justify-center h-32 text-slate-600 text-xs text-center"><MousePointer size={20} className="mb-2 opacity-50"/>Drop blocks here</div>}
                {blocks.map((b,i)=>(
                  <div key={b.id} onClick={()=>setSelBlock(b.id===selBlock?null:b.id)} className={`rounded-xl p-2.5 cursor-pointer text-xs ${b.id===selBlock?"ring-2 ring-violet-400":""}`} style={{background:b.type==="COUPON"?"rgba(245,158,11,0.15)":b.type==="URL_BUTTON"?"rgba(236,72,153,0.15)":b.type==="IMAGE"?"rgba(34,197,94,0.15)":"rgba(255,255,255,0.06)"}}>
                    {b.type==="IMAGE"?<div className="h-16 rounded-lg bg-white/5 flex items-center justify-center text-slate-500"><Image size={20}/></div>:b.type==="URL_BUTTON"?<div className="py-1.5 text-center rounded-lg text-pink-300 font-medium text-xs" style={{background:"rgba(236,72,153,0.2)"}}>{b.content}</div>:<p className="text-white/80 text-xs leading-relaxed">{b.content}</p>}
                    <div className="flex items-center justify-between mt-1.5"><span className="text-slate-600" style={{fontSize:9}}>{b.type}</span><button onClick={e=>{e.stopPropagation();setBlocks(p=>p.filter(x=>x.id!==b.id));}} className="text-slate-600 hover:text-red-400"><X size={10}/></button></div>
                  </div>
                ))}
                <div className="border-2 border-dashed border-white/10 rounded-xl h-10 flex items-center justify-center text-slate-600 text-xs">+ Drop block</div>
              </div>
              <div className="p-2 flex gap-1.5" style={{background:"#1e3a2f"}}><div className="flex-1 rounded-full text-xs px-2 py-1.5 text-slate-400" style={{background:"rgba(255,255,255,0.05)"}}>Type a message...</div><div className="w-7 h-7 rounded-full flex items-center justify-center" style={{background:"#25D366"}}><Send size={12} className="text-white"/></div></div>
            </div>
          </div>
          <button className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white" style={{background:"linear-gradient(135deg,#8b5cf6,#7c3aed)"}}>Save & Schedule Campaign →</button>
        </div>
        {/* Properties Panel */}
        <div className="gc rounded-xl p-4" style={CARD}>
          <h3 className="text-sm font-semibold text-white mb-3">Campaign Config</h3>
          <div className="space-y-3">{[{l:"Campaign Name",v:"Summer Win-Back 2026"},{l:"Target Segment",v:"AT_RISK"},{l:"Schedule",v:"Jun 20, 2026 · 10:00 AM"},{l:"Cooldown Override",v:"72h (default)"}].map((f,i)=><div key={i}><label className="text-xs text-slate-400 mb-1 block">{f.l}</label><input defaultValue={f.v} className="w-full px-3 py-2 rounded-lg text-xs text-white outline-none" style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.08)"}}/></div>)}</div>
          <div className="mt-4 pt-4 border-t border-white/5"><div className="text-xs font-medium text-white mb-2">Payload preview (layoutJson → Prisma)</div><pre className="text-xs text-violet-300 overflow-x-auto p-2 rounded-lg" style={{background:"rgba(0,0,0,0.4)",fontSize:10}}>{JSON.stringify({blocks:blocks.map(b=>({id:b.id,type:b.type,order:blocks.indexOf(b)}))},null,2)}</pre></div>
          <div className="mt-4 pt-4 border-t border-white/5"><div className="text-xs font-medium text-white mb-2">Canvas blocks ({blocks.length})</div>{blocks.map((b,i)=><div key={b.id} className="flex items-center gap-2 py-1.5 text-xs text-slate-300"><span className="w-4 h-4 rounded text-center text-slate-500" style={{background:"rgba(255,255,255,0.05)",fontSize:9}}>{i+1}</span><span className="text-violet-300 font-mono">{b.type}</span><span className="flex-1 truncate text-slate-500">{b.content?.substring(0,25)}...</span></div>)}</div>
        </div>
      </div>
    </div>
  );
};

// ════════════════════════════════════════════════════════════════
// AUTOMATION BUILDER (reactflow simulation)
// ════════════════════════════════════════════════════════════════
const TRIGGERS=[{type:"BIRTHDAY",label:"Birthday",icon:Gift,color:"#ec4899",desc:"Customer's birthday today"},{type:"INACTIVITY",label:"Inactivity",icon:Clock,color:"#ef4444",desc:"No visit > N days"},{type:"VISIT_MILESTONE",label:"Visit Milestone",icon:Star,color:"#f59e0b",desc:"Reaches X visits"},{type:"TIER_UPGRADE",label:"Tier Upgrade",icon:Crown,color:"#06b6d4",desc:"Moves to new loyalty tier"},{type:"SENTIMENT_NEGATIVE",label:"Neg. Sentiment",icon:AlertTriangle,color:"#8b5cf6",desc:"WAHA inbound very-negative"}];
const ACTIONS=[{type:"SEND_WHATSAPP",label:"Send WhatsApp",icon:MessageSquare,color:"#25D366",desc:"Route via BullMQ → gateway"},{type:"AWARD_POINTS",label:"Award Points",icon:StarIcon,color:"#f59e0b",desc:"Append to RewardPointsLedger"},{type:"CHANGE_SEGMENT",label:"Change Segment",icon:Users,color:"#8b5cf6",desc:"Update CustomerSegment enum"},{type:"SEND_EMAIL",label:"Send Email",icon:Mail,color:"#3b82f6",desc:"Queue email job"},{type:"MANAGER_ALERT",label:"Manager Alert",icon:Bell,color:"#ef4444",desc:"Push to dashboard notification"}];
const AutomationBuilderPage=({onBack})=>{
  const [trig,setTrig]=useState("BIRTHDAY");const [acts,setActs]=useState(["SEND_WHATSAPP"]);const [delay,setDelay]=useState(0);const [saved,setSaved]=useState(false);
  const T=TRIGGERS.find(t=>t.type===trig)||TRIGGERS[0];
  const save=async()=>{
    setSaved(false);
    const body={name:`Automation ${new Date().toLocaleDateString()}`,trigger:{type:trig},graphJson:{nodes:[{type:trig},...acts.map(a=>({type:a}))],edges:[]},compiledJson:{trigger:{type:trig},actions:acts.map(a=>({type:a,delayMinutes:delay}))}};
    try{await api.automations.create(body);}catch(e){}
    setSaved(true);setTimeout(()=>setSaved(false),2500);
  };
  return(
    <div className="space-y-4">
      <div className="flex items-center gap-3"><button onClick={onBack} className="text-slate-400 hover:text-white"><ChevronLeft size={20}/></button><div><h1 className="text-xl font-bold text-white">Automation Builder</h1><p className="text-xs text-slate-400 mt-0.5">Visual reactflow canvas · compiles to graphJson + compiledJson stored in Prisma</p></div></div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Trigger */}
        <div className="gc rounded-xl p-4" style={CARD}>
          <div className="text-xs font-semibold text-cyan-400 mb-3 flex items-center gap-1.5"><div className="w-1.5 h-1.5 rounded-full bg-cyan-400"/>TRIGGER NODE</div>
          <div className="space-y-2">{TRIGGERS.map(t=><button key={t.type} onClick={()=>setTrig(t.type)} className={`w-full flex items-center gap-3 p-3 rounded-xl text-left transition-all ${trig===t.type?"ring-2":"hover:bg-white/3"}`} style={trig===t.type?{background:t.color+"15",border:`1px solid ${t.color}35`,ringColor:t.color}:{background:"rgba(255,255,255,0.02)",border:"1px solid rgba(255,255,255,0.05)"}}>
            <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{background:t.color+"20"}}><t.icon size={16} style={{color:t.color}}/></div><div className="flex-1"><div className="text-xs font-medium text-white">{t.label}</div><div className="text-xs text-slate-500">{t.desc}</div></div>{trig===t.type&&<CircleCheck size={16} style={{color:t.color}}/>}
          </button>)}</div>
        </div>
        {/* Visual Flow Canvas */}
        <div className="gc rounded-xl p-4" style={CARD}>
          <div className="text-xs font-semibold text-slate-400 mb-3">Flow Canvas</div>
          <div className="flex flex-col items-center gap-0">
            {/* Trigger node */}
            <div className="w-full max-w-xs p-3 rounded-xl flex items-center gap-3" style={{background:T.color+"15",border:`2px solid ${T.color}50`}}>
              <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{background:T.color+"25"}}><T.icon size={18} style={{color:T.color}}/></div><div><div className="text-xs font-semibold" style={{color:T.color}}>TRIGGER</div><div className="text-sm text-white font-medium">{T.label}</div></div>
            </div>
            {/* Arrow */}
            <div className="flex flex-col items-center py-1"><div className="w-px h-5 bg-violet-500/40"/><div className="w-2 h-2 rotate-45 border-r-2 border-b-2 border-violet-400" style={{marginTop:-4}}/></div>
            {/* Delay node */}
            {delay>0&&<><div className="w-full max-w-xs p-2.5 rounded-xl flex items-center gap-2 mb-0" style={{background:"rgba(245,158,11,0.1)",border:"1px solid rgba(245,158,11,0.25)"}}><Clock size={14} className="text-amber-400"/><span className="text-xs text-amber-300">Wait {delay} minutes</span></div><div className="flex flex-col items-center py-1"><div className="w-px h-5 bg-violet-500/40"/><div className="w-2 h-2 rotate-45 border-r-2 border-b-2 border-violet-400" style={{marginTop:-4}}/></div></>}
            {/* Action nodes */}
            {acts.map((a,i)=>{const A=ACTIONS.find(x=>x.type===a)||ACTIONS[0];return(<div key={a+i} className="w-full space-y-0"><div className="max-w-xs mx-auto p-3 rounded-xl flex items-center gap-3" style={{background:A.color+"15",border:`2px solid ${A.color}50`}}><div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{background:A.color+"25"}}><A.icon size={18} style={{color:A.color}}/></div><div className="flex-1"><div className="text-xs font-semibold" style={{color:A.color}}>ACTION {i+1}</div><div className="text-sm text-white font-medium">{A.label}</div></div><button onClick={()=>setActs(p=>p.filter((_,j)=>j!==i))} className="text-slate-500 hover:text-red-400"><X size={14}/></button></div>{i<acts.length-1&&<div className="flex flex-col items-center py-1"><div className="w-px h-5 bg-violet-500/40"/><div className="w-2 h-2 rotate-45 border-r-2 border-b-2 border-violet-400" style={{marginTop:-4}}/></div>}</div>);})}</div>
          <div className="mt-3 flex gap-2 justify-center"><button onClick={()=>{const unused=ACTIONS.filter(a=>!acts.includes(a.type));if(unused.length)setActs(p=>[...p,unused[0].type]);}} className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs text-violet-300 hover:bg-violet-500/10 transition-all" style={{border:"1px dashed rgba(139,92,246,0.4)"}}><Plus size={12}/>Add Action</button></div>
          <div className="mt-4 text-xs text-slate-500 text-center">graphJson → compiledJson → BullMQ job</div>
        </div>
        {/* Config & JSON */}
        <div className="gc rounded-xl p-4 space-y-4" style={CARD}>
          <div className="text-xs font-semibold text-amber-400 mb-2 flex items-center gap-1.5"><div className="w-1.5 h-1.5 rounded-full bg-amber-400"/>ACTION NODES</div>
          <div className="space-y-2">{ACTIONS.map(a=><button key={a.type} onClick={()=>!acts.includes(a.type)&&setActs(p=>[...p,a.type])} className={`w-full flex items-center gap-2 p-2.5 rounded-lg text-left text-xs transition-all ${acts.includes(a.type)?"opacity-50 cursor-not-allowed":""}`} style={{background:"rgba(255,255,255,0.02)",border:"1px solid rgba(255,255,255,0.05)"}}><a.icon size={14} style={{color:a.color}}/><span className="text-white">{a.label}</span><span className="text-slate-600 ml-auto">{a.desc}</span></button>)}</div>
          <div className="pt-3 border-t border-white/5"><label className="text-xs text-slate-400 mb-1 block">Delay before actions (minutes)</label><input type="number" value={delay} onChange={e=>setDelay(Number(e.target.value))} min={0} className="w-full px-3 py-2 rounded-lg text-xs text-white outline-none" style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.08)"}}/></div>
          <div className="pt-3 border-t border-white/5"><div className="text-xs text-slate-400 mb-2">compiledJson (persisted in AutomationWorkflow)</div><pre className="text-xs text-green-300 overflow-x-auto p-2 rounded-lg" style={{background:"rgba(0,0,0,0.4)",fontSize:10,maxHeight:100,overflow:"auto"}}>{JSON.stringify({trigger:{type:trig},actions:acts.map(a=>({type:a,delayMinutes:delay}))},null,2)}</pre></div>
          <button onClick={save} className="w-full py-2.5 rounded-xl text-xs font-semibold text-white flex items-center justify-center gap-2" style={{background:saved?"linear-gradient(135deg,#22c55e,#16a34a)":"linear-gradient(135deg,#8b5cf6,#7c3aed)"}}>{saved?<><Check size={14}/>Saved!</>:<><Zap size={14}/>Save Automation</>}</button>
        </div>
      </div>
    </div>
  );
};

// ════════════════════════════════════════════════════════════════
// LOYALTY & POINTS
// ════════════════════════════════════════════════════════════════
const LoyaltyPage=()=>{
  const [tiers,setTiers]=useState<any[]>([]);
  const [loading,setLoading]=useState(true);
  const [saving,setSaving]=useState(false);
  const [saved,setSaved]=useState(false);
  const [dashKpis,setDashKpis]=useState<any>(null);
  const [pointsConfig,setPointsConfig]=useState({pointsPerPound:1,referralBonusPoints:50,referralReferrerPoints:25,pointsExpiryDays:365,minRedeemPoints:100,redeemRate:100});
  const [savingConfig,setSavingConfig]=useState(false);
  const [savedConfig,setSavedConfig]=useState(false);
  useEffect(()=>{
    api.analytics.tiers().then(d=>setTiers(Array.isArray(d)?d:[])).catch(()=>{}).finally(()=>setLoading(false));
    api.dashboard.get().then(d=>setDashKpis(d?.kpis)).catch(()=>{});
    api.settings.get().then((d:any)=>{
      const b=d?.user?.business??d?.business??{};
      setPointsConfig(p=>({...p,
        pointsPerPound:b.pointsPerPound??1,
        referralBonusPoints:b.referralBonusPoints??50,
        referralReferrerPoints:b.referralReferrerPoints??25,
        pointsExpiryDays:b.pointsExpiryDays??365,
        minRedeemPoints:b.minRedeemPoints??100,
        redeemRate:b.redeemRate??100,
      }));
    }).catch(()=>{});
  },[]);
  const saveConfig=async()=>{
    setSavingConfig(true);
    try{
      await api.settings.update(pointsConfig);
      setSavedConfig(true);setTimeout(()=>setSavedConfig(false),2500);
    }catch{}finally{setSavingConfig(false);}
  };
  const update=(i:number,field:string,val:any)=>setTiers(p=>p.map((t,j)=>j===i?{...t,[field]:val}:t));
  const save=async()=>{
    setSaving(true);
    try{await api.analytics.updateTiers(tiers);setSaved(true);setTimeout(()=>setSaved(false),2500);}
    catch(e){}finally{setSaving(false);}
  };
  const tierColors=["#cd7f32","#c0c0c0","#ffd700","#b19cd9","#ef4444","#06b6d4"];
  return(
    <div className="space-y-5">
      <div><h1 className="text-xl font-bold text-white">Loyalty & Rewards</h1><p className="text-xs text-slate-400 mt-0.5">Configure LoyaltyTier model · Visual slider interface · saved to Prisma</p></div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KPI icon={Users} label="Total Customers" value={dashKpis?.totalCustomers?.toLocaleString()??"-"} change={`${dashKpis?.newThisMonth??0} new this month`} positive color={C.primary}/>
        <KPI icon={Eye} label="Active (30d)" value={dashKpis?.activeCustomers?.toLocaleString()??"-"} color={C.accent}/>
        <KPI icon={Send} label="Messages (Month)" value={dashKpis?.messagesThisMonth?.toLocaleString()??"-"} color={C.blue}/>
        <KPI icon={Award} label="Tiers Configured" value={loading?"-":tiers.length} color={C.amber}/>
      </div>
      <div className="gc rounded-xl p-4" style={CARD}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-white">Tier Configuration — Adjust sliders to set thresholds</h3>
          <button onClick={save} disabled={saving||loading} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium text-white disabled:opacity-50" style={{background:saved?"linear-gradient(135deg,#22c55e,#16a34a)":"linear-gradient(135deg,#8b5cf6,#7c3aed)"}}>{saving?<RefreshCw size={12} className="animate-spin"/>:saved?<Check size={12}/>:null}{saving?"Saving…":saved?"Saved!":"Save Tiers"}</button>
        </div>
        {loading?<div className="grid grid-cols-2 lg:grid-cols-4 gap-4">{[...Array(4)].map((_,i)=><Skeleton key={i} h="h-48"/>)}</div>:tiers.length===0?<p className="text-xs text-slate-500 text-center py-8">No tiers configured yet — run database seed to create default tiers</p>:
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">{tiers.sort((a,b)=>a.rank-b.rank).map((t,i)=>{
          const col=t.color||tierColors[i%tierColors.length];
          const perks:string[]=Array.isArray(t.perks)?t.perks:Array.isArray(t.benefitsJson)?t.benefitsJson.map((b:any)=>b.description||b.type||String(b)):[];
          return(
          <div key={t.id||t.rank} className="rounded-xl p-4" style={{background:`${col}08`,border:`1px solid ${col}30`}}>
            <div className="flex items-center gap-2 mb-3"><div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{background:col+"25"}}><Crown size={16} style={{color:col}}/></div><span className="text-sm font-bold" style={{color:col}}>{t.name}</span><span className="text-xs text-slate-500 ml-auto">Rank {t.rank}</span></div>
            <div className="space-y-3">
              <div><div className="flex justify-between text-xs mb-1"><span className="text-slate-400">Min Visits</span><span style={{color:col}}>{t.minVisitCount??0}</span></div><input type="range" min={0} max={50} value={t.minVisitCount??0} onChange={e=>update(i,"minVisitCount",Number(e.target.value))} className="w-full h-1.5 rounded-full appearance-none cursor-pointer" style={{accentColor:col}}/></div>
              <div><div className="flex justify-between text-xs mb-1"><span className="text-slate-400">Min Spend</span><span style={{color:col}}>£{t.minTotalSpend??0}</span></div><input type="range" min={0} max={2000} step={50} value={Number(t.minTotalSpend??0)} onChange={e=>update(i,"minTotalSpend",Number(e.target.value))} className="w-full h-1.5 rounded-full appearance-none cursor-pointer" style={{accentColor:col}}/></div>
            </div>
            {perks.length>0&&<div className="mt-3 space-y-1">{perks.map((p:string,j:number)=><div key={j} className="flex items-center gap-1 text-xs text-slate-300"><Check size={10} style={{color:col}}/>{p}</div>)}</div>}
          </div>
        )})}</div>}
      </div>
      <div className="gc rounded-xl p-4" style={CARD}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2"><Sliders size={14} className="text-violet-400"/>Points & Referral Settings</h3>
          <button onClick={saveConfig} disabled={savingConfig} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium text-white disabled:opacity-50" style={{background:savedConfig?"linear-gradient(135deg,#22c55e,#16a34a)":"linear-gradient(135deg,#8b5cf6,#7c3aed)"}}>
            {savingConfig?<RefreshCw size={12} className="animate-spin"/>:savedConfig?<Check size={12}/>:null}
            {savingConfig?"Saving…":savedConfig?"Saved!":"Save Settings"}
          </button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[
            {key:"pointsPerPound",label:"Points per £1 spent",min:1,max:10,step:1,icon:"⭐"},
            {key:"referralBonusPoints",label:"Points for new referral (referee)",min:0,max:500,step:10,icon:"🎁"},
            {key:"referralReferrerPoints",label:"Points for referring (referrer)",min:0,max:500,step:10,icon:"🤝"},
            {key:"pointsExpiryDays",label:"Points expiry (days)",min:30,max:730,step:30,icon:"⏱️"},
            {key:"minRedeemPoints",label:"Min points to redeem",min:10,max:1000,step:10,icon:"🔑"},
            {key:"redeemRate",label:"Points per £1 discount",min:10,max:500,step:10,icon:"💰"},
          ].map(({key,label,min,max,step,icon})=>(
            <div key={key} className="p-3 rounded-xl" style={{background:"rgba(255,255,255,0.02)",border:"1px solid rgba(255,255,255,0.06)"}}>
              <div className="flex items-center gap-1.5 mb-2">
                <span>{icon}</span>
                <span className="text-xs text-slate-300 font-medium">{label}</span>
              </div>
              <div className="flex items-center gap-2">
                <input type="range" min={min} max={max} step={step}
                  value={(pointsConfig as any)[key]}
                  onChange={e=>setPointsConfig(p=>({...p,[key]:Number(e.target.value)}))}
                  className="flex-1 h-1.5 rounded-full appearance-none cursor-pointer" style={{accentColor:"#8b5cf6"}}/>
                <span className="text-sm font-bold text-violet-400 min-w-[40px] text-right">{(pointsConfig as any)[key]}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="gc rounded-xl p-4" style={CARD}>
        <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2"><Info size={14} className="text-violet-400"/>How Points Work</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
          {[{icon:Star,title:"Earn Points",desc:"1 point per £1 spent at check-in. Points are awarded via the POS webhook or manual check-in.",col:C.amber},{icon:Gift,title:"Redeem Rewards",desc:"Customers redeem via QR code or staff on the POS. Redemptions create DEBIT ledger entries.",col:C.green},{icon:Crown,title:"Tier Upgrades",desc:"Tiers are evaluated nightly by cron-service. Upgrades trigger TIER_UPGRADE automation.",col:C.primary}].map((item,i)=>(
            <div key={i} className="p-3 rounded-xl" style={{background:`${item.col}0a`,border:`1px solid ${item.col}20`}}>
              <item.icon size={16} style={{color:item.col}} className="mb-2"/>
              <div className="font-medium text-white mb-1">{item.title}</div>
              <div className="text-slate-400 leading-relaxed">{item.desc}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// ════════════════════════════════════════════════════════════════
// DATA HUB
// ════════════════════════════════════════════════════════════════
const DataHubPage=()=>{
  const [tab,setTab]=useState("queue");
  const [queueMsgs,setQueueMsgs]=useState<any[]>([]);
  const [queueLoading,setQueueLoading]=useState(true);
  useEffect(()=>{
    if(tab==="queue"){
      setQueueLoading(true);
      api.messages.list({limit:50}).then(d=>setQueueMsgs(d.messages??[])).catch(()=>{}).finally(()=>setQueueLoading(false));
    }
  },[tab]);
  const sheets=[{name:"Sheet1 (Check-ins)",rows:847,status:"Synced",sync:"2 min ago"},{name:"Customer Records",rows:1680,status:"Synced",sync:"2 min ago"},{name:"Segments",rows:2060,status:"Synced",sync:"15 min ago"},{name:"Analytics_Data",rows:168,status:"Synced",sync:"1 hr ago"},{name:"Loyal Customers",rows:420,status:"Synced",sync:"1 hr ago"},{name:"Irregular Customers",rows:290,status:"Synced",sync:"1 hr ago"},{name:"Logs",rows:3240,status:"Synced",sync:"2 min ago"}];
  return(
    <div className="space-y-4">
      <div className="flex items-center justify-between"><div><h1 className="text-xl font-bold text-white">Data Hub</h1><p className="text-xs text-slate-400 mt-0.5">BullMQ queue monitor · Google Sheets sync · Processing pipeline</p></div><button className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium text-white" style={{background:"linear-gradient(135deg,#8b5cf6,#7c3aed)"}}><RefreshCw size={14}/>Sync Now</button></div>
      {/* Pipeline */}
      <div className="gc rounded-xl p-4" style={CARD}>
        <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2"><Layers size={14} className="text-violet-400"/>Check-In → BullMQ Pipeline</h3>
        <div className="flex items-center gap-2 overflow-x-auto pb-2">{[{l:"Check-In",icon:UserPlus,desc:"QR / POS Webhook",c:"#3b82f6"},{l:"Classify",icon:Layers,desc:"Segment + Tier",c:"#8b5cf6"},{l:"Consent Check",icon:Shield,desc:"Pre-flight #4",c:"#06b6d4"},{l:"Quota Guard",icon:Lock,desc:"Redis key check",c:"#f59e0b"},{l:"Cooldown",icon:Clock,desc:"72h window",c:"#ec4899"},{l:"BullMQ",icon:Database,desc:"Job enqueued",c:"#22c55e"},{l:"Gateway",icon:Send,desc:"Meta / WAHA",c:"#25D366"}].map((s,i)=>(
          <div key={i} className="flex items-center gap-1.5 flex-shrink-0">{i>0&&<ChevronRight size={12} className="text-slate-600"/>}<div className="p-2.5 rounded-xl text-center min-w-[72px]" style={{background:s.c+"10",border:`1px solid ${s.c}20`}}><s.icon size={16} className="mx-auto mb-1" style={{color:s.c}}/><div className="text-xs font-medium text-white">{s.l}</div><div className="text-xs text-slate-500" style={{fontSize:9}}>{s.desc}</div></div></div>
        ))}</div>
      </div>
      <div className="flex gap-1">{["queue","sheets","logs"].map(t=><button key={t} onClick={()=>setTab(t)} className={`px-3 py-2 rounded-lg text-xs capitalize ${tab===t?"text-white":"text-slate-400"}`} style={tab===t?{background:"rgba(139,92,246,0.2)"}:{}}>{t==="queue"?"Message Queue":t==="sheets"?"Google Sheets":"Logs"}</button>)}</div>
      {tab==="queue"&&<div className="gc rounded-xl overflow-hidden" style={CARD}>
        <div className="overflow-x-auto"><table className="w-full text-xs"><thead><tr className="border-b border-white/5"><th className="text-left py-3 px-4 text-slate-400 font-medium">Customer</th><th className="text-left py-3 px-3 text-slate-400 font-medium">Template</th><th className="text-left py-3 px-3 text-slate-400 font-medium">Status</th><th className="text-left py-3 px-3 text-slate-400 font-medium hidden md:table-cell">Provider Message ID</th><th className="text-left py-3 px-3 text-slate-400 font-medium">Time</th></tr></thead>
          <tbody>{queueLoading?[...Array(5)].map((_,i)=><tr key={i}><td colSpan={5} className="py-2 px-4"><Skeleton h="h-8"/></td></tr>):queueMsgs.length===0?<tr><td colSpan={5} className="py-8 text-center text-slate-500 text-xs">No messages in queue</td></tr>:queueMsgs.map((m:any)=>(
            <tr key={m.id} className="border-b border-white/3 hover:bg-white/2"><td className="py-2.5 px-4"><div className="font-medium text-white">{m.customer?.fullName||"—"}</div><div className="text-slate-500">{m.customer?.phone||""}</div></td><td className="py-2.5 px-3 font-mono text-violet-300">{m.templateName||"—"}</td><td className="py-2.5 px-3"><Badge color={STATUS_COLORS[m.status as keyof typeof STATUS_COLORS]||"#6b7280"}>{m.status}</Badge></td><td className="py-2.5 px-3 text-slate-500 hidden md:table-cell font-mono">{m.providerId||<span className="text-slate-700">—</span>}</td><td className="py-2.5 px-3 text-slate-400">{m.createdAt?timeAgo(m.createdAt):"—"}</td></tr>
          ))}</tbody></table></div>
        <div className="p-3 border-t border-white/5 flex flex-wrap gap-2">{Object.entries(STATUS_COLORS).map(([s,c])=><div key={s} className="flex items-center gap-1 text-xs"><div className="w-2 h-2 rounded-full" style={{background:c}}/><span className="text-slate-400">{s}</span><span className="text-white font-medium">({queueMsgs.filter((m:any)=>m.status===s).length})</span></div>)}</div>
      </div>}
      {tab==="sheets"&&<div className="space-y-2">{sheets.map((s,i)=><div key={i} className="gc flex items-center gap-3 p-3 rounded-xl" style={CARD}><Table size={14} className="text-violet-400 flex-shrink-0"/><div className="flex-1"><div className="text-xs font-medium text-white">{s.name}</div><div className="text-xs text-slate-500">{s.rows.toLocaleString()} rows · {s.sync}</div></div><Badge color={C.green}>{s.status}</Badge></div>)}</div>}
      {tab==="logs"&&<div className="rounded-xl p-4 font-mono text-xs space-y-1.5" style={{background:"rgba(8,6,18,0.95)",border:"1px solid rgba(255,255,255,0.06)",maxHeight:380,overflow:"auto"}}>{[{t:"10:42:15",l:"INFO",c:"messaging.worker",m:"PRE-FLIGHT PASSED: customerId=cust_3 all 7 checks clear → routing to META gateway"},{t:"10:42:15",l:"INFO",c:"meta.gateway",m:"SENT code=200 wamid=HBgLMzQ0N…  template=thank_you_template"},{t:"10:42:14",l:"INFO",c:"messaging.worker",m:"PRE-FLIGHT #6 COOLDOWN: DROPPED customer=cust_8 within 72h window"},{t:"10:42:13",l:"INFO",c:"messaging.worker",m:"PRE-FLIGHT #4 CONSENT: DROPPED customer=cust_7 marketingConsentWhatsapp=false"},{t:"10:42:10",l:"WARN",c:"messaging.worker",m:"PRE-FLIGHT #7 QUOTA: businessId=biz_x MONTHLY_QUOTA_EXHAUSTED → pauseTenantQueue"},{t:"10:35:00",l:"INFO",c:"waha.webhook",m:"OPT-OUT detected phone=+447977999000 keyword=STOP → ConsentChangeLog appended"},{t:"10:30:00",l:"INFO",c:"waha.webhook",m:"SENTIMENT VERY_NEGATIVE customer=cust_6 text='terrible service' → marketingPausedUntil=+72h"},{t:"01:05:00",l:"INFO",c:"analytics.cron",m:"Nightly snapshot complete: churnRate=31.6% retentionRate=68.4% avgLtv=385 businessId=biz_1"}].map((l,i)=>(
        <div key={i} className="flex gap-2"><span className="text-slate-600 flex-shrink-0">{l.t}</span><span className={l.l==="ERROR"?"text-red-400":l.l==="WARN"?"text-amber-400":"text-green-400"}>[{l.l}]</span><span className="text-violet-400 flex-shrink-0">{l.c}:</span><span className="text-slate-300">{l.m}</span></div>
      ))}</div>}
    </div>
  );
};

// ════════════════════════════════════════════════════════════════
// AI INSIGHTS
// ════════════════════════════════════════════════════════════════
const AIPage=()=>{
  const [query,setQuery]=useState("");
  const [res,setRes]=useState<any>(null);
  const [loading,setLoading]=useState(false);
  const [err,setErr]=useState("");
  const run=async()=>{
    if(!query.trim())return;
    setLoading(true);setErr("");setRes(null);
    try{const d=await api.ai.query(query);setRes(d);}
    catch(e){setErr((e as Error).message);}
    finally{setLoading(false);}
  };
  const suggestions=["How many customers haven't visited in 60 days?","Which segment has the highest average spend?","What is my churn rate this month?","Show top 5 customers by points balance"];
  return(
    <div className="space-y-4">
      <div><h1 className="text-xl font-bold text-white flex items-center gap-2"><Brain size={22} className="text-violet-400"/>AI Business Intelligence</h1><p className="text-xs text-slate-400 mt-0.5">Natural language → Prisma query → GPT insight · businessId injected server-side</p></div>
      <div className="gc rounded-xl p-4" style={CARD}>
        <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2"><Brain size={14} className="text-violet-400"/>Ask Your Data</h3>
        <div className="flex flex-wrap gap-2 mb-3">{suggestions.map((q,i)=><button key={i} onClick={()=>setQuery(q)} className="px-2.5 py-1.5 rounded-lg text-xs text-slate-300 hover:text-white hover:bg-white/5 transition-all" style={{border:"1px solid rgba(255,255,255,0.06)"}}>{q}</button>)}</div>
        <div className="flex gap-2"><input value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>e.key==="Enter"&&run()} placeholder="Ask anything about your customers, revenue, campaigns..." className={`flex-1 ${inp}`} style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.08)"}}/><button onClick={run} disabled={!query||loading} className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium text-white disabled:opacity-40" style={{background:"linear-gradient(135deg,#8b5cf6,#7c3aed)"}}>{loading?<RefreshCw size={14} className="animate-spin"/>:<Send size={14}/>}{loading?"Thinking…":"Ask"}</button></div>
        {err&&<div className="mt-3 p-3 rounded-lg text-xs text-red-400" style={{background:"rgba(239,68,68,0.08)",border:"1px solid rgba(239,68,68,0.15)"}}>{err}</div>}
        {res&&<div className="mt-3 p-4 rounded-xl" style={{background:"rgba(139,92,246,0.08)",border:"1px solid rgba(139,92,246,0.2)"}}><p className="text-sm text-white leading-relaxed">{res.answer}</p>{res.data&&Array.isArray(res.data)&&res.data.length>0&&<div className="mt-3 space-y-1">{res.data.slice(0,5).map((row:any,i:number)=><div key={i} className="text-xs text-slate-300 font-mono bg-black/20 px-2 py-1 rounded">{JSON.stringify(row)}</div>)}</div>}</div>}
      </div>
    </div>
  );
};

// ════════════════════════════════════════════════════════════════
// CUSTOMER PORTAL MANAGEMENT PAGE
// ════════════════════════════════════════════════════════════════
// Card must be defined OUTSIDE the component so its reference is stable across re-renders.
// Defining it inside would cause React to unmount/remount it on every keystroke, losing input focus.
const PortalCard=({children,className=""}:{children:any,className?:string})=>(
  <div className={`rounded-2xl p-5 ${className}`} style={{background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.08)"}}>{children}</div>
);
const CustomerPortalPage=()=>{
  const slug=localStorage.getItem("biz_slug")||"";
  const bizName=localStorage.getItem("biz_name")||"Your Business";
  const portalUrl=`${window.location.origin}/portal/${slug}`;

  const [copied,setCopied]=useState(false);
  const [qrDataUrl,setQrDataUrl]=useState("");
  const [todayCustomers,setTodayCustomers]=useState<any[]>([]);
  const [todayLoading,setTodayLoading]=useState(true);
  const [activeTab,setActiveTab]=useState<"qr"|"today"|"content">("qr");
  const canvasRef=useRef<HTMLCanvasElement>(null);

  // Portal content settings state
  const [ps,setPs]=useState<any>({showMenu:false,menuImageUrl:"",showWifi:false,wifiName:"",wifiPassword:"",showAnnouncement:false,announcementText:"",showReferral:true,showVisitHistory:true,customSections:[],bgImageMobile:"",bgImageTablet:"",bgImageDesktop:""});
  const [psLoading,setPsLoading]=useState(true);
  const [psSaving,setPsSaving]=useState(false);
  const [psSaved,setPsSaved]=useState(false);
  const [locLat,setLocLat]=useState<string>("");
  const [locLon,setLocLon]=useState<string>("");
  const [locRadius,setLocRadius]=useState<string>("30");
  const [locSaving,setLocSaving]=useState(false);
  const [locSaved,setLocSaved]=useState(false);
  const [locDetecting,setLocDetecting]=useState(false);

  // Generate QR code using qrcode library
  useEffect(()=>{
    if(!slug)return;
    import("qrcode").then(QRCode=>{
      QRCode.toDataURL(portalUrl,{width:280,margin:2,color:{dark:"#1e0a3c",light:"#ffffff"}})
        .then((url:string)=>setQrDataUrl(url)).catch(()=>{});
    }).catch(()=>{});
  },[slug]);

  // Load today's portal logins
  useEffect(()=>{
    if(!slug)return;
    api.get?.(`/portal/${slug}/today`)?.then((d:any)=>setTodayCustomers(d?.customers??[])).catch(()=>{}).finally(()=>setTodayLoading(false));
    // fallback: fetch directly
    fetch(`/api/portal/${slug}/today`,{headers:{Authorization:`Bearer ${localStorage.getItem("accessToken")}`}})
      .then(r=>r.json()).then(d=>setTodayCustomers(d?.customers??[])).catch(()=>{}).finally(()=>setTodayLoading(false));
  },[slug]);

  // Load portal settings
  useEffect(()=>{
    if(!slug)return;
    fetch(`/api/portal/${slug}/info`)
      .then(r=>r.json())
      .then(d=>{
        if(d?.portalSettings)setPs((prev:any)=>({...prev,...d.portalSettings}));
        if(d?.business?.latitude)setLocLat(String(d.business.latitude));
        if(d?.business?.longitude)setLocLon(String(d.business.longitude));
        if(d?.business?.checkInRadiusMeters)setLocRadius(String(d.business.checkInRadiusMeters));
      })
      .catch(()=>{})
      .finally(()=>setPsLoading(false));
  },[slug]);

  async function savePortalSettings(){
    setPsSaving(true);
    try{
      await api.portal.updateSettings(slug,ps);
      setPsSaved(true);setTimeout(()=>setPsSaved(false),2500);
    }catch(e:any){alert(e?.message??"Failed to save");}
    finally{setPsSaving(false);}
  }

  function addCustomSection(){
    setPs((p:any)=>({...p,customSections:[...(p.customSections||[]),{title:"",body:"",icon:"📌",visible:true}]}));
  }
  function updateSection(i:number,field:string,val:any){
    setPs((p:any)=>{const s=[...(p.customSections||[])];s[i]={...s[i],[field]:val};return{...p,customSections:s};});
  }
  function removeSection(i:number){
    setPs((p:any)=>({...p,customSections:(p.customSections||[]).filter((_:any,idx:number)=>idx!==i)}));
  }

  function copyLink(){
    navigator.clipboard.writeText(portalUrl).then(()=>{setCopied(true);setTimeout(()=>setCopied(false),2000);});
  }

  function downloadQR(){
    if(!qrDataUrl)return;
    const a=document.createElement("a");
    a.href=qrDataUrl;
    a.download=`${slug}-loyalty-qr.png`;
    a.click();
  }

  function printQR(){
    if(!qrDataUrl)return;
    const w=window.open("","_blank");
    if(!w)return;
    w.document.write(`<html><body style="margin:0;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;font-family:sans-serif;background:#fff;">
      <img src="${qrDataUrl}" style="width:280px;height:280px;margin-bottom:16px"/>
      <h2 style="margin:0 0 4px;color:#1e0a3c;font-size:18px">${bizName}</h2>
      <p style="margin:0;color:#6b7280;font-size:13px">Scan to view your loyalty rewards</p>
      <p style="margin:8px 0 0;color:#8b5cf6;font-size:11px;font-family:monospace">${portalUrl}</p>
    </body></html>`);
    w.document.close();
    w.print();
  }

  if(!slug) return(
    <div className="p-6"><div className="rounded-2xl p-8 text-center" style={{background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.08)"}}>
      <QrCode size={40} className="mx-auto mb-3 text-purple-400"/>
      <h2 className="text-white font-bold mb-2">Business slug not set</h2>
      <p className="text-slate-400 text-sm">Please log out and log in again to reload your business settings.</p>
    </div></div>
  );

  return(
    <div className="p-4 md:p-6 space-y-5 max-w-3xl">
      <div>
        <h1 className="text-xl font-bold text-white flex items-center gap-2"><QrCode size={20} className="text-purple-400"/>Customer Portal</h1>
        <p className="text-xs text-slate-400 mt-0.5">Print or share the QR code so customers can scan &amp; view their loyalty rewards</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 rounded-xl w-fit" style={{background:"rgba(255,255,255,0.05)"}}>
        {([["qr","QR Code & Link"],["today","Today's Customers"],["content","Portal Content"]] as const).map(([id,label])=>(
          <button key={id} onClick={()=>setActiveTab(id as any)}
            className="px-4 py-1.5 rounded-lg text-xs font-semibold transition-all"
            style={activeTab===id?{background:"linear-gradient(135deg,#8b5cf6,#7c3aed)",color:"white"}:{color:"#94a3b8"}}>
            {label}{id==="today"&&todayCustomers.length>0&&<span className="ml-1.5 px-1.5 py-0.5 rounded-full text-[10px]" style={{background:"rgba(139,92,246,0.3)"}}>{todayCustomers.length}</span>}
          </button>
        ))}
      </div>

      {activeTab==="qr"&&<>
        {/* Portal link */}
        <PortalCard>
          <p className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-3 flex items-center gap-2"><Link size={12}/>Portal Link</p>
          <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl mb-3" style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.08)"}}>
            <span className="flex-1 text-sm text-purple-300 font-mono truncate">{portalUrl}</span>
            <button onClick={copyLink} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
              style={copied?{background:"rgba(34,197,94,0.2)",color:"#4ade80"}:{background:"rgba(139,92,246,0.2)",color:"#a78bfa"}}>
              {copied?<><Check size={12}/>Copied!</>:<><Copy size={12}/>Copy</>}
            </button>
            <a href={portalUrl} target="_blank" rel="noreferrer" className="p-1.5 rounded-lg text-slate-400 hover:text-white transition-colors"><ExternalLink size={14}/></a>
          </div>
          <p className="text-xs text-slate-500">Share this link via WhatsApp or print the QR code below. Customers can scan it to instantly view their points, rewards, and visit history.</p>
        </PortalCard>

        {/* QR Code */}
        <PortalCard>
          <p className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-4 flex items-center gap-2"><QrCode size={12}/>QR Code</p>
          <div className="flex flex-col sm:flex-row items-center gap-6">
            <div className="rounded-2xl p-4 flex-shrink-0" style={{background:"white",boxShadow:"0 4px 24px rgba(0,0,0,0.3)"}}>
              {qrDataUrl
                ? <img src={qrDataUrl} alt="Portal QR" className="w-[200px] h-[200px]"/>
                : <div className="w-[200px] h-[200px] flex items-center justify-center text-slate-300"><QrCode size={48}/></div>
              }
            </div>
            <div className="flex-1 space-y-3">
              <div>
                <p className="text-white font-bold text-sm mb-1">{bizName}</p>
                <p className="text-slate-400 text-xs leading-relaxed">Print this QR code and display it at your entrance, tables, or on receipts. When customers scan it, they can view their loyalty points and redeem rewards.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button onClick={downloadQR} disabled={!qrDataUrl}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all disabled:opacity-40"
                  style={{background:"linear-gradient(135deg,#8b5cf6,#7c3aed)",color:"white"}}>
                  <Download size={14}/>Save PNG
                </button>
                <button onClick={printQR} disabled={!qrDataUrl}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all disabled:opacity-40"
                  style={{background:"rgba(255,255,255,0.07)",border:"1px solid rgba(255,255,255,0.12)",color:"white"}}>
                  <Printer size={14}/>Print
                </button>
              </div>
            </div>
          </div>
        </PortalCard>

        {/* How it works */}
        <PortalCard>
          <p className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-4 flex items-center gap-2"><ScanLine size={12}/>How Customers Use It</p>
          <div className="grid sm:grid-cols-3 gap-4">
            {[
              {n:"1",icon:"📱",t:"Scan QR",d:"Customer scans the QR code at your counter or table"},
              {n:"2",icon:"📝",t:"Enter Name & Phone",d:"They enter their name and phone number — no password needed"},
              {n:"3",icon:"🎁",t:"View Rewards",d:"Instantly see their points, tier, and available coupons to redeem"},
            ].map(s=>(
              <div key={s.n} className="flex gap-3">
                <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 text-lg">{s.icon}</div>
                <div>
                  <p className="text-white text-sm font-semibold">{s.t}</p>
                  <p className="text-slate-400 text-xs leading-relaxed mt-0.5">{s.d}</p>
                </div>
              </div>
            ))}
          </div>
        </PortalCard>
      </>}

      {activeTab==="today"&&<>
        <PortalCard>
          <div className="flex items-center justify-between mb-4">
            <p className="text-white font-bold flex items-center gap-2"><UserCheck size={16} className="text-purple-400"/>Today's Customers</p>
            <span className="text-xs text-slate-400">{new Date().toLocaleDateString("en-GB",{day:"numeric",month:"long"})}</span>
          </div>
          {todayLoading?(
            <div className="text-center py-8 text-slate-500 text-sm">Loading...</div>
          ):todayCustomers.length===0?(
            <div className="text-center py-10">
              <ScanLine size={36} className="mx-auto mb-3 text-slate-600"/>
              <p className="text-slate-400 font-medium text-sm">No customers have scanned today yet</p>
              <p className="text-slate-500 text-xs mt-1">Display the QR code so customers can check in</p>
            </div>
          ):(
            <div className="space-y-2">
              {todayCustomers.map((c:any,i:number)=>(
                <div key={c.id??i} className="flex items-center gap-3 px-3 py-2.5 rounded-xl" style={{background:"rgba(255,255,255,0.04)"}}>
                  <div className="w-8 h-8 rounded-xl flex items-center justify-center text-sm font-bold flex-shrink-0"
                    style={{background:"linear-gradient(135deg,#8b5cf6,#7c3aed)",color:"white"}}>
                    {(c.name||"?")[0].toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-sm font-semibold truncate">{c.name||"Unknown"}</p>
                    <p className="text-slate-400 text-xs">{c.whatsappNumber||c.phone||""}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-purple-400 text-sm font-bold">{c.pointsBalance??0} pts</p>
                    <p className="text-slate-500 text-xs">{c.tier||"Member"}</p>
                  </div>
                  {c.isNew&&<span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{background:"rgba(34,197,94,0.2)",color:"#4ade80"}}>NEW</span>}
                </div>
              ))}
            </div>
          )}
        </PortalCard>
      </>}

      {activeTab==="content"&&<>
        {psLoading?<div className="text-center py-10 text-slate-500 text-sm">Loading settings…</div>:<div className="space-y-4">
          {/* Menu */}
          <PortalCard>
            <div className="flex items-center justify-between mb-3">
              <div>
                <p className="text-white font-semibold text-sm">📋 Menu</p>
                <p className="text-slate-500 text-xs mt-0.5">Show a menu image customers can view on the portal</p>
              </div>
              <button onClick={()=>setPs((p:any)=>({...p,showMenu:!p.showMenu}))}
                className="w-11 h-6 rounded-full transition-all flex-shrink-0 relative"
                style={{background:ps.showMenu?"#8b5cf6":"rgba(255,255,255,0.12)"}}>
                <span className="absolute top-0.5 transition-all w-5 h-5 rounded-full bg-white shadow"
                  style={{left:ps.showMenu?"calc(100% - 22px)":"2px"}}/>
              </button>
            </div>
            {ps.showMenu&&(
              <div className="mt-3 space-y-2">
                <label className="text-xs text-slate-400">Menu URL</label>
                <input value={ps.menuImageUrl||""} onChange={e=>setPs((p:any)=>({...p,menuImageUrl:e.target.value}))}
                  placeholder="https://example.com/menu.jpg or menu.pdf"
                  className="w-full px-3 py-2 rounded-xl text-sm text-white placeholder-slate-500 outline-none"
                  style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)"}}/>
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-px" style={{background:"rgba(255,255,255,0.08)"}}/>
                  <span className="text-xs text-slate-500">or upload file</span>
                  <div className="flex-1 h-px" style={{background:"rgba(255,255,255,0.08)"}}/>
                </div>
                <label className="flex items-center justify-center gap-2 py-2.5 rounded-xl cursor-pointer transition-all"
                  style={{background:"rgba(139,92,246,0.12)",border:"1px dashed rgba(139,92,246,0.4)",color:"#c4b5fd"}}>
                  <input type="file" accept=".jpg,.jpeg,.png,.webp,.pdf" className="hidden"
                    onChange={async e=>{
                      const f=e.target.files?.[0]; if(!f) return;
                      if(f.size>10*1024*1024){alert("File too large (max 10 MB)"); return;}
                      try{
                        const r=await api.upload.menu(f);
                        setPs((p:any)=>({...p,menuImageUrl:r.url}));
                      }catch(err:any){alert(err.message??'Upload failed');}
                    }}/>
                  <span className="text-sm">📎 Upload JPG, PNG, WebP or PDF</span>
                  <span className="text-xs opacity-60">max 10 MB</span>
                </label>
                {ps.menuImageUrl&&(
                  <p className="text-xs text-green-400 truncate">✓ {ps.menuImageUrl.split('/').pop()}</p>
                )}
              </div>
            )}
          </PortalCard>

          {/* Background Images */}
          <PortalCard>
            <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
              <Image size={14} className="text-violet-400"/>Background Images
            </h3>
            <p className="text-xs text-slate-400 mb-3">Upload custom backgrounds for different screen sizes. Customers will see these behind the portal.</p>
            {(["Mobile","Tablet","Desktop"] as const).map(device=>{
              const key = `bgImage${device}` as "bgImageMobile"|"bgImageTablet"|"bgImageDesktop";
              return(
                <div key={device} className="mb-3">
                  <label className="text-xs text-slate-400 mb-1 block">{device} Background</label>
                  <label className="flex items-center justify-center gap-2 py-2 rounded-xl cursor-pointer transition-all" style={{background:"rgba(139,92,246,0.08)",border:"1px dashed rgba(139,92,246,0.3)",color:"#c4b5fd"}}>
                    <input type="file" accept=".jpg,.jpeg,.png,.webp" className="hidden"
                      onChange={async e=>{
                        const f=e.target.files?.[0]; if(!f) return;
                        if(f.size>5*1024*1024){alert("Max 5 MB"); return;}
                        try{ const r=await api.upload.menu(f); setPs((p:any)=>({...p,[key]:r.url})); }
                        catch(err:any){alert(err.message??'Upload failed');}
                      }}/>
                    <span className="text-sm">📸 Upload {device} BG</span>
                  </label>
                  {ps[key]&&<p className="text-xs text-green-400 mt-1 truncate">✓ {ps[key].split('/').pop()}</p>}
                </div>
              );
            })}
          </PortalCard>

          {/* WiFi */}
          <PortalCard>
            <div className="flex items-center justify-between mb-3">
              <div>
                <p className="text-white font-semibold text-sm">📶 WiFi Password</p>
                <p className="text-slate-500 text-xs mt-0.5">Show your WiFi details on the customer portal</p>
              </div>
              <button onClick={()=>setPs((p:any)=>({...p,showWifi:!p.showWifi}))}
                className="w-11 h-6 rounded-full transition-all flex-shrink-0 relative"
                style={{background:ps.showWifi?"#8b5cf6":"rgba(255,255,255,0.12)"}}>
                <span className="absolute top-0.5 transition-all w-5 h-5 rounded-full bg-white shadow"
                  style={{left:ps.showWifi?"calc(100% - 22px)":"2px"}}/>
              </button>
            </div>
            {ps.showWifi&&(
              <div className="mt-3 grid sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Network Name (SSID)</label>
                  <input value={ps.wifiName||""} onChange={e=>setPs((p:any)=>({...p,wifiName:e.target.value}))}
                    placeholder="My Restaurant WiFi"
                    className="w-full px-3 py-2 rounded-xl text-sm text-white placeholder-slate-500 outline-none"
                    style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)"}}/>
                </div>
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Password</label>
                  <input value={ps.wifiPassword||""} onChange={e=>setPs((p:any)=>({...p,wifiPassword:e.target.value}))}
                    placeholder="Enter password"
                    className="w-full px-3 py-2 rounded-xl text-sm text-white placeholder-slate-500 outline-none"
                    style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)"}}/>
                </div>
              </div>
            )}
          </PortalCard>

          {/* Announcement */}
          <PortalCard>
            <div className="flex items-center justify-between mb-3">
              <div>
                <p className="text-white font-semibold text-sm">📢 Announcement Banner</p>
                <p className="text-slate-500 text-xs mt-0.5">Pin a message visible to all customers at the top</p>
              </div>
              <button onClick={()=>setPs((p:any)=>({...p,showAnnouncement:!p.showAnnouncement}))}
                className="w-11 h-6 rounded-full transition-all flex-shrink-0 relative"
                style={{background:ps.showAnnouncement?"#8b5cf6":"rgba(255,255,255,0.12)"}}>
                <span className="absolute top-0.5 transition-all w-5 h-5 rounded-full bg-white shadow"
                  style={{left:ps.showAnnouncement?"calc(100% - 22px)":"2px"}}/>
              </button>
            </div>
            {ps.showAnnouncement&&(
              <textarea value={ps.announcementText||""} onChange={e=>setPs((p:any)=>({...p,announcementText:e.target.value}))}
                placeholder="e.g. 🎉 Happy Hour every Friday 5–8pm! 20% off all drinks."
                rows={3}
                className="w-full mt-3 px-3 py-2 rounded-xl text-sm text-white placeholder-slate-500 outline-none resize-none"
                style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)"}}/>
            )}
          </PortalCard>

          {/* Built-in toggles */}
          <PortalCard>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-3">Show / Hide Sections</p>
            <div className="space-y-3">
              {[
                {key:"showReferral",label:"🎁 Referral Programme",desc:"Let customers see their referral code and share it"},
                {key:"showVisitHistory",label:"🕐 Visit History",desc:"Show a list of past visits with points earned"},
              ].map(item=>(
                <div key={item.key} className="flex items-center justify-between">
                  <div>
                    <p className="text-white text-sm font-medium">{item.label}</p>
                    <p className="text-slate-500 text-xs">{item.desc}</p>
                  </div>
                  <button onClick={()=>setPs((p:any)=>({...p,[item.key]:!p[item.key]}))}
                    className="w-11 h-6 rounded-full transition-all flex-shrink-0 relative"
                    style={{background:ps[item.key]?"#8b5cf6":"rgba(255,255,255,0.12)"}}>
                    <span className="absolute top-0.5 transition-all w-5 h-5 rounded-full bg-white shadow"
                      style={{left:ps[item.key]?"calc(100% - 22px)":"2px"}}/>
                  </button>
                </div>
              ))}
            </div>
          </PortalCard>

          {/* Custom sections */}
          <PortalCard>
            <div className="flex items-center justify-between mb-3">
              <div>
                <p className="text-white font-semibold text-sm">✨ Custom Info Sections</p>
                <p className="text-slate-500 text-xs mt-0.5">Add any extra info: opening hours, events, offers, etc.</p>
              </div>
              <button onClick={addCustomSection}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold"
                style={{background:"rgba(139,92,246,0.2)",color:"#a78bfa"}}>
                <Plus size={12}/>Add Section
              </button>
            </div>
            {(ps.customSections||[]).length===0&&(
              <p className="text-slate-500 text-xs text-center py-4">No custom sections yet. Click "Add Section" to create one.</p>
            )}
            <div className="space-y-3">
              {(ps.customSections||[]).map((sec:any,i:number)=>(
                <div key={i} className="rounded-xl p-3 space-y-2" style={{background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.07)"}}>
                  <div className="flex items-center gap-2">
                    <input value={sec.icon||""} onChange={e=>updateSection(i,"icon",e.target.value)}
                      className="w-10 text-center px-1 py-1.5 rounded-lg text-sm outline-none"
                      style={{background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)",color:"white"}}
                      placeholder="📌" maxLength={4}/>
                    <input value={sec.title||""} onChange={e=>updateSection(i,"title",e.target.value)}
                      placeholder="Section title"
                      className="flex-1 px-3 py-1.5 rounded-lg text-sm text-white placeholder-slate-500 outline-none"
                      style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)"}}/>
                    <button onClick={()=>updateSection(i,"visible",!sec.visible)}
                      className="w-9 h-5 rounded-full transition-all flex-shrink-0 relative"
                      style={{background:sec.visible?"#8b5cf6":"rgba(255,255,255,0.12)"}}>
                      <span className="absolute top-0.5 transition-all w-4 h-4 rounded-full bg-white shadow"
                        style={{left:sec.visible?"calc(100% - 18px)":"2px"}}/>
                    </button>
                    <button onClick={()=>removeSection(i)} className="text-slate-500 hover:text-red-400 transition-colors"><X size={14}/></button>
                  </div>
                  <textarea value={sec.body||""} onChange={e=>updateSection(i,"body",e.target.value)}
                    placeholder="Section content…"
                    rows={2}
                    className="w-full px-3 py-2 rounded-lg text-sm text-white placeholder-slate-500 outline-none resize-none"
                    style={{background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.08)"}}/>
                </div>
              ))}
            </div>
          </PortalCard>

          {/* Check-in Location */}
          <PortalCard>
            <div className="flex items-center justify-between mb-3">
              <div>
                <p className="text-white font-semibold text-sm">📍 Check-in Location</p>
                <p className="text-slate-500 text-xs mt-0.5">Customers must be within the set radius to check in</p>
              </div>
              <button onClick={()=>{
                  setLocDetecting(true);
                  navigator.geolocation.getCurrentPosition(p=>{
                    setLocLat(p.coords.latitude.toFixed(7));
                    setLocLon(p.coords.longitude.toFixed(7));
                    setLocDetecting(false);
                  },()=>setLocDetecting(false),{enableHighAccuracy:true,timeout:10000});
                }}
                disabled={locDetecting}
                className="px-3 py-1.5 rounded-xl text-xs font-semibold disabled:opacity-50"
                style={{background:"rgba(139,92,246,0.2)",color:"#a78bfa"}}>
                {locDetecting?"Detecting…":"📡 Use My Location"}
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-slate-400 block mb-1">Latitude</label>
                <input value={locLat} onChange={e=>setLocLat(e.target.value)} placeholder="e.g. 51.5074"
                  className="w-full px-3 py-2 rounded-xl text-sm text-white placeholder-slate-500 outline-none"
                  style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)"}}/>
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1">Longitude</label>
                <input value={locLon} onChange={e=>setLocLon(e.target.value)} placeholder="e.g. -0.1278"
                  className="w-full px-3 py-2 rounded-xl text-sm text-white placeholder-slate-500 outline-none"
                  style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)"}}/>
              </div>
            </div>
            <div className="mt-3">
              <label className="text-xs text-slate-400 block mb-1">Allowed Radius (metres)</label>
              <input type="number" min={10} max={500} value={locRadius} onChange={e=>setLocRadius(e.target.value)} placeholder="30"
                className="w-full px-3 py-2 rounded-xl text-sm text-white placeholder-slate-500 outline-none"
                style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)"}}/>
              <p className="text-xs text-slate-500 mt-1">Default is 30 m. Min 10 m, max 500 m.</p>
            </div>
            <button onClick={async()=>{
                const lat=parseFloat(locLat), lon=parseFloat(locLon), r=parseInt(locRadius)||30;
                if(isNaN(lat)||isNaN(lon)){alert("Enter valid latitude and longitude");return;}
                setLocSaving(true);
                try{
                  await fetch(`/api/portal/${slug}/location`,{
                    method:"PATCH",
                    headers:{"Content-Type":"application/json","Authorization":`Bearer ${localStorage.getItem("loyable_token")??""}`},
                    body:JSON.stringify({latitude:lat,longitude:lon,checkInRadiusMeters:r}),
                  });
                  setLocSaved(true); setTimeout(()=>setLocSaved(false),2500);
                }catch{}
                setLocSaving(false);
              }}
              disabled={locSaving||!locLat||!locLon}
              className="w-full mt-3 py-2 rounded-xl text-sm font-semibold transition-all disabled:opacity-50"
              style={{background:"rgba(139,92,246,0.2)",border:"1px solid rgba(139,92,246,0.35)",color:"#c4b5fd"}}>
              {locSaving?"Saving…":locSaved?"✓ Saved!":"Save Location"}
            </button>
          </PortalCard>

          {/* Save button */}
          <button onClick={savePortalSettings} disabled={psSaving}
            className="w-full py-3 rounded-xl font-bold text-sm transition-all disabled:opacity-60 flex items-center justify-center gap-2"
            style={{background:"linear-gradient(135deg,#8b5cf6,#7c3aed)",color:"white"}}>
            {psSaving?"Saving…":psSaved?<><Check size={16}/>Saved!</>:"Save Portal Settings"}
          </button>
        </div>}
      </>}
    </div>
  );
};

// ════════════════════════════════════════════════════════════════
// CUSTOMERS UNIFIED (Customers + Loyalty + Portal tabs)
// ════════════════════════════════════════════════════════════════
const CustomersUnifiedPage=({onSelect,setPage}:{onSelect:(c:any)=>void,setPage:(p:string)=>void})=>{
  const [tab,setTab]=useState(()=>localStorage.getItem("customers_tab")??"customers");
  const switchTab=(t:string)=>{setTab(t);localStorage.setItem("customers_tab",t);};
  const tabs=[
    {id:"customers",label:"Customers",icon:Users},
    {id:"loyalty",label:"Loyalty & Points",icon:Award},
    {id:"portal",label:"Customer Portal",icon:QrCode},
  ];
  return(
    <div className="space-y-4">
      <div className="flex gap-1 p-1 rounded-xl" style={{background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.06)"}}>
        {tabs.map(t=>(
          <button key={t.id} onClick={()=>switchTab(t.id)}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-xs font-medium transition-all ${tab===t.id?"text-white":"text-slate-400 hover:text-slate-200"}`}
            style={tab===t.id?{background:"linear-gradient(135deg,rgba(139,92,246,0.25),rgba(6,182,212,0.1))"}:{}}>
            <t.icon size={13}/>{t.label}
          </button>
        ))}
      </div>
      {tab==="customers"&&<CustomersPage onSelect={onSelect}/>}
      {tab==="loyalty"&&<LoyaltyPage/>}
      {tab==="portal"&&<CustomerPortalPage/>}
    </div>
  );
};

// ════════════════════════════════════════════════════════════════
// ANALYTICS
// ════════════════════════════════════════════════════════════════
const AnalyticsPage=()=>{
  const [snapshot,setSnapshot]=useState<any[]>([]);
  const [segData,setSegData]=useState<any[]>([]);
  const [loading,setLoading]=useState(true);
  useEffect(()=>{
    Promise.all([
      api.analytics.snapshot(30).then(d=>setSnapshot(Array.isArray(d)?d:[])).catch(()=>{}),
      api.dashboard.get().then(d=>setSegData((d?.segments??[]).map((s:any)=>({...s,color:SEG_COLORS[s.name as keyof typeof SEG_COLORS]||"#8b5cf6"})))).catch(()=>{}),
    ]).finally(()=>setLoading(false));
  },[]);
  const latest=snapshot[snapshot.length-1]??{};
  const msgPerf=snapshot.slice(-8).map((s:any)=>({w:(s.snapshotDate??s.createdAt??"").toString().slice(5,10),sent:s.messagesSent||0,del:s.messagesDelivered||0,read:s.messagesRead||0}));
  const growthData=snapshot.slice(-6).map((s:any)=>({m:(s.snapshotDate??s.createdAt??"").toString().slice(5,10),c:s.totalCustomers||0,ret:s.loyalCustomers||0}));
  const retRate=latest.retentionRate!=null?`${Math.round(Number(latest.retentionRate))}%`:"-";
  const avgLtv=latest.averageLtv!=null?`£${Math.round(Number(latest.averageLtv))}`:"-";
  const avgFreq=latest.repeatVisitRate!=null?`${Number(latest.repeatVisitRate).toFixed(1)}%`:"-";
  return(
  <div className="space-y-4">
    <div><h1 className="text-xl font-bold text-white">Analytics</h1><p className="text-xs text-slate-400 mt-0.5">Pre-computed AnalyticsSnapshot · nightly node-cron · never live DB queries</p></div>
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {loading?[...Array(4)].map((_,i)=><Skeleton key={i} h="h-24"/>):<>
        <KPI icon={Heart} label="Retention Rate" value={retRate} color={C.pink}/>
        <KPI icon={TrendingUp} label="Avg. LTV" value={avgLtv} color={C.amber}/>
        <KPI icon={Clock} label="Avg. Frequency" value={avgFreq} color={C.accent}/>
        <KPI icon={Users} label="Loyal + VIP" value={((latest.loyalCustomers??0)+(latest.vipCustomers??0)).toLocaleString()||"-"} color={C.green}/>
      </>}
    </div>
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div className="gc rounded-xl p-4" style={CARD}>
        <h3 className="text-sm font-semibold text-white mb-3">Customer Segments</h3>
        {loading?<Skeleton h="h-[180px]"/>:segData.length===0?<div className="h-[180px] flex items-center justify-center text-slate-500 text-sm">No segment data yet</div>:
        <div className="flex items-center gap-4"><ResponsiveContainer width="45%" height={180}><PieChart><Pie data={segData} cx="50%" cy="50%" innerRadius={45} outerRadius={70} dataKey="value" stroke="none">{segData.map((e:any,i:number)=><Cell key={i} fill={e.color}/>)}</Pie></PieChart></ResponsiveContainer><div className="space-y-1 flex-1">{segData.map((s:any,i:number)=><div key={i} className="flex items-center justify-between text-xs"><span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{background:s.color}}/><span className="text-slate-300">{s.name}</span></span><span className="text-white font-medium">{s.value}</span></div>)}</div></div>}
      </div>
      <div className="gc rounded-xl p-4" style={CARD}>
        <h3 className="text-sm font-semibold text-white mb-3">Message Performance (30 days)</h3>
        {loading?<Skeleton h="h-[180px]"/>:msgPerf.length===0?<div className="h-[180px] flex items-center justify-center text-slate-500 text-sm">No snapshot data yet</div>:
        <ResponsiveContainer width="100%" height={180}><BarChart data={msgPerf}><CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)"/><XAxis dataKey="w" tick={{fill:"#64748b",fontSize:11}} axisLine={false} tickLine={false}/><YAxis tick={{fill:"#64748b",fontSize:11}} axisLine={false} tickLine={false}/><Tooltip contentStyle={{background:"#1e1e2d",border:"1px solid rgba(255,255,255,0.1)",borderRadius:8,fontSize:12,color:"#fff"}}/><Bar dataKey="sent" name="Sent" fill="#3b82f6" radius={[3,3,0,0]}/><Bar dataKey="del" name="Delivered" fill="#22c55e" radius={[3,3,0,0]}/><Bar dataKey="read" name="Read" fill="#06b6d4" radius={[3,3,0,0]}/></BarChart></ResponsiveContainer>}
      </div>
    </div>
    <div className="gc rounded-xl p-4" style={CARD}>
      <h3 className="text-sm font-semibold text-white mb-3">Customer Growth & Retention</h3>
      {loading?<Skeleton h="h-[200px]"/>:growthData.length===0?<div className="h-[200px] flex items-center justify-center text-slate-500 text-sm">No snapshot data yet — snapshots are computed nightly</div>:
      <ResponsiveContainer width="100%" height={200}><BarChart data={growthData}><CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)"/><XAxis dataKey="m" tick={{fill:"#64748b",fontSize:11}} axisLine={false} tickLine={false}/><YAxis tick={{fill:"#64748b",fontSize:11}} axisLine={false} tickLine={false}/><Tooltip contentStyle={{background:"#1e1e2d",border:"1px solid rgba(255,255,255,0.1)",borderRadius:8,fontSize:12,color:"#fff"}}/><Bar dataKey="c" name="Total Customers" fill="#8b5cf6" radius={[4,4,0,0]}/><Bar dataKey="ret" name="Active" fill="#22c55e" radius={[4,4,0,0]}/></BarChart></ResponsiveContainer>}
    </div>
  </div>
  );
};

// ════════════════════════════════════════════════════════════════
// SETTINGS
// ════════════════════════════════════════════════════════════════
const WhatsAppSettingsTab=()=>{
  const [status,setStatus]=useState<any>(null);
  const [qr,setQr]=useState<string|null>(null);
  const [loading,setLoading]=useState(true);
  const [starting,setStarting]=useState(false);
  const [errMsg,setErrMsg]=useState<string|null>(null);
  const [showAdvanced,setShowAdvanced]=useState(false);
  const [cfg,setCfg]=useState({wahaBaseUrl:"",wahaSessionId:"default",wahaApiKey:""});
  const [saving,setSaving]=useState(false);

  const fetchQr=async()=>{
    try{const d=await api.whatsapp.qr();if(d?.qr)setQr(d.qr);}catch{}
  };

  const fetchStatus=async()=>{
    try{
      const d=await api.whatsapp.status();
      setStatus(d);
      if(d.waha?.status==="SCAN_QR_CODE")fetchQr();
      else if(d.waha?.status==="WORKING")setQr(null);
    }catch{}finally{setLoading(false);}
  };

  useEffect(()=>{
    fetchStatus();
    const iv=setInterval(fetchStatus,6000);
    return()=>clearInterval(iv);
  },[]);

  // Refresh QR every 10s while in scan state — WhatsApp QR expires in ~20s
  const wsStatus=status?.waha?.status;
  useEffect(()=>{
    if(wsStatus!=="SCAN_QR_CODE")return;
    const qrIv=setInterval(fetchQr,10000);
    return()=>clearInterval(qrIv);
  },[wsStatus]);

  const connect=async()=>{
    setStarting(true);setErrMsg(null);
    try{
      const body:any={};
      if(cfg.wahaBaseUrl)body.wahaBaseUrl=cfg.wahaBaseUrl;
      if(cfg.wahaApiKey)body.wahaApiKey=cfg.wahaApiKey;
      if(cfg.wahaSessionId&&cfg.wahaSessionId!=="default")body.wahaSessionId=cfg.wahaSessionId;
      await api.whatsapp.startSession(body);
      setTimeout(fetchStatus,2000);
      setTimeout(fetchQr,3500);
    }catch(e:any){setErrMsg(e?.message||"Could not connect. Is WAHA running?");}
    finally{setStarting(false);}
  };

  const disconnect=async()=>{
    try{await api.whatsapp.stopSession();setTimeout(fetchStatus,1500);}catch{}
  };

  const saveAdvanced=async()=>{
    setSaving(true);
    try{await api.whatsapp.saveConfig(cfg);await fetchStatus();}catch{}
    setSaving(false);
  };

  const ws=status?.waha?.status||"NOT_CONFIGURED";
  const connected=ws==="WORKING";
  const scanning=ws==="SCAN_QR_CODE";
  const starting2=ws==="STARTING";

  if(loading)return<Skeleton h="h-48"/>;

  return(
    <div className="space-y-5">
      {/* Big status card */}
      <div className="rounded-2xl p-6 text-center" style={{background:connected?"rgba(34,197,94,0.08)":scanning||starting2?"rgba(251,191,36,0.08)":"rgba(255,255,255,0.03)",border:`1px solid ${connected?"rgba(34,197,94,0.2)":scanning||starting2?"rgba(251,191,36,0.2)":"rgba(255,255,255,0.08)"}`}}>
        <div className={`w-16 h-16 rounded-full mx-auto mb-4 flex items-center justify-center`} style={{background:connected?"rgba(37,211,102,0.15)":scanning||starting2?"rgba(251,191,36,0.15)":"rgba(255,255,255,0.05)"}}>
          <WAIcon size={32} className={connected?"text-green-400":scanning||starting2?"text-amber-400":"text-slate-400"}/>
        </div>
        {connected&&<>
          <div className="text-lg font-bold text-green-400 mb-1">WhatsApp Connected</div>
          <div className="text-xs text-slate-400 mb-4">Your WhatsApp is linked and ready to send messages</div>
          <button onClick={disconnect} className="px-4 py-2 rounded-lg text-xs text-red-400 font-medium" style={{border:"1px solid rgba(239,68,68,0.25)"}}>Disconnect</button>
        </>}
        {scanning&&<>
          <div className="text-lg font-bold text-amber-400 mb-1">Scan QR Code</div>
          <div className="text-xs text-slate-400 mb-4">Open WhatsApp on your phone → tap <strong>Linked Devices</strong> → <strong>Link a Device</strong></div>
          <div className="flex justify-center mb-3">
            {qr
              ?<img src={qr} alt="WhatsApp QR" className="w-52 h-52 rounded-xl bg-white p-2"/>
              :<div className="w-52 h-52 rounded-xl flex items-center justify-center" style={{background:"rgba(255,255,255,0.05)"}}><RefreshCw size={28} className="text-slate-500 animate-spin"/></div>
            }
          </div>
          <button onClick={fetchQr} className="text-xs text-violet-400 flex items-center gap-1 mx-auto"><RefreshCw size={10}/>Refresh QR</button>
        </>}
        {starting2&&<>
          <div className="text-lg font-bold text-amber-400 mb-1">Starting…</div>
          <div className="text-xs text-slate-400">WhatsApp is initialising, QR code will appear shortly</div>
        </>}
        {!connected&&!scanning&&!starting2&&<>
          <div className="text-lg font-bold text-white mb-1">Connect WhatsApp</div>
          <div className="text-xs text-slate-400 mb-5">Link your WhatsApp number to start sending loyalty messages, campaigns, and automations</div>
          {errMsg&&<div className="mb-3 text-xs text-red-400 p-2 rounded-lg" style={{background:"rgba(239,68,68,0.1)"}}>{errMsg}</div>}
          <button onClick={connect} disabled={starting} className="flex items-center gap-2 mx-auto px-6 py-3 rounded-xl text-sm font-semibold text-white disabled:opacity-60" style={{background:"linear-gradient(135deg,#25D366,#128C7E)"}}>
            {starting?<RefreshCw size={16} className="animate-spin"/>:<WAIcon size={16}/>}
            {starting?"Connecting…":"Connect WhatsApp"}
          </button>
        </>}
      </div>

      {/* Advanced config — collapsed by default */}
      <div>
        <button onClick={()=>setShowAdvanced(v=>!v)} className="text-xs text-slate-500 hover:text-slate-300 flex items-center gap-1">
          <RefreshCw size={10}/>{showAdvanced?"Hide":"Show"} advanced settings
        </button>
        {showAdvanced&&<div className="mt-3 space-y-3 p-4 rounded-xl" style={{background:"rgba(255,255,255,0.02)",border:"1px solid rgba(255,255,255,0.06)"}}>
          <div className="text-xs text-slate-400 mb-2">Override WAHA server defaults (leave blank to use server config)</div>
          {[{l:"WAHA Base URL",k:"wahaBaseUrl",ph:"http://localhost:3001"},{l:"Session Name",k:"wahaSessionId",ph:"default"},{l:"API Key",k:"wahaApiKey",ph:"••••••",type:"password"}].map(f=>(
            <div key={f.k}>
              <label className="text-xs text-slate-400 mb-1 block">{f.l}</label>
              <input value={(cfg as any)[f.k]||""} type={f.type||"text"} onChange={e=>setCfg(p=>({...p,[f.k]:e.target.value}))} placeholder={f.ph} className="w-full px-3 py-2 rounded-lg text-xs text-white outline-none font-mono" style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.08)"}}/>
            </div>
          ))}
          <button onClick={saveAdvanced} disabled={saving} className="px-3 py-1.5 rounded-lg text-xs font-medium text-white disabled:opacity-50" style={{background:"rgba(139,92,246,0.3)"}}>{saving?"Saving…":"Save"}</button>
        </div>}
      </div>
    </div>
  );
};

const INDUSTRY_OPTIONS=["Café & Restaurant","Coffee Shop","Bar","Hair Salon","Beauty Salon","Barbershop","Nail Studio","Spa","Gym","Fitness Studio","CrossFit","Yoga Studio","Sports Club","Retail","Boutique","Pharmacy","Supermarket","Other"];
const SettingsPage=({wa,onConnect})=>{
  const [tab,setTab]=useState("business");
  const [industry,setIndustry]=useState(()=>localStorage.getItem("biz_industry")||"Café & Restaurant");
  const [bizNameVal,setBizNameVal]=useState(()=>localStorage.getItem("biz_name")||"");
  const saveIndustry=(v:string)=>{setIndustry(v);localStorage.setItem("biz_industry",v);localStorage.removeItem("pos_biztype_override");api.settings.update({industry:v}).catch(()=>{});};
  const tabs=[{id:"business",label:"Business",icon:Building},{id:"whatsapp",label:"WhatsApp API",icon:MessageSquare},{id:"rbac",label:"Team & Roles",icon:Users},{id:"stripe",label:"Billing",icon:CreditCard},{id:"security",label:"Security",icon:Shield},{id:"gdpr",label:"GDPR",icon:Globe}];
  return(
    <div className="space-y-4">
      <div><h1 className="text-xl font-bold text-white">Settings</h1><p className="text-xs text-slate-400 mt-0.5">Tenant configuration · All changes scoped to businessId</p></div>
      <div className="flex gap-1 overflow-x-auto pb-1">{tabs.map(t=><button key={t.id} onClick={()=>setTab(t.id)} className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs whitespace-nowrap ${tab===t.id?"text-white":"text-slate-400"}`} style={tab===t.id?{background:"rgba(139,92,246,0.2)"}:{}}><t.icon size={12}/>{t.label}{t.id==="whatsapp"&&<span className={`w-1.5 h-1.5 rounded-full ${wa?"bg-green-400":"bg-red-400"}`}/>}</button>)}</div>
      <div className="gc rounded-xl p-5" style={CARD}>
        {tab==="business"&&<div className="space-y-4">
          <div className="flex items-center gap-4 mb-2">
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{background:"linear-gradient(135deg,#8b5cf6,#06b6d4)"}}><span className="text-white font-bold text-xl">TC</span></div>
            <div><button className="text-xs text-violet-400 hover:text-violet-300">Change Logo</button><div className="text-xs text-slate-500 mt-1">businessId: biz_the_coffee_house</div></div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div><label className="text-xs text-slate-400 mb-1 block">Business Name</label><input value={bizNameVal} onChange={e=>{setBizNameVal(e.target.value);localStorage.setItem("biz_name",e.target.value);}} onBlur={e=>api.settings.update({name:e.target.value}).catch(()=>{})} className="w-full px-3 py-2 rounded-lg text-xs text-white outline-none" style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.08)"}}/></div>
            {[{l:"Country (ISO 3166-1)",v:"GB"},{l:"Currency (ISO 4217)",v:"GBP"},{l:"Timezone (IANA)",v:"Europe/London"},{l:"Custom Domain (white-label)",v:"loyalty.coffeehouse.com"},{l:"Loyal Days Window",v:"7"},{l:"Irregular Gap Days",v:"14"},{l:"Lost Days Threshold",v:"60"},{l:"Message Cooldown (hours)",v:"72"}].map((f,i)=><div key={i}><label className="text-xs text-slate-400 mb-1 block">{f.l}</label><input defaultValue={f.v} className="w-full px-3 py-2 rounded-lg text-xs text-white outline-none" style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.08)"}}/></div>)}
            <div>
              <label className="text-xs text-slate-400 mb-1 block">Industry / Business Type</label>
              <select value={industry} onChange={e=>saveIndustry(e.target.value)} className="w-full px-3 py-2 rounded-lg text-xs text-white outline-none" style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.08)"}}>
                {INDUSTRY_OPTIONS.map(o=><option key={o} value={o} style={{background:"#1a1030"}}>{o}</option>)}
              </select>
              <div className="text-[10px] text-slate-500 mt-1">
                POS type: <span className="text-violet-400 font-semibold">{getPosBizType()||"Not detected"}</span> · Changes POS layout automatically
              </div>
            </div>
          </div>
          <button className="px-4 py-2 rounded-lg text-xs font-medium text-white" style={{background:"linear-gradient(135deg,#8b5cf6,#7c3aed)"}}>Save Changes</button>
        </div>}
        {tab==="whatsapp"&&<WhatsAppSettingsTab/>}
        {tab==="rbac"&&<div className="space-y-4">
          <div className="text-xs text-slate-400 mb-2">6-tier RBAC from Prisma Role enum · tenantScope.ts middleware enforces branch isolation</div>
          {[{name:"Alex Thompson",role:"TENANT_OWNER",email:"alex@coffeehouse.com",branch:"All branches"},{name:"Maria Garcia",role:"BRANCH_MANAGER",email:"maria@coffeehouse.com",branch:"Soho Branch"},{name:"Tom Wilson",role:"CASHIER",email:"tom@coffeehouse.com",branch:"Soho Branch"},{name:"Lisa Park",role:"MARKETING_STAFF",email:"lisa@coffeehouse.com",branch:"All branches"}].map((m,i)=>(
            <div key={i} className="flex items-center justify-between py-2.5 px-3 rounded-lg" style={{background:"rgba(255,255,255,0.02)"}}>
              <div className="flex items-center gap-3"><div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium text-white" style={{background:ROLE_COLORS[m.role]+"30",color:ROLE_COLORS[m.role]}}>{m.name.split(" ").map(n=>n[0]).join("")}</div><div><div className="text-xs text-white font-medium">{m.name}</div><div className="text-xs text-slate-500">{m.email} · {m.branch}</div></div></div>
              <Badge color={ROLE_COLORS[m.role]}>{m.role.replace("_"," ")}</Badge>
            </div>
          ))}
          <button className="flex items-center gap-1 text-xs text-violet-400 hover:text-violet-300 mt-1"><Plus size={12}/>Invite staff member</button>
        </div>}
        {tab==="stripe"&&<div className="space-y-4">
          <div className="p-4 rounded-xl" style={{background:"linear-gradient(135deg,rgba(139,92,246,0.15),rgba(6,182,212,0.1))",border:"1px solid rgba(139,92,246,0.25)"}}><Badge color={C.amber}>PROFESSIONAL</Badge><div className="text-2xl font-bold text-white mt-2">£149<span className="text-xs text-slate-400 font-normal">/month</span></div><div className="text-xs text-slate-400 mt-1">Renews Jul 15 · Stripe subscription: sub_1Nx...</div></div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">{[{t:"FREE",p:"£0",q:"500 msgs"},{t:"STARTER",p:"£29",q:"2,500 msgs"},{t:"GROWTH",p:"£79",q:"10,000 msgs"},{t:"PROFESSIONAL",p:"£149",q:"50,000 msgs"},{t:"ENTERPRISE",p:"Custom",q:"Unlimited"}].map((p,i)=><div key={i} className={`p-2.5 rounded-xl text-xs ${p.t==="PROFESSIONAL"?"ring-1 ring-violet-400":""}`} style={{background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.06)"}}><div className="font-bold text-white">{p.t}</div><div style={{color:TIER_COLORS[p.t]||"#6b7280"}}>{p.p}/mo</div><div className="text-slate-500">{p.q}</div></div>)}</div>
          <div className="text-xs text-slate-400">Redis quota key: <span className="font-mono text-violet-300">tenant:msg_quota:biz_1</span> · BullMQ worker decrements on each send · Stripe webhook updates on invoice.paid</div>
        </div>}
        {tab==="security"&&<div className="space-y-2">{[{l:"Argon2id Password Hashing",d:"64MB memory · 3 iterations · parallelism 4",on:true},{l:"JWT Access Tokens (15min)",d:"HS256 · HTTP-only refresh cookie (7d)",on:true},{l:"Refresh Token Rotation",d:"Theft detection → clears hash on mismatch",on:true},{l:"Redis Token Revocation",d:"Blacklist on logout/password change",on:true},{l:"Two-Factor Authentication (TOTP)",d:"6-digit TOTP with backup codes",on:false},{l:"Rate Limiting (Redis-backed)",d:"10 logins/15min · 5 registrations/hr",on:true},{l:"Cloudflare WAF + DDoS",d:"Edge protection · geo-blocking",on:true},{l:"Row-Level Security (businessId)",d:"tenantScope.ts middleware on every route",on:true}].map((s,i)=><div key={i} className="flex items-center justify-between py-3 border-b border-white/5"><div><div className="text-xs font-medium text-white">{s.l}</div><div className="text-xs text-slate-500">{s.d}</div></div><div className={`w-10 h-5 rounded-full relative flex-shrink-0 ${s.on?"bg-violet-500":"bg-white/10"}`}><div className="w-4 h-4 rounded-full bg-white absolute top-0.5 transition-all" style={{left:s.on?22:2}}/></div></div>)}</div>}
        {tab==="gdpr"&&<div className="space-y-4"><div className="text-xs text-slate-400 mb-3">UK GDPR + EU GDPR · PECR compliant · Granular consent per channel</div><div className="space-y-2">{[{l:"WhatsApp Marketing Consent",d:"marketingConsentWhatsapp · STOP keyword flips to false"},{l:"Email Marketing Consent",d:"marketingConsentEmail · separate flag per Customer"},{l:"SMS Marketing Consent",d:"marketingConsentSms · independent"},{l:"Push Notification Consent",d:"marketingConsentPush · for React Native / Expo"}].map((c,i)=><div key={i} className="p-3 rounded-lg" style={{background:"rgba(255,255,255,0.02)"}}><div className="flex items-center justify-between"><div><div className="text-xs text-white font-medium">{c.l}</div><div className="text-xs text-slate-500 font-mono">{c.d}</div></div><Badge color={C.green}>Active</Badge></div></div>)}</div><div className="p-3 rounded-xl" style={{background:"rgba(239,68,68,0.08)",border:"1px solid rgba(239,68,68,0.15)"}}><div className="text-xs font-medium text-red-400 mb-1">Right to be Forgotten</div><div className="text-xs text-slate-400 mb-2">Hard-delete PII from Customer + Visit tables. Anonymized revenue rows preserved for analytics.</div><button className="px-3 py-1.5 rounded-lg text-xs text-red-300 font-medium" style={{border:"1px solid rgba(239,68,68,0.3)"}}>Initiate Data Purge Request</button></div><div className="p-3 rounded-xl" style={{background:"rgba(34,197,94,0.08)",border:"1px solid rgba(34,197,94,0.15)"}}><div className="text-xs font-medium text-green-400 mb-1">Opt-Out Interceptor</div><div className="text-xs text-slate-400">WAHA/Meta webhook · detects STOP/UNSUBSCRIBE/CANCEL · instantly sets isSuppressed=true · appends ConsentChangeLog · BullMQ worker checks before every dispatch</div></div></div>}
      </div>
    </div>
  );
};

// ════════════════════════════════════════════════════════════════
// CAMPAIGNS LIST
// ════════════════════════════════════════════════════════════════
const CampaignsPage=({onBuilder}:{onBuilder:()=>void})=>{
  const [campaigns,setCampaigns]=useState<any[]>([]);
  const [loading,setLoading]=useState(true);
  const [launching,setLaunching]=useState<string|null>(null);
  const [cloning,setCloning]=useState<string|null>(null);
  useEffect(()=>{
    api.campaigns.list().then(d=>setCampaigns(d.campaigns??[])).catch(()=>{}).finally(()=>setLoading(false));
  },[]);
  const launch=async(id:string)=>{
    setLaunching(id);
    try{await api.campaigns.launch(id);setCampaigns(p=>p.map(c=>c.id===id?{...c,status:"ACTIVE"}:c));}
    catch(e){}finally{setLaunching(null);}
  };
  const clone=async(id:string)=>{
    setCloning(id);
    try{const d=await api.campaigns.clone(id);setCampaigns(p=>[d.campaign,...p]);}
    catch(e){}finally{setCloning(null);}
  };
  const totalSent=campaigns.reduce((a:number,c:any)=>a+(c.stats?.sent??0),0);
  const totalDel=campaigns.reduce((a:number,c:any)=>a+(c.stats?.delivered??0),0);
  const totalRead=campaigns.reduce((a:number,c:any)=>a+(c.stats?.read??0),0);
  const statusColor=(s:string)=>s==="ACTIVE"||s==="LAUNCHED"?C.green:s==="SCHEDULED"?C.amber:s==="DRAFT"?"#64748b":s==="COMPLETED"?"#8b5cf6":"#64748b";
  return(
    <div className="space-y-4">
      <div className="flex items-center justify-between"><div><h1 className="text-xl font-bold text-white">Campaigns</h1><p className="text-xs text-slate-400 mt-0.5">WhatsApp campaign builder · BullMQ dispatch · AI-assisted copywriting</p></div><button onClick={onBuilder} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium text-white" style={{background:"linear-gradient(135deg,#8b5cf6,#7c3aed)"}}><Plus size={14}/>Campaign Builder</button></div>

      {/* WhatsApp Ads — Coming Soon */}
      <div className="relative overflow-hidden rounded-2xl p-5" style={{background:"linear-gradient(135deg,#0d1f12 0%,#0a2e1a 50%,#0f2416 100%)",border:"1px solid rgba(37,211,102,0.25)"}}>
        {/* Glow blob */}
        <div className="absolute -top-8 -right-8 w-40 h-40 rounded-full opacity-20 pointer-events-none" style={{background:"radial-gradient(circle,#25d366,transparent 70%)"}}/>
        <div className="relative flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0" style={{background:"linear-gradient(135deg,#25d366,#128c7e)"}}>
              <svg viewBox="0 0 24 24" className="w-6 h-6 fill-white"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.127.558 4.122 1.532 5.848L0 24l6.335-1.652A11.952 11.952 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.818a9.818 9.818 0 01-5.007-1.371l-.36-.213-3.732.973.999-3.636-.234-.374A9.818 9.818 0 1112 21.818z"/></svg>
            </div>
            <div>
              <div className="flex items-center gap-2 mb-0.5">
                <p className="text-white font-bold text-base">WhatsApp Ads</p>
                <span className="px-2 py-0.5 rounded-full text-xs font-bold tracking-wide" style={{background:"rgba(37,211,102,0.2)",border:"1px solid rgba(37,211,102,0.4)",color:"#4ade80"}}>Coming Soon</span>
              </div>
              <p className="text-sm" style={{color:"rgba(255,255,255,0.55)"}}>Send targeted promotional messages to reach new and existing customers directly on WhatsApp — straight from Loyable, no third-party tools needed.</p>
            </div>
          </div>
        </div>
        <div className="relative mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[
            {icon:"🎯",title:"Audience Targeting",desc:"Target by segment, spend, location or custom rules"},
            {icon:"📊",title:"Real-time Analytics",desc:"Track delivery, read rates and revenue attributed"},
            {icon:"🤖",title:"AI Copywriter",desc:"Generate high-converting ad copy with one click"},
          ].map((f,i)=>(
            <div key={i} className="flex items-start gap-3 rounded-xl p-3" style={{background:"rgba(37,211,102,0.06)",border:"1px solid rgba(37,211,102,0.12)"}}>
              <span className="text-xl leading-none mt-0.5">{f.icon}</span>
              <div>
                <p className="text-white text-xs font-semibold">{f.title}</p>
                <p className="text-xs mt-0.5" style={{color:"rgba(255,255,255,0.4)"}}>{f.desc}</p>
              </div>
            </div>
          ))}
        </div>
        <div className="relative mt-4 flex items-center gap-3">
          <input type="email" placeholder="Enter your email to get early access"
            className="flex-1 px-3 py-2 rounded-xl text-sm placeholder-slate-500 outline-none"
            style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)",color:"white"}}/>
          <button className="px-4 py-2 rounded-xl text-sm font-semibold text-white flex-shrink-0 transition-all hover:opacity-90"
            style={{background:"linear-gradient(135deg,#25d366,#128c7e)"}}>
            Notify Me
          </button>
        </div>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {loading?[...Array(4)].map((_,i)=><Skeleton key={i} h="h-24"/>):<>
          <KPI icon={Send} label="Total Sent" value={totalSent.toLocaleString()} color={C.blue}/>
          <KPI icon={CheckCheck} label="Delivered" value={totalDel.toLocaleString()} color={C.green}/>
          <KPI icon={Eye} label="Read" value={totalRead.toLocaleString()} color={C.accent}/>
          <KPI icon={Target} label="Campaigns" value={campaigns.length} color={C.primary}/>
        </>}
      </div>
      {loading?<div className="space-y-3">{[...Array(3)].map((_,i)=><Skeleton key={i} h="h-24"/>)}</div>:campaigns.length===0?
        <div className="gc rounded-xl p-8 text-center" style={CARD}><Target size={32} className="text-slate-600 mx-auto mb-3"/><p className="text-slate-400 text-sm">No campaigns yet</p><button onClick={onBuilder} className="mt-3 px-4 py-2 rounded-lg text-xs font-medium text-white" style={{background:"linear-gradient(135deg,#8b5cf6,#7c3aed)"}}>Create First Campaign</button></div>:
      <div className="space-y-3">{campaigns.map((c:any)=>(
        <div key={c.id} className="gc rounded-xl p-4" style={CARD}>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{background:statusColor(c.status)+"20"}}>
                {c.status==="ACTIVE"||c.status==="LAUNCHED"?<Play size={15} className="text-green-400"/>:c.status==="SCHEDULED"?<Clock size={15} className="text-amber-400"/>:c.status==="COMPLETED"?<Check size={15} className="text-violet-400"/>:<Edit size={15} className="text-slate-400"/>}
              </div>
              <div><div className="text-sm font-medium text-white">{c.name}</div><div className="text-xs text-slate-400 flex items-center gap-1.5">{c.targetSegment&&<Badge color={SEG_COLORS[c.targetSegment as keyof typeof SEG_COLORS]||"#8b5cf6"}>{c.targetSegment}</Badge>}<span>·</span><span className="font-mono">{new Date(c.createdAt||Date.now()).toLocaleDateString()}</span></div></div>
            </div>
            <div className="flex items-center gap-2">
              <Badge color={statusColor(c.status)}>{c.status}</Badge>
              <button onClick={()=>clone(c.id)} disabled={cloning===c.id} title="Clone campaign" className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium disabled:opacity-50" style={{background:"rgba(255,255,255,0.07)",color:"#94a3b8"}}>{cloning===c.id?<RefreshCw size={11} className="animate-spin"/>:<Copy size={11}/>}Clone</button>
              {(c.status==="DRAFT"||c.status==="APPROVED")&&<button onClick={()=>launch(c.id)} disabled={launching===c.id} className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium text-white disabled:opacity-50" style={{background:"linear-gradient(135deg,#22c55e,#16a34a)"}}>{launching===c.id?<RefreshCw size={11} className="animate-spin"/>:<Play size={11}/>}Launch</button>}
            </div>
          </div>
          {(c.stats?.sent>0||c.stats?.delivered>0)&&<div className="grid grid-cols-4 gap-2 mt-3 pt-3 border-t border-white/5">{[{l:"Sent",v:c.stats?.sent??0,col:"#3b82f6"},{l:"Delivered",v:c.stats?.delivered??0,col:"#22c55e"},{l:"Read",v:c.stats?.read??0,col:"#06b6d4"},{l:"Failed",v:c.stats?.failed??0,col:"#ef4444"}].map((s,i)=><div key={i} className="text-center"><div className="text-sm font-bold" style={{color:s.col}}>{s.v}</div><div className="text-xs text-slate-500">{s.l}</div></div>)}</div>}
        </div>
      ))}</div>}
    </div>
  );
};

// ════════════════════════════════════════════════════════════════
// AUTOMATIONS LIST
// ════════════════════════════════════════════════════════════════
const AutomationsPage=({onBuilder}:{onBuilder:()=>void})=>{
  const [autos,setAutos]=useState<any[]>([]);
  const [loading,setLoading]=useState(true);
  const [toggling,setToggling]=useState<string|null>(null);
  useEffect(()=>{
    api.automations.list().then(d=>setAutos(d.workflows??[])).catch(()=>{}).finally(()=>setLoading(false));
  },[]);
  const toggle=async(id:string,isActive:boolean)=>{
    setToggling(id);
    try{
      if(isActive) await api.automations.deactivate(id);
      else await api.automations.activate(id);
      setAutos(p=>p.map(a=>a.id===id?{...a,isActive:!a.isActive}:a));
    }catch(e){}finally{setToggling(null);}
  };
  const getTriggerLabel=(t:any)=>{
    if(!t)return"—";
    if(typeof t==="string")return t;
    return t.type||t.trigger||JSON.stringify(t).slice(0,30);
  };
  const getActionLabel=(c:any)=>{
    if(!c)return"—";
    if(Array.isArray(c))return c.map((a:any)=>a.type||a).join(" + ").slice(0,40);
    if(typeof c==="string")return c.slice(0,40);
    return"Custom flow";
  };
  return(
    <div className="space-y-4">
      <div className="flex items-center justify-between"><div><h1 className="text-xl font-bold text-white">Automations</h1><p className="text-xs text-slate-400 mt-0.5">Visual flow builder → compiledJson → BullMQ jobs · Zero-code IF/THEN</p></div><button onClick={onBuilder} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium text-white" style={{background:"linear-gradient(135deg,#8b5cf6,#7c3aed)"}}><Plus size={14}/>Build Automation</button></div>
      {loading?<div className="space-y-3">{[...Array(3)].map((_,i)=><Skeleton key={i} h="h-24"/>)}</div>:autos.length===0?
        <div className="gc rounded-xl p-8 text-center" style={CARD}><Zap size={32} className="text-slate-600 mx-auto mb-3"/><p className="text-slate-400 text-sm">No automations yet</p><button onClick={onBuilder} className="mt-3 px-4 py-2 rounded-lg text-xs font-medium text-white" style={{background:"linear-gradient(135deg,#8b5cf6,#7c3aed)"}}>Build First Automation</button></div>:
      <div className="space-y-3">{autos.map((a:any)=>{
        const on=a.isActive??a.on??false;
        const compiledActions=(a.compiledJson?.actions||a.compiledJson||[]);
        const triggerType=a.trigger?.type||a.trigger||(typeof a.compiledJson?.trigger==="object"?a.compiledJson?.trigger?.type:a.compiledJson?.trigger)||"—";
        return(
        <div key={a.id} className={`gc rounded-xl p-4 transition-all ${on?"":"opacity-60"}`} style={{...CARD,border:`1px solid ${on?"rgba(139,92,246,0.3)":"rgba(255,255,255,0.07)"}`}}>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{background:on?"rgba(139,92,246,0.15)":"rgba(255,255,255,0.05)"}}><Zap size={16} className={on?"text-violet-400":"text-slate-500"}/></div>
              <div className="min-w-0"><div className="text-sm font-medium text-white truncate">{a.name}</div><div className="text-xs text-slate-400 mt-0.5 truncate"><span className="text-cyan-400">IF</span> {getTriggerLabel(triggerType)} <span className="text-amber-400">→ THEN</span> {getActionLabel(compiledActions)}</div></div>
            </div>
            <button onClick={()=>toggle(a.id,on)} disabled={toggling===a.id} className={`w-10 h-5 rounded-full relative flex-shrink-0 transition-colors ${on?"bg-violet-500":"bg-white/10"} disabled:opacity-50`}>
              {toggling===a.id?<RefreshCw size={10} className="absolute inset-0 m-auto text-white animate-spin"/>:<div className="w-4 h-4 rounded-full bg-white absolute top-0.5 transition-all" style={{left:on?22:2}}/>}
            </button>
          </div>
          {(a.executionCount>0||a.conversions>0)&&<div className="flex gap-4 mt-3 pt-3 border-t border-white/5"><div className="text-xs text-slate-400">Ran: <span className="text-white font-medium">{a.executionCount??0}</span></div><div className="text-xs text-slate-400">Converted: <span className="text-green-400 font-medium">{a.conversions??0}</span></div>{a.executionCount>0&&<div className="text-xs text-slate-400">Rate: <span className="text-cyan-400 font-medium">{Math.round(((a.conversions??0)/(a.executionCount||1))*100)}%</span></div>}</div>}
        </div>
      )})}</div>}
    </div>
  );
};

// ════════════════════════════════════════════════════════════════
// POS PAGE
// ════════════════════════════════════════════════════════════════
// ── Shared POS sub-components ─────────────────────────────────────
const inpS={background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.12)",color:"#fff"};

// Active orders store (shared across POS components via simple module-level state)
type ActiveOrder={id:string;table?:string;type:string;items:{name:string;qty:number;price:number;ready?:boolean}[];discount:number;phone:string;cname:string;payMode:"CASH"|"CARD"|"WALLET";status:"UNPAID"|"PAID";createdAt:number;notes?:string;staff?:string;};
const _orders:{list:ActiveOrder[];listeners:Set<()=>void>}={list:JSON.parse(localStorage.getItem("pos_orders")||"[]"),listeners:new Set()};
const saveOrders=()=>{localStorage.setItem("pos_orders",JSON.stringify(_orders.list));_orders.listeners.forEach(fn=>fn());};
const addOrder=(o:Omit<ActiveOrder,"id"|"createdAt">)=>{_orders.list.unshift({...o,id:Math.random().toString(36).slice(2),createdAt:Date.now()});saveOrders();};
const updateOrder=(id:string,patch:Partial<ActiveOrder>)=>{_orders.list=_orders.list.map(o=>o.id===id?{...o,...patch}:o);saveOrders();};
const removeOrder=(id:string)=>{_orders.list=_orders.list.filter(o=>o.id!==id);saveOrders();};
const useOrders=()=>{const[,r]=useState(0);useEffect(()=>{const fn=()=>r(x=>x+1);_orders.listeners.add(fn);return()=>{_orders.listeners.delete(fn);};},[]);return _orders.list;};

// Menu store (owner-editable, persisted)
type MenuItem={id:string;cat:string;name:string;price:number;stock?:number;color?:string;desc?:string;prepTime?:number;barcode?:string;image?:string;};
const DEFAULT_MENUS:Record<string,MenuItem[]>={
  restaurant:[
    {id:"r1",cat:"Starters",name:"Soup of the Day",price:3.5,stock:20,color:"#f59e0b"},{id:"r2",cat:"Starters",name:"Garlic Bread",price:2.5,stock:30,color:"#f59e0b"},
    {id:"r3",cat:"Mains",name:"Grilled Chicken",price:12.5,stock:15,color:"#8b5cf6"},{id:"r4",cat:"Mains",name:"Beef Burger",price:9.5,stock:20,color:"#8b5cf6"},{id:"r5",cat:"Mains",name:"Margherita Pizza",price:10.0,stock:10,color:"#8b5cf6"},{id:"r6",cat:"Mains",name:"Pasta Carbonara",price:9.0,stock:18,color:"#8b5cf6"},
    {id:"r7",cat:"Drinks",name:"Americano",price:2.8,stock:50,color:"#06b6d4"},{id:"r8",cat:"Drinks",name:"Latte",price:3.5,stock:50,color:"#06b6d4"},{id:"r9",cat:"Drinks",name:"Fresh OJ",price:3.0,stock:25,color:"#06b6d4"},
    {id:"r10",cat:"Desserts",name:"Chocolate Brownie",price:4.5,stock:12,color:"#ec4899"},{id:"r11",cat:"Desserts",name:"Cheesecake",price:4.0,stock:8,color:"#ec4899"},
  ],
  salon:[
    {id:"s1",cat:"Hair",name:"Haircut – Ladies",price:35,color:"#ec4899"},{id:"s2",cat:"Hair",name:"Haircut – Gents",price:20,color:"#ec4899"},{id:"s3",cat:"Hair",name:"Hair Colour",price:65,color:"#ec4899"},{id:"s4",cat:"Hair",name:"Highlights",price:80,color:"#ec4899"},
    {id:"s5",cat:"Nails",name:"Manicure",price:25,color:"#8b5cf6"},{id:"s6",cat:"Nails",name:"Pedicure",price:30,color:"#8b5cf6"},{id:"s7",cat:"Nails",name:"Gel Nails",price:45,color:"#8b5cf6"},
    {id:"s8",cat:"Skin",name:"Facial",price:50,color:"#06b6d4"},{id:"s9",cat:"Skin",name:"Threading",price:8,color:"#06b6d4"},{id:"s10",cat:"Skin",name:"Eyebrow Shape",price:12,color:"#06b6d4"},
    {id:"s11",cat:"Packages",name:"Bridal Package",price:250,color:"#f59e0b"},{id:"s12",cat:"Packages",name:"Pamper Day",price:120,color:"#f59e0b"},
  ],
  gym:[
    {id:"g1",cat:"Memberships",name:"Monthly – Basic",price:30,desc:"Gym access only",color:"#3b82f6"},{id:"g2",cat:"Memberships",name:"Monthly – Premium",price:50,desc:"Gym + classes",color:"#8b5cf6"},
    {id:"g3",cat:"Memberships",name:"Quarterly",price:85,desc:"3 month all-access",color:"#06b6d4"},{id:"g4",cat:"Memberships",name:"Annual",price:299,desc:"Best value",color:"#f59e0b"},
    {id:"g5",cat:"Add-ons",name:"Day Pass",price:8,desc:"Single visit",color:"#22c55e"},{id:"g6",cat:"Add-ons",name:"PT Session (1hr)",price:45,desc:"Personal training",color:"#ec4899"},
    {id:"g7",cat:"Add-ons",name:"Class Pack (10)",price:70,desc:"10 group classes",color:"#f97316"},{id:"g8",cat:"Add-ons",name:"Locker Rental",price:5,desc:"Monthly locker",color:"#6b7280"},
  ],
  retail:[],
};
const getMenu=(bizType:string):MenuItem[]=>{const stored=localStorage.getItem(`pos_menu_${bizType}`);return stored?JSON.parse(stored):DEFAULT_MENUS[bizType]??[];};
const saveMenu=(bizType:string,items:MenuItem[])=>{localStorage.setItem(`pos_menu_${bizType}`,JSON.stringify(items));};
const deductStock=(bizType:string,itemName:string,qty:number)=>{const m=getMenu(bizType);const updated=m.map(i=>i.name===itemName&&i.stock!=null?{...i,stock:Math.max(0,i.stock-qty)}:i);saveMenu(bizType,updated);};

// ── Bill helpers ──────────────────────────────────────────────────
const calcOrderTotal=(order:ActiveOrder)=>{const sub=order.items.reduce((s,i)=>s+i.qty*i.price,0)-order.discount;return Math.max(0,sub);};
const BIZ_THANK_YOU:Record<string,string>={
  restaurant:"Thank you for dining with us! We hope to see you again soon. 💜",
  salon:"Thank you for choosing us! We hope to see you again soon. 💜",
  gym:"Great session! See you next time. 💜",
  retail:"Thank you for shopping with us! We hope to see you again soon. 💜",
};
const buildBillText=(order:ActiveOrder,currency:string,bizType?:string)=>{
  const bizName=localStorage.getItem("biz_name")||"Our Store";
  const total=calcOrderTotal(order);
  const DIVIDER="━━━━━━━━━━━━━━";
  // Build right-aligned dotted lines
  const COL=34; // total line width for dots
  const lines=order.items.map(i=>{
    const left=`• ${i.name} ×${i.qty}`;
    const amt=`${currency} ${(i.qty*i.price).toFixed(0)}`;
    const dots=".".repeat(Math.max(1,COL-left.length-amt.length));
    return `${left} ${dots} ${amt}`;
  }).join("\n");
  const thankYou=BIZ_THANK_YOU[bizType||getPosBizType()]||BIZ_THANK_YOU.retail;
  const header=[
    `✨ *${bizName}* ✨`,
    `📋 Receipt`,
    ...(order.cname?[`\nCustomer: ${order.cname}`]:[]),
  ].join("\n");
  const discountLine=order.discount>0?`\nDiscount: -${currency} ${order.discount.toFixed(0)}`:"";
  return `${header}\n\n${DIVIDER}\n${lines}\n${DIVIDER}${discountLine}\n*TOTAL: ${currency} ${total.toFixed(0)}*\n\n${thankYou}\n\n_message powered by loyable.site_`;
};
const printBill=(order:ActiveOrder,currency:string)=>{
  const total=calcOrderTotal(order);
  const bizName=localStorage.getItem("biz_name")||"Receipt";
  const w=window.open("","_blank","width=400,height=600");if(!w)return;
  w.document.write(`<html><head><title>Receipt – ${bizName}</title><style>body{font-family:monospace;padding:20px;max-width:300px;margin:0 auto}h2{text-align:center;font-size:16px}hr{border:1px dashed #ccc}.row{display:flex;justify-content:space-between;margin:4px 0}.total{font-weight:bold;font-size:16px;border-top:2px solid #000;padding-top:8px;margin-top:8px}.footer{text-align:center;margin-top:16px;font-size:11px;color:#666}@media print{button{display:none}}</style></head><body>
  <h2>✨ ${bizName} ✨</h2><hr/>${order.table?`<p style="text-align:center">Table: ${order.table}</p>`:""}${order.cname?`<p style="text-align:center">Customer: ${order.cname}</p>`:""}
  <hr/>${order.items.map(i=>`<div class="row"><span>${i.name} ×${i.qty}</span><span>${currency} ${(i.qty*i.price).toFixed(0)}</span></div>`).join("")}
  ${order.discount>0?`<div class="row"><span>Discount</span><span>-${currency} ${order.discount.toFixed(0)}</span></div>`:""}
  <div class="row total"><span>TOTAL</span><span>${currency} ${total.toFixed(0)}</span></div><hr/>
  <p class="footer">Thank you for choosing us!<br/>message powered by loyable.site</p>
  <br/><button onclick="window.print()">🖨 Print</button></body></html>`);
  w.document.close();setTimeout(()=>w.print(),400);
};

// ── Menu Editor Modal ─────────────────────────────────────────────
const MenuEditor=({bizType,onClose}:{bizType:string;onClose:()=>void})=>{
  const [items,setItems]=useState<MenuItem[]>(()=>getMenu(bizType));
  const [editing,setEditing]=useState<MenuItem|null>(null);
  const [form,setForm]=useState({name:"",cat:"",price:"",stock:"",desc:"",prepTime:"",barcode:"",image:""});
  const imgRef=useRef<HTMLInputElement>(null);
  const cats=[...new Set(items.map(i=>i.cat))];
  const save=()=>{saveMenu(bizType,items);onClose();};
  const startEdit=(item:MenuItem)=>{setEditing(item);setForm({name:item.name,cat:item.cat,price:String(item.price),stock:String(item.stock??""),desc:item.desc??"",prepTime:String(item.prepTime??""),barcode:item.barcode??"",image:item.image??""});};
  const startNew=()=>{setEditing({id:"",cat:cats[0]||"General",name:"",price:0} as any);setForm({name:"",cat:cats[0]||"General",price:"",stock:"",desc:"",prepTime:"",barcode:"",image:""});};
  const applyEdit=()=>{
    if(!form.name||!form.price)return;
    const updated:MenuItem={id:editing?.id||Math.random().toString(36).slice(2),cat:form.cat||"General",name:form.name,price:Number(form.price),stock:form.stock?Number(form.stock):undefined,desc:form.desc||undefined,prepTime:form.prepTime?Number(form.prepTime):undefined,barcode:form.barcode||undefined,image:form.image||undefined};
    setItems(p=>editing?.id?p.map(i=>i.id===editing.id?updated:i):[...p,updated]);
    setEditing(null);
  };
  const pickImage=()=>imgRef.current?.click();
  const handleImage=(e:React.ChangeEvent<HTMLInputElement>)=>{
    const f=e.target.files?.[0];if(!f)return;
    if(f.size>500*1024){alert("Image must be under 500 KB");return;}
    const r=new FileReader();r.onload=ev=>setForm(p=>({...p,image:ev.target?.result as string}));r.readAsDataURL(f);
  };
  return(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{background:"rgba(0,0,0,0.8)",backdropFilter:"blur(8px)"}}>
      <div className="gc rounded-2xl w-full max-w-2xl max-h-[85vh] flex flex-col" style={CARD}>
        <div className="flex items-center justify-between p-5 border-b border-white/10">
          <div><div className="text-sm font-bold text-white">Menu Manager</div><div className="text-[10px] text-slate-400">Add, edit or remove items. Changes apply instantly.</div></div>
          <button onClick={onClose} className="text-slate-400 hover:text-white"><X size={18}/></button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-2">
          {cats.map(cat=>(
            <div key={cat}>
              <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-2 mt-3">{cat}</div>
              {items.filter(i=>i.cat===cat).map(item=>(
                <div key={item.id} className="flex items-center gap-3 p-3 rounded-xl" style={{background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.06)"}}>
                  {item.image
                    ?<img src={item.image} alt={item.name} className="w-9 h-9 rounded-lg object-cover flex-shrink-0"/>
                    :<div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{background:"rgba(139,92,246,0.12)"}}><ShoppingBag size={14} className="text-violet-400"/></div>
                  }
                  <div className="flex-1 min-w-0">
                    <div className="text-white text-xs font-semibold">{item.name}</div>
                    <div className="text-slate-400 text-[10px]">{item.desc||""} {item.stock!=null?`· Stock: ${item.stock}`:""}</div>
                  </div>
                  <span className="text-violet-400 text-xs font-bold">{item.price.toFixed(2)}</span>
                  <button onClick={()=>startEdit(item)} className="p-1.5 rounded-lg text-slate-400 hover:text-white transition-colors" style={{background:"rgba(255,255,255,0.05)"}}><Edit size={12}/></button>
                  <button onClick={()=>setItems(p=>p.filter(i=>i.id!==item.id))} className="p-1.5 rounded-lg text-red-400 hover:text-red-300 transition-colors" style={{background:"rgba(239,68,68,0.08)"}}><X size={12}/></button>
                </div>
              ))}
            </div>
          ))}
        </div>
        {editing&&(
          <div className="border-t border-white/10 p-5 space-y-3">
            <div className="text-xs font-semibold text-white mb-2">{editing.id?"Edit Item":"New Item"}</div>
            {/* Image upload */}
            <div className="flex items-center gap-3 mb-3">
              <input ref={imgRef} type="file" accept="image/*" className="hidden" onChange={handleImage}/>
              {form.image
                ?<img src={form.image} alt="preview" className="w-14 h-14 rounded-xl object-cover border border-white/10"/>
                :<div className="w-14 h-14 rounded-xl flex items-center justify-center" style={{background:"rgba(255,255,255,0.04)",border:"1px dashed rgba(255,255,255,0.15)"}}><Image size={18} className="text-slate-500"/></div>
              }
              <div>
                <button onClick={pickImage} className="block px-3 py-1.5 rounded-lg text-[11px] text-violet-400 font-semibold mb-1" style={{background:"rgba(139,92,246,0.1)",border:"1px solid rgba(139,92,246,0.2)"}}>📷 {form.image?"Change Photo":"Upload Photo"}</button>
                {form.image&&<button onClick={()=>setForm(p=>({...p,image:""}))} className="text-[10px] text-red-400 hover:text-red-300">Remove</button>}
                <div className="text-[10px] text-slate-500 mt-0.5">PNG/JPG · max 500 KB</div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="text-[10px] text-slate-400 block mb-1">Name *</label><input className="w-full px-3 py-2 rounded-xl text-xs text-white outline-none" style={inpS} value={form.name} onChange={e=>setForm(p=>({...p,name:e.target.value}))}/></div>
              <div><label className="text-[10px] text-slate-400 block mb-1">Category *</label><input className="w-full px-3 py-2 rounded-xl text-xs text-white outline-none" style={inpS} value={form.cat} onChange={e=>setForm(p=>({...p,cat:e.target.value}))}/></div>
              <div><label className="text-[10px] text-slate-400 block mb-1">Price *</label><input type="number" className="w-full px-3 py-2 rounded-xl text-xs text-white outline-none" style={inpS} value={form.price} onChange={e=>setForm(p=>({...p,price:e.target.value}))}/></div>
              <div><label className="text-[10px] text-slate-400 block mb-1">Stock (optional)</label><input type="number" className="w-full px-3 py-2 rounded-xl text-xs text-white outline-none" style={inpS} placeholder="Leave blank = unlimited" value={form.stock} onChange={e=>setForm(p=>({...p,stock:e.target.value}))}/></div>
              {bizType==="restaurant"&&<div><label className="text-[10px] text-slate-400 block mb-1">Prep Time (min)</label><input type="number" min={1} className="w-full px-3 py-2 rounded-xl text-xs text-white outline-none" style={inpS} placeholder="e.g. 15" value={form.prepTime} onChange={e=>setForm(p=>({...p,prepTime:e.target.value}))}/></div>}
              {bizType==="retail"&&<div><label className="text-[10px] text-slate-400 block mb-1">Barcode (optional)</label><input className="w-full px-3 py-2 rounded-xl text-xs text-white outline-none" style={inpS} placeholder="Scan or type barcode" value={form.barcode} onChange={e=>setForm(p=>({...p,barcode:e.target.value}))}/></div>}
              <div className="col-span-2"><label className="text-[10px] text-slate-400 block mb-1">Description</label><input className="w-full px-3 py-2 rounded-xl text-xs text-white outline-none" style={inpS} value={form.desc} onChange={e=>setForm(p=>({...p,desc:e.target.value}))}/></div>
            </div>
            <div className="flex gap-2">
              <button onClick={applyEdit} className="px-4 py-2 rounded-xl text-xs font-semibold text-white" style={{background:"linear-gradient(135deg,#8b5cf6,#7c3aed)"}}>Save Item</button>
              <button onClick={()=>setEditing(null)} className="px-4 py-2 rounded-xl text-xs text-slate-400" style={{background:"rgba(255,255,255,0.06)"}}>Cancel</button>
            </div>
          </div>
        )}
        <div className="flex items-center justify-between p-5 border-t border-white/10">
          <button onClick={startNew} className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs text-violet-400 font-semibold" style={{background:"rgba(139,92,246,0.1)",border:"1px solid rgba(139,92,246,0.2)"}}><Plus size={13}/>Add Item</button>
          <button onClick={save} className="px-5 py-2 rounded-xl text-xs font-semibold text-white" style={{background:"linear-gradient(135deg,#22c55e,#16a34a)"}}>Save & Close</button>
        </div>
      </div>
    </div>
  );
};

// ── Active Order Card (unpaid) ────────────────────────────────────
const ActiveOrderCard=({order,currency,bizType,onPaid,role=ROLES.OWNER}:{order:ActiveOrder;currency:string;bizType:string;onPaid:(o:ActiveOrder)=>void;role?:string})=>{
  const [paying,setPaying]=useState(false);const [err,setErr]=useState("");const [waSent,setWaSent]=useState<"none"|"sending"|"ok"|"fail">("none");
  const [editing,setEditing]=useState(false);
  const [editItems,setEditItems]=useState<{name:string;qty:number;price:number}[]>([]);
  const [now,setNow]=useState(Date.now());
  useEffect(()=>{const iv=setInterval(()=>setNow(Date.now()),10000);return()=>clearInterval(iv);},[]);

  const openEdit=()=>{setEditItems(order.items.map(i=>({...i})));setEditing(true);};
  const saveEdit=()=>{
    if(!editItems.filter(i=>i.qty>0).length)return;
    updateOrder(order.id,{items:editItems.filter(i=>i.qty>0).map(i=>({...i,ready:false}))});
    setEditing(false);
  };
  const editQty=(name:string,delta:number)=>{
    setEditItems(p=>p.map(i=>i.name===name?{...i,qty:Math.max(0,i.qty+delta)}:i).filter(i=>i.qty>0));
  };
  // Add a menu item to the edit list
  const editAdd=(menuItem:MenuItem)=>{
    setEditItems(p=>{const ex=p.find(i=>i.name===menuItem.name);
      return ex?p.map(i=>i.name===menuItem.name?{...i,qty:i.qty+1}:i):[...p,{name:menuItem.name,qty:1,price:menuItem.price}];});
  };
  const allMenuItems=getMenu(bizType);
  const total=calcOrderTotal(order);
  const elapsed=Math.floor((now-order.createdAt)/60000);
  // Prep time = max prepTime across items (restaurant only)
  const prepMins=bizType==="restaurant"?Math.max(0,...order.items.map(i=>allMenuItems.find(m=>m.name===i.name)?.prepTime??0)):0;
  const remaining=prepMins>0?Math.max(0,prepMins-elapsed):null;
  const isOverdue=remaining!==null&&remaining===0&&elapsed>=prepMins;

  // Normalise phone to international format (handles 0300… → +92300…)
  const normPhone=(p:string):string=>{
    const d=p.replace(/\D/g,"");
    if(!d)return"";
    if(d.startsWith("0")&&d.length===11)return"+92"+d.slice(1); // Pakistani local
    if(d.length>=10&&!p.startsWith("+"))return"+"+d;
    return p.trim();
  };

  const sendWA=async(o:ActiveOrder)=>{
    if(!o.phone)return;
    setWaSent("sending");
    const ph=normPhone(o.phone);
    const msg=buildBillText(o,currency,bizType);
    try{
      await api.messages.send({phone:ph,message:msg});
      setWaSent("ok");
    }catch(ex){
      console.error("[POS] WA receipt failed:",ex);
      setWaSent("fail");
    }
  };

  const markPaid=async()=>{
    setPaying(true);setErr("");
    try{
      await api.pos.createSale({customerPhone:order.phone?normPhone(order.phone):undefined,customerName:order.cname,items:order.items.map(i=>({name:i.name,qty:i.qty,unitPrice:i.price})),paymentMode:order.payMode,discount:order.discount,notes:order.notes||order.table?`${order.table||""}${order.notes?` | ${order.notes}`:""}`:""});
      // Deduct inventory
      order.items.forEach(i=>deductStock(bizType,i.name,i.qty));
      updateOrder(order.id,{status:"PAID"});
      onPaid({...order,status:"PAID"});
      // Send WhatsApp receipt
      await sendWA(order);
      setTimeout(()=>removeOrder(order.id),6000);
    }catch(ex){setErr((ex as Error).message);}
    setPaying(false);
  };

  return(
    <div className="gc rounded-2xl p-4 transition-all" style={{...CARD,border:order.status==="PAID"?"1px solid rgba(34,197,94,0.35)":"1px solid rgba(255,255,255,0.10)"}}>
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="flex items-center gap-2">
            {order.table&&<span className="px-2 py-0.5 rounded-lg text-[10px] font-bold text-cyan-400" style={{background:"rgba(6,182,212,0.12)"}}>{order.table}</span>}
            {order.cname&&<span className="text-xs text-white font-semibold">{order.cname}</span>}
            {!order.cname&&!order.table&&<span className="text-xs text-slate-400">Walk-in</span>}
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-[10px] text-slate-500">{elapsed}m ago · {order.payMode}</span>
            {prepMins>0&&remaining!==null&&(
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md ${isOverdue?"text-red-400 animate-pulse":"remaining===0&&!isOverdue?text-green-400:text-amber-400"}`}
                style={{background:isOverdue?"rgba(239,68,68,0.12)":"rgba(245,158,11,0.1)"}}>
                {isOverdue?"⚠ Overdue":`⏱ ${remaining}m left`}
              </span>
            )}
          </div>
        </div>
        <div className="text-right">
          <div className="text-white font-bold text-sm">{currency} {total.toFixed(2)}</div>
          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${order.status==="PAID"?"text-green-400":"text-amber-400"}`} style={{background:order.status==="PAID"?"rgba(34,197,94,0.1)":"rgba(245,158,11,0.1)"}}>{order.status}</span>
        </div>
      </div>
      <div className="space-y-1 mb-3">
        {order.items.map((i,idx)=>(
          <div key={idx} className="flex justify-between text-[11px]">
            <span className="text-slate-300">{i.name} ×{i.qty}</span>
            <span className="text-slate-400">{currency} {(i.qty*i.price).toFixed(2)}</span>
          </div>
        ))}
      </div>
      {err&&<div className="text-[10px] text-red-400 mb-2 p-2 rounded-lg" style={{background:"rgba(239,68,68,0.08)"}}>{err}</div>}
      {order.status==="UNPAID"&&can(role,"editOrders")&&!editing&&(
        <div className="flex gap-2">
          <button onClick={markPaid} disabled={paying} className="flex-1 py-2 rounded-xl text-xs font-semibold text-white disabled:opacity-50 flex items-center justify-center gap-1.5 transition-all" style={{background:"linear-gradient(135deg,#22c55e,#16a34a)"}}>
            {paying?<RefreshCw size={12} className="animate-spin"/>:<CheckCircle size={12}/>}{paying?"Processing...":"Mark as Paid"}
          </button>
          <button onClick={openEdit} className="px-3 py-2 rounded-xl text-violet-300 hover:text-white transition-colors" style={{background:"rgba(139,92,246,0.1)",border:"1px solid rgba(139,92,246,0.25)"}} title="Edit Order"><Edit size={14}/></button>
          <button onClick={()=>printBill(order,currency)} className="px-3 py-2 rounded-xl text-slate-300 hover:text-white transition-colors" style={{background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.08)"}} title="Print Bill"><Printer size={14}/></button>
          <button onClick={()=>{if(confirm("Delete this unpaid order?"))removeOrder(order.id);}} className="px-3 py-2 rounded-xl text-red-400 hover:text-red-300 transition-colors" style={{background:"rgba(239,68,68,0.08)",border:"1px solid rgba(239,68,68,0.15)"}} title="Delete Order"><Trash2 size={14}/></button>
        </div>
      )}
      {/* Inline order editor */}
      {editing&&(
        <div className="mt-3 rounded-xl overflow-hidden" style={{background:"rgba(255,255,255,0.03)",border:"1px solid rgba(139,92,246,0.25)"}}>
          <div className="px-3 py-2 flex items-center justify-between" style={{borderBottom:"1px solid rgba(255,255,255,0.06)"}}>
            <span className="text-xs font-semibold text-violet-300">Edit Order</span>
            <button onClick={()=>setEditing(false)} className="text-slate-500 hover:text-slate-300"><X size={14}/></button>
          </div>
          {/* Current items */}
          <div className="px-3 py-2 space-y-1 max-h-32 overflow-y-auto">
            {editItems.map(i=>(
              <div key={i.name} className="flex items-center gap-2 text-xs">
                <button onClick={()=>editQty(i.name,-1)} className="w-5 h-5 rounded-full flex items-center justify-center font-bold" style={{background:"rgba(239,68,68,0.2)",color:"#f87171"}}>−</button>
                <span className="text-slate-300 flex-1 truncate">{i.name}</span>
                <span className="text-white font-bold w-4 text-center">{i.qty}</span>
                <button onClick={()=>editQty(i.name,1)} className="w-5 h-5 rounded-full flex items-center justify-center font-bold" style={{background:"rgba(139,92,246,0.25)",color:"#c4b5fd"}}>+</button>
                <span className="text-slate-400 w-16 text-right">{currency} {(i.qty*i.price).toFixed(2)}</span>
              </div>
            ))}
          </div>
          {/* Add items from menu */}
          <div className="px-3 py-2" style={{borderTop:"1px solid rgba(255,255,255,0.04)"}}>
            <div className="text-[10px] text-slate-500 mb-1.5 uppercase tracking-wider">Add items</div>
            <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto">
              {allMenuItems.map(m=>(
                <button key={m.id} onClick={()=>editAdd(m)} className="px-2 py-1 rounded-lg text-[11px] text-slate-300 hover:text-white transition-colors" style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.08)"}}>
                  {m.name} <span className="text-slate-500">{currency} {m.price}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="px-3 py-2.5 flex gap-2" style={{borderTop:"1px solid rgba(255,255,255,0.06)"}}>
            <div className="flex-1 text-xs text-white font-bold">
              New total: {currency} {editItems.reduce((s,i)=>s+i.qty*i.price,0).toFixed(2)}
            </div>
            <button onClick={saveEdit} className="px-4 py-1.5 rounded-lg text-xs font-semibold text-white" style={{background:"linear-gradient(135deg,#8b5cf6,#7c3aed)"}}>Save Changes</button>
            <button onClick={()=>setEditing(false)} className="px-3 py-1.5 rounded-lg text-xs text-slate-400" style={{background:"rgba(255,255,255,0.05)"}}>Cancel</button>
          </div>
        </div>
      )}
      {order.status==="UNPAID"&&!can(role,"editOrders")&&(
        <div className="text-[10px] text-slate-500 text-center py-1">View only — only owners can mark orders as paid</div>
      )}
      {order.status==="PAID"&&(
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 text-green-400 text-xs">
            <CheckCircle size={13}/>
            <span>Paid · {order.payMode}</span>
            <button onClick={()=>printBill(order,currency)} className="ml-auto p-1.5 rounded-lg" style={{background:"rgba(255,255,255,0.06)"}} title="Print"><Printer size={12}/></button>
          </div>
          {order.phone&&(
            <div className="flex items-center gap-2 text-xs">
              {waSent==="sending"&&<><RefreshCw size={11} className="animate-spin text-slate-400"/><span className="text-slate-400">Sending WhatsApp receipt…</span></>}
              {waSent==="ok"&&<><WAIcon size={12} className="text-green-400"/><span className="text-green-400">WhatsApp receipt sent to {normPhone(order.phone)}</span></>}
              {waSent==="fail"&&<><XCircle size={11} className="text-red-400"/><span className="text-red-400">WhatsApp failed</span><button onClick={()=>sendWA(order)} className="ml-auto text-violet-400 underline text-[10px]">Retry</button></>}
              {waSent==="none"&&<><WAIcon size={12} className="text-slate-500"/><span className="text-slate-500">No WA sent</span><button onClick={()=>sendWA(order)} className="ml-auto text-violet-400 underline text-[10px]">Send now</button></>}
            </div>
          )}
          {!order.phone&&<div className="text-[10px] text-slate-500">No phone number — WhatsApp receipt skipped</div>}
        </div>
      )}
    </div>
  );
};

// ── Kitchen Display System ────────────────────────────────────────
const KitchenDisplay=({currency}:{currency:string})=>{
  const orders=useOrders();
  const active=orders.filter(o=>o.status==="UNPAID");
  const [,r]=useState(0);
  useEffect(()=>{const iv=setInterval(()=>r(x=>x+1),30000);return()=>clearInterval(iv);},[]);

  const toggleReady=(orderId:string,itemIdx:number)=>{
    const o=_orders.list.find(x=>x.id===orderId);if(!o)return;
    const items=o.items.map((i,idx)=>idx===itemIdx?{...i,ready:!i.ready}:i);
    updateOrder(orderId,{items});
  };

  if(!active.length)return(
    <div className="gc rounded-2xl p-12 text-center" style={CARD}>
      <div className="text-4xl mb-3">🍳</div>
      <div className="text-white font-semibold mb-1">Kitchen is clear!</div>
      <div className="text-slate-400 text-sm">No active orders. Enjoy the calm.</div>
    </div>
  );

  return(
    <div>
      <div className="flex items-center gap-3 mb-5">
        <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse"/>
        <span className="text-sm text-slate-300 font-medium">{active.length} active order{active.length!==1?"s":""} in queue</span>
        <span className="text-[10px] text-slate-500">Auto-refreshes every 30s</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {active.map(order=>{
          const elapsed=Math.floor((Date.now()-order.createdAt)/60000);
          const allReady=order.items.every(i=>i.ready);
          return(
            <div key={order.id} className="gc rounded-2xl p-4" style={{...CARD,border:allReady?"1px solid rgba(34,197,94,0.4)":elapsed>15?"1px solid rgba(239,68,68,0.4)":"1px solid rgba(245,158,11,0.3)"}}>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  {order.table&&<span className="px-2.5 py-1 rounded-lg text-xs font-bold text-cyan-400" style={{background:"rgba(6,182,212,0.15)"}}>{order.table}</span>}
                  {!order.table&&<span className="text-slate-400 text-xs">Walk-in</span>}
                </div>
                <div className="flex items-center gap-1.5">
                  <span className={`text-xs font-bold ${elapsed>15?"text-red-400":elapsed>10?"text-amber-400":"text-green-400"}`}>{elapsed}m</span>
                  {allReady&&<span className="px-2 py-0.5 rounded-full text-[10px] font-bold text-green-400" style={{background:"rgba(34,197,94,0.12)"}}>READY ✓</span>}
                </div>
              </div>
              <div className="space-y-1.5">
                {order.items.map((item,idx)=>(
                  <button key={idx} onClick={()=>toggleReady(order.id,idx)} className={`w-full flex items-center gap-3 p-2.5 rounded-xl text-left transition-all ${item.ready?"opacity-50":""}`} style={{background:item.ready?"rgba(34,197,94,0.08)":"rgba(255,255,255,0.04)",border:item.ready?"1px solid rgba(34,197,94,0.2)":"1px solid rgba(255,255,255,0.06)"}}>
                    <div className={`w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0 transition-all ${item.ready?"bg-green-500":"bg-white/10"}`}>{item.ready&&<Check size={10} className="text-white"/>}</div>
                    <span className={`text-xs flex-1 ${item.ready?"line-through text-slate-500":"text-white"}`}>{item.name}</span>
                    <span className="text-[10px] text-slate-400 font-semibold">×{item.qty}</span>
                  </button>
                ))}
              </div>
              {order.notes&&<div className="mt-2 text-[10px] text-amber-400 flex items-start gap-1"><Info size={10} className="mt-0.5 flex-shrink-0"/>{order.notes}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ── Inventory Panel ───────────────────────────────────────────────
const InventoryPanel=({bizType}:{bizType:string})=>{
  const [items,setItems]=useState<MenuItem[]>(()=>getMenu(bizType));
  const [saving,setSaving]=useState(false);
  const imgRefs=useRef<Record<string,HTMLInputElement|null>>({});
  const update=(id:string,stock:number)=>setItems(p=>p.map(i=>i.id===id?{...i,stock}:i));
  const updateImage=(id:string,image:string|undefined)=>setItems(p=>p.map(i=>i.id===id?{...i,image}:i));
  const pickImg=(id:string)=>imgRefs.current[id]?.click();
  const handleImg=(id:string,e:React.ChangeEvent<HTMLInputElement>)=>{
    const f=e.target.files?.[0];if(!f)return;
    if(f.size>500*1024){alert("Image must be under 500 KB");return;}
    const r=new FileReader();r.onload=ev=>{updateImage(id,ev.target?.result as string);};r.readAsDataURL(f);
  };
  const save=()=>{setSaving(true);saveMenu(bizType,items);setTimeout(()=>setSaving(false),600);};
  const LOW=5;
  const lowItems=items.filter(i=>i.stock!=null&&i.stock<=LOW);
  return(
    <div className="space-y-4">
      {lowItems.length>0&&(
        <div className="gc rounded-2xl p-4 flex items-start gap-3" style={{...CARD,border:"1px solid rgba(239,68,68,0.3)"}}>
          <AlertTriangle size={16} className="text-red-400 mt-0.5 flex-shrink-0"/>
          <div><div className="text-xs font-semibold text-red-400 mb-1">Low Stock Alert</div>
            <div className="text-xs text-slate-300">{lowItems.map(i=>`${i.name} (${i.stock} left)`).join(", ")}</div>
          </div>
        </div>
      )}
      <div className="gc rounded-2xl overflow-hidden" style={CARD}>
        <table className="w-full text-xs">
          <thead><tr style={{borderBottom:"1px solid rgba(255,255,255,0.07)"}}>
            {["Photo","Item","Category","Price",bizType==="restaurant"?"Prep (min)":"",bizType==="retail"?"Barcode":"","Stock",""].map((h,i)=>h?<th key={i} className="px-4 py-3 text-left text-[11px] uppercase tracking-wider text-slate-500 font-semibold">{h}</th>:null)}
          </tr></thead>
          <tbody>
            {items.map(item=>(
              <tr key={item.id} style={{borderBottom:"1px solid rgba(255,255,255,0.03)"}}>
                <td className="px-3 py-2">
                  <input ref={el=>{imgRefs.current[item.id]=el;}} type="file" accept="image/*" className="hidden" onChange={e=>handleImg(item.id,e)}/>
                  <button onClick={()=>pickImg(item.id)} title="Upload product photo" className="block w-10 h-10 rounded-lg overflow-hidden flex-shrink-0 transition-opacity hover:opacity-80" style={{background:"rgba(255,255,255,0.04)",border:"1px dashed rgba(255,255,255,0.12)"}}>
                    {item.image?<img src={item.image} alt={item.name} className="w-full h-full object-cover"/>:<div className="w-full h-full flex items-center justify-center"><Image size={14} className="text-slate-500"/></div>}
                  </button>
                  {item.image&&<button onClick={()=>updateImage(item.id,undefined)} className="text-[9px] text-red-400 hover:text-red-300 mt-0.5 block text-center w-10">✕</button>}
                </td>
                <td className="px-4 py-3 text-white font-medium">{item.name}</td>
                <td className="px-4 py-3"><span className="text-[10px] text-slate-400">{item.cat}</span></td>
                <td className="px-4 py-3 text-violet-400 font-semibold">{item.price.toFixed(2)}</td>
                {bizType==="restaurant"&&<td className="px-4 py-3 text-slate-400 text-[10px]">{item.prepTime?`${item.prepTime}m`:"—"}</td>}
                {bizType==="retail"&&<td className="px-4 py-3 text-slate-500 text-[10px] font-mono">{item.barcode||"—"}</td>}
                <td className="px-4 py-3">
                  {item.stock!=null?(
                    <div className="flex items-center gap-2">
                      <button onClick={()=>update(item.id,Math.max(0,(item.stock||0)-1))} className="w-5 h-5 rounded flex items-center justify-center text-slate-400 hover:text-white text-xs" style={{background:"rgba(255,255,255,0.06)"}}>-</button>
                      <span className={`w-8 text-center font-semibold ${item.stock<=LOW?"text-red-400":item.stock<=10?"text-amber-400":"text-green-400"}`}>{item.stock}</span>
                      <button onClick={()=>update(item.id,(item.stock||0)+10)} className="w-5 h-5 rounded flex items-center justify-center text-slate-400 hover:text-white text-xs" style={{background:"rgba(255,255,255,0.06)"}}>+</button>
                    </div>
                  ):<span className="text-slate-600">Unlimited</span>}
                </td>
                <td className="px-4 py-3">
                  {item.stock==null&&<button onClick={()=>update(item.id,50)} className="text-[10px] text-violet-400 hover:text-violet-300">Track Stock</button>}
                  {item.stock!=null&&<button onClick={()=>update(item.id,undefined as any)} className="text-[10px] text-slate-500 hover:text-slate-300">Remove</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button onClick={save} disabled={saving} className="px-5 py-2.5 rounded-xl text-xs font-semibold text-white disabled:opacity-50" style={{background:"linear-gradient(135deg,#8b5cf6,#7c3aed)"}}>{saving?"Saved ✓":"Save Stock Levels"}</button>
    </div>
  );
};

// ── Shared order builder: menu catalogue + active orders ──────────
const POSBuilder=({bizType,currency,extraTop}:{bizType:string;currency:string;extraTop?:React.ReactNode})=>{
  const [menuItems,setMenuItems]=useState<MenuItem[]>(()=>getMenu(bizType));
  const [cat,setCat]=useState(0);
  const [order,setOrder]=useState<{name:string;price:number;qty:number}[]>([]);
  const [mode,setMode]=useState<"CASH"|"CARD"|"WALLET">("CASH");
  const [phone,setPhone]=useState("");const [cname,setCname]=useState("");const [discount,setDiscount]=useState(0);
  const [table,setTable]=useState("");const [notes,setNotes]=useState("");
  const [placing,setPlacing]=useState(false);const [placed,setPlaced]=useState(false);
  const [barcodeFlash,setBarcodeFlash]=useState<string|null>(null);
  const activeOrders=useOrders().filter(o=>o.status==="UNPAID");
  const cats=[...new Set(menuItems.map(i=>i.cat))];
  const [showMenu,setShowMenu]=useState(false);
  const summaryRef=useRef<HTMLDivElement>(null);
  const scrollToSummary=()=>summaryRef.current?.scrollIntoView({behavior:"smooth",block:"start"});

  // Barcode scan handler — match by barcode field or exact name
  const handleBarcodeScan=useCallback((code:string)=>{
    const match=menuItems.find(i=>i.barcode===code||i.name.toLowerCase()===code.toLowerCase());
    if(match){addItem(match);setBarcodeFlash(match.name);setTimeout(()=>setBarcodeFlash(null),1500);}
    else{setBarcodeFlash("❓ "+code+" not found");setTimeout(()=>setBarcodeFlash(null),2000);}
  },[menuItems]);

  // Global barcode listener — detects scanner by fast keystroke timing (<60ms between chars)
  useEffect(()=>{
    if(bizType!=="retail")return;
    let buf="";let lastT=0;let timer:ReturnType<typeof setTimeout>;
    const onKey=(e:KeyboardEvent)=>{
      const target=e.target as HTMLElement;
      // Don't intercept if user is typing in an input/textarea/select (except barcode field)
      if(["INPUT","TEXTAREA","SELECT"].includes(target.tagName)&&!(target as HTMLInputElement).dataset.barcode)return;
      const now=Date.now();
      if(e.key==="Enter"){
        if(buf.length>=3)handleBarcodeScan(buf);
        buf="";lastT=0;return;
      }
      if(e.key.length===1){
        if(now-lastT>100&&buf.length>0){buf="";}// gap too long — reset
        buf+=e.key;lastT=now;
        clearTimeout(timer);
        // auto-fire if we haven't seen Enter in 200ms (some scanners don't send Enter)
        timer=setTimeout(()=>{if(buf.length>=3)handleBarcodeScan(buf);buf="";lastT=0;},200);
      }
    };
    window.addEventListener("keydown",onKey);
    return()=>{window.removeEventListener("keydown",onKey);clearTimeout(timer);};
  },[bizType,handleBarcodeScan]);

  // Reload menu when editor closes
  const reloadMenu=()=>setMenuItems(getMenu(bizType));

  const addItem=(item:MenuItem)=>{
    if(item.stock!=null&&item.stock<=0)return;
    setOrder(p=>{const ex=p.find(x=>x.name===item.name);return ex?p.map(x=>x.name===item.name?{...x,qty:x.qty+1}:x):[...p,{name:item.name,price:item.price,qty:1}];});
    setPlaced(false);
  };
  const removeItem=(n:string)=>setOrder(p=>p.map(x=>x.name===n?{...x,qty:x.qty-1}:x).filter(x=>x.qty>0));

  const placeOrder=()=>{
    if(!order.length)return;
    setPlacing(true);
    addOrder({type:bizType,table:table||undefined,items:order.map(i=>({...i,ready:false})),discount,phone,cname,payMode:mode,status:"UNPAID",notes});
    setOrder([]);setPhone("");setCname("");setDiscount(0);setTable("");setNotes("");
    setPlaced(true);setTimeout(()=>setPlaced(false),3000);
    setPlacing(false);
  };

  const subtotal=order.reduce((s,i)=>s+i.qty*i.price,0)-discount;
  const total=Math.max(0,subtotal);

  const cartCount=order.reduce((s,i)=>s+i.qty,0);
  const total2=Math.max(0,order.reduce((s,i)=>s+i.qty*i.price,0)-discount);

  return(
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      {/* Mobile floating cart button */}
      {cartCount>0&&(
        <button onClick={scrollToSummary} className="lg:hidden fixed right-4 z-40 flex items-center gap-2 px-4 py-3 rounded-2xl text-white text-sm font-semibold shadow-2xl" style={{bottom:"80px",background:"linear-gradient(135deg,#f59e0b,#d97706)",boxShadow:"0 8px 32px rgba(245,158,11,0.4)"}}>
          <ShoppingCart size={18}/>
          <span>{cartCount} item{cartCount>1?"s":""}</span>
          <span className="opacity-80">· {currency} {total2.toFixed(0)}</span>
        </button>
      )}
      {showMenu&&<MenuEditor bizType={bizType} onClose={()=>{reloadMenu();setShowMenu(false);}}/>}
      <div className="lg:col-span-2 space-y-4">
        {extraTop}
        {bizType==="retail"&&(
          <div className="gc rounded-2xl px-4 py-3 flex items-center gap-3" style={CARD}>
            <Tag size={16} className="text-violet-400 flex-shrink-0"/>
            <div className="flex-1">
              <div className="text-xs text-slate-300">Barcode scanner active — scan any product to add it instantly</div>
              <div className="text-[10px] text-slate-500 mt-0.5">Or set barcodes per product in Inventory tab</div>
            </div>
            {barcodeFlash&&(
              <div className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition-all ${barcodeFlash.startsWith("❓")?"text-red-400":"text-green-400"}`}
                style={{background:barcodeFlash.startsWith("❓")?"rgba(239,68,68,0.1)":"rgba(34,197,94,0.1)"}}>
                {barcodeFlash.startsWith("❓")?barcodeFlash:`✓ Added: ${barcodeFlash}`}
              </div>
            )}
          </div>
        )}
        {/* Menu catalogue */}
        <div className="gc rounded-2xl p-5" style={CARD}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex gap-2 overflow-x-auto pb-1 flex-1">
              {cats.map((c,i)=>{const color=menuItems.find(x=>x.cat===c)?.color||"#8b5cf6";return(
                <button key={c} onClick={()=>setCat(i)} className="px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all" style={cat===i?{background:`${color}33`,border:`1px solid ${color}55`,color}:{background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.07)",color:"#94a3b8"}}>{c}</button>
              );})}
            </div>
            <button onClick={()=>setShowMenu(true)} className="ml-3 flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] text-slate-400 hover:text-white transition-colors" style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.08)"}} title="Edit menu"><Edit size={12}/>Menu</button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {menuItems.filter(i=>i.cat===cats[cat]).map(item=>{
              const inOrder=order.find(x=>x.name===item.name);
              const outOfStock=item.stock!=null&&item.stock<=0;
              return(
                <div key={item.id} className="rounded-xl overflow-hidden transition-all" style={{background:inOrder?"rgba(139,92,246,0.12)":"rgba(255,255,255,0.04)",border:inOrder?"1px solid rgba(139,92,246,0.4)":"1px solid rgba(255,255,255,0.08)",opacity:outOfStock?0.4:1}}>
                  {item.image&&<img src={item.image} alt={item.name} className="w-full h-20 object-cover"/>}
                  <button onClick={()=>!outOfStock&&addItem(item)} className="w-full p-3 text-left" disabled={outOfStock}>
                    <div className="text-white text-xs font-semibold mb-0.5 leading-tight">{item.name}</div>
                    {item.desc&&<div className="text-slate-500 text-[10px] mb-1 truncate">{item.desc}</div>}
                    <div className="flex items-center justify-between">
                      <span className="text-slate-300 text-xs">{currency} {item.price.toFixed(2)}</span>
                      {outOfStock&&<span className="text-[9px] text-red-400">Out</span>}
                      {item.stock!=null&&!outOfStock&&item.stock<=5&&<span className="text-[9px] text-amber-400">{item.stock} left</span>}
                    </div>
                  </button>
                  {inOrder&&(
                    <div className="flex items-center justify-between px-3 pb-2">
                      <button onClick={()=>removeItem(item.name)} className="w-6 h-6 rounded-full flex items-center justify-center text-white font-bold text-sm" style={{background:"rgba(239,68,68,0.25)"}}>−</button>
                      <span className="text-violet-300 text-xs font-bold">×{inOrder.qty}</span>
                      <button onClick={()=>addItem(item)} className="w-6 h-6 rounded-full flex items-center justify-center text-white font-bold text-sm" style={{background:"rgba(139,92,246,0.35)"}}>+</button>
                    </div>
                  )}
                </div>
              );
            })}
            {menuItems.filter(i=>i.cat===cats[cat]).length===0&&<div className="col-span-3 py-6 text-center text-slate-500 text-xs">No items in this category. <button onClick={()=>setShowMenu(true)} className="text-violet-400 underline">Add items</button></div>}
          </div>
        </div>

        {/* Order being built */}
        {order.length>0&&(
          <div className="gc rounded-2xl p-4" style={CARD}>
            <div className="text-sm font-semibold text-white mb-3">Current Order</div>
            <div className="space-y-1">
              {order.map(i=>(
                <div key={i.name} className="flex items-center gap-2 py-1.5" style={{borderBottom:"1px solid rgba(255,255,255,0.05)"}}>
                  <button onClick={()=>removeItem(i.name)} className="w-5 h-5 rounded-full text-slate-500 hover:text-red-400 text-xs flex items-center justify-center" style={{background:"rgba(255,255,255,0.06)"}}>-</button>
                  <span className="text-slate-300 text-xs flex-1">{i.name}</span>
                  <span className="text-white text-xs font-semibold w-5 text-center">{i.qty}</span>
                  <button onClick={()=>addItem({id:"",cat:"",name:i.name,price:i.price})} className="w-5 h-5 rounded-full text-slate-500 hover:text-green-400 text-xs flex items-center justify-center" style={{background:"rgba(255,255,255,0.06)"}}>+</button>
                  <span className="text-slate-400 text-xs w-20 text-right">{currency} {(i.qty*i.price).toFixed(2)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Customer + payment + table */}
        <div className="gc rounded-2xl p-5" style={CARD}>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
            <div><label className="text-[10px] text-slate-400 block mb-1">Table / Ref</label><input className="w-full px-3 py-2 rounded-xl text-xs text-white outline-none" style={inpS} placeholder="T1, Chair 3…" value={table} onChange={e=>setTable(e.target.value)}/></div>
            <div><label className="text-[10px] text-slate-400 block mb-1">Customer Name</label><input className="w-full px-3 py-2 rounded-xl text-xs text-white outline-none" style={inpS} placeholder="Optional" value={cname} onChange={e=>setCname(e.target.value)}/></div>
            <div><label className="text-[10px] text-slate-400 block mb-1">WhatsApp (for receipt)</label><input className="w-full px-3 py-2 rounded-xl text-xs text-white outline-none" style={inpS} placeholder="+92…" value={phone} onChange={e=>setPhone(e.target.value)}/></div>
            <div><label className="text-[10px] text-slate-400 block mb-1">Notes / Special req.</label><input className="w-full px-3 py-2 rounded-xl text-xs text-white outline-none" style={inpS} placeholder="Allergy, mods…" value={notes} onChange={e=>setNotes(e.target.value)}/></div>
          </div>
          <div className="flex gap-2 mb-4">
            {(["CASH","CARD","WALLET"] as const).map(m=>(
              <button key={m} onClick={()=>setMode(m)} className={`flex-1 py-2 rounded-xl text-xs font-semibold transition-all ${mode===m?"text-white":"text-slate-400"}`} style={mode===m?{background:"rgba(139,92,246,0.3)",border:"1px solid rgba(139,92,246,0.5)"}:{background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.08)"}}>{m}</button>
            ))}
          </div>
          <div className="flex items-center gap-3"><label className="text-xs text-slate-400">Discount ({currency})</label><input className="w-28 px-3 py-2 rounded-xl text-xs text-white outline-none" style={inpS} type="number" min={0} step={0.01} placeholder="0.00" value={discount||""} onChange={e=>setDiscount(Number(e.target.value))}/></div>
        </div>
      </div>

      {/* Right: summary + place order + active orders */}
      <div className="space-y-4" ref={summaryRef}>
        <div className="gc rounded-2xl p-5" style={CARD}>
          <div className="text-sm font-semibold text-white mb-4">Order Summary</div>
          <div className="space-y-1.5 text-xs mb-4 max-h-44 overflow-y-auto">
            {order.map((i,idx)=><div key={idx} className="flex justify-between text-slate-300"><span>{i.name} ×{i.qty}</span><span>{currency} {(i.qty*i.price).toFixed(2)}</span></div>)}
            {!order.length&&<div className="text-slate-500 text-center py-3">Tap items from the menu</div>}
            {discount>0&&<div className="flex justify-between text-amber-400"><span>Discount</span><span>-{currency} {discount.toFixed(2)}</span></div>}
          </div>
          <div className="border-t border-white/10 pt-3 flex justify-between text-white font-bold"><span>TOTAL</span><span>{currency} {total.toFixed(2)}</span></div>
          <button onClick={placeOrder} disabled={placing||!order.length} className="w-full mt-4 py-3 rounded-xl text-sm font-semibold text-white disabled:opacity-40 flex items-center justify-center gap-2 transition-all hover:opacity-90" style={{background:"linear-gradient(135deg,#f59e0b,#d97706)"}}>
            {bizType==="restaurant"?<>🍳 {placing?"Sending…":"Send to Kitchen"}</>:<><Send size={15}/>{placing?"Placing…":"Place Order"}</>}
          </button>
          {placed&&<div className="mt-2 p-2 rounded-xl text-xs text-green-400 flex items-center gap-2" style={{background:"rgba(34,197,94,0.08)"}}><CheckCircle size={12}/>{bizType==="restaurant"?"Order sent to kitchen!":"Order placed!"}</div>}
        </div>

        {/* Active unpaid orders */}
        {activeOrders.length>0&&(
          <div>
            <div className="text-xs text-slate-400 font-semibold uppercase tracking-wider mb-2">Active Orders ({activeOrders.length})</div>
            <div className="space-y-3">
              {activeOrders.map(o=><ActiveOrderCard key={o.id} order={o} currency={currency} bizType={bizType} onPaid={()=>{}}/>)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// ── Sales History (shared across all POS types) ───────────────────
const SalesHistory=({currency}:{currency:string})=>{
  const [sales,setSales]=useState<any[]>([]);const [total,setTotal]=useState(0);const [pg,setPg]=useState(1);const [loading,setLoading]=useState(false);
  const [from,setFrom]=useState("");const [to,setTo]=useState("");const [mode,setMode]=useState("");const [sel,setSel]=useState<any>(null);
  const load=async()=>{setLoading(true);try{const p:any={page:pg,limit:20};if(from)p.from=from;if(to)p.to=to;if(mode)p.paymentMode=mode;const r=await api.pos.sales(p);setSales(r.sales??[]);setTotal(r.total??0);}catch{}setLoading(false);};
  useEffect(()=>{load();},[pg,from,to,mode]);
  return(
    <div className="space-y-4">
      <div className="gc rounded-2xl p-4" style={CARD}>
        <div className="flex flex-wrap gap-3 items-end">
          {[["From","date",from,setFrom],["To","date",to,setTo]].map(([l,t,v,s]:any)=><div key={l}><label className="text-[10px] text-slate-400 block mb-1">{l}</label><input type={t} className="px-2 py-1.5 rounded-xl text-xs text-white outline-none" style={inpS} value={v} onChange={(e:any)=>s(e.target.value)}/></div>)}
          <div><label className="text-[10px] text-slate-400 block mb-1">Payment</label>
            <select className="px-2 py-1.5 rounded-xl text-xs text-white outline-none" style={inpS} value={mode} onChange={(e:any)=>setMode(e.target.value)}>
              <option value="">All</option><option value="CASH">Cash</option><option value="CARD">Card</option><option value="WALLET">Wallet</option>
            </select>
          </div>
          <button onClick={()=>{setPg(1);load();}} className="px-3 py-1.5 rounded-xl text-xs text-white font-medium" style={{background:"rgba(139,92,246,0.3)"}}>Apply</button>
        </div>
      </div>
      <div className="gc rounded-2xl overflow-hidden" style={CARD}>
        {loading?<div className="p-8 text-center text-slate-400"><RefreshCw size={20} className="animate-spin mx-auto mb-2"/>Loading...</div>:(
          <table className="w-full text-xs"><thead><tr style={{borderBottom:"1px solid rgba(255,255,255,0.07)"}}>
            {["Date","Customer","Amount","Mode","FBR","Status",""].map(h=><th key={h} className="px-4 py-3 text-left text-[11px] uppercase tracking-wider text-slate-500 font-semibold">{h}</th>)}
          </tr></thead><tbody>
            {sales.length===0?<tr><td colSpan={7} className="px-4 py-8 text-center text-slate-500">No sales found</td></tr>:
            sales.map(s=>(
              <tr key={s.id} className="cursor-pointer hover:bg-white/[0.025] transition-colors" style={{borderBottom:"1px solid rgba(255,255,255,0.03)"}} onClick={()=>setSel(s)}>
                <td className="px-4 py-3 text-slate-300">{new Date(s.visitedAt).toLocaleString("en-GB",{dateStyle:"short",timeStyle:"short"})}</td>
                <td className="px-4 py-3 text-white">{s.customer?.fullName??"—"}</td>
                <td className="px-4 py-3 text-white font-medium">{currency} {Number(s.amountSpent).toFixed(2)}</td>
                <td className="px-4 py-3"><Badge color={s.paymentMode==="CASH"?"#22c55e":s.paymentMode==="CARD"?"#3b82f6":"#8b5cf6"}>{s.paymentMode??"—"}</Badge></td>
                <td className="px-4 py-3 text-slate-500 font-mono text-[10px] max-w-[100px] truncate">{s.fbrInvoiceNumber??"—"}</td>
                <td className="px-4 py-3">{s.fbrSubmittedAt?<Badge color="#22c55e">OK</Badge>:<Badge color="#f59e0b">Pending</Badge>}</td>
                <td className="px-4 py-3"><button onClick={e=>{e.stopPropagation();window.open(api.pos.receipt(s.id),"_blank");}} className="p-1 rounded text-slate-400 hover:text-white"><Printer size={12}/></button></td>
              </tr>
            ))}
          </tbody></table>
        )}
      </div>
      {total>20&&<div className="flex items-center justify-between text-xs text-slate-400">
        <span>{total} total</span>
        <div className="flex gap-1">
          <button disabled={pg===1} onClick={()=>setPg(p=>p-1)} className="px-3 py-1.5 rounded-xl disabled:opacity-40" style={{background:"rgba(255,255,255,0.06)"}}>Prev</button>
          <span className="px-3 py-1.5 text-white">{pg}</span>
          <button disabled={pg*20>=total} onClick={()=>setPg(p=>p+1)} className="px-3 py-1.5 rounded-xl disabled:opacity-40" style={{background:"rgba(255,255,255,0.06)"}}>Next</button>
        </div>
      </div>}
      {sel&&<div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{background:"rgba(0,0,0,0.75)",backdropFilter:"blur(6px)"}}>
        <div className="gc rounded-2xl p-6 w-full max-w-md" style={CARD}>
          <div className="flex items-center justify-between mb-4"><span className="text-sm font-semibold text-white">Sale Detail</span><button onClick={()=>setSel(null)} className="text-slate-400 hover:text-white"><X size={16}/></button></div>
          <div className="space-y-2.5 text-xs">
            {[["Customer",sel.customer?.fullName??"—"],["Amount",`${currency} ${Number(sel.amountSpent).toFixed(2)}`],["GST",`${currency} ${Number(sel.gstAmount??0).toFixed(2)}`],["Payment",sel.paymentMode??"—"],["FBR Invoice",sel.fbrInvoiceNumber??"Not submitted"],["Date",new Date(sel.visitedAt).toLocaleString()]].map(([k,v])=>(
              <div key={k} className="flex justify-between"><span className="text-slate-400">{k}</span><span className="text-white font-medium max-w-[200px] text-right break-all">{v}</span></div>
            ))}
          </div>
          <div className="flex gap-2 mt-5">
            <button onClick={()=>window.open(api.pos.receipt(sel.id),"_blank")} className="flex-1 py-2.5 rounded-xl text-xs text-white flex items-center justify-center gap-1.5 font-medium" style={{background:"rgba(139,92,246,0.3)"}}><Printer size={12}/>Receipt</button>
            {!sel.fbrSubmittedAt&&<button onClick={async()=>{try{await api.pos.retryFbr(sel.id);setSel(null);load();}catch(e){alert((e as Error).message);}}} className="flex-1 py-2.5 rounded-xl text-xs text-amber-400 flex items-center justify-center gap-1.5" style={{background:"rgba(245,158,11,0.1)"}}><RefreshCw size={12}/>Retry FBR</button>}
          </div>
        </div>
      </div>}
    </div>
  );
};

// ── FBR Panel (shared) ────────────────────────────────────────────
const FBRPanel=()=>{
  const [stats,setStats]=useState<any>(null);
  const [s,setS]=useState({ntn:"",strn:"",fbrPosId:"",fbrToken:"",gstRate:"17",fbrEnabled:false});
  const [saving,setSaving]=useState(false);const [testing,setTesting]=useState(false);const [res,setRes]=useState<string|null>(null);
  useEffect(()=>{api.pos.stats().then(setStats).catch(()=>{});},[]);
  return(
    <div className="space-y-4">
      {stats&&<div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <KPI icon={DollarSign} label="Sales Today" value={`PKR ${(stats.totalSales??0).toFixed(0)}`} color={C.green}/>
        <KPI icon={Receipt} label="GST Collected" value={`PKR ${(stats.totalGst??0).toFixed(0)}`} color={C.amber}/>
        <KPI icon={ShoppingCart} label="Transactions" value={stats.transactionCount??0} color={C.primary}/>
        <KPI icon={CheckCircle} label="FBR Submitted" value={stats.fbrSubmitted??0} color={C.green}/>
        <KPI icon={XCircle} label="FBR Pending" value={stats.fbrFailed??0} color={C.red}/>
      </div>}
      <div className="gc rounded-2xl p-5" style={CARD}>
        <div className="flex items-center justify-between mb-4">
          <span className="text-sm font-semibold text-white">FBR Configuration</span>
          <button onClick={()=>setS(p=>({...p,fbrEnabled:!p.fbrEnabled}))} className={`w-10 h-5 rounded-full relative transition-colors ${s.fbrEnabled?"bg-violet-500":"bg-white/10"}`}><div className="w-4 h-4 rounded-full bg-white absolute top-0.5 transition-all" style={{left:s.fbrEnabled?22:2}}/></button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
          {[["NTN","ntn","National Tax Number"],["STRN","strn","Sales Tax Reg. No."],["POS ID","fbrPosId","FBR-assigned POS ID"],["FBR Token","fbrToken","PRAL API Bearer Token"],["GST Rate (%)","gstRate","Default 17"]].map(([label,key,ph])=>(
            <div key={key}><label className="text-[10px] text-slate-400 block mb-1">{label}</label>
              <input className="w-full px-3 py-2 rounded-xl text-xs text-white outline-none" style={inpS} placeholder={ph} value={(s as any)[key]} onChange={e=>setS(p=>({...p,[key]:e.target.value}))}/>
            </div>
          ))}
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={async()=>{setSaving(true);try{await api.settings.update({ntn:s.ntn,strn:s.strn,fbrPosId:parseInt(s.fbrPosId)||undefined,fbrToken:s.fbrToken,gstRate:parseFloat(s.gstRate)||17,fbrEnabled:s.fbrEnabled});}catch{}setSaving(false);}} disabled={saving} className="px-4 py-2 rounded-xl text-xs font-semibold text-white disabled:opacity-50" style={{background:"linear-gradient(135deg,#8b5cf6,#7c3aed)"}}>{saving?"Saving...":"Save"}</button>
          <button onClick={async()=>{setTesting(true);setRes(null);try{await api.pos.stats();setRes("ok");}catch{setRes("fail");}setTesting(false);}} disabled={testing} className="px-4 py-2 rounded-xl text-xs text-slate-300 disabled:opacity-50 flex items-center gap-1.5" style={{background:"rgba(255,255,255,0.06)"}}>{testing?<RefreshCw size={12} className="animate-spin"/>:<WifiIcon size={12}/>}Test</button>
          {res&&<span className={`px-3 py-2 rounded-xl text-xs ${res==="ok"?"text-green-400":"text-red-400"}`}>{res==="ok"?"✓ Connected":"✗ Failed"}</span>}
        </div>
      </div>
      <div className="gc rounded-2xl p-4" style={{...CARD,border:"1px solid rgba(245,158,11,0.2)"}}>
        <div className="flex items-start gap-3"><Info size={15} className="text-amber-400 mt-0.5 flex-shrink-0"/><div><div className="text-xs font-semibold text-amber-400 mb-1">Sandbox Mode</div><div className="text-xs text-slate-400">FBR submissions are mocked in non-production. Invoice numbers are prefixed <code className="text-slate-300">SANDBOX-</code>.</div></div></div>
      </div>
    </div>
  );
};

// ════════════════════════════════════════════════════════════════
// MAIN POS PAGE
// ════════════════════════════════════════════════════════════════
const BIZ_TYPES=[
  {id:"restaurant",label:"Restaurant / Café",icon:"🍽",color:"#f59e0b"},
  {id:"salon",label:"Salon / Beauty",icon:"💇",color:"#ec4899"},
  {id:"gym",label:"Gym / Fitness",icon:"💪",color:"#06b6d4"},
  {id:"retail",label:"Retail / General",icon:"🛍",color:"#8b5cf6"},
];

const POSPage=({role=ROLES.OWNER}:{role?:string})=>{
  const bizType=getPosBizType();
  const [tab,setTab]=useState<"pos"|"kds"|"inventory"|"history"|"fbr">(
    ()=>can(role,"viewKitchen")&&!can(role,"newSale")?"kds":"pos"
  );
  const [currency]=useState("PKR");
  const activeOrders=useOrders().filter(o=>o.status==="UNPAID");

  // Build tab list based on biz type and role
  const allTabs:[string,string][]=[
    ["pos","🧾 New Sale"],
    ...(bizType==="restaurant"?[["kds","👨‍🍳 Kitchen"]] as [string,string][]:
        bizType==="gym"?[["kds","🏃 Check-in"]] as [string,string][]:[]),
    ...(can(role,"editMenu")?[["inventory","📦 Inventory"]] as [string,string][]:[]),
    ...(can(role,"viewOrders")?[["history","📋 History"]] as [string,string][]:[]),
    ...(can(role,"changeSettings")?[["fbr","🏛 FBR"]] as [string,string][]:[]),
  ];

  // Kitchen/check-in only roles see just the KDS tab
  if(!can(role,"newSale")){
    const biz=BIZ_TYPES.find(b=>b.id===bizType);
    return(
      <div>
        <div className="mb-4">
          <h1 className="text-2xl font-bold text-white tracking-tight flex items-center gap-2">
            {bizType==="gym"?"🏃":"👨‍🍳"} {bizType==="gym"?"Check-in Display":"Kitchen Display"}
          </h1>
          <p className="text-xs text-slate-400">{biz?.label??""} · {role?.replace("_"," ")}</p>
        </div>
        <KitchenDisplay currency={currency}/>
      </div>
    );
  }

  if(!bizType){return(
    <div>
      <div className="mb-6 gc rounded-2xl p-5" style={{...CARD,borderColor:"rgba(245,158,11,0.3)"}}>
        <div className="flex items-start gap-3">
          <AlertTriangle size={20} className="text-amber-400 flex-shrink-0 mt-0.5"/>
          <div>
            <div className="text-white font-semibold text-sm mb-1">Business type not set</div>
            <div className="text-xs text-slate-400">Go to <strong className="text-violet-400">Settings → Business Profile</strong> and set your industry category to auto-configure the POS for your business.</div>
          </div>
        </div>
      </div>
    </div>
  );}

  const biz=BIZ_TYPES.find(b=>b.id===bizType)!;

  return(
    <div>
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <span className="text-2xl">{biz.icon}</span>
          <div><h1 className="text-2xl font-bold text-white tracking-tight">Loyable POS</h1><p className="text-xs text-slate-400 mt-0.5">{biz.label} · {currency}</p></div>
        </div>
        <div className="flex gap-1 rounded-xl p-1" style={{background:"rgba(255,255,255,0.05)"}}>
          {allTabs.map(([t,label])=>(
            <button key={t} onClick={()=>setTab(t as any)} className={`relative px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${tab===t?"text-white":"text-slate-400 hover:text-white"}`} style={tab===t?{background:"rgba(139,92,246,0.3)"}:{}}>
              {label}
              {(t==="kds")&&activeOrders.length>0&&<span className="absolute -top-1 -right-1 w-4 h-4 rounded-full text-[9px] font-bold text-white flex items-center justify-center" style={{background:"#ef4444"}}>{activeOrders.length}</span>}
            </button>
          ))}
        </div>
      </div>

      {tab==="pos"&&<POSBuilder bizType={bizType} currency={currency}/>}
      {tab==="kds"&&(
        <div>
          <div className="mb-4"><h2 className="text-lg font-bold text-white">{bizType==="gym"?"Check-in Display":"Kitchen Display"}</h2><p className="text-xs text-slate-400">Tap items to mark as ready. Orders auto-sorted by wait time.</p></div>
          <KitchenDisplay currency={currency}/>
        </div>
      )}
      {tab==="inventory"&&(
        <div>
          <div className="mb-4"><h2 className="text-lg font-bold text-white">Inventory</h2><p className="text-xs text-slate-400">Stock levels update automatically when orders are marked as paid.</p></div>
          <InventoryPanel bizType={bizType}/>
        </div>
      )}
      {tab==="history"&&<SalesHistory currency={currency}/>}
      {tab==="fbr"&&<FBRPanel/>}
    </div>
  );
};
// ════════════════════════════════════════════════════════════════
// APP
// ════════════════════════════════════════════════════════════════

export default function App({onLogout,onRoleChange}:{onLogout?:()=>void,onRoleChange?:(role:string)=>void}={}){
  const [loggedIn,setLoggedIn]=useState(()=>{
    // Handle OAuth redirect: /api/auth/google redirects back with ?accessToken=...&sessionId=...&userId=...
    const params=new URLSearchParams(window.location.search);
    const oauthToken=params.get("accessToken");
    const oauthSession=params.get("sessionId");
    const oauthUserId=params.get("userId");
    const oauthError=params.get("error");
    if(oauthError){
      // Show error briefly — LoginPage will handle display
      console.warn("[oauth] Error from provider:",oauthError);
    }
    if(oauthToken){
      localStorage.setItem("accessToken",oauthToken);
      if(oauthSession)localStorage.setItem("sessionId",oauthSession);
      if(oauthUserId)localStorage.setItem("userId",oauthUserId);
      // Strip OAuth params from URL without adding a history entry
      const clean=window.location.pathname+(window.location.hash||"");
      window.history.replaceState({},"",clean);
      return true;
    }
    return!!localStorage.getItem("accessToken");
  });
  const role=useRole();
  const [page,setPage]=useState(()=>{
    const r=localStorage.getItem("userRole")||ROLES.OWNER;
    if(r===ROLES.KITCHEN)return"pos";
    const saved=localStorage.getItem("crm_page");
    const safePgs=["dashboard","customers","messages","campaigns","automations","settings","loyalty","portal","pos","ai-bi"];
    return(saved&&safePgs.includes(saved))?saved:"dashboard";
  });
  const [col,setCol]=useState(false);const [selC,setSelC]=useState(null);const [mobileMenu,setMobileMenu]=useState(false);const [wa,setWa]=useState(false);const [showWA,setShowWA]=useState(false);
  useEffect(()=>{
    if(loggedIn){
      // Hydrate biz_industry / biz_name from server on every session start
      hydrateFromApi();
    }
    if(!loggedIn)return;
    const check=()=>api.whatsapp.status().then(d=>{setWa(d?.waha?.status==="WORKING"||!!(d?.meta?.configured));}).catch(()=>{});
    check();
    const iv=setInterval(check,15000);
    return()=>clearInterval(iv);
  },[loggedIn]);
  const doLogout=()=>{localStorage.removeItem("accessToken");localStorage.removeItem("userRole");onLogout?.();setLoggedIn(false);};
  if(!loggedIn)return <LoginPage onLogin={(u:any)=>{
    if(u?.role)localStorage.setItem("userRole",u.role);
    onRoleChange?.(u?.role??'');
    if(u?.role==='PLATFORM_ADMINISTRATOR')return; // App.tsx will switch to AdminPanel
    setLoggedIn(true);
  }}/>;
  const nav=p=>{
    // Enforce role restrictions — redirect to POS if not allowed
    const allowed=NAV_ALL.find(n=>n.id===p)?.roles??[ROLES.OWNER];
    if(!allowed.includes(role)){setPage(role===ROLES.KITCHEN?"pos":"pos");return;}
    setPage(p);localStorage.setItem("crm_page",p);if(p!=="profile"&&p!=="campaign-builder"&&p!=="automation-builder")setSelC(null);setMobileMenu(false);
  };
  const render=()=>{
    // Block non-owner from owner-only pages
    if(!can(role,"viewAnalytics")&&(page==="dashboard"||page==="ai"||page==="datahub"))return<POSPage role={role}/>;
    switch(page){
    case"dashboard":return<DashboardPage setPage={nav}/>;
    case"customers":return<CustomersUnifiedPage onSelect={c=>{setSelC(c);setPage("profile");}} setPage={nav}/>;
    case"profile":return selC?<CustomerProfile customer={selC} onBack={()=>nav("customers")} onMsg={c=>{setSelC(c);setPage("messages");}}/>:<CustomersUnifiedPage onSelect={c=>{setSelC(c);setPage("profile");}} setPage={nav}/>;
    case"pos":return<POSPage role={role}/>;
    case"messages":return<MessagesPage onConnect={()=>setPage("settings")}/>;
    case"campaigns":return<CampaignsPage onBuilder={()=>setPage("campaign-builder")}/>;
    case"campaign-builder":return<CampaignBuilderPage onBack={()=>setPage("campaigns")}/>;
    case"automations":return<AutomationsPage onBuilder={()=>setPage("automation-builder")}/>;
    case"automation-builder":return<AutomationBuilderPage onBack={()=>setPage("automations")}/>;
    case"loyalty":return<CustomersUnifiedPage onSelect={c=>{setSelC(c);setPage("profile");}} setPage={nav}/>;
    case"datahub":return<DataHubPage/>;
    case"ai":return<AIPage/>;
    case"analytics":return<DashboardPage setPage={nav}/>;
    case"portal":return<CustomersUnifiedPage onSelect={c=>{setSelC(c);setPage("profile");}} setPage={nav}/>;
    case"settings":return<SettingsPage wa={wa} onConnect={()=>{}}/>;
    default:return<DashboardPage setPage={nav}/>;
  }};
  // Bottom nav — role-filtered, capped at 5 most relevant items
  const BOT_NAV_ALL=[
    {id:"dashboard",icon:LayoutDashboard,label:"Home",roles:[ROLES.OWNER]},
    {id:"pos",icon:ShoppingCart,label:"POS",roles:[ROLES.OWNER,ROLES.MANAGER,ROLES.STAFF,ROLES.KITCHEN]},
    {id:"customers",icon:Users,label:"Customers",roles:[ROLES.OWNER,ROLES.MANAGER]},
    {id:"messages",icon:MessageSquare,label:"Messages",roles:[ROLES.OWNER,ROLES.MANAGER,ROLES.STAFF]},
    {id:"campaigns",icon:Send,label:"Campaigns",roles:[ROLES.OWNER,ROLES.MANAGER]},
    {id:"settings",icon:Settings,label:"Settings",roles:[ROLES.OWNER,ROLES.MANAGER]},
  ];
  const BOT_NAV=BOT_NAV_ALL.filter(it=>it.roles.includes(role)).slice(0,5);
  return(
    <div className="min-h-screen relative overflow-x-hidden" style={{background:"#06040f"}}>
      {/* Ambient background orbs for glassmorphism depth */}
      <div className="fixed inset-0 pointer-events-none z-0">
        <div style={{position:"absolute",top:"-10%",left:"-5%",width:"500px",height:"500px",borderRadius:"50%",background:"radial-gradient(circle,rgba(139,92,246,0.18) 0%,transparent 70%)",filter:"blur(40px)"}}/>
        <div style={{position:"absolute",top:"40%",right:"-10%",width:"600px",height:"600px",borderRadius:"50%",background:"radial-gradient(circle,rgba(6,182,212,0.12) 0%,transparent 70%)",filter:"blur(40px)"}}/>
        <div style={{position:"absolute",bottom:"-10%",left:"30%",width:"500px",height:"500px",borderRadius:"50%",background:"radial-gradient(circle,rgba(236,72,153,0.08) 0%,transparent 70%)",filter:"blur(40px)"}}/>
        <div style={{position:"absolute",top:"20%",left:"40%",width:"300px",height:"300px",borderRadius:"50%",background:"radial-gradient(circle,rgba(139,92,246,0.07) 0%,transparent 70%)",filter:"blur(30px)"}}/>
      </div>
      <style>{`
        *{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
        html{-webkit-text-size-adjust:100%}
        body{overscroll-behavior:none}
        ::-webkit-scrollbar{width:4px;height:4px}
        ::-webkit-scrollbar-track{background:transparent}
        ::-webkit-scrollbar-thumb{background:rgba(139,92,246,0.35);border-radius:4px}
        ::-webkit-scrollbar-thumb:hover{background:rgba(139,92,246,0.6)}
        .gc{position:relative;overflow:hidden}
        .gc::before{content:'';position:absolute;top:0;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent,rgba(255,255,255,0.6),transparent);z-index:1;pointer-events:none}
        .gc::after{content:'';position:absolute;top:0;left:0;width:1px;height:100%;background:linear-gradient(180deg,rgba(255,255,255,0.6),transparent,rgba(255,255,255,0.15));z-index:1;pointer-events:none}
        button,a{touch-action:manipulation}
        input,select,textarea{font-size:16px!important}
      `}</style>
      {showWA&&<MetaWizard onDone={()=>{setWa(true);setShowWA(false);setPage("messages");}} onClose={()=>setShowWA(false)}/>}
      {/* Desktop sidebar */}
      <div className="hidden md:block"><Sidebar page={page} setPage={nav} col={col} setCol={setCol} onLogout={doLogout} wa={wa} role={role}/></div>
      {/* Mobile top bar */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-4 py-3" style={{background:"rgba(8,6,18,0.95)",backdropFilter:"blur(20px)",WebkitBackdropFilter:"blur(20px)",borderBottom:"1px solid rgba(255,255,255,0.06)"}}>
        <div className="flex items-center gap-2">
          <img src="/logo.svg" alt="Loyable" className="w-8 h-8 object-contain"/>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-400 capitalize">{NAV_ALL.find(n=>n.id===page)?.label||""}</span>
          <div className="flex items-center gap-1.5"><div className="w-1.5 h-1.5 rounded-full" style={{background:wa?"#22c55e":"#6b7280"}}/><span className="text-[10px] text-slate-500">{wa?"WA":"—"}</span></div>
        </div>
      </div>
      {/* Main content */}
      <main className={`relative z-10 transition-all duration-300 ${col?"md:ml-[72px]":"md:ml-[240px]"} pt-14 md:pt-0 pb-24 md:pb-0`}>
        <div className="p-3 md:p-6 max-w-6xl">{render()}</div>
      </main>
      {/* Mobile bottom navigation */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 flex items-center overflow-x-auto" style={{background:"rgba(8,6,18,0.97)",backdropFilter:"blur(24px)",WebkitBackdropFilter:"blur(24px)",borderTop:"1px solid rgba(255,255,255,0.07)"}}>
        {BOT_NAV.map(it=>{
          const active=page===it.id||(it.id==="customers"&&page==="profile");
          return(
            <button key={it.id} onClick={()=>nav(it.id)} className="relative flex-1 min-w-[60px] flex flex-col items-center gap-1 py-3 transition-all" style={{color:active?"#8b5cf6":"#64748b"}}>
              {active&&<div className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-[2px] rounded-b-full" style={{background:"#8b5cf6"}}/>}
              <it.icon size={20} strokeWidth={active?2.5:1.8}/>
              <span className="text-[10px] font-medium">{it.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
