import { useState, useEffect, useRef, useCallback, createContext, useContext, lazy, Suspense } from "react";
const QRCodeSVG = lazy(()=>import("qrcode.react").then(m=>({default:m.QRCodeSVG})));
import { api } from "./api/index";
import { AreaChart, Area, BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ZAxis } from "recharts";
import { Users, BarChart3, MessageSquare, Zap, Settings, LogOut, ChevronRight, Search, Plus, ArrowUpRight, ArrowDownRight, Eye, EyeOff, Send, CheckCheck, Clock, Star, Crown, UserPlus, UserMinus, Gift, TrendingUp, Bell, Menu, X, ChevronLeft, Mail, Phone, Building, Globe, CreditCard, Shield, Palette, Play, Edit, Target, Heart, Check, LayoutDashboard, Image, Paperclip, FileText, ArrowLeft, RefreshCw, CircleCheck, Info, WifiOff, Database, Brain, Activity, AlertTriangle, Table, Terminal, Layers, Download, Wifi, Tag, Link, Type, MousePointer, Cpu, Award, Repeat, RotateCcw, Sliders, Gift as GiftIcon, Star as StarIcon, Zap as ZapIcon, ChevronDown, ChevronUp, Hash, DollarSign, ShoppingBag, MoreVertical, Filter, Copy, Trash2, Smartphone, Lock, ShoppingCart, Receipt, Printer, CheckCircle, XCircle, Wifi as WifiIcon, QrCode, ScanLine, ExternalLink, UserCheck, Upload } from "lucide-react";

// ════════════════════════════════════════════════════════════════
// SCHEMA ENUMS (mirrors Prisma schema)
// ════════════════════════════════════════════════════════════════
const SEG_COLORS: Record<string,string> = { NEW:"#3b82f6", LOYAL:"#22c55e", VIP:"#f59e0b", AT_RISK:"#ef4444", LOST:"#6b7280", BIG_SPENDER:"#06b6d4", COUPON_HUNTER:"#ec4899" };
const STATUS_COLORS: Record<string,string> = { PENDING:"#f59e0b", QUEUED:"#3b82f6", SENT:"#22c55e", DELIVERED:"#10b981", READ:"#06b6d4", FAILED:"#ef4444", CONSENT_REVOKED:"#6b7280", DROPPED_COOLDOWN:"#8b5cf6", DROPPED_QUOTA:"#f97316" };
const ROLE_COLORS: Record<string,string> = { PLATFORM_ADMINISTRATOR:"#ef4444", TENANT_OWNER:"#f59e0b", BRANCH_MANAGER:"#8b5cf6", CASHIER:"#3b82f6", MARKETING_STAFF:"#22c55e", CUSTOMER:"#06b6d4" };
const TIER_COLORS: Record<string,string> = { FREE:"#6b7280", STARTER:"#3b82f6", GROWTH:"#22c55e", PROFESSIONAL:"#8b5cf6", ENTERPRISE:"#f59e0b" };
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

// Churn risk score (0-100): weighted by recency, frequency and segment.
// Higher = more likely to stop visiting. Mirrors the backend AT_RISK/LOST logic
// but produces a continuous score so the dashboard meter is meaningful.
const computeChurnRisk = (c: any): number => {
  const now = Date.now();
  const lastVisit = c.lastVisitAt ? new Date(c.lastVisitAt).getTime() : null;
  const daysSince = lastVisit ? Math.floor((now - lastVisit) / 86_400_000) : 999;
  const visits = c.visitCount ?? 0;

  // Recency: 0 days → 0, 90+ days → ~55 pts (weight 60%)
  const recencyScore = Math.min(60, (daysSince / 90) * 60);
  // Frequency: 0 visits → 30, 10+ visits → 0 (weight 30%)
  const freqScore = Math.max(0, 30 - Math.min(30, visits * 3));
  // Segment nudge
  const segBonus = c.segment === "LOST" ? 15 : c.segment === "AT_RISK" ? 10 : c.segment === "NEW" ? 5 : 0;

  return Math.max(0, Math.min(100, Math.round(recencyScore + freqScore + segBonus)));
};

// ════════════════════════════════════════════════════════════════
// PHONE INPUT  — country code dropdown + local number
// ════════════════════════════════════════════════════════════════
const COUNTRY_CODES = [
  {code:"+44",flag:"🇬🇧"},{code:"+1",flag:"🇺🇸"},{code:"+92",flag:"🇵🇰"},
  {code:"+971",flag:"🇦🇪"},{code:"+966",flag:"🇸🇦"},{code:"+91",flag:"🇮🇳"},
  {code:"+61",flag:"🇦🇺"},{code:"+49",flag:"🇩🇪"},{code:"+33",flag:"🇫🇷"},
  {code:"+39",flag:"🇮🇹"},{code:"+34",flag:"🇪🇸"},{code:"+31",flag:"🇳🇱"},
  {code:"+55",flag:"🇧🇷"},{code:"+27",flag:"🇿🇦"},{code:"+234",flag:"🇳🇬"},
  {code:"+254",flag:"🇰🇪"},{code:"+60",flag:"🇲🇾"},{code:"+65",flag:"🇸🇬"},
  {code:"+62",flag:"🇮🇩"},{code:"+63",flag:"🇵🇭"},{code:"+20",flag:"🇪🇬"},
  {code:"+212",flag:"🇲🇦"},{code:"+90",flag:"🇹🇷"},{code:"+7",flag:"🇷🇺"},
];

function detectCC(value: string) {
  // Sort by length descending so +234 matches before +23
  const sorted = [...COUNTRY_CODES].sort((a,b)=>b.code.length-a.code.length);
  return sorted.find(c=>value.startsWith(c.code))?.code ?? "+44";
}

function PhoneInput({
  value, onChange, inputStyle, placeholder="7911 123456",
}: {
  value: string;
  onChange: (v: string) => void;
  inputStyle?: React.CSSProperties;
  placeholder?: string;
}) {
  const cc = detectCC(value);
  const local = value.startsWith(cc) ? value.slice(cc.length) : (value.startsWith("+") ? "" : value);
  const selectSt: React.CSSProperties = {
    ...(inputStyle ?? {}),
    width:"90px", flexShrink:0, paddingLeft:"8px", paddingRight:"4px",
    fontFamily:"inherit", fontSize:"12px", cursor:"pointer",
  };
  return (
    <div style={{display:"flex",gap:"6px",alignItems:"stretch"}}>
      <select
        value={cc}
        onChange={e=>onChange(e.target.value+local)}
        style={selectSt}
        className="rounded-lg outline-none text-white"
      >
        {COUNTRY_CODES.map(c=>(
          <option key={c.code} value={c.code} style={{background:"#1a1030"}}>
            {c.flag} {c.code}
          </option>
        ))}
      </select>
      <input
        type="tel"
        value={local}
        onChange={e=>{
          const d=e.target.value.replace(/[^\d\s\-]/g,"").replace(/^0+/,"");
          onChange(cc+d);
        }}
        placeholder={placeholder}
        style={{...(inputStyle??{}),flex:1,minWidth:0}}
        className="rounded-lg outline-none text-white"
      />
    </div>
  );
}

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
  churnRisk:    computeChurnRisk(c),
  clv:          Math.round(Number(c.totalSpend ?? 0) * 1.8),
  points:       c.pointsBalance ?? c.currentPointsBalance ?? 0,
  tier:         c.currentTier?.name ?? (c.currentTierId ? "Member" : "Bronze"),
  referralCode: c.referralCode ?? "",
  tags:         c.tags ?? [],
});

// ════════════════════════════════════════════════════════════════
// MICRO COMPONENTS
// ════════════════════════════════════════════════════════════════
const Badge=({children,color,size="sm"}:{children?:any;color?:any;size?:any})=><span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold" style={{background:color+"22",color,border:"1px solid "+(color)+"33"}}>{children}</span>;
const KPI=({icon:Icon,label,value,change,positive,color,sub}:{icon?:any;label?:any;value?:any;change?:any;positive?:any;color?:any;sub?:any})=>(
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
  {id:"customers",icon:Users,label:"Customers & Loyalty",roles:[ROLES.OWNER,ROLES.MANAGER,ROLES.STAFF]},
  {id:"pos",icon:ShoppingCart,label:"POS",roles:[ROLES.OWNER,ROLES.MANAGER,ROLES.KITCHEN]},
  {id:"messages",icon:MessageSquare,label:"Messages",roles:[ROLES.OWNER,ROLES.MANAGER,ROLES.STAFF]},
  {id:"campaigns",icon:Send,label:"Campaigns",roles:[ROLES.OWNER,ROLES.MANAGER,ROLES.STAFF]},
  {id:"automations",icon:Zap,label:"Automations",roles:[ROLES.OWNER,ROLES.MANAGER]},
  {id:"datahub",icon:Database,label:"Data Hub",roles:[ROLES.OWNER]},
  {id:"ai",icon:Brain,label:"AI Insights",roles:[ROLES.OWNER]},
  {id:"settings",icon:Settings,label:"Settings",roles:[ROLES.OWNER]},
];
const Sidebar=({page,setPage,col,setCol,onLogout,wa,role,portalDark,setPortalDark}:any)=>{
  const {pd,setPd}=usePd();
  const NAV=NAV_ALL.filter(it=>it.roles.includes(role));
  return(
  <div className={`fixed left-0 top-0 h-full z-50 flex flex-col transition-all duration-300 ${col?"w-[72px]":"w-[240px]"}`} style={{background:portalDark?"linear-gradient(180deg,#0a0414 0%,#0d0520 60%,#0a0414 100%)":"linear-gradient(180deg,#ffffff 0%,#faf5ff 60%,#ffffff 100%)",backdropFilter:"blur(32px)",WebkitBackdropFilter:"blur(32px)",borderRight:portalDark?"1px solid rgba(139,92,246,0.12)":"1px solid rgba(139,92,246,0.18)",boxShadow:"4px 0 32px rgba(0,0,0,0.4)"}}>
    {/* Logo area */}
    <div className={`flex items-center gap-3 px-4 pt-5 pb-4 ${col?"justify-center flex-col":""}`}>
      {col
        ? <ThemeLogo dark={true} className="w-9 h-9 object-contain"/>
        : <div className="flex-1 min-w-0">
            <ThemeLogo dark={true} className="w-28 h-8 object-contain object-left"/>
            <div className="text-slate-500 text-[9px] tracking-wide uppercase mt-0.5">CRM Platform</div>
          </div>
      }
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
      <button onClick={()=>setPd(!pd)} className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs transition-all duration-200 hover:bg-violet-500/10 ${col?"justify-center":""}`} style={{color:pd?"#a78bfa":"#6d28d9"}}>
        {pd
          ? <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>
          : <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401"/></svg>
        }
        {!col&&<span>{pd?"Light Mode":"Dark Mode"}</span>}
      </button>
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
    if(biz?.currency)localStorage.setItem("biz_currency",biz.currency);
    if(biz?.logoUrl)localStorage.setItem("biz_logo",biz.logoUrl);
    if(d?.user?.role)localStorage.setItem("role",d.user.role);
    if(biz?.pointsPerPound!=null)localStorage.setItem("pointsPerPound",String(biz.pointsPerPound));
    if(biz?.visitBasePoints!=null)localStorage.setItem("visitBasePoints",String(biz.visitBasePoints));
    if(biz?.country)localStorage.setItem("biz_country",biz.country);
    if(biz?.ntn)localStorage.setItem("biz_ntn",biz.ntn);
    if(biz?.taxNumber)localStorage.setItem("biz_taxNumber",biz.taxNumber);
    if(biz?.gstRate!=null)localStorage.setItem("biz_gstRate",String(biz.gstRate));
  }catch{}
};

// ════════════════════════════════════════════════════════════════
// AUTH PAGES  (Login · Sign Up · Forgot Password)
// ════════════════════════════════════════════════════════════════
const OAUTH_ERROR_MSGS:Record<string,string>={
  google_denied:"Google sign-in was cancelled.",
  google_not_configured:"Google sign-in is not set up yet.",
  google_email_not_verified:"Your Google account email is not verified.",
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

type AuthView = "landing"|"login"|"signup"|"forgot"|"forgot-sent";

const ThemeCtx = createContext<{dark:boolean}>({dark:true});
const useTheme = ()=>useContext(ThemeCtx);

// ── Portal (CRM) theme context ────────────────────────────────────
const PortalThemeCtx = createContext<{pd:boolean;setPd:(v:boolean)=>void}>({pd:true,setPd:()=>{}});
const usePd = ()=>useContext(PortalThemeCtx);
// Hook: components call useCard() to get reactive design tokens
const useCard=()=>{ const {pd}=useContext(PortalThemeCtx); return pdTokens(pd); };
// Reactive design tokens for portal light/dark
const pdTokens=(pd:boolean)=>({
  bg:    pd?"#06040f":"#f5f3ff",
  bg2:   pd?"rgba(255,255,255,0.07)":"rgba(255,255,255,0.85)",
  card:  pd?"rgba(255,255,255,0.07)":"rgba(255,255,255,0.92)",
  bdr:   pd?"rgba(255,255,255,0.18)":"rgba(139,92,246,0.18)",
  tx:    pd?"#ffffff":"#1e1333",
  tx2:   pd?"rgba(255,255,255,0.6)":"#4b3f72",
  tx3:   pd?"rgba(255,255,255,0.35)":"#7c6fa0",
  inp:   pd?"rgba(255,255,255,0.07)":"rgba(255,255,255,0.9)",
  inpBd: pd?"rgba(255,255,255,0.15)":"rgba(139,92,246,0.25)",
  shadow:pd?"0 8px 32px rgba(0,0,0,0.25),inset 0 1px 0 rgba(255,255,255,0.25)":"0 4px 20px rgba(139,92,246,0.1)",
});

// Theme-aware brand logo — white.png on dark bg, black.png on light bg (brand spec)
function ThemeLogo({ dark, className = '', style = {} }: { dark: boolean; className?: string; style?: React.CSSProperties }) {
  return (
    <img
      src={dark ? '/white.png' : '/black.png'}
      alt="The Loyaly"
      className={className}
      style={style}
    />
  );
}

// Shows how many WhatsApp messages remain in the current plan. Renders nothing
// if billing can't be read (e.g. non-owner role) so it never blocks a send screen.
function QuotaBanner({ recipients }: { recipients?: number }) {
  const [q, setQ] = useState<{ remaining: number; total: number } | null>(null);
  useEffect(() => {
    let alive = true;
    api.billing.get().then((d: any) => {
      if (!alive) return;
      const total = d?.subscription?.monthlyMessageQuota ?? d?.tierLimits?.quota ?? 0;
      const used = d?.subscription?.messagesUsedThisPeriod ?? 0;
      const remaining = d?.quotaRemaining != null ? d.quotaRemaining : Math.max(0, total - used);
      setQ({ remaining, total });
    }).catch(() => {});
    return () => { alive = false; };
  }, []);
  if (!q || q.total <= 0) return null;
  const pct = Math.min(100, Math.round(((q.total - q.remaining) / q.total) * 100));
  const low = q.remaining <= q.total * 0.1;
  const notEnough = recipients != null && recipients > q.remaining;
  const col = notEnough || low ? "#ef4444" : pct > 80 ? "#f59e0b" : "#22c55e";
  return (
    <div className="mb-3 px-3 py-2.5 rounded-xl" style={{ background: col + "12", border: `1px solid ${col}33` }}>
      <div className="flex items-center justify-between text-xs">
        <span className="flex items-center gap-1.5 font-medium" style={{ color: col }}>
          <MessageSquare size={12} />
          {q.remaining.toLocaleString()} of {q.total.toLocaleString()} messages left this month
        </span>
        {recipients != null && <span className="text-slate-400">this send: {recipients.toLocaleString()}</span>}
      </div>
      <div className="mt-1.5 h-1.5 rounded-full" style={{ background: "rgba(255,255,255,0.08)" }}>
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: col }} />
      </div>
      {notEnough && <div className="mt-1.5 text-[10px] text-red-400">⚠ Not enough quota for {recipients.toLocaleString()} recipients — upgrade your plan or reduce the audience.</div>}
    </div>
  );
}

const AuthBg=()=>(
  <div className="absolute inset-0 overflow-hidden pointer-events-none">
    <div className="absolute top-1/4 left-1/3 w-96 h-96 rounded-full opacity-[0.06] blur-3xl" style={{background:"#8b5cf6"}}/>
    <div className="absolute bottom-1/3 right-1/4 w-80 h-80 rounded-full opacity-[0.06] blur-3xl" style={{background:"#06b6d4"}}/>
    <div className="absolute top-3/4 left-1/4 w-64 h-64 rounded-full opacity-[0.04] blur-3xl" style={{background:"#ec4899"}}/>
  </div>
);

const SocialButtons=({loading,socialLoading,onSocial}:{loading:boolean,socialLoading:"google"|null,onSocial:(p:"google")=>void})=>{
  const {dark}=useTheme();
  return(
    <div className="flex flex-col gap-3 mb-5">
      <button onClick={()=>onSocial("google")} disabled={!!socialLoading||loading}
        className="flex items-center justify-center gap-2.5 py-3 rounded-xl text-sm font-semibold transition-all hover:opacity-90 active:scale-95 disabled:opacity-50"
        style={{background:dark?"rgba(255,255,255,0.07)":"#ffffff",border:`1px solid ${dark?"rgba(255,255,255,0.12)":"rgba(0,0,0,0.1)"}`,color:dark?"white":"#374151"}}>
        {socialLoading==="google"?<RefreshCw size={16} className="animate-spin"/>:<GoogleIcon/>}
        <span>Sign in with Google</span>
      </button>
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
  const [socialLoading,setSocialLoading]=useState<"google"|null>(null);
  const [bizChoices,setBizChoices]=useState<{id:string;name:string;role:string}[]|null>(null);
  const doLogin=async(email:string,password:string,businessId?:string)=>{
    const d=await api.auth.login(email,password,businessId);
    if((d as any).requiresBusinessSelection){
      setBizChoices((d as any).businesses);
      return;
    }
    localStorage.setItem("accessToken",d.accessToken);
    if((d as any).sessionId)localStorage.setItem("sessionId",(d as any).sessionId);
    if(d.user?.id)localStorage.setItem("userId",d.user.id);
    if((d.user as any)?.businessSlug)localStorage.setItem("biz_slug",(d.user as any).businessSlug);
    if((d.user as any)?.businessName)localStorage.setItem("biz_name",(d.user as any).businessName);
    if((d.user as any)?.businessIndustry)localStorage.setItem("biz_industry",(d.user as any).businessIndustry);
    if((d.user as any)?.role)localStorage.setItem("role",(d.user as any).role);
    await hydrateFromApi();
    onLogin(d.user);
  };
  const submit=async()=>{
    if(!e||!p){setErr("Please enter your email and password.");return;}
    setErr("");setLoading(true);
    try{await doLogin(e,p);}
    catch(ex){
      const m=(ex as Error).message;
      setErr(m==="USER_NOT_FOUND"?"No account found with that email.":m==="WRONG_PASSWORD"||m==="INVALID_CREDENTIALS"?"Wrong password. Please try again.":m);
    }finally{setLoading(false);}
  };
  const {dark}=useTheme();
  const fldLbl:React.CSSProperties={display:"block",fontSize:"12px",fontWeight:600,marginBottom:"6px",color:dark?"#94a3b8":"#374151"};
  const fldInp:React.CSSProperties={background:dark?"rgba(255,255,255,0.07)":"#f9f8ff",border:`1px solid ${dark?"rgba(255,255,255,0.14)":"rgba(124,58,237,0.2)"}`,borderRadius:"10px",padding:"11px 14px",fontSize:"14px",width:"100%",outline:"none",color:dark?"white":"#1a1035"};
  if(bizChoices){
    return(
      <div>
        <p className="text-center text-sm mb-4 font-medium" style={{color:dark?"#94a3b8":"#374151"}}>Multiple workspaces found for <strong>{e}</strong>. Choose one to continue:</p>
        <div className="space-y-2 mb-4">
          {bizChoices.map(b=>(
            <button key={b.id} onClick={async()=>{setLoading(true);try{await doLogin(e,p,b.id);}catch(ex){setErr((ex as Error).message);}finally{setLoading(false);}}}
              className="w-full text-left rounded-xl px-4 py-3 transition-all"
              style={{background:dark?"rgba(255,255,255,0.07)":"#f9f8ff",border:"1px solid rgba(124,58,237,0.25)"}}>
              <div className="font-semibold text-sm" style={{color:dark?"white":"#1a1035"}}>{b.name}</div>
              <div className="text-xs mt-0.5" style={{color:dark?"#94a3b8":"#6b7280"}}>{b.role.replace(/_/g," ")}</div>
            </button>
          ))}
        </div>
        <ErrBox msg={err}/>
        <button onClick={()=>setBizChoices(null)} className="w-full text-center text-xs mt-2" style={{color:"#8b5cf6"}}>← Back</button>
      </div>
    );
  }
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
  const [socialLoading,setSocialLoading]=useState<"google"|null>(null);
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
      setErr(m==="BUSINESS_SLUG_TAKEN"?"A business with that name already exists. Try a different name.":m==="USER_ALREADY_EXISTS_IN_BUSINESS"||m==="EMAIL_ALREADY_REGISTERED"?"This email is already registered. Please log in instead.":m);
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

// Scroll-reveal wrapper — fades + slides children in when they enter the viewport.
const Reveal=({children,delay=0,y=24,className="",style={}}:{children:React.ReactNode;delay?:number;y?:number;className?:string;style?:React.CSSProperties})=>{
  const ref=useRef<HTMLDivElement>(null);
  const [shown,setShown]=useState(false);
  useEffect(()=>{
    const el=ref.current;if(!el)return;
    if(typeof IntersectionObserver==="undefined"){setShown(true);return;}
    const io=new IntersectionObserver((entries)=>{
      entries.forEach(e=>{if(e.isIntersecting){setShown(true);io.disconnect();}});
    },{threshold:0.12,rootMargin:"0px 0px -40px 0px"});
    io.observe(el);return()=>io.disconnect();
  },[]);
  return <div ref={ref} className={className} style={{...style,opacity:shown?1:0,transform:shown?"translateY(0)":`translateY(${y}px)`,transition:`opacity .6s cubic-bezier(.16,1,.3,1) ${delay}ms, transform .6s cubic-bezier(.16,1,.3,1) ${delay}ms`,willChange:"opacity,transform"}}>{children}</div>;
};

const LandingPage=({onLogin}:{onLogin:(u:any)=>void})=>{
  const [view,setView]=useState<AuthView>("landing");
  const [dark,setDark]=useState(()=>{
    // Default to dark; only go light if user explicitly chose it
    const saved=localStorage.getItem("site_dark");
    return saved===null||saved==="true";
  });
  useEffect(()=>{localStorage.setItem("site_dark",String(dark));},[dark]);
  const [mobileNav,setMobileNav]=useState(false);
  const [pricingYearly,setPricingYearly]=useState(false);
  const [testimonialIdx,setTestimonialIdx]=useState(0);
  const [faqOpen,setFaqOpen]=useState<number|null>(null);

  const D=dark;
  const bg    = D?"#09090b":"#ffffff";
  const bg2   = D?"#0f0f17":"#f8fafc";
  const card  = D?"rgba(255,255,255,0.04)":"#ffffff";
  const tx    = D?"#ffffff":"#0f172a";
  const tx2   = D?"#94a3b8":"#64748b";
  const tx3   = D?"#64748b":"#94a3b8";
  const bdr   = D?"#1e293b":"#e2e8f0";
  const inpBg = D?"rgba(255,255,255,0.07)":"#f9f8ff";
  const inpBd = D?"rgba(255,255,255,0.14)":"rgba(124,58,237,0.2)";
  const navBg = D?"rgba(9,9,11,0.88)":"rgba(255,255,255,0.88)";
  const secPillBg  = D?"#0f172a":"#f8fafc";
  const secPillBdr = D?"#334155":"#cbd5e1";
  const secPillTx  = D?"#818cf8":"#4f46e5";

  const LS_FEATURES=[
    {icon:<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/></svg>,title:"QR Check-In",desc:"Instant QR scanning for seamless customer check-ins."},
    {icon:<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>,title:"Loyalty Programs",desc:"Create membership tiers and reward loyal customers."},
    {icon:<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="2" width="16" height="20" rx="2"/><line x1="8" y1="6" x2="16" y2="6"/><line x1="8" y1="10" x2="10" y2="10"/><line x1="14" y1="10" x2="16" y2="10"/><line x1="8" y1="14" x2="10" y2="14"/><line x1="14" y1="14" x2="16" y2="14"/><line x1="8" y1="18" x2="13" y2="18"/></svg>,title:"Built-in POS",desc:"Take payments at the counter and let customers pay with loyalty points — bill adjusts automatically."},
    {icon:<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>,title:"Points System",desc:"Reward points automatically for every visit or purchase."},
    {icon:<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>,title:"Coupons & Offers",desc:"Create powerful discount coupons and exclusive offers."},
    {icon:<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>,title:"Automated Campaigns",desc:"WhatsApp and email campaigns on autopilot."},
    {icon:<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>,title:"Customer Timeline",desc:"Full history of every customer interaction and visit."},
    {icon:<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16z"/><path d="M12 8v4l3 3"/><path d="M3.05 11a9 9 0 1 0 .5-2.6"/></svg>,title:"AI Segmentation",desc:"Smart audience segments to target the right customers."},
    {icon:<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>,title:"Birthday Rewards",desc:"Automated birthday messages and rewards that delight."},
    {icon:<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>,title:"Referral Program",desc:"Turn your customers into brand ambassadors."},
    {icon:<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>,title:"Analytics & Reports",desc:"Real-time insights and reports to grow your business."},
    {icon:<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>,title:"Multi-Location",desc:"Manage all your locations from a single dashboard."},
    {icon:<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>,title:"Staff Management",desc:"Role-based access and permissions for your entire team."},
    {icon:<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>,title:"Review Management",desc:"Collect reviews and build your online reputation."},
    {icon:<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>,title:"Mobile App",desc:"Customers view points and redeem rewards on their phone."},
  ];

  const STEPS=[
    {icon:<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>,n:"Customer Visits",d:"Customer walks into your business."},
    {icon:<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/></svg>,n:"Scans QR Code",d:"They scan to check in instantly."},
    {icon:<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/><path d="M7 8h2m2 0h2m2 0h2M7 11h1m3 0h1"/></svg>,n:"Built-in POS",d:"Staff process orders on the built-in POS."},
    {icon:<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>,n:"Earns Points",d:"Points are credited automatically."},
    {icon:<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>,n:"Redeems Rewards",d:"They claim discounts and rewards."},
    {icon:<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a10 10 0 1 0 10 10"/><path d="M12 8v4l3 3"/><path d="M18 2v4h4"/></svg>,n:"AI Win-Back",d:"The Loyaly auto-detects at-risk customers and sends them personalised discount offers."},
    {icon:<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>,n:"Comes Back",d:"They return — every time, guaranteed."},
  ];

  const INDUSTRIES=[
    {icon:<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 11l19-9-9 19-2-8-8-2z"/></svg>,l:"Restaurants"},
    {icon:<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8h1a4 4 0 0 1 0 8h-1"/><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/><line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/></svg>,l:"Cafés"},
    {icon:<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22C6.477 22 2 17.523 2 12S6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z"/><path d="M12 8v4l3 3"/></svg>,l:"Dessert Shops"},
    {icon:<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>,l:"Salons"},
    {icon:<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/></svg>,l:"Barbers"},
    {icon:<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 20V10"/><path d="M12 20V4"/><path d="M6 20v-6"/></svg>,l:"Gyms"},
    {icon:<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>,l:"Retail Stores"},
    {icon:<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>,l:"Car Washes"},
    {icon:<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>,l:"Clinics"},
    {icon:<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>,l:"Spas"},
  ];

  const TESTIMONIALS=[
    {stars:5,text:"The Loyaly increased our repeat customers by 60%. The WhatsApp campaigns and rewards system work like magic!!!!",name:"Michael Brown",biz:"Casa Bistro",avatar:"MB"},
    {stars:5,text:"Finally, a loyalty platform that is simple, powerful and affordable. Our customers love the rewards!",name:"Sarah Johnson",biz:"The Coffee House",avatar:"SJ"},
    {stars:5,text:"The analytics help us understand our customers better. Our business has grown 35% since using The Loyaly.",name:"James Williams",biz:"Urban Cuts Barbershop",avatar:"JW"},
  ];

  // Emotional, story-driven case studies
  const CASE_STUDIES=[
    {emoji:"☕",biz:"The Corner Café",owner:"Amara",city:"Manchester",color:"#8b5cf6",
      stat:"+62%",statLabel:"repeat visits in 4 months",
      story:"Amara nearly closed her café after the chain across the street opened. The Loyaly helped her remember every regular's name and order. When her quietest customers drifted away, automatic 'we miss you' messages with a free-coffee reward brought them back. Today her café is the busiest on the street again.",
      result:"From 30 to 480 loyal regulars — and a 6-month waitlist for her weekend brunch."},
    {emoji:"💈",biz:"Kingsman Barbers",owner:"Deon",city:"Birmingham",color:"#06b6d4",
      stat:"3,200",statLabel:"bookings recovered",
      story:"Deon's chairs sat empty on weekdays. He couldn't afford ads. With The Loyaly, every haircut earned points and a friendly WhatsApp reminder when it was time for the next trim. Clients who used to vanish for months now come back every three weeks — like clockwork.",
      result:"£41,000 in extra revenue in a single year, with zero ad spend."},
    {emoji:"🍰",biz:"Sweet Layla's Bakery",owner:"Layla",city:"London",color:"#ec4899",
      stat:"4.9★",statLabel:"average review, up from 3.8",
      story:"Layla poured her heart into every cake, but unhappy customers stayed silent and never returned. The Loyaly quietly asked each customer how their visit went. Now she hears the problems first — and fixes them before they ever hit Google. Her happiest customers became her loudest fans.",
      result:"Reviews jumped from 3.8 to 4.9 stars and online orders tripled."},
    {emoji:"🏋️",biz:"Iron Pulse Gym",owner:"Marcus",city:"Leeds",color:"#f59e0b",
      stat:"-48%",statLabel:"member drop-off",
      story:"Half of Marcus's New Year members quit by March. The Loyaly spotted who was slipping — people who hadn't checked in for two weeks — and nudged them with a personal message and a guest-pass for a friend. Members felt noticed. They stayed. They brought friends.",
      result:"Cancellations cut in half and 900 referrals from existing members."},
    {emoji:"💅",biz:"Bloom Nail Studio",owner:"Priya",city:"Glasgow",color:"#a855f7",
      stat:"+£28k",statLabel:"yearly revenue",
      story:"Priya's calendar had gaps she couldn't explain. The Loyaly showed her that clients loved her but simply forgot to rebook. A gentle birthday treat and a 'your nails are due' reminder filled those empty slots. Her quietest weeks became fully booked.",
      result:"From half-empty Tuesdays to a fully-booked studio, six days a week."},
    {emoji:"🍔",biz:"Smashville Burgers",owner:"Tom & Jess",city:"Bristol",color:"#22c55e",
      stat:"19,000",statLabel:"loyalty members",
      story:"Tom and Jess ran a tiny burger joint with big dreams. Every order added a customer to their loyalty list automatically — no apps, no plastic cards. When they launched a new menu, one WhatsApp campaign sold it out by lunchtime. Their customers feel like part of the family.",
      result:"A second location opened, funded entirely by repeat customers."},
    {emoji:"🌸",biz:"Serenity Day Spa",owner:"Hannah",city:"Edinburgh",color:"#14b8a6",
      stat:"+71%",statLabel:"rebooking rate",
      story:"Hannah's spa was a place people visited once for a treat and forgot about. The Loyaly turned that one visit into a relationship — points, tiers, and a thank-you message that felt personal. First-timers became monthly regulars who looked forward to their 'me time'.",
      result:"7 in 10 first-time guests now return within 30 days."},
    {emoji:"🛍️",biz:"Thread & Co Boutique",owner:"Olivia",city:"Cardiff",color:"#f43f5e",
      stat:"2.4×",statLabel:"customer lifetime value",
      story:"Olivia competed with giant online retailers and felt invisible. The Loyaly gave her something Amazon never could — a real connection. Early access to new arrivals for her VIPs made shoppers feel special. They stopped scrolling online and started coming in.",
      result:"Loyal shoppers now spend more than double what walk-ins do."},
    {emoji:"🍕",biz:"Nonna's Pizzeria",owner:"Giovanni",city:"Liverpool",color:"#ef4444",
      stat:"+340",statLabel:"orders every month",
      story:"Giovanni's family recipes deserved a full house. The Loyaly helped him reward every tenth pizza and win back families who hadn't ordered in a while. 'Friday is pizza night' became a habit for hundreds of homes — all from one weekly WhatsApp.",
      result:"Friday revenue doubled and delivery orders now book out by 7pm."},
    {emoji:"🚗",biz:"ShinePro Car Wash",owner:"Ben",city:"Newcastle",color:"#3b82f6",
      stat:"5,800",statLabel:"members in year one",
      story:"Ben's car wash was a one-time stop for most drivers. The Loyaly turned it into a habit — a loyalty card on every phone and a reminder when the rain stopped. Drivers who came once a year now come once a month, rain or shine.",
      result:"Membership revenue now covers his rent before the month even starts."},
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
        <p className="text-sm mb-6" style={{color:tx2}}>Sign in to your The Loyaly account</p>
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
            <button onClick={()=>setView("landing")} className="mb-12">
              <img src="/white.png" alt="The Loyaly" className="h-9 w-auto object-contain"/>
            </button>
            <h1 className="text-3xl font-black text-white mb-3 leading-tight">
              {view==="signup"?"Create Your The Loyaly Account":"Welcome Back to The Loyaly"}
            </h1>
            <p className="text-purple-200 text-sm mb-8 leading-relaxed">Join thousands of businesses that are turning one-time customers into loyal customers.</p>
            {[
              {icon:<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>,t:"Grow Your Customers",d:"Track visits, understand behavior and build stronger relationships."},
              {icon:<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>,t:"Reward Loyalty",d:"Points, tiers, and exclusive rewards that keep customers coming back."},
              {icon:<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>,t:"Automate & Save Time",d:"Send automated WhatsApp messages, birthday wishes and win-back campaigns."},
              {icon:<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>,t:"Powerful Insights",d:"Real-time analytics and AI insights to grow your business smarter."},
            ].map((f,i)=>(
              <div key={i} className="flex gap-3 mb-5">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 text-white" style={{background:"rgba(255,255,255,0.15)"}}>{f.icon}</div>
                <div>
                  <div className="text-white font-semibold text-sm">{f.t}</div>
                  <div className="text-purple-200 text-xs mt-0.5 leading-relaxed">{f.d}</div>
                </div>
              </div>
            ))}
          </div>
          {/* Dashboard mockup preview */}
          <div className="relative z-10 mt-6 rounded-2xl overflow-hidden shadow-2xl" style={{background:"rgba(255,255,255,0.12)",border:"1px solid rgba(255,255,255,0.2)"}}>
            <div className="flex items-center gap-2 px-4 py-3 border-b" style={{borderColor:"rgba(255,255,255,0.1)"}}>
              <img src="/white.png" alt="" className="w-5 h-5 object-contain"/>
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
            <button onClick={()=>setView("landing")} className="lg:hidden">
              <ThemeLogo dark={dark} className="h-7 w-auto object-contain"/>
            </button>
            <div className="lg:ml-auto flex items-center gap-2">
              {view==="signup"&&<><span className="text-sm" style={{color:tx2}}>Already have an account?</span><button onClick={()=>nav("login")} className="text-sm font-semibold" style={{color:"#7c3aed"}}>Log in</button></>}
              {view==="login"&&<><span className="text-sm" style={{color:tx2}}>New to The Loyaly?</span><button onClick={()=>nav("signup")} className="text-sm font-semibold" style={{color:"#7c3aed"}}>Sign up free</button></>}
              {(view==="forgot"||view==="forgot-sent")&&<button onClick={()=>nav("login")} className="text-sm font-semibold flex items-center gap-1" style={{color:"#7c3aed"}}><ArrowLeft size={13}/>Back to login</button>}
            </div>
          </div>
          <div className="flex-1 flex items-center justify-center px-6 py-10">
            <div className="w-full max-w-md">
              <AuthFormCard/>
            </div>
          </div>
          <div className="px-6 py-4 text-center text-xs" style={{color:tx3}}>
            By signing up, you agree to our <a href="/terms" target="_blank" rel="noopener noreferrer" className="underline" style={{color:"#7c3aed"}}>Terms &amp; Conditions</a> and <a href="/terms" target="_blank" rel="noopener noreferrer" className="underline" style={{color:"#7c3aed"}}>Privacy Policy</a>
          </div>
        </div>
      </div>
      </ThemeCtx.Provider>
    );
  }

  // ── Full marketing landing page (PrebuiltUI template design) ───
  const FAQS=[
    {q:"What is The Loyaly?",a:"The Loyaly is an all-in-one WhatsApp-first loyalty and customer retention platform. It lets businesses track visits, reward customers with points, automate WhatsApp campaigns, and grow repeat revenue — without technical knowledge."},
    {q:"Is there a free trial available?",a:"Yes! We offer a 14-day free trial with full access to all features. No credit card is required to start."},
    {q:"Can I change my subscription plan later?",a:"Absolutely. You can upgrade or downgrade your plan at any time from your account settings. Changes take effect immediately."},
    {q:"How do customers earn and redeem points?",a:"Customers scan your QR code at each visit or purchase. Points are credited automatically. They can redeem points via the customer portal or directly through staff for discounts and rewards."},
    {q:"Do I need technical knowledge to set up The Loyaly?",a:"No. The Loyaly is designed for non-technical business owners. Setup takes under 2 minutes — connect WhatsApp, add your QR code, and you are live."},
    {q:"Is my customer data secure?",a:"Yes. All data is encrypted, stored securely, and GDPR-compliant. Each business account is fully isolated — your data is never shared with other tenants."},
  ];
  return(
    <ThemeCtx.Provider value={{dark}}>
    <div className="min-h-screen overflow-x-hidden" style={{background:bg,color:tx}}>

      {/* ── Marquee keyframes ─────────────────────────────── */}
      <style>{`
        @keyframes lyl-marquee{0%{transform:translateX(0)}100%{transform:translateX(-50%)}}
        @keyframes lyl-steps{0%{transform:translateX(0)}100%{transform:translateX(-50%)}}
        .lyl-steps-track:hover{animation-play-state:paused}
        .lyl-track{display:flex;width:max-content;animation:lyl-marquee 28s linear infinite;}
        .lyl-track:hover{animation-play-state:paused}
        @keyframes lyl-cube-spin{0%{transform:rotateX(15deg) rotateY(0deg)}100%{transform:rotateX(15deg) rotateY(360deg)}}
        @keyframes lyl-cube-float{0%,100%{transform:translateY(0px) rotateX(15deg) rotateY(0deg)}50%{transform:translateY(-16px) rotateX(15deg) rotateY(180deg)}}
        @keyframes lyl-cs-marquee{0%{transform:translateX(0)}100%{transform:translateX(-50%)}}
        .lyl-cs-track{display:flex;width:max-content;gap:20px;animation:lyl-cs-marquee 60s linear infinite}
        .lyl-cs-track:hover{animation-play-state:paused}
        @keyframes lyl-pulse-ring{0%{transform:scale(.9);opacity:.7}70%{transform:scale(1.3);opacity:0}100%{opacity:0}}
        @keyframes lyl-shimmer{0%{background-position:-200% 0}100%{background-position:200% 0}}
        .lyl-grad-text{background:linear-gradient(90deg,#8b5cf6,#ec4899,#06b6d4,#8b5cf6);background-size:200% auto;-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;animation:lyl-shimmer 6s linear infinite}
        @media (prefers-reduced-motion: reduce){.lyl-cs-track,.lyl-track,.lyl-steps-track,.lyl-cube,.lyl-grad-text{animation:none !important}}
        .lyl-cube{width:90px;height:90px;transform-style:preserve-3d;animation:lyl-cube-float 12s ease-in-out infinite;position:relative}
        .lyl-cube-face{position:absolute;width:90px;height:90px;border:1px solid rgba(167,139,250,0.4);background:linear-gradient(135deg,rgba(139,92,246,0.08),rgba(109,40,217,0.04))}
        .lyl-cube-face.front {transform:translateZ(45px)}
        .lyl-cube-face.back  {transform:rotateY(180deg) translateZ(45px)}
        .lyl-cube-face.left  {transform:rotateY(-90deg) translateZ(45px)}
        .lyl-cube-face.right {transform:rotateY(90deg)  translateZ(45px)}
        .lyl-cube-face.top   {transform:rotateX(90deg)  translateZ(45px)}
        .lyl-cube-face.bottom{transform:rotateX(-90deg) translateZ(45px)}
      `}</style>

      {/* ── Navbar ──────────────────────────────────────────── */}
      <nav className="flex items-center justify-between fixed z-50 top-0 w-full px-6 md:px-16 lg:px-24 py-4" style={{backdropFilter:"blur(20px)",WebkitBackdropFilter:"blur(20px)",background:navBg,borderBottom:`1px solid ${bdr}`}}>
        <button onClick={()=>nav("landing")} className="flex items-center flex-shrink-0">
          <ThemeLogo dark={dark} className="h-7 w-auto object-contain"/>
        </button>

        {/* Desktop nav links */}
        <div className="hidden md:flex items-center gap-8 lg:gap-12">
          {["home","features"].map(l=>(
            <a key={l} href={`#${l}`} className="text-sm capitalize font-medium transition-opacity hover:opacity-70" style={{color:tx2}}>{l}</a>
          ))}
          <a href="#how-it-works" className="text-sm font-medium transition-opacity hover:opacity-70" style={{color:tx2}}>How it Works</a>
          <a href="#stories" className="text-sm font-medium transition-opacity hover:opacity-70" style={{color:tx2}}>Stories</a>
          <a href="#pricing" className="text-sm font-medium transition-opacity hover:opacity-70" style={{color:tx2}}>Pricing</a>
        </div>

        {/* Desktop right actions */}
        <div className="flex items-center gap-3 md:gap-4">
          <button onClick={()=>setDark(!dark)} className="flex items-center justify-center size-9 rounded-full transition-colors" style={{background:D?"rgba(255,255,255,0.1)":"rgba(15,23,42,0.06)"}} title="Toggle theme">
            {D
              ? <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{color:tx2}}><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>
              : <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{color:tx2}}><path d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401"/></svg>
            }
          </button>
          <button onClick={()=>nav("login")} className="hidden md:block px-4 py-2 rounded-md text-sm font-medium border transition-colors hover:opacity-80" style={{borderColor:"#8b5cf6",color:tx}}>Sign in</button>
          <button onClick={()=>nav("signup")} className="px-4 py-2 rounded-md text-sm font-medium text-white transition-colors hover:opacity-90" style={{background:"#8b5cf6"}}>Get started</button>
          <button className="md:hidden" onClick={()=>setMobileNav(!mobileNav)} style={{color:tx}}>{mobileNav?<X size={22}/>:<Menu size={22}/>}</button>
        </div>

        {/* Mobile drawer */}
        {mobileNav&&(
          <div className="fixed inset-0 flex flex-col items-center justify-center gap-6 text-lg font-medium md:hidden transition duration-300 z-[100]" style={{background:D?"rgba(9,9,11,0.97)":"rgba(255,255,255,0.97)",backdropFilter:"blur(12px)"}}>
            {["home","features","stories","pricing"].map(l=>(
              <a key={l} href={`#${l}`} onClick={()=>setMobileNav(false)} className="capitalize transition-opacity hover:opacity-70" style={{color:tx}}>{l}</a>
            ))}
            <a href="#how-it-works" onClick={()=>setMobileNav(false)} style={{color:tx}}>How it Works</a>
            <button onClick={()=>{setMobileNav(false);nav("login");}} className="transition-opacity hover:opacity-70" style={{color:tx}}>Sign in</button>
            <button onClick={()=>{setMobileNav(false);nav("signup");}} className="px-8 py-2.5 rounded-md text-white text-base font-medium" style={{background:"#8b5cf6"}}>Get started</button>
            <button onClick={()=>setMobileNav(false)} className="aspect-square size-10 flex items-center justify-center text-white rounded-md" style={{background:"#8b5cf6"}}><X size={20}/></button>
          </div>
        )}
      </nav>

      {/* ── Hero ────────────────────────────────────────────── */}
      <div id="home" className="flex flex-col items-center justify-center text-center px-4 pt-36 pb-20 relative overflow-hidden">
        {/* Gradient bg blobs */}
        <div className="absolute inset-0 pointer-events-none" style={{background:D?"radial-gradient(ellipse 80% 60% at 50% -10%,rgba(139,92,246,0.25) 0%,transparent 70%)":"radial-gradient(ellipse 80% 60% at 50% -10%,rgba(139,92,246,0.12) 0%,transparent 70%)"}}/>
        <div className="absolute inset-0 pointer-events-none" style={{background:D?"radial-gradient(ellipse 40% 30% at 80% 60%,rgba(79,70,229,0.1) 0%,transparent 60%)":"radial-gradient(ellipse 40% 30% at 80% 60%,rgba(79,70,229,0.06) 0%,transparent 60%)"}}/>

        {/* Neon rotating cube — left */}
        <div className="absolute pointer-events-none" style={{left:"5%",top:"18%",perspective:"500px",opacity:D?0.65:0.35}}>
          <div className="lyl-cube" style={{filter:"drop-shadow(0 0 12px rgba(139,92,246,0.6))"}}>
            {["front","back","left","right","top","bottom"].map(f=><div key={f} className={`lyl-cube-face ${f}`}/>)}
          </div>
        </div>
        {/* Neon rotating cube — right (smaller, offset animation) */}
        <div className="absolute pointer-events-none" style={{right:"5%",top:"38%",perspective:"500px",opacity:D?0.5:0.3}}>
          <div style={{width:60,height:60,transformStyle:"preserve-3d",animation:"lyl-cube-float 16s ease-in-out infinite reverse",position:"relative",filter:"drop-shadow(0 0 10px rgba(109,40,217,0.5))"}}>
            {["front","back","left","right","top","bottom"].map(f=>(
              <div key={f} className={`lyl-cube-face ${f}`} style={{width:60,height:60,transform:{front:"translateZ(30px)",back:"rotateY(180deg) translateZ(30px)",left:"rotateY(-90deg) translateZ(30px)",right:"rotateY(90deg) translateZ(30px)",top:"rotateX(90deg) translateZ(30px)",bottom:"rotateX(-90deg) translateZ(30px)"}[f]}}/>
            ))}
          </div>
        </div>

        {/* Social proof pill */}
        <div className="relative flex flex-wrap items-center justify-center gap-3 p-1.5 pr-5 mb-6 rounded-full border" style={{border:`1px solid ${bdr}`,background:D?"rgba(255,255,255,0.06)":"rgba(255,255,255,0.8)"}}>
          <div className="flex items-center -space-x-2.5">
            {[["#8b5cf6","MB"],["#06b6d4","SJ"],["#ec4899","JW"]].map(([c,initials],i)=>(
              <div key={i} className="size-7 rounded-full flex items-center justify-center text-white text-[9px] font-bold ring-2" style={{background:c,["--tw-ring-color" as any]:bg}}>{initials}</div>
            ))}
          </div>
          <p className="text-xs font-medium" style={{color:tx2}}>Trusted by 1,000+ businesses worldwide</p>
        </div>

        {/* Headline */}
        <h1 className="mt-2 text-4xl sm:text-5xl md:text-[64px] font-black leading-tight max-w-3xl tracking-tight px-2" style={{color:tx}}>
          Turn One-Time Customers Into{" "}
          <span style={{background:"linear-gradient(135deg,#8b5cf6,#6d28d9)",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent"}}>Loyal Customers</span>
        </h1>
        <p className="text-base mt-4 max-w-lg leading-relaxed" style={{color:tx2}}>
          The Loyaly helps businesses track visits, reward loyalty, automate WhatsApp marketing and bring customers back — all in one powerful platform.
        </p>

        {/* CTA buttons */}
        <div className="flex flex-wrap items-center justify-center gap-4 mt-8">
          <button onClick={()=>nav("signup")} className="px-7 h-11 rounded-md text-sm font-semibold text-white transition-opacity hover:opacity-90 shadow-lg" style={{background:"#8b5cf6"}}>Get started free</button>
          <button className="flex items-center gap-2 h-11 px-7 rounded-md text-sm font-medium border transition-opacity hover:opacity-70" style={{borderColor:"#8b5cf6",color:tx2}}>
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5"/><rect x="2" y="6" width="14" height="12" rx="2"/></svg>
            <span>Watch demo</span>
          </button>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-5 mt-5 text-xs" style={{color:tx3}}>
          {["14-Day Free Trial","No Credit Card","Setup in 2 Minutes"].map(l=>(
            <span key={l} className="flex items-center gap-1.5"><Check size={12} className="text-violet-500"/>{l}</span>
          ))}
        </div>

        {/* Dashboard mockup */}
        <div className="relative mt-16 w-full max-w-4xl mx-auto">
          <div className="absolute -inset-4 rounded-3xl opacity-20 blur-3xl" style={{background:"linear-gradient(135deg,#8b5cf6,#7c3aed)"}}/>
          <div className="relative rounded-2xl overflow-hidden shadow-2xl border" style={{background:D?"#111118":"#ffffff",borderColor:bdr}}>
            <div className="flex items-center gap-2 px-4 py-3 border-b" style={{background:D?"rgba(255,255,255,0.03)":"#f8fafc",borderColor:bdr}}>
              <img src={D?'/white.png':'/black.png'} alt="" className="w-4 h-4 object-contain"/>
              <span className="font-bold text-xs" style={{color:tx}}>Dashboard</span>
              <div className="ml-auto flex items-center gap-2"><span className="text-xs" style={{color:tx2}}>Davita ▾</span><div className="w-6 h-6 rounded-full" style={{background:"linear-gradient(135deg,#8b5cf6,#7c3aed)"}}/></div>
            </div>
            <div className="p-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
                {[{l:"Total Customers",v:"12,458",c:"+12.5%"},{l:"Active Customers",v:"8,215",c:"+8.3%"},{l:"Repeat Customers",v:"6,125",c:"+15.2%"},{l:"Revenue Recovered",v:"£23,560",c:"+18.7%"}].map((k,i)=>(
                  <div key={i} className="rounded-xl p-3 border" style={{background:D?"rgba(255,255,255,0.04)":"#f8fafc",borderColor:bdr}}>
                    <div className="text-[9px] mb-1" style={{color:tx3}}>{k.l}</div>
                    <div className="font-bold text-sm" style={{color:tx}}>{k.v}</div>
                    <div className="text-[9px] text-emerald-500 font-semibold">{k.c}</div>
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl p-3 border" style={{background:D?"rgba(255,255,255,0.02)":"#f8fafc",borderColor:bdr}}>
                  <div className="text-xs font-semibold mb-2" style={{color:tx}}>Visits Overview</div>
                  <div className="h-16 flex items-end gap-1">
                    {[40,55,35,70,50,85,60,75,45,90,65,80].map((h,i)=>(
                      <div key={i} className="flex-1 rounded-sm" style={{height:`${h}%`,background:"linear-gradient(to top,#8b5cf6,#a78bfa)",opacity:0.7}}/>
                    ))}
                  </div>
                </div>
                <div className="rounded-xl p-3 border" style={{background:D?"rgba(255,255,255,0.02)":"#f8fafc",borderColor:bdr}}>
                  <div className="text-xs font-semibold mb-2" style={{color:tx}}>Top Campaigns</div>
                  {[{l:"Birthday Offer",w:75,c:"#8b5cf6"},{l:"Weekend Promo",w:55,c:"#06b6d4"},{l:"Win-Back",w:35,c:"#ec4899"},{l:"New Menu",w:20,c:"#f59e0b"}].map((b,i)=>(
                    <div key={i} className="mb-1.5">
                      <div className="text-[9px] mb-0.5" style={{color:tx3}}>{b.l}</div>
                      <div className="h-1.5 rounded-full" style={{background:D?"rgba(255,255,255,0.06)":"#ede9fe"}}><div className="h-full rounded-full" style={{width:`${b.w}%`,background:b.c}}/></div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
          {/* Floating loyalty points card */}
          <div className="absolute -bottom-4 -left-4 w-36 rounded-2xl p-3 shadow-xl border hidden sm:block" style={{background:"linear-gradient(135deg,#7c3aed,#8b5cf6)",borderColor:"rgba(255,255,255,0.2)"}}>
            <div className="flex items-center gap-1.5 mb-2"><div className="w-4 h-4 rounded-md" style={{background:"rgba(255,255,255,0.25)"}}/><span className="text-white text-[9px] font-bold">The Loyaly</span></div>
            <div className="text-white font-black text-lg">2,450</div>
            <div className="text-purple-200 text-[9px]">Loyalty Points</div>
            <div className="mt-2 h-1 rounded-full" style={{background:"rgba(255,255,255,0.2)"}}><div className="h-full w-3/4 rounded-full" style={{background:"rgba(255,255,255,0.7)"}}/></div>
          </div>
        </div>

        {/* Marquee logos */}
        <h3 className="text-sm text-center mt-20 mb-6 font-medium" style={{color:tx3}}>Trusted by leading businesses, including —</h3>
        <div className="overflow-hidden w-full relative max-w-4xl mx-auto select-none">
          <div className="absolute left-0 top-0 h-full w-20 z-10 pointer-events-none" style={{background:`linear-gradient(to right, ${bg}, transparent)`}}/>
          <div className="lyl-track">
            {[...BRANDS,...BRANDS,...BRANDS,...BRANDS].map((b,i)=>(
              <span key={i} className="mx-10 text-sm font-black tracking-tight whitespace-nowrap" style={{color:tx,opacity:0.35}}>{b}</span>
            ))}
          </div>
          <div className="absolute right-0 top-0 h-full w-20 z-10 pointer-events-none" style={{background:`linear-gradient(to left, ${bg}, transparent)`}}/>
        </div>
      </div>

      {/* ── Features ────────────────────────────────────────── */}
      <div id="features" className="text-center px-4 py-20">
        <p className="inline-block font-medium px-10 py-2 rounded-full border text-sm mb-4" style={{background:secPillBg,border:`1px solid ${secPillBdr}`,color:secPillTx}}>Features</p>
        <h2 className="text-3xl font-black text-center mx-auto mt-1" style={{color:tx}}>Everything You Need to Build Loyalty</h2>
        <p className="mt-2 max-w-xl mx-auto text-sm" style={{color:tx2}}>All the tools you need to engage, reward and retain your customers — in one platform.</p>
        <div className="mt-12 max-w-6xl mx-auto" style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:"16px"}}>
          {LS_FEATURES.map((f,i)=>(
            <div key={i} className="rounded-xl border text-left transition-all hover:shadow-md hover:-translate-y-0.5" style={{border:`1px solid ${bdr}`,background:card,padding:"22px",display:"flex",flexDirection:"column",gap:"12px"}}>
              <div className="rounded-xl flex items-center justify-center" style={{width:"40px",height:"40px",background:D?"rgba(139,92,246,0.15)":"#ede9fe",color:"#8b5cf6"}}>{f.icon}</div>
              <h3 className="font-semibold" style={{color:tx,fontSize:"14px"}}>{f.title}</h3>
              <p className="leading-relaxed" style={{color:tx2,fontSize:"12px"}}>{f.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ── How it Works ────────────────────────────────────── */}
      <div id="how-it-works" className="py-20 px-4" style={{background:bg2}}>
        <div className="max-w-5xl mx-auto text-center">
          <p className="inline-block font-medium px-10 py-2 rounded-full border text-sm mb-4" style={{background:secPillBg,border:`1px solid ${secPillBdr}`,color:secPillTx}}>How It Works</p>
          <h2 className="text-3xl font-black mt-1 mb-2" style={{color:tx}}>How The Loyaly Works</h2>
          <p className="text-sm mb-10" style={{color:tx2}}>From first visit to loyal customer — fully automated in 7 simple steps.</p>
          <div className="relative overflow-hidden w-full">
            <div className="absolute left-0 top-0 h-full w-16 z-10 pointer-events-none" style={{background:`linear-gradient(to right,${bg2},transparent)`}}/>
            <div className="absolute right-0 top-0 h-full w-16 z-10 pointer-events-none" style={{background:`linear-gradient(to left,${bg2},transparent)`}}/>
            <div style={{display:"flex",width:"max-content",animation:"lyl-steps 28s linear infinite"}} className="lyl-steps-track">
              {[...STEPS,...STEPS].map((s,i)=>(
                <div key={i} style={{display:"flex",alignItems:"center",gap:"0",flexShrink:0}}>
                  <div style={{display:"flex",flexDirection:"column",alignItems:"center",width:130,padding:"0 8px"}}>
                    <div style={{fontSize:10,fontWeight:700,marginBottom:6,color:"#a78bfa",letterSpacing:"0.08em"}}>0{(i%STEPS.length)+1}</div>
                    <div style={{width:56,height:56,borderRadius:16,display:"flex",alignItems:"center",justifyContent:"center",background:"linear-gradient(135deg,#8b5cf6,#7c3aed)",color:"white",boxShadow:"0 4px 20px rgba(139,92,246,0.4)"}}>{s.icon}</div>
                    <div style={{fontSize:12,fontWeight:700,marginTop:10,textAlign:"center",color:tx,lineHeight:1.3}}>{s.n}</div>
                    <div style={{fontSize:10,textAlign:"center",marginTop:4,color:tx2,lineHeight:1.4,maxWidth:110}}>{s.d}</div>
                  </div>
                  {(i%STEPS.length)<STEPS.length-1&&(
                    <div style={{display:"flex",alignItems:"center",marginTop:-40,flexShrink:0}}>
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#8b5cf6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" opacity="0.6"><polyline points="9 18 15 12 9 6"/></svg>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
          <button onClick={()=>nav("signup")} className="mt-10 px-6 py-3 rounded-md text-sm font-semibold text-white transition-opacity hover:opacity-90" style={{background:"#8b5cf6"}}>Get Started Free</button>
        </div>
      </div>

      {/* ── Industries ──────────────────────────────────────── */}
      <div className="py-20 px-4 text-center">
        <p className="inline-block font-medium px-10 py-2 rounded-full border text-sm mb-4" style={{background:secPillBg,border:`1px solid ${secPillBdr}`,color:secPillTx}}>Industries</p>
        <h2 className="text-3xl font-black mt-1 mb-2" style={{color:tx}}>Perfect for Every Business</h2>
        <p className="text-sm max-w-md mx-auto" style={{color:tx2}}>From restaurants to gyms, The Loyaly works for any business that wants loyal customers.</p>
        <div className="flex flex-wrap justify-center gap-8 mt-12 max-w-3xl mx-auto">
          {INDUSTRIES.map(ind=>(
            <div key={ind.l} className="flex flex-col items-center gap-2 cursor-pointer group">
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center border transition-all group-hover:scale-110 group-hover:shadow-lg" style={{background:D?"rgba(139,92,246,0.12)":"#ede9fe",border:`1px solid ${bdr}`,color:"#8b5cf6"}}>{ind.icon}</div>
              <span className="text-xs font-medium" style={{color:tx2}}>{ind.l}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Testimonials ────────────────────────────────────── */}
      <div className="py-20 px-4" style={{background:bg2}}>
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <p className="inline-block font-medium px-10 py-2 rounded-full border text-sm mb-4" style={{background:secPillBg,border:`1px solid ${secPillBdr}`,color:secPillTx}}>Testimonials</p>
            <h2 className="text-3xl font-black mt-1" style={{color:tx}}>Loved by Businesses, Trusted by Thousands</h2>
          </div>
          <div className="grid sm:grid-cols-3 gap-6">
            {TESTIMONIALS.map((t,i)=>(
              <div key={i} className="p-6 rounded-2xl border transition-all hover:shadow-md" style={{background:card,border:`1px solid ${bdr}`}}>
                <div className="flex gap-0.5 mb-4">{Array(t.stars).fill(0).map((_,j)=><Star key={j} size={14} className="text-yellow-400 fill-yellow-400"/>)}</div>
                <p className="text-sm leading-relaxed mb-5" style={{color:tx2}}>"{t.text}"</p>
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0" style={{background:"linear-gradient(135deg,#8b5cf6,#7c3aed)"}}>{t.avatar}</div>
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
      </div>

      {/* ── Case Studies ────────────────────────────────────── */}
      <div id="stories" className="py-20 px-4 relative overflow-hidden">
        <div className="absolute top-20 left-1/2 -translate-x-1/2 w-[600px] h-[600px] rounded-full pointer-events-none" style={{background:D?"radial-gradient(circle,rgba(139,92,246,0.07) 0%,transparent 70%)":"radial-gradient(circle,rgba(139,92,246,0.05) 0%,transparent 70%)"}}/>
        <Reveal className="text-center mb-3 relative">
          <p className="inline-block font-medium px-10 py-2 rounded-full border text-sm mb-4" style={{background:secPillBg,border:`1px solid ${secPillBdr}`,color:secPillTx}}>Success Stories</p>
          <h2 className="text-3xl md:text-4xl font-black mt-1" style={{color:tx}}>Real Businesses. <span className="lyl-grad-text">Real Comebacks.</span></h2>
          <p className="mt-3 max-w-xl mx-auto text-sm" style={{color:tx2}}>Behind every number is an owner who almost gave up — and the customers who came back.</p>
        </Reveal>

        {/* Headline metrics */}
        <Reveal delay={80} className="flex flex-wrap items-center justify-center gap-3 sm:gap-6 mt-8 mb-14 relative">
          {[{n:"2.3M+",l:"customers retained"},{n:"£18M+",l:"revenue recovered"},{n:"47%",l:"avg. repeat-visit lift"},{n:"1,000+",l:"happy businesses"}].map((m,i)=>(
            <div key={i} className="text-center px-4">
              <div className="text-2xl sm:text-3xl font-black" style={{color:"#8b5cf6"}}>{m.n}</div>
              <div className="text-xs mt-0.5" style={{color:tx2}}>{m.l}</div>
            </div>
          ))}
        </Reveal>

        {/* Featured story */}
        <Reveal delay={120} className="max-w-5xl mx-auto mb-12 relative">
          <div className="rounded-3xl p-8 md:p-10 border relative overflow-hidden" style={D?{background:"linear-gradient(145deg,rgba(139,92,246,0.12),rgba(236,72,153,0.06))",borderColor:"rgba(139,92,246,0.25)"}:{background:"linear-gradient(145deg,#faf5ff,#fff1f7)",borderColor:"#eaddff"}}>
            <div className="absolute -top-10 -right-10 text-[160px] leading-none opacity-10 pointer-events-none select-none">{CASE_STUDIES[0].emoji}</div>
            <div className="relative grid md:grid-cols-3 gap-8 items-center">
              <div className="md:col-span-2">
                <div className="flex gap-0.5 mb-4">{Array(5).fill(0).map((_,j)=><Star key={j} size={16} className="text-yellow-400 fill-yellow-400"/>)}</div>
                <p className="text-lg md:text-xl font-medium leading-relaxed mb-5" style={{color:tx}}>"{CASE_STUDIES[0].story}"</p>
                <p className="text-sm font-semibold mb-1" style={{color:"#8b5cf6"}}>✦ {CASE_STUDIES[0].result}</p>
                <div className="flex items-center gap-3 mt-5">
                  <div className="w-11 h-11 rounded-full flex items-center justify-center text-white text-lg font-bold flex-shrink-0" style={{background:`linear-gradient(135deg,${CASE_STUDIES[0].color},#7c3aed)`}}>{CASE_STUDIES[0].owner[0]}</div>
                  <div><div className="text-sm font-bold" style={{color:tx}}>{CASE_STUDIES[0].owner} · {CASE_STUDIES[0].biz}</div><div className="text-xs" style={{color:tx2}}>{CASE_STUDIES[0].city}</div></div>
                </div>
              </div>
              <div className="text-center md:border-l md:pl-8" style={{borderColor:D?"rgba(255,255,255,0.1)":"#eaddff"}}>
                <div className="text-5xl md:text-6xl font-black" style={{color:CASE_STUDIES[0].color}}>{CASE_STUDIES[0].stat}</div>
                <div className="text-xs mt-2" style={{color:tx2}}>{CASE_STUDIES[0].statLabel}</div>
              </div>
            </div>
          </div>
        </Reveal>

        {/* Scrolling story strip */}
        <div className="relative overflow-hidden w-full">
          <div className="absolute left-0 top-0 h-full w-16 sm:w-28 z-10 pointer-events-none" style={{background:`linear-gradient(to right,${bg},transparent)`}}/>
          <div className="absolute right-0 top-0 h-full w-16 sm:w-28 z-10 pointer-events-none" style={{background:`linear-gradient(to left,${bg},transparent)`}}/>
          <div className="lyl-cs-track py-2">
            {[...CASE_STUDIES.slice(1),...CASE_STUDIES.slice(1)].map((c,i)=>(
              <div key={i} className="w-[300px] flex-shrink-0 p-5 rounded-2xl border flex flex-col" style={{background:card,borderColor:bdr,boxShadow:D?"none":"0 4px 24px rgba(0,0,0,0.04)"}}>
                <div className="flex items-center justify-between mb-3">
                  <div className="w-11 h-11 rounded-xl flex items-center justify-center text-2xl" style={{background:c.color+"1a"}}>{c.emoji}</div>
                  <div className="text-right"><div className="text-xl font-black" style={{color:c.color}}>{c.stat}</div><div className="text-[10px]" style={{color:tx3}}>{c.statLabel}</div></div>
                </div>
                <p className="text-xs leading-relaxed mb-3 flex-1" style={{color:tx2}}>"{c.story.length>180?c.story.slice(0,180)+"…":c.story}"</p>
                <p className="text-[11px] font-semibold mb-3" style={{color:c.color}}>✦ {c.result}</p>
                <div className="flex items-center gap-2 pt-3 border-t" style={{borderColor:bdr}}>
                  <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-[10px] font-bold" style={{background:`linear-gradient(135deg,${c.color},#7c3aed)`}}>{c.owner[0]}</div>
                  <div><div className="text-xs font-semibold" style={{color:tx}}>{c.owner} · {c.biz}</div><div className="text-[10px]" style={{color:tx3}}>{c.city}</div></div>
                </div>
              </div>
            ))}
          </div>
        </div>
        <Reveal delay={60} className="text-center mt-12">
          <button onClick={()=>nav("signup")} className="px-7 py-3 rounded-md text-sm font-semibold text-white transition-all hover:opacity-90 hover:scale-[1.02] shadow-lg" style={{background:"#8b5cf6"}}>Write Your Comeback Story →</button>
        </Reveal>
      </div>

      {/* ── Pricing ─────────────────────────────────────────── */}
      <div id="pricing" className="py-20 px-4 relative">
        {/* Color splash decoration */}
        <div className="absolute -top-32 left-0 w-96 h-96 rounded-full pointer-events-none" style={{background:D?"radial-gradient(circle,rgba(139,92,246,0.08) 0%,transparent 70%)":"radial-gradient(circle,rgba(139,92,246,0.06) 0%,transparent 70%)"}}/>
        <div className="text-center mb-12">
          <p className="inline-block font-medium px-10 py-2 rounded-full border text-sm mb-4" style={{background:secPillBg,border:`1px solid ${secPillBdr}`,color:secPillTx}}>Pricing</p>
          <h2 className="text-3xl font-black mt-1 mb-2" style={{color:tx}}>Choose the Perfect Plan for Your Business</h2>
          <p className="text-sm max-w-lg mx-auto mb-8" style={{color:tx2}}>Flexible pricing options designed to meet your needs — whether you're just getting started or scaling up.</p>
          {/* Toggle */}
          <div className="inline-flex items-center gap-1 p-1 rounded-xl border" style={{background:D?"rgba(255,255,255,0.04)":"#f1f5f9",border:`1px solid ${bdr}`}}>
            <button onClick={()=>setPricingYearly(false)} className="px-5 py-2 rounded-lg text-sm font-semibold transition-all" style={{background:!pricingYearly?"linear-gradient(135deg,#8b5cf6,#7c3aed)":"transparent",color:!pricingYearly?"white":tx2}}>Monthly</button>
            <button onClick={()=>setPricingYearly(true)} className="px-5 py-2 rounded-lg text-sm font-semibold transition-all flex items-center gap-2" style={{background:pricingYearly?"linear-gradient(135deg,#8b5cf6,#7c3aed)":"transparent",color:pricingYearly?"white":tx2}}>
              Yearly <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full" style={{background:"rgba(34,197,94,0.15)",color:"#22c55e"}}>Save 20%</span>
            </button>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-6 max-w-5xl mx-auto">
          {PRICING.map((plan,i)=>{
            const price=pricingYearly?plan.yearly:plan.monthly;
            const isPopular=plan.highlight;
            return(
              <div key={i} className="p-6 rounded-2xl w-full max-w-[280px] flex flex-col relative transition-all hover:-translate-y-1" style={{
                boxShadow:isPopular?"0 4px 40px rgba(139,92,246,0.3)":"0 4px 24px rgba(0,0,0,0.06)",
                background:isPopular?"linear-gradient(145deg,#4f46e5,#7c3aed)":"",
                ...(isPopular?{}:{background:D?"rgba(255,255,255,0.04)":"rgba(255,255,255,0.8)",border:`1px solid ${bdr}`}),
              }}>
                {isPopular&&(
                  <div className="flex items-center gap-1 text-xs py-1.5 px-2.5 rounded-md font-medium absolute top-4 right-4 bg-white text-violet-600">
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z"/></svg>
                    Most Popular
                  </div>
                )}
                <p className="font-semibold text-sm" style={{color:isPopular?"rgba(255,255,255,0.9)":tx2}}>{plan.name}</p>
                <div className="text-3xl font-black mt-1 mb-0.5" style={{color:isPopular?"white":tx}}>
                  £{price}<span className="text-sm font-normal" style={{color:isPopular?"rgba(255,255,255,0.7)":tx2}}>/mo</span>
                </div>
                <p className="text-xs mb-4" style={{color:isPopular?"rgba(255,255,255,0.65)":tx2}}>{plan.desc}</p>
                <hr className="my-4" style={{borderColor:isPopular?"rgba(255,255,255,0.2)":bdr}}/>
                <ul className="space-y-2.5 flex-1 mb-6">
                  {plan.features.map((f,j)=>(
                    <li key={j} className="flex items-center gap-2 text-xs" style={{color:isPopular?"rgba(255,255,255,0.85)":tx2}}>
                      <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{color:isPopular?"white":"#8b5cf6",flexShrink:0}}><path d="M20 6 9 17l-5-5"/></svg>
                      {f}
                    </li>
                  ))}
                </ul>
                <button onClick={()=>nav("signup")} className="w-full py-2.5 rounded-lg text-sm font-semibold transition-all hover:opacity-90" style={{background:isPopular?"white":"#8b5cf6",color:isPopular?"#7c3aed":"white"}}>
                  {plan.cta}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── FAQ ─────────────────────────────────────────────── */}
      <div className="py-20 px-4" style={{background:bg2}}>
        <div className="relative max-w-2xl mx-auto">
          {/* Color splash left decoration */}
          <div className="absolute -left-48 top-0 w-96 h-96 rounded-full pointer-events-none" style={{background:D?"radial-gradient(circle,rgba(139,92,246,0.06) 0%,transparent 70%)":"radial-gradient(circle,rgba(139,92,246,0.05) 0%,transparent 70%)"}}/>
          <div className="text-center mb-10">
            <p className="inline-block font-medium px-10 py-2 rounded-full border text-sm mb-4" style={{background:secPillBg,border:`1px solid ${secPillBdr}`,color:secPillTx}}>FAQ's</p>
            <h2 className="text-3xl font-black mt-1" style={{color:tx}}>Frequently Asked Questions</h2>
            <p className="mt-2 text-sm max-w-lg mx-auto" style={{color:tx2}}>Everything you need to know about The Loyaly. Can't find the answer? Contact our support team.</p>
          </div>
          <div className="w-full space-y-0">
            {FAQS.map((faq,i)=>(
              <div key={i} className="border-b cursor-pointer w-full" style={{borderColor:D?"rgba(139,92,246,0.2)":bdr}} onClick={()=>setFaqOpen(faqOpen===i?null:i)}>
                <div className="flex items-center justify-between py-4">
                  <h3 className="text-sm font-medium pr-4" style={{color:tx}}>{faq.q}</h3>
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{color:tx2,transform:faqOpen===i?"rotate(180deg)":"rotate(0deg)",transition:"transform 0.3s ease",flexShrink:0}}><path d="m6 9 6 6 6-6"/></svg>
                </div>
                <div style={{maxHeight:faqOpen===i?"400px":"0",overflow:"hidden",transition:"max-height 0.4s ease, opacity 0.3s ease, padding 0.3s ease",opacity:faqOpen===i?1:0,paddingBottom:faqOpen===i?"16px":"0"}}>
                  <p className="text-sm leading-relaxed" style={{color:tx2}}>{faq.a}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── CTA ─────────────────────────────────────────────── */}
      <div className="flex flex-col items-center text-center justify-center py-20 px-4">
        <h2 className="text-3xl font-black mb-3" style={{color:tx}}>Ready to Turn Visitors into Loyal Customers?</h2>
        <p className="text-sm max-w-md mx-auto mb-8" style={{color:tx2}}>Start your 14-day free trial today. No credit card required. Cancel anytime.</p>
        <div className="flex flex-col sm:flex-row gap-3">
          <input type="email" placeholder="Enter your business email" className="px-4 py-3 rounded-md text-sm outline-none w-72" style={{background:D?"rgba(255,255,255,0.07)":"#f8fafc",border:`1px solid ${bdr}`,color:tx}}/>
          <button onClick={()=>nav("signup")} className="px-6 py-3 rounded-md text-sm font-semibold text-white transition-opacity hover:opacity-90 whitespace-nowrap" style={{background:"#8b5cf6"}}>Start Free Trial</button>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-5 mt-5 text-xs" style={{color:tx3}}>
          {["14-Day Free Trial","No Credit Card","Cancel Anytime"].map(l=><span key={l} className="flex items-center gap-1.5"><Check size={12} className="text-violet-500"/>{l}</span>)}
        </div>
      </div>

      {/* ── Footer ──────────────────────────────────────────── */}
      <footer className="relative px-6 md:px-16 lg:px-24 pt-16 pb-6 border-t" style={{background:D?"#09090b":"#ffffff",borderColor:bdr}}>
        {/* Watermark text */}
        <div className="absolute top-0 right-0 left-0 flex justify-center overflow-hidden pointer-events-none select-none" style={{height:"120px"}}>
          <span className="text-[120px] font-black tracking-tighter leading-none" style={{color:D?"rgba(255,255,255,0.03)":"rgba(0,0,0,0.04)"}}>THE LOYALY</span>
        </div>
        <div className="relative flex flex-col md:flex-row justify-between w-full gap-10 border-b pb-10 mb-6" style={{borderColor:bdr}}>
          <div className="max-w-xs">
            <div className="mb-4">
              <ThemeLogo dark={dark} className="h-7 w-auto object-contain"/>
            </div>
            <p className="text-xs leading-relaxed mb-4" style={{color:tx2}}>The all-in-one loyalty and customer retention platform for businesses that want to grow. WhatsApp-first, SMB-focused.</p>
            <div className="flex gap-2">
              {["f","in","tw","yt"].map(s=><div key={s} className="w-8 h-8 rounded-lg flex items-center justify-center cursor-pointer hover:opacity-80 transition-opacity border" style={{border:`1px solid ${bdr}`,color:tx2}}><span className="text-xs font-bold">{s}</span></div>)}
            </div>
          </div>
          <div className="flex flex-1 items-start justify-start md:justify-end gap-16">
            {[
              {h:"Product",links:["Features","Pricing","Integrations","Changelog","API"]},
              {h:"Company",links:["About Us","Careers","Blog","Press","Contact"]},
              {h:"Legal",links:[
                {label:"Privacy Policy",href:"/terms"},
                {label:"Terms of Service",href:"/terms"},
                {label:"GDPR",href:"/terms"},
                {label:"Security",href:"/terms"},
              ]},
            ].map(col=>(
              <div key={col.h}>
                <h4 className="font-semibold text-sm mb-5" style={{color:tx}}>{col.h}</h4>
                <ul className="space-y-2.5">{col.links.map((l:any)=>{
                  const label = typeof l === 'string' ? l : l.label;
                  const href  = typeof l === 'string' ? '#' : l.href;
                  return <li key={label}><a href={href} target={href!=='#'?'_blank':'_self'} rel="noopener noreferrer" className="text-xs transition-colors hover:opacity-80" style={{color:tx2}}>{label}</a></li>;
                })}</ul>
              </div>
            ))}
          </div>
        </div>
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-xs" style={{color:tx3}}>© 2025 The Loyaly. All rights reserved.</p>
          <button onClick={()=>setDark(!dark)} className="flex items-center gap-2 text-xs transition-opacity hover:opacity-70" style={{color:tx3}}>
            {D
              ? <><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>Light mode</>
              : <><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401"/></svg>Dark mode</>
            }
          </button>
        </div>
      </footer>
    </div>
    </ThemeCtx.Provider>
  );
};

const LoginPage=({onLogin}:{onLogin:(u:any)=>void})=><LandingPage onLogin={onLogin}/>;

// ── Accept Staff Invite ───────────────────────────────────────────
const AcceptInvitePage=({onLogin}:{onLogin:(u:any)=>void})=>{
  const {dark}=useTheme();
  const token=new URLSearchParams(window.location.search).get("token")||"";
  const [name,setName]=useState("");
  const [pw,setPw]=useState("");
  const [pw2,setPw2]=useState("");
  const [err,setErr]=useState("");
  const [loading,setLoading]=useState(false);
  const [done,setDone]=useState(false);
  const card:React.CSSProperties={background:dark?"#1e1333":"#fff",borderRadius:"20px",padding:"40px",maxWidth:"420px",width:"100%",boxShadow:"0 8px 32px rgba(124,58,237,0.15)"};
  const fld:React.CSSProperties={background:dark?"rgba(255,255,255,0.07)":"#f9f8ff",border:`1px solid ${dark?"rgba(255,255,255,0.14)":"rgba(124,58,237,0.2)"}`,borderRadius:"10px",padding:"11px 14px",fontSize:"14px",width:"100%",outline:"none",color:dark?"white":"#1a1035",marginTop:"6px"};
  const lbl:React.CSSProperties={fontSize:"12px",fontWeight:600,color:dark?"#94a3b8":"#374151"};
  const submit=async()=>{
    if(!name.trim()){setErr("Please enter your name.");return;}
    if(pw.length<8){setErr("Password must be at least 8 characters.");return;}
    if(pw!==pw2){setErr("Passwords do not match.");return;}
    setErr("");setLoading(true);
    try{
      const res=await fetch("/api/auth/accept-invite",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({token,name:name.trim(),password:pw})});
      const d=await res.json();
      if(!res.ok)throw new Error(d.error||"Failed to accept invite");
      localStorage.setItem("accessToken",d.accessToken);
      if(d.user?.id)localStorage.setItem("userId",d.user.id);
      if(d.user?.role)localStorage.setItem("userRole",d.user.role);
      window.history.replaceState({},"","/");
      setDone(true);
      setTimeout(()=>onLogin(d.user),800);
    }catch(ex){setErr((ex as Error).message);}
    finally{setLoading(false);}
  };
  return(
    <div style={{minHeight:"100vh",background:dark?"#0f0a1e":"#f4f2fb",display:"flex",alignItems:"center",justifyContent:"center",padding:"20px"}}>
      <div style={card}>
        <div style={{textAlign:"center",marginBottom:"28px"}}>
          <img src={dark?'/white.png':'/black.png'} alt="The Loyaly" style={{height:40,objectFit:'contain',marginBottom:4}}/>
          <p style={{marginTop:"8px",fontSize:"15px",fontWeight:600,color:dark?"#e2d9f3":"#1e1333"}}>Accept Your Invitation</p>
          <p style={{fontSize:"13px",color:dark?"#9488b8":"#6b7280",marginTop:"4px"}}>Set your name and password to get started</p>
        </div>
        {done?(
          <div style={{textAlign:"center",color:"#8b5cf6",fontWeight:600}}>Account created! Logging you in…</div>
        ):(
          <div className="space-y-4">
            <div><label style={lbl}>Full Name</label><input value={name} onChange={e=>setName(e.target.value)} placeholder="Your name" style={fld}/></div>
            <div><label style={lbl}>Password</label><input value={pw} onChange={e=>setPw(e.target.value)} type="password" placeholder="Min 8 characters" style={fld}/></div>
            <div><label style={lbl}>Confirm Password</label><input value={pw2} onChange={e=>setPw2(e.target.value)} onKeyDown={e=>e.key==="Enter"&&submit()} type="password" placeholder="Repeat password" style={fld}/></div>
            {err&&<div style={{color:"#ef4444",fontSize:"13px",fontWeight:500}}>{err}</div>}
            <button onClick={submit} disabled={loading} className="w-full py-3 rounded-xl text-sm font-bold text-white disabled:opacity-60 flex items-center justify-center gap-2 transition-all hover:opacity-90" style={{background:"linear-gradient(135deg,#8b5cf6,#7c3aed)",marginTop:"8px"}}>
              {loading&&<RefreshCw size={14} className="animate-spin"/>}Create Account & Sign In
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

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
  const ct=useCard();
  const today=new Date();
  const fmt=(d:Date)=>d.toISOString().slice(0,10);
  const [dateFrom,setDateFrom]=useState(fmt(new Date(today.getTime()-29*86400000)));
  const [dateTo,setDateTo]=useState(fmt(today));
  const [preset,setPreset]=useState<"7d"|"30d"|"90d"|"custom">("30d");
  const [dash,setDash]=useState<any>(null);
  const [loading,setLoading]=useState(true);
  const [snapshot,setSnapshot]=useState<any[]>([]);
  const [analyticsLoading,setAnalyticsLoading]=useState(true);
  const [atRisk,setAtRisk]=useState<any[]>([]);
  const [exec,setExec]=useState<any>(null);
  const [advisor,setAdvisor]=useState<any>(null);
  const [advisorLoading,setAdvisorLoading]=useState(true);

  const applyPreset=(p:"7d"|"30d"|"90d")=>{
    const days=p==="7d"?7:p==="30d"?30:90;
    setDateFrom(fmt(new Date(today.getTime()-days*86400000)));
    setDateTo(fmt(today));
    setPreset(p);
  };

  const load=useCallback(()=>{
    setLoading(true);
    api.dashboard.get().then(setDash).catch(()=>{}).finally(()=>setLoading(false));
    // At-risk = real churn-risk ranking (not just the AT_RISK segment label, which
    // may be empty until the nightly cron runs). Pull a window and rank by churnRisk.
    api.customers.list({limit:100}).then(d=>{
      const ranked=(d.customers||[]).map(mapCustomer).filter((c:any)=>(c.churnRisk??0)>=50).sort((a:any,b:any)=>(b.churnRisk??0)-(a.churnRisk??0)).slice(0,5);
      setAtRisk(ranked);
    }).catch(()=>{});
    api.analytics.snapshot(preset==="7d"?7:preset==="90d"?90:30).then(d=>setSnapshot(Array.isArray(d)?d:[])).catch(()=>{}).finally(()=>setAnalyticsLoading(false));
    const days=preset==="7d"?7:preset==="90d"?90:30;
    api.dashboard.overview(days).then(setExec).catch(()=>{});
    setAdvisorLoading(true);
    api.dashboard.advisor().then(setAdvisor).catch(()=>{}).finally(()=>setAdvisorLoading(false));
  },[preset]);

  useEffect(()=>{load();},[load]);
  const k=dash?.kpis;
  const visitTrend=(dash?.visitTrend??[]).map((d:any)=>({day:d.day?.slice(5),v:d.visits,r:d.revenue}));
  const segData=(dash?.segments??[]).map((s:any)=>({...s,color:SEG_COLORS[s.name as keyof typeof SEG_COLORS]||"#8b5cf6"}));
  const quotaPct=k&&k.quotaTotal>0?Math.round((k.quotaUsed/k.quotaTotal)*100):0;
  const latest=snapshot[snapshot.length-1]??{};
  const msgPerf=snapshot.slice(-8).map((s:any)=>({w:(s.snapshotDate??s.createdAt??"").toString().slice(5,10),sent:s.messagesSent||0,del:s.messagesDelivered||0,read:s.messagesRead||0}));
  const growthData=snapshot.slice(-6).map((s:any)=>({m:(s.snapshotDate??s.createdAt??"").toString().slice(5,10),c:s.totalCustomers||0,ret:s.loyalCustomers||0}));
  const retRate=latest.retentionRate!=null?`${Math.round(Number(latest.retentionRate))}%`:"-";
  const avgLtv=latest.averageLtv!=null?`£${Math.round(Number(latest.averageLtv))}`:"-";
  const churnRate=latest.churnRate!=null?`${Math.round(Number(latest.churnRate))}%`:"-";
  const repeatRate=latest.repeatVisitRate!=null?`${Number(latest.repeatVisitRate).toFixed(1)}%`:"-";

  // ── Executive dashboard derived state ──────────────────────────
  const ek=exec?.kpis??{};
  const ew=exec?.widgets??{};
  const money=(v:number)=>`£${Math.round(v??0).toLocaleString()}`;
  const ekMoney=(key:string)=>({value:money(ek[key]?.value),change:ek[key]?.deltaPct!=null?`${ek[key].deltaPct>=0?"+":""}${ek[key].deltaPct}%`:undefined,positive:ek[key]?.trend!=="down"});
  const ekNum=(key:string,suffix="")=>({value:`${Math.round(ek[key]?.value??0).toLocaleString()}${suffix}`,change:ek[key]?.deltaPct!=null?`${ek[key].deltaPct>=0?"+":""}${ek[key].deltaPct}%`:undefined,positive:ek[key]?.trend!=="down"});
  const tasks=exec?.tasks??[];
  const SEV_COLOR:Record<string,string>={opportunity:C.accent,positive:C.green,warning:C.amber,critical:C.red};
  const PRI_COLOR:Record<string,string>={HIGH:C.red,MEDIUM:C.amber,LOW:C.accent};
  const go=(path:string)=>{const seg=path.replace(/^\//,"").split("/")[0]||"dashboard";const map:Record<string,string>={customers:"customers",campaigns:"campaigns",automations:"automations",settings:"settings"};setPage(map[seg]??"dashboard");};

  return(
    <div className="space-y-5" style={{color:ct.tx}}>
      {/* Header + date picker */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold" style={{color:ct.tx}}>Dashboard</h1>
          <p className="text-xs text-slate-400 mt-0.5">{new Date().toLocaleDateString("en-GB",{day:"numeric",month:"long",year:"numeric"})}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {(["7d","30d","90d"] as const).map(p=>(
            <button key={p} onClick={()=>applyPreset(p)} className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${preset===p?"text-white":"text-slate-400 hover:text-white"}`} style={preset===p?{background:"rgba(139,92,246,0.25)"}:{background:"rgba(255,255,255,0.03)"}}>{p}</button>
          ))}
          <div className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs" style={{background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.06)"}}>
            <input type="date" value={dateFrom} onChange={e=>{setDateFrom(e.target.value);setPreset("custom");}} className="bg-transparent text-slate-300 outline-none text-xs w-[110px]"/>
            <span className="text-slate-600">→</span>
            <input type="date" value={dateTo} onChange={e=>{setDateTo(e.target.value);setPreset("custom");}} className="bg-transparent text-slate-300 outline-none text-xs w-[110px]"/>
          </div>
          <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-green-400 animate-pulse"/><span className="text-xs text-slate-400">Live</span></div>
        </div>
      </div>

      {/* Quota warning banner */}
      {k&&quotaPct>=80&&(
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl" style={{background:quotaPct>=95?"rgba(239,68,68,0.12)":"rgba(245,158,11,0.12)",border:`1px solid ${quotaPct>=95?"rgba(239,68,68,0.3)":"rgba(245,158,11,0.3)"}`}}>
          <AlertTriangle size={16} className={quotaPct>=95?"text-red-400":"text-amber-400"}/>
          <div className="flex-1">
            <span className={`text-sm font-semibold ${quotaPct>=95?"text-red-400":"text-amber-400"}`}>{quotaPct>=95?"⚠️ Quota almost full":"📊 Approaching quota limit"}</span>
            <span className="text-xs text-slate-400 ml-2">{k.quotaUsed?.toLocaleString()} / {k.quotaTotal?.toLocaleString()} messages used ({quotaPct}%)</span>
          </div>
          <button onClick={()=>setPage("settings")} className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white flex-shrink-0" style={{background:quotaPct>=95?"linear-gradient(135deg,#ef4444,#dc2626)":"linear-gradient(135deg,#f59e0b,#d97706)"}}>Upgrade Plan</button>
        </div>
      )}

      {/* Primary KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {loading?[...Array(8)].map((_,i)=><Skeleton key={i} h="h-24"/>):<>
          <KPI icon={Users} label="Total Customers" value={k?.totalCustomers?.toLocaleString()??"-"} change={`+${k?.newThisMonth??0} new`} positive color={C.primary}/>
          <KPI icon={Eye} label="Active (30d)" value={k?.activeCustomers?.toLocaleString()??"-"} change="visited this month" positive color={C.accent}/>
          <KPI icon={TrendingUp} label="Revenue (period)" value={`£${(k?.revenue??0).toLocaleString()}`} change={`${(k?.revenueChange??0)>=0?"+":""}${k?.revenueChange??0}% vs prev`} positive={(k?.revenueChange??0)>=0} color={C.green}/>
          <KPI icon={Send} label="Messages sent" value={k?.messagesThisMonth?.toLocaleString()??"-"} change={`${quotaPct}% quota`} positive={quotaPct<80} color={C.blue}/>
          <KPI icon={Heart} label="Retention Rate" value={retRate} change="loyal / total" positive color={C.pink}/>
          <KPI icon={AlertTriangle} label="Churn Rate" value={churnRate} change="lost this period" positive={false} color={C.red}/>
          <KPI icon={TrendingUp} label="Avg. LTV" value={avgLtv} change="lifetime spend" positive color={C.amber}/>
          <KPI icon={Repeat} label="Repeat Visit Rate" value={repeatRate} change="came back" positive color={C.green}/>
        </>}
      </div>

      {/* ═══ EXECUTIVE REVENUE KPIs (recovered / loyalty / referral) ═══ */}
      <div>
        <div className="flex items-center gap-2 mb-3"><DollarSign size={15} style={{color:C.green}}/><h2 className="text-sm font-bold text-white">Where your revenue comes from</h2><span className="text-[11px] text-slate-500">last {exec?.windowDays??30} days</span></div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {!exec?[...Array(4)].map((_,i)=><Skeleton key={i} h="h-24"/>):<>
            <KPI icon={DollarSign} label="Total Revenue" {...ekMoney("revenue")} color={C.green} sub="all visits in period"/>
            <KPI icon={RotateCcw} label="Recovered Revenue" {...ekMoney("recoveredRevenue")} color={C.accent} sub="won back by automations"/>
            <KPI icon={Crown} label="Loyalty Revenue" {...ekMoney("loyaltyRevenue")} color={C.amber} sub="from tier members"/>
            <KPI icon={UserPlus} label="Referral Revenue" {...ekMoney("referralRevenue")} color={C.pink} sub="from referred customers"/>
            <KPI icon={ShoppingBag} label="Avg. Order Value" {...ekMoney("averageOrderValue")} color={C.blue}/>
            <KPI icon={TrendingUp} label="Customer LTV" {...ekMoney("customerLifetimeValue")} color={C.primary} sub="avg lifetime spend"/>
            <KPI icon={Activity} label="Customer Health" value={`${Math.round(ek.customerHealth?.value??0)}/100`} change={ek.customerHealth?.deltaPct!=null?`${ek.customerHealth.deltaPct>=0?"+":""}${ek.customerHealth.deltaPct}%`:undefined} positive={ek.customerHealth?.trend!=="down"} color={C.green} sub="retention + sentiment"/>
            <KPI icon={Star} label="Reviews" {...ekNum("reviews")} color={C.amber} sub="feedback received"/>
          </>}
        </div>
      </div>

      {/* ═══ TODAY'S TASKS + AI BUSINESS ADVISOR ═══ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Today's Tasks */}
        <div className="gc rounded-xl p-4" style={CARD}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2"><CheckCircle size={15} style={{color:C.primary}}/><h3 className="text-sm font-bold text-white">Today's Tasks</h3></div>
            {tasks.length>0&&<span className="text-[11px] px-2 py-0.5 rounded-full font-semibold" style={{background:C.red+"22",color:C.red}}>{tasks.filter((t:any)=>t.priority==="HIGH").length} urgent</span>}
          </div>
          {!exec?<div className="space-y-2">{[...Array(3)].map((_,i)=><Skeleton key={i} h="h-14"/>)}</div>:
            tasks.length===0?<div className="py-8 text-center text-slate-500 text-sm">🎉 You're all caught up. Nothing needs your attention right now.</div>:
            <div className="space-y-2">{tasks.map((t:any)=>(
              <div key={t.id} className="flex items-start gap-3 p-3 rounded-lg" style={{background:"rgba(255,255,255,0.025)",border:"1px solid rgba(255,255,255,0.05)"}}>
                <span className="w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0" style={{background:PRI_COLOR[t.priority]}}/>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-semibold text-white">{t.title}</div>
                  <div className="text-[11px] text-slate-400 mt-0.5 leading-snug">{t.detail}</div>
                </div>
                <button onClick={()=>go(t.actionPath)} className="text-[11px] font-semibold px-2.5 py-1 rounded-lg flex-shrink-0 whitespace-nowrap" style={{background:PRI_COLOR[t.priority]+"22",color:PRI_COLOR[t.priority]}}>{t.actionLabel}</button>
              </div>
            ))}</div>}
        </div>

        {/* AI Business Advisor */}
        <div className="gc rounded-xl p-4" style={{...CARD,border:"1px solid rgba(139,92,246,0.25)"}}>
          <div className="flex items-center gap-2 mb-3"><Brain size={15} style={{color:C.primary}}/><h3 className="text-sm font-bold text-white">AI Business Advisor</h3><span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse"/></div>
          {advisorLoading?<div className="space-y-2">{[...Array(3)].map((_,i)=><Skeleton key={i} h="h-16"/>)}</div>:
            (!advisor||(advisor.insights??[]).length===0)?<div className="py-8 text-center text-slate-500 text-sm">Keep using The Loyaly — once there's enough activity, your advisor will surface ways to grow.</div>:
            <div className="space-y-3">
              {advisor.summary&&<div className="text-[12px] text-slate-200 leading-relaxed p-3 rounded-lg" style={{background:"rgba(139,92,246,0.1)"}}>💡 {advisor.summary}</div>}
              {(advisor.insights??[]).map((ins:any)=>(
                <div key={ins.id} className="p-3 rounded-lg" style={{background:"rgba(255,255,255,0.025)",borderLeft:`2px solid ${SEV_COLOR[ins.severity]||C.primary}`}}>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="text-[13px] font-semibold text-white">{ins.title}</span>
                    {ins.metric&&<span className="text-[10px] font-bold px-1.5 py-0.5 rounded flex-shrink-0" style={{background:(SEV_COLOR[ins.severity]||C.primary)+"22",color:SEV_COLOR[ins.severity]||C.primary}}>{ins.metric}</span>}
                  </div>
                  <div className="text-[11px] text-slate-400 leading-snug mb-2">{ins.body}</div>
                  <button onClick={()=>go(ins.actionPath)} className="text-[11px] font-semibold flex items-center gap-1" style={{color:SEV_COLOR[ins.severity]||C.primary}}>{ins.actionLabel}<ChevronRight size={12}/></button>
                </div>
              ))}
            </div>}
        </div>
      </div>

      {/* ═══ OPERATIONAL WIDGETS (loyalty / staff / birthdays / alerts) ═══ */}
      {exec&&<div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Loyalty performance */}
        <div className="gc rounded-xl p-4" style={CARD}>
          <div className="flex items-center gap-2 mb-3"><Crown size={14} style={{color:C.amber}}/><h3 className="text-sm font-semibold text-white">Loyalty Performance</h3></div>
          <div className="text-2xl font-bold text-white">{(ew.loyaltyPerformance?.pointsOutstanding??0).toLocaleString()}</div>
          <div className="text-[11px] text-slate-500 mb-3">points outstanding (liability)</div>
          <div className="space-y-1.5">{(ew.loyaltyPerformance?.tiers??[]).slice(0,4).map((t:any)=>(
            <div key={t.id} className="flex items-center justify-between text-xs"><span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{background:t.color||C.amber}}/><span className="text-slate-300">{t.name}</span></span><span className="text-white font-medium">{t.members} members</span></div>
          ))}{(ew.loyaltyPerformance?.tiers??[]).length===0&&<div className="text-[11px] text-slate-500">No tiers configured yet.</div>}</div>
        </div>

        {/* Staff performance */}
        <div className="gc rounded-xl p-4" style={CARD}>
          <div className="flex items-center gap-2 mb-3"><UserCheck size={14} style={{color:C.accent}}/><h3 className="text-sm font-semibold text-white">Staff Performance</h3></div>
          {(ew.staffPerformance??[]).length===0?<div className="py-6 text-center text-[11px] text-slate-500">No staff-attributed sales in this period.</div>:
            <div className="space-y-2">{(ew.staffPerformance??[]).slice(0,5).map((s:any,i:number)=>(
              <div key={s.staffId??i} className="flex items-center justify-between text-xs"><span className="text-slate-300 truncate">{s.staffId?`Staff ${String(s.staffId).slice(-4)}`:"Unassigned"}</span><span className="text-white font-medium">{money(s.revenue)} · {s.visits} visits</span></div>
            ))}</div>}
        </div>

        {/* Birthdays + alerts */}
        <div className="gc rounded-xl p-4" style={CARD}>
          <div className="flex items-center gap-2 mb-3"><Gift size={14} style={{color:C.pink}}/><h3 className="text-sm font-semibold text-white">Upcoming Birthdays</h3></div>
          {(ew.birthdays??[]).length===0?<div className="text-[11px] text-slate-500 mb-3">No birthdays in the next 7 days.</div>:
            <div className="space-y-1.5 mb-3">{(ew.birthdays??[]).slice(0,4).map((b:any)=>(
              <div key={b.id} className="flex items-center justify-between text-xs"><span className="text-slate-300 truncate">🎂 {b.fullName}</span><span className="text-slate-500">{new Date(b.birthday).toLocaleDateString("en-GB",{day:"numeric",month:"short"})}</span></div>
            ))}</div>}
          {(ew.systemAlerts??[]).length>0&&<div className="space-y-1.5 pt-2 border-t" style={{borderColor:"rgba(255,255,255,0.06)"}}>{(ew.systemAlerts??[]).map((a:any,i:number)=>(
            <div key={i} className="flex items-start gap-1.5 text-[11px]"><AlertTriangle size={12} className="mt-0.5 flex-shrink-0" style={{color:a.level==="critical"?C.red:C.amber}}/><span className="text-slate-400">{a.message}</span></div>
          ))}</div>}
        </div>
      </div>}

      {/* Quota bar (compact) */}
      {k&&k.quotaTotal>0&&<div className="gc rounded-xl px-4 py-3" style={CARD}>
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-400 flex-shrink-0">Monthly Quota</span>
          <div className="flex-1 h-2 rounded-full" style={{background:"rgba(255,255,255,0.06)"}}><div className="h-full rounded-full transition-all" style={{width:`${Math.min(quotaPct,100)}%`,background:quotaPct>90?"#ef4444":quotaPct>75?"#f59e0b":"#8b5cf6"}}/></div>
          <span className="text-xs font-mono text-white flex-shrink-0">{k.quotaUsed?.toLocaleString()} / {k.quotaTotal?.toLocaleString()}</span>
          <span className={`text-xs font-bold flex-shrink-0 ${quotaPct>90?"text-red-400":quotaPct>75?"text-amber-400":"text-slate-400"}`}>{quotaPct}%</span>
        </div>
      </div>}

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 gc rounded-xl p-4" style={CARD}>
          <h3 className="text-sm font-semibold text-white mb-3">Visits & Revenue</h3>
          {loading?<Skeleton h="h-[200px]"/>:<ResponsiveContainer width="100%" height={200}><AreaChart data={visitTrend.length?visitTrend:[{day:"No data",v:0,r:0}]}><defs><linearGradient id="gv2" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.3}/><stop offset="100%" stopColor="#8b5cf6" stopOpacity={0}/></linearGradient><linearGradient id="gr2" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#06b6d4" stopOpacity={0.3}/><stop offset="100%" stopColor="#06b6d4" stopOpacity={0}/></linearGradient></defs><CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)"/><XAxis dataKey="day" tick={{fill:"#64748b",fontSize:11}} axisLine={false} tickLine={false}/><YAxis tick={{fill:"#64748b",fontSize:11}} axisLine={false} tickLine={false}/><Tooltip contentStyle={{background:"#1e1e2d",border:"1px solid rgba(255,255,255,0.1)",borderRadius:8,fontSize:12,color:"#fff"}}/><Area type="monotone" dataKey="v" name="Visits" stroke="#8b5cf6" fill="url(#gv2)" strokeWidth={2}/><Area type="monotone" dataKey="r" name="Revenue £" stroke="#06b6d4" fill="url(#gr2)" strokeWidth={2}/></AreaChart></ResponsiveContainer>}
        </div>
        <div className="gc rounded-xl p-4" style={CARD}>
          <h3 className="text-sm font-semibold text-white mb-3">Segments</h3>
          {loading?<Skeleton h="h-[200px]"/>:segData.length>0?(
            <div className="flex flex-col gap-2">
              <ResponsiveContainer width="100%" height={130}><PieChart><Pie data={segData} cx="50%" cy="50%" innerRadius={40} outerRadius={60} dataKey="value">{segData.map((s:any,i:number)=><Cell key={i} fill={s.color}/>)}</Pie><Tooltip contentStyle={{background:"#1e1e2d",border:"1px solid rgba(255,255,255,0.1)",borderRadius:8,fontSize:12,color:"#fff"}}/></PieChart></ResponsiveContainer>
              <div className="space-y-1">{segData.slice(0,5).map((s:any,i:number)=><div key={i} className="flex items-center justify-between text-xs"><span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full flex-shrink-0" style={{background:s.color}}/><span className="text-slate-300 truncate">{s.name}</span></span><span className="text-white font-medium">{s.value}</span></div>)}</div>
            </div>
          ):<div className="h-[200px] flex items-center justify-center text-slate-500 text-sm">No data yet</div>}
        </div>
      </div>

      {/* Message performance + growth */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="gc rounded-xl p-4" style={CARD}>
          <h3 className="text-sm font-semibold text-white mb-3">Message Performance</h3>
          {analyticsLoading?<Skeleton h="h-[160px]"/>:msgPerf.length===0?<div className="h-[160px] flex items-center justify-center text-slate-500 text-sm">No snapshot data yet</div>:
          <ResponsiveContainer width="100%" height={160}><AreaChart data={msgPerf}><defs><linearGradient id="gmsg1" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#3b82f6" stopOpacity={0.35}/><stop offset="100%" stopColor="#3b82f6" stopOpacity={0}/></linearGradient><linearGradient id="gmsg2" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#22c55e" stopOpacity={0.35}/><stop offset="100%" stopColor="#22c55e" stopOpacity={0}/></linearGradient><linearGradient id="gmsg3" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#06b6d4" stopOpacity={0.35}/><stop offset="100%" stopColor="#06b6d4" stopOpacity={0}/></linearGradient></defs><CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)"/><XAxis dataKey="w" tick={{fill:"#64748b",fontSize:10}} axisLine={false} tickLine={false}/><YAxis tick={{fill:"#64748b",fontSize:10}} axisLine={false} tickLine={false}/><Tooltip contentStyle={{background:"#1e1e2d",border:"1px solid rgba(255,255,255,0.1)",borderRadius:8,fontSize:11,color:"#fff"}}/><Area type="monotone" dataKey="sent" name="Sent" stroke="#3b82f6" fill="url(#gmsg1)" strokeWidth={2}/><Area type="monotone" dataKey="del" name="Delivered" stroke="#22c55e" fill="url(#gmsg2)" strokeWidth={2}/><Area type="monotone" dataKey="read" name="Read" stroke="#06b6d4" fill="url(#gmsg3)" strokeWidth={2}/></AreaChart></ResponsiveContainer>}
        </div>
        <div className="gc rounded-xl p-4" style={CARD}>
          <h3 className="text-sm font-semibold text-white mb-3">Customer Growth</h3>
          {analyticsLoading?<Skeleton h="h-[160px]"/>:growthData.length===0?<div className="h-[160px] flex items-center justify-center text-slate-500 text-sm">No snapshot data yet</div>:
          <ResponsiveContainer width="100%" height={160}><AreaChart data={growthData}><defs><linearGradient id="ggrow1" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.35}/><stop offset="100%" stopColor="#8b5cf6" stopOpacity={0}/></linearGradient><linearGradient id="ggrow2" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#22c55e" stopOpacity={0.35}/><stop offset="100%" stopColor="#22c55e" stopOpacity={0}/></linearGradient></defs><CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)"/><XAxis dataKey="m" tick={{fill:"#64748b",fontSize:10}} axisLine={false} tickLine={false}/><YAxis tick={{fill:"#64748b",fontSize:10}} axisLine={false} tickLine={false}/><Tooltip contentStyle={{background:"#1e1e2d",border:"1px solid rgba(255,255,255,0.1)",borderRadius:8,fontSize:11,color:"#fff"}}/><Area type="monotone" dataKey="c" name="Total" stroke="#8b5cf6" fill="url(#ggrow1)" strokeWidth={2}/><Area type="monotone" dataKey="ret" name="Loyal" stroke="#22c55e" fill="url(#ggrow2)" strokeWidth={2}/></AreaChart></ResponsiveContainer>}
        </div>
      </div>

      {/* At-risk customers */}
      <div className="gc rounded-xl p-4" style={CARD}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2"><AlertTriangle size={13} className="text-red-400"/>At-Risk Customers</h3>
          <button onClick={()=>setPage("customers")} className="text-xs text-violet-400">View all →</button>
        </div>
        {atRisk.length===0?<p className="text-xs text-slate-500 text-center py-4">No at-risk customers — great retention! 🎉</p>:
        <div className="space-y-2">{atRisk.slice(0,5).map((c:any,i:number)=>(
          <div key={i} className="flex items-center gap-3 p-2 rounded-lg" style={{background:"rgba(255,255,255,0.02)"}}>
            <div className="w-8 h-8 rounded-full flex items-center justify-center text-white font-bold text-xs flex-shrink-0" style={{background:`linear-gradient(135deg,${SEG_COLORS[c.segment as keyof typeof SEG_COLORS]||"#8b5cf6"},${SEG_COLORS[c.segment as keyof typeof SEG_COLORS]||"#8b5cf6"}88)`}}>{c.name.split(" ").map((n:string)=>n[0]).join("")}</div>
            <div className="flex-1 min-w-0">
              <div className="text-xs text-white font-medium truncate">{c.name}</div>
              <div className="text-xs text-slate-500">{c.segment} · Last visit: {c.lastVisit}</div>
            </div>
            <div className="text-right flex-shrink-0">
              <div className={`text-sm font-bold ${c.churnRisk>75?"text-red-400":c.churnRisk>50?"text-amber-400":"text-green-400"}`}>{c.churnRisk}%</div>
              <div className="text-xs text-slate-500">churn risk</div>
            </div>
            <button onClick={()=>setPage("messages")} className="flex-shrink-0 p-1.5 rounded-lg text-xs text-white" style={{background:"rgba(139,92,246,0.2)"}} title="Send message"><Send size={12}/></button>
          </div>
        ))}</div>}
      </div>
    </div>
  );
};

// ════════════════════════════════════════════════════════════════
// CUSTOMERS
// ════════════════════════════════════════════════════════════════
const CustomersPage=({onSelect}: {onSelect:(c:any)=>void})=>{
  const ct=useCard();
  const [q,setQ]=useState("");const [seg,setSeg]=useState("ALL");
  const [tag,setTag]=useState("");const [consent,setConsent]=useState("");const [sort,setSort]=useState("recent:desc");
  const [customers,setCustomers]=useState<any[]>([]);
  const [total,setTotal]=useState(0);
  const [loading,setLoading]=useState(true);
  const [views,setViews]=useState<any[]>([]);
  const [exporting,setExporting]=useState(false);
  const [showSave,setShowSave]=useState(false);const [viewName,setViewName]=useState("");
  const segs=["ALL","NEW","LOYAL","VIP","AT_RISK","BIG_SPENDER","COUPON_HUNTER","LOST"];
  const params=()=>{const p:any={limit:100,sort};if(seg!=="ALL")p.segment=seg;if(q)p.q=q;if(tag)p.tag=tag;if(consent)p.consent=consent;return p;};
  const loadViews=()=>api.customers.savedViews().then(d=>setViews(d.views??[])).catch(()=>{});
  useEffect(()=>{loadViews();},[]);
  useEffect(()=>{
    setLoading(true);
    api.customers.search(params()).then(d=>{setCustomers(d.customers.map(mapCustomer));setTotal(d.total);}).catch(()=>{
      // Fall back to the legacy list endpoint if the rich one is unavailable
      api.customers.list({limit:100,...(seg!=="ALL"?{segment:seg}:{}),...(q?{q}:{})}).then(d=>{setCustomers(d.customers.map(mapCustomer));setTotal(d.total);}).catch(()=>{});
    }).finally(()=>setLoading(false));
  },[q,seg,tag,consent,sort]);
  const applyView=(v:any)=>{const f=v.filtersJson||{};setQ(f.q||"");setSeg(f.segment||"ALL");setTag(f.tag||"");setConsent(f.consent||"");setSort(f.sort||"recent:desc");};
  const saveView=async()=>{if(!viewName.trim())return;try{await api.customers.createSavedView(viewName.trim(),{q,segment:seg,tag,consent,sort});setViewName("");setShowSave(false);loadViews();}catch{}};
  const doExport=async()=>{setExporting(true);try{await api.customers.exportCsv(params());}catch{}finally{setExporting(false);}};
  const filtered=customers;
  const SORTS:[string,string][]=[["recent:desc","Recent visit"],["spend:desc","Top spend"],["visits:desc","Most visits"],["points:desc","Most points"],["name:asc","Name A–Z"],["created:desc","Newest"]];
  return(
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div><h1 className="text-xl font-bold" style={{color:ct.tx}}>Customers</h1><p className="text-xs mt-0.5" style={{color:ct.tx2}}>{loading?"Loading…":`${total} total · your retention intelligence`}</p></div>
        <button onClick={doExport} disabled={exporting} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium" style={{background:"rgba(255,255,255,0.05)",border:`1px solid ${ct.inpBd}`,color:ct.tx2}}>{exporting?<RefreshCw size={13} className="animate-spin"/>:<Download size={13}/>}Export CSV</button>
      </div>
      {/* Saved views */}
      {views.length>0&&<div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-[11px]" style={{color:ct.tx3}}>Saved views:</span>
        {views.map(v=><span key={v.id} className="group flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] cursor-pointer" style={{background:"rgba(139,92,246,0.12)",color:"#c4b5fd"}} onClick={()=>applyView(v)}><Eye size={10}/>{v.name}{v.isShared&&<span className="opacity-60">·shared</span>}<X size={10} className="opacity-0 group-hover:opacity-70 hover:!opacity-100" onClick={(e)=>{e.stopPropagation();api.customers.deleteSavedView(v.id).then(loadViews);}}/></span>)}
      </div>}
      {/* Filter bar */}
      <div className="flex gap-2 flex-wrap">
        <div className="relative flex-1 min-w-48"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"/><input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search by name, phone or email…" className="w-full pl-9 pr-3 py-2 rounded-lg text-xs placeholder-slate-500 outline-none" style={{background:ct.inp,border:`1px solid ${ct.inpBd}`,color:ct.tx}}/></div>
        <input value={tag} onChange={e=>setTag(e.target.value)} placeholder="Tag…" className="w-28 px-3 py-2 rounded-lg text-xs placeholder-slate-500 outline-none" style={{background:ct.inp,border:`1px solid ${ct.inpBd}`,color:ct.tx}}/>
        <select value={consent} onChange={e=>setConsent(e.target.value)} className="px-2 py-2 rounded-lg text-xs outline-none" style={{background:ct.inp,border:`1px solid ${ct.inpBd}`,color:ct.tx2}}><option value="">All consent</option><option value="OPTED_IN">Opted-in</option><option value="OPTED_OUT">Opted-out</option></select>
        <select value={sort} onChange={e=>setSort(e.target.value)} className="px-2 py-2 rounded-lg text-xs outline-none" style={{background:ct.inp,border:`1px solid ${ct.inpBd}`,color:ct.tx2}}>{SORTS.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select>
        {showSave?<div className="flex items-center gap-1"><input autoFocus value={viewName} onChange={e=>setViewName(e.target.value)} onKeyDown={e=>e.key==="Enter"&&saveView()} placeholder="View name…" className="w-28 px-2 py-2 rounded-lg text-xs outline-none" style={{background:ct.inp,border:`1px solid ${ct.inpBd}`,color:ct.tx}}/><button onClick={saveView} className="px-2 py-2 rounded-lg text-xs text-white" style={{background:C.primary}}><Check size={13}/></button><button onClick={()=>setShowSave(false)} className="px-2 py-2 rounded-lg text-xs" style={{color:ct.tx3}}><X size={13}/></button></div>
        :<button onClick={()=>setShowSave(true)} className="flex items-center gap-1 px-2.5 py-2 rounded-lg text-xs" style={{background:"rgba(255,255,255,0.05)",border:`1px solid ${ct.inpBd}`,color:ct.tx2}}><Plus size={12}/>Save view</button>}
      </div>
      <div className="flex gap-1 flex-wrap">{segs.map(s=><button key={s} onClick={()=>setSeg(s)} className={`px-2 py-1.5 rounded-lg text-xs transition-all ${seg===s?"text-white":"text-slate-400"}`} style={seg===s?{background:SEG_COLORS[s]||"rgba(139,92,246,0.2)"}:{background:"rgba(255,255,255,0.03)"}}>{s}</button>)}</div>
      <div className="gc rounded-xl overflow-hidden" style={CARD}>
        <div className="overflow-x-auto"><table className="w-full text-xs"><thead><tr className="border-b border-white/5"><th className="text-left py-3 px-4 font-medium" style={{color:ct.tx2}}>Customer</th><th className="text-left py-3 px-3 font-medium" style={{color:ct.tx2}}>Segment</th><th className="text-left py-3 px-3 font-medium hidden sm:table-cell" style={{color:ct.tx2}}>Visits</th><th className="text-left py-3 px-3 font-medium hidden md:table-cell" style={{color:ct.tx2}}>Churn</th><th className="text-left py-3 px-3 font-medium hidden md:table-cell" style={{color:ct.tx2}}>CLV</th><th className="text-left py-3 px-3 font-medium hidden sm:table-cell" style={{color:ct.tx2}}>Points</th><th className="text-left py-3 px-3 font-medium" style={{color:ct.tx2}}>Status</th></tr></thead>
          <tbody>{filtered.map(c=>(
            <tr key={c.id} onClick={()=>onSelect(c)} className="border-b border-white/3 hover:bg-white/3 cursor-pointer">
              <td className="py-3 px-4"><div className="flex items-center gap-2.5"><div className="w-8 h-8 rounded-full flex items-center justify-center text-white font-semibold text-xs flex-shrink-0" style={{background:`linear-gradient(135deg,${SEG_COLORS[c.segment]||"#8b5cf6"},${SEG_COLORS[c.segment]||"#8b5cf6"}88)`}}>{c.name.split(" ").map((n:any)=>n[0]).join("")}</div><div className="min-w-0"><div className="font-medium flex items-center gap-1.5" style={{color:ct.tx}}>{c.name}{(c.tags||[]).slice(0,2).map((t:string)=><span key={t} className="px-1.5 py-0.5 rounded text-[9px] font-medium" style={{background:"rgba(6,182,212,0.15)",color:"#67e8f9"}}>{t}</span>)}</div><div style={{color:ct.tx3}}>{c.phone}</div></div></div></td>
              <td className="py-3 px-3"><Badge color={SEG_COLORS[c.segment]||"#8b5cf6"}>{c.segment}</Badge></td>
              <td className="py-3 px-3 hidden sm:table-cell" style={{color:ct.tx2}}>{c.visits}</td>
              <td className="py-3 px-3 hidden md:table-cell"><div className="flex items-center gap-1"><div className="w-12 h-1.5 rounded-full" style={{background:"rgba(255,255,255,0.08)"}}><div className="h-full rounded-full" style={{width:`${c.churnRisk}%`,background:c.churnRisk>75?"#ef4444":c.churnRisk>40?"#f59e0b":"#22c55e"}}/></div><span className="text-xs text-slate-400">{c.churnRisk}%</span></div></td>
              <td className="py-3 px-3 hidden md:table-cell" style={{color:ct.tx2}}>£{c.clv.toLocaleString()}</td>
              <td className="py-3 px-3 hidden sm:table-cell"><span className="text-violet-400 font-medium">{c.points.toLocaleString()}</span></td>
              <td className="py-3 px-3"><span className={`font-medium ${c.status==="Active"?"text-green-400":c.status==="At Risk"?"text-amber-400":"text-red-400"}`}>{c.status}</span></td>
            </tr>
          ))}</tbody></table></div>
      </div>
    </div>
  );
};

const TL_ICON:Record<string,any>={VISIT:ShoppingBag,MESSAGE:Send,POINTS:Star,TIER:Crown,SEGMENT:Users,REVIEW:Star,NOTE:FileText,CONSENT:Shield,JOINED:UserPlus};
const TL_COLOR:Record<string,string>={VISIT:"#22c55e",MESSAGE:"#3b82f6",POINTS:"#f59e0b",TIER:"#eab308",SEGMENT:"#8b5cf6",REVIEW:"#ec4899",NOTE:"#06b6d4",CONSENT:"#64748b",JOINED:"#8b5cf6"};

const CustomerProfile=({customer:c,onBack,onMsg}:{customer:any,onBack:()=>void,onMsg:(c:any)=>void})=>{
  const [tab,setTab]=useState<"overview"|"timeline"|"financials"|"referrals"|"notes">("overview");
  const [prof,setProf]=useState<any>(null);
  const [ledger,setLedger]=useState<any[]>([]);
  const [msgs,setMsgs]=useState<any[]>([]);
  const [loading,setLoading]=useState(true);
  // lazy-loaded per tab
  const [timeline,setTimeline]=useState<any[]|null>(null);
  const [fin,setFin]=useState<any>(null);
  const [refData,setRefData]=useState<any>(null);
  const [reviews,setReviews]=useState<any>(null);
  // editors
  const [tags,setTags]=useState<string[]>(c.tags??[]);
  const [newTag,setNewTag]=useState("");
  const [notes,setNotes]=useState<any[]>([]);
  const [noteBody,setNoteBody]=useState("");
  const [ptOpen,setPtOpen]=useState(false);const [ptAmt,setPtAmt]=useState("");const [ptDir,setPtDir]=useState<"CREDIT"|"DEBIT">("CREDIT");const [ptReason,setPtReason]=useState("");const [ptBusy,setPtBusy]=useState(false);

  useEffect(()=>{
    setLoading(true);
    api.customers.full(c.id).then(d=>{setProf(d);setTags(d.tags??[]);setNotes(d.notes??[]);}).catch(()=>{}).finally(()=>setLoading(false));
    api.customers.profile(c.id).then(d=>{setLedger(d.rewardPointsLedger??[]);setMsgs(d.messageQueue??[]);}).catch(()=>{});
  },[c.id]);
  useEffect(()=>{
    if(tab==="timeline"&&timeline===null)api.customers.timeline(c.id).then(d=>setTimeline(d.events??[])).catch(()=>setTimeline([]));
    if(tab==="financials"&&!fin)api.customers.financials(c.id).then(setFin).catch(()=>{});
    if(tab==="referrals"&&!refData){api.customers.referrals2(c.id).then(setRefData).catch(()=>{});api.customers.reviews(c.id).then(setReviews).catch(()=>{});}
  },[tab]);

  const p=prof??{};
  const addTag=async()=>{const t=newTag.trim();if(!t||tags.includes(t))return;const next=[...tags,t];setTags(next);setNewTag("");try{await api.customers.setTags(c.id,next);}catch{setTags(tags);}};
  const removeTag=async(t:string)=>{const next=tags.filter(x=>x!==t);setTags(next);try{await api.customers.setTags(c.id,next);}catch{setTags(tags);}};
  const addNote=async()=>{const b=noteBody.trim();if(!b)return;setNoteBody("");try{const n=await api.customers.addNote(c.id,b);setNotes([n,...notes]);}catch{}};
  const adjustPoints=async()=>{const n=Number(ptAmt);if(!n||n<=0)return;setPtBusy(true);try{await api.customers.adjustPoints(c.id,n,ptDir,ptReason||undefined);setPtOpen(false);setPtAmt("");setPtReason("");api.customers.profile(c.id).then(d=>setLedger(d.rewardPointsLedger??[])).catch(()=>{});api.customers.full(c.id).then(setProf).catch(()=>{});}catch(e:any){alert(e?.message||"Failed");}finally{setPtBusy(false);}};
  const delNote=async(id:string)=>{setNotes(notes.filter(n=>n.id!==id));try{await api.customers.deleteNote(c.id,id);}catch{}};

  const fav=p.favouriteProducts??[];const social=p.social??{};const prefs=p.preferences??{};
  const TABS:[string,string,any][]=[["overview","Overview",Users],["timeline","Timeline",Activity],["financials","Financials",DollarSign],["referrals","Reviews & Referrals",Gift],["notes","Notes & Tags",FileText]];

  return(
  <div className="space-y-4">
    <button onClick={onBack} className="flex items-center gap-1 text-xs text-slate-400 hover:text-white"><ChevronLeft size={14}/>Back to customers</button>
    {/* Header */}
    <div className="gc rounded-xl p-5" style={CARD}>
      <div className="flex items-start gap-4 flex-wrap">
        <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-white font-bold text-lg flex-shrink-0" style={{background:`linear-gradient(135deg,${SEG_COLORS[c.segment]||"#8b5cf6"},${SEG_COLORS[c.segment]||"#8b5cf6"}88)`}}>{c.name.split(" ").map((n:string)=>n[0]).join("")}</div>
        <div className="flex-1 min-w-48">
          <div className="flex items-center gap-2 flex-wrap"><h2 className="text-lg font-bold text-white">{c.name}</h2><Badge color={SEG_COLORS[c.segment as keyof typeof SEG_COLORS]||"#8b5cf6"}>{c.segment}</Badge><span className="px-2.5 py-1 rounded-lg text-xs font-bold flex items-center gap-1" style={{background:(TIER_COLORS[c.tier as keyof typeof TIER_COLORS]||"#6b7280")+"22",border:"1px solid "+(TIER_COLORS[c.tier as keyof typeof TIER_COLORS]||"#6b7280")+"44",color:TIER_COLORS[c.tier as keyof typeof TIER_COLORS]||"#6b7280"}}><Crown size={10}/>{p.membership?.tier||c.tier||"No Tier"}</span></div>
          <div className="text-xs text-slate-400 mt-1 flex flex-wrap gap-x-4 gap-y-1"><span className="flex items-center gap-1"><Phone size={10}/>{c.phone||"—"}</span>{p.email&&<span className="flex items-center gap-1"><Mail size={10}/>{p.email}</span>}{p.birthday&&<span className="flex items-center gap-1"><Gift size={10}/>{new Date(p.birthday).toLocaleDateString("en-GB",{day:"numeric",month:"short"})}</span>}{p.consent&&!p.consent.whatsapp&&<span className="flex items-center gap-1 text-amber-400"><EyeOff size={10}/>Opted-out</span>}</div>
          <div className="mt-2 flex items-center gap-2 flex-wrap text-xs text-slate-500"><Hash size={10}/><span className="font-mono text-violet-300">{c.referralCode}</span>{tags.map(t=><span key={t} className="px-1.5 py-0.5 rounded text-[10px] font-medium" style={{background:"rgba(6,182,212,0.15)",color:"#67e8f9"}}>{t}</span>)}</div>
        </div>
        <button onClick={()=>onMsg(c)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-white font-medium flex-shrink-0" style={{background:"linear-gradient(135deg,#25D366,#128C7E)"}}><WAIcon size={12} className="text-white"/>WhatsApp</button>
      </div>
    </div>
    {/* Stat strip */}
    <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">{[{l:"Visits",v:p.visitCount??c.visits},{l:"Total Spent",v:`£${(p.totalSpend??c.spent).toLocaleString()}`},{l:"Points",v:(p.membership?.pointsBalance??c.points).toLocaleString()},{l:"Churn Risk",v:`${c.churnRisk}%`,col:c.churnRisk>50?"#ef4444":"#22c55e"},{l:"Avg Rating",v:p.reviews?.avgScore?`${p.reviews.avgScore}★`:"—"},{l:"Referrals",v:p.referral?.referredCount??0}].map((s,i)=><div key={i} className="gc rounded-xl p-3 text-center" style={CARD}><div className="text-lg font-bold" style={{color:s.col||"white"}}>{s.v}</div><div className="text-xs text-slate-400">{s.l}</div></div>)}</div>
    {/* Tabs */}
    <div className="flex gap-1 p-1 rounded-xl overflow-x-auto" style={{background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.06)"}}>
      {TABS.map(([id,label,Icon])=><button key={id} onClick={()=>setTab(id as any)} className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-xs font-medium whitespace-nowrap transition-all ${tab===id?"text-white":"text-slate-400 hover:text-slate-200"}`} style={tab===id?{background:"linear-gradient(135deg,rgba(139,92,246,0.25),rgba(6,182,212,0.1))"}:{}}><Icon size={13}/>{label}</button>)}
    </div>

    {/* OVERVIEW */}
    {tab==="overview"&&<div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div className="gc rounded-xl p-4" style={CARD}>
        <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2"><UserCheck size={14} style={{color:C.accent}}/>Personal & Preferences</h3>
        {loading?<Skeleton h="h-32"/>:<div className="space-y-2.5 text-xs">
          {[["Gender",p.gender],["Address",p.address],["Joined",p.createdAt?new Date(p.createdAt).toLocaleDateString("en-GB"):null],["First visit",p.firstVisitAt?new Date(p.firstVisitAt).toLocaleDateString("en-GB"):null],["Last visit",p.lastVisitAt?timeAgo(p.lastVisitAt):"Never"]].filter(r=>r[1]).map(([l,v])=><div key={l} className="flex justify-between"><span className="text-slate-500">{l}</span><span className="text-slate-200">{v}</span></div>)}
          {fav.length>0&&<div className="pt-2 border-t border-white/5"><div className="text-slate-500 mb-1.5">Favourite products</div><div className="flex flex-wrap gap-1">{fav.map((f:string)=><span key={f} className="px-2 py-0.5 rounded text-[10px]" style={{background:"rgba(245,158,11,0.15)",color:"#fbbf24"}}>{f}</span>)}</div></div>}
          {Object.keys(prefs).length>0&&<div className="pt-2 border-t border-white/5">{Object.entries(prefs).map(([k,v])=><div key={k} className="flex justify-between"><span className="text-slate-500 capitalize">{k}</span><span className="text-slate-200">{String(v)}</span></div>)}</div>}
          {Object.keys(social).length>0&&<div className="pt-2 border-t border-white/5 flex flex-wrap gap-2">{Object.entries(social).map(([k,v])=><span key={k} className="px-2 py-0.5 rounded text-[10px] flex items-center gap-1" style={{background:"rgba(139,92,246,0.15)",color:"#c4b5fd"}}><Link size={9}/>{k}: {String(v)}</span>)}</div>}
        </div>}
      </div>
      <div className="gc rounded-xl p-4" style={CARD}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2"><Star size={14} style={{color:C.amber}}/>Points Ledger</h3>
          <button onClick={()=>setPtOpen(o=>!o)} className="flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-lg" style={{background:C.primary+"22",color:"#c4b5fd"}}><Plus size={11}/>Adjust points</button>
        </div>
        {ptOpen&&<div className="mb-3 p-3 rounded-lg space-y-2" style={{background:"rgba(139,92,246,0.08)",border:"1px solid rgba(139,92,246,0.2)"}}>
          <div className="flex gap-2">
            <select value={ptDir} onChange={e=>setPtDir(e.target.value as any)} className="px-2 py-1.5 rounded-lg text-xs outline-none" style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)",color:"white"}}><option value="CREDIT">Give</option><option value="DEBIT">Remove</option></select>
            <input type="number" value={ptAmt} onChange={e=>setPtAmt(e.target.value)} placeholder="Points" className="w-24 px-2 py-1.5 rounded-lg text-xs outline-none" style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)",color:"white"}}/>
            <input value={ptReason} onChange={e=>setPtReason(e.target.value)} placeholder="Reason (optional)" className="flex-1 px-2 py-1.5 rounded-lg text-xs outline-none" style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)",color:"white"}}/>
          </div>
          <button onClick={adjustPoints} disabled={ptBusy} className="w-full py-1.5 rounded-lg text-xs font-semibold text-white disabled:opacity-50" style={{background:"linear-gradient(135deg,#8b5cf6,#7c3aed)"}}>{ptBusy?"Saving…":ptDir==="CREDIT"?`Give ${ptAmt||0} points`:`Remove ${ptAmt||0} points`}</button>
        </div>}
        {loading?<Skeleton h="h-32"/>:ledger.length===0?<p className="text-xs text-slate-500 text-center py-6">No points activity yet</p>:
        <div className="space-y-1 max-h-56 overflow-y-auto">{ledger.map((l:any,i:number)=><div key={l.id||i} className="flex items-center gap-3 py-2 px-3 rounded-lg" style={{background:"rgba(255,255,255,0.02)"}}><div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs flex-shrink-0 ${l.type==="CREDIT"?"bg-green-500/20 text-green-400":"bg-red-500/20 text-red-400"}`}>{l.type==="CREDIT"?"+":"-"}</div><div className="flex-1 min-w-0"><div className="text-xs text-white font-medium truncate">{l.reason||"Transaction"}</div></div><div className="text-right flex-shrink-0"><div className={`text-xs font-bold ${l.type==="CREDIT"?"text-green-400":"text-red-400"}`}>{l.type==="CREDIT"?"+":"-"}{l.points}pts</div><div className="text-xs text-slate-500">{(l.balanceAfter??0).toLocaleString()} bal</div></div></div>)}</div>}
      </div>
    </div>}

    {/* TIMELINE */}
    {tab==="timeline"&&<div className="gc rounded-xl p-4" style={CARD}>
      <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2"><Activity size={14} style={{color:C.primary}}/>Customer Timeline</h3>
      {timeline===null?<Skeleton h="h-40"/>:timeline.length===0?<p className="text-xs text-slate-500 text-center py-8">No history yet.</p>:
      <div className="relative pl-1">{timeline.map((e,i)=>{const Icon=TL_ICON[e.type]||CircleCheck;const col=TL_COLOR[e.type]||"#8b5cf6";return(
        <div key={i} className="flex gap-3 pb-4 relative">
          {i<timeline.length-1&&<div className="absolute left-[13px] top-7 bottom-0 w-px" style={{background:"rgba(255,255,255,0.08)"}}/>}
          <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 z-10" style={{background:col+"22"}}><Icon size={13} style={{color:col}}/></div>
          <div className="flex-1 min-w-0 pt-0.5"><div className="flex items-center justify-between gap-2"><span className="text-xs font-semibold text-white">{e.title}</span><span className="text-[10px] text-slate-500 flex-shrink-0">{e.at?timeAgo(e.at):""}</span></div>{e.detail&&<div className="text-[11px] text-slate-400 mt-0.5 break-words">{e.detail}</div>}</div>
        </div>);})}</div>}
    </div>}

    {/* FINANCIALS */}
    {tab==="financials"&&<div className="space-y-4">
      {!fin?<Skeleton h="h-24"/>:<>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KPI icon={DollarSign} label="Lifetime Value" value={`£${fin.lifetimeValue.toLocaleString()}`} color={C.green} sub="actual spend to date"/>
          <KPI icon={TrendingUp} label="Predicted CLV" value={`£${fin.predictedClv.toLocaleString()}`} color={C.primary} sub="24-month projection"/>
          <KPI icon={ShoppingBag} label="Avg Order Value" value={`£${fin.averageOrderValue.toLocaleString()}`} color={C.blue}/>
          <KPI icon={Activity} label="Revenue Share" value={`${fin.revenueContribution}%`} color={C.amber} sub="of total business revenue"/>
        </div>
        <div className="gc rounded-xl p-4" style={CARD}>
          <h3 className="text-sm font-semibold text-white mb-3">Spending Behaviour</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            {[["Total visits",fin.visitCount],["Visits / month",fin.visitsPerMonth],["Last 90d spend",`£${fin.last90Spend.toLocaleString()}`],["Last 90d visits",fin.last90Visits],["Retention prob.",`${Math.round(fin.retentionProbability*100)}%`]].map(([l,v])=><div key={l as string} className="p-3 rounded-lg" style={{background:"rgba(255,255,255,0.02)"}}><div className="text-base font-bold text-white">{v}</div><div className="text-slate-500 mt-0.5">{l}</div></div>)}
          </div>
          <p className="text-[11px] text-slate-500 mt-3 flex items-start gap-1.5"><Info size={12} className="mt-0.5 flex-shrink-0"/>Predicted CLV projects {fin.visitsPerMonth}/mo visits at £{fin.averageOrderValue} AOV over 24 months, discounted by this customer's retention probability ({Math.round(fin.retentionProbability*100)}%).</p>
        </div>
      </>}
    </div>}

    {/* REVIEWS & REFERRALS */}
    {tab==="referrals"&&<div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div className="gc rounded-xl p-4" style={CARD}>
        <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2"><Gift size={14} style={{color:C.pink}}/>Referrals</h3>
        {!refData?<Skeleton h="h-24"/>:<>
          <div className="grid grid-cols-2 gap-3 mb-3"><div className="p-3 rounded-lg text-center" style={{background:"rgba(236,72,153,0.1)"}}><div className="text-xl font-bold text-white">{refData.referredCount}</div><div className="text-[11px] text-slate-400">customers referred</div></div><div className="p-3 rounded-lg text-center" style={{background:"rgba(34,197,94,0.1)"}}><div className="text-xl font-bold text-green-400">£{refData.referralRevenue.toLocaleString()}</div><div className="text-[11px] text-slate-400">referral revenue</div></div></div>
          {refData.referrer&&<div className="text-[11px] text-slate-400 mb-2">Referred by <span className="text-violet-300">{refData.referrer.fullName}</span></div>}
          {refData.referred?.length>0?<div className="space-y-1 max-h-44 overflow-y-auto">{refData.referred.map((r:any)=><div key={r.id} className="flex items-center justify-between text-xs py-1.5 px-2 rounded" style={{background:"rgba(255,255,255,0.02)"}}><span className="text-slate-300 truncate">{r.fullName}</span><span className="text-green-400">£{r.totalSpend.toLocaleString()}</span></div>)}</div>:<p className="text-[11px] text-slate-500 text-center py-4">No referrals yet. Share their code <span className="font-mono text-violet-300">{refData.referralCode}</span> to start.</p>}
        </>}
      </div>
      <div className="gc rounded-xl p-4" style={CARD}>
        <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2"><Star size={14} style={{color:C.amber}}/>Feedback History</h3>
        {!reviews?<Skeleton h="h-24"/>:reviews.count===0?<p className="text-[11px] text-slate-500 text-center py-6">No feedback collected yet.</p>:<>
          <div className="flex items-center gap-2 mb-3"><span className="text-2xl font-bold text-white">{reviews.avgScore}</span><span className="text-amber-400">★</span><span className="text-[11px] text-slate-400">avg · {reviews.count} review{reviews.count===1?"":"s"}</span></div>
          <div className="space-y-1.5 max-h-44 overflow-y-auto">{reviews.reviews.map((r:any)=><div key={r.id} className="py-2 px-3 rounded-lg text-xs" style={{background:"rgba(255,255,255,0.02)"}}><div className="flex items-center justify-between"><span style={{color:r.score>=4?"#22c55e":r.score>=3?"#f59e0b":"#ef4444"}}>{"★".repeat(r.score)}{"☆".repeat(5-r.score)}</span><span className="text-slate-600 text-[10px]">{timeAgo(r.createdAt)}</span></div>{r.comment&&<div className="text-slate-400 mt-1">{r.comment}</div>}</div>)}</div>
        </>}
      </div>
    </div>}

    {/* NOTES & TAGS */}
    {tab==="notes"&&<div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div className="gc rounded-xl p-4" style={CARD}>
        <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2"><Tag size={14} style={{color:C.accent}}/>Tags</h3>
        <div className="flex flex-wrap gap-1.5 mb-3">{tags.length===0&&<span className="text-[11px] text-slate-500">No tags yet.</span>}{tags.map(t=><span key={t} className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px]" style={{background:"rgba(6,182,212,0.15)",color:"#67e8f9"}}>{t}<X size={11} className="cursor-pointer hover:text-white" onClick={()=>removeTag(t)}/></span>)}</div>
        <div className="flex gap-2"><input value={newTag} onChange={e=>setNewTag(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addTag()} placeholder="Add a tag (e.g. regular, vegan)…" className="flex-1 px-3 py-2 rounded-lg text-xs placeholder-slate-500 outline-none" style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.08)",color:"white"}}/><button onClick={addTag} className="px-3 py-2 rounded-lg text-xs text-white" style={{background:C.accent}}><Plus size={13}/></button></div>
      </div>
      <div className="gc rounded-xl p-4" style={CARD}>
        <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2"><FileText size={14} style={{color:C.primary}}/>Staff Notes</h3>
        <div className="flex gap-2 mb-3"><input value={noteBody} onChange={e=>setNoteBody(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addNote()} placeholder="Add a private note about this customer…" className="flex-1 px-3 py-2 rounded-lg text-xs placeholder-slate-500 outline-none" style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.08)",color:"white"}}/><button onClick={addNote} className="px-3 py-2 rounded-lg text-xs text-white" style={{background:C.primary}}><Send size={13}/></button></div>
        {notes.length===0?<p className="text-[11px] text-slate-500 text-center py-4">No notes yet. Context here helps every team member serve this customer better.</p>:
        <div className="space-y-2 max-h-56 overflow-y-auto">{notes.map(n=><div key={n.id} className="group py-2 px-3 rounded-lg text-xs" style={{background:"rgba(255,255,255,0.02)"}}><div className="flex items-center justify-between"><span className="text-slate-300">{n.body}</span><X size={12} className="text-slate-600 opacity-0 group-hover:opacity-100 cursor-pointer hover:text-red-400 flex-shrink-0 ml-2" onClick={()=>delNote(n.id)}/></div><div className="text-[10px] text-slate-600 mt-1">{n.authorName||"Staff"} · {timeAgo(n.createdAt)}</div></div>)}</div>}
      </div>
    </div>}
  </div>
  );
};

// ════════════════════════════════════════════════════════════════
// MESSAGES
// ════════════════════════════════════════════════════════════════
const MetaWizard=({onDone,onClose}:any)=>{
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
    api.customers.list({limit:50,q:search}).then(d=>setCustomers(d.customers??[])).catch(()=>{});
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
          <PhoneInput value={phone} onChange={setPhone} inputStyle={{background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)",padding:"7px 10px",fontSize:"12px"}}/>
        </div>}

        {/* Message */}
        <div>
          <label className="text-xs text-slate-400 mb-1 block">Message</label>
          <textarea value={message} onChange={e=>setMessage(e.target.value)} rows={4} placeholder="Type your message here…" className="w-full px-3 py-2 rounded-lg text-xs text-white outline-none resize-none" style={{background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)"}}/>
          <div className="text-right text-xs text-slate-600 mt-0.5">{message.length} chars</div>
        </div>

        <QuotaBanner/>
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

// ── Live two-way WhatsApp inbox ───────────────────────────────────
const chatTime=(ts:number|null)=>{if(!ts)return"";const d=new Date(ts);const now=new Date();const sameDay=d.toDateString()===now.toDateString();return sameDay?d.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}):d.toLocaleDateString([],{day:"2-digit",month:"short"});};
const InboxView=({connected}:{connected:boolean})=>{
  const {dark}=useTheme();
  const [convos,setConvos]=useState<any[]>([]);
  const [active,setActive]=useState<any>(null);
  const [thread,setThread]=useState<any[]>([]);
  const [reply,setReply]=useState("");
  const [sending,setSending]=useState(false);
  const [loading,setLoading]=useState(true);
  const threadRef=useRef<HTMLDivElement>(null);
  const token=()=>localStorage.getItem("accessToken")??"";
  const fetchConvos=async()=>{
    try{const r=await fetch("/api/messages/inbox",{headers:{Authorization:`Bearer ${token()}`}});const d=await r.json();setConvos(d.conversations??[]);}catch{}finally{setLoading(false);}
  };
  const fetchThread=async(chatId:string)=>{
    try{const r=await fetch(`/api/messages/inbox/${encodeURIComponent(chatId)}`,{headers:{Authorization:`Bearer ${token()}`}});const d=await r.json();setThread(d.messages??[]);}catch{}
  };
  useEffect(()=>{fetchConvos();const iv=setInterval(fetchConvos,8000);return()=>clearInterval(iv);},[]);
  useEffect(()=>{if(active){fetchThread(active.chatId);const iv=setInterval(()=>fetchThread(active.chatId),5000);return()=>clearInterval(iv);}},[active?.chatId]);
  useEffect(()=>{if(threadRef.current)threadRef.current.scrollTop=threadRef.current.scrollHeight;},[thread]);
  const sendReply=async()=>{
    if(!reply.trim()||!active)return;
    setSending(true);
    try{
      await fetch("/api/messages/send",{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${token()}`},body:JSON.stringify({phone:active.phone,message:reply.trim()})});
      setReply("");fetchThread(active.chatId);fetchConvos();
    }catch{}finally{setSending(false);}
  };
  const bg=dark?"#0f0a1e":"#f4f2fb";
  const card=dark?"rgba(255,255,255,0.04)":"#fff";
  const border=dark?"rgba(255,255,255,0.08)":"rgba(124,58,237,0.1)";
  const txt=dark?"#e2d9f3":"#1e1333";
  const sub=dark?"#9488b8":"#6b7280";
  if(!connected)return(
    <div className="rounded-xl p-12 flex flex-col items-center justify-center text-center" style={{background:card,border:`1px solid ${border}`}}>
      <MessageSquare size={32} className="text-slate-500 mb-3"/>
      <p className="text-sm font-medium" style={{color:sub}}>Connect WhatsApp in Settings to see your inbox</p>
    </div>
  );
  const phoneRe=/^\+?\d[\d\s-]+$/;
  return(
    <div className="flex rounded-xl overflow-hidden" style={{height:"calc(100vh - 200px)",background:card,border:`1px solid ${border}`}}>
      {/* Conversation list */}
      <div className="w-72 flex-shrink-0 flex flex-col border-r" style={{borderColor:border}}>
        <div className="p-3 border-b text-xs font-semibold" style={{borderColor:border,color:sub}}>CONVERSATIONS</div>
        <div className="flex-1 overflow-y-auto">
          {loading?<div className="p-4 text-center"><RefreshCw size={18} className="animate-spin text-slate-500 mx-auto"/></div>
          :convos.length===0?<div className="p-6 text-center text-xs" style={{color:sub}}>No messages yet.<br/>Send a message to start a conversation.</div>
          :convos.map(c=>{
            const hasRealName=c.name&&c.name!==c.phone&&!phoneRe.test(c.name);
            const displayName=hasRealName?c.name:c.phone||"Unknown";
            const displayPhone=hasRealName?c.phone:null;
            return(
            <div key={c.chatId} onClick={()=>setActive(c)} className="flex items-center gap-3 p-3 cursor-pointer transition-colors" style={{background:active?.chatId===c.chatId?(dark?"rgba(139,92,246,0.15)":"rgba(139,92,246,0.08)"):"transparent"}}>
              <div className="w-10 h-10 rounded-full flex-shrink-0 flex items-center justify-center text-sm font-bold text-white" style={{background:"linear-gradient(135deg,#8b5cf6,#6d28d9)"}}>{displayName[0]?.toUpperCase()||"?"}</div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <div className="min-w-0 flex-1">
                    <span className="text-xs font-semibold truncate block" style={{color:txt}}>{displayName}</span>
                    {displayPhone&&<span className="text-xs truncate block" style={{color:sub,fontSize:"10px"}}>{displayPhone}</span>}
                  </div>
                  <span className="text-xs flex-shrink-0 ml-1" style={{color:sub}}>{chatTime(c.timestamp)}</span>
                </div>
                <p className="text-xs truncate mt-0.5" style={{color:sub}}>{c.lastFromMe?"You: ":""}{c.lastText||"…"}</p>
              </div>
              {c.unread>0&&<div className="w-4 h-4 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0" style={{background:"#25D366",fontSize:"10px"}}>{c.unread}</div>}
            </div>
          );})}
        </div>
      </div>
      {/* Thread */}
      <div className="flex-1 flex flex-col">
        {!active?(
          <div className="flex-1 flex items-center justify-center flex-col gap-2" style={{color:sub}}>
            <MessageSquare size={32} className="opacity-30"/>
            <p className="text-sm">Select a conversation</p>
          </div>
        ):(
          <>
            <div className="flex items-center gap-3 p-3 border-b" style={{borderColor:border}}>
              <div className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold text-white flex-shrink-0" style={{background:"linear-gradient(135deg,#8b5cf6,#6d28d9)"}}>
                {(active.name&&active.name!==active.phone&&!phoneRe.test(active.name)?active.name:active.phone||"?")[0]?.toUpperCase()}
              </div>
              <div>
                {active.name&&active.name!==active.phone&&!phoneRe.test(active.name)
                  ?<><p className="text-sm font-semibold" style={{color:txt}}>{active.name}</p><p className="text-xs" style={{color:sub}}>{active.phone}</p></>
                  :<p className="text-sm font-semibold" style={{color:txt}}>{active.phone||active.name}</p>
                }
              </div>
            </div>
            <div ref={threadRef} className="flex-1 overflow-y-auto p-4 space-y-2">
              {thread.map((m,i)=>(
                <div key={m.id??i} className={`flex ${m.fromMe?"justify-end":"justify-start"}`}>
                  <div className="max-w-xs px-3 py-2 rounded-xl text-sm" style={{background:m.fromMe?"linear-gradient(135deg,#8b5cf6,#7c3aed)":dark?"rgba(255,255,255,0.08)":"rgba(0,0,0,0.06)",color:m.fromMe?"#fff":txt,borderRadius:m.fromMe?"16px 16px 4px 16px":"16px 16px 16px 4px"}}>
                    <p style={{wordBreak:"break-word"}}>{m.body}</p>
                    <p className="text-xs mt-1 opacity-60 text-right">{chatTime(m.timestamp)}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="p-3 border-t flex gap-2" style={{borderColor:border}}>
              <input value={reply} onChange={e=>setReply(e.target.value)} onKeyDown={e=>e.key==="Enter"&&!e.shiftKey&&sendReply()} placeholder="Type a reply…" className="flex-1 px-3 py-2 rounded-xl text-sm outline-none" style={{background:dark?"rgba(255,255,255,0.07)":"rgba(0,0,0,0.04)",border:`1px solid ${border}`,color:txt}}/>
              <button onClick={sendReply} disabled={!reply.trim()||sending} className="px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50" style={{background:"linear-gradient(135deg,#25D366,#128C7E)"}}>
                {sending?<RefreshCw size={14} className="animate-spin"/>:<Send size={14}/>}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

const MessagesPage=({onConnect}:{onConnect:()=>void})=>{
  const ct=useCard();
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
          <h1 className="text-xl font-bold" style={{color:ct.tx}}>Messages</h1>
          <p className="text-xs flex items-center gap-1.5 mt-0.5" style={{color:ct.tx2}}>
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
      {byStatus.length>0&&<div className="flex flex-wrap gap-2">{byStatus.map(({s,c,n})=><div key={s} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs" style={{background:c+"14",border:"1px solid "+(c)+"30"}}><div className="w-2 h-2 rounded-full" style={{background:c}}/><span className="text-slate-300">{s}</span><span className="font-bold ml-1" style={{color:c}}>{n}</span></div>)}</div>}
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
const CB_TEMPLATES=[
  {label:"Win-Back",emoji:"💔",seg:"AT_RISK",msg:"Hey {name}! 👋 We miss you at {biz}. It's been a while — come back this week and enjoy a special treat just for you. We'd love to see you again! ❤️"},
  {label:"Birthday",emoji:"🎂",seg:"ALL",msg:"Happy Birthday {name}! 🎉🎂 The whole team at {biz} is wishing you an amazing day. As our gift to you, enjoy a special surprise on your next visit. Come celebrate with us!"},
  {label:"Flash Sale",emoji:"⚡",seg:"LOYAL",msg:"Flash sale alert, {name}! ⚡ For the next 24 hours only, {biz} is offering exclusive deals for loyal customers like you. Don't miss out — visit us today!"},
  {label:"New Offer",emoji:"🎁",seg:"ALL",msg:"Hi {name}! We have something exciting for you at {biz} 🎁 A brand new offer is waiting — just for you. Visit us soon and ask about our latest deals!"},
  {label:"Thank You",emoji:"🌟",seg:"VIP",msg:"Thank you for being such a loyal customer, {name}! 🌟 You mean the world to us at {biz}. As a small token of our appreciation, we have a VIP surprise waiting for you on your next visit."},
  {label:"Re-engage",emoji:"🔔",seg:"LOST",msg:"Hey {name}, we haven't seen you in a while! 🔔 Things have changed at {biz} — new menu, new look, new offers. Come see what's new and we'll make sure your visit is extra special."},
];

const SEGMENT_LABELS:Record<string,string>={ALL:"Everyone",NEW:"New customers (1st visit)",LOYAL:"Regular customers",VIP:"VIP / top spenders",AT_RISK:"Haven't visited recently",LOST:"Long-term absent customers",BIG_SPENDER:"High-value customers",COUPON_HUNTER:"Offer-seekers"};

const CampaignBuilderPage=({onBack}:any)=>{
  const bizName=localStorage.getItem("biz_name")||"Your Business";
  const [cName,setCName]=useState("");
  const [msgText,setMsgText]=useState(`Hey {name}! 👋 We have something special for you at ${bizName}. Come visit us soon!`);
  const [couponCode,setCouponCode]=useState("");
  const [couponDesc,setCouponDesc]=useState("");
  const [buttonLabel,setButtonLabel]=useState("");
  const [buttonUrl,setButtonUrl]=useState("");
  const [imageUrl,setImageUrl]=useState("");
  const [cSegment,setCSegment]=useState("ALL");
  const [cChannel,setCChannel]=useState("WHATSAPP_WAHA");
  const [cSchedule,setCSchedule]=useState("");
  const [saving,setSaving]=useState<""|"draft"|"launch">("");
  const [saveMsg,setSaveMsg]=useState<{ok:boolean;text:string}|null>(null);
  const [aiPrompt,setAiPrompt]=useState("");
  const [aiLoading,setAiLoading]=useState(false);
  const [showExtras,setShowExtras]=useState(false);

  const previewText=msgText.replace(/\{name\}/g,"Sarah").replace(/\{biz\}/g,bizName);
  const charCount=msgText.length;

  const applyTemplate=(t:typeof CB_TEMPLATES[0])=>{
    setMsgText(t.msg.replace(/\{biz\}/g,bizName));
    setCSegment(t.seg);
    if(!cName)setCName(`${t.label} Campaign`);
  };

  const buildLayout=()=>{
    const blk:any[]=[];
    if(imageUrl.trim())blk.push({id:"img1",type:"IMAGE",order:0,mediaUrl:imageUrl.trim()});
    blk.push({id:"txt1",type:"TEXT",order:blk.length,content:msgText||"Hello {name}!"});
    if(couponCode.trim())blk.push({id:"cp1",type:"COUPON",order:blk.length,couponCode:couponCode.trim(),discountText:couponDesc.trim()||"Special offer"});
    if(buttonLabel.trim()&&/^https?:\/\/\S+$/i.test(buttonUrl.trim()))blk.push({id:"btn1",type:"URL_BUTTON",order:blk.length,label:buttonLabel.trim().slice(0,25),url:buttonUrl.trim()});
    return {blocks:blk};
  };

  const save=async(launch:boolean)=>{
    if(!cName.trim()){setSaveMsg({ok:false,text:"Please give your campaign a name."});return;}
    if(!msgText.trim()){setSaveMsg({ok:false,text:"Please write your message."});return;}
    setSaving(launch?"launch":"draft");setSaveMsg(null);
    try{
      const body:any={name:cName.trim(),targetSegment:cSegment,channel:cChannel,layoutJson:buildLayout()};
      if(cSchedule)body.scheduledFor=new Date(cSchedule).toISOString();
      const created=await api.campaigns.create(body);
      const id=created?.id;
      if(launch&&id){
        await api.campaigns.launch(id);
        setSaveMsg({ok:true,text:`🚀 Launched! Messages are being sent to your "${SEGMENT_LABELS[cSegment]||cSegment}" customers.`});
      }else{
        setSaveMsg({ok:true,text:cSchedule?`✅ Scheduled! Your campaign will send on the date you selected.`:`✅ Saved as draft. You can launch it any time from the Campaigns page.`});
      }
      setTimeout(()=>onBack(),1800);
    }catch(e:any){
      const msg=e?.message||"Failed to save";
      setSaveMsg({ok:false,text:msg==="FEATURE_NOT_AVAILABLE"?"Campaigns aren't on your current plan — upgrade in Settings → Billing.":`Something went wrong: ${msg}`});
    }finally{setSaving("");}
  };

  const runAI=async()=>{
    if(!aiPrompt.trim())return;
    setAiLoading(true);
    try{
      const d=await api.ai.generateMessage(aiPrompt, bizName);
      if(d.message) setMsgText(d.message);
    }catch{
      setMsgText(`Hey {name}! 👋 ${aiPrompt} at ${bizName}. We'd love to see you soon!`);
    }finally{setAiLoading(false);setAiPrompt("");}
  };

  return(
    <div className="space-y-5 pb-8">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-white/5"><ChevronLeft size={20}/></button>
        <div><h1 className="text-xl font-bold text-white">New Campaign</h1><p className="text-xs text-slate-400 mt-0.5">Write your message, choose who gets it, then send.</p></div>
      </div>

      {/* Quick Templates */}
      <div>
        <p className="text-xs text-slate-400 mb-2 font-medium">Start from a template</p>
        <div className="flex flex-wrap gap-2">
          {CB_TEMPLATES.map(t=>(
            <button key={t.label} onClick={()=>applyTemplate(t)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-all hover:opacity-90" style={{background:"rgba(139,92,246,0.1)",border:"1px solid rgba(139,92,246,0.2)",color:"#c4b5fd"}}>
              <span>{t.emoji}</span>{t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* LEFT: Compose */}
        <div className="space-y-4">
          {/* Campaign name */}
          <div className="gc rounded-xl p-4" style={CARD}>
            <label className="text-xs font-semibold text-slate-300 mb-1.5 block">Campaign Name</label>
            <input value={cName} onChange={e=>setCName(e.target.value)} placeholder="e.g. Summer Win-Back, Birthday Special…" className="w-full px-3 py-2.5 rounded-lg text-sm text-white outline-none" style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)"}}/>
          </div>

          {/* Message composer */}
          <div className="gc rounded-xl p-4" style={CARD}>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold text-slate-300">Your Message</label>
              <span className={`text-[10px] font-medium ${charCount>1000?"text-red-400":charCount>800?"text-amber-400":"text-slate-500"}`}>{charCount}/1000</span>
            </div>
            <textarea value={msgText} onChange={e=>setMsgText(e.target.value)} rows={5} placeholder="Write your message here…" className="w-full px-3 py-2.5 rounded-xl text-sm text-white resize-y outline-none leading-relaxed" style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)"}}/>
            <div className="flex flex-wrap gap-1.5 mt-2">
              {["{name}","{biz}"].map(tok=>(
                <button key={tok} onClick={()=>setMsgText(p=>p+" "+tok)} className="px-2 py-0.5 rounded-md text-[11px] font-mono" style={{background:"rgba(139,92,246,0.12)",border:"1px solid rgba(139,92,246,0.2)",color:"#a78bfa"}}>{tok}</button>
              ))}
              <span className="text-[10px] text-slate-600 self-center ml-1">click to insert personalisation</span>
            </div>
          </div>

          {/* AI assistant */}
          <div className="gc rounded-xl p-4" style={CARD}>
            <div className="flex items-center gap-2 mb-2"><Brain size={13} className="text-violet-400"/><span className="text-xs font-semibold text-slate-300">Write with AI</span><span className="text-[10px] px-1.5 py-0.5 rounded-md" style={{background:"rgba(6,182,212,0.1)",color:"#06b6d4"}}>Beta</span></div>
            <div className="flex gap-2">
              <input value={aiPrompt} onChange={e=>setAiPrompt(e.target.value)} onKeyDown={e=>e.key==="Enter"&&runAI()} placeholder='e.g. "20% off this weekend only"' className="flex-1 px-3 py-2 rounded-lg text-xs text-white placeholder-slate-500 outline-none" style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.08)"}}/>
              <button onClick={runAI} disabled={!aiPrompt||aiLoading} className="px-3 py-2 rounded-lg text-xs font-medium text-white flex items-center gap-1.5 disabled:opacity-40 flex-shrink-0" style={{background:"linear-gradient(135deg,#8b5cf6,#7c3aed)"}}>{aiLoading?<RefreshCw size={12} className="animate-spin"/>:<Zap size={12}/>}{aiLoading?"Writing…":"Generate"}</button>
            </div>
          </div>

          {/* Optional extras */}
          <div className="gc rounded-xl p-4" style={CARD}>
            <button onClick={()=>setShowExtras(p=>!p)} className="w-full flex items-center justify-between text-xs font-semibold text-slate-300">
              <span>Add extras (coupon, image, button link)</span>
              {showExtras?<ChevronUp size={14}/>:<ChevronDown size={14}/>}
            </button>
            {showExtras&&<div className="space-y-3 mt-3 pt-3 border-t border-white/5">
              <div>
                <label className="text-xs text-slate-400 mb-1 block">Coupon Code (optional)</label>
                <div className="grid grid-cols-2 gap-2">
                  <input value={couponCode} onChange={e=>setCouponCode(e.target.value.toUpperCase())} placeholder="e.g. SAVE20" className="px-3 py-2 rounded-lg text-xs text-white outline-none" style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.08)"}}/>
                  <input value={couponDesc} onChange={e=>setCouponDesc(e.target.value)} placeholder="e.g. 20% off your next visit" className="px-3 py-2 rounded-lg text-xs text-white outline-none" style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.08)"}}/>
                </div>
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">Image URL (optional)</label>
                <input value={imageUrl} onChange={e=>setImageUrl(e.target.value)} placeholder="https://your-image.com/photo.jpg" className="w-full px-3 py-2 rounded-lg text-xs text-white outline-none" style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.08)"}}/>
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">Button Link (optional)</label>
                <div className="grid grid-cols-2 gap-2">
                  <input value={buttonLabel} onChange={e=>setButtonLabel(e.target.value)} placeholder="e.g. Book Now" className="px-3 py-2 rounded-lg text-xs text-white outline-none" style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.08)"}}/>
                  <input value={buttonUrl} onChange={e=>setButtonUrl(e.target.value)} placeholder="https://…" className="px-3 py-2 rounded-lg text-xs text-white outline-none" style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.08)"}}/>
                </div>
              </div>
            </div>}
          </div>
        </div>

        {/* RIGHT: Preview + Settings */}
        <div className="space-y-4">
          {/* Phone preview */}
          <div className="gc rounded-xl p-4 flex flex-col items-center" style={CARD}>
            <p className="text-xs font-semibold text-slate-300 mb-3 self-start">Live Preview</p>
            <div className="w-56 rounded-3xl p-2" style={{background:"#1a1a2e",border:"2px solid rgba(255,255,255,0.1)"}}>
              <div className="h-4 flex items-center justify-center mb-1"><div className="w-12 h-1 rounded-full bg-white/20"/></div>
              <div className="rounded-2xl overflow-hidden" style={{background:"#0b1628"}}>
                <div className="flex items-center gap-2 p-2" style={{background:"#1e3a2f"}}>
                  <div className="w-7 h-7 rounded-full bg-green-500 flex items-center justify-center text-white text-xs font-bold">{bizName.slice(0,1).toUpperCase()}</div>
                  <div className="text-xs text-white font-medium truncate">{bizName}</div>
                  <div className="ml-auto text-green-400 text-[10px]">●</div>
                </div>
                <div className="p-2 space-y-2 min-h-32">
                  {imageUrl&&<div className="w-full h-20 rounded-lg overflow-hidden bg-white/5"><img src={imageUrl} alt="" className="w-full h-full object-cover" onError={e=>(e.currentTarget.style.display="none")}/></div>}
                  {previewText&&<div className="rounded-2xl rounded-tl-sm p-2.5 max-w-[90%]" style={{background:"rgba(255,255,255,0.08)"}}><p className="text-white text-[11px] leading-relaxed whitespace-pre-wrap">{previewText}</p></div>}
                  {couponCode&&<div className="rounded-xl p-2 text-center" style={{background:"rgba(245,158,11,0.15)",border:"1px dashed rgba(245,158,11,0.4)"}}><div className="text-amber-300 font-bold text-xs tracking-widest">{couponCode}</div><div className="text-amber-200/70 text-[10px] mt-0.5">{couponDesc||"Special offer"}</div></div>}
                  {buttonLabel&&buttonUrl&&<div className="rounded-xl py-1.5 text-center" style={{background:"rgba(139,92,246,0.2)",border:"1px solid rgba(139,92,246,0.3)"}}><span className="text-violet-300 text-[11px] font-medium">{buttonLabel}</span></div>}
                </div>
                <div className="p-2 flex gap-1" style={{background:"#1e3a2f"}}><div className="flex-1 rounded-full text-[10px] px-2 py-1 text-slate-500" style={{background:"rgba(255,255,255,0.05)"}}>Message</div><div className="w-6 h-6 rounded-full flex items-center justify-center" style={{background:"#25D366"}}><Send size={10} className="text-white"/></div></div>
              </div>
            </div>
            <p className="text-[10px] text-slate-500 mt-2 text-center"><span className="text-violet-300 font-mono">{"{name}"}</span> will be replaced with each customer's real name</p>
          </div>

          {/* Audience & Send settings */}
          <div className="gc rounded-xl p-4" style={CARD}>
            <h3 className="text-xs font-semibold text-slate-300 mb-3">Who & When</h3>
            <QuotaBanner/>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-slate-400 mb-1 block">Who receives this?</label>
                <select value={cSegment} onChange={e=>setCSegment(e.target.value)} className="w-full px-3 py-2.5 rounded-lg text-xs text-white outline-none" style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)"}}>
                  {Object.entries(SEGMENT_LABELS).map(([v,l])=><option key={v} value={v} style={{background:"#1a1030"}}>{l}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">Send via</label>
                <div className="grid grid-cols-3 gap-2">
                  {[{v:"WHATSAPP_WAHA",l:"WhatsApp",ico:"💬"},{v:"EMAIL",l:"Email",ico:"📧"}].map(ch=>(
                    <button key={ch.v} onClick={()=>setCChannel(ch.v)} className={`py-2 rounded-lg text-xs font-medium transition-all ${cChannel===ch.v?"text-white":"text-slate-400"}`} style={cChannel===ch.v?{background:"rgba(139,92,246,0.2)",border:"1px solid rgba(139,92,246,0.4)"}:{background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.06)"}}>
                      <div>{ch.ico}</div><div className="mt-0.5">{ch.l}</div>
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">Schedule for later (optional)</label>
                <input type="datetime-local" value={cSchedule} onChange={e=>setCSchedule(e.target.value)} className="w-full px-3 py-2 rounded-lg text-xs text-white outline-none" style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)"}}/>
                <p className="text-[10px] text-slate-500 mt-1">Leave empty to send now or save as draft</p>
              </div>
            </div>

            {/* Actions */}
            <div className="mt-4 pt-4 border-t border-white/5 space-y-2">
              {saveMsg&&<div className="text-xs px-3 py-2.5 rounded-lg" style={{background:saveMsg.ok?"rgba(34,197,94,0.1)":"rgba(239,68,68,0.1)",color:saveMsg.ok?"#4ade80":"#f87171"}}>{saveMsg.text}</div>}
              <button onClick={()=>save(true)} disabled={!!saving} className="w-full py-3 rounded-xl text-sm font-bold text-white disabled:opacity-50 flex items-center justify-center gap-2" style={{background:"linear-gradient(135deg,#22c55e,#16a34a)"}}>
                {saving==="launch"?<RefreshCw size={14} className="animate-spin"/>:<Send size={14}/>}
                {saving==="launch"?"Sending…":cSchedule?"Schedule Campaign":"Send Campaign Now"}
              </button>
              <button onClick={()=>save(false)} disabled={!!saving} className="w-full py-2.5 rounded-xl text-xs font-medium disabled:opacity-50" style={{background:"rgba(139,92,246,0.1)",border:"1px solid rgba(139,92,246,0.2)",color:"#c4b5fd"}}>
                {saving==="draft"?"Saving…":"Save as Draft"}
              </button>
            </div>
          </div>
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
const AutomationBuilderPage=({onBack}:any)=>{
  const bizName=localStorage.getItem("biz_name")||"Your Business";
  const [step,setStep]=useState(1);
  const [trig,setTrig]=useState("BIRTHDAY");
  const [delay,setDelay]=useState(0);
  const [delayUnit,setDelayUnit]=useState<"minutes"|"hours"|"days">("hours");
  const [msgBody,setMsgBody]=useState("");
  const [awardPoints,setAwardPoints]=useState(50);
  const [extraAction,setExtraAction]=useState<string|null>(null);
  const [autoName,setAutoName]=useState("");
  const [saving,setSaving]=useState(false);
  const [saveErr,setSaveErr]=useState<string|null>(null);
  const [done,setDone]=useState(false);
  const [autoAiPrompt,setAutoAiPrompt]=useState("");
  const [autoAiLoading,setAutoAiLoading]=useState(false);

  const runAutoAI=async()=>{
    if(!autoAiPrompt.trim())return;
    setAutoAiLoading(true);
    try{
      const d=await api.ai.generateMessage(autoAiPrompt,bizName);
      if(d.message)setMsgBody(d.message.replace(/\{name\}/g,"{{name}}").replace(/\{biz\}/g,"{{biz}}"));
    }catch{
      setMsgBody(`Hey {{name}}! 👋 ${autoAiPrompt} at ${bizName}. We'd love to see you soon!`);
    }finally{setAutoAiLoading(false);setAutoAiPrompt("");}
  };

  // Suggested messages per trigger
  const SUGGESTIONS:Record<string,string>={
    BIRTHDAY:`Happy Birthday {{name}}! 🎂🎉 The whole team at ${bizName} wishes you a wonderful day. As our gift, enjoy a special surprise on your next visit — come celebrate with us!`,
    INACTIVITY:`Hey {{name}}, we miss you! 👋 It's been a while since we've seen you at ${bizName}. Come back this week and we'll make your visit extra special. See you soon! 😊`,
    VISIT_MILESTONE:`Congratulations {{name}}! 🌟 You've hit a loyalty milestone at ${bizName}! Thank you for being such a loyal customer — we have a special reward waiting for you on your next visit.`,
    TIER_UPGRADE:`Great news, {{name}}! 🎊 You've just been upgraded to a new loyalty tier at ${bizName}! Your loyalty means everything to us. Enjoy your new exclusive perks on your next visit!`,
    SENTIMENT_NEGATIVE:`Hi {{name}}, we're sorry if your recent experience didn't meet expectations. We'd love to make it right — please visit us and ask for the manager. Your satisfaction is our priority. 🙏`,
  };

  const T=TRIGGERS.find(t=>t.type===trig)||TRIGGERS[0];
  const delayMins=delay*(delayUnit==="days"?1440:delayUnit==="hours"?60:1);

  const save=async()=>{
    if(!autoName.trim()){setSaveErr("Please give your automation a name.");return;}
    if(!msgBody.trim()){setSaveErr("Please write the message to send.");return;}
    setSaving(true);setSaveErr(null);
    const acts:string[]=["SEND_WHATSAPP"];
    if(awardPoints>0)acts.push("AWARD_POINTS");
    if(extraAction&&!acts.includes(extraAction))acts.push(extraAction);
    const trigNode={id:"trigger-1",type:"triggerNode",data:{triggerType:trig,...(trig==="INACTIVITY"?{config:{daysInactive:30}}:trig==="VISIT_MILESTONE"?{config:{visitCount:5}}:{})},position:{x:250,y:50}};
    const actNodes=acts.map((a,i)=>({id:`action-${i+1}`,type:"actionNode",data:{actionType:a,delayMinutes:delayMins,...(a==="SEND_WHATSAPP"?{templateName:"default",messageBody:msgBody}:a==="AWARD_POINTS"?{points:awardPoints}:a==="CHANGE_SEGMENT"?{targetSegment:"VIP"}:{})},position:{x:250,y:180+i*120}}));
    const edges=actNodes.map((n,i)=>({id:`e${i}`,source:i===0?"trigger-1":actNodes[i-1].id,target:n.id}));
    try{
      const created=await api.automations.create({name:autoName.trim(),graphJson:{nodes:[trigNode,...actNodes],edges}});
      if(created?.id)await api.automations.activate(created.id).catch(()=>{});
      setDone(true);
      setTimeout(()=>onBack(),1800);
    }catch(e:any){setSaveErr(e?.message||"Save failed");}finally{setSaving(false);}
  };

  if(done)return(
    <div className="flex flex-col items-center justify-center py-20 space-y-4">
      <div className="w-16 h-16 rounded-full flex items-center justify-center" style={{background:"rgba(34,197,94,0.15)",border:"2px solid rgba(34,197,94,0.4)"}}><Check size={28} className="text-green-400"/></div>
      <p className="text-white font-semibold">Automation saved!</p>
      <p className="text-slate-400 text-sm">It will run automatically in the background.</p>
    </div>
  );

  return(
    <div className="space-y-5 pb-8 max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-white/5"><ChevronLeft size={20}/></button>
        <div><h1 className="text-xl font-bold text-white">Build Automation</h1><p className="text-xs text-slate-400 mt-0.5">Set up a message that sends itself automatically.</p></div>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-2">
        {[{n:1,l:"When?"},{n:2,l:"Message"},{n:3,l:"Timing"},{n:4,l:"Save"}].map((s,i,arr)=>(
          <div key={s.n} className="flex items-center gap-2">
            <div className="flex items-center gap-1.5">
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-all ${step>=s.n?"text-white":"text-slate-500"}`} style={{background:step>=s.n?"linear-gradient(135deg,#8b5cf6,#7c3aed)":"rgba(255,255,255,0.06)"}}>{step>s.n?<Check size={12}/>:s.n}</div>
              <span className={`text-xs font-medium hidden sm:block ${step===s.n?"text-white":step>s.n?"text-slate-400":"text-slate-600"}`}>{s.l}</span>
            </div>
            {i<arr.length-1&&<div className="flex-1 h-px min-w-4" style={{background:step>s.n?"rgba(139,92,246,0.4)":"rgba(255,255,255,0.06)"}}/>}
          </div>
        ))}
      </div>

      {/* Step 1: Choose Trigger */}
      {step===1&&(
        <div className="gc rounded-xl p-5" style={CARD}>
          <h2 className="text-sm font-semibold text-white mb-1">When should this automation run?</h2>
          <p className="text-xs text-slate-400 mb-4">Pick the event that triggers the message to send automatically.</p>
          <div className="space-y-2">
            {TRIGGERS.map(t=>(
              <button key={t.type} onClick={()=>setTrig(t.type)} className="w-full flex items-center gap-4 p-4 rounded-xl text-left transition-all" style={trig===t.type?{background:t.color+"15",border:"2px solid "+(t.color)+"50"}:{background:"rgba(255,255,255,0.02)",border:"1px solid rgba(255,255,255,0.07)"}}>
                <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0" style={{background:t.color+(trig===t.type?"25":"15")}}><t.icon size={20} style={{color:t.color}}/></div>
                <div className="flex-1"><div className="text-sm font-semibold text-white">{t.label}</div><div className="text-xs text-slate-400 mt-0.5">{t.desc}</div></div>
                {trig===t.type&&<div className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0" style={{background:t.color}}><Check size={11} className="text-white"/></div>}
              </button>
            ))}
          </div>
          <button onClick={()=>setStep(2)} className="w-full mt-5 py-3 rounded-xl text-sm font-semibold text-white" style={{background:"linear-gradient(135deg,#8b5cf6,#7c3aed)"}}>Next — Write Message →</button>
        </div>
      )}

      {/* Step 2: Message */}
      {step===2&&(
        <div className="space-y-4">
          <div className="gc rounded-xl p-5" style={CARD}>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{background:T.color+"20"}}><T.icon size={18} style={{color:T.color}}/></div>
              <div><div className="text-xs font-medium" style={{color:T.color}}>Trigger: {T.label}</div><div className="text-sm font-semibold text-white">Write the WhatsApp message</div></div>
            </div>
            <p className="text-xs text-slate-400 mb-3">This message will be sent automatically when the trigger fires. Use variables to personalise it.</p>
            {!msgBody&&SUGGESTIONS[trig]&&(
              <button onClick={()=>setMsgBody(SUGGESTIONS[trig])} className="w-full mb-3 flex items-center gap-2 p-3 rounded-lg text-left text-xs" style={{background:"rgba(139,92,246,0.08)",border:"1px dashed rgba(139,92,246,0.3)"}}>
                <Zap size={12} className="text-violet-400 flex-shrink-0"/>
                <span className="text-violet-300 font-medium">Use suggested message</span>
                <span className="text-slate-500 ml-auto flex-shrink-0">tap to apply</span>
              </button>
            )}
            <textarea value={msgBody} onChange={e=>setMsgBody(e.target.value)} rows={6} placeholder={`Write your message here… e.g. "${SUGGESTIONS[trig]?.slice(0,60)}…"`} className="w-full px-4 py-3 rounded-xl text-sm text-white resize-y outline-none leading-relaxed" style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)"}}/>
            <div className="flex flex-wrap gap-1.5 mt-2">
              {[["{{name}}","Customer name"],["{{points}}","Points balance"],["{{tier}}","Loyalty tier"],["{{visits}}","Visit count"]].map(([v,d])=>(
                <button key={v} onClick={()=>setMsgBody(p=>p+v)} title={d} className="px-2 py-1 rounded-md text-xs font-mono" style={{background:"rgba(139,92,246,0.12)",border:"1px solid rgba(139,92,246,0.2)",color:"#a78bfa"}}>+{v}</button>
              ))}
            </div>
            {/* Write with AI */}
            <div className="mt-4 rounded-xl p-4" style={{background:"rgba(139,92,246,0.06)",border:"1px solid rgba(139,92,246,0.15)"}}>
              <div className="flex items-center gap-2 mb-3">
                <Brain size={13} className="text-violet-400"/>
                <span className="text-xs font-semibold text-slate-200">Write with AI</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded-md" style={{background:"rgba(6,182,212,0.1)",color:"#06b6d4"}}>Beta</span>
              </div>
              <div className="flex gap-2">
                <input value={autoAiPrompt} onChange={e=>setAutoAiPrompt(e.target.value)} onKeyDown={e=>e.key==="Enter"&&runAutoAI()} placeholder={`e.g. "give them a free dessert on their birthday"`} className="flex-1 px-3 py-2 rounded-lg text-xs text-white placeholder-slate-500 outline-none" style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.08)"}}/>
                <button onClick={runAutoAI} disabled={!autoAiPrompt||autoAiLoading} className="px-3 py-2 rounded-lg text-xs font-medium text-white flex items-center gap-1.5 disabled:opacity-40 flex-shrink-0" style={{background:"linear-gradient(135deg,#8b5cf6,#7c3aed)"}}>
                  {autoAiLoading?<RefreshCw size={12} className="animate-spin"/>:<Zap size={12}/>}
                  {autoAiLoading?"Writing…":"Generate"}
                </button>
              </div>
            </div>
          </div>
          <div className="gc rounded-xl p-4" style={CARD}>
            <div className="flex items-center gap-2 mb-3"><StarIcon size={13} className="text-amber-400"/><span className="text-xs font-semibold text-white">Also award bonus points? (optional)</span></div>
            <div className="flex items-center gap-3">
              <input type="range" min={0} max={500} step={10} value={awardPoints} onChange={e=>setAwardPoints(Number(e.target.value))} className="flex-1 h-1.5 rounded-full appearance-none" style={{accentColor:"#f59e0b"}}/>
              <div className="text-sm font-bold text-amber-400 w-16 text-right">{awardPoints>0?`+${awardPoints} pts`:"None"}</div>
            </div>
          </div>
          <div className="flex gap-3">
            <button onClick={()=>setStep(1)} className="flex-1 py-2.5 rounded-xl text-xs font-medium text-slate-400" style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.08)"}}>← Back</button>
            <button onClick={()=>setStep(3)} className="flex-[2] py-2.5 rounded-xl text-sm font-semibold text-white" style={{background:"linear-gradient(135deg,#8b5cf6,#7c3aed)"}}>Next — Set Timing →</button>
          </div>
        </div>
      )}

      {/* Step 3: Timing */}
      {step===3&&(
        <div className="space-y-4">
          <div className="gc rounded-xl p-5" style={CARD}>
            <h2 className="text-sm font-semibold text-white mb-1">When should the message be sent?</h2>
            <p className="text-xs text-slate-400 mb-4">Set a delay between the trigger and when the message actually sends.</p>
            <div className="flex gap-2 items-center">
              <input type="number" value={delay} onChange={e=>setDelay(Math.max(0,Number(e.target.value)))} min={0} className="w-24 px-3 py-2.5 rounded-lg text-sm text-white font-semibold text-center outline-none" style={{background:"rgba(255,255,255,0.07)",border:"1px solid rgba(255,255,255,0.15)"}}/>
              <select value={delayUnit} onChange={e=>setDelayUnit(e.target.value as any)} className="flex-1 px-3 py-2.5 rounded-lg text-sm text-white outline-none" style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)"}}>
                <option value="minutes" style={{background:"#1a1030"}}>Minutes after trigger</option>
                <option value="hours" style={{background:"#1a1030"}}>Hours after trigger</option>
                <option value="days" style={{background:"#1a1030"}}>Days after trigger</option>
              </select>
            </div>
            {delay===0&&<p className="text-xs text-slate-400 mt-2">Message sends immediately when the trigger fires.</p>}
            {delay>0&&<p className="text-xs text-slate-400 mt-2">Message sends <span className="text-white font-medium">{delay} {delayUnit}</span> after the trigger event.</p>}
            {/* Timing presets */}
            <div className="flex flex-wrap gap-2 mt-3">
              {[{l:"Immediately",d:0,u:"minutes"},{l:"1 hour later",d:1,u:"hours"},{l:"Same evening",d:6,u:"hours"},{l:"Next day",d:1,u:"days"},{l:"3 days later",d:3,u:"days"}].map(p=>(
                <button key={p.l} onClick={()=>{setDelay(p.d);setDelayUnit(p.u as any);}} className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all" style={delay===p.d&&delayUnit===p.u?{background:"rgba(139,92,246,0.2)",border:"1px solid rgba(139,92,246,0.4)",color:"#c4b5fd"}:{background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.08)",color:"#64748b"}}>{p.l}</button>
              ))}
            </div>
          </div>
          <div className="flex gap-3">
            <button onClick={()=>setStep(2)} className="flex-1 py-2.5 rounded-xl text-xs font-medium text-slate-400" style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.08)"}}>← Back</button>
            <button onClick={()=>setStep(4)} className="flex-[2] py-2.5 rounded-xl text-sm font-semibold text-white" style={{background:"linear-gradient(135deg,#8b5cf6,#7c3aed)"}}>Next — Review & Save →</button>
          </div>
        </div>
      )}

      {/* Step 4: Review & Save */}
      {step===4&&(
        <div className="space-y-4">
          <div className="gc rounded-xl p-5" style={CARD}>
            <h2 className="text-sm font-semibold text-white mb-4">Review your automation</h2>
            <div className="space-y-3">
              <div className="flex items-start gap-3 p-3 rounded-xl" style={{background:"rgba(255,255,255,0.03)"}}>
                <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{background:T.color+"20"}}><T.icon size={14} style={{color:T.color}}/></div>
                <div><div className="text-xs font-semibold text-white">Trigger: {T.label}</div><div className="text-xs text-slate-400">{T.desc}</div></div>
              </div>
              {delay>0&&(
                <div className="flex items-center gap-3 p-3 rounded-xl" style={{background:"rgba(255,255,255,0.03)"}}>
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{background:"rgba(245,158,11,0.15)"}}><Clock size={14} className="text-amber-400"/></div>
                  <div className="text-xs text-white">Wait <span className="font-semibold">{delay} {delayUnit}</span></div>
                </div>
              )}
              <div className="p-3 rounded-xl" style={{background:"rgba(37,211,102,0.05)",border:"1px solid rgba(37,211,102,0.15)"}}>
                <div className="flex items-center gap-2 mb-2"><MessageSquare size={12} className="text-green-400"/><span className="text-xs font-semibold text-green-400">WhatsApp Message</span></div>
                <p className="text-xs text-white leading-relaxed whitespace-pre-wrap">{msgBody||"(no message)"}</p>
              </div>
              {awardPoints>0&&(
                <div className="flex items-center gap-3 p-3 rounded-xl" style={{background:"rgba(255,255,255,0.03)"}}>
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{background:"rgba(245,158,11,0.15)"}}><StarIcon size={14} className="text-amber-400"/></div>
                  <div className="text-xs text-white">Award <span className="font-semibold text-amber-400">{awardPoints} points</span> to the customer</div>
                </div>
              )}
            </div>
          </div>
          <div className="gc rounded-xl p-4" style={CARD}>
            <label className="text-xs font-semibold text-white mb-2 block">Give this automation a name</label>
            <input value={autoName} onChange={e=>setAutoName(e.target.value)} placeholder={`e.g. ${T.label} Message`} className="w-full px-4 py-3 rounded-xl text-sm text-white outline-none" style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.12)"}} autoFocus/>
          </div>
          {saveErr&&<div className="text-xs px-4 py-3 rounded-xl" style={{background:"rgba(239,68,68,0.1)",color:"#f87171"}}>{saveErr}</div>}
          <div className="flex gap-3">
            <button onClick={()=>setStep(3)} className="flex-1 py-2.5 rounded-xl text-xs font-medium text-slate-400" style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.08)"}}>← Back</button>
            <button onClick={save} disabled={saving} className="flex-[2] py-3 rounded-xl text-sm font-bold text-white disabled:opacity-50 flex items-center justify-center gap-2" style={{background:"linear-gradient(135deg,#22c55e,#16a34a)"}}>
              {saving?<RefreshCw size={14} className="animate-spin"/>:<Zap size={14}/>}
              {saving?"Saving…":"Save & Activate Automation"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

// ════════════════════════════════════════════════════════════════
// LOYALTY & POINTS
// ════════════════════════════════════════════════════════════════
const LoyaltyPage=()=>{
  const ct=useCard();
  const [sub,setSub]=useState<"config"|"rewards"|"giftcards"|"challenges"|"qr">("config");
  const [tiers,setTiers]=useState<any[]>([]);
  const [loading,setLoading]=useState(true);
  const [saving,setSaving]=useState(false);
  const [saved,setSaved]=useState(false);
  const [dashKpis,setDashKpis]=useState<any>(null);
  const [pointsConfig,setPointsConfig]=useState({pointsPerPound:1,referralBonusPoints:50,referralReferrerPoints:25,pointsExpiryDays:365,minRedeemPoints:100,redeemRate:100,emailBonusPoints:0,birthdayBonusPoints:0});
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
        emailBonusPoints:Number(b.portalSettings?.emailBonusPoints??0),
        birthdayBonusPoints:Number(b.portalSettings?.birthdayBonusPoints??0),
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
      <div><h1 className="text-xl font-bold" style={{color:ct.tx}}>Loyalty & Rewards</h1><p className="text-xs mt-0.5" style={{color:ct.tx2}}>Configure LoyaltyTier model · Visual slider interface · saved to Prisma</p></div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KPI icon={Users} label="Total Customers" value={dashKpis?.totalCustomers?.toLocaleString()??"-"} change={`${dashKpis?.newThisMonth??0} new this month`} positive color={C.primary}/>
        <KPI icon={Eye} label="Active (30d)" value={dashKpis?.activeCustomers?.toLocaleString()??"-"} color={C.accent}/>
        <KPI icon={Send} label="Messages (Month)" value={dashKpis?.messagesThisMonth?.toLocaleString()??"-"} color={C.blue}/>
        <KPI icon={Award} label="Tiers Configured" value={loading?"-":tiers.length} color={C.amber}/>
      </div>
      {/* Loyalty engine sub-tabs */}
      <div className="flex gap-1 p-1 rounded-xl overflow-x-auto" style={{background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.06)"}}>
        {([["config","Tiers & Points",Sliders],["rewards","Rewards",Gift],["giftcards","Gift Cards",CreditCard],["challenges","Challenges",Target],["qr","QR Check-ins",QrCode]] as [string,string,any][]).map(([id,label,Icon])=>(
          <button key={id} onClick={()=>setSub(id as any)} className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-xs font-medium whitespace-nowrap transition-all ${sub===id?"text-white":"text-slate-400 hover:text-slate-200"}`} style={sub===id?{background:"linear-gradient(135deg,rgba(139,92,246,0.25),rgba(6,182,212,0.1))"}:{}}><Icon size={13}/>{label}</button>
        ))}
      </div>
      {sub==="rewards"&&<RewardsManager/>}
      {sub==="giftcards"&&<GiftCardsManager/>}
      {sub==="challenges"&&<ChallengesManager/>}
      {sub==="qr"&&<QrGenerator/>}
      {sub==="config"&&<>
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
          <div key={t.id||t.rank} className="rounded-xl p-4" style={{background:(col)+"08",border:"1px solid "+(col)+"30"}}>
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
            {key:"minRedeemPoints",label:"Min points to use wallet (POS)",min:0,max:2000,step:10,icon:"🔑"},
            {key:"redeemRate",label:"Points = 1 currency unit (e.g. 100 pts = £1)",min:1,max:1000,step:1,icon:"💰"},
            {key:"emailBonusPoints",label:"Bonus pts for adding email",min:0,max:500,step:10,icon:"📧"},
            {key:"birthdayBonusPoints",label:"Bonus pts on customer's birthday",min:0,max:1000,step:10,icon:"🎂"},
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
            <div key={i} className="p-3 rounded-xl" style={{background:(item.col)+"0a",border:"1px solid "+(item.col)+"20"}}>
              <item.icon size={16} style={{color:item.col}} className="mb-2"/>
              <div className="font-medium text-white mb-1">{item.title}</div>
              <div className="text-slate-400 leading-relaxed">{item.desc}</div>
            </div>
          ))}
        </div>
      </div>
      </>}
    </div>
  );
};

// ════════════════════════════════════════════════════════════════
// LOYALTY ENGINE — Rewards · Gift Cards · Challenges · QR
// ════════════════════════════════════════════════════════════════
const REWARD_TYPES=[["FREE_ITEM","Free item"],["DISCOUNT","% discount"],["VOUCHER","£ voucher"],["CASHBACK","Cashback"],["EXPERIENCE","Experience"]];
const RewardsManager=()=>{
  const [rewards,setRewards]=useState<any[]>([]);const [loading,setLoading]=useState(true);
  const [form,setForm]=useState<any>(null);
  const blank={name:"",type:"FREE_ITEM",pointsCost:100,value:undefined,freeItemName:"",minTierRank:null,stock:null,perCustomerLimit:null,isActive:true};
  const load=()=>{setLoading(true);api.loyaltyEngine.rewards().then(d=>setRewards(d.rewards||[])).catch(()=>{}).finally(()=>setLoading(false));};
  useEffect(load,[]);
  const save=async()=>{try{const body={...form,pointsCost:Number(form.pointsCost),value:form.value!=null&&form.value!==""?Number(form.value):undefined,minTierRank:form.minTierRank!=null&&form.minTierRank!==""?Number(form.minTierRank):null,stock:form.stock!=null&&form.stock!==""?Number(form.stock):null,perCustomerLimit:form.perCustomerLimit!=null&&form.perCustomerLimit!==""?Number(form.perCustomerLimit):null};if(form.id)await api.loyaltyEngine.updateReward(form.id,body);else await api.loyaltyEngine.createReward(body);setForm(null);load();}catch(e:any){alert(e?.message||"Save failed");}};
  const del=async(id:string)=>{if(!confirm("Delete this reward?"))return;await api.loyaltyEngine.deleteReward(id);load();};
  return(<div className="space-y-4">
    <div className="flex items-center justify-between"><div><h3 className="text-sm font-bold text-white">Rewards Catalogue</h3><p className="text-[11px] text-slate-500">Point-priced rewards your customers can redeem.</p></div><button onClick={()=>setForm({...blank})} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium text-white" style={{background:"linear-gradient(135deg,#8b5cf6,#7c3aed)"}}><Plus size={13}/>New reward</button></div>
    {loading?<Skeleton h="h-24"/>:rewards.length===0?<div className="gc rounded-xl p-8 text-center text-xs text-slate-500" style={CARD}>No rewards yet. Create your first to give customers a reason to keep coming back.</div>:
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">{rewards.map(r=>(
      <div key={r.id} className="gc rounded-xl p-4" style={{...CARD,opacity:r.isActive?1:0.55}}>
        <div className="flex items-start justify-between"><div className="flex items-center gap-2"><div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{background:C.amber+"22"}}><Gift size={16} style={{color:C.amber}}/></div><div><div className="text-sm font-semibold text-white">{r.name}</div><div className="text-[10px] text-slate-500">{REWARD_TYPES.find(t=>t[0]===r.type)?.[1]||r.type}</div></div></div><div className="flex gap-1"><button onClick={()=>setForm({...r})} className="text-slate-500 hover:text-white"><Edit size={13}/></button><button onClick={()=>del(r.id)} className="text-slate-500 hover:text-red-400"><Trash2 size={13}/></button></div></div>
        <div className="mt-3 flex items-center gap-2 flex-wrap text-[11px]"><span className="px-2 py-0.5 rounded font-bold" style={{background:C.primary+"22",color:"#c4b5fd"}}>{r.pointsCost} pts</span>{r.value!=null&&<span className="text-slate-400">£{Number(r.value)} value</span>}{r.stock!=null&&<span className="text-slate-500">{r.stock} left</span>}{r.minTierRank!=null&&<span className="text-amber-400">Tier {r.minTierRank}+</span>}{!r.isActive&&<span className="text-red-400">Inactive</span>}</div>
      </div>
    ))}</div>}
    {form&&<div className="fixed inset-0 z-[100] flex items-center justify-center p-4" style={{background:"rgba(0,0,0,0.7)",backdropFilter:"blur(6px)"}} onClick={()=>setForm(null)}>
      <div className="w-full max-w-md rounded-2xl p-5 space-y-3" style={{background:"#13102b",border:"1px solid rgba(255,255,255,0.1)"}} onClick={e=>e.stopPropagation()}>
        <div className="flex items-center justify-between"><h3 className="text-sm font-bold text-white">{form.id?"Edit":"New"} reward</h3><button onClick={()=>setForm(null)} className="text-slate-500 hover:text-white"><X size={16}/></button></div>
        <input value={form.name} onChange={e=>setForm({...form,name:e.target.value})} placeholder="Reward name" className={inp} style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)"}}/>
        <div className="grid grid-cols-2 gap-2">
          <select value={form.type} onChange={e=>setForm({...form,type:e.target.value})} className={inp} style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)"}}>{REWARD_TYPES.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select>
          <input type="number" value={form.pointsCost} onChange={e=>setForm({...form,pointsCost:e.target.value})} placeholder="Points cost" className={inp} style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)"}}/>
        </div>
        {(form.type==="DISCOUNT"||form.type==="VOUCHER"||form.type==="CASHBACK")&&<input type="number" value={form.value??""} onChange={e=>setForm({...form,value:e.target.value})} placeholder={form.type==="DISCOUNT"?"Discount %":"£ value"} className={inp} style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)"}}/>}
        {form.type==="FREE_ITEM"&&<input value={form.freeItemName??""} onChange={e=>setForm({...form,freeItemName:e.target.value})} placeholder="Free item name (e.g. Coffee)" className={inp} style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)"}}/>}
        <div className="grid grid-cols-3 gap-2">
          <input type="number" value={form.minTierRank??""} onChange={e=>setForm({...form,minTierRank:e.target.value})} placeholder="Min tier" className={inp} style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)"}}/>
          <input type="number" value={form.stock??""} onChange={e=>setForm({...form,stock:e.target.value})} placeholder="Stock" className={inp} style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)"}}/>
          <input type="number" value={form.perCustomerLimit??""} onChange={e=>setForm({...form,perCustomerLimit:e.target.value})} placeholder="Per-cust" className={inp} style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)"}}/>
        </div>
        <label className="flex items-center gap-2 text-xs text-slate-300"><input type="checkbox" checked={form.isActive} onChange={e=>setForm({...form,isActive:e.target.checked})}/>Active</label>
        <button onClick={save} className="w-full py-2.5 rounded-xl text-sm font-semibold text-white" style={{background:"linear-gradient(135deg,#8b5cf6,#7c3aed)"}}>{form.id?"Save changes":"Create reward"}</button>
      </div>
    </div>}
  </div>);
};

const GiftCardsManager=()=>{
  const [data,setData]=useState<any>(null);const [loading,setLoading]=useState(true);
  const [show,setShow]=useState(false);const [f,setF]=useState<any>({initialBalance:25,purchaserName:"",message:""});
  const [issued,setIssued]=useState<any>(null);
  // optional: assign the card directly to an existing customer
  const [custQuery,setCustQuery]=useState("");const [custResults,setCustResults]=useState<any[]>([]);const [assignTo,setAssignTo]=useState<any>(null);
  const [showInfo,setShowInfo]=useState(false);
  const load=()=>{setLoading(true);api.loyaltyEngine.giftCards().then(setData).catch(()=>{}).finally(()=>setLoading(false));};
  useEffect(load,[]);
  useEffect(()=>{if(!custQuery.trim()||assignTo){setCustResults([]);return;}const t=setTimeout(()=>{api.customers.search({q:custQuery,limit:5}).then(d=>setCustResults(d.customers||[])).catch(()=>{});},300);return()=>clearTimeout(t);},[custQuery,assignTo]);
  const resetForm=()=>{setF({initialBalance:25,purchaserName:"",message:""});setAssignTo(null);setCustQuery("");setCustResults([]);};
  const issue=async()=>{try{const card=await api.loyaltyEngine.issueGiftCard({initialBalance:Number(f.initialBalance),purchaserName:f.purchaserName||undefined,message:f.message||undefined,...(assignTo?{issuedToCustomerId:assignTo.id,recipientName:assignTo.name||assignTo.fullName}:{})});setIssued({...card,assignedName:assignTo?(assignTo.name||assignTo.fullName):null});setShow(false);resetForm();load();}catch(e:any){alert(e?.message||"Failed");}};
  const removeCard=async(c:any)=>{
    if(c.issuedToCustomerId){
      const reason=prompt("This card is held by a customer. We'll message them for consent before deleting.\n\nReason / note to send (optional):","This gift card was issued in error — apologies for the mix-up.");
      if(reason===null)return;
      try{await api.loyaltyEngine.requestGiftCardDeletion(c.id,reason||undefined);alert("Deletion request sent — the customer must accept it from their portal.");load();}catch(e:any){alert(e?.message||"Failed");}
    }else{
      if(!confirm(`Delete gift card ${c.code}? This cannot be undone.`))return;
      try{await api.loyaltyEngine.deleteGiftCard(c.id);load();}catch(e:any){alert(e?.message||"Failed");}
    }
  };
  const GC_STATUS:Record<string,string>={ACTIVE:C.green,REDEEMED:C.blue,PENDING_DELETE:C.amber,VOIDED:"#6b7280",EXPIRED:"#6b7280"};
  return(<div className="space-y-4">
    <div className="flex items-center justify-between"><div><h3 className="text-sm font-bold text-white flex items-center gap-1.5">Gift Cards<button onClick={()=>setShowInfo(true)} title="How gift cards work" className="text-slate-500 hover:text-violet-300"><Info size={14}/></button></h3><p className="text-[11px] text-slate-500">Prepaid stored value — upfront cash flow that redeems into customer wallets.</p></div><button onClick={()=>setShow(true)} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium text-white" style={{background:"linear-gradient(135deg,#8b5cf6,#7c3aed)"}}><Plus size={13}/>Issue gift card</button></div>
    {showInfo&&<div className="fixed inset-0 z-[100] flex items-center justify-center p-4" style={{background:"rgba(0,0,0,0.7)",backdropFilter:"blur(6px)"}} onClick={()=>setShowInfo(false)}>
      <div className="w-full max-w-lg rounded-2xl p-5 max-h-[85vh] overflow-y-auto" style={{background:"#13102b",border:"1px solid rgba(255,255,255,0.1)"}} onClick={e=>e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4"><h3 className="text-sm font-bold text-white flex items-center gap-2"><CreditCard size={16} className="text-violet-300"/>How gift cards work</h3><button onClick={()=>setShowInfo(false)} className="text-slate-500 hover:text-white"><X size={16}/></button></div>
        <div className="space-y-4 text-xs">
          {[
            {icon:DollarSign,col:C.green,title:"They're real money",body:"A gift card is prepaid stored value. It can be spent on anything — there are no item restrictions. Think of it like cash credit, not a coupon."},
            {icon:Plus,col:C.primary,title:"Two ways to issue",body:"Send to a customer — search and assign it; the card appears instantly in their rewards portal. Or create a code — leave the customer blank and share the GC-XXXX code however you like (print, text, physical card)."},
            {icon:Gift,col:C.accent,title:"How customers redeem",body:"Assigned cards show up automatically in the portal → 'Add to my balance'. A shared code is redeemed via the 'Have a gift code?' box. Either way the value lands in the customer's wallet (shop credit)."},
            {icon:ShoppingCart,col:C.amber,title:"Spending at the till",body:"In POS → Wallet payment mode, look up the customer and toggle 'Gift / shop credit' to apply their balance to the bill. It's deducted from the total and logged."},
            {icon:Send,col:C.blue,title:"Customers can re-gift",body:"A card holder can pass their card to another customer from their portal (Gift → enter their WhatsApp number). It moves to the new person and notifies them."},
            {icon:Trash2,col:C.red,title:"Deleting cards",body:"Not yet issued to anyone → you can delete it outright. Already held by a customer → you must request deletion; they get a message and the card is only removed once THEY accept (consent-gated). Declined cards stay active."},
            {icon:Database,col:"#94a3b8",title:"History is kept",body:"Once redeemed or voided, a card disappears from the customer's portal but stays here marked REDEEMED / VOIDED so you always have the record."},
            {icon:Shield,col:C.green,title:"Single-use & safe",body:"Each code is unique and can only be redeemed once."},
            {icon:AlertTriangle,col:C.amber,title:"It's your liability",body:"Money on an unredeemed gift card is cash you've already taken but still owe — it's a liability on your books, not profit, until it's spent. The 'Outstanding balance' figure above is your total live exposure. Plan for the fact customers can redeem it at any time."},
          ].map((r,i)=>(
            <div key={i} className="flex gap-3">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{background:r.col+"22"}}><r.icon size={15} style={{color:r.col}}/></div>
              <div><div className="text-white font-semibold mb-0.5">{r.title}</div><div className="text-slate-400 leading-relaxed">{r.body}</div></div>
            </div>
          ))}
        </div>
        <button onClick={()=>setShowInfo(false)} className="w-full mt-5 py-2.5 rounded-xl text-sm font-semibold text-white" style={{background:"linear-gradient(135deg,#8b5cf6,#7c3aed)"}}>Got it</button>
      </div>
    </div>}
    {data&&<div className="grid grid-cols-2 lg:grid-cols-3 gap-3"><KPI icon={CreditCard} label="Active cards" value={data.activeCount??0} color={C.primary}/><KPI icon={DollarSign} label="Outstanding balance" value={`£${(data.outstandingBalance??0).toLocaleString()}`} color={C.green} sub="liability you've been pre-paid for"/></div>}
    {loading?<Skeleton h="h-24"/>:(data?.cards||[]).length===0?<div className="gc rounded-xl p-8 text-center text-xs text-slate-500" style={CARD}>No gift cards issued yet.</div>:
    <div className="gc rounded-xl overflow-hidden" style={CARD}><div className="overflow-x-auto"><table className="w-full text-xs"><thead><tr className="border-b border-white/5 text-slate-400"><th className="text-left py-2.5 px-4">Code</th><th className="text-left py-2.5 px-3">Recipient</th><th className="text-left py-2.5 px-3">Balance</th><th className="text-left py-2.5 px-3">Status</th><th className="text-right py-2.5 px-4"></th></tr></thead><tbody>{data.cards.map((c:any)=>(<tr key={c.id} className="border-b border-white/3"><td className="py-2.5 px-4 font-mono text-violet-300">{c.code}</td><td className="py-2.5 px-3 text-slate-300">{c.recipientName||"—"}{c.issuedToCustomerId&&<span className="ml-1.5 text-[9px] px-1 py-0.5 rounded" style={{background:"rgba(6,182,212,0.15)",color:"#67e8f9"}}>held</span>}</td><td className="py-2.5 px-3 text-white">£{Number(c.currentBalance)} <span className="text-slate-600">/ £{Number(c.initialBalance)}</span></td><td className="py-2.5 px-3"><Badge color={GC_STATUS[c.status]||"#6b7280"}>{c.status==="PENDING_DELETE"?"AWAITING CONSENT":c.status}</Badge></td><td className="py-2.5 px-4 text-right">{(c.status==="REDEEMED"||c.status==="VOIDED")?<span className="text-[10px] text-slate-600">archived</span>:<button onClick={()=>removeCard(c)} title={c.issuedToCustomerId?"Request deletion (needs customer consent)":"Delete"} className="text-slate-500 hover:text-red-400"><Trash2 size={14}/></button>}</td></tr>))}</tbody></table></div></div>}
    {show&&<div className="fixed inset-0 z-[100] flex items-center justify-center p-4" style={{background:"rgba(0,0,0,0.7)",backdropFilter:"blur(6px)"}} onClick={()=>{setShow(false);resetForm();}}>
      <div className="w-full max-w-md rounded-2xl p-5 space-y-3" style={{background:"#13102b",border:"1px solid rgba(255,255,255,0.1)"}} onClick={e=>e.stopPropagation()}>
        <div className="flex items-center justify-between"><h3 className="text-sm font-bold text-white">Issue gift card</h3><button onClick={()=>{setShow(false);resetForm();}} className="text-slate-500 hover:text-white"><X size={16}/></button></div>
        <div><label className="text-[11px] text-slate-400">Amount (£)</label><input type="number" value={f.initialBalance} onChange={e=>setF({...f,initialBalance:e.target.value})} className={inp} style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)"}}/></div>
        {/* Optional: assign directly to a customer */}
        <div>
          <label className="text-[11px] text-slate-400">Send to a customer (optional)</label>
          {assignTo?(
            <div className="flex items-center justify-between px-3 py-2 rounded-xl mt-1" style={{background:"rgba(34,197,94,0.1)",border:"1px solid rgba(34,197,94,0.25)"}}>
              <span className="text-xs text-white">{assignTo.name||assignTo.fullName} <span className="text-slate-500">{assignTo.phone||assignTo.whatsappNumber}</span></span>
              <button onClick={()=>{setAssignTo(null);setCustQuery("");}} className="text-slate-500 hover:text-white"><X size={13}/></button>
            </div>
          ):(<>
            <input value={custQuery} onChange={e=>setCustQuery(e.target.value)} placeholder="Search name or phone — leave blank to just get a code" className={inp+" mt-1"} style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)"}}/>
            {custResults.length>0&&<div className="mt-1 rounded-xl overflow-hidden" style={{border:"1px solid rgba(255,255,255,0.08)"}}>{custResults.map(c=><button key={c.id} onClick={()=>{setAssignTo(c);setCustResults([]);}} className="w-full text-left px-3 py-2 text-xs text-slate-300 hover:bg-white/5">{c.fullName} <span className="text-slate-500">{c.whatsappNumber}</span></button>)}</div>}
          </>)}
        </div>
        <input value={f.purchaserName} onChange={e=>setF({...f,purchaserName:e.target.value})} placeholder="From / purchaser name (optional)" className={inp} style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)"}}/>
        <input value={f.message} onChange={e=>setF({...f,message:e.target.value})} placeholder="Gift message (optional)" className={inp} style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)"}}/>
        <button onClick={issue} className="w-full py-2.5 rounded-xl text-sm font-semibold text-white" style={{background:"linear-gradient(135deg,#8b5cf6,#7c3aed)"}}>{assignTo?"Send gift card":"Create gift code"}</button>
      </div>
    </div>}
    {issued&&<div className="fixed inset-0 z-[100] flex items-center justify-center p-4" style={{background:"rgba(0,0,0,0.7)",backdropFilter:"blur(6px)"}} onClick={()=>setIssued(null)}>
      <div className="w-full max-w-sm rounded-2xl p-6 text-center space-y-3" style={{background:"linear-gradient(135deg,#1a1340,#2d1f5e)",border:"1px solid rgba(139,92,246,0.4)"}} onClick={e=>e.stopPropagation()}>
        <CreditCard size={32} className="mx-auto text-violet-300"/><div className="text-xs text-slate-400">Gift card issued</div>
        <div className="text-2xl font-bold text-white">£{Number(issued.initialBalance)}</div>
        <div className="font-mono text-lg text-violet-200 tracking-wider">{issued.code}</div>
        {issued.assignedName
          ?<div className="text-[11px] text-green-300">✓ Sent to {issued.assignedName} — it's now in their rewards portal, ready to redeem or gift on.</div>
          :<div className="text-[11px] text-slate-400">Share this code with anyone. They redeem it in their rewards portal (Gift Cards → “Have a code?”) to top up their balance.</div>}
        <button onClick={()=>setIssued(null)} className="w-full py-2 rounded-xl text-sm font-semibold text-white" style={{background:"rgba(255,255,255,0.1)"}}>Done</button>
      </div>
    </div>}
  </div>);
};

const CHALLENGE_TYPES=[["VISIT_COUNT","Visit count"],["SPEND_TOTAL","Total spend (£)"],["VISIT_STREAK","Daily streak"],["REFERRAL_COUNT","Referrals"],["PRODUCT_TRY","Try a product"]];
const ChallengesManager=()=>{
  const [items,setItems]=useState<any[]>([]);const [loading,setLoading]=useState(true);
  const [form,setForm]=useState<any>(null);
  const blank={name:"",type:"VISIT_COUNT",goal:5,rewardPoints:100,badgeName:"",badgeIcon:"🏆",isActive:true};
  const load=()=>{setLoading(true);api.loyaltyEngine.challenges().then(d=>setItems(d.challenges||[])).catch(()=>{}).finally(()=>setLoading(false));};
  useEffect(load,[]);
  const save=async()=>{try{const body={...form,goal:Number(form.goal),rewardPoints:Number(form.rewardPoints)};if(form.id)await api.loyaltyEngine.updateChallenge(form.id,body);else await api.loyaltyEngine.createChallenge(body);setForm(null);load();}catch(e:any){alert(e?.message||"Save failed");}};
  const del=async(id:string)=>{if(!confirm("Delete this challenge?"))return;await api.loyaltyEngine.deleteChallenge(id);load();};
  return(<div className="space-y-4">
    <div className="flex items-center justify-between"><div><h3 className="text-sm font-bold text-white">Challenges & Badges</h3><p className="text-[11px] text-slate-500">Limited-time missions that turn habits into a game customers want to win.</p></div><button onClick={()=>setForm({...blank})} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium text-white" style={{background:"linear-gradient(135deg,#8b5cf6,#7c3aed)"}}><Plus size={13}/>New challenge</button></div>
    {loading?<Skeleton h="h-24"/>:items.length===0?<div className="gc rounded-xl p-8 text-center text-xs text-slate-500" style={CARD}>No challenges yet. Try “Visit 5 times this month → 100 bonus points”.</div>:
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{items.map(ch=>(
      <div key={ch.id} className="gc rounded-xl p-4" style={{...CARD,opacity:ch.isActive?1:0.55}}>
        <div className="flex items-start justify-between"><div className="flex items-center gap-2"><span className="text-xl">{ch.badgeIcon||"🏆"}</span><div><div className="text-sm font-semibold text-white">{ch.name}</div><div className="text-[10px] text-slate-500">{CHALLENGE_TYPES.find(t=>t[0]===ch.type)?.[1]||ch.type} · goal {ch.goal}</div></div></div><div className="flex gap-1"><button onClick={()=>setForm({...ch})} className="text-slate-500 hover:text-white"><Edit size={13}/></button><button onClick={()=>del(ch.id)} className="text-slate-500 hover:text-red-400"><Trash2 size={13}/></button></div></div>
        <div className="mt-3 flex items-center gap-2 flex-wrap text-[11px]">{ch.rewardPoints>0&&<span className="px-2 py-0.5 rounded font-bold" style={{background:C.primary+"22",color:"#c4b5fd"}}>+{ch.rewardPoints} pts</span>}{ch.badgeName&&<span className="text-amber-400">🏅 {ch.badgeName}</span>}<span className="text-slate-500 ml-auto">{ch.participants??0} joined · {ch.completions??0} done</span></div>
      </div>
    ))}</div>}
    {form&&<div className="fixed inset-0 z-[100] flex items-center justify-center p-4" style={{background:"rgba(0,0,0,0.7)",backdropFilter:"blur(6px)"}} onClick={()=>setForm(null)}>
      <div className="w-full max-w-md rounded-2xl p-5 space-y-3" style={{background:"#13102b",border:"1px solid rgba(255,255,255,0.1)"}} onClick={e=>e.stopPropagation()}>
        <div className="flex items-center justify-between"><h3 className="text-sm font-bold text-white">{form.id?"Edit":"New"} challenge</h3><button onClick={()=>setForm(null)} className="text-slate-500 hover:text-white"><X size={16}/></button></div>
        <input value={form.name} onChange={e=>setForm({...form,name:e.target.value})} placeholder="Challenge name" className={inp} style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)"}}/>
        <div className="grid grid-cols-2 gap-2">
          <select value={form.type} onChange={e=>setForm({...form,type:e.target.value})} className={inp} style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)"}}>{CHALLENGE_TYPES.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select>
          <input type="number" value={form.goal} onChange={e=>setForm({...form,goal:e.target.value})} placeholder="Goal" className={inp} style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)"}}/>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <input type="number" value={form.rewardPoints} onChange={e=>setForm({...form,rewardPoints:e.target.value})} placeholder="Bonus pts" className={inp} style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)"}}/>
          <input value={form.badgeName} onChange={e=>setForm({...form,badgeName:e.target.value})} placeholder="Badge name" className={inp} style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)"}}/>
          <input value={form.badgeIcon} onChange={e=>setForm({...form,badgeIcon:e.target.value})} placeholder="🏆" maxLength={2} className={inp} style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)",textAlign:"center"}}/>
        </div>
        <label className="flex items-center gap-2 text-xs text-slate-300"><input type="checkbox" checked={form.isActive} onChange={e=>setForm({...form,isActive:e.target.checked})}/>Active</label>
        <button onClick={save} className="w-full py-2.5 rounded-xl text-sm font-semibold text-white" style={{background:"linear-gradient(135deg,#8b5cf6,#7c3aed)"}}>{form.id?"Save changes":"Create challenge"}</button>
      </div>
    </div>}
  </div>);
};

const QrGenerator=()=>{
  const [scope,setScope]=useState("BRANCH");const [tableId,setTableId]=useState("");const [eventId,setEventId]=useState("");
  const [ttl,setTtl]=useState("");const [geo,setGeo]=useState(false);const [lat,setLat]=useState("");const [lng,setLng]=useState("");const [radius,setRadius]=useState("150");
  const [result,setResult]=useState<any>(null);const [busy,setBusy]=useState(false);
  const gen=async()=>{setBusy(true);try{const body:any={scope};if(scope==="TABLE"&&tableId)body.tableId=tableId;if(scope==="EVENT"&&eventId)body.eventId=eventId;if(ttl)body.ttlSeconds=Number(ttl);if(geo&&lat&&lng)body.geo={lat:Number(lat),lng:Number(lng),radiusM:Number(radius)};const d=await api.loyaltyEngine.generateQr(body);setResult(d);}catch(e:any){alert(e?.message||"Failed");}finally{setBusy(false);}};
  const useMyLocation=()=>navigator.geolocation?.getCurrentPosition(p=>{setLat(String(p.coords.latitude));setLng(String(p.coords.longitude));});
  const qrSrc=result?`https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(result.checkinUrl)}`:"";
  return(<div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
    <div className="gc rounded-xl p-4 space-y-3" style={CARD}>
      <h3 className="text-sm font-bold text-white flex items-center gap-2"><QrCode size={15} style={{color:C.primary}}/>Generate check-in QR</h3>
      <p className="text-[11px] text-slate-500">Signed, scoped QR codes for low-friction customer capture. Dynamic and event codes expire automatically.</p>
      <div><label className="text-[11px] text-slate-400">Scope</label><select value={scope} onChange={e=>setScope(e.target.value)} className={inp} style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)"}}>{[["BRANCH","Branch QR (printable)"],["TABLE","Table QR"],["EVENT","Event QR"],["DYNAMIC","Dynamic (rotating)"]].map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></div>
      {scope==="TABLE"&&<input value={tableId} onChange={e=>setTableId(e.target.value)} placeholder="Table number/ID" className={inp} style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)"}}/>}
      {scope==="EVENT"&&<input value={eventId} onChange={e=>setEventId(e.target.value)} placeholder="Event name/ID" className={inp} style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)"}}/>}
      <div><label className="text-[11px] text-slate-400">Expiry (seconds, blank = no expiry for static)</label><input type="number" value={ttl} onChange={e=>setTtl(e.target.value)} placeholder="e.g. 60 for dynamic" className={inp} style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)"}}/></div>
      <label className="flex items-center gap-2 text-xs text-slate-300"><input type="checkbox" checked={geo} onChange={e=>setGeo(e.target.checked)}/>Geolocation fraud check</label>
      {geo&&<div className="space-y-2"><div className="grid grid-cols-3 gap-2"><input value={lat} onChange={e=>setLat(e.target.value)} placeholder="Lat" className={inp} style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)"}}/><input value={lng} onChange={e=>setLng(e.target.value)} placeholder="Lng" className={inp} style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)"}}/><input value={radius} onChange={e=>setRadius(e.target.value)} placeholder="Radius m" className={inp} style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)"}}/></div><button onClick={useMyLocation} className="text-[11px] text-violet-300 flex items-center gap-1">📍 Use my current location</button></div>}
      <button onClick={gen} disabled={busy} className="w-full py-2.5 rounded-xl text-sm font-semibold text-white flex items-center justify-center gap-2" style={{background:"linear-gradient(135deg,#8b5cf6,#7c3aed)"}}>{busy?<RefreshCw size={14} className="animate-spin"/>:<QrCode size={14}/>}Generate QR</button>
    </div>
    <div className="gc rounded-xl p-4 flex flex-col items-center justify-center text-center" style={CARD}>
      {result?<><div className="bg-white p-3 rounded-xl"><img src={qrSrc} alt="QR code" width={200} height={200}/></div><div className="text-[11px] text-slate-400 mt-3 break-all max-w-xs">{result.checkinUrl}</div>{result.exp&&<div className="text-[10px] text-amber-400 mt-1">Expires {new Date(result.exp).toLocaleString()}</div>}<button onClick={()=>navigator.clipboard?.writeText(result.checkinUrl)} className="mt-3 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-white" style={{background:"rgba(255,255,255,0.1)"}}><Copy size={12}/>Copy link</button></>:<div className="text-xs text-slate-500"><QrCode size={40} className="mx-auto mb-2 opacity-40"/>Your QR code will appear here.</div>}
    </div>
  </div>);
};

// ════════════════════════════════════════════════════════════════
// DATA HUB
// ════════════════════════════════════════════════════════════════
const TARGET_FIELDS=["fullName","whatsappNumber","email","birthday","gender","address"];
const TARGET_LABELS:Record<string,string>={fullName:"Full Name",whatsappNumber:"WhatsApp Number",email:"Email",birthday:"Birthday",gender:"Gender",address:"Address"};

const DataHubPage=()=>{
  const ct=useCard();
  const [tab,setTab]=useState("queue");
  const [queueMsgs,setQueueMsgs]=useState<any[]>([]);
  const [queueLoading,setQueueLoading]=useState(true);
  // import flow state
  const [step,setStep]=useState<"upload"|"map"|"done">("upload");
  const [fileObj,setFileObj]=useState<File|null>(null);
  const [headers,setHeaders]=useState<string[]>([]);
  const [sampleRows,setSampleRows]=useState<any[]>([]);
  const [rowCount,setRowCount]=useState(0);
  const [mapping,setMapping]=useState<Record<string,string>>({});
  const [uploading,setUploading]=useState(false);
  const [importMsg,setImportMsg]=useState<{text:string;ok:boolean}|null>(null);
  const [importResult,setImportResult]=useState<any>(null);
  // Add customer state
  const [acName,setAcName]=useState("");const [acPhone,setAcPhone]=useState("");const [acCategory,setAcCategory]=useState("NEW");const [acPoints,setAcPoints]=useState(0);const [acSendMsg,setAcSendMsg]=useState(false);const [acMsg,setAcMsg]=useState("Hi {{name}}, welcome to our loyalty programme! You have {{points}} points to start with.");const [acSaving,setAcSaving]=useState(false);const [acResult,setAcResult]=useState<{text:string;ok:boolean}|null>(null);
  // Send message state for queue rows
  const [sendMsgFor,setSendMsgFor]=useState<any|null>(null);const [directMsg,setDirectMsg]=useState("");const [sendingDirect,setSendingDirect]=useState(false);
  // Customers management tab
  const [custList,setCustList]=useState<any[]>([]);const [custLoading,setCustLoading]=useState(false);const [custSearch,setCustSearch]=useState("");const [busyRow,setBusyRow]=useState<string|null>(null);

  const loadCustomers=()=>{
    setCustLoading(true);
    api.customers.list({limit:100,q:custSearch||undefined}).then(d=>setCustList(d.customers||[])).catch(()=>{}).finally(()=>setCustLoading(false));
  };

  const toggleStaff=async(c:any)=>{
    setBusyRow(c.id);
    try{await api.customers.setStaff(c.id,!c.isStaff);setCustList(list=>list.map(x=>x.id===c.id?{...x,isStaff:!c.isStaff}:x));}
    catch(e:any){alert(e?.message||"Failed to update");}
    finally{setBusyRow(null);}
  };

  const deleteCustomer=async(c:any)=>{
    if(!confirm(`Delete ${c.fullName}? This permanently removes their visits, points and message history.`))return;
    setBusyRow(c.id);
    try{await api.customers.remove(c.id);setCustList(list=>list.filter(x=>x.id!==c.id));}
    catch(e:any){alert(e?.message||"Failed to delete");}
    finally{setBusyRow(null);}
  };

  useEffect(()=>{
    if(tab==="queue"){
      setQueueLoading(true);
      api.messages.list({limit:50}).then(d=>setQueueMsgs(d.messages??[])).catch(()=>{}).finally(()=>setQueueLoading(false));
    }
    if(tab==="customers"){loadCustomers();}
  },[tab]);

  const handleAddCustomer=async()=>{
    if(!acName.trim()||!acPhone.trim()){setAcResult({text:"Name and phone are required.",ok:false});return;}
    setAcSaving(true);setAcResult(null);
    try{
      const res=await api.customers.create({fullName:acName.trim(),whatsappNumber:acPhone.trim(),segment:acCategory,initialPoints:acPoints>0?acPoints:undefined,sendWelcomeMessage:acSendMsg,welcomeMessage:acSendMsg?acMsg:undefined});
      setAcResult({text:`Customer created${acPoints>0?` with ${acPoints} pts`:""}${acSendMsg?" · welcome message queued":""}`,ok:true});
      setAcName("");setAcPhone("");setAcPoints(0);setAcSendMsg(false);
    }catch(e:any){setAcResult({text:e?.message||"Failed to create customer",ok:false});}
    finally{setAcSaving(false);}
  };

  const handleSendDirect=async()=>{
    if(!sendMsgFor||!directMsg.trim())return;
    setSendingDirect(true);
    try{await api.messages.send({customerId:sendMsgFor.customerId||sendMsgFor.customer?.id,message:directMsg});setSendMsgFor(null);setDirectMsg("");}
    catch(e:any){alert(e?.message||"Send failed");}
    finally{setSendingDirect(false);}
  };

  // Step 1: upload file → get headers
  const handleFileSelect=async(e:React.ChangeEvent<HTMLInputElement>)=>{
    const f=e.target.files?.[0]; if(!f)return;
    if(!f.name.endsWith(".csv")&&!f.name.endsWith(".xlsx")&&!f.name.endsWith(".xls")){
      setImportMsg({text:"Only .csv or .xlsx files are supported.",ok:false});return;
    }
    setUploading(true);setImportMsg(null);setFileObj(f);
    try{
      const form=new FormData();form.append("file",f);
      const res=await fetch("/api/import/preview-headers",{method:"POST",headers:{Authorization:`Bearer ${localStorage.getItem("accessToken")??""}` },body:form});
      const data=await res.json();
      if(!res.ok)throw new Error(data.error||"Preview failed");
      setHeaders(data.headers??[]);
      setSampleRows(data.sampleRows??[]);
      setRowCount(data.rowCount??0);
      // Auto-map obvious column names
      const auto:Record<string,string>={};
      (data.headers??[]).forEach((h:string)=>{
        const hl=h.toLowerCase().replace(/[\s_-]/g,"");
        if(hl.includes("name"))auto[h]="fullName";
        else if(hl.includes("phone")||hl.includes("whatsapp")||hl.includes("mobile")||hl.includes("number"))auto[h]="whatsappNumber";
        else if(hl.includes("email"))auto[h]="email";
        else if(hl.includes("birth")||hl.includes("dob"))auto[h]="birthday";
        else if(hl.includes("gender"))auto[h]="gender";
        else if(hl.includes("address")||hl.includes("location"))auto[h]="address";
      });
      setMapping(auto);
      setStep("map");
    }catch(err:any){setImportMsg({text:"Error: "+(err.message??"Could not read file"),ok:false});}
    finally{setUploading(false);e.target.value="";}
  };

  // Step 2: confirm mapping → import
  const handleImport=async()=>{
    if(!fileObj)return;
    const hasPhone=Object.values(mapping).includes("whatsappNumber");
    const hasEmail=Object.values(mapping).includes("email");
    if(!hasPhone&&!hasEmail){setImportMsg({text:"Map at least WhatsApp Number or Email before importing.",ok:false});return;}
    setUploading(true);setImportMsg(null);
    try{
      const form=new FormData();form.append("file",fileObj);form.append("mapping",JSON.stringify(mapping));
      const res=await fetch("/api/import/customers",{method:"POST",headers:{Authorization:`Bearer ${localStorage.getItem("accessToken")??""}` },body:form});
      const data=await res.json();
      if(!res.ok)throw new Error(data.error||"Import failed");
      setImportResult(data);
      setImportMsg({text:`Imported ${data.created??0} new · Updated ${data.updated??0} · Skipped ${data.skipped??0} of ${data.processed??rowCount} rows.`,ok:true});
      setStep("done");
    }catch(err:any){setImportMsg({text:"Error: "+(err.message??"Import failed"),ok:false});}
    finally{setUploading(false);}
  };

  const resetImport=()=>{setStep("upload");setFileObj(null);setHeaders([]);setSampleRows([]);setMapping({});setImportMsg(null);setImportResult(null);};

  const CUSTOMER_COLS=[
    {col:"fullName",type:"text",required:true,example:"John Smith",desc:"Customer's full name"},
    {col:"phone",type:"E.164",required:true,example:"+447911123456",desc:"WhatsApp-registered phone in E.164 format"},
    {col:"email",type:"email",required:false,example:"john@email.com",desc:"Email address (optional)"},
    {col:"totalSpend",type:"number",required:false,example:"250.00",desc:"Total lifetime spend in your currency"},
    {col:"visitCount",type:"integer",required:false,example:"12",desc:"Number of past visits"},
    {col:"marketingConsent",type:"true/false",required:false,example:"true",desc:"WhatsApp marketing consent (defaults to false)"},
    {col:"notes",type:"text",required:false,example:"VIP customer",desc:"Internal notes"},
  ];

  return(
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div><h1 className="text-xl font-bold text-white">Data Hub</h1><p className="text-xs text-slate-400 mt-0.5">Message queue · Add customers · Bulk import</p></div>
      </div>

      <div className="flex gap-1 flex-wrap">{[
        {k:"queue",l:"Message Queue"},{k:"customers",l:"Customers"},{k:"add",l:"Add Customer"},{k:"import",l:"Import CSV"},{k:"format",l:"Column Format"}
      ].map(({k,l})=>(
        <button key={k} onClick={()=>setTab(k)} className={`px-3 py-2 rounded-lg text-xs ${tab===k?"text-white":"text-slate-400"}`} style={tab===k?{background:"rgba(139,92,246,0.2)"}:{}}>
          {l}
        </button>
      ))}</div>

      {tab==="queue"&&<>
        <div className="gc rounded-xl overflow-hidden" style={CARD}>
          <div className="overflow-x-auto"><table className="w-full text-xs"><thead><tr className="border-b border-white/5">
            <th className="text-left py-3 px-4 text-slate-400 font-medium">Customer</th>
            <th className="text-left py-3 px-3 text-slate-400 font-medium">Phone</th>
            <th className="text-left py-3 px-3 text-slate-400 font-medium">Category</th>
            <th className="text-left py-3 px-3 text-slate-400 font-medium">Points</th>
            <th className="text-left py-3 px-3 text-slate-400 font-medium">Status</th>
            <th className="text-left py-3 px-3 text-slate-400 font-medium">Time</th>
            <th className="py-3 px-3"/>
          </tr></thead>
            <tbody>{queueLoading?[...Array(5)].map((_,i)=><tr key={i}><td colSpan={7} className="py-2 px-4"><Skeleton h="h-8"/></td></tr>):queueMsgs.length===0?<tr><td colSpan={7} className="py-8 text-center text-slate-500 text-xs">No messages in queue</td></tr>:queueMsgs.map((m:any)=>(
              <tr key={m.id} className="border-b border-white/3 hover:bg-white/2">
                <td className="py-2.5 px-4 font-medium text-white">{m.customer?.fullName||"—"}</td>
                <td className="py-2.5 px-3 text-slate-400 font-mono">{m.customer?.whatsappNumber||m.recipientPhone||"—"}</td>
                <td className="py-2.5 px-3">{m.customer?.segment?<Badge color="#8b5cf6">{m.customer.segment}</Badge>:<span className="text-slate-600">—</span>}</td>
                <td className="py-2.5 px-3 text-amber-300 font-medium">{m.customer?.pointsBalance!=null?m.customer.pointsBalance.toLocaleString():"—"}</td>
                <td className="py-2.5 px-3"><Badge color={STATUS_COLORS[m.status as keyof typeof STATUS_COLORS]||"#6b7280"}>{m.status}</Badge></td>
                <td className="py-2.5 px-3 text-slate-400">{m.createdAt?timeAgo(m.createdAt):"—"}</td>
                <td className="py-2.5 px-3"><button onClick={()=>{setSendMsgFor(m);setDirectMsg("");}} className="px-2 py-1 rounded-lg text-xs text-violet-300 hover:bg-violet-500/10 transition-all" style={{border:"1px solid rgba(139,92,246,0.3)"}}><MessageSquare size={11} className="inline mr-1"/>Message</button></td>
              </tr>
            ))}</tbody>
          </table></div>
          <div className="p-3 border-t border-white/5 flex flex-wrap gap-2">{Object.entries(STATUS_COLORS).map(([s,c])=><div key={s} className="flex items-center gap-1 text-xs"><div className="w-2 h-2 rounded-full" style={{background:c}}/><span className="text-slate-400">{s}</span><span className="text-white font-medium">({queueMsgs.filter((m:any)=>m.status===s).length})</span></div>)}</div>
        </div>
        {/* Send direct message modal */}
        {sendMsgFor&&<div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{background:"rgba(0,0,0,0.7)"}}>
          <div className="w-full max-w-sm rounded-2xl p-5 space-y-4" style={{background:"#181124",border:"1px solid rgba(139,92,246,0.3)"}}>
            <div className="flex items-center justify-between"><h3 className="text-sm font-semibold text-white">Send Message to {sendMsgFor.customer?.fullName}</h3><button onClick={()=>setSendMsgFor(null)}><X size={16} className="text-slate-400"/></button></div>
            <p className="text-xs text-slate-400">{sendMsgFor.customer?.whatsappNumber||sendMsgFor.recipientPhone}</p>
            <textarea value={directMsg} onChange={e=>setDirectMsg(e.target.value)} rows={4} placeholder="Type your message…" className="w-full px-3 py-2 rounded-xl text-sm text-white resize-none outline-none" style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)"}}/>
            <div className="flex gap-2">
              <button onClick={handleSendDirect} disabled={!directMsg.trim()||sendingDirect} className="flex-1 py-2.5 rounded-xl text-xs font-semibold text-white disabled:opacity-40 flex items-center justify-center gap-2" style={{background:"linear-gradient(135deg,#8b5cf6,#7c3aed)"}}>{sendingDirect?<RefreshCw size={12} className="animate-spin"/>:<Send size={12}/>}{sendingDirect?"Sending…":"Send"}</button>
              <button onClick={()=>setSendMsgFor(null)} className="px-4 py-2 rounded-xl text-xs text-slate-400" style={{background:"rgba(255,255,255,0.05)"}}>Cancel</button>
            </div>
          </div>
        </div>}
      </>}

      {tab==="customers"&&<div className="gc rounded-xl overflow-hidden" style={CARD}>
        <div className="p-3 border-b border-white/5 flex items-center gap-2">
          <div className="relative flex-1 max-w-xs"><Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500"/><input value={custSearch} onChange={e=>setCustSearch(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")loadCustomers();}} placeholder="Search name / phone / email…" className="w-full pl-8 pr-3 py-1.5 rounded-lg text-xs text-white outline-none" style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.08)"}}/></div>
          <button onClick={loadCustomers} className="px-3 py-1.5 rounded-lg text-xs text-violet-300" style={{border:"1px solid rgba(139,92,246,0.3)"}}><RefreshCw size={11} className="inline mr-1"/>Refresh</button>
        </div>
        <div className="overflow-x-auto"><table className="w-full text-xs"><thead><tr className="border-b border-white/5">
          <th className="text-left py-3 px-4 text-slate-400 font-medium">Customer</th>
          <th className="text-left py-3 px-3 text-slate-400 font-medium">Phone</th>
          <th className="text-left py-3 px-3 text-slate-400 font-medium hidden sm:table-cell">Category</th>
          <th className="text-left py-3 px-3 text-slate-400 font-medium hidden md:table-cell">Points</th>
          <th className="text-left py-3 px-3 text-slate-400 font-medium hidden md:table-cell">Churn</th>
          <th className="text-left py-3 px-3 text-slate-400 font-medium">Staff</th>
          <th className="text-right py-3 px-4 text-slate-400 font-medium">Actions</th>
        </tr></thead>
          <tbody>{custLoading?[...Array(6)].map((_,i)=><tr key={i}><td colSpan={7} className="py-2 px-4"><Skeleton h="h-8"/></td></tr>):custList.length===0?<tr><td colSpan={7} className="py-8 text-center text-slate-500 text-xs">No customers found</td></tr>:custList.map((c:any)=>(
            <tr key={c.id} className="border-b border-white/3 hover:bg-white/2" style={c.isStaff?{background:"rgba(245,158,11,0.05)"}:{}}>
              <td className="py-2.5 px-4 font-medium text-white">{c.fullName}{c.isStaff&&<span className="ml-2 text-[9px] px-1.5 py-0.5 rounded text-amber-300" style={{background:"rgba(245,158,11,0.15)"}}>STAFF</span>}</td>
              <td className="py-2.5 px-3 text-slate-400 font-mono">{c.whatsappNumber||c.phone||"—"}</td>
              <td className="py-2.5 px-3 hidden sm:table-cell">{c.segment?<Badge color="#8b5cf6">{c.segment}</Badge>:<span className="text-slate-600">—</span>}</td>
              <td className="py-2.5 px-3 text-amber-300 font-medium hidden md:table-cell">{(c.pointsBalance??c.currentPointsBalance??0).toLocaleString()}</td>
              <td className="py-2.5 px-3 hidden md:table-cell"><span style={{color:(c.churnRisk??0)>50?"#ef4444":(c.churnRisk??0)>25?"#f59e0b":"#22c55e"}}>{c.churnRisk??0}%</span></td>
              <td className="py-2.5 px-3">
                <button onClick={()=>toggleStaff(c)} disabled={busyRow===c.id} title={c.isStaff?"Marked as staff — never messaged":"Mark as staff (stops all messages)"} className="w-9 h-5 rounded-full transition-all relative inline-block align-middle disabled:opacity-50" style={{background:c.isStaff?"linear-gradient(135deg,#f59e0b,#d97706)":"rgba(255,255,255,0.1)"}}>
                  <span className="absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all" style={{left:c.isStaff?"calc(100% - 18px)":"2px"}}/>
                </button>
              </td>
              <td className="py-2.5 px-4 text-right whitespace-nowrap">
                <button onClick={()=>{setSendMsgFor({customer:{fullName:c.fullName,whatsappNumber:c.whatsappNumber||c.phone,id:c.id},customerId:c.id});setDirectMsg("");}} disabled={c.isStaff} title={c.isStaff?"Staff cannot be messaged":"Send message"} className="px-2 py-1 rounded-lg text-xs text-violet-300 hover:bg-violet-500/10 disabled:opacity-30 mr-1" style={{border:"1px solid rgba(139,92,246,0.3)"}}><MessageSquare size={11}/></button>
                <button onClick={()=>deleteCustomer(c)} disabled={busyRow===c.id} title="Delete customer" className="px-2 py-1 rounded-lg text-xs text-red-300 hover:bg-red-500/10 disabled:opacity-30" style={{border:"1px solid rgba(239,68,68,0.3)"}}><Trash2 size={11}/></button>
              </td>
            </tr>
          ))}</tbody>
        </table></div>
        <div className="p-3 border-t border-white/5 text-xs text-slate-500">{custList.length} customer{custList.length!==1?"s":""} · Staff members are excluded from all campaigns, automations and direct messages.</div>
      </div>}

      {tab==="add"&&<div className="gc rounded-xl p-5 space-y-4" style={CARD}>
        <div><h3 className="text-sm font-semibold text-white flex items-center gap-2"><UserPlus size={14} className="text-violet-400"/>Add Customer Manually</h3><p className="text-xs text-slate-400 mt-1">Register a new customer, optionally assign initial points and send a welcome message.</p></div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div><label className="text-xs text-slate-400 mb-1 block">Full Name *</label><input value={acName} onChange={e=>setAcName(e.target.value)} placeholder="Jane Smith" className="w-full px-3 py-2 rounded-xl text-sm text-white outline-none" style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.08)"}}/></div>
          <div><label className="text-xs text-slate-400 mb-1 block">WhatsApp Phone *</label><PhoneInput value={acPhone} onChange={setAcPhone} inputStyle={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.08)",padding:"8px 12px",fontSize:"14px"}}/></div>
          <div><label className="text-xs text-slate-400 mb-1 block">Category / Segment</label><select value={acCategory} onChange={e=>setAcCategory(e.target.value)} className="w-full px-3 py-2 rounded-xl text-sm text-white outline-none" style={{background:"rgba(139,92,246,0.12)",border:"1px solid rgba(139,92,246,0.3)"}}>{["NEW","REGULAR","VIP","AT_RISK","LOST","BIG_SPENDER"].map(s=><option key={s} value={s} style={{background:"#1a1030"}}>{s}</option>)}</select></div>
          <div><label className="text-xs text-slate-400 mb-1 block">Starting Points</label><input type="number" value={acPoints} onChange={e=>setAcPoints(Number(e.target.value))} min={0} placeholder="0" className="w-full px-3 py-2 rounded-xl text-sm text-white outline-none" style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.08)"}}/></div>
        </div>
        <div className="pt-2 border-t border-white/5">
          <label className="flex items-center gap-3 cursor-pointer">
            <div onClick={()=>setAcSendMsg(p=>!p)} className="w-10 h-5 rounded-full transition-all relative flex-shrink-0" style={{background:acSendMsg?"linear-gradient(135deg,#8b5cf6,#7c3aed)":"rgba(255,255,255,0.1)"}}>
              <div className="absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all" style={{left:acSendMsg?"calc(100% - 18px)":"2px"}}/>
            </div>
            <span className="text-sm text-white">Send welcome message on WhatsApp</span>
          </label>
          {acSendMsg&&<div className="mt-3 space-y-2">
            <textarea value={acMsg} onChange={e=>setAcMsg(e.target.value)} rows={3} className="w-full px-3 py-2 rounded-xl text-xs text-white resize-none outline-none" style={{background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.08)"}}/>
            <div className="flex flex-wrap gap-1.5">{["{{name}}","{{points}}","{{tier}}","{{business_name}}"].map(v=><button key={v} onClick={()=>setAcMsg(p=>p+v)} className="px-2 py-1 rounded-md text-xs font-mono" style={{background:"rgba(139,92,246,0.12)",color:"#c4b5fd"}}>+{v}</button>)}</div>
          </div>}
        </div>
        {acResult&&<p className="text-xs" style={{color:acResult.ok?"#22c55e":"#ef4444"}}>{acResult.text}</p>}
        <button onClick={handleAddCustomer} disabled={acSaving||!acName.trim()||!acPhone.trim()} className="w-full py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-40 flex items-center justify-center gap-2" style={{background:"linear-gradient(135deg,#8b5cf6,#7c3aed)"}}>{acSaving?<RefreshCw size={14} className="animate-spin"/>:<UserPlus size={14}/>}{acSaving?"Creating…":"Add Customer"}</button>
      </div>}

      {tab==="import"&&<div className="space-y-4">
        {/* Step 1: Upload */}
        {step==="upload"&&<div className="gc rounded-xl p-5" style={CARD}>
          <h3 className="text-sm font-semibold text-white mb-1 flex items-center gap-2"><Download size={14} className="text-violet-400"/>Import Customers via CSV / XLSX</h3>
          <p className="text-xs text-slate-400 mb-4">Upload a spreadsheet. We'll read the column headers and let you map them to the right fields before importing.</p>
          <label className="flex flex-col items-center justify-center gap-3 py-10 rounded-xl cursor-pointer transition-all" style={{background:"rgba(139,92,246,0.05)",border:"2px dashed rgba(139,92,246,0.3)"}}>
            <input type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={handleFileSelect} disabled={uploading}/>
            <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{background:"rgba(139,92,246,0.15)"}}><Download size={24} className="text-violet-400"/></div>
            <div className="text-center"><div className="text-sm font-semibold text-white">{uploading?"Reading file…":"Drop CSV or XLSX here"}</div><div className="text-xs text-slate-400 mt-1">or click to browse · max 10 MB</div></div>
          </label>
          {importMsg&&<p className="text-xs mt-3 text-center" style={{color:importMsg.ok?"#22c55e":"#ef4444"}}>{importMsg.text}</p>}
        </div>}

        {/* Step 2: Map columns */}
        {step==="map"&&<div className="space-y-4">
          <div className="gc rounded-xl p-5" style={CARD}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-white flex items-center gap-2"><FileText size={14} className="text-violet-400"/>Map Columns — {rowCount} rows detected</h3>
              <button onClick={resetImport} className="text-xs text-slate-400 hover:text-white"><X size={13}/></button>
            </div>
            <p className="text-xs text-slate-400 mb-4">Match each column from your file to the correct field. At least <span className="text-violet-300 font-medium">WhatsApp Number</span> must be mapped.</p>
            <div className="space-y-2 mb-4">
              {headers.map(h=>(
                <div key={h} className="flex items-center gap-3">
                  <div className="flex-1 text-xs text-white font-mono truncate px-3 py-2 rounded-lg" style={{background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.07)"}}>{h}{sampleRows[0]&&sampleRows[0][h]!==undefined&&<span className="text-slate-500 ml-2">e.g. {String(sampleRows[0][h]).slice(0,20)}</span>}</div>
                  <select value={mapping[h]||""} onChange={e=>{const v=e.target.value;setMapping(p=>({...p,[h]:v}));}} className="text-xs text-white px-2 py-2 rounded-lg outline-none" style={{background:"rgba(139,92,246,0.15)",border:"1px solid rgba(139,92,246,0.3)"}}>
                    <option value="" style={{background:"#1a1030"}}>— Skip —</option>
                    {TARGET_FIELDS.map(f=><option key={f} value={f} style={{background:"#1a1030"}}>{TARGET_LABELS[f]}</option>)}
                  </select>
                </div>
              ))}
            </div>
            {importMsg&&<p className="text-xs mb-3" style={{color:importMsg.ok?"#22c55e":"#ef4444"}}>{importMsg.text}</p>}
            <div className="flex gap-2">
              <button onClick={handleImport} disabled={uploading} className="flex-1 py-2.5 rounded-xl text-xs font-semibold text-white disabled:opacity-40 flex items-center justify-center gap-2" style={{background:"linear-gradient(135deg,#8b5cf6,#7c3aed)"}}>
                {uploading?<RefreshCw size={12} className="animate-spin"/>:<Upload size={12}/>}{uploading?"Importing…":`Import ${rowCount} rows`}
              </button>
              <button onClick={resetImport} className="px-4 py-2.5 rounded-xl text-xs text-slate-400 hover:text-white" style={{background:"rgba(255,255,255,0.05)"}}>Cancel</button>
            </div>
          </div>
        </div>}

        {/* Step 3: Done */}
        {step==="done"&&<div className="gc rounded-xl p-5" style={CARD}>
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{background:"rgba(34,197,94,0.15)"}}><CheckCircle size={20} className="text-green-400"/></div>
            <div><div className="text-sm font-semibold text-white">Import Complete</div><div className="text-xs text-slate-400 mt-0.5">{importMsg?.text}</div></div>
          </div>
          {importResult&&<div className="grid grid-cols-3 gap-3 mb-4">
            {[{l:"Created",v:importResult.created??0,c:"#22c55e"},{l:"Updated",v:importResult.updated??0,c:"#8b5cf6"},{l:"Skipped",v:importResult.skipped??0,c:"#94a3b8"}].map(s=>(
              <div key={s.l} className="text-center p-3 rounded-xl" style={{background:"rgba(255,255,255,0.04)",border:`1px solid ${s.c}22`}}>
                <div className="text-xl font-bold" style={{color:s.c}}>{s.v}</div>
                <div className="text-[10px] text-slate-400 mt-0.5">{s.l}</div>
              </div>
            ))}
          </div>}
          <button onClick={resetImport} className="w-full py-2.5 rounded-xl text-xs font-semibold text-white" style={{background:"linear-gradient(135deg,#8b5cf6,#7c3aed)"}}>Import Another File</button>
        </div>}
      </div>}

      {tab==="format"&&<div className="space-y-4">
        <div className="gc rounded-xl p-5" style={CARD}>
          <h3 className="text-sm font-semibold text-white mb-1">Required CSV / XLSX Format</h3>
          <p className="text-xs text-slate-400 mb-4">Your spreadsheet must have these column headers in row 1. Order doesn't matter — column names must match exactly (case-insensitive).</p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="border-b border-white/5"><th className="text-left py-2 px-3 text-slate-400 font-medium">Column Name</th><th className="text-left py-2 px-3 text-slate-400 font-medium">Type</th><th className="text-left py-2 px-3 text-slate-400 font-medium">Required</th><th className="text-left py-2 px-3 text-slate-400 font-medium">Example</th><th className="text-left py-2 px-3 text-slate-400 font-medium">Description</th></tr></thead>
              <tbody>{CUSTOMER_COLS.map((col,i)=>(
                <tr key={i} className="border-b border-white/3">
                  <td className="py-2.5 px-3 font-mono text-violet-300">{col.col}</td>
                  <td className="py-2.5 px-3 text-slate-400">{col.type}</td>
                  <td className="py-2.5 px-3">{col.required?<Badge color="#22c55e">Required</Badge>:<span className="text-slate-500">Optional</span>}</td>
                  <td className="py-2.5 px-3 font-mono text-slate-300">{col.example}</td>
                  <td className="py-2.5 px-3 text-slate-400">{col.desc}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </div>
        <div className="gc rounded-xl p-4" style={CARD}>
          <h3 className="text-xs font-semibold text-white mb-2 flex items-center gap-2"><Info size={13} className="text-violet-400"/>Example CSV content</h3>
          <pre className="text-xs text-green-400 overflow-x-auto p-3 rounded-lg" style={{background:"rgba(0,0,0,0.4)",fontFamily:"monospace"}}>{`fullName,phone,email,totalSpend,visitCount,marketingConsent
John Smith,+447911123456,john@email.com,250.00,12,true
Maria Garcia,+34612345678,maria@cafe.es,85.50,4,true
Tom Wilson,+12125551234,,0,1,false`}</pre>
        </div>
      </div>}
    </div>
  );
};

// ════════════════════════════════════════════════════════════════
// AI INSIGHTS
// ════════════════════════════════════════════════════════════════
const AIPage=()=>{
  const ct=useCard();
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
      <div><h1 className="text-xl font-bold flex items-center gap-2" style={{color:ct.tx}}><Brain size={22} className="text-violet-400"/>AI Business Intelligence</h1><p className="text-xs mt-0.5" style={{color:ct.tx2}}>Natural language → Prisma query → GPT insight · businessId injected server-side</p></div>
      <div className="gc rounded-xl p-4" style={CARD}>
        <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2"><Brain size={14} className="text-violet-400"/>Ask Your Data</h3>
        <div className="flex flex-wrap gap-2 mb-3">{suggestions.map((q,i)=><button key={i} onClick={()=>setQuery(q)} className="px-2.5 py-1.5 rounded-lg text-xs text-slate-300 hover:text-white hover:bg-white/5 transition-all" style={{border:"1px solid rgba(255,255,255,0.06)"}}>{q}</button>)}</div>
        <div className="flex gap-2"><input value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>e.key==="Enter"&&run()} placeholder="Ask anything about your customers, revenue, campaigns..." className={`flex-1 ${inp}`} style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.08)"}}/><button onClick={run} disabled={!query||loading} className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium text-white disabled:opacity-40" style={{background:"linear-gradient(135deg,#8b5cf6,#7c3aed)"}}>{loading?<RefreshCw size={14} className="animate-spin"/>:<Send size={14}/>}{loading?"Thinking…":"Ask"}</button></div>
        {err&&<div className="mt-3 p-3 rounded-lg text-xs text-red-400" style={{background:"rgba(239,68,68,0.08)",border:"1px solid rgba(239,68,68,0.15)"}}>{err}</div>}
        {res&&<div className="mt-3 p-4 rounded-xl" style={{background:"rgba(139,92,246,0.08)",border:"1px solid rgba(139,92,246,0.2)"}}><p className="text-sm text-white leading-relaxed">{res.insight??res.answer}</p>{res.dataSnapshot&&<p className="text-xs text-slate-400 mt-2">{res.dataSnapshot.summary}</p>}{res.actionLabel&&res.actionPath&&<a href={res.actionPath} className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-white" style={{background:"linear-gradient(135deg,#8b5cf6,#7c3aed)"}}>{res.actionLabel}</a>}{res.data&&Array.isArray(res.data)&&res.data.length>0&&<div className="mt-3 space-y-1">{res.data.slice(0,5).map((row:any,i:number)=><div key={i} className="text-xs text-slate-300 font-mono bg-black/20 px-2 py-1 rounded">{JSON.stringify(row)}</div>)}</div>}</div>}
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
  const portalBase=(import.meta as any).env?.VITE_PORTAL_BASE_URL||"https://theloyaly.com";
  const portalUrl=`${portalBase}/portal/${slug}`;

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

          {/* Background Images — removed */}
          {false&&(
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
          )}

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

          {/* Feedback & Google reviews */}
          <PortalCard>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-3">Feedback & Reviews</p>
            <div className="space-y-3">
              <div>
                <label className="text-white text-sm font-medium block mb-1">⭐ Google review link</label>
                <p className="text-slate-500 text-xs mb-2">Shown to happy customers (4–5★) after they leave feedback, so they can review you on Google Maps.</p>
                <input value={ps.googleReviewUrl||""} onChange={e=>setPs((p:any)=>({...p,googleReviewUrl:e.target.value}))} placeholder="https://g.page/r/...  or  https://search.google.com/local/writereview?placeid=..." className="w-full px-3 py-2 rounded-xl text-sm text-white outline-none" style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)"}}/>
              </div>
              <div>
                <label className="text-white text-sm font-medium block mb-1">🎁 Points for leaving feedback</label>
                <input type="number" value={ps.feedbackBonusPoints??20} onChange={e=>setPs((p:any)=>({...p,feedbackBonusPoints:Number(e.target.value)}))} className="w-32 px-3 py-2 rounded-xl text-sm text-white outline-none" style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)"}}/>
              </div>
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
  const ct=useCard();
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
        <ResponsiveContainer width="100%" height={180}><AreaChart data={msgPerf}><defs><linearGradient id="amsg1" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#3b82f6" stopOpacity={0.35}/><stop offset="100%" stopColor="#3b82f6" stopOpacity={0}/></linearGradient><linearGradient id="amsg2" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#22c55e" stopOpacity={0.35}/><stop offset="100%" stopColor="#22c55e" stopOpacity={0}/></linearGradient><linearGradient id="amsg3" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#06b6d4" stopOpacity={0.35}/><stop offset="100%" stopColor="#06b6d4" stopOpacity={0}/></linearGradient></defs><CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)"/><XAxis dataKey="w" tick={{fill:"#64748b",fontSize:11}} axisLine={false} tickLine={false}/><YAxis tick={{fill:"#64748b",fontSize:11}} axisLine={false} tickLine={false}/><Tooltip contentStyle={{background:"#1e1e2d",border:"1px solid rgba(255,255,255,0.1)",borderRadius:8,fontSize:12,color:"#fff"}}/><Area type="monotone" dataKey="sent" name="Sent" stroke="#3b82f6" fill="url(#amsg1)" strokeWidth={2}/><Area type="monotone" dataKey="del" name="Delivered" stroke="#22c55e" fill="url(#amsg2)" strokeWidth={2}/><Area type="monotone" dataKey="read" name="Read" stroke="#06b6d4" fill="url(#amsg3)" strokeWidth={2}/></AreaChart></ResponsiveContainer>}
      </div>
    </div>
    <div className="gc rounded-xl p-4" style={CARD}>
      <h3 className="text-sm font-semibold text-white mb-3">Customer Growth & Retention</h3>
      {loading?<Skeleton h="h-[200px]"/>:growthData.length===0?<div className="h-[200px] flex items-center justify-center text-slate-500 text-sm">No snapshot data yet — snapshots are computed nightly</div>:
      <ResponsiveContainer width="100%" height={200}><AreaChart data={growthData}><defs><linearGradient id="agrow1" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.35}/><stop offset="100%" stopColor="#8b5cf6" stopOpacity={0}/></linearGradient><linearGradient id="agrow2" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#22c55e" stopOpacity={0.35}/><stop offset="100%" stopColor="#22c55e" stopOpacity={0}/></linearGradient></defs><CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)"/><XAxis dataKey="m" tick={{fill:"#64748b",fontSize:11}} axisLine={false} tickLine={false}/><YAxis tick={{fill:"#64748b",fontSize:11}} axisLine={false} tickLine={false}/><Tooltip contentStyle={{background:"#1e1e2d",border:"1px solid rgba(255,255,255,0.1)",borderRadius:8,fontSize:12,color:"#fff"}}/><Area type="monotone" dataKey="c" name="Total Customers" stroke="#8b5cf6" fill="url(#agrow1)" strokeWidth={2}/><Area type="monotone" dataKey="ret" name="Active" stroke="#22c55e" fill="url(#agrow2)" strokeWidth={2}/></AreaChart></ResponsiveContainer>}
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
    }catch(e:any){setErrMsg(e?.message||"Could not start WhatsApp. Please try again.");}
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
              ? qr.startsWith("data:")
                ? <img src={qr} alt="WhatsApp QR" className="w-52 h-52 rounded-xl bg-white p-2"/>
                : <div className="rounded-xl bg-white p-3"><Suspense fallback={<div className="w-52 h-52 flex items-center justify-center"><RefreshCw size={24} className="animate-spin text-violet-400"/></div>}><QRCodeSVG value={qr} size={200}/></Suspense></div>
              : <div className="w-52 h-52 rounded-xl flex items-center justify-center" style={{background:"rgba(255,255,255,0.05)"}}><RefreshCw size={28} className="text-slate-500 animate-spin"/></div>
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

      {/* Sending health — warmup budget + failover state (only once connected) */}
      {connected&&status?.warmup&&(
        <div className="rounded-2xl p-4" style={{background:"rgba(255,255,255,0.02)",border:"1px solid rgba(255,255,255,0.06)"}}>
          <div className="flex items-center justify-between mb-3">
            <div className="text-xs font-semibold text-slate-300">Sending health</div>
            {status?.health?.activeSlot==="BACKUP"
              ?<span className="text-[10px] px-2 py-0.5 rounded-full text-amber-400" style={{background:"rgba(251,191,36,0.12)"}}>On backup number</span>
              :<span className="text-[10px] px-2 py-0.5 rounded-full text-green-400" style={{background:"rgba(34,197,94,0.12)"}}>Primary · healthy</span>}
          </div>
          {status.warmup.enabled&&status.warmup.cap!==-1?(
            <>
              <div className="flex items-center justify-between text-[11px] text-slate-400 mb-1.5">
                <span>Daily warm-up limit</span>
                <span className="text-slate-300 font-medium">{status.warmup.used} / {status.warmup.cap} today</span>
              </div>
              <div className="h-2 rounded-full overflow-hidden" style={{background:"rgba(255,255,255,0.06)"}}>
                <div className="h-full rounded-full" style={{width:`${Math.min(100,(status.warmup.used/Math.max(1,status.warmup.cap))*100)}%`,background:"linear-gradient(90deg,#25D366,#128C7E)"}}/>
              </div>
              <div className="text-[10px] text-slate-500 mt-2">New numbers ramp up gradually to stay safe with WhatsApp. This limit increases automatically over your first 30 days.</div>
            </>
          ):(
            <div className="text-[11px] text-slate-400">Your number is fully warmed up — no daily limit. <span className="text-slate-300">{status.warmup.used} sent today.</span></div>
          )}
          {!status?.health?.hasBackup&&(
            <div className="text-[10px] text-slate-500 mt-2 pt-2" style={{borderTop:"1px solid rgba(255,255,255,0.05)"}}>💡 Add a backup number in advanced settings so we can auto-switch if this one drops.</div>
          )}
        </div>
      )}

      {/* Advanced config — collapsed by default. WAHA override fields are
          only relevant when the platform is running the external WAHA
          provider; with the default in-process gateway there's nothing to
          configure, so we show a short explainer instead. */}
      <div>
        <button onClick={()=>setShowAdvanced(v=>!v)} className="text-xs text-slate-500 hover:text-slate-300 flex items-center gap-1">
          <RefreshCw size={10}/>{showAdvanced?"Hide":"Show"} advanced settings
        </button>
        {showAdvanced&&(status?.provider==="BAILEYS"
          ?<div className="mt-3 p-4 rounded-xl text-xs text-slate-400 leading-relaxed" style={{background:"rgba(255,255,255,0.02)",border:"1px solid rgba(255,255,255,0.06)"}}>
            <div className="flex items-center gap-1.5 text-slate-300 font-medium mb-1"><Shield size={12} className="text-green-400"/>Built-in WhatsApp gateway</div>
            WhatsApp runs directly inside Loyable — no external server to configure. Just scan the QR code above to connect your number.
          </div>
          :<div className="mt-3 space-y-3 p-4 rounded-xl" style={{background:"rgba(255,255,255,0.02)",border:"1px solid rgba(255,255,255,0.06)"}}>
            <div className="text-xs text-slate-400 mb-2">Override WAHA server defaults (leave blank to use server config)</div>
            {[{l:"WAHA Base URL",k:"wahaBaseUrl",ph:"http://localhost:3001"},{l:"Session Name",k:"wahaSessionId",ph:"default"},{l:"API Key",k:"wahaApiKey",ph:"••••••",type:"password"}].map(f=>(
              <div key={f.k}>
                <label className="text-xs text-slate-400 mb-1 block">{f.l}</label>
                <input value={(cfg as any)[f.k]||""} type={f.type||"text"} onChange={e=>setCfg(p=>({...p,[f.k]:e.target.value}))} placeholder={f.ph} className="w-full px-3 py-2 rounded-lg text-xs text-white outline-none font-mono" style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.08)"}}/>
              </div>
            ))}
            <button onClick={saveAdvanced} disabled={saving} className="px-3 py-1.5 rounded-lg text-xs font-medium text-white disabled:opacity-50" style={{background:"rgba(139,92,246,0.3)"}}>{saving?"Saving…":"Save"}</button>
          </div>
        )}
      </div>
    </div>
  );
};

const PLANS=[
  {tier:"FREE",       label:"Free",        price:"£0",     msgs:"200 msgs/mo",   features:["QR Check-in","200 customers","Basic analytics"]},
  {tier:"STARTER",    label:"Starter",     price:"£19",    msgs:"1,000 msgs/mo", features:["Everything in Free","Campaigns","Loyalty tiers","Automations","Email support"]},
  {tier:"GROWTH",     label:"Growth",      price:"£49",    msgs:"10,000 msgs/mo",features:["Everything in Starter","AI Insights","Multi-location","CSV import","Priority support"],highlight:true},
  {tier:"PROFESSIONAL",label:"Professional",price:"£99",   msgs:"50,000 msgs/mo",features:["Everything in Growth","White label","API access","Outbound webhooks"]},
  {tier:"ENTERPRISE", label:"Enterprise",  price:"Custom", msgs:"Unlimited",      features:["Everything in Professional","SLA","Dedicated support","Custom integrations"]},
];

const BillingTab=()=>{
  const [sub,setSub]=useState<any>(null);
  useEffect(()=>{api.auth.me().then((d:any)=>setSub(d?.user?.business?.subscription)).catch(()=>{});},[]);
  const currentTier=sub?.tier??"FREE";
  const quota=sub?.monthlyMessageQuota??200;
  const [upgrading,setUpgrading]=useState(false);
  const [msg,setMsg]=useState("");

  const handleUpgrade=async(tier:string)=>{
    if(tier===currentTier)return;
    setUpgrading(true);setMsg("");
    try{
      const r=await fetch("/api/billing/checkout",{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${localStorage.getItem("accessToken")??""}`},body:JSON.stringify({priceId:tier,returnUrl:window.location.href})});
      if(!r.ok)throw new Error((await r.json()).error??"Failed");
      const d=await r.json();
      if(d.url)window.location.href=d.url;
      else setMsg("Contact hello@theloyaly.com to upgrade to this plan.");
    }catch(e:any){setMsg(e.message??"Contact hello@theloyaly.com to upgrade.");}
    finally{setUpgrading(false);}
  };

  return(
    <div className="space-y-5">
      <div className="p-4 rounded-xl" style={{background:"linear-gradient(135deg,rgba(139,92,246,0.15),rgba(6,182,212,0.1))",border:"1px solid rgba(139,92,246,0.25)"}}>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <Badge color={TIER_COLORS[currentTier]||"#6b7280"}>{currentTier}</Badge>
            <div className="text-xl font-bold text-white mt-2">{PLANS.find(p=>p.tier===currentTier)?.price??"—"}<span className="text-xs text-slate-400 font-normal">/month</span></div>
            <div className="text-xs text-slate-400 mt-1">{quota.toLocaleString()} messages per month · Status: {sub?.status??"—"}</div>
          </div>
          <a href="mailto:hello@theloyaly.com?subject=Billing+Query" className="px-4 py-2 rounded-xl text-xs font-semibold text-white" style={{background:"linear-gradient(135deg,#8b5cf6,#7c3aed)"}}>Contact Support</a>
        </div>
      </div>

      <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Available Plans</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {PLANS.map(p=>{
          const isCurrent=p.tier===currentTier;
          return(
            <div key={p.tier} className="rounded-xl p-4" style={{background:p.highlight?"linear-gradient(135deg,rgba(139,92,246,0.12),rgba(6,182,212,0.08))":"rgba(255,255,255,0.03)",border:isCurrent?"1px solid rgba(139,92,246,0.5)":p.highlight?"1px solid rgba(139,92,246,0.25)":"1px solid rgba(255,255,255,0.06)"}}>
              <div className="flex items-center justify-between mb-2">
                <div className="text-sm font-bold text-white">{p.label}</div>
                {isCurrent&&<Badge color={TIER_COLORS[p.tier]}>Current</Badge>}
                {p.highlight&&!isCurrent&&<Badge color="#8b5cf6">Popular</Badge>}
              </div>
              <div className="text-lg font-black text-white mb-0.5">{p.price}<span className="text-xs text-slate-400 font-normal">/mo</span></div>
              <div className="text-xs text-slate-400 mb-3">{p.msgs}</div>
              <ul className="space-y-1 mb-4">{p.features.map(f=><li key={f} className="text-xs text-slate-300 flex items-center gap-1.5"><CheckCircle size={10} className="text-green-400 flex-shrink-0"/>{f}</li>)}</ul>
              <button onClick={()=>handleUpgrade(p.tier)} disabled={isCurrent||upgrading} className="w-full py-2 rounded-xl text-xs font-semibold text-white disabled:opacity-50 transition-all" style={{background:isCurrent?"rgba(255,255,255,0.05)":p.highlight?"linear-gradient(135deg,#8b5cf6,#7c3aed)":"rgba(139,92,246,0.2)"}}>
                {isCurrent?"Current Plan":p.tier==="ENTERPRISE"?"Contact Sales":`Upgrade to ${p.label}`}
              </button>
            </div>
          );
        })}
      </div>
      {msg&&<div className="p-3 rounded-xl text-xs text-amber-300" style={{background:"rgba(245,158,11,0.1)",border:"1px solid rgba(245,158,11,0.2)"}}>{msg}</div>}
      <div className="p-3 rounded-xl text-xs text-slate-400" style={{background:"rgba(255,255,255,0.02)"}}>
        Payments are processed securely via Stripe. To cancel or change your subscription, contact <a href="mailto:hello@theloyaly.com" className="text-violet-400 underline">hello@theloyaly.com</a>. Plan changes take effect immediately.
      </div>
    </div>
  );
};

const INDUSTRY_OPTIONS=["Café & Restaurant","Coffee Shop","Bar","Hair Salon","Beauty Salon","Barbershop","Nail Studio","Spa","Gym","Fitness Studio","CrossFit","Yoga Studio","Sports Club","Retail","Boutique","Pharmacy","Supermarket","Other"];

// ── Add Staff Form ───────────────────────────────────────────────
const AddStaffForm=()=>{
  const [staffName,setStaffName]=useState("");
  const [staffRole,setStaffRole]=useState("MARKETING_STAFF");
  const [staffPass,setStaffPass]=useState("");
  const [personalEmail,setPersonalEmail]=useState("");
  const [staffPhone,setStaffPhone]=useState("");
  const [showPass,setShowPass]=useState(false);
  const [saving,setSaving]=useState(false);
  const [result,setResult]=useState<{loginEmail:string;name:string;role:string}|null>(null);
  const [err,setErr]=useState("");
  const [staffList,setStaffList]=useState<any[]>([]);
  const [revoking,setRevoking]=useState<string|null>(null);
  useEffect(()=>{
    api.staff.list().then(d=>setStaffList(d.staff??[])).catch(()=>{});
  },[]);

  const roleLabelMap:Record<string,string>={BRANCH_MANAGER:"Manager",MARKETING_STAFF:"Marketing",CASHIER:"Staff"};

  const create=async()=>{
    if(!staffName.trim()){setErr("Please enter the staff member's name.");return;}
    if(staffPass.length<6){setErr("Password must be at least 6 characters.");return;}
    if(!personalEmail.includes("@")){setErr("Please enter a valid personal email to send credentials to.");return;}
    setErr("");setSaving(true);
    try{
      const d=await api.staff.create({name:staffName.trim(),role:staffRole,password:staffPass,personalEmail:personalEmail.trim(),...(staffPhone.trim()?{phone:staffPhone.trim()}:{})});
      setResult(d);
      setStaffList(p=>[...p,{...d,email:d.loginEmail,isActive:true}]);
      setStaffName("");setStaffPass("");setPersonalEmail("");setStaffPhone("");
    }catch(e:any){setErr(e.message||"Something went wrong.");}
    finally{setSaving(false);}
  };
  const revoke=async(id:string)=>{
    if(!window.confirm("Remove this staff member's access? They will no longer be able to log in."))return;
    setRevoking(id);
    try{await api.staff.remove(id);setStaffList(p=>p.filter(s=>s.id!==id));}
    catch(e:any){alert(e.message||"Failed to remove staff.");}
    finally{setRevoking(null);}
  };

  const inpSt={background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:"10px",padding:"10px 12px",fontSize:"13px",color:"white",width:"100%",outline:"none"};

  if(result) return(
    <div className="rounded-xl p-4 space-y-3" style={{background:"rgba(34,197,94,0.06)",border:"1px solid rgba(34,197,94,0.2)"}}>
      <div className="flex items-center gap-2 text-green-400 font-semibold text-sm"><CheckCircle size={16}/>Staff member added successfully!</div>
      <p className="text-xs text-slate-400">Credentials have been emailed to <strong className="text-white">{personalEmail||"their personal email"}</strong>. Share the login details below with them directly as well.</p>
      <div className="rounded-xl p-4 space-y-2" style={{background:"rgba(0,0,0,0.3)",border:"1px solid rgba(255,255,255,0.08)"}}>
        <div className="text-xs text-slate-400 mb-1 font-semibold uppercase tracking-wider">Login Credentials</div>
        <div className="flex items-center justify-between">
          <div><div className="text-xs text-slate-500">Login Email</div><div className="text-sm font-mono text-white mt-0.5">{result.loginEmail}</div></div>
          <button onClick={()=>navigator.clipboard.writeText(result.loginEmail)} className="p-1.5 rounded-lg text-slate-400 hover:text-white" style={{background:"rgba(255,255,255,0.05)"}}><Copy size={13}/></button>
        </div>
        <div className="flex items-center justify-between">
          <div><div className="text-xs text-slate-500">Name</div><div className="text-sm text-white mt-0.5">{result.name}</div></div>
        </div>
        <div className="flex items-center justify-between">
          <div><div className="text-xs text-slate-500">Role</div><div className="text-sm text-white mt-0.5">{roleLabelMap[result.role]||result.role}</div></div>
        </div>
        <p className="text-xs text-amber-400 mt-2">⚠️ Save the password now — it is not shown again after this screen.</p>
      </div>
      <button onClick={()=>setResult(null)} className="text-xs font-medium px-3 py-2 rounded-lg text-white" style={{background:"linear-gradient(135deg,#8b5cf6,#7c3aed)"}}>Add Another Staff Member</button>
    </div>
  );

  return(
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-slate-400 mb-1">Full Name *</label>
          <input value={staffName} onChange={e=>{setStaffName(e.target.value);setErr("");}} placeholder="e.g. Sarah Khan" style={inpSt}/>
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">Role *</label>
          <select value={staffRole} onChange={e=>setStaffRole(e.target.value)} style={{...inpSt,appearance:"none" as const}}>
            <option value="BRANCH_MANAGER">Manager</option>
            <option value="MARKETING_STAFF">Marketing</option>
            <option value="CASHIER">Staff</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">Their Personal Email (to receive credentials) *</label>
          <input value={personalEmail} onChange={e=>{setPersonalEmail(e.target.value);setErr("");}} type="email" placeholder="sarah@gmail.com" style={inpSt}/>
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">Set Their Password *</label>
          <div className="relative">
            <input value={staffPass} onChange={e=>{setStaffPass(e.target.value);setErr("");}} type={showPass?"text":"password"} placeholder="Min 6 characters" style={{...inpSt,paddingRight:"36px"}}/>
            <button type="button" onClick={()=>setShowPass(p=>!p)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">{showPass?<EyeOff size={13}/>:<Eye size={13}/>}</button>
          </div>
        </div>
        <div className="sm:col-span-2">
          <label className="block text-xs text-slate-400 mb-1">Their WhatsApp Number <span className="text-slate-500">(optional — so campaigns never message them)</span></label>
          <PhoneInput value={staffPhone} onChange={v=>{setStaffPhone(v);setErr("");}} inputStyle={inpSt}/>
        </div>
      </div>
      <div className="rounded-lg px-3 py-2 text-xs text-slate-400" style={{background:"rgba(139,92,246,0.06)",border:"1px solid rgba(139,92,246,0.15)"}}>
        🔑 Login email will be auto-generated as <span className="font-mono text-violet-300">{staffName.trim()?`${staffName.trim().split(" ")[0].toLowerCase().replace(/[^a-z0-9]/g,"")}.${staffRole==="BRANCH_MANAGER"?"manager":staffRole==="MARKETING_STAFF"?"marketing":"staff"}XX@theloyaly.com`:"name.roleXX@theloyaly.com"}</span>
      </div>
      {err&&<div className="text-xs text-red-400">{err}</div>}
      <button onClick={create} disabled={saving} className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold text-white disabled:opacity-40" style={{background:"linear-gradient(135deg,#8b5cf6,#7c3aed)"}}>
        {saving?<RefreshCw size={12} className="animate-spin"/>:<UserPlus size={12}/>}{saving?"Creating…":"Create Staff Account"}
      </button>

      {/* Current staff list */}
      {staffList.length>0&&<div className="mt-4 space-y-2">
        <div className="text-xs font-semibold text-slate-300">Current Staff</div>
        {staffList.map(s=>(
          <div key={s.id} className="flex items-center justify-between px-3 py-2.5 rounded-xl" style={{background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.07)"}}>
            <div>
              <div className="text-xs font-medium text-white">{s.name}</div>
              <div className="text-xs text-slate-500 font-mono mt-0.5">{s.email} · {roleLabelMap[s.role]||s.role}</div>
            </div>
            <button onClick={()=>revoke(s.id)} disabled={revoking===s.id} title="Revoke access" className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs text-red-400 disabled:opacity-40" style={{background:"rgba(239,68,68,0.08)",border:"1px solid rgba(239,68,68,0.2)"}}>
              {revoking===s.id?<RefreshCw size={11} className="animate-spin"/>:<UserMinus size={11}/>}Revoke
            </button>
          </div>
        ))}
      </div>}
    </div>
  );
};

// ── Delete Account Modal ─────────────────────────────────────────
const DeleteAccountModal=({onClose,onDeleted}:{onClose:()=>void,onDeleted:()=>void})=>{
  const [step,setStep]=useState<1|2>(1);
  const [typedName,setTypedName]=useState("");
  const [deleting,setDeleting]=useState(false);
  const [err,setErr]=useState("");
  const bizName=localStorage.getItem("biz_name")||"";
  const nameMatches=typedName.trim().toLowerCase()===bizName.trim().toLowerCase();
  const doDelete=async()=>{
    setDeleting(true);setErr("");
    try{
      await api.account.deleteAll(typedName.trim());
      localStorage.clear();
      onDeleted();
    }catch(e:any){setErr(e?.message||"Something went wrong. Please try again.");setDeleting(false);}
  };
  return(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{background:"rgba(0,0,0,0.7)"}}>
      <div className="w-full max-w-md rounded-2xl p-6 space-y-4" style={{background:"#0f0a1e",border:"1px solid rgba(239,68,68,0.3)"}}>
        {step===1&&<>
          <div className="text-center">
            <div className="w-14 h-14 rounded-full mx-auto mb-3 flex items-center justify-center" style={{background:"rgba(239,68,68,0.12)"}}>
              <Trash2 size={24} className="text-red-400"/>
            </div>
            <h2 className="text-lg font-bold text-white mb-1">Delete your account?</h2>
            <p className="text-sm text-slate-400">This will permanently delete <strong className="text-white">{bizName}</strong> and everything in it — all customers, campaigns, loyalty points, messages, and settings.</p>
            <p className="text-sm font-semibold text-red-400 mt-3">⚠️ This cannot be undone. Ever.</p>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-2">Type your business name to confirm:</label>
            <p className="text-xs text-slate-500 mb-2 font-mono bg-white/5 rounded px-2 py-1 text-center">{bizName}</p>
            <input
              value={typedName}
              onChange={e=>{setTypedName(e.target.value);setErr("");}}
              placeholder="Type business name exactly"
              className="w-full rounded-xl px-4 py-3 text-sm text-white outline-none"
              style={{background:"rgba(255,255,255,0.07)",border:`1px solid ${nameMatches&&typedName?"rgba(239,68,68,0.5)":"rgba(255,255,255,0.1)"}`}}
            />
          </div>
          {err&&<div className="text-xs text-red-400 text-center">{err}</div>}
          <div className="flex gap-3 pt-1">
            <button onClick={onClose} className="flex-1 py-2.5 rounded-xl text-sm font-medium text-slate-300" style={{background:"rgba(255,255,255,0.07)"}}>Cancel</button>
            <button
              onClick={()=>{if(!nameMatches){setErr("The name you typed doesn't match. Please type it exactly as shown.");return;}setStep(2);}}
              disabled={!typedName}
              className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-40"
              style={{background:nameMatches?"rgba(239,68,68,0.8)":"rgba(239,68,68,0.3)"}}>
              Continue
            </button>
          </div>
        </>}
        {step===2&&<>
          <div className="text-center">
            <div className="w-14 h-14 rounded-full mx-auto mb-3 flex items-center justify-center" style={{background:"rgba(239,68,68,0.15)"}}>
              <AlertTriangle size={24} className="text-red-400"/>
            </div>
            <h2 className="text-lg font-bold text-white mb-2">Last chance — are you sure?</h2>
            <p className="text-sm text-slate-400 mb-3">You are about to permanently delete <strong className="text-white">{bizName}</strong> and all of its data. Once deleted, it is gone forever and cannot be recovered by anyone.</p>
            <div className="rounded-xl p-3 text-left space-y-1.5 mb-2" style={{background:"rgba(239,68,68,0.08)",border:"1px solid rgba(239,68,68,0.2)"}}>
              {["All customers and their loyalty points","All campaigns and messages","All automations and settings","Your WhatsApp connection","Your subscription and billing history"].map((item,i)=>(
                <div key={i} className="flex items-center gap-2 text-xs text-red-300"><X size={10} className="flex-shrink-0"/>{item}</div>
              ))}
            </div>
            <p className="text-xs text-slate-500">A confirmation email will be sent to you after deletion.</p>
          </div>
          {err&&<div className="text-xs text-red-400 text-center">{err}</div>}
          <div className="flex gap-3 pt-1">
            <button onClick={()=>setStep(1)} disabled={deleting} className="flex-1 py-2.5 rounded-xl text-sm font-medium text-slate-300" style={{background:"rgba(255,255,255,0.07)"}}>Go Back</button>
            <button
              onClick={doDelete}
              disabled={deleting}
              className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50 flex items-center justify-center gap-2"
              style={{background:"rgba(220,38,38,0.9)"}}>
              {deleting?<><RefreshCw size={13} className="animate-spin"/>Deleting…</>:<><Trash2 size={13}/>Yes, Delete Everything</>}
            </button>
          </div>
        </>}
      </div>
    </div>
  );
};

const GdprTab=({onAccountDeleted}:{onAccountDeleted:()=>void})=>{
  const [purging,setPurging]=useState(false);
  const [phone,setPhone]=useState("");
  const [done,setDone]=useState("");
  const [showDeleteModal,setShowDeleteModal]=useState(false);
  const role=localStorage.getItem("role")||"";
  const isOwner=role==="TENANT_OWNER";
  const doPurge=async()=>{
    if(!phone.trim()){alert("Please enter a phone number.");return;}
    setPurging(true);setDone("");
    try{
      await api.customers.purge(phone.trim());
      setDone("Done — all personal data for that customer has been permanently deleted.");
      setPhone("");
    }catch(e:any){alert(e?.message||"Something went wrong. Please try again.");}
    finally{setPurging(false);}
  };
  return(
    <div className="space-y-4">
      {showDeleteModal&&<DeleteAccountModal onClose={()=>setShowDeleteModal(false)} onDeleted={onAccountDeleted}/>}
      <p className="text-xs text-slate-400">Control how your customers' personal information is handled. All settings below are active by default.</p>
      <div className="space-y-2">
        {[
          {l:"WhatsApp Marketing Permission",d:"Customers can text STOP at any time to unsubscribe from WhatsApp messages. We handle this automatically."},
          {l:"Email Marketing Permission",d:"Each customer has a separate on/off switch for email marketing."},
          {l:"SMS Marketing Permission",d:"Separate permission for SMS messages — independent from WhatsApp and email."},
          {l:"Push Notification Permission",d:"For future mobile app notifications — customers control this themselves."},
        ].map((c,i)=>(
          <div key={i} className="p-3 rounded-lg flex items-center justify-between" style={{background:"rgba(255,255,255,0.02)"}}>
            <div><div className="text-xs text-white font-medium">{c.l}</div><div className="text-xs text-slate-500 mt-0.5">{c.d}</div></div>
            <Badge color={C.green}>On</Badge>
          </div>
        ))}
      </div>
      <div className="p-4 rounded-xl" style={{background:"rgba(34,197,94,0.06)",border:"1px solid rgba(34,197,94,0.15)"}}>
        <div className="text-xs font-semibold text-green-400 mb-1">🛑 Auto Unsubscribe</div>
        <div className="text-xs text-slate-400">If a customer replies STOP, UNSUBSCRIBE, or CANCEL to any WhatsApp message, they are immediately removed from all future marketing messages. No action needed from you.</div>
      </div>
      <div className="p-4 rounded-xl" style={{background:"rgba(239,68,68,0.06)",border:"1px solid rgba(239,68,68,0.15)"}}>
        <div className="text-xs font-semibold text-red-400 mb-2">🗑️ Delete a Customer's Data</div>
        <div className="text-xs text-slate-400 mb-3">If a customer asks you to delete their information, enter their phone number below. All their personal details will be permanently removed from your account.</div>
        <div className="flex gap-2">
          <div className="flex-1"><PhoneInput value={phone} onChange={setPhone} inputStyle={{background:"rgba(255,255,255,0.07)",border:"1px solid rgba(239,68,68,0.25)",padding:"6px 10px",fontSize:"12px"}}/></div>
          <button onClick={doPurge} disabled={purging} className="px-3 py-2 rounded-lg text-xs font-medium text-red-300 disabled:opacity-50 flex items-center gap-1.5" style={{border:"1px solid rgba(239,68,68,0.3)",background:"rgba(239,68,68,0.08)"}}>
            {purging?<RefreshCw size={11} className="animate-spin"/>:<Trash2 size={11}/>}{purging?"Deleting…":"Delete Data"}
          </button>
        </div>
        {done&&<div className="mt-2 text-xs text-green-400">{done}</div>}
      </div>
      {isOwner&&<div className="p-4 rounded-xl" style={{background:"rgba(239,68,68,0.04)",border:"1px solid rgba(239,68,68,0.2)"}}>
        <div className="text-xs font-semibold text-red-400 mb-1">⛔ Delete My Account</div>
        <div className="text-xs text-slate-400 mb-3">This will permanently delete your entire business account — all customers, campaigns, points, and data. This action cannot be undone.</div>
        <button onClick={()=>setShowDeleteModal(true)} className="px-4 py-2 rounded-lg text-xs font-semibold text-red-300 flex items-center gap-1.5" style={{background:"rgba(239,68,68,0.12)",border:"1px solid rgba(239,68,68,0.35)"}}>
          <Trash2 size={11}/>Delete My Account
        </button>
      </div>}
    </div>
  );
};

const SettingsPage=({wa,onConnect}:any)=>{
  const ct=useCard();
  const [tab,setTab]=useState("business");
  const [industry,setIndustry]=useState(()=>localStorage.getItem("biz_industry")||"Café & Restaurant");
  const [bizNameVal,setBizNameVal]=useState(()=>localStorage.getItem("biz_name")||"");
  const [countryVal,setCountryVal]=useState(()=>localStorage.getItem("biz_country")||"GB");
  const [currencyVal,setCurrencyVal]=useState(()=>localStorage.getItem("biz_currency")||"GBP");
  const [logoUrlVal,setLogoUrlVal]=useState(()=>localStorage.getItem("biz_logo")||"");
  const [bizSaved,setBizSaved]=useState(false);
  const [inviteEmail,setInviteEmail]=useState("");
  const [inviteRole,setInviteRole]=useState("MARKETING_STAFF");
  const [inviting,setInviting]=useState(false);
  const [inviteMsg,setInviteMsg]=useState("");
  const [pointsPerPound,setPointsPerPound]=useState(()=>parseInt(localStorage.getItem("pointsPerPound")||"1",10));
  const [visitBasePoints,setVisitBasePoints]=useState(()=>parseInt(localStorage.getItem("visitBasePoints")||"5",10));
  const [loyaltySaved,setLoyaltySaved]=useState(false);
  const saveLoyaltySettings=async()=>{
    try{
      await api.settings.update({pointsPerPound,visitBasePoints});
      localStorage.setItem("pointsPerPound",String(pointsPerPound));
      localStorage.setItem("visitBasePoints",String(visitBasePoints));
      setLoyaltySaved(true);setTimeout(()=>setLoyaltySaved(false),2500);
    }catch{}
  };
  const saveIndustry=(v:string)=>{setIndustry(v);localStorage.setItem("biz_industry",v);localStorage.removeItem("pos_biztype_override");api.settings.update({industry:v}).catch(()=>{});};
  const saveBizSettings=async()=>{
    try{
      await api.settings.update({name:bizNameVal,currency:currencyVal,country:countryVal||undefined,logoUrl:logoUrlVal||undefined,industry});
      localStorage.setItem("biz_name",bizNameVal);
      localStorage.setItem("biz_currency",currencyVal);
      localStorage.setItem("biz_country",countryVal);
      if(logoUrlVal)localStorage.setItem("biz_logo",logoUrlVal);
      setBizSaved(true);setTimeout(()=>setBizSaved(false),2500);
    }catch{}
  };
  const isPK=countryVal==="PK";
  const tabs=[{id:"business",label:"Business",icon:Building},{id:"loyalty",label:"Loyalty Program",icon:Award},{id:"whatsapp",label:"WhatsApp API",icon:MessageSquare},{id:"rbac",label:"Team & Roles",icon:Users},{id:"stripe",label:"Billing",icon:CreditCard},{id:"security",label:"Security",icon:Shield},{id:"gdpr",label:"Privacy",icon:Globe},...(isPK?[{id:"fbr",label:"FBR / Tax",icon:Receipt}]:[]) ];
  return(
    <div className="space-y-4">
      <div><h1 className="text-xl font-bold" style={{color:ct.tx}}>Settings</h1><p className="text-xs mt-0.5" style={{color:ct.tx2}}>Manage your business, loyalty program, team, and billing</p></div>
      <div className="flex gap-1 overflow-x-auto pb-1">{tabs.map(t=><button key={t.id} onClick={()=>setTab(t.id)} className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs whitespace-nowrap ${tab===t.id?"text-white":"text-slate-400"}`} style={tab===t.id?{background:"rgba(139,92,246,0.2)"}:{}}><t.icon size={12}/>{t.label}{t.id==="whatsapp"&&<span className={`w-1.5 h-1.5 rounded-full ${wa?"bg-green-400":"bg-red-400"}`}/>}</button>)}</div>
      {tab==="loyalty"&&<LoyaltyPage/>}
      <div className="gc rounded-xl p-5" style={{...CARD,...(tab==="loyalty"?{display:"none"}:{})}}>
        {tab==="business"&&<div className="space-y-4">
          <div className="flex items-center gap-4 mb-2">
            {logoUrlVal
              ?<img src={logoUrlVal} className="w-16 h-16 rounded-2xl object-contain" style={{background:"rgba(255,255,255,0.08)"}} alt="logo"/>
              :<div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{background:"linear-gradient(135deg,#8b5cf6,#06b6d4)"}}><span className="text-white font-bold text-xl">{bizNameVal.slice(0,2).toUpperCase()||"BZ"}</span></div>
            }
            <div>
              <div className="text-xs font-semibold text-white">{bizNameVal||"Your Business"}</div>
              <div className="text-[10px] text-slate-500 mt-0.5">Logo URL appears on receipts and customer portal</div>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div><label className="text-xs text-slate-400 mb-1 block">Business Name</label><input value={bizNameVal} onChange={e=>setBizNameVal(e.target.value)} className="w-full px-3 py-2 rounded-lg text-xs text-white outline-none" style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.08)"}}/></div>
            <div><label className="text-xs text-slate-400 mb-1 block">Logo URL (for receipts & portal)</label><input value={logoUrlVal} onChange={e=>setLogoUrlVal(e.target.value)} placeholder="https://..." className="w-full px-3 py-2 rounded-lg text-xs text-white outline-none" style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.08)"}}/></div>
            <div><label className="text-xs text-slate-400 mb-1 block">Country</label><select value={countryVal} onChange={e=>setCountryVal(e.target.value)} className="w-full px-3 py-2 rounded-lg text-xs text-white outline-none" style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.08)"}}>{COUNTRIES.map(c=><option key={c.v} value={c.v} style={{background:"#1a1030"}}>{c.l}</option>)}</select><div className="text-[10px] text-slate-500 mt-0.5">{countryVal==="PK"?"🇵🇰 FBR tax integration is available — see the FBR / Tax tab after saving.":""}</div></div>
            <div><label className="text-xs text-slate-400 mb-1 block">Currency</label><select value={currencyVal} onChange={e=>setCurrencyVal(e.target.value)} className="w-full px-3 py-2 rounded-lg text-xs text-white outline-none" style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.08)"}}>{CURRENCIES.map(c=><option key={c.v} value={c.v} style={{background:"#1a1030"}}>{c.l}</option>)}</select><div className="text-[10px] text-slate-500 mt-0.5">Used across POS, receipts, and dashboard</div></div>
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
          <div className="flex items-center gap-3">
            <button onClick={saveBizSettings} className="px-4 py-2 rounded-lg text-xs font-medium text-white" style={{background:"linear-gradient(135deg,#8b5cf6,#7c3aed)"}}>Save Changes</button>
            {bizSaved&&<span className="text-xs text-green-400 flex items-center gap-1"><CheckCircle size={12}/>Saved</span>}
          </div>
        </div>}
        {tab==="whatsapp"&&<WhatsAppSettingsTab/>}
        {tab==="rbac"&&<div className="space-y-4">
          <p className="text-xs text-slate-400">Add staff members to your account. You set their login email and password — credentials are shown to you and emailed directly to them.</p>

          {/* Role permission matrix */}
          <div className="rounded-xl overflow-hidden" style={{border:"1px solid rgba(255,255,255,0.06)"}}>
            <div className="px-4 py-2.5 border-b border-white/5" style={{background:"rgba(255,255,255,0.02)"}}><span className="text-xs font-semibold text-slate-300">Role Permissions</span></div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="border-b border-white/5"><th className="text-left py-2 px-3 text-slate-500">Feature</th>{(["Owner","Manager","Marketing","Staff"] as const).map(r=><th key={r} className="py-2 px-2 text-slate-400 font-medium text-center">{r}</th>)}</tr></thead>
                <tbody>{[
                  {f:"Dashboard & Analytics",perms:[true,false,false,false]},
                  {f:"Customers & Loyalty",perms:[true,true,true,false]},
                  {f:"Messages & Inbox",perms:[true,true,true,false]},
                  {f:"Campaigns",perms:[true,true,true,false]},
                  {f:"Automations",perms:[true,true,false,false]},
                  {f:"POS / Orders",perms:[true,true,false,true]},
                  {f:"AI Insights",perms:[true,false,false,false]},
                  {f:"Settings",perms:[true,false,false,false]},
                ].map((row,i)=>(
                  <tr key={i} className="border-b border-white/3">
                    <td className="py-2 px-3 text-slate-300">{row.f}</td>
                    {row.perms.map((p,j)=><td key={j} className="py-2 px-2 text-center">{p?<span className="text-green-400 text-base">✓</span>:<span className="text-slate-700 text-base">—</span>}</td>)}
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </div>

          {/* Invite form */}
          <div className="p-4 rounded-xl space-y-3" style={{background:"rgba(139,92,246,0.06)",border:"1px solid rgba(139,92,246,0.15)"}}>
            <h4 className="text-xs font-semibold text-white">Add a Staff Member</h4>
            <p className="text-xs text-slate-400">Fill in their details. The system will generate a login email for them. You set the password. Their credentials will be emailed to them.</p>
            <AddStaffForm/>
          </div>

          {/* Note about login */}
          <div className="p-3 rounded-xl flex gap-3" style={{background:"rgba(6,182,212,0.06)",border:"1px solid rgba(6,182,212,0.15)"}}>
            <Info size={14} className="text-cyan-400 flex-shrink-0 mt-0.5"/>
            <div className="text-xs text-slate-400 space-y-1">
              <div className="text-cyan-300 font-medium">How staff login works</div>
              <div>Staff log in at the same URL as you using their <strong>@theloyaly.com</strong> login email. Their access is automatically limited to the features their role allows — they will never see Settings, billing, or owner-level data.</div>
            </div>
          </div>
        </div>}
        {tab==="stripe"&&<BillingTab/>}
        {tab==="security"&&<div className="space-y-2">{[{l:"Secure Password Storage",d:"Your passwords are encrypted using industry-leading methods — never stored in plain text",on:true},{l:"Auto Sign-Out",d:"Your session expires automatically after a period of inactivity to keep your account safe",on:true},{l:"Session Protection",d:"If someone steals your session, they are automatically signed out on all devices",on:true},{l:"Instant Logout",d:"When you sign out, your session is immediately invalidated everywhere",on:true},{l:"Two-Factor Authentication",d:"Add an extra layer of security with a 6-digit code from your phone (coming soon)",on:false},{l:"Login Attempt Limits",d:"Too many failed login attempts will temporarily lock access to prevent break-ins",on:true},{l:"DDoS & Bot Protection",d:"Your account is protected from automated attacks and suspicious traffic",on:true},{l:"Data Isolation",d:"Your customer data is completely separate from other businesses — no data is ever shared",on:true}].map((s,i)=><div key={i} className="flex items-center justify-between py-3 border-b border-white/5"><div><div className="text-xs font-medium text-white">{s.l}</div><div className="text-xs text-slate-500">{s.d}</div></div><div className={`w-10 h-5 rounded-full relative flex-shrink-0 ${s.on?"bg-violet-500":"bg-white/10"}`}><div className="w-4 h-4 rounded-full bg-white absolute top-0.5 transition-all" style={{left:s.on?22:2}}/></div></div>)}</div>}
        {tab==="gdpr"&&<GdprTab onAccountDeleted={()=>{localStorage.clear();window.location.href="/";}}/>}
        {tab==="fbr"&&<FBRPanel/>}
      </div>
    </div>
  );
};

// ════════════════════════════════════════════════════════════════
// CAMPAIGNS LIST
// ════════════════════════════════════════════════════════════════
const CampaignsPage=({onBuilder}:{onBuilder:()=>void})=>{
  const ct=useCard();
  const [campaigns,setCampaigns]=useState<any[]>([]);
  const [loading,setLoading]=useState(true);
  const [launching,setLaunching]=useState<string|null>(null);
  const [cloning,setCloning]=useState<string|null>(null);
  useEffect(()=>{
    api.campaigns.list().then(d=>setCampaigns(d.campaigns??[])).catch(()=>{}).finally(()=>setLoading(false));
  },[]);
  const launch=async(id:string)=>{
    setLaunching(id);
    try{
      const r:any=await api.campaigns.launch(id);
      const queued=r?.queued??0;
      if(queued===0){
        alert("Campaign launched but 0 messages were queued.\n\nThis usually means none of your customers have WhatsApp marketing consent, or all matching customers are marked as staff/suppressed. Add customers with consent enabled, then launch again.");
      }else{
        alert(`Campaign launched — ${queued} message${queued!==1?"s":""} queued for delivery.`);
      }
      setCampaigns(p=>p.map(c=>c.id===id?{...c,status:"ACTIVE"}:c));
    }
    catch(e:any){alert(e?.message||"Launch failed");}finally{setLaunching(null);}
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
      <div className="flex items-center justify-between"><div><h1 className="text-xl font-bold text-white">Campaigns</h1><p className="text-xs text-slate-400 mt-0.5">Send WhatsApp messages to your customers in bulk</p></div><button onClick={onBuilder} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium text-white" style={{background:"linear-gradient(135deg,#8b5cf6,#7c3aed)"}}><Plus size={14}/>Campaign Builder</button></div>

      {/* WhatsApp Ads — Coming Soon (compact) */}
      <div className="flex items-center gap-3 px-4 py-3 rounded-xl" style={{background:"rgba(37,211,102,0.06)",border:"1px solid rgba(37,211,102,0.18)"}}>
        <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{background:"linear-gradient(135deg,#25d366,#128c7e)"}}>
          <svg viewBox="0 0 24 24" className="w-4 h-4 fill-white"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.127.558 4.122 1.532 5.848L0 24l6.335-1.652A11.952 11.952 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.818a9.818 9.818 0 01-5.007-1.371l-.36-.213-3.732.973.999-3.636-.234-.374A9.818 9.818 0 1112 21.818z"/></svg>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2"><span className="text-sm font-semibold text-white">WhatsApp Ads</span><span className="px-1.5 py-0.5 rounded-full text-xs font-bold" style={{background:"rgba(37,211,102,0.2)",color:"#4ade80"}}>Coming Soon</span></div>
          <p className="text-xs mt-0.5 truncate" style={{color:"rgba(255,255,255,0.45)"}}>Targeted WhatsApp promotions with AI copywriting and real-time attribution — built right into The Loyaly.</p>
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
const AutomationRunsModal=({auto,onClose}:{auto:any;onClose:()=>void})=>{
  const [runs,setRuns]=useState<any[]>([]);
  const [total,setTotal]=useState(0);
  const [loading,setLoading]=useState(true);
  const [showTest,setShowTest]=useState(false);
  const [customers,setCustomers]=useState<any[]>([]);
  const [custSearch,setCustSearch]=useState("");
  const [testingId,setTestingId]=useState<string|null>(null);
  const [testResult,setTestResult]=useState<{ok:boolean;msg:string}|null>(null);

  const fetchRuns=()=>{
    setLoading(true);
    api.automations.runs(auto.id,{limit:50}).then(d=>{setRuns(d.runs??[]);setTotal(d.total??0);}).catch(()=>{}).finally(()=>setLoading(false));
  };
  useEffect(()=>{fetchRuns();},[auto.id]);

  useEffect(()=>{
    if(!showTest)return;
    api.customers.list({limit:50,q:custSearch||undefined}).then((d:any)=>setCustomers(d.customers??d??[])).catch(()=>{});
  },[showTest,custSearch]);

  const testFire=async(customerId:string,customerName:string)=>{
    setTestingId(customerId);setTestResult(null);
    try{
      const r=await api.automations.testFire(auto.id,customerId);
      setTestResult({ok:true,msg:`✅ Fired for ${customerName}! Message queued.`});
      setTimeout(fetchRuns,1500);
    }catch(e:any){
      setTestResult({ok:false,msg:`❌ ${e?.message??'Failed to fire'}`});
    }finally{setTestingId(null);}
  };

  const statusColor=(s:string)=>s==="COMPLETED"||s==="SENT"?"#22c55e":s==="RUNNING"||s==="PENDING"?"#f59e0b":s==="FAILED"||s==="DROPPED_QUOTA"||s==="CONSENT_REVOKED"?"#ef4444":"#64748b";
  return(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{background:"rgba(0,0,0,0.8)",backdropFilter:"blur(6px)"}}>
      <div className="gc rounded-2xl w-full max-w-2xl max-h-[85vh] flex flex-col" style={CARD}>
        <div className="flex items-center justify-between p-5 border-b border-white/5">
          <div>
            <div className="text-sm font-semibold text-white">{auto.name} — Run Logs</div>
            <div className="text-xs text-slate-400 mt-0.5">{total} total executions</div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={()=>{setShowTest(p=>!p);setTestResult(null);}} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium" style={{background:"rgba(139,92,246,0.15)",border:"1px solid rgba(139,92,246,0.3)",color:"#a78bfa"}}>
              <Play size={11}/> Test Fire
            </button>
            <button onClick={onClose} className="text-slate-400 hover:text-white"><X size={16}/></button>
          </div>
        </div>

        {/* Test Fire panel */}
        {showTest&&(
          <div className="p-4 border-b border-white/5" style={{background:"rgba(139,92,246,0.05)"}}>
            <p className="text-xs text-violet-300 mb-3 font-medium">Choose a customer to send this automation to right now (bypasses cooldown for testing):</p>
            {testResult&&<div className="mb-3 px-3 py-2 rounded-lg text-xs" style={{background:testResult.ok?"rgba(34,197,94,0.1)":"rgba(239,68,68,0.1)",color:testResult.ok?"#86efac":"#fca5a5"}}>{testResult.msg}</div>}
            <input value={custSearch} onChange={e=>setCustSearch(e.target.value)} placeholder="Search customers…" className="w-full px-3 py-2 rounded-lg text-xs text-white placeholder-slate-500 outline-none mb-2" style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.08)"}}/>
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {customers.slice(0,20).map((c:any)=>(
                <div key={c.id} className="flex items-center justify-between px-3 py-2 rounded-lg" style={{background:"rgba(255,255,255,0.03)"}}>
                  <div>
                    <div className="text-xs font-medium text-white">{c.fullName}</div>
                    <div className="text-[10px] text-slate-500">{c.whatsappNumber}</div>
                  </div>
                  <button onClick={()=>testFire(c.id,c.fullName)} disabled={!!testingId} className="px-2.5 py-1 rounded-md text-[10px] font-semibold text-white disabled:opacity-40 flex items-center gap-1" style={{background:"linear-gradient(135deg,#8b5cf6,#7c3aed)"}}>
                    {testingId===c.id?<RefreshCw size={10} className="animate-spin"/>:<Zap size={10}/>}
                    {testingId===c.id?"Firing…":"Fire"}
                  </button>
                </div>
              ))}
              {customers.length===0&&<p className="text-xs text-slate-500 text-center py-3">No customers found</p>}
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {loading?[...Array(5)].map((_,i)=><Skeleton key={i} h="h-14"/>):runs.length===0?
            <div className="text-center py-8 space-y-3">
              <div className="text-slate-400 text-sm">No runs yet — this automation hasn't fired</div>
              <button onClick={()=>setShowTest(true)} className="px-4 py-2 rounded-lg text-xs font-medium text-white" style={{background:"linear-gradient(135deg,#8b5cf6,#7c3aed)"}}>
                <Play size={11} className="inline mr-1"/>Test fire it now
              </button>
            </div>:
            runs.map((r:any)=>(
              <div key={r.id} className="rounded-xl p-3 flex items-center gap-3" style={{background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.06)"}}>
                <div className="w-2 h-2 rounded-full flex-shrink-0" style={{background:statusColor(r.status??r.messageStatus)}}/>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium text-white truncate">{r.customer?.fullName??r.customerId??'Unknown customer'}</div>
                  <div className="text-[11px] text-slate-400 mt-0.5 flex items-center gap-2">
                    <span className="font-mono" style={{color:statusColor(r.status??r.messageStatus)}}>{r.status??r.messageStatus??'—'}</span>
                    {r.phone&&<span className="text-slate-500">· {r.phone}</span>}
                  </div>
                </div>
                <div className="text-[10px] text-slate-500 flex-shrink-0">{r.createdAt?new Date(r.createdAt).toLocaleString("en-GB",{dateStyle:"short",timeStyle:"short"}):""}</div>
              </div>
            ))
          }
        </div>
      </div>
    </div>
  );
};

const AutomationsPage=({onBuilder}:{onBuilder:()=>void})=>{
  const ct=useCard();
  const [autos,setAutos]=useState<any[]>([]);
  const [loading,setLoading]=useState(true);
  const [toggling,setToggling]=useState<string|null>(null);
  const [logsFor,setLogsFor]=useState<any>(null);
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
  const TRIGGER_NAMES:Record<string,string>={BIRTHDAY:"🎂 Birthday",INACTIVITY:"⏰ Inactivity",VISIT_MILESTONE:"⭐ Visit Milestone",TIER_UPGRADE:"👑 Tier Upgrade",SENTIMENT_NEGATIVE:"⚠️ Negative Sentiment",NEW_CUSTOMER:"👋 New Customer",SPEND_THRESHOLD:"💰 Spend Threshold"};
  const ACTION_NAMES:Record<string,string>={SEND_WHATSAPP:"💬 Send WhatsApp",AWARD_POINTS:"⭐ Award Points",CHANGE_SEGMENT:"🏷️ Change Segment",SEND_EMAIL:"📧 Send Email",MANAGER_ALERT:"🔔 Manager Alert",DEDUCT_POINTS:"➖ Deduct Points"};
  const getTriggerLabel=(t:any)=>{
    if(!t)return"—";
    const key=typeof t==="string"?t:(t?.type||t?.trigger||"");
    return TRIGGER_NAMES[key]||key||"—";
  };
  const getActionLabel=(c:any)=>{
    if(!c)return"—";
    if(Array.isArray(c))return c.map((a:any)=>{const k=a?.type||a;return ACTION_NAMES[k]||k;}).join(" + ").slice(0,60);
    if(typeof c==="string")return ACTION_NAMES[c]||c.slice(0,40);
    return"Custom flow";
  };
  return(
    <div className="space-y-4">
      {logsFor&&<AutomationRunsModal auto={logsFor} onClose={()=>setLogsFor(null)}/>}
      <div className="flex items-center justify-between"><div><h1 className="text-xl font-bold text-white">Automations</h1><p className="text-xs text-slate-400 mt-0.5">Set up automatic messages that send themselves — no manual work needed</p></div><button onClick={onBuilder} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium text-white" style={{background:"linear-gradient(135deg,#8b5cf6,#7c3aed)"}}><Plus size={14}/>Build Automation</button></div>
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
            <div className="flex items-center gap-2">
              <button onClick={()=>setLogsFor(a)} className="px-2.5 py-1.5 rounded-lg text-[11px] text-slate-300 font-medium flex items-center gap-1" style={{background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.08)"}} title="View run logs"><Activity size={11}/>Logs</button>
              <button onClick={()=>toggle(a.id,on)} disabled={toggling===a.id} className={`w-10 h-5 rounded-full relative flex-shrink-0 transition-colors ${on?"bg-violet-500":"bg-white/10"} disabled:opacity-50`}>
                {toggling===a.id?<RefreshCw size={10} className="absolute inset-0 m-auto text-white animate-spin"/>:<div className="w-4 h-4 rounded-full bg-white absolute top-0.5 transition-all" style={{left:on?22:2}}/>}
              </button>
            </div>
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
type ActiveOrder={id:string;table?:string;type:string;items:{name:string;qty:number;price:number;ready?:boolean}[];discount:number;phone:string;cname:string;payMode:"CASH"|"CARD"|"WALLET";status:"UNPAID"|"PAID";createdAt:number;notes?:string;staff?:string;paymentMode?:string;cashGiven?:number;};
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
  restaurant:"Thank you for dining with us! We hope to see you again soon.",
  salon:"Thank you for choosing us! We hope to see you again soon.",
  gym:"Great session! See you next time.",
  retail:"Thank you for shopping with us! We hope to see you again soon.",
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
  return `${header}\n\n${DIVIDER}\n${lines}\n${DIVIDER}${discountLine}\n*TOTAL: ${currency} ${total.toFixed(0)}*\n\n${thankYou}\n\n_message powered by theloyaly.com_`;
};
const printBill=(order:ActiveOrder,currency:string,fbrData?:{invoiceNo?:string;ntn?:string;taxNo?:string;gstRate?:number;isPK?:boolean})=>{
  const subtotal=order.items.reduce((s,i)=>s+i.qty*i.price,0);
  const discountAmt=order.discount||0;
  const afterDiscount=subtotal-discountAmt;
  const gstRate=fbrData?.gstRate??0;
  // Tax-inclusive GST: gstAmount = total × rate / (100 + rate)
  const gstAmt=fbrData?.isPK&&gstRate>0?afterDiscount*(gstRate/(100+gstRate)):0;
  const total=afterDiscount;
  const bizName=localStorage.getItem("biz_name")||"Receipt";
  const bizAddr=localStorage.getItem("biz_address")||"";
  const bizPhone=localStorage.getItem("biz_phone")||"";
  const logoUrl=localStorage.getItem("biz_logo")||"";
  const now=new Date();
  const dateStr=now.toLocaleDateString("en-GB");
  const timeStr=now.toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit"});
  const orderNo=order.id?.slice(-6).toUpperCase()||Math.random().toString(36).slice(2,8).toUpperCase();
  const paid=order.paymentMode||"Cash";
  const cash=order.cashGiven||total;
  const change=Math.max(0,cash-total);
  const w=window.open("","_blank","width=380,height=700");if(!w)return;
  w.document.write(`<!DOCTYPE html><html><head><title>Receipt</title><meta charset="utf-8"/><style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Courier New',Courier,monospace;font-size:12px;width:80mm;margin:0 auto;padding:8px;background:#fff;color:#000}
.center{text-align:center}.bold{font-weight:bold}.big{font-size:15px}.sm{font-size:10px}.xs{font-size:9px}
.row{display:flex;justify-content:space-between;align-items:flex-start;margin:2px 0}
.dash{border-top:1px dashed #000;margin:6px 0}
.double{border-top:2px solid #000;margin:6px 0}
.logo{display:block;margin:0 auto 6px;max-width:120px;max-height:40px;object-fit:contain}
.fbr-box{border:1px solid #000;padding:6px;margin:6px 0;text-align:center}
.qr{display:block;margin:6px auto;width:80px;height:80px}
@media print{body{width:80mm}button{display:none!important}}
</style></head><body>
${logoUrl?`<img src="${logoUrl}" class="logo"/>`:""}
<div class="center bold big">${bizName.toUpperCase()}</div>
${bizAddr?`<div class="center sm">${bizAddr}</div>`:""}
${bizPhone?`<div class="center sm">Tel: ${bizPhone}</div>`:""}
${fbrData?.isPK&&fbrData.ntn?`<div class="center sm">NTN: ${fbrData.ntn}</div>`:""}
${fbrData?.isPK&&fbrData.taxNo?`<div class="center sm">STRN: ${fbrData.taxNo}</div>`:""}
<div class="dash"></div>
<div class="row sm"><span>Date: ${dateStr}</span><span>Time: ${timeStr}</span></div>
<div class="row sm"><span>Order #: ${orderNo}</span>${order.table?`<span>Table: ${order.table}</span>`:""}</div>
${order.cname?`<div class="sm">Customer: ${order.cname}</div>`:""}
<div class="dash"></div>
<div class="row bold xs"><span>ITEM</span><span>QTY</span><span>PRICE</span><span>AMOUNT</span></div>
<div class="dash"></div>
${order.items.map(i=>{
  const amt=(i.qty*i.price).toFixed(2);
  return `<div class="row xs"><span style="max-width:100px;overflow:hidden">${i.name}</span><span>${i.qty}</span><span>${i.price.toFixed(2)}</span><span>${amt}</span></div>`;
}).join("")}
<div class="dash"></div>
<div class="row sm"><span>Sub Total</span><span>${currency} ${subtotal.toFixed(2)}</span></div>
${discountAmt>0?`<div class="row sm"><span>Discount</span><span>-${currency} ${discountAmt.toFixed(2)}</span></div>`:""}
${gstAmt>0?`<div class="row sm"><span>GST (${gstRate}% incl.)</span><span>${currency} ${gstAmt.toFixed(2)}</span></div>`:""}
<div class="double"></div>
<div class="row bold big"><span>TOTAL</span><span>${currency} ${total.toFixed(2)}</span></div>
<div class="dash"></div>
<div class="row sm"><span>Payment</span><span>${paid}</span></div>
${paid==="Cash"||paid==="CASH"?`<div class="row sm"><span>Cash</span><span>${currency} ${Number(cash).toFixed(2)}</span></div><div class="row sm"><span>Change</span><span>${currency} ${change.toFixed(2)}</span></div>`:""}
<div class="dash"></div>
${fbrData?.isPK&&fbrData.invoiceNo?`<div class="fbr-box"><div class="bold sm">FBR TAX INVOICE</div><div class="xs" style="word-break:break-all">${fbrData.invoiceNo}</div><div class="xs">Verify at: fbr.gov.pk/TaxInvoice</div></div>`:""}
<div class="center bold" style="margin:10px 0;font-size:14px">THANK YOU!</div>
<div class="center xs">Powered by theloyaly.com</div>
<br/><div class="center"><button onclick="window.print()" style="padding:8px 20px;font-size:13px;cursor:pointer">🖨 Print</button></div>
</body></html>`);
  w.document.close();setTimeout(()=>w.print(),500);
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

  const [ptsEarned,setPtsEarned]=useState<number|null>(null);
  const [lastFbrData,setLastFbrData]=useState<{invoiceNo?:string;ntn?:string;taxNo?:string;gstRate?:number;isPK?:boolean}|undefined>(undefined);
  const markPaid=async()=>{
    setPaying(true);setErr("");setPtsEarned(null);
    try{
      const r=await api.pos.createSale({customerPhone:order.phone?normPhone(order.phone):undefined,customerName:order.cname,items:order.items.map(i=>({name:i.name,qty:i.qty,unitPrice:i.price})),paymentMode:order.payMode,discount:order.discount,notes:order.notes||order.table?`${order.table||""}${order.notes?` | ${order.notes}`:""}`:""});
      if(r?.pointsEarned)setPtsEarned(r.pointsEarned);
      // Prefer the server's authoritative isPK flag; fall back to localStorage.
      const isPK=r?.isPK??((localStorage.getItem("biz_country")||"").toUpperCase()==="PK");
      const fbrInfo=isPK?{invoiceNo:r?.fbrInvoiceNumber,ntn:r?.ntn||localStorage.getItem("biz_ntn")||undefined,taxNo:r?.taxNumber||localStorage.getItem("biz_taxNumber")||undefined,gstRate:r?.gstRate||Number(localStorage.getItem("biz_gstRate")||17),isPK:true}:undefined;
      setLastFbrData(fbrInfo);
      // Deduct inventory
      order.items.forEach(i=>deductStock(bizType,i.name,i.qty));
      updateOrder(order.id,{status:"PAID"});
      onPaid({...order,status:"PAID"});
      // Auto-print if PK
      if(isPK)printBill(order,currency,fbrInfo);
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
          <button onClick={()=>printBill(order,currency,lastFbrData)} className="px-3 py-2 rounded-xl text-slate-300 hover:text-white transition-colors" style={{background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.08)"}} title="Print Bill"><Printer size={14}/></button>
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
            <button onClick={()=>printBill(order,currency,lastFbrData)} className="ml-auto p-1.5 rounded-lg" style={{background:"rgba(255,255,255,0.06)"}} title="Print"><Printer size={12}/></button>
          </div>
          {ptsEarned!=null&&ptsEarned>0&&(
            <div className="flex items-center gap-1.5 text-[10px] text-amber-400 font-semibold" style={{background:"rgba(245,158,11,0.08)",borderRadius:8,padding:"4px 8px"}}>
              ⭐ +{ptsEarned} loyalty points earned{order.cname?` for ${order.cname}`:""}
            </div>
          )}
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
  const [phone,setPhone]=useState("");const [cname,setCname]=useState("");const [discount,setDiscount]=useState(0);const [discountMode,setDiscountMode]=useState<'value'|'percent'>('value');
  const [table,setTable]=useState("");const [notes,setNotes]=useState("");
  const [placing,setPlacing]=useState(false);const [placed,setPlaced]=useState(false);
  // Wallet state
  const [walletCustomer,setWalletCustomer]=useState<any>(null);
  const [walletLooking,setWalletLooking]=useState(false);
  const [walletPoints,setWalletPoints]=useState(0); // pts to redeem
  const [useGift,setUseGift]=useState(false); // apply gift/shop credit
  const [giftCodeInput,setGiftCodeInput]=useState("");const [giftRedeemMsg,setGiftRedeemMsg]=useState<{ok:boolean;text:string}|null>(null);const [giftRedeemBusy,setGiftRedeemBusy]=useState(false);
  const walletLookupTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
  const refreshWallet=async()=>{try{const r=await api.pos.walletLookup(phone);setWalletCustomer(r);}catch{}};
  const redeemGiftCode=async(code:string)=>{
    if(!walletCustomer?.customerId||!code.trim())return;
    setGiftRedeemBusy(true);setGiftRedeemMsg(null);
    try{
      const r=await api.pos.giftCardRedeem({customerId:walletCustomer.customerId,code:code.trim().toUpperCase()});
      setGiftRedeemMsg({ok:true,text:`✓ ${currency} ${Number(r.credited??0).toFixed(2)} added to gift credit`});
      setGiftCodeInput("");setUseGift(true);await refreshWallet();
    }catch(e:any){
      const m=e?.message;
      setGiftRedeemMsg({ok:false,text:m==="GIFT_CARD_NOT_FOUND"?"No card found with that code":m==="GIFT_CARD_EMPTY"?"That card has already been used":m==="GIFT_CARD_EXPIRED"?"That card has expired":m==="GIFT_CARD_INACTIVE"?"That card is not active":(m||"Could not redeem")});
    }finally{setGiftRedeemBusy(false);}
  };
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

  // Auto-lookup wallet customer when phone changes + WALLET mode active
  useEffect(()=>{
    if(mode!=="WALLET"||!phone||phone.replace(/\D/g,"").length<7){setWalletCustomer(null);setWalletPoints(0);return;}
    if(walletLookupTimer.current)clearTimeout(walletLookupTimer.current);
    walletLookupTimer.current=setTimeout(async()=>{
      setWalletLooking(true);
      try{
        const r=await api.pos.walletLookup(phone);
        setWalletCustomer(r);
        // Pre-fill customer name if found
        if(r.found&&r.fullName&&!cname)setCname(r.fullName);
        setWalletPoints(0);
      }catch{}finally{setWalletLooking(false);}
    },600);
    return()=>{if(walletLookupTimer.current)clearTimeout(walletLookupTimer.current);};
  },[phone,mode]);

  // Reset wallet state when switching away from WALLET mode
  useEffect(()=>{if(mode!=="WALLET"){setWalletCustomer(null);setWalletPoints(0);}}, [mode]);

  const orderRaw=order.reduce((s,i)=>s+i.qty*i.price,0);
  const discountValue=discountMode==='percent'?orderRaw*(discount/100):discount;
  // Wallet discount: points redeemed → currency value
  const walletDiscount=walletCustomer&&mode==="WALLET"&&walletPoints>0
    ? Math.min(parseFloat((walletPoints/(walletCustomer.redeemRate??100)).toFixed(2)), orderRaw-discountValue)
    : 0;
  // Gift / shop credit (money wallet) applied after points
  const giftAvailable=mode==="WALLET"&&walletCustomer?.found?Number(walletCustomer.walletBalance??0):0;
  const giftDiscount=useGift&&giftAvailable>0
    ? Math.min(giftAvailable, Math.max(0, orderRaw-discountValue-walletDiscount))
    : 0;
  const subtotal=orderRaw-discountValue-walletDiscount-giftDiscount;
  const total=Math.max(0,subtotal);

  const placeOrder=async()=>{
    if(!order.length)return;
    setPlacing(true);
    // If wallet mode with points → debit points first
    if(mode==="WALLET"&&walletCustomer?.found&&walletPoints>0){
      try{
        await api.pos.walletRedeem({customerId:walletCustomer.customerId,pointsToRedeem:walletPoints,amountDeducted:walletDiscount});
      }catch(e){
        setPlacing(false);
        return;
      }
    }
    // Spend gift / shop credit (money wallet) if applied
    if(mode==="WALLET"&&walletCustomer?.found&&giftDiscount>0){
      try{
        await api.pos.giftCreditRedeem({customerId:walletCustomer.customerId,amount:giftDiscount});
      }catch(e){
        setPlacing(false);
        return;
      }
    }
    addOrder({type:bizType,table:table||undefined,items:order.map(i=>({...i,ready:false})),discount:discountValue+walletDiscount+giftDiscount,phone,cname,payMode:mode,status:"UNPAID",notes});
    setOrder([]);setPhone("");setCname("");setDiscount(0);setTable("");setNotes("");setWalletCustomer(null);setWalletPoints(0);setUseGift(false);
    setPlaced(true);setTimeout(()=>setPlaced(false),3000);
    setPlacing(false);
  };

  const cartCount=order.reduce((s,i)=>s+i.qty,0);
  const total2=Math.max(0,orderRaw-discountValue);

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
                <button key={c} onClick={()=>setCat(i)} className="px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all" style={cat===i?{background:(color)+"33",border:"1px solid "+(color)+"55",color}:{background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.07)",color:"#94a3b8"}}>{c}</button>
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
            <div><label className="text-[10px] text-slate-400 block mb-1">WhatsApp (for loyalty points)</label><PhoneInput value={phone} onChange={setPhone} inputStyle={{...inpS,padding:"7px 10px",fontSize:"12px",color:"white"}}/></div>
            <div><label className="text-[10px] text-slate-400 block mb-1">Notes / Special req.</label><input className="w-full px-3 py-2 rounded-xl text-xs text-white outline-none" style={inpS} placeholder="Allergy, mods…" value={notes} onChange={e=>setNotes(e.target.value)}/></div>
          </div>
          <div className="flex gap-2 mb-3">
            {(["CASH","CARD","WALLET"] as const).map(m=>(
              <button key={m} onClick={()=>setMode(m)} className={`flex-1 py-2 rounded-xl text-xs font-semibold transition-all flex items-center justify-center gap-1.5 ${mode===m?"text-white":"text-slate-400"}`} style={mode===m?{background:"rgba(139,92,246,0.3)",border:"1px solid rgba(139,92,246,0.5)"}:{background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.08)"}}>
                {m==="CASH"&&"💵"}{m==="CARD"&&"💳"}{m==="WALLET"&&"⭐"}{m}
              </button>
            ))}
          </div>
          {/* Wallet panel */}
          {mode==="WALLET"&&(
            <div className="mb-4 rounded-2xl p-4 space-y-3" style={{background:"rgba(139,92,246,0.08)",border:"1px solid rgba(139,92,246,0.25)"}}>
              {walletLooking&&<div className="text-xs text-violet-300 flex items-center gap-2"><RefreshCw size={12} className="animate-spin"/>Looking up points…</div>}
              {!walletLooking&&walletCustomer&&!walletCustomer.found&&phone.replace(/\D/g,"").length>=7&&(
                <div className="text-xs text-amber-400 flex items-center gap-2">⚠️ No loyalty account found for this number — they'll earn points but can't redeem yet</div>
              )}
              {!walletLooking&&walletCustomer?.found&&(
                <>
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-xs font-semibold text-white">{walletCustomer.fullName}</div>
                      <div className="text-[11px] text-violet-300 mt-0.5">⭐ {walletCustomer.pointsBalance.toLocaleString()} points available</div>
                      {walletCustomer.minRedeemPoints>0&&walletCustomer.pointsBalance<walletCustomer.minRedeemPoints&&(
                        <div className="text-[10px] text-amber-400 mt-0.5">Minimum {walletCustomer.minRedeemPoints} pts needed to redeem</div>
                      )}
                    </div>
                    <div className="text-right">
                      <div className="text-[10px] text-slate-400">{walletCustomer.redeemRate} pts = 1 {currency}</div>
                      <div className="text-xs font-bold text-green-400">Max off: {currency} {walletCustomer.maxDiscount.toFixed(2)}</div>
                    </div>
                  </div>
                  {walletCustomer.pointsBalance>=walletCustomer.minRedeemPoints&&(
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-slate-400">Points to redeem</span>
                        <span className="text-violet-300 font-semibold">{walletPoints} pts = <span className="text-green-400 font-bold">{currency} {(walletPoints/(walletCustomer.redeemRate??100)).toFixed(2)}</span> off</span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={Math.min(walletCustomer.pointsBalance, Math.ceil((orderRaw-discountValue)*(walletCustomer.redeemRate??100)))}
                        step={walletCustomer.redeemRate??100}
                        value={walletPoints}
                        onChange={e=>setWalletPoints(Number(e.target.value))}
                        className="w-full h-1.5 rounded-full appearance-none"
                        style={{accentColor:"#8b5cf6"}}
                      />
                      <div className="flex justify-between text-[10px] text-slate-500"><span>0 pts</span><span>{Math.min(walletCustomer.pointsBalance,Math.ceil((orderRaw-discountValue)*(walletCustomer.redeemRate??100)))} pts</span></div>
                    </div>
                  )}
                  {/* Gift / shop credit (money wallet from gift cards) */}
                  {giftAvailable>0&&(
                    <label className="flex items-center justify-between gap-2 pt-2 mt-1 cursor-pointer" style={{borderTop:"1px solid rgba(255,255,255,0.08)"}}>
                      <div>
                        <div className="text-xs font-semibold text-white flex items-center gap-1.5">💳 Gift / shop credit</div>
                        <div className="text-[11px] text-emerald-300 mt-0.5">{currency} {giftAvailable.toFixed(2)} available{useGift&&giftDiscount>0?` · ${currency} ${giftDiscount.toFixed(2)} applied`:""}</div>
                      </div>
                      <button onClick={()=>setUseGift(v=>!v)} type="button" className="w-11 h-6 rounded-full transition-all flex-shrink-0 relative" style={{background:useGift?"#22c55e":"rgba(255,255,255,0.12)"}}>
                        <span className="absolute top-0.5 transition-all w-5 h-5 rounded-full bg-white shadow" style={{left:useGift?"calc(100% - 22px)":"2px"}}/>
                      </button>
                    </label>
                  )}
                  {/* Gift cards on this account — redeem straight to credit */}
                  {(walletCustomer.giftCards||[]).length>0&&(
                    <div className="pt-2 mt-1 space-y-1.5" style={{borderTop:"1px solid rgba(255,255,255,0.08)"}}>
                      <div className="text-[11px] text-slate-400">🎁 Gift cards on this account</div>
                      {walletCustomer.giftCards.map((g:any)=>(
                        <div key={g.id} className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg" style={{background:"rgba(255,255,255,0.04)"}}>
                          <span className="text-xs text-white font-mono">{g.code} <span className="text-emerald-300">{currency} {Number(g.balance).toFixed(2)}</span></span>
                          <button onClick={()=>redeemGiftCode(g.code)} disabled={giftRedeemBusy} className="text-[11px] font-semibold px-2.5 py-1 rounded-lg text-white disabled:opacity-50" style={{background:"linear-gradient(135deg,#8b5cf6,#7c3aed)"}}>Redeem</button>
                        </div>
                      ))}
                    </div>
                  )}
                  {/* Enter a gift card code manually */}
                  <div className="pt-2 mt-1 space-y-1.5" style={{borderTop:"1px solid rgba(255,255,255,0.08)"}}>
                    <div className="text-[11px] text-slate-400">Enter a gift card code</div>
                    <div className="flex gap-2">
                      <input value={giftCodeInput} onChange={e=>setGiftCodeInput(e.target.value.toUpperCase())} placeholder="GC-XXXX-XXXX-XXXX" className="flex-1 min-w-0 px-3 py-2 rounded-xl text-xs text-white font-mono outline-none" style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)"}}/>
                      <button onClick={()=>redeemGiftCode(giftCodeInput)} disabled={giftRedeemBusy||!giftCodeInput.trim()} className="px-3 py-2 rounded-xl text-xs font-semibold text-white disabled:opacity-50 flex-shrink-0" style={{background:"linear-gradient(135deg,#8b5cf6,#7c3aed)"}}>{giftRedeemBusy?"…":"Redeem"}</button>
                    </div>
                    {giftRedeemMsg&&<div className={`text-[11px] ${giftRedeemMsg.ok?"text-emerald-400":"text-red-400"}`}>{giftRedeemMsg.text}</div>}
                  </div>
                </>
              )}
              {!walletLooking&&!walletCustomer&&(
                <div className="text-xs text-slate-400">Enter the customer's WhatsApp number above to look up their points balance</div>
              )}
            </div>
          )}
          <div className="flex items-center gap-2 flex-wrap">
            <label className="text-xs text-slate-400">Discount</label>
            <div className="flex rounded-lg overflow-hidden" style={{border:"1px solid rgba(255,255,255,0.1)"}}>
              {(['value','percent'] as const).map(m=><button key={m} onClick={()=>setDiscountMode(m)} className="px-2.5 py-1 text-xs font-medium transition-all" style={discountMode===m?{background:"rgba(139,92,246,0.4)",color:"white"}:{background:"rgba(255,255,255,0.04)",color:"#94a3b8"}}>{m==='value'?currency:'%'}</button>)}
            </div>
            <input className="w-20 px-3 py-2 rounded-xl text-xs text-white outline-none" style={inpS} type="number" min={0} step={discountMode==='percent'?1:0.01} max={discountMode==='percent'?100:undefined} placeholder={discountMode==='percent'?'%':'0.00'} value={discount||''} onChange={e=>setDiscount(Number(e.target.value))}/>
            {discount>0&&discountValue>0&&<span className="text-xs text-amber-400">= {currency} {discountValue.toFixed(2)} off</span>}
          </div>
        </div>
      </div>

      {/* Right: summary + place order + active orders */}
      <div className="space-y-4" ref={summaryRef}>
        <div className="gc rounded-2xl p-5" style={CARD}>
          <div className="text-sm font-semibold text-white mb-4">Order Summary</div>
          <div className="space-y-1.5 text-xs mb-4 max-h-44 overflow-y-auto">
            {order.map((i,idx)=><div key={idx} className="flex justify-between text-slate-300"><span>{i.name} ×{i.qty}</span><span>{currency} {(i.qty*i.price).toFixed(2)}</span></div>)}
            {!order.length&&<div className="text-slate-500 text-center py-3">Tap items from the menu</div>}
            {discountValue>0&&<div className="flex justify-between text-amber-400"><span>Discount {discount>0?`(${discount}${discountMode==='percent'?'%':''})`:''}  </span><span>-{currency} {discountValue.toFixed(2)}</span></div>}
            {walletDiscount>0&&<div className="flex justify-between text-violet-400"><span>⭐ Wallet ({walletPoints} pts)</span><span>-{currency} {walletDiscount.toFixed(2)}</span></div>}
            {giftDiscount>0&&<div className="flex justify-between text-emerald-400"><span>💳 Gift credit</span><span>-{currency} {giftDiscount.toFixed(2)}</span></div>}
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
  const [s,setS]=useState({country:"PK",ntn:"",taxNumber:"",fbrPosId:"",fbrUserId:"",fbrPassword:"",gstRate:"17",fbrSandbox:true,fbrEnabled:false});
  const [saving,setSaving]=useState(false);const [testing,setTesting]=useState(false);const [res,setRes]=useState<string|null>(null);const [formErr,setFormErr]=useState<string|null>(null);
  const [showPass,setShowPass]=useState(false);
  useEffect(()=>{
    api.pos.stats().then(setStats).catch(()=>{});
    api.settings.get().then((d:any)=>{
      const b=d?.user?.business??d?.business;
      if(b){setS({country:b.country||"PK",ntn:b.ntn||"",taxNumber:b.taxNumber||"",fbrPosId:String(b.fbrPosId||""),fbrUserId:b.fbrUserId||"",fbrPassword:b.fbrPassword||"",gstRate:String(b.gstRate||17),fbrSandbox:b.fbrSandbox!==false,fbrEnabled:b.fbrEnabled||false});}
    }).catch(()=>{});
  },[]);
  return(
    <div className="space-y-4">
      {stats&&<div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <KPI icon={DollarSign} label="Sales Today" value={`PKR ${(stats.totalSales??0).toFixed(0)}`} color={C.green}/>
        <KPI icon={Receipt} label="GST Collected" value={`PKR ${(stats.totalGst??0).toFixed(0)}`} color={C.amber}/>
        <KPI icon={ShoppingCart} label="Transactions" value={stats.transactionCount??0} color={C.primary}/>
        <KPI icon={CheckCircle} label="FBR Submitted" value={stats.fbrSubmitted??0} color={C.green}/>
        <KPI icon={XCircle} label="FBR Pending" value={stats.fbrFailed??0} color={C.red}/>
      </div>}

      {/* Setup Guide */}
      <div className="gc rounded-2xl p-4" style={{...CARD,border:"1px solid rgba(99,102,241,0.25)"}}>
        <div className="flex items-start gap-3">
          <Info size={15} className="text-indigo-400 mt-0.5 flex-shrink-0"/>
          <div>
            <div className="text-xs font-semibold text-indigo-400 mb-2">How to get your FBR credentials</div>
            <ol className="space-y-1.5 text-xs text-slate-400 list-none">
              {[
                ["1","Go to","iris.fbr.gov.pk","and register your business"],
                ["2","Login → POS Integration → Register POS → get your POSID"],
                ["3","Under POS settings, set a dedicated POS Password (separate from IRIS login)"],
                ["4","Your NTN is in your registration certificate. STRN is your Sales Tax Reg. No."],
                ["5","Start in Sandbox mode to test — sandbox always returns a valid number"],
              ].map(([n,...parts])=>(
                <li key={n} className="flex gap-2"><span className="w-4 h-4 rounded-full bg-indigo-500/20 text-indigo-400 text-[9px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5">{n}</span><span>{parts.join("")}</span></li>
              ))}
            </ol>
          </div>
        </div>
      </div>

      <div className="gc rounded-2xl p-5" style={CARD}>
        <div className="flex items-center justify-between mb-4">
          <span className="text-sm font-semibold text-white">FBR / PRA Configuration</span>
          <button onClick={()=>setS(p=>({...p,fbrEnabled:!p.fbrEnabled}))} className={`w-10 h-5 rounded-full relative transition-colors ${s.fbrEnabled?"bg-violet-500":"bg-white/10"}`}><div className="w-4 h-4 rounded-full bg-white absolute top-0.5 transition-all" style={{left:s.fbrEnabled?22:2}}/></button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
          <div><label className="text-[10px] text-slate-400 block mb-1">Country</label>
            <select className="w-full px-3 py-2 rounded-xl text-xs text-white outline-none" style={inpS} value={s.country} onChange={e=>setS(p=>({...p,country:e.target.value}))}>
              <option value="PK" style={{background:"#1a1030"}}>🇵🇰 Pakistan (FBR)</option>
              <option value="" style={{background:"#1a1030"}}>Other (no tax integration)</option>
            </select>
            <div className="text-[9px] text-slate-500 mt-0.5">FBR invoice numbers print on receipts only when Pakistan is selected.</div></div>
          <div></div>
          <div><label className="text-[10px] text-slate-400 block mb-1">NTN (National Tax Number) <span className="text-red-400">*</span></label>
            <input className="w-full px-3 py-2 rounded-xl text-xs text-white outline-none" style={inpS} placeholder="1234567-8" value={s.ntn} onChange={e=>setS(p=>({...p,ntn:e.target.value}))}/></div>
          <div><label className="text-[10px] text-slate-400 block mb-1">STRN / Tax Number <span className="text-red-400">*</span></label>
            <input className="w-full px-3 py-2 rounded-xl text-xs text-white outline-none" style={inpS} placeholder="Sales Tax Reg. No." value={s.taxNumber} onChange={e=>setS(p=>({...p,taxNumber:e.target.value}))}/></div>
          <div><label className="text-[10px] text-slate-400 block mb-1">POS ID (from IRIS portal)</label>
            <input className="w-full px-3 py-2 rounded-xl text-xs text-white outline-none font-mono" style={inpS} placeholder="e.g. 12345" value={s.fbrPosId} onChange={e=>setS(p=>({...p,fbrPosId:e.target.value}))}/></div>
          <div><label className="text-[10px] text-slate-400 block mb-1">IRIS User ID</label>
            <input className="w-full px-3 py-2 rounded-xl text-xs text-white outline-none" style={inpS} placeholder="Your IRIS username" value={s.fbrUserId} onChange={e=>setS(p=>({...p,fbrUserId:e.target.value}))}/></div>
          <div><label className="text-[10px] text-slate-400 block mb-1">POS Password</label>
            <div className="relative"><input type={showPass?"text":"password"} className="w-full px-3 py-2 pr-8 rounded-xl text-xs text-white outline-none" style={inpS} placeholder="POS API password" value={s.fbrPassword} onChange={e=>setS(p=>({...p,fbrPassword:e.target.value}))}/>
              <button type="button" onClick={()=>setShowPass(p=>!p)} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white"><Eye size={12}/></button></div></div>
          <div><label className="text-[10px] text-slate-400 block mb-1">GST Rate (%)</label>
            <input className="w-full px-3 py-2 rounded-xl text-xs text-white outline-none font-mono" style={inpS} placeholder="17" value={s.gstRate} onChange={e=>setS(p=>({...p,gstRate:e.target.value}))}/></div>
        </div>
        {/* Sandbox toggle */}
        <div className="flex items-center justify-between mb-4 px-3 py-2 rounded-xl" style={{background:"rgba(255,255,255,0.04)"}}>
          <div><div className="text-xs text-white font-medium">Sandbox Mode</div><div className="text-[10px] text-slate-500">Use FBR test environment — invoice numbers prefixed SB-</div></div>
          <button onClick={()=>setS(p=>({...p,fbrSandbox:!p.fbrSandbox}))} className={`w-10 h-5 rounded-full relative transition-colors ${s.fbrSandbox?"bg-amber-500":"bg-white/10"}`}><div className="w-4 h-4 rounded-full bg-white absolute top-0.5 transition-all" style={{left:s.fbrSandbox?22:2}}/></button>
        </div>
        {formErr&&<div className="mb-3 text-xs text-red-400 px-3 py-2 rounded-lg" style={{background:"rgba(239,68,68,0.1)"}}>{formErr}</div>}
        <div className="flex gap-2 flex-wrap">
          <button onClick={async()=>{
            setFormErr(null);
            // Tax fields are mandatory when FBR is enabled for Pakistan
            if(s.fbrEnabled&&s.country==="PK"){
              if(!s.ntn.trim()){setFormErr("NTN is required to enable FBR.");return;}
              if(!s.taxNumber.trim()){setFormErr("STRN / Tax Number is required to enable FBR.");return;}
            }
            setSaving(true);
            try{
              await api.settings.update({country:s.country||undefined,ntn:s.ntn,taxNumber:s.taxNumber,fbrPosId:parseInt(s.fbrPosId)||undefined,fbrUserId:s.fbrUserId,fbrPassword:s.fbrPassword,gstRate:parseFloat(s.gstRate)||17,fbrSandbox:s.fbrSandbox,fbrEnabled:s.fbrEnabled});
              localStorage.setItem("biz_country",s.country);localStorage.setItem("biz_ntn",s.ntn);localStorage.setItem("biz_taxNumber",s.taxNumber);localStorage.setItem("biz_gstRate",s.gstRate);
              setRes("ok");
            }catch(e:any){setFormErr(e?.message||"Save failed");}
            setSaving(false);
          }} disabled={saving} className="px-4 py-2 rounded-xl text-xs font-semibold text-white disabled:opacity-50" style={{background:"linear-gradient(135deg,#8b5cf6,#7c3aed)"}}>{saving?"Saving...":"Save Settings"}</button>
          <button onClick={async()=>{setTesting(true);setRes(null);try{await api.pos.stats();setRes("ok");}catch{setRes("fail");}setTesting(false);}} disabled={testing} className="px-4 py-2 rounded-xl text-xs text-slate-300 disabled:opacity-50 flex items-center gap-1.5" style={{background:"rgba(255,255,255,0.06)"}}>{testing?<RefreshCw size={12} className="animate-spin"/>:<WifiIcon size={12}/>}Test Connection</button>
          {res&&<span className={`px-3 py-2 rounded-xl text-xs ${res==="ok"?"text-green-400":"text-red-400"}`}>{res==="ok"?"✓ Connected":"✗ Failed"}</span>}
        </div>
      </div>
      {!s.fbrSandbox&&<div className="gc rounded-2xl p-4" style={{...CARD,border:"1px solid rgba(239,68,68,0.3)"}}>
        <div className="flex items-start gap-3"><AlertTriangle size={15} className="text-red-400 mt-0.5 flex-shrink-0"/><div><div className="text-xs font-semibold text-red-400 mb-1">Live Mode Active</div><div className="text-xs text-slate-400">All invoices are submitted to FBR production servers. Make sure your credentials are correct before processing sales.</div></div></div>
      </div>}
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
  const ct=useCard();
  const bizType=getPosBizType();
  const [tab,setTab]=useState<"pos"|"kds"|"inventory"|"history"|"fbr">(
    ()=>can(role,"viewKitchen")&&!can(role,"newSale")?"kds":"pos"
  );
  const currency=localStorage.getItem("biz_currency")||"GBP";
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
          <div><h1 className="text-2xl font-bold text-white tracking-tight">The Loyaly POS</h1><p className="text-xs text-slate-400 mt-0.5">{biz.label} · {currency}</p></div>
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
  const [portalDark,setPortalDark]=useState(()=>{
    // Default to dark; only go light if user explicitly chose it
    const saved=localStorage.getItem("portal_dark");
    return saved===null||saved==="true";
  });
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
  if(window.location.pathname==="/auth/accept-invite")return(
    <ThemeCtx.Provider value={{dark:true}}>
      <AcceptInvitePage onLogin={(u:any)=>{
        if(u?.role)localStorage.setItem("userRole",u.role);
        onRoleChange?.(u?.role??'');
        setLoggedIn(true);
      }}/>
    </ThemeCtx.Provider>
  );
  if(!loggedIn)return <LoginPage onLogin={(u:any)=>{
    if(u?.role)localStorage.setItem("userRole",u.role);
    onRoleChange?.(u?.role??'');
    if(u?.role==='PLATFORM_ADMINISTRATOR')return; // App.tsx will switch to AdminPanel
    setLoggedIn(true);
  }}/>;
  const nav=(p:any)=>{
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
    {id:"pos",icon:ShoppingCart,label:"POS",roles:[ROLES.OWNER,ROLES.MANAGER,ROLES.KITCHEN]},
    {id:"customers",icon:Users,label:"Customers",roles:[ROLES.OWNER,ROLES.MANAGER,ROLES.STAFF]},
    {id:"messages",icon:MessageSquare,label:"Messages",roles:[ROLES.OWNER,ROLES.MANAGER,ROLES.STAFF]},
    {id:"campaigns",icon:Send,label:"Campaigns",roles:[ROLES.OWNER,ROLES.MANAGER,ROLES.STAFF]},
    {id:"settings",icon:Settings,label:"Settings",roles:[ROLES.OWNER]},
  ];
  const BOT_NAV=BOT_NAV_ALL.filter(it=>it.roles.includes(role)).slice(0,5);
  const pt=pdTokens(portalDark);
  return(
  <PortalThemeCtx.Provider value={{pd:portalDark,setPd:(v)=>{setPortalDark(v);localStorage.setItem("portal_dark",String(v));localStorage.setItem("portal_dark",String(v));}}}>
    <div className="min-h-screen relative overflow-x-hidden" style={{background:pt.bg,color:pt.tx,transition:"background 0.3s,color 0.3s"}}>
      {/* Ambient background orbs for glassmorphism depth */}
      <div className="fixed inset-0 pointer-events-none z-0">
        <div style={{position:"absolute",top:"-10%",left:"-5%",width:"500px",height:"500px",borderRadius:"50%",background:portalDark?"radial-gradient(circle,rgba(139,92,246,0.18) 0%,transparent 70%)":"radial-gradient(circle,rgba(139,92,246,0.1) 0%,transparent 70%)",filter:"blur(40px)"}}/>
        <div style={{position:"absolute",top:"40%",right:"-10%",width:"600px",height:"600px",borderRadius:"50%",background:portalDark?"radial-gradient(circle,rgba(6,182,212,0.12) 0%,transparent 70%)":"radial-gradient(circle,rgba(6,182,212,0.07) 0%,transparent 70%)",filter:"blur(40px)"}}/>
        <div style={{position:"absolute",bottom:"-10%",left:"30%",width:"500px",height:"500px",borderRadius:"50%",background:portalDark?"radial-gradient(circle,rgba(236,72,153,0.08) 0%,transparent 70%)":"radial-gradient(circle,rgba(236,72,153,0.05) 0%,transparent 70%)",filter:"blur(40px)"}}/>
        <div style={{position:"absolute",top:"20%",left:"40%",width:"300px",height:"300px",borderRadius:"50%",background:portalDark?"radial-gradient(circle,rgba(139,92,246,0.07) 0%,transparent 70%)":"radial-gradient(circle,rgba(139,92,246,0.05) 0%,transparent 70%)",filter:"blur(30px)"}}/>
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
      <div className="hidden md:block"><Sidebar page={page} setPage={nav} col={col} setCol={setCol} onLogout={doLogout} wa={wa} role={role} portalDark={portalDark} setPortalDark={setPortalDark}/></div>
      {/* Mobile top bar */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-4 py-3" style={{background:portalDark?"rgba(8,6,18,0.95)":"rgba(255,255,255,0.96)",backdropFilter:"blur(20px)",WebkitBackdropFilter:"blur(20px)",borderBottom:`1px solid ${pt.bdr}`}}>
        <div className="flex items-center">
          <ThemeLogo dark={portalDark} className="h-6 w-auto object-contain"/>
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
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 flex items-center overflow-x-auto" style={{background:portalDark?"rgba(8,6,18,0.97)":"rgba(255,255,255,0.97)",backdropFilter:"blur(24px)",WebkitBackdropFilter:"blur(24px)",borderTop:`1px solid ${pt.bdr}`}}>
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
  </PortalThemeCtx.Provider>
  );
}
