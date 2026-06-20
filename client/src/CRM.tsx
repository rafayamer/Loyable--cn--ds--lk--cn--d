import { useState, useEffect, useRef, useCallback } from "react";
import { api } from "./api/index";
import { AreaChart, Area, BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ZAxis } from "recharts";
import { Users, BarChart3, MessageSquare, Zap, Settings, LogOut, ChevronRight, Search, Plus, ArrowUpRight, ArrowDownRight, Eye, Send, CheckCheck, Clock, Star, Crown, UserPlus, UserMinus, Gift, TrendingUp, Bell, Menu, X, ChevronLeft, Mail, Phone, Building, Globe, CreditCard, Shield, Palette, Play, Edit, Target, Heart, Check, LayoutDashboard, Image, Paperclip, FileText, ArrowLeft, RefreshCw, CircleCheck, Info, WifiOff, Database, Brain, Activity, AlertTriangle, Table, Terminal, Layers, Download, Wifi, Tag, Link, Type, MousePointer, Cpu, Award, Repeat, RotateCcw, Sliders, Gift as GiftIcon, Star as StarIcon, Zap as ZapIcon, ChevronDown, ChevronUp, Hash, DollarSign, ShoppingBag, MoreVertical, Filter, Copy, Trash2, Smartphone, Lock, ShoppingCart, Receipt, Printer, CheckCircle, XCircle, Wifi as WifiIcon } from "lucide-react";

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
// SIDEBAR
// ════════════════════════════════════════════════════════════════
const NAV=[{id:"dashboard",icon:LayoutDashboard,label:"Dashboard"},{id:"customers",icon:Users,label:"Customers"},{id:"pos",icon:ShoppingCart,label:"POS"},{id:"messages",icon:MessageSquare,label:"Messages"},{id:"campaigns",icon:Send,label:"Campaigns"},{id:"automations",icon:Zap,label:"Automations"},{id:"loyalty",icon:Award,label:"Loyalty & Points"},{id:"datahub",icon:Database,label:"Data Hub"},{id:"ai",icon:Brain,label:"AI Insights"},{id:"analytics",icon:BarChart3,label:"Analytics"},{id:"settings",icon:Settings,label:"Settings"}];
const Sidebar=({page,setPage,col,setCol,onLogout,wa})=>(
  <div className={`fixed left-0 top-0 h-full z-50 flex flex-col transition-all duration-300 ${col?"w-[72px]":"w-[240px]"}`} style={{background:"rgba(8,5,18,0.85)",backdropFilter:"blur(24px)",WebkitBackdropFilter:"blur(24px)",borderRight:"1px solid rgba(255,255,255,0.08)"}}>
    <div className={`flex items-center gap-3 p-4 mb-2 ${col?"justify-center":""}`}>
      <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{background:"linear-gradient(135deg,#8b5cf6,#06b6d4)"}}><span className="text-white font-bold text-sm">L</span></div>
      {!col&&<div className="flex-1 min-w-0"><div className="text-white font-bold text-sm tracking-tight">Loyable</div><div className="text-slate-600 text-[10px]">CRM Platform</div></div>}
      <button onClick={()=>setCol(!col)} className={`text-slate-600 hover:text-slate-300 transition-colors ${col?"hidden":""}`}><ChevronLeft size={15}/></button>
      {col&&<button onClick={()=>setCol(!col)} className="absolute right-2 text-slate-600 hover:text-slate-300 transition-colors"><ChevronRight size={15}/></button>}
    </div>
    {!col&&<div className="mx-3 mb-3 px-3 py-2 rounded-xl flex items-center gap-2" style={{background:"rgba(34,197,94,0.07)",border:"1px solid rgba(34,197,94,0.12)"}}><div className="w-2 h-2 rounded-full bg-emerald-400 flex-shrink-0"/><span className="text-xs text-emerald-400 font-medium truncate">The Coffee House</span></div>}
    <nav className="flex-1 px-2.5 space-y-0.5 overflow-y-auto">{NAV.map(it=>{
      const active=page===it.id;
      return(
        <button key={it.id} onClick={()=>setPage(it.id)} title={col?it.label:undefined}
          className={`w-full flex items-center gap-3 py-2.5 rounded-xl text-xs font-medium transition-all duration-150 ${col?"justify-center px-3":"px-3"} ${active?"text-white":"text-slate-400 hover:text-slate-200 hover:bg-white/[0.04]"}`}
          style={active?{background:"linear-gradient(135deg,rgba(139,92,246,0.2),rgba(6,182,212,0.08))",borderLeft:col?"none":"3px solid #8b5cf6",paddingLeft:col?undefined:"9px"}:{}}>
          <it.icon size={17} className="flex-shrink-0"/>
          {!col&&<span className="flex-1 text-left">{it.label}</span>}
          {!col&&it.id==="messages"&&wa&&<div className="w-2 h-2 rounded-full bg-emerald-400"/>}
          {!col&&it.id==="ai"&&<span className="text-[9px] font-bold px-1.5 py-0.5 rounded-md" style={{background:"rgba(6,182,212,0.15)",color:"#06b6d4"}}>ML</span>}
        </button>
      );
    })}</nav>
    <div className="p-2.5 border-t border-white/[0.05]">
      <button onClick={onLogout} className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs text-slate-500 hover:text-red-400 hover:bg-red-400/5 transition-all ${col?"justify-center":""}`}><LogOut size={16}/>{!col&&<span>Logout</span>}</button>
    </div>
  </div>
);

// ════════════════════════════════════════════════════════════════
// LOGIN
// ════════════════════════════════════════════════════════════════
const LoginPage=({onLogin}: {onLogin:(user:any)=>void})=>{
  const [e,setE]=useState("owner@coffeehouse.com");
  const [p,setP]=useState("Owner@123!");
  const [err,setErr]=useState("");
  const [loading,setLoading]=useState(false);
  const submit=async()=>{
    if(!e||!p)return;
    setErr("");setLoading(true);
    try{
      const d=await api.auth.login(e,p);
      localStorage.setItem("accessToken",d.accessToken);
      onLogin(d.user);
    }catch(ex){setErr((ex as Error).message);}
    finally{setLoading(false);}
  };
  return(
    <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden" style={{background:BG}}>
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/3 w-96 h-96 rounded-full opacity-[0.07] blur-3xl" style={{background:"#8b5cf6"}}/>
        <div className="absolute bottom-1/3 right-1/4 w-80 h-80 rounded-full opacity-[0.07] blur-3xl" style={{background:"#06b6d4"}}/>
      </div>
      <div className="w-full max-w-sm relative z-10">
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl mx-auto mb-4 flex items-center justify-center shadow-2xl" style={{background:"linear-gradient(135deg,#8b5cf6,#06b6d4)"}}><span className="text-white font-bold text-2xl">L</span></div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Loyable CRM</h1>
          <p className="text-slate-400 text-sm mt-1.5">Sign in to your workspace</p>
        </div>
        <div className="gc rounded-2xl p-6" style={CARD}>
          <div className="space-y-4 mb-5">
            <div><label className="text-xs font-medium text-slate-400 mb-1.5 block">Email</label><input value={e} onChange={ev=>setE(ev.target.value)} onKeyDown={ev=>ev.key==="Enter"&&submit()} type="email" placeholder="owner@business.com" className={inp} style={INP}/></div>
            <div><label className="text-xs font-medium text-slate-400 mb-1.5 block">Password</label><input value={p} onChange={ev=>setP(ev.target.value)} onKeyDown={ev=>ev.key==="Enter"&&submit()} type="password" placeholder="••••••••" className={inp} style={INP}/></div>
          </div>
          {err&&<div className="mb-4 px-4 py-2.5 rounded-xl text-xs text-red-400" style={{background:"rgba(239,68,68,0.08)",border:"1px solid rgba(239,68,68,0.15)"}}>{err}</div>}
          <button onClick={submit} disabled={loading} className="w-full py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-60 flex items-center justify-center gap-2 transition-all hover:opacity-90" style={{background:"linear-gradient(135deg,#8b5cf6,#7c3aed)"}}>{loading&&<RefreshCw size={14} className="animate-spin"/>}{loading?"Signing in…":"Sign In"}</button>
          <div className="mt-4 px-3 py-2.5 rounded-xl" style={{background:"rgba(139,92,246,0.07)",border:"1px solid rgba(139,92,246,0.12)"}}><p className="text-[11px] text-slate-500 text-center">Secured with Argon2id · JWT · Rate limiting</p></div>
        </div>
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
  const [dash,setDash]=useState<any>(null);
  const [loading,setLoading]=useState(true);
  const [customers,setCustomers]=useState<any[]>([]);
  useEffect(()=>{
    api.dashboard.get().then(setDash).catch(()=>{}).finally(()=>setLoading(false));
    api.customers.list({segment:"AT_RISK",limit:4}).then(d=>setCustomers(d.customers.map(mapCustomer))).catch(()=>{});
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
        <div className="overflow-x-auto"><table className="w-full text-xs"><thead><tr className="border-b border-white/5"><th className="text-left py-3 px-4 text-slate-400 font-medium">Customer</th><th className="text-left py-3 px-3 text-slate-400 font-medium">Template</th><th className="text-left py-3 px-3 text-slate-400 font-medium">Status</th><th className="text-left py-3 px-3 text-slate-400 font-medium hidden md:table-cell">Provider ID</th><th className="text-left py-3 px-3 text-slate-400 font-medium">Sent</th></tr></thead>
          <tbody>{loading?[...Array(6)].map((_,i)=><tr key={i}><td colSpan={5} className="py-2 px-4"><Skeleton h="h-8"/></td></tr>):messages.length===0?<tr><td colSpan={5} className="py-8 text-center text-slate-500">No messages found</td></tr>:messages.map((m:any)=>(
            <tr key={m.id} className="border-b border-white/3 hover:bg-white/2">
              <td className="py-2.5 px-4"><div className="font-medium text-white">{m.customer?.fullName||"—"}</div><div className="text-slate-500">{m.customer?.phone||""}</div></td>
              <td className="py-2.5 px-3 font-mono text-violet-300">{m.templateName||"—"}</td>
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
  useEffect(()=>{
    api.analytics.tiers().then(d=>setTiers(Array.isArray(d)?d:[])).catch(()=>{}).finally(()=>setLoading(false));
    api.dashboard.get().then(d=>setDashKpis(d?.kpis)).catch(()=>{});
  },[]);
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

const SettingsPage=({wa,onConnect})=>{
  const [tab,setTab]=useState("business");
  const tabs=[{id:"business",label:"Business",icon:Building},{id:"whatsapp",label:"WhatsApp API",icon:MessageSquare},{id:"rbac",label:"Team & Roles",icon:Users},{id:"stripe",label:"Billing",icon:CreditCard},{id:"security",label:"Security",icon:Shield},{id:"gdpr",label:"GDPR",icon:Globe}];
  return(
    <div className="space-y-4">
      <div><h1 className="text-xl font-bold text-white">Settings</h1><p className="text-xs text-slate-400 mt-0.5">Tenant configuration · All changes scoped to businessId</p></div>
      <div className="flex gap-1 overflow-x-auto pb-1">{tabs.map(t=><button key={t.id} onClick={()=>setTab(t.id)} className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs whitespace-nowrap ${tab===t.id?"text-white":"text-slate-400"}`} style={tab===t.id?{background:"rgba(139,92,246,0.2)"}:{}}><t.icon size={12}/>{t.label}{t.id==="whatsapp"&&<span className={`w-1.5 h-1.5 rounded-full ${wa?"bg-green-400":"bg-red-400"}`}/>}</button>)}</div>
      <div className="gc rounded-xl p-5" style={CARD}>
        {tab==="business"&&<div className="space-y-4"><div className="flex items-center gap-4 mb-2"><div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{background:"linear-gradient(135deg,#8b5cf6,#06b6d4)"}}><span className="text-white font-bold text-xl">TC</span></div><div><button className="text-xs text-violet-400 hover:text-violet-300">Change Logo</button><div className="text-xs text-slate-500 mt-1">businessId: biz_the_coffee_house</div></div></div><div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{[{l:"Business Name",v:"The Coffee House"},{l:"Industry",v:"Café & Restaurant"},{l:"Country (ISO 3166-1)",v:"GB"},{l:"Currency (ISO 4217)",v:"GBP"},{l:"Timezone (IANA)",v:"Europe/London"},{l:"Custom Domain (white-label)",v:"loyalty.coffeehouse.com"},{l:"Loyal Days Window",v:"7"},{l:"Irregular Gap Days",v:"14"},{l:"Lost Days Threshold",v:"60"},{l:"Message Cooldown (hours)",v:"72"}].map((f,i)=><div key={i}><label className="text-xs text-slate-400 mb-1 block">{f.l}</label><input defaultValue={f.v} className="w-full px-3 py-2 rounded-lg text-xs text-white outline-none" style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.08)"}}/></div>)}</div><button className="px-4 py-2 rounded-lg text-xs font-medium text-white" style={{background:"linear-gradient(135deg,#8b5cf6,#7c3aed)"}}>Save Changes</button></div>}
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
  useEffect(()=>{
    api.campaigns.list().then(d=>setCampaigns(d.campaigns??[])).catch(()=>{}).finally(()=>setLoading(false));
  },[]);
  const launch=async(id:string)=>{
    setLaunching(id);
    try{await api.campaigns.launch(id);setCampaigns(p=>p.map(c=>c.id===id?{...c,status:"ACTIVE"}:c));}
    catch(e){}finally{setLaunching(null);}
  };
  const totalSent=campaigns.reduce((a:number,c:any)=>a+(c.stats?.sent??0),0);
  const totalDel=campaigns.reduce((a:number,c:any)=>a+(c.stats?.delivered??0),0);
  const totalRead=campaigns.reduce((a:number,c:any)=>a+(c.stats?.read??0),0);
  const statusColor=(s:string)=>s==="ACTIVE"||s==="LAUNCHED"?C.green:s==="SCHEDULED"?C.amber:s==="DRAFT"?"#64748b":s==="COMPLETED"?"#8b5cf6":"#64748b";
  return(
    <div className="space-y-4">
      <div className="flex items-center justify-between"><div><h1 className="text-xl font-bold text-white">Campaigns</h1><p className="text-xs text-slate-400 mt-0.5">WhatsApp campaign builder · BullMQ dispatch · AI-assisted copywriting</p></div><button onClick={onBuilder} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium text-white" style={{background:"linear-gradient(135deg,#8b5cf6,#7c3aed)"}}><Plus size={14}/>Campaign Builder</button></div>
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
        <div key={a.id} className={`rounded-xl p-4 transition-all ${on?"":"opacity-60"}`} className="gc" style={{...CARD,border:`1px solid ${on?"rgba(139,92,246,0.3)":"rgba(255,255,255,0.07)"}`}}>
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
const POSPage=()=>{
  const [tab,setTab]=useState<"sale"|"history"|"fbr">("sale");

  // ── New Sale state ───────────────────────────────────────────
  const [items,setItems]=useState([{name:"",qty:1,unitPrice:0,pctCode:""}]);
  const [paymentMode,setPaymentMode]=useState<"CASH"|"CARD"|"WALLET">("CASH");
  const [customerPhone,setCustomerPhone]=useState("");
  const [customerName,setCustomerName]=useState("");
  const [discount,setDiscount]=useState(0);
  const [processing,setProcessing]=useState(false);
  const [saleResult,setSaleResult]=useState<any>(null);
  const [saleErr,setSaleErr]=useState("");

  // ── History state ────────────────────────────────────────────
  const [sales,setSales]=useState<any[]>([]);
  const [salesTotal,setSalesTotal]=useState(0);
  const [salesPage,setSalesPage]=useState(1);
  const [salesLoading,setSalesLoading]=useState(false);
  const [filterFrom,setFilterFrom]=useState("");
  const [filterTo,setFilterTo]=useState("");
  const [filterMode,setFilterMode]=useState("");
  const [selectedSale,setSelectedSale]=useState<any>(null);

  // ── FBR Stats state ──────────────────────────────────────────
  const [stats,setStats]=useState<any>(null);
  const [fbrSettings,setFbrSettings]=useState({ntn:"",strn:"",fbrPosId:"",fbrToken:"",gstRate:"17",fbrEnabled:false});
  const [savingSettings,setSavingSettings]=useState(false);
  const [testingConn,setTestingConn]=useState(false);
  const [connResult,setConnResult]=useState<string|null>(null);

  const GST_RATE=17;

  // ── Calculations ─────────────────────────────────────────────
  const subtotal=items.reduce((s,i)=>s+(i.qty*(i.unitPrice||0)),0)-discount;
  const gstAmt=parseFloat((subtotal-(subtotal/(1+GST_RATE/100))).toFixed(2));
  const total=parseFloat(subtotal.toFixed(2));

  const addItem=()=>setItems(p=>[...p,{name:"",qty:1,unitPrice:0,pctCode:""}]);
  const removeItem=(idx:number)=>setItems(p=>p.filter((_,i)=>i!==idx));
  const updateItem=(idx:number,field:string,val:any)=>setItems(p=>p.map((it,i)=>i===idx?{...it,[field]:val}:it));

  const processSale=async()=>{
    if(items.some(i=>!i.name||i.unitPrice<=0)){setSaleErr("All items need a name and price.");return;}
    setProcessing(true);setSaleErr("");setSaleResult(null);
    try{
      const r=await api.pos.createSale({customerPhone,customerName,items:items.map(i=>({name:i.name,qty:Number(i.qty),unitPrice:Number(i.unitPrice),pctCode:i.pctCode||undefined})),paymentMode,discount:Number(discount)});
      setSaleResult(r);
      // Reset form
      setItems([{name:"",qty:1,unitPrice:0,pctCode:""}]);setCustomerPhone("");setCustomerName("");setDiscount(0);
    }catch(ex){setSaleErr((ex as Error).message);}
    finally{setProcessing(false);}
  };

  const loadSales=async()=>{
    setSalesLoading(true);
    try{
      const p:any={page:salesPage,limit:20};
      if(filterFrom)p.from=filterFrom;
      if(filterTo)p.to=filterTo;
      if(filterMode)p.paymentMode=filterMode;
      const r=await api.pos.sales(p);
      setSales(r.sales??[]);setSalesTotal(r.total??0);
    }catch{}
    finally{setSalesLoading(false);}
  };

  const loadStats=async()=>{
    try{const r=await api.pos.stats();setStats(r);}catch{}
  };

  useEffect(()=>{if(tab==="history")loadSales();},[tab,salesPage,filterFrom,filterTo,filterMode]);
  useEffect(()=>{if(tab==="fbr")loadStats();},[tab]);

  const retryFbr=async(id:string)=>{
    try{await api.pos.retryFbr(id);loadSales();alert("FBR retry successful");}
    catch(ex){alert("Retry failed: "+(ex as Error).message);}
  };

  const openReceipt=(id:string)=>{window.open(api.pos.receipt(id),"_blank");};

  const testConn=async()=>{
    setTestingConn(true);setConnResult(null);
    try{
      await api.pos.stats();
      setConnResult("ok");
    }catch{setConnResult("fail");}
    finally{setTestingConn(false);}
  };

  const cardS=CARD;
  const inpS={background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)",color:"#fff"};

  return(
    <div>
      <div className="flex items-center justify-between mb-6">
        <div><h1 className="text-xl font-bold text-white flex items-center gap-2"><ShoppingCart size={20} className="text-violet-400"/>Point of Sale</h1><p className="text-xs text-slate-400 mt-0.5">FBR e-invoicing enabled</p></div>
        <div className="flex gap-1 rounded-lg p-1" style={{background:"rgba(255,255,255,0.05)"}}>
          {(["sale","history","fbr"] as const).map(t=>(
            <button key={t} onClick={()=>setTab(t)} className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${tab===t?"text-white":"text-slate-400 hover:text-white"}`} style={tab===t?{background:"rgba(139,92,246,0.3)"}:{}}>{t==="sale"?"New Sale":t==="history"?"Sales History":"FBR Status"}</button>
          ))}
        </div>
      </div>

      {/* ── TAB 1: New Sale ── */}
      {tab==="sale"&&(
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Left: Item entry */}
          <div className="lg:col-span-2 space-y-4">
            <div className="rounded-xl p-4" className="gc" style={cardS}>
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-medium text-white">Items</span>
                <button onClick={addItem} className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs text-violet-400" style={{background:"rgba(139,92,246,0.1)"}}>
                  <Plus size={12}/>Add Item
                </button>
              </div>
              <div className="space-y-2">
                <div className="grid grid-cols-12 gap-2 text-xs text-slate-500 px-1">
                  <span className="col-span-5">Item Name</span>
                  <span className="col-span-2">Qty</span>
                  <span className="col-span-3">Unit Price</span>
                  <span className="col-span-1"></span>
                </div>
                {items.map((item,idx)=>(
                  <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                    <input className="col-span-5 px-2 py-1.5 rounded-lg text-xs text-white outline-none" style={inpS} placeholder="Item name" value={item.name} onChange={e=>updateItem(idx,"name",e.target.value)}/>
                    <input className="col-span-2 px-2 py-1.5 rounded-lg text-xs text-white outline-none" style={inpS} type="number" min={1} value={item.qty} onChange={e=>updateItem(idx,"qty",e.target.value)}/>
                    <input className="col-span-3 px-2 py-1.5 rounded-lg text-xs text-white outline-none" style={inpS} type="number" min={0} step={0.01} placeholder="0.00" value={item.unitPrice||""} onChange={e=>updateItem(idx,"unitPrice",e.target.value)}/>
                    <button onClick={()=>removeItem(idx)} disabled={items.length===1} className="col-span-1 text-slate-600 hover:text-red-400 disabled:opacity-30 flex justify-center"><X size={14}/></button>
                  </div>
                ))}
              </div>
            </div>

            {/* Customer + Payment */}
            <div className="rounded-xl p-4" className="gc" style={cardS}>
              <div className="text-sm font-medium text-white mb-3">Customer (optional)</div>
              <div className="grid grid-cols-2 gap-3 mb-4">
                <input className="px-3 py-2 rounded-lg text-xs text-white outline-none" style={inpS} placeholder="Phone (+92...)" value={customerPhone} onChange={e=>setCustomerPhone(e.target.value)}/>
                <input className="px-3 py-2 rounded-lg text-xs text-white outline-none" style={inpS} placeholder="Name" value={customerName} onChange={e=>setCustomerName(e.target.value)}/>
              </div>
              <div className="text-sm font-medium text-white mb-3">Payment Mode</div>
              <div className="flex gap-2 mb-4">
                {(["CASH","CARD","WALLET"] as const).map(m=>(
                  <button key={m} onClick={()=>setPaymentMode(m)} className={`flex-1 py-2 rounded-lg text-xs font-medium transition-all ${paymentMode===m?"text-white":"text-slate-400"}`} style={paymentMode===m?{background:"rgba(139,92,246,0.3)",border:"1px solid rgba(139,92,246,0.4)"}:{background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.08)"}}>{m}</button>
                ))}
              </div>
              <div className="flex items-center gap-3">
                <label className="text-xs text-slate-400">Discount</label>
                <input className="w-28 px-2 py-1.5 rounded-lg text-xs text-white outline-none" style={inpS} type="number" min={0} step={0.01} value={discount||""} placeholder="0.00" onChange={e=>setDiscount(Number(e.target.value))}/>
              </div>
            </div>
          </div>

          {/* Right: Summary + process */}
          <div className="space-y-4">
            <div className="rounded-xl p-4" className="gc" style={cardS}>
              <div className="text-sm font-medium text-white mb-4">Order Summary</div>
              <div className="space-y-2 text-xs">
                {items.filter(i=>i.name).map((i,idx)=>(
                  <div key={idx} className="flex justify-between text-slate-300">
                    <span className="truncate mr-2">{i.name} x{i.qty}</span>
                    <span>PKR {(i.qty*(i.unitPrice||0)).toFixed(2)}</span>
                  </div>
                ))}
                {discount>0&&<div className="flex justify-between text-amber-400"><span>Discount</span><span>-PKR {discount.toFixed(2)}</span></div>}
                <div className="border-t border-white/10 pt-2 mt-2 space-y-1">
                  <div className="flex justify-between text-slate-400"><span>Subtotal (excl. GST)</span><span>PKR {(subtotal-gstAmt).toFixed(2)}</span></div>
                  <div className="flex justify-between text-amber-400"><span>GST ({GST_RATE}%)</span><span>PKR {gstAmt.toFixed(2)}</span></div>
                  <div className="flex justify-between text-white font-bold text-sm mt-1"><span>TOTAL</span><span>PKR {total.toFixed(2)}</span></div>
                </div>
              </div>
              {saleErr&&<div className="mt-3 p-2 rounded-lg text-xs text-red-400" style={{background:"rgba(239,68,68,0.1)"}}>{saleErr}</div>}
              <button onClick={processSale} disabled={processing||items.every(i=>!i.name)} className="w-full mt-4 py-2.5 rounded-lg text-sm font-medium text-white disabled:opacity-50 flex items-center justify-center gap-2" style={{background:"linear-gradient(135deg,#8b5cf6,#06b6d4)"}}>
                {processing?<RefreshCw size={14} className="animate-spin"/>:<ShoppingCart size={14}/>}{processing?"Processing...":"Process Sale"}
              </button>
            </div>

            {/* Sale result */}
            {saleResult&&(
              <div className="rounded-xl p-4" className="gc" style={{...cardS,border:"1px solid rgba(34,197,94,0.3)"}}>
                <div className="flex items-center gap-2 mb-3"><CheckCircle size={16} className="text-green-400"/><span className="text-sm font-medium text-white">Sale Complete</span></div>
                <div className="space-y-1 text-xs">
                  <div className="text-slate-400">FBR Invoice #</div>
                  <div className="text-green-400 font-mono text-xs break-all">{saleResult.fbrInvoiceNumber??"Pending"}</div>
                </div>
                {saleResult.fbrQrCode&&<div className="mt-3 text-xs text-slate-400 break-all">{saleResult.fbrQrCode}</div>}
                <button onClick={()=>openReceipt(saleResult.visit?.id)} className="mt-3 w-full py-1.5 rounded-lg text-xs text-slate-300 flex items-center justify-center gap-1.5" style={{background:"rgba(255,255,255,0.06)"}}>
                  <Printer size={12}/>Print Receipt
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── TAB 2: Sales History ── */}
      {tab==="history"&&(
        <div className="space-y-4">
          {/* Filters */}
          <div className="rounded-xl p-4" className="gc" style={cardS}>
            <div className="flex flex-wrap gap-3 items-end">
              <div><label className="text-xs text-slate-400 block mb-1">From</label><input type="date" className="px-2 py-1.5 rounded-lg text-xs text-white outline-none" style={inpS} value={filterFrom} onChange={e=>setFilterFrom(e.target.value)}/></div>
              <div><label className="text-xs text-slate-400 block mb-1">To</label><input type="date" className="px-2 py-1.5 rounded-lg text-xs text-white outline-none" style={inpS} value={filterTo} onChange={e=>setFilterTo(e.target.value)}/></div>
              <div><label className="text-xs text-slate-400 block mb-1">Payment</label>
                <select className="px-2 py-1.5 rounded-lg text-xs text-white outline-none" style={inpS} value={filterMode} onChange={e=>setFilterMode(e.target.value)}>
                  <option value="">All</option><option value="CASH">Cash</option><option value="CARD">Card</option><option value="WALLET">Wallet</option>
                </select>
              </div>
              <button onClick={()=>{setSalesPage(1);loadSales();}} className="px-3 py-1.5 rounded-lg text-xs text-white" style={{background:"rgba(139,92,246,0.3)"}}>Apply</button>
            </div>
          </div>

          {/* Table */}
          <div className="rounded-xl overflow-hidden" className="gc" style={cardS}>
            {salesLoading?<div className="p-8 text-center text-slate-400"><RefreshCw size={20} className="animate-spin mx-auto mb-2"/>Loading...</div>:(
              <table className="w-full text-xs">
                <thead><tr style={{borderBottom:"1px solid rgba(255,255,255,0.06)"}}>
                  {["Date/Time","Customer","Amount","GST","Mode","FBR Invoice","Status",""].map(h=><th key={h} className="px-3 py-2.5 text-left text-slate-400 font-medium">{h}</th>)}
                </tr></thead>
                <tbody>
                  {sales.length===0?<tr><td colSpan={8} className="px-3 py-6 text-center text-slate-500">No sales found</td></tr>:
                  sales.map(s=>(
                    <tr key={s.id} className="cursor-pointer hover:bg-white/[0.02]" style={{borderBottom:"1px solid rgba(255,255,255,0.03)"}} onClick={()=>setSelectedSale(s)}>
                      <td className="px-3 py-2.5 text-slate-300">{new Date(s.visitedAt).toLocaleString("en-PK",{dateStyle:"short",timeStyle:"short"})}</td>
                      <td className="px-3 py-2.5 text-white">{s.customer?.fullName??"—"}</td>
                      <td className="px-3 py-2.5 text-white font-medium">PKR {Number(s.amountSpent).toFixed(2)}</td>
                      <td className="px-3 py-2.5 text-amber-400">{s.gstAmount?`PKR ${Number(s.gstAmount).toFixed(2)}`:"—"}</td>
                      <td className="px-3 py-2.5"><Badge color={s.paymentMode==="CASH"?"#22c55e":s.paymentMode==="CARD"?"#3b82f6":"#8b5cf6"}>{s.paymentMode??"—"}</Badge></td>
                      <td className="px-3 py-2.5 text-slate-400 font-mono max-w-[120px] truncate">{s.fbrInvoiceNumber??<span className="text-slate-600">—</span>}</td>
                      <td className="px-3 py-2.5">{s.fbrSubmittedAt?<Badge color="#22c55e">Submitted</Badge>:<Badge color="#ef4444">Pending</Badge>}</td>
                      <td className="px-3 py-2.5">
                        <div className="flex gap-1">
                          <button onClick={e=>{e.stopPropagation();openReceipt(s.id);}} className="p-1 rounded text-slate-400 hover:text-white"><Printer size={12}/></button>
                          {!s.fbrSubmittedAt&&<button onClick={e=>{e.stopPropagation();retryFbr(s.id);}} className="p-1 rounded text-amber-400 hover:text-amber-300"><RefreshCw size={12}/></button>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Pagination */}
          {salesTotal>20&&(
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span>{salesTotal} total</span>
              <div className="flex gap-1">
                <button disabled={salesPage===1} onClick={()=>setSalesPage(p=>p-1)} className="px-2 py-1 rounded disabled:opacity-40 hover:text-white" style={{background:"rgba(255,255,255,0.06)"}}>Prev</button>
                <span className="px-2 py-1 text-white">{salesPage}</span>
                <button disabled={salesPage*20>=salesTotal} onClick={()=>setSalesPage(p=>p+1)} className="px-2 py-1 rounded disabled:opacity-40 hover:text-white" style={{background:"rgba(255,255,255,0.06)"}}>Next</button>
              </div>
            </div>
          )}

          {/* Sale detail modal */}
          {selectedSale&&(
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{background:"rgba(0,0,0,0.7)"}}>
              <div className="rounded-2xl p-6 w-full max-w-md" style={{background:"#1a1130",border:"1px solid rgba(255,255,255,0.1)"}}>
                <div className="flex items-center justify-between mb-4">
                  <span className="text-sm font-medium text-white">Sale Detail</span>
                  <button onClick={()=>setSelectedSale(null)} className="text-slate-400 hover:text-white"><X size={16}/></button>
                </div>
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between"><span className="text-slate-400">Customer</span><span className="text-white">{selectedSale.customer?.fullName??"—"}</span></div>
                  <div className="flex justify-between"><span className="text-slate-400">Amount</span><span className="text-white font-medium">PKR {Number(selectedSale.amountSpent).toFixed(2)}</span></div>
                  <div className="flex justify-between"><span className="text-slate-400">GST</span><span className="text-amber-400">PKR {Number(selectedSale.gstAmount??0).toFixed(2)}</span></div>
                  <div className="flex justify-between"><span className="text-slate-400">Payment</span><span className="text-white">{selectedSale.paymentMode??"—"}</span></div>
                  <div className="flex justify-between"><span className="text-slate-400">FBR Invoice</span><span className="text-green-400 font-mono break-all text-right max-w-[200px]">{selectedSale.fbrInvoiceNumber??<span className="text-red-400">Not submitted</span>}</span></div>
                  {selectedSale.fbrQrCode&&<div><span className="text-slate-400">QR URL</span><div className="mt-1 text-cyan-400 break-all">{selectedSale.fbrQrCode}</div></div>}
                  <div className="flex justify-between"><span className="text-slate-400">Date</span><span className="text-white">{new Date(selectedSale.visitedAt).toLocaleString()}</span></div>
                  {selectedSale.notes&&<div><span className="text-slate-400">Notes</span><div className="text-slate-300 mt-0.5">{selectedSale.notes}</div></div>}
                </div>
                <div className="flex gap-2 mt-4">
                  <button onClick={()=>openReceipt(selectedSale.id)} className="flex-1 py-2 rounded-lg text-xs text-white flex items-center justify-center gap-1.5" style={{background:"rgba(139,92,246,0.3)"}}><Printer size={12}/>Receipt</button>
                  {!selectedSale.fbrSubmittedAt&&<button onClick={()=>{retryFbr(selectedSale.id);setSelectedSale(null);}} className="flex-1 py-2 rounded-lg text-xs text-amber-400 flex items-center justify-center gap-1.5" style={{background:"rgba(245,158,11,0.1)"}}>
                    <RefreshCw size={12}/>Retry FBR
                  </button>}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── TAB 3: FBR Status & Settings ── */}
      {tab==="fbr"&&(
        <div className="space-y-4">
          {/* KPIs */}
          {stats&&(
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
              <KPI icon={DollarSign}  label="Total Sales Today"    value={`PKR ${(stats.totalSales??0).toFixed(2)}`}  color={C.green}/>
              <KPI icon={Receipt}     label="GST Collected"        value={`PKR ${(stats.totalGst??0).toFixed(2)}`}    color={C.amber}/>
              <KPI icon={ShoppingCart}label="Transactions"         value={stats.transactionCount??0}                  color={C.primary}/>
              <KPI icon={CheckCircle} label="FBR Submitted"        value={stats.fbrSubmitted??0}                      color={C.green}/>
              <KPI icon={XCircle}     label="FBR Pending"          value={stats.fbrFailed??0}                         color={C.red}/>
            </div>
          )}
          {!stats&&<button onClick={loadStats} className="px-3 py-2 rounded-lg text-xs text-white" style={{background:"rgba(139,92,246,0.3)"}}>Load Stats</button>}

          {/* FBR Settings */}
          <div className="rounded-xl p-5" className="gc" style={cardS}>
            <div className="flex items-center justify-between mb-4">
              <span className="text-sm font-medium text-white">FBR Configuration</span>
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400">FBR Enabled</span>
                <button onClick={()=>setFbrSettings(p=>({...p,fbrEnabled:!p.fbrEnabled}))} className={`w-9 h-5 rounded-full relative transition-colors ${fbrSettings.fbrEnabled?"bg-violet-500":"bg-white/10"}`}>
                  <div className="w-4 h-4 rounded-full bg-white absolute top-0.5 transition-all" style={{left:fbrSettings.fbrEnabled?18:2}}/>
                </button>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
              {[["NTN","ntn","National Tax Number"],["STRN","strn","Sales Tax Registration Number"],["POS ID","fbrPosId","FBR-assigned POS ID"],["FBR Token","fbrToken","PRAL API Bearer Token"],["GST Rate (%)","gstRate","Default 17"]].map(([label,key,ph])=>(
                <div key={key}>
                  <label className="text-xs text-slate-400 block mb-1">{label}</label>
                  <input className="w-full px-3 py-2 rounded-lg text-xs text-white outline-none" style={inpS} placeholder={ph} value={(fbrSettings as any)[key]} onChange={e=>setFbrSettings(p=>({...p,[key]:e.target.value}))}/>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <button onClick={async()=>{setSavingSettings(true);try{await api.settings.update({ntn:fbrSettings.ntn,strn:fbrSettings.strn,fbrPosId:parseInt(fbrSettings.fbrPosId)||undefined,fbrToken:fbrSettings.fbrToken,gstRate:parseFloat(fbrSettings.gstRate)||17,fbrEnabled:fbrSettings.fbrEnabled});}catch{}setSavingSettings(false);}} disabled={savingSettings} className="px-4 py-2 rounded-lg text-xs font-medium text-white disabled:opacity-50" style={{background:"linear-gradient(135deg,#8b5cf6,#06b6d4)"}}>
                {savingSettings?"Saving...":"Save Settings"}
              </button>
              <button onClick={testConn} disabled={testingConn} className="px-4 py-2 rounded-lg text-xs text-slate-300 disabled:opacity-50 flex items-center gap-1.5" style={{background:"rgba(255,255,255,0.06)"}}>
                {testingConn?<RefreshCw size={12} className="animate-spin"/>:<WifiIcon size={12}/>}Test Connection
              </button>
              {connResult&&<span className={`px-3 py-2 rounded-lg text-xs ${connResult==="ok"?"text-green-400":"text-red-400"}`}>{connResult==="ok"?"Connected":"Connection failed"}</span>}
            </div>
          </div>

          {/* Sandbox notice */}
          <div className="rounded-xl p-4" className="gc" style={{...cardS,border:"1px solid rgba(245,158,11,0.2)"}}>
            <div className="flex items-start gap-3">
              <Info size={16} className="text-amber-400 mt-0.5 flex-shrink-0"/>
              <div>
                <div className="text-xs font-medium text-amber-400 mb-1">Sandbox Mode Active</div>
                <div className="text-xs text-slate-400">When <code className="text-slate-300">NODE_ENV</code> is not <code className="text-slate-300">production</code>, FBR submissions are mocked — no real API calls are made. Invoice numbers are prefixed with <code className="text-slate-300">SANDBOX-</code>. Set <code className="text-slate-300">NODE_ENV=production</code> + valid FBR credentials to go live.</div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ════════════════════════════════════════════════════════════════
// APP
// ════════════════════════════════════════════════════════════════
export default function App({onLogout}:{onLogout?:()=>void}={}){
  const [loggedIn,setLoggedIn]=useState(()=>!!localStorage.getItem("accessToken"));
  const [page,setPage]=useState("dashboard");const [col,setCol]=useState(false);const [selC,setSelC]=useState(null);const [mobileMenu,setMobileMenu]=useState(false);const [wa,setWa]=useState(false);const [showWA,setShowWA]=useState(false);
  useEffect(()=>{
    const check=()=>api.whatsapp.status().then(d=>{setWa(d?.waha?.status==="WORKING"||!!(d?.meta?.configured));}).catch(()=>{});
    check();
    const iv=setInterval(check,15000);
    return()=>clearInterval(iv);
  },[]);
  const doLogout=()=>{localStorage.removeItem("accessToken");localStorage.removeItem("userRole");onLogout?.();setLoggedIn(false);};
  if(!loggedIn)return <LoginPage onLogin={()=>setLoggedIn(true)}/>;
  const nav=p=>{setPage(p);if(p!=="profile"&&p!=="campaign-builder"&&p!=="automation-builder")setSelC(null);setMobileMenu(false);};
  const render=()=>{switch(page){
    case"dashboard":return<DashboardPage setPage={nav}/>;
    case"customers":return<CustomersPage onSelect={c=>{setSelC(c);setPage("profile");}}/>;
    case"profile":return selC?<CustomerProfile customer={selC} onBack={()=>nav("customers")} onMsg={c=>{setSelC(c);setPage("messages");}}/>:<CustomersPage onSelect={c=>{setSelC(c);setPage("profile");}}/>;
    case"pos":return<POSPage/>;
    case"messages":return<MessagesPage onConnect={()=>setPage("settings")}/>;
    case"campaigns":return<CampaignsPage onBuilder={()=>setPage("campaign-builder")}/>;
    case"campaign-builder":return<CampaignBuilderPage onBack={()=>setPage("campaigns")}/>;
    case"automations":return<AutomationsPage onBuilder={()=>setPage("automation-builder")}/>;
    case"automation-builder":return<AutomationBuilderPage onBack={()=>setPage("automations")}/>;
    case"loyalty":return<LoyaltyPage/>;
    case"datahub":return<DataHubPage/>;
    case"ai":return<AIPage/>;
    case"analytics":return<AnalyticsPage/>;
    case"settings":return<SettingsPage wa={wa} onConnect={()=>{}}/>;
    default:return<DashboardPage setPage={nav}/>;
  }};
  // Bottom nav items (5 most important)
  const BOT_NAV=[
    {id:"dashboard",icon:LayoutDashboard,label:"Home"},
    {id:"customers",icon:Users,label:"Customers"},
    {id:"messages",icon:MessageSquare,label:"Messages"},
    {id:"campaigns",icon:Zap,label:"Campaigns"},
    {id:"settings",icon:Settings,label:"Settings"},
  ];
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
        *{box-sizing:border-box}
        ::-webkit-scrollbar{width:4px;height:4px}
        ::-webkit-scrollbar-track{background:transparent}
        ::-webkit-scrollbar-thumb{background:rgba(139,92,246,0.35);border-radius:4px}
        ::-webkit-scrollbar-thumb:hover{background:rgba(139,92,246,0.6)}
        .gc{position:relative;overflow:hidden}
        .gc::before{content:'';position:absolute;top:0;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent,rgba(255,255,255,0.6),transparent);z-index:1;pointer-events:none}
        .gc::after{content:'';position:absolute;top:0;left:0;width:1px;height:100%;background:linear-gradient(180deg,rgba(255,255,255,0.6),transparent,rgba(255,255,255,0.15));z-index:1;pointer-events:none}
      `}</style>
      {showWA&&<MetaWizard onDone={()=>{setWa(true);setShowWA(false);setPage("messages");}} onClose={()=>setShowWA(false)}/>}
      {/* Desktop sidebar */}
      <div className="hidden md:block"><Sidebar page={page} setPage={nav} col={col} setCol={setCol} onLogout={doLogout} wa={wa}/></div>
      {/* Mobile top bar */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-4 py-3" style={{background:"rgba(8,6,18,0.95)",backdropFilter:"blur(20px)",borderBottom:"1px solid rgba(255,255,255,0.06)"}}>
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{background:"linear-gradient(135deg,#8b5cf6,#06b6d4)"}}><span className="text-white font-bold text-xs">L</span></div>
          <span className="text-white font-bold text-sm">Loyable</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="w-2 h-2 rounded-full" style={{background:wa?"#22c55e":"#6b7280"}}/>
          <span className="text-xs text-slate-400">{wa?"Connected":"Disconnected"}</span>
        </div>
      </div>
      {/* Main content */}
      <main className={`relative z-10 transition-all duration-300 ${col?"md:ml-[72px]":"md:ml-[240px]"} pt-14 md:pt-0 pb-20 md:pb-0`}>
        <div className="p-4 md:p-6 max-w-6xl">{render()}</div>
      </main>
      {/* Mobile bottom navigation */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 flex items-center" style={{background:"rgba(8,6,18,0.97)",backdropFilter:"blur(24px)",borderTop:"1px solid rgba(255,255,255,0.07)"}}>
        {BOT_NAV.map(it=>{
          const active=page===it.id||(it.id==="customers"&&(page==="profile"));
          return(
            <button key={it.id} onClick={()=>nav(it.id)} className="flex-1 flex flex-col items-center gap-1 py-3 transition-all" style={{color:active?"#8b5cf6":"#64748b"}}>
              <it.icon size={20} strokeWidth={active?2.5:1.8}/>
              <span className="text-[10px] font-medium">{it.label}</span>
              {active&&<div className="absolute top-0 w-8 h-[2px] rounded-b-full" style={{background:"#8b5cf6"}}/>}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
