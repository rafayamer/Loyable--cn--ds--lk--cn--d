import { useState, useEffect, useRef, useCallback } from "react";
import { AreaChart, Area, BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ZAxis } from "recharts";
import { Users, BarChart3, MessageSquare, Zap, Settings, LogOut, ChevronRight, Search, Plus, ArrowUpRight, ArrowDownRight, Eye, Send, CheckCheck, Clock, Star, Crown, UserPlus, UserMinus, Gift, TrendingUp, Bell, Menu, X, ChevronLeft, Mail, Phone, Building, Globe, CreditCard, Shield, Palette, Play, Edit, Target, Heart, Check, LayoutDashboard, Image, Paperclip, FileText, ArrowLeft, RefreshCw, CircleCheck, Info, WifiOff, Database, Brain, Activity, AlertTriangle, Table, Terminal, Layers, Download, Wifi, Tag, Link, Type, MousePointer, Cpu, Award, Repeat, RotateCcw, Sliders, Gift as GiftIcon, Star as StarIcon, Zap as ZapIcon, ChevronDown, ChevronUp, Hash, DollarSign, ShoppingBag, MoreVertical, Filter, Copy, Trash2, Smartphone, Lock } from "lucide-react";

// ════════════════════════════════════════════════════════════════
// SCHEMA ENUMS (mirrors Prisma schema)
// ════════════════════════════════════════════════════════════════
const SEG_COLORS = { NEW:"#3b82f6", LOYAL:"#22c55e", VIP:"#f59e0b", AT_RISK:"#ef4444", LOST:"#6b7280", BIG_SPENDER:"#06b6d4", COUPON_HUNTER:"#ec4899" };
const STATUS_COLORS = { PENDING:"#f59e0b", QUEUED:"#3b82f6", SENT:"#22c55e", DELIVERED:"#10b981", READ:"#06b6d4", FAILED:"#ef4444", CONSENT_REVOKED:"#6b7280", DROPPED_COOLDOWN:"#8b5cf6", DROPPED_QUOTA:"#f97316" };
const ROLE_COLORS = { PLATFORM_ADMINISTRATOR:"#ef4444", TENANT_OWNER:"#f59e0b", BRANCH_MANAGER:"#8b5cf6", CASHIER:"#3b82f6", MARKETING_STAFF:"#22c55e", CUSTOMER:"#06b6d4" };
const TIER_COLORS = { FREE:"#6b7280", STARTER:"#3b82f6", GROWTH:"#22c55e", PROFESSIONAL:"#8b5cf6", ENTERPRISE:"#f59e0b" };
const C = { primary:"#8b5cf6", accent:"#06b6d4", green:"#22c55e", red:"#ef4444", amber:"#f59e0b", pink:"#ec4899", blue:"#3b82f6" };

// ════════════════════════════════════════════════════════════════
// MOCK DATA
// ════════════════════════════════════════════════════════════════
const customers = [
  { id:1,name:"Sarah Mitchell",phone:"+447911123456",email:"sarah@email.com",visits:24,lastVisit:"2 days ago",spent:2450,avg:102,segment:"VIP",status:"Active",churnRisk:8,clv:4200,points:1240,tier:"Gold",referralCode:"sarah-m7x2" },
  { id:2,name:"James Cooper",phone:"+447922654321",email:"james@email.com",visits:15,lastVisit:"5 days ago",spent:1280,avg:85,segment:"LOYAL",status:"Active",churnRisk:15,clv:2800,points:680,tier:"Silver",referralCode:"james-c4k9" },
  { id:3,name:"Emma Wilson",phone:"+447933111222",email:"emma@email.com",visits:3,lastVisit:"45 days ago",spent:180,avg:60,segment:"AT_RISK",status:"At Risk",churnRisk:82,clv:350,points:90,tier:"Bronze",referralCode:"emma-w3r1" },
  { id:4,name:"Michael Brown",phone:"+447944333444",email:"michael@email.com",visits:1,lastVisit:"Today",spent:45,avg:45,segment:"NEW",status:"Active",churnRisk:45,clv:180,points:0,tier:"Bronze",referralCode:"michael-b8t5" },
  { id:5,name:"Olivia Taylor",phone:"+447955555666",email:"olivia@email.com",visits:32,lastVisit:"1 day ago",spent:4100,avg:128,segment:"BIG_SPENDER",status:"Active",churnRisk:5,clv:6500,points:2050,tier:"VIP",referralCode:"olivia-t2p6" },
  { id:6,name:"David Johnson",phone:"+447966777888",email:"david@email.com",visits:8,lastVisit:"12 days ago",spent:640,avg:80,segment:"AT_RISK",status:"At Risk",churnRisk:58,clv:900,points:320,tier:"Bronze",referralCode:"david-j9m3" },
  { id:7,name:"Sophie Davis",phone:"+447977999000",email:"sophie@email.com",visits:0,lastVisit:"90 days ago",spent:95,avg:95,segment:"LOST",status:"Churned",churnRisk:96,clv:95,points:0,tier:"Bronze",referralCode:"sophie-d5n7" },
  { id:8,name:"Robert Garcia",phone:"+447988112233",email:"robert@email.com",visits:18,lastVisit:"3 days ago",spent:1890,avg:105,segment:"LOYAL",status:"Active",churnRisk:12,clv:3200,points:945,tier:"Silver",referralCode:"robert-g1q4" },
  { id:9,name:"Amina Khan",phone:"+447911445566",email:"amina@email.com",visits:11,lastVisit:"8 days ago",spent:510,avg:85,segment:"COUPON_HUNTER",status:"Active",churnRisk:25,clv:1100,points:255,tier:"Bronze",referralCode:"amina-k6w8" },
  { id:10,name:"Liam O'Brien",phone:"+447922778899",email:"liam@email.com",visits:2,lastVisit:"60 days ago",spent:130,avg:65,segment:"LOST",status:"Churned",churnRisk:91,clv:200,points:65,tier:"Bronze",referralCode:"liam-o0z2" },
];
const msgQueue = [
  { id:1,name:"Emma Wilson",phone:"+447933111222",template:"we_miss_you_template",status:"PENDING",segment:"AT_RISK",waId:"",time:"2 min ago" },
  { id:2,name:"David Johnson",phone:"+447966777888",template:"we_miss_you_template",status:"QUEUED",segment:"AT_RISK",waId:"",time:"5 min ago" },
  { id:3,name:"Sarah Mitchell",phone:"+447911123456",template:"thank_you_template",status:"SENT",segment:"VIP",waId:"wamid.HBgL...",time:"12 min ago" },
  { id:4,name:"Robert Garcia",phone:"+447988112233",template:"thank_you_template",status:"DELIVERED",segment:"LOYAL",waId:"wamid.HBgM...",time:"18 min ago" },
  { id:5,name:"Olivia Taylor",phone:"+447955555666",template:"vip_reward_template",status:"READ",segment:"BIG_SPENDER",waId:"wamid.HBgN...",time:"32 min ago" },
  { id:6,name:"Sophie Davis",phone:"+447977999000",template:"we_miss_you_template",status:"FAILED",segment:"LOST",waId:"",time:"1 hr ago",error:"Not on WhatsApp" },
  { id:7,name:"Amina Khan",phone:"+447911445566",template:"win_back_campaign",status:"CONSENT_REVOKED",segment:"COUPON_HUNTER",waId:"",time:"2 hrs ago" },
  { id:8,name:"Liam O'Brien",phone:"+447922778899",template:"promo_offer",status:"DROPPED_COOLDOWN",segment:"LOST",waId:"",time:"3 hrs ago" },
  { id:9,name:"Michael Brown",phone:"+447944333444",template:"promotional_blast",status:"DROPPED_QUOTA",segment:"NEW",waId:"",time:"4 hrs ago" },
];
const visitData=[{day:"Mon",v:45,r:1250},{day:"Tue",v:52,r:1480},{day:"Wed",v:38,r:1100},{day:"Thu",v:65,r:1820},{day:"Fri",v:78,r:2150},{day:"Sat",v:92,r:2680},{day:"Sun",v:61,r:1750}];
const growthData=[{m:"Jan",c:820,ret:680},{m:"Feb",c:950,ret:790},{m:"Mar",c:1100,ret:920},{m:"Apr",c:1280,ret:1080},{m:"May",c:1450,ret:1250},{m:"Jun",c:1680,ret:1420}];
const segData=[{name:"LOYAL",value:420,color:"#22c55e"},{name:"VIP",value:85,color:"#f59e0b"},{name:"AT_RISK",value:290,color:"#ef4444"},{name:"NEW",value:310,color:"#3b82f6"},{name:"BIG_SPENDER",value:145,color:"#06b6d4"},{name:"COUPON_HUNTER",value:235,color:"#ec4899"},{name:"LOST",value:195,color:"#6b7280"}];
const msgPerf=[{w:"W1",sent:450,del:430,read:320},{w:"W2",sent:520,del:500,read:380},{w:"W3",sent:480,del:460,read:350},{w:"W4",sent:610,del:585,read:440}];
const forecastData=[{m:"Jan",actual:8200},{m:"Feb",actual:9500},{m:"Mar",actual:11000},{m:"Apr",actual:12800},{m:"May",actual:14500},{m:"Jun",actual:12230},{m:"Jul",pred:14200},{m:"Aug",pred:15800},{m:"Sep",pred:17100},{m:"Oct",pred:18500}];
const pointsLedger=[
  {id:1,type:"CREDIT",points:102,balance:1240,reason:"VISIT_ACCRUAL",ref:"visit_abc",date:"Jun 15"},
  {id:2,type:"CREDIT",points:50,balance:1138,reason:"REFERRAL_CREDIT",ref:"james-c4k9",date:"Jun 10"},
  {id:3,type:"DEBIT",points:200,balance:1088,reason:"REDEMPTION",ref:"coupon_xyz",date:"Jun 8"},
  {id:4,type:"CREDIT",points:128,balance:1288,reason:"VISIT_ACCRUAL",ref:"visit_def",date:"Jun 2"},
  {id:5,type:"CREDIT",points:100,balance:1160,reason:"TIER_BONUS",ref:"gold_upgrade",date:"May 28"},
];
const chatHistories = {
  1:[{from:"business",text:"Sarah, as our VIP enjoy 20% off this weekend! 👑",time:"Jun 10",status:"read"},{from:"customer",text:"Thank you!! I'll come by Saturday",time:"Jun 10"},{from:"business",text:"Thanks for visiting today, Sarah! ⭐",time:"Jun 15",status:"delivered"}],
  2:[{from:"business",text:"James, 15% off your next visit. ❤️",time:"May 20",status:"read"},{from:"customer",text:"Thanks! Coming tomorrow",time:"May 20"}],
  3:[{from:"business",text:"Emma, we miss you! 20% off this week. 😊",time:"May 1",status:"delivered"}],
};

// ════════════════════════════════════════════════════════════════
// MICRO COMPONENTS
// ════════════════════════════════════════════════════════════════
const Badge=({children,color,size="sm"})=><span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-medium ${size==="xs"?"text-xs":"text-xs"}`} style={{background:color+"22",color}}>{children}</span>;
const KPI=({icon:Icon,label,value,change,positive,color,sub})=>(
  <div className="rounded-xl p-4" style={{background:"rgba(30,30,45,0.8)",border:"1px solid rgba(255,255,255,0.06)"}}>
    <div className="flex items-center justify-between mb-3"><div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{background:color+"18"}}><Icon size={18} style={{color}}/></div>{change&&<span className={`text-xs font-medium flex items-center gap-0.5 ${positive?"text-green-400":"text-red-400"}`}>{positive?<ArrowUpRight size={12}/>:<ArrowDownRight size={12}/>}{change}</span>}</div>
    <div className="text-2xl font-bold text-white mb-0.5">{value}</div>
    <div className="text-xs text-slate-400">{label}</div>
    {sub&&<div className="text-xs text-slate-600 mt-0.5">{sub}</div>}
  </div>
);
const WAIcon=({size=18,className=""})=><svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>;
const card="rounded-xl p-4"+" style={{background:\"rgba(30,30,45,0.8)\",border:\"1px solid rgba(255,255,255,0.06)\"}}";
const inp="w-full px-3 py-2.5 rounded-lg text-sm text-white placeholder-slate-500 outline-none focus:ring-2 focus:ring-violet-500/50";
const btn="px-4 py-2 rounded-lg text-xs font-medium text-white";

// ════════════════════════════════════════════════════════════════
// SIDEBAR
// ════════════════════════════════════════════════════════════════
const NAV=[{id:"dashboard",icon:LayoutDashboard,label:"Dashboard"},{id:"customers",icon:Users,label:"Customers"},{id:"messages",icon:MessageSquare,label:"Messages"},{id:"campaigns",icon:Send,label:"Campaigns"},{id:"automations",icon:Zap,label:"Automations"},{id:"loyalty",icon:Award,label:"Loyalty & Points"},{id:"datahub",icon:Database,label:"Data Hub"},{id:"ai",icon:Brain,label:"AI Insights"},{id:"analytics",icon:BarChart3,label:"Analytics"},{id:"settings",icon:Settings,label:"Settings"}];
const Sidebar=({page,setPage,col,setCol,onLogout,wa})=>(
  <div className={`fixed left-0 top-0 h-full z-50 flex flex-col transition-all duration-300 ${col?"w-16":"w-56"}`} style={{background:"linear-gradient(180deg,#0f0a1e,#1a1130)",borderRight:"1px solid rgba(255,255,255,0.06)"}}>
    <div className="flex items-center gap-2.5 p-4 mb-1">
      <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{background:"linear-gradient(135deg,#8b5cf6,#06b6d4)"}}><span className="text-white font-bold text-sm">C</span></div>
      {!col&&<span className="text-white font-bold text-sm tracking-tight">Cube Retain</span>}
      <button onClick={()=>setCol(!col)} className="ml-auto text-slate-500 hover:text-white">{col?<ChevronRight size={16}/>:<ChevronLeft size={16}/>}</button>
    </div>
    {!col&&<div className="mx-3 mb-2 px-3 py-1.5 rounded-lg" style={{background:"rgba(34,197,94,0.08)",border:"1px solid rgba(34,197,94,0.15)"}}><div className="flex items-center gap-2"><div className="w-1.5 h-1.5 rounded-full bg-green-400"/><span className="text-xs text-green-400">The Coffee House</span></div></div>}
    <nav className="flex-1 px-2 space-y-0.5 overflow-y-auto">{NAV.map(it=>(
      <button key={it.id} onClick={()=>setPage(it.id)} className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all ${page===it.id?"text-white":"text-slate-400 hover:text-slate-200 hover:bg-white/5"}`} style={page===it.id?{background:"linear-gradient(135deg,rgba(139,92,246,0.2),rgba(6,182,212,0.1))"}:{}}>
        <it.icon size={17}/>{!col&&<span className="flex-1 text-left text-xs">{it.label}</span>}
        {!col&&it.id==="messages"&&wa&&<div className="w-1.5 h-1.5 rounded-full bg-green-400"/>}
        {!col&&it.id==="ai"&&<Badge color={C.accent} size="xs">ML</Badge>}
      </button>
    ))}</nav>
    <div className="p-2 mb-2"><button onClick={onLogout} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-slate-400 hover:text-red-400 transition-all"><LogOut size={17}/>{!col&&<span className="text-xs">Logout</span>}</button></div>
  </div>
);

// ════════════════════════════════════════════════════════════════
// LOGIN
// ════════════════════════════════════════════════════════════════
const LoginPage=({onLogin})=>{
  const [e,setE]=useState("");const [p,setP]=useState("");
  return(
    <div className="min-h-screen flex items-center justify-center p-4" style={{background:"linear-gradient(135deg,#0a0615,#1a0f2e,#0d1525)"}}>
      <div className="w-full max-w-sm">
        <div className="text-center mb-8"><div className="w-16 h-16 rounded-2xl mx-auto mb-4 flex items-center justify-center" style={{background:"linear-gradient(135deg,#8b5cf6,#06b6d4)"}}><span className="text-white font-bold text-2xl">C</span></div><h1 className="text-2xl font-bold text-white">Cube Retain CRM</h1><p className="text-slate-400 text-sm mt-1">Multi-tenant customer retention platform</p></div>
        <div className="rounded-2xl p-6" style={{background:"rgba(20,15,35,0.9)",border:"1px solid rgba(255,255,255,0.08)"}}>
          <div className="space-y-3 mb-4">
            <div><label className="text-xs text-slate-400 mb-1 block">Business email</label><input value={e} onChange={ev=>setE(ev.target.value)} type="email" placeholder="owner@coffeehouse.com" className={inp} style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.08)"}}/></div>
            <div><label className="text-xs text-slate-400 mb-1 block">Password</label><input value={p} onChange={ev=>setP(ev.target.value)} type="password" placeholder="••••••••" className={inp} style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.08)"}}/></div>
          </div>
          <div className="flex justify-between items-center mb-4"><label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer"><input type="checkbox" className="rounded"/>Remember device</label><button className="text-xs text-violet-400 hover:text-violet-300">Forgot password?</button></div>
          <button onClick={onLogin} className="w-full py-2.5 rounded-lg text-sm font-semibold text-white mb-3" style={{background:"linear-gradient(135deg,#8b5cf6,#7c3aed)"}}>Sign In</button>
          <div className="flex items-center gap-3 mb-3"><div className="flex-1 h-px bg-white/10"/><span className="text-xs text-slate-500">or continue with</span><div className="flex-1 h-px bg-white/10"/></div>
          <div className="grid grid-cols-2 gap-2">
            <button className="flex items-center justify-center gap-2 py-2 rounded-lg text-xs text-slate-300 hover:bg-white/5 transition-all" style={{border:"1px solid rgba(255,255,255,0.08)"}}>
              <svg width="14" height="14" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>Google
            </button>
            <button className="flex items-center justify-center gap-2 py-2 rounded-lg text-xs text-slate-300 hover:bg-white/5 transition-all" style={{border:"1px solid rgba(255,255,255,0.08)"}}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="#00a4ef"><path d="M11.4 24H0V12.6h11.4V24zM24 24H12.6V12.6H24V24zM11.4 11.4H0V0h11.4v11.4zM24 11.4H12.6V0H24v11.4z"/></svg>Microsoft
            </button>
          </div>
          <div className="mt-3 p-2 rounded-lg" style={{background:"rgba(139,92,246,0.08)",border:"1px solid rgba(139,92,246,0.15)"}}><p className="text-xs text-slate-500 text-center">Protected by Argon2id · JWT + HTTP-only cookies · Rate limited</p></div>
        </div>
      </div>
    </div>
  );
};

// ════════════════════════════════════════════════════════════════
// DASHBOARD
// ════════════════════════════════════════════════════════════════
const DashboardPage=({setPage})=>{
  const queueSummary={pending:msgQueue.filter(m=>m.status==="PENDING").length,queued:msgQueue.filter(m=>m.status==="QUEUED").length,sent:msgQueue.filter(m=>m.status==="SENT"||m.status==="DELIVERED"||m.status==="READ").length,failed:msgQueue.filter(m=>m.status==="FAILED").length,dropped:msgQueue.filter(m=>m.status.startsWith("DROPPED")||m.status==="CONSENT_REVOKED").length};
  return(
    <div className="space-y-5">
      <div className="flex items-center justify-between"><div><h1 className="text-xl font-bold text-white">Dashboard</h1><p className="text-xs text-slate-400 mt-0.5">The Coffee House · Jun 18, 2026</p></div><div className="flex items-center gap-2"><Badge color={C.green}>Live</Badge></div></div>
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <KPI icon={Users} label="Total Customers" value="1,680" change="+12.5%" positive color={C.primary}/>
        <KPI icon={Eye} label="Visits This Week" value="431" change="+8.2%" positive color={C.accent}/>
        <KPI icon={TrendingUp} label="Revenue" value="£12,230" change="+15.3%" positive color={C.green}/>
        <KPI icon={Send} label="Messages Sent" value="2,060" change="+22%" positive color={C.blue}/>
        <KPI icon={AlertTriangle} label="At Risk" value="290" change="-5 this week" positive color={C.red}/>
        <KPI icon={Heart} label="Retention Rate" value="68.4%" change="+3.1%" positive color={C.pink}/>
      </div>
      {/* BullMQ Queue Status */}
      <div className="rounded-xl p-4" style={{background:"rgba(30,30,45,0.8)",border:"1px solid rgba(255,255,255,0.06)"}}>
        <div className="flex items-center justify-between mb-3"><h3 className="text-sm font-semibold text-white flex items-center gap-2"><Database size={14} className="text-violet-400"/>BullMQ Message Queue</h3><button onClick={()=>setPage("datahub")} className="text-xs text-violet-400 hover:text-violet-300">View all →</button></div>
        <div className="flex flex-wrap gap-2">{Object.entries(queueSummary).map(([k,v])=>{const c={pending:C.amber,queued:C.blue,sent:C.green,failed:C.red,dropped:"#6b7280"}[k];return(<div key={k} className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{background:c+"10",border:`1px solid ${c}25`}}><div className="w-2 h-2 rounded-full" style={{background:c}}/><span className="text-xs font-bold text-white">{v}</span><span className="text-xs text-slate-400 capitalize">{k}</span></div>);})}</div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-xl p-4" style={{background:"rgba(30,30,45,0.8)",border:"1px solid rgba(255,255,255,0.06)"}}>
          <h3 className="text-sm font-semibold text-white mb-3">Weekly Visits & Revenue</h3>
          <ResponsiveContainer width="100%" height={200}><AreaChart data={visitData}><defs><linearGradient id="gv2" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.3}/><stop offset="100%" stopColor="#8b5cf6" stopOpacity={0}/></linearGradient><linearGradient id="gr2" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#06b6d4" stopOpacity={0.3}/><stop offset="100%" stopColor="#06b6d4" stopOpacity={0}/></linearGradient></defs><CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)"/><XAxis dataKey="day" tick={{fill:"#64748b",fontSize:11}} axisLine={false} tickLine={false}/><YAxis tick={{fill:"#64748b",fontSize:11}} axisLine={false} tickLine={false}/><Tooltip contentStyle={{background:"#1e1e2d",border:"1px solid rgba(255,255,255,0.1)",borderRadius:8,fontSize:12,color:"#fff"}}/><Area type="monotone" dataKey="v" stroke="#8b5cf6" fill="url(#gv2)" strokeWidth={2}/><Area type="monotone" dataKey="r" stroke="#06b6d4" fill="url(#gr2)" strokeWidth={2}/></AreaChart></ResponsiveContainer>
        </div>
        <div className="rounded-xl p-4" style={{background:"rgba(30,30,45,0.8)",border:"1px solid rgba(255,255,255,0.06)"}}>
          <div className="flex items-center justify-between mb-3"><h3 className="text-sm font-semibold text-white">Churn Risk — Top 4</h3><button onClick={()=>setPage("ai")} className="text-xs text-violet-400">Full AI view →</button></div>
          <div className="space-y-2">{customers.filter(c=>c.churnRisk>50).sort((a,b)=>b.churnRisk-a.churnRisk).slice(0,4).map((c,i)=>(
            <div key={i} className="flex items-center gap-3 p-2 rounded-lg" style={{background:"rgba(255,255,255,0.02)"}}>
              <div className="w-8 h-8 rounded-full flex items-center justify-center text-white font-semibold text-xs flex-shrink-0" style={{background:`linear-gradient(135deg,${SEG_COLORS[c.segment]||"#8b5cf6"},${SEG_COLORS[c.segment]||"#8b5cf6"}88)`}}>{c.name.split(" ").map(n=>n[0]).join("")}</div>
              <div className="flex-1 min-w-0"><div className="text-xs text-white font-medium truncate">{c.name}</div><div className="text-xs text-slate-500">{c.segment} · {c.lastVisit}</div></div>
              <div className="text-right"><div className={`text-sm font-bold ${c.churnRisk>75?"text-red-400":c.churnRisk>50?"text-amber-400":"text-green-400"}`}>{c.churnRisk}%</div><div className="text-xs text-slate-500">risk</div></div>
            </div>
          ))}</div>
        </div>
      </div>
    </div>
  );
};

// ════════════════════════════════════════════════════════════════
// CUSTOMERS
// ════════════════════════════════════════════════════════════════
const CustomersPage=({onSelect})=>{
  const [q,setQ]=useState("");const [seg,setSeg]=useState("ALL");
  const filtered=customers.filter(c=>(seg==="ALL"||c.segment===seg)&&c.name.toLowerCase().includes(q.toLowerCase()));
  const segs=["ALL","NEW","LOYAL","VIP","AT_RISK","BIG_SPENDER","COUPON_HUNTER","LOST"];
  return(
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2"><div><h1 className="text-xl font-bold text-white">Customers</h1><p className="text-xs text-slate-400 mt-0.5">{customers.length} total · 7 segments from Prisma schema</p></div><button className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium text-white" style={{background:"linear-gradient(135deg,#8b5cf6,#7c3aed)"}}><Plus size={14}/>Add Customer</button></div>
      <div className="flex gap-2 flex-wrap">
        <div className="relative flex-1 min-w-48"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"/><input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search name or phone..." className="w-full pl-9 pr-3 py-2 rounded-lg text-xs text-white placeholder-slate-500 outline-none" style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.08)"}}/></div>
        <div className="flex gap-1 flex-wrap">{segs.map(s=><button key={s} onClick={()=>setSeg(s)} className={`px-2 py-1.5 rounded-lg text-xs transition-all ${seg===s?"text-white":"text-slate-400"}`} style={seg===s?{background:SEG_COLORS[s]||"rgba(139,92,246,0.2)"}:{background:"rgba(255,255,255,0.03)"}}>{s}</button>)}</div>
      </div>
      <div className="rounded-xl overflow-hidden" style={{background:"rgba(30,30,45,0.8)",border:"1px solid rgba(255,255,255,0.06)"}}>
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

const CustomerProfile=({customer:c,onBack,onMsg})=>(
  <div className="space-y-4">
    <button onClick={onBack} className="flex items-center gap-1 text-xs text-slate-400 hover:text-white"><ChevronLeft size={14}/>Back</button>
    <div className="rounded-xl p-5" style={{background:"rgba(30,30,45,0.8)",border:"1px solid rgba(255,255,255,0.06)"}}>
      <div className="flex items-start gap-4 flex-wrap">
        <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-white font-bold text-lg" style={{background:`linear-gradient(135deg,${SEG_COLORS[c.segment]||"#8b5cf6"},${SEG_COLORS[c.segment]||"#8b5cf6"}88)`}}>{c.name.split(" ").map(n=>n[0]).join("")}</div>
        <div className="flex-1 min-w-48"><div className="flex items-center gap-2 flex-wrap"><h2 className="text-lg font-bold text-white">{c.name}</h2><Badge color={SEG_COLORS[c.segment]||"#8b5cf6"}>{c.segment}</Badge><Badge color={TIER_COLORS[c.tier]||"#6b7280"}>{c.tier}</Badge></div><div className="text-xs text-slate-400 mt-1 flex flex-wrap gap-x-4"><span className="flex items-center gap-1"><Phone size={10}/>{c.phone}</span><span className="flex items-center gap-1"><Mail size={10}/>{c.email}</span></div><div className="mt-2 flex items-center gap-2 text-xs text-slate-500"><Hash size={10}/><span className="font-mono text-violet-300">{c.referralCode}</span><button className="text-slate-500 hover:text-slate-300"><Copy size={10}/></button></div></div>
        <button onClick={()=>onMsg(c)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-white font-medium" style={{background:"linear-gradient(135deg,#25D366,#128C7E)"}}><WAIcon size={12} className="text-white"/>WhatsApp</button>
      </div>
    </div>
    <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">{[{l:"Visits",v:c.visits},{l:"Total Spent",v:`£${c.spent.toLocaleString()}`},{l:"Avg. Order",v:`£${c.avg}`},{l:"Churn Risk",v:`${c.churnRisk}%`,col:c.churnRisk>50?"#ef4444":"#22c55e"},{l:"Points Balance",v:c.points.toLocaleString()}].map((s,i)=><div key={i} className="rounded-xl p-3 text-center" style={{background:"rgba(30,30,45,0.8)",border:"1px solid rgba(255,255,255,0.06)"}}><div className="text-lg font-bold" style={{color:s.col||"white"}}>{s.v}</div><div className="text-xs text-slate-400">{s.l}</div></div>)}</div>
    <div className="rounded-xl p-4" style={{background:"rgba(30,30,45,0.8)",border:"1px solid rgba(255,255,255,0.06)"}}>
      <h3 className="text-sm font-semibold text-white mb-3">Points Ledger (Immutable Append-Only)</h3>
      <div className="space-y-1">{pointsLedger.map(l=><div key={l.id} className="flex items-center gap-3 py-2 px-3 rounded-lg" style={{background:"rgba(255,255,255,0.02)"}}><div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs ${l.type==="CREDIT"?"bg-green-500/20 text-green-400":"bg-red-500/20 text-red-400"}`}>{l.type==="CREDIT"?"+":"-"}</div><div className="flex-1 min-w-0"><div className="text-xs text-white font-medium">{l.reason}</div><div className="text-xs text-slate-500 font-mono">{l.ref}</div></div><div className="text-right"><div className={`text-xs font-bold ${l.type==="CREDIT"?"text-green-400":"text-red-400"}`}>{l.type==="CREDIT"?"+":"-"}{l.points} pts</div><div className="text-xs text-slate-500">{l.balance} total</div></div><div className="text-xs text-slate-500 w-12 text-right">{l.date}</div></div>)}</div>
    </div>
  </div>
);

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

const MessagesPage=({wa,onConnect})=>{
  const [sel,setSel]=useState(null);const [msg,setMsg]=useState("");const [chats,setChats]=useState(chatHistories);const chatEnd=useRef(null);
  useEffect(()=>{chatEnd.current?.scrollIntoView({behavior:"smooth"});},[sel,chats]);
  const chatCs=customers.filter(c=>chats[c.id]&&chats[c.id].length>0);
  const send=t=>{if(!t.trim()||!sel)return;setChats(p=>({...p,[sel.id]:[...(p[sel.id]||[]),{from:"business",text:t,time:"Just now",status:"sent"}]}));setMsg("");};
  if(!wa)return(
    <div className="space-y-4"><div><h1 className="text-xl font-bold text-white">Messages</h1></div>
      <div className="rounded-2xl p-8 flex flex-col items-center justify-center text-center" style={{background:"rgba(30,30,45,0.8)",border:"1px solid rgba(255,255,255,0.06)",minHeight:400}}>
        <div className="w-20 h-20 rounded-3xl flex items-center justify-center mb-4" style={{background:"rgba(37,211,102,0.1)"}}><WAIcon size={40} className="text-green-400"/></div>
        <h2 className="text-xl font-bold text-white mb-2">Connect WhatsApp Business</h2><p className="text-sm text-slate-400 max-w-sm mb-6">All messages route through BullMQ — rate-limited, cooldown-checked, GDPR-compliant.</p>
        <button onClick={onConnect} className="flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-semibold text-white" style={{background:"linear-gradient(135deg,#25D366,#128C7E)"}}><WAIcon size={18} className="text-white"/>Connect Meta Account</button>
        <div className="flex flex-wrap justify-center gap-3 mt-4 text-xs text-slate-500">{["Meta Cloud API","WAHA Self-hosted","Consent checks","72h cooldown","GDPR opt-out"].map((f,i)=><span key={i} className="flex items-center gap-1"><Check size={10} className="text-green-500"/>{f}</span>)}</div>
      </div></div>
  );
  return(
    <div className="space-y-4">
      <div className="flex items-center justify-between"><div><h1 className="text-xl font-bold text-white">Messages</h1><p className="text-xs text-slate-400 flex items-center gap-1.5 mt-0.5"><span className="w-2 h-2 rounded-full bg-green-400"/>Meta WhatsApp connected · BullMQ active</p></div></div>
      <div className="rounded-xl overflow-hidden flex" style={{background:"rgba(30,30,45,0.8)",border:"1px solid rgba(255,255,255,0.06)",height:"calc(100vh - 180px)",minHeight:480}}>
        <div className={`${sel?"hidden sm:flex":"flex"} flex-col w-full sm:w-64 border-r border-white/5 flex-shrink-0`}>
          <div className="flex-1 overflow-y-auto">{chatCs.map(c=>{const msgs=chats[c.id]||[];const last=msgs[msgs.length-1];return(
            <button key={c.id} onClick={()=>setSel(c)} className={`w-full flex items-center gap-3 p-3 text-left hover:bg-white/3 ${sel?.id===c.id?"bg-white/5":""}`} style={{borderBottom:"1px solid rgba(255,255,255,0.03)"}}>
              <div className="w-9 h-9 rounded-full flex items-center justify-center text-white font-semibold text-xs flex-shrink-0" style={{background:`linear-gradient(135deg,${SEG_COLORS[c.segment]||"#8b5cf6"},${SEG_COLORS[c.segment]||"#8b5cf6"}88)`}}>{c.name.split(" ").map(n=>n[0]).join("")}</div>
              <div className="flex-1 min-w-0"><div className="text-sm text-white font-medium truncate">{c.name}</div><div className="text-xs text-slate-400 truncate">{last?.text?.substring(0,35)}...</div></div>
            </button>);})}</div>
        </div>
        {sel?(<div className="flex-1 flex flex-col min-w-0">
          <div className="flex items-center gap-3 p-3 border-b border-white/5"><button onClick={()=>setSel(null)} className="sm:hidden text-slate-400"><ArrowLeft size={18}/></button><div className="w-8 h-8 rounded-full flex items-center justify-center text-white font-semibold text-xs flex-shrink-0" style={{background:`linear-gradient(135deg,${SEG_COLORS[sel.segment]||"#8b5cf6"},${SEG_COLORS[sel.segment]||"#8b5cf6"}88)`}}>{sel.name.split(" ").map(n=>n[0]).join("")}</div><div className="flex-1"><div className="text-sm text-white font-medium">{sel.name}</div><div className="text-xs text-slate-400">{sel.phone} · <Badge color={SEG_COLORS[sel.segment]||"#8b5cf6"}>{sel.segment}</Badge></div></div></div>
          <div className="flex-1 overflow-y-auto p-4 space-y-3" style={{background:"rgba(5,3,15,0.5)"}}>{(chats[sel.id]||[]).map((m,i)=><div key={i} className={`flex ${m.from==="business"?"justify-end":"justify-start"}`}><div className={`max-w-[80%] rounded-2xl px-3 py-2 ${m.from==="business"?"rounded-br-sm":"rounded-bl-sm"}`} style={{background:m.from==="business"?"#005c4b":"rgba(255,255,255,0.08)"}}><p className="text-xs text-white leading-relaxed">{m.text}</p><div className="flex items-center gap-1 mt-1 justify-end"><span className="text-xs text-white/40">{m.time}</span>{m.from==="business"&&<>{m.status==="read"?<CheckCheck size={11} className="text-blue-400"/>:<CheckCheck size={11} className="text-white/40"/>}</>}</div></div></div>)}<div ref={chatEnd}/></div>
          <div className="p-3 border-t border-white/5"><div className="flex items-center gap-2"><input value={msg} onChange={e=>setMsg(e.target.value)} onKeyDown={e=>e.key==="Enter"&&send(msg)} placeholder="Type a message..." className="flex-1 px-3 py-2 rounded-lg text-xs text-white placeholder-slate-500 outline-none" style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.08)"}}/><button onClick={()=>send(msg)} disabled={!msg.trim()} className="p-2 rounded-lg text-white disabled:opacity-30" style={{background:"linear-gradient(135deg,#25D366,#128C7E)"}}><Send size={15}/></button></div></div>
        </div>):(<div className="flex-1 hidden sm:flex items-center justify-center"><p className="text-sm text-slate-500">Select a conversation</p></div>)}
      </div>
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
  const runAI=()=>{setAiLoading(true);setTimeout(()=>{const nb={id:`b${Date.now()}`,type:"TEXT",content:"🎉 Special offer just for you! Swing by The Coffee House this week and enjoy 15% off with code LOYALTY15. Your support means the world to us! See you soon ☕"};setBlocks(p=>[...p,nb]);setAiLoading(false);setAiPrompt("");},2000);};
  return(
    <div className="space-y-4">
      <div className="flex items-center gap-3"><button onClick={onBack} className="text-slate-400 hover:text-white"><ChevronLeft size={20}/></button><div><h1 className="text-xl font-bold text-white">Campaign Builder</h1><p className="text-xs text-slate-400 mt-0.5">Drag blocks into the phone preview · layoutJson saved to Prisma Campaign model</p></div></div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Block Palette */}
        <div className="rounded-xl p-4" style={{background:"rgba(30,30,45,0.8)",border:"1px solid rgba(255,255,255,0.06)"}}>
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
        <div className="rounded-xl p-4" style={{background:"rgba(30,30,45,0.8)",border:"1px solid rgba(255,255,255,0.06)"}}>
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
  const save=()=>{setSaved(true);setTimeout(()=>setSaved(false),2500);};
  return(
    <div className="space-y-4">
      <div className="flex items-center gap-3"><button onClick={onBack} className="text-slate-400 hover:text-white"><ChevronLeft size={20}/></button><div><h1 className="text-xl font-bold text-white">Automation Builder</h1><p className="text-xs text-slate-400 mt-0.5">Visual reactflow canvas · compiles to graphJson + compiledJson stored in Prisma</p></div></div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Trigger */}
        <div className="rounded-xl p-4" style={{background:"rgba(30,30,45,0.8)",border:"1px solid rgba(255,255,255,0.06)"}}>
          <div className="text-xs font-semibold text-cyan-400 mb-3 flex items-center gap-1.5"><div className="w-1.5 h-1.5 rounded-full bg-cyan-400"/>TRIGGER NODE</div>
          <div className="space-y-2">{TRIGGERS.map(t=><button key={t.type} onClick={()=>setTrig(t.type)} className={`w-full flex items-center gap-3 p-3 rounded-xl text-left transition-all ${trig===t.type?"ring-2":"hover:bg-white/3"}`} style={trig===t.type?{background:t.color+"15",border:`1px solid ${t.color}35`,ringColor:t.color}:{background:"rgba(255,255,255,0.02)",border:"1px solid rgba(255,255,255,0.05)"}}>
            <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{background:t.color+"20"}}><t.icon size={16} style={{color:t.color}}/></div><div className="flex-1"><div className="text-xs font-medium text-white">{t.label}</div><div className="text-xs text-slate-500">{t.desc}</div></div>{trig===t.type&&<CircleCheck size={16} style={{color:t.color}}/>}
          </button>)}</div>
        </div>
        {/* Visual Flow Canvas */}
        <div className="rounded-xl p-4" style={{background:"rgba(30,30,45,0.8)",border:"1px solid rgba(255,255,255,0.06)"}}>
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
        <div className="rounded-xl p-4 space-y-4" style={{background:"rgba(30,30,45,0.8)",border:"1px solid rgba(255,255,255,0.06)"}}>
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
  const [tiers,setTiers]=useState([{name:"Bronze",rank:1,visits:0,spend:0,color:"#cd7f32",perks:["Birthday 5% off"]},{name:"Silver",rank:2,visits:5,spend:100,color:"#c0c0c0",perks:["10% weekend discount","Priority queue"]},{name:"Gold",rank:3,visits:15,spend:500,color:"#ffd700",perks:["20% all orders","Free monthly item","Early access"]},{name:"VIP",rank:4,visits:30,spend:1000,color:"#b19cd9",perks:["25% always","Dedicated host","Free delivery"]}]);
  const update=(i,field,val)=>setTiers(p=>p.map((t,j)=>j===i?{...t,[field]:val}:t));
  return(
    <div className="space-y-5">
      <div><h1 className="text-xl font-bold text-white">Loyalty & Rewards</h1><p className="text-xs text-slate-400 mt-0.5">Configure LoyaltyTier model · Visual slider interface · No JSON editing</p></div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KPI icon={Award} label="Active Members" value="1,280" change="+18%" positive color={C.primary}/>
        <KPI icon={Star} label="Points Issued (Month)" value="142,800" change="+22%" positive color={C.amber}/>
        <KPI icon={Gift} label="Coupons Redeemed" value="384" change="+9%" positive color={C.green}/>
        <KPI icon={Repeat} label="Referral Conversions" value="67" change="+31%" positive color={C.pink}/>
      </div>
      <div className="rounded-xl p-4" style={{background:"rgba(30,30,45,0.8)",border:"1px solid rgba(255,255,255,0.06)"}}>
        <div className="flex items-center justify-between mb-4"><h3 className="text-sm font-semibold text-white">Tier Configuration — Drag sliders to set thresholds</h3><button className={`${btn} text-xs`} style={{background:"linear-gradient(135deg,#8b5cf6,#7c3aed)"}}>Save Tiers</button></div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">{tiers.map((t,i)=>(
          <div key={t.rank} className="rounded-xl p-4" style={{background:`${t.color}08`,border:`1px solid ${t.color}30`}}>
            <div className="flex items-center gap-2 mb-3"><div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{background:t.color+"25"}}><Crown size={16} style={{color:t.color}}/></div><span className="text-sm font-bold" style={{color:t.color}}>{t.name}</span></div>
            <div className="space-y-3">
              <div><div className="flex justify-between text-xs mb-1"><span className="text-slate-400">Min Visits</span><span style={{color:t.color}}>{t.visits}</span></div><input type="range" min={0} max={50} value={t.visits} onChange={e=>update(i,"visits",Number(e.target.value))} className="w-full h-1.5 rounded-full appearance-none cursor-pointer" style={{accentColor:t.color}}/></div>
              <div><div className="flex justify-between text-xs mb-1"><span className="text-slate-400">Min Spend</span><span style={{color:t.color}}>£{t.spend}</span></div><input type="range" min={0} max={2000} step={50} value={t.spend} onChange={e=>update(i,"spend",Number(e.target.value))} className="w-full h-1.5 rounded-full appearance-none cursor-pointer" style={{accentColor:t.color}}/></div>
            </div>
            <div className="mt-3 space-y-1">{t.perks.map((p,j)=><div key={j} className="flex items-center gap-1 text-xs text-slate-300"><Check size={10} style={{color:t.color}}/>{p}</div>)}</div>
            <div className="mt-2 text-xs text-slate-600">{customers.filter(c=>c.tier===t.name).length} customers</div>
          </div>
        ))}</div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-xl p-4" style={{background:"rgba(30,30,45,0.8)",border:"1px solid rgba(255,255,255,0.06)"}}>
          <h3 className="text-sm font-semibold text-white mb-3">Points Ledger — Append-Only (Prisma)</h3>
          <div className="space-y-1">{[...pointsLedger,{id:6,type:"CREDIT",points:45,balance:1285,reason:"VISIT_ACCRUAL",ref:"visit_ghi",date:"Jun 16"}].map(l=><div key={l.id} className="flex items-center gap-2 py-2 px-3 rounded-lg text-xs" style={{background:"rgba(255,255,255,0.02)"}}><div className={`w-5 h-5 rounded-full flex items-center justify-center font-bold ${l.type==="CREDIT"?"text-green-400 bg-green-500/15":"text-red-400 bg-red-500/15"}`}>{l.type==="CREDIT"?"+":"-"}</div><div className="flex-1 min-w-0"><span className="text-white font-medium">{l.reason}</span><span className="text-slate-500 ml-2 font-mono text-xs">{l.ref}</span></div><span className={`font-bold ${l.type==="CREDIT"?"text-green-400":"text-red-400"}`}>{l.type==="CREDIT"?"+":"-"}{l.points}</span><span className="text-slate-500 w-16 text-right">{l.balance} pts</span><span className="text-slate-600 w-10 text-right">{l.date}</span></div>)}</div>
        </div>
        <div className="rounded-xl p-4" style={{background:"rgba(30,30,45,0.8)",border:"1px solid rgba(255,255,255,0.06)"}}>
          <h3 className="text-sm font-semibold text-white mb-3">Referral Programme</h3>
          <div className="space-y-2">{customers.slice(0,5).map(c=><div key={c.id} className="flex items-center gap-3 py-2 px-3 rounded-lg" style={{background:"rgba(255,255,255,0.02)"}}><div className="w-7 h-7 rounded-full flex items-center justify-center text-white font-semibold text-xs" style={{background:`linear-gradient(135deg,${SEG_COLORS[c.segment]||"#8b5cf6"},${SEG_COLORS[c.segment]||"#8b5cf6"}88)`}}>{c.name.split(" ").map(n=>n[0]).join("")}</div><div className="flex-1 min-w-0"><div className="text-xs text-white font-medium truncate">{c.name}</div><div className="text-xs font-mono text-violet-300">{c.referralCode}</div></div><div className="flex items-center gap-1 text-xs text-slate-400"><Users size={10}/>{Math.floor(Math.random()*5)}</div></div>)}</div>
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
  const sheets=[{name:"Sheet1 (Check-ins)",rows:847,status:"Synced",sync:"2 min ago"},{name:"Customer Records",rows:1680,status:"Synced",sync:"2 min ago"},{name:"Segments",rows:2060,status:"Synced",sync:"15 min ago"},{name:"Analytics_Data",rows:168,status:"Synced",sync:"1 hr ago"},{name:"Loyal Customers",rows:420,status:"Synced",sync:"1 hr ago"},{name:"Irregular Customers",rows:290,status:"Synced",sync:"1 hr ago"},{name:"Logs",rows:3240,status:"Synced",sync:"2 min ago"}];
  return(
    <div className="space-y-4">
      <div className="flex items-center justify-between"><div><h1 className="text-xl font-bold text-white">Data Hub</h1><p className="text-xs text-slate-400 mt-0.5">BullMQ queue monitor · Google Sheets sync · Processing pipeline</p></div><button className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium text-white" style={{background:"linear-gradient(135deg,#8b5cf6,#7c3aed)"}}><RefreshCw size={14}/>Sync Now</button></div>
      {/* Pipeline */}
      <div className="rounded-xl p-4" style={{background:"rgba(30,30,45,0.8)",border:"1px solid rgba(255,255,255,0.06)"}}>
        <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2"><Layers size={14} className="text-violet-400"/>Check-In → BullMQ Pipeline</h3>
        <div className="flex items-center gap-2 overflow-x-auto pb-2">{[{l:"Check-In",icon:UserPlus,desc:"QR / POS Webhook",c:"#3b82f6"},{l:"Classify",icon:Layers,desc:"Segment + Tier",c:"#8b5cf6"},{l:"Consent Check",icon:Shield,desc:"Pre-flight #4",c:"#06b6d4"},{l:"Quota Guard",icon:Lock,desc:"Redis key check",c:"#f59e0b"},{l:"Cooldown",icon:Clock,desc:"72h window",c:"#ec4899"},{l:"BullMQ",icon:Database,desc:"Job enqueued",c:"#22c55e"},{l:"Gateway",icon:Send,desc:"Meta / WAHA",c:"#25D366"}].map((s,i)=>(
          <div key={i} className="flex items-center gap-1.5 flex-shrink-0">{i>0&&<ChevronRight size={12} className="text-slate-600"/>}<div className="p-2.5 rounded-xl text-center min-w-[72px]" style={{background:s.c+"10",border:`1px solid ${s.c}20`}}><s.icon size={16} className="mx-auto mb-1" style={{color:s.c}}/><div className="text-xs font-medium text-white">{s.l}</div><div className="text-xs text-slate-500" style={{fontSize:9}}>{s.desc}</div></div></div>
        ))}</div>
      </div>
      <div className="flex gap-1">{["queue","sheets","logs"].map(t=><button key={t} onClick={()=>setTab(t)} className={`px-3 py-2 rounded-lg text-xs capitalize ${tab===t?"text-white":"text-slate-400"}`} style={tab===t?{background:"rgba(139,92,246,0.2)"}:{}}>{t==="queue"?"Message Queue":t==="sheets"?"Google Sheets":"Logs"}</button>)}</div>
      {tab==="queue"&&<div className="rounded-xl overflow-hidden" style={{background:"rgba(30,30,45,0.8)",border:"1px solid rgba(255,255,255,0.06)"}}>
        <div className="overflow-x-auto"><table className="w-full text-xs"><thead><tr className="border-b border-white/5"><th className="text-left py-3 px-4 text-slate-400 font-medium">Customer</th><th className="text-left py-3 px-3 text-slate-400 font-medium">Template</th><th className="text-left py-3 px-3 text-slate-400 font-medium">Status</th><th className="text-left py-3 px-3 text-slate-400 font-medium hidden md:table-cell">Provider Message ID</th><th className="text-left py-3 px-3 text-slate-400 font-medium">Time</th></tr></thead>
          <tbody>{msgQueue.map(m=>(
            <tr key={m.id} className="border-b border-white/3 hover:bg-white/2"><td className="py-2.5 px-4"><div className="font-medium text-white">{m.name}</div><div className="text-slate-500">{m.phone}</div></td><td className="py-2.5 px-3 font-mono text-violet-300">{m.template}</td><td className="py-2.5 px-3"><Badge color={STATUS_COLORS[m.status]||"#6b7280"}>{m.status}</Badge></td><td className="py-2.5 px-3 text-slate-500 hidden md:table-cell font-mono">{m.waId||<span className="text-slate-700">—</span>}</td><td className="py-2.5 px-3 text-slate-400">{m.time}</td></tr>
          ))}</tbody></table></div>
        <div className="p-3 border-t border-white/5 flex flex-wrap gap-2">{Object.entries(STATUS_COLORS).map(([s,c])=><div key={s} className="flex items-center gap-1 text-xs"><div className="w-2 h-2 rounded-full" style={{background:c}}/><span className="text-slate-400">{s}</span><span className="text-white font-medium">({msgQueue.filter(m=>m.status===s).length})</span></div>)}</div>
      </div>}
      {tab==="sheets"&&<div className="space-y-2">{sheets.map((s,i)=><div key={i} className="flex items-center gap-3 p-3 rounded-xl" style={{background:"rgba(30,30,45,0.8)",border:"1px solid rgba(255,255,255,0.06)"}}><Table size={14} className="text-violet-400 flex-shrink-0"/><div className="flex-1"><div className="text-xs font-medium text-white">{s.name}</div><div className="text-xs text-slate-500">{s.rows.toLocaleString()} rows · {s.sync}</div></div><Badge color={C.green}>{s.status}</Badge></div>)}</div>}
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
  const [query,setQuery]=useState("");const [res,setRes]=useState(null);const [loading,setLoading]=useState(false);
  const run=()=>{setLoading(true);setTimeout(()=>{setRes({answer:`Based on your customer data, ${customers.filter(c=>c.churnRisk>50).length} customers haven't visited in over 45 days and are classified as AT_RISK or LOST. I recommend triggering the "Inactivity Win-Back" automation with a 20% discount. Expected return rate: 24% based on historical campaign data.`,action:"Trigger Win-Back Campaign",count:customers.filter(c=>c.churnRisk>50).length});setLoading(false);},2200);};
  return(
    <div className="space-y-4">
      <div><h1 className="text-xl font-bold text-white flex items-center gap-2"><Brain size={22} className="text-violet-400"/>AI Business Intelligence</h1><p className="text-xs text-slate-400 mt-0.5">Natural language → scoped Prisma query → LLM insight · businessId injected server-side</p></div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3"><KPI icon={AlertTriangle} label="High Churn Risk" value={customers.filter(c=>c.churnRisk>60).length} color={C.red}/><KPI icon={TrendingUp} label="Revenue Forecast (Jul)" value="£14,200" change="+16.1%" positive color={C.green}/><KPI icon={Star} label="Avg. CLV" value="£1,856" change="+8.3%" positive color={C.amber}/><KPI icon={Cpu} label="Model Accuracy" value="94.2%" color={C.accent}/></div>
      <div className="rounded-xl p-4" style={{background:"rgba(30,30,45,0.8)",border:"1px solid rgba(255,255,255,0.06)"}}>
        <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2"><Brain size={14} className="text-violet-400"/>Ask Your Data (NL → Prisma → LLM)</h3>
        <div className="flex gap-2 mb-3">{["Show customers not visited in 60 days","Which segment has highest LTV?","Who redeemed coupons this month?"].map((q,i)=><button key={i} onClick={()=>setQuery(q)} className="px-2.5 py-1.5 rounded-lg text-xs text-slate-300 hover:text-white hover:bg-white/5 transition-all" style={{border:"1px solid rgba(255,255,255,0.06)"}}>{q}</button>)}</div>
        <div className="flex gap-2"><input value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>e.key==="Enter"&&run()} placeholder="e.g. Show me customers who haven't visited in 60 days..." className={`flex-1 ${inp}`} style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.08)"}}/><button onClick={run} disabled={!query||loading} className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium text-white disabled:opacity-40" style={{background:"linear-gradient(135deg,#8b5cf6,#7c3aed)"}}>{loading?<RefreshCw size={14} className="animate-spin"/>:<Send size={14}/>}{loading?"Thinking...":"Ask"}</button></div>
        {res&&<div className="mt-3 p-4 rounded-xl" style={{background:"rgba(139,92,246,0.08)",border:"1px solid rgba(139,92,246,0.2)"}}><p className="text-sm text-white mb-2">{res.answer}</p><button className="px-3 py-1.5 rounded-lg text-xs font-medium text-white" style={{background:"linear-gradient(135deg,#22c55e,#16a34a)"}}>→ {res.action} ({res.count} customers)</button></div>}
      </div>
      <div className="rounded-xl p-4" style={{background:"rgba(30,30,45,0.8)",border:"1px solid rgba(255,255,255,0.06)"}}>
        <h3 className="text-sm font-semibold text-white mb-3">Churn Risk — All Customers</h3>
        <div className="space-y-2">{customers.sort((a,b)=>b.churnRisk-a.churnRisk).map((c,i)=>(
          <div key={i} className="flex items-center gap-3"><span className="text-xs text-slate-600 w-4">{i+1}</span><div className="w-7 h-7 rounded-full flex items-center justify-center text-white font-semibold text-xs flex-shrink-0" style={{background:`linear-gradient(135deg,${SEG_COLORS[c.segment]||"#8b5cf6"},${SEG_COLORS[c.segment]||"#8b5cf6"}88)`}}>{c.name.split(" ").map(n=>n[0]).join("")}</div><div className="flex-1"><div className="flex justify-between mb-0.5"><span className="text-xs text-white">{c.name}</span><span className={`text-xs font-bold ${c.churnRisk>75?"text-red-400":c.churnRisk>40?"text-amber-400":"text-green-400"}`}>{c.churnRisk}%</span></div><div className="w-full h-1.5 rounded-full" style={{background:"rgba(255,255,255,0.05)"}}><div className="h-full rounded-full" style={{width:`${c.churnRisk}%`,background:c.churnRisk>75?"#ef4444":c.churnRisk>40?"#f59e0b":"#22c55e"}}/></div></div><Badge color={SEG_COLORS[c.segment]||"#8b5cf6"}>{c.segment}</Badge>
          </div>
        ))}</div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-xl p-4" style={{background:"rgba(30,30,45,0.8)",border:"1px solid rgba(255,255,255,0.06)"}}><h3 className="text-sm font-semibold text-white mb-2">Revenue Forecast (6-month)</h3><p className="text-xs text-slate-500 mb-2">Historical + predicted · solid=actual, dashed=ML model</p><ResponsiveContainer width="100%" height={180}><AreaChart data={forecastData}><defs><linearGradient id="ga" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#22c55e" stopOpacity={0.3}/><stop offset="100%" stopColor="#22c55e" stopOpacity={0}/></linearGradient><linearGradient id="gp" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.3}/><stop offset="100%" stopColor="#8b5cf6" stopOpacity={0}/></linearGradient></defs><CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)"/><XAxis dataKey="m" tick={{fill:"#64748b",fontSize:11}} axisLine={false} tickLine={false}/><YAxis tick={{fill:"#64748b",fontSize:11}} axisLine={false} tickLine={false}/><Tooltip contentStyle={{background:"#1e1e2d",border:"1px solid rgba(255,255,255,0.1)",borderRadius:8,fontSize:12,color:"#fff"}}/><Area type="monotone" dataKey="actual" stroke="#22c55e" fill="url(#ga)" strokeWidth={2}/><Area type="monotone" dataKey="pred" stroke="#8b5cf6" fill="url(#gp)" strokeWidth={2} strokeDasharray="6 3"/></AreaChart></ResponsiveContainer></div>
        <div className="rounded-xl p-4" style={{background:"rgba(30,30,45,0.8)",border:"1px solid rgba(255,255,255,0.06)"}}><h3 className="text-sm font-semibold text-white mb-3">AI Recommendations</h3><div className="space-y-2">{[{icon:AlertTriangle,c:C.red,t:"3 customers likely to churn this week",d:"Emma Wilson (82%), Liam O'Brien (91%), Sophie Davis (96%) — dispatch win-back within 24h"},{icon:TrendingUp,c:C.green,t:"VIP segment 18% ahead of projection",d:"5 customers approaching BIG_SPENDER threshold — early VIP perks may accelerate conversion"},{icon:Clock,c:C.amber,t:"Saturday peak under-utilized",d:"92 visits/Saturday vs 38/Wednesday — recommend midweek micro-campaigns"},{icon:Star,c:C.accent,t:"thank_you_template driving 2.4x returns",d:"Customers receiving within 1hr of visit return at 68% vs 28% baseline"}].map((r,i)=><div key={i} className="flex gap-3 p-3 rounded-lg" style={{background:"rgba(255,255,255,0.02)"}}><r.icon size={14} className="flex-shrink-0 mt-0.5" style={{color:r.c}}/><div><div className="text-xs font-medium text-white">{r.t}</div><div className="text-xs text-slate-400 mt-0.5">{r.d}</div></div></div>)}</div></div>
      </div>
    </div>
  );
};

// ════════════════════════════════════════════════════════════════
// ANALYTICS
// ════════════════════════════════════════════════════════════════
const AnalyticsPage=()=>(
  <div className="space-y-4">
    <div><h1 className="text-xl font-bold text-white">Analytics</h1><p className="text-xs text-slate-400 mt-0.5">Pre-computed AnalyticsSnapshot · nightly node-cron · never live DB queries</p></div>
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3"><KPI icon={Heart} label="Retention Rate" value="68.4%" change="+3.1%" positive color={C.pink}/><KPI icon={TrendingUp} label="Repeat Rate" value="54.2%" change="+5.8%" positive color={C.green}/><KPI icon={Clock} label="Avg. Frequency" value="2.4/mo" color={C.accent}/><KPI icon={Star} label="Avg. LTV" value="£385" change="+12%" positive color={C.amber}/></div>
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div className="rounded-xl p-4" style={{background:"rgba(30,30,45,0.8)",border:"1px solid rgba(255,255,255,0.06)"}}><h3 className="text-sm font-semibold text-white mb-3">Customer Segments (7 from Prisma enum)</h3><div className="flex items-center gap-4"><ResponsiveContainer width="45%" height={180}><PieChart><Pie data={segData} cx="50%" cy="50%" innerRadius={45} outerRadius={70} dataKey="value" stroke="none">{segData.map((e,i)=><Cell key={i} fill={e.color}/>)}</Pie></PieChart></ResponsiveContainer><div className="space-y-1 flex-1">{segData.map((s,i)=><div key={i} className="flex items-center justify-between text-xs"><span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{background:s.color}}/><span className="text-slate-300">{s.name}</span></span><span className="text-white font-medium">{s.value}</span></div>)}</div></div></div>
      <div className="rounded-xl p-4" style={{background:"rgba(30,30,45,0.8)",border:"1px solid rgba(255,255,255,0.06)"}}><h3 className="text-sm font-semibold text-white mb-3">Message Performance (9 status types)</h3><ResponsiveContainer width="100%" height={180}><BarChart data={msgPerf}><CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)"/><XAxis dataKey="w" tick={{fill:"#64748b",fontSize:11}} axisLine={false} tickLine={false}/><YAxis tick={{fill:"#64748b",fontSize:11}} axisLine={false} tickLine={false}/><Tooltip contentStyle={{background:"#1e1e2d",border:"1px solid rgba(255,255,255,0.1)",borderRadius:8,fontSize:12,color:"#fff"}}/><Bar dataKey="sent" fill="#3b82f6" radius={[3,3,0,0]}/><Bar dataKey="del" fill="#22c55e" radius={[3,3,0,0]}/><Bar dataKey="read" fill="#06b6d4" radius={[3,3,0,0]}/></BarChart></ResponsiveContainer></div>
    </div>
    <div className="rounded-xl p-4" style={{background:"rgba(30,30,45,0.8)",border:"1px solid rgba(255,255,255,0.06)"}}><h3 className="text-sm font-semibold text-white mb-3">Customer Growth & Retention</h3><ResponsiveContainer width="100%" height={200}><BarChart data={growthData}><CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)"/><XAxis dataKey="m" tick={{fill:"#64748b",fontSize:11}} axisLine={false} tickLine={false}/><YAxis tick={{fill:"#64748b",fontSize:11}} axisLine={false} tickLine={false}/><Tooltip contentStyle={{background:"#1e1e2d",border:"1px solid rgba(255,255,255,0.1)",borderRadius:8,fontSize:12,color:"#fff"}}/><Bar dataKey="c" fill="#8b5cf6" radius={[4,4,0,0]}/><Bar dataKey="ret" fill="#22c55e" radius={[4,4,0,0]}/></BarChart></ResponsiveContainer></div>
  </div>
);

// ════════════════════════════════════════════════════════════════
// SETTINGS
// ════════════════════════════════════════════════════════════════
const SettingsPage=({wa,onConnect})=>{
  const [tab,setTab]=useState("business");
  const tabs=[{id:"business",label:"Business",icon:Building},{id:"whatsapp",label:"WhatsApp API",icon:MessageSquare},{id:"rbac",label:"Team & Roles",icon:Users},{id:"stripe",label:"Billing",icon:CreditCard},{id:"security",label:"Security",icon:Shield},{id:"gdpr",label:"GDPR",icon:Globe}];
  return(
    <div className="space-y-4">
      <div><h1 className="text-xl font-bold text-white">Settings</h1><p className="text-xs text-slate-400 mt-0.5">Tenant configuration · All changes scoped to businessId</p></div>
      <div className="flex gap-1 overflow-x-auto pb-1">{tabs.map(t=><button key={t.id} onClick={()=>setTab(t.id)} className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs whitespace-nowrap ${tab===t.id?"text-white":"text-slate-400"}`} style={tab===t.id?{background:"rgba(139,92,246,0.2)"}:{}}><t.icon size={12}/>{t.label}{t.id==="whatsapp"&&<span className={`w-1.5 h-1.5 rounded-full ${wa?"bg-green-400":"bg-red-400"}`}/>}</button>)}</div>
      <div className="rounded-xl p-5" style={{background:"rgba(30,30,45,0.8)",border:"1px solid rgba(255,255,255,0.06)"}}>
        {tab==="business"&&<div className="space-y-4"><div className="flex items-center gap-4 mb-2"><div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{background:"linear-gradient(135deg,#8b5cf6,#06b6d4)"}}><span className="text-white font-bold text-xl">TC</span></div><div><button className="text-xs text-violet-400 hover:text-violet-300">Change Logo</button><div className="text-xs text-slate-500 mt-1">businessId: biz_the_coffee_house</div></div></div><div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{[{l:"Business Name",v:"The Coffee House"},{l:"Industry",v:"Café & Restaurant"},{l:"Country (ISO 3166-1)",v:"GB"},{l:"Currency (ISO 4217)",v:"GBP"},{l:"Timezone (IANA)",v:"Europe/London"},{l:"Custom Domain (white-label)",v:"loyalty.coffeehouse.com"},{l:"Loyal Days Window",v:"7"},{l:"Irregular Gap Days",v:"14"},{l:"Lost Days Threshold",v:"60"},{l:"Message Cooldown (hours)",v:"72"}].map((f,i)=><div key={i}><label className="text-xs text-slate-400 mb-1 block">{f.l}</label><input defaultValue={f.v} className="w-full px-3 py-2 rounded-lg text-xs text-white outline-none" style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.08)"}}/></div>)}</div><button className="px-4 py-2 rounded-lg text-xs font-medium text-white" style={{background:"linear-gradient(135deg,#8b5cf6,#7c3aed)"}}>Save Changes</button></div>}
        {tab==="whatsapp"&&<div className="space-y-4">
          {wa?<div className="flex items-center gap-3 p-3 rounded-xl" style={{background:"rgba(34,197,94,0.1)",border:"1px solid rgba(34,197,94,0.2)"}}><WAIcon size={18} className="text-green-400"/><div className="flex-1"><div className="text-sm font-medium text-green-400">Connected — BullMQ worker active</div><div className="text-xs text-slate-400">+44 20 7946 0958 · Meta Cloud API v20.0</div></div><button className="text-xs text-red-400 px-2 py-1 rounded" style={{border:"1px solid rgba(239,68,68,0.2)"}}>Disconnect</button></div>:<button onClick={onConnect} className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-medium text-white" style={{background:"linear-gradient(135deg,#25D366,#128C7E)"}}><WAIcon size={14} className="text-white"/>Connect Meta Account</button>}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{[{l:"Meta Phone Number ID",v:"944772475375221"},{l:"Meta WABA ID",v:"827360646830020"},{l:"API Version",v:"v20.0"},{l:"Access Token (Argon2 encrypted)",v:"EAAQnz1r2zzw...",type:"password"},{l:"Thank-You Template",v:"thank_you_template"},{l:"Miss-You Template",v:"we_miss_you_template"},{l:"Template Language",v:"en_US"},{l:"WAHA Base URL",v:"https://waha.your-server.com"},{l:"WAHA Session ID",v:"the-coffee-house"},{l:"Test Override Number",v:"+923088581919"}].map((f,i)=><div key={i}><label className="text-xs text-slate-400 mb-1 block">{f.l}</label><input defaultValue={f.v} type={f.type||"text"} className="w-full px-3 py-2 rounded-lg text-xs text-white outline-none font-mono" style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.08)"}}/></div>)}</div>
          <div className="flex flex-wrap gap-2">{[{l:"Provider",v:"META",c:C.blue},{l:"Test Mode",v:"OFF (Live)",c:C.red},{l:"Batch Size",v:"200 msg/s",c:C.green},{l:"Cooldown",v:"72h",c:C.amber}].map((s,i)=><div key={i} className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs" style={{background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.06)"}}><span className="text-slate-400">{s.l}:</span><span className="font-medium" style={{color:s.c}}>{s.v}</span></div>)}</div>
        </div>}
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
const CampaignsPage=({onBuilder})=>{
  const cList=[{id:1,name:"Summer Win-Back",seg:"AT_RISK",status:"Active",sent:290,del:278,read:195,ret:42,disc:"20%"},{id:2,name:"VIP Appreciation",seg:"VIP",status:"Active",sent:85,del:83,read:71,ret:28,disc:"Free item"},{id:3,name:"Birthday Treats",seg:"NEW",status:"Scheduled",sent:0,del:0,read:0,ret:0,disc:"15%"},{id:4,name:"Big Spender Reward",seg:"BIG_SPENDER",status:"Completed",sent:145,del:140,read:118,ret:55,disc:"25%"}];
  return(
    <div className="space-y-4">
      <div className="flex items-center justify-between"><div><h1 className="text-xl font-bold text-white">Campaigns</h1><p className="text-xs text-slate-400 mt-0.5">@dnd-kit/core layout builder · BullMQ dispatch · AI-assisted copywriting</p></div><button onClick={onBuilder} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium text-white" style={{background:"linear-gradient(135deg,#8b5cf6,#7c3aed)"}}><Plus size={14}/>Campaign Builder</button></div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3"><KPI icon={Send} label="Total Sent" value="520" color={C.blue}/><KPI icon={CheckCheck} label="Delivered" value="501" color={C.green}/><KPI icon={Eye} label="Read" value="384" color={C.accent}/><KPI icon={ArrowUpRight} label="Returns" value="125" change="24%" positive color={C.primary}/></div>
      <div className="space-y-3">{cList.map(c=><div key={c.id} className="rounded-xl p-4" style={{background:"rgba(30,30,45,0.8)",border:"1px solid rgba(255,255,255,0.06)"}}><div className="flex items-center justify-between flex-wrap gap-2"><div className="flex items-center gap-3"><div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{background:c.status==="Active"?"rgba(34,197,94,0.15)":c.status==="Scheduled"?"rgba(245,158,11,0.15)":"rgba(100,116,139,0.15)"}}>{c.status==="Active"?<Play size={15} className="text-green-400"/>:c.status==="Scheduled"?<Clock size={15} className="text-amber-400"/>:<Check size={15} className="text-slate-400"/>}</div><div><div className="text-sm font-medium text-white">{c.name}</div><div className="text-xs text-slate-400"><Badge color={SEG_COLORS[c.seg]||"#8b5cf6"}>{c.seg}</Badge> · {c.disc} off</div></div></div><Badge color={c.status==="Active"?C.green:c.status==="Scheduled"?C.amber:"#64748b"}>{c.status}</Badge></div>{c.sent>0&&<div className="grid grid-cols-4 gap-2 mt-3 pt-3 border-t border-white/5">{[{l:"Sent",v:c.sent,c:"#3b82f6"},{l:"Delivered",v:c.del,c:"#22c55e"},{l:"Read",v:c.read,c:"#06b6d4"},{l:"Returns",v:c.ret,c:"#8b5cf6"}].map((s,i)=><div key={i} className="text-center"><div className="text-sm font-bold" style={{color:s.c}}>{s.v}</div><div className="text-xs text-slate-500">{s.l}</div></div>)}</div>}</div>)}</div>
    </div>
  );
};

// ════════════════════════════════════════════════════════════════
// AUTOMATIONS LIST
// ════════════════════════════════════════════════════════════════
const AutomationsPage=({onBuilder})=>{
  const [autos,setAutos]=useState([{id:1,name:"Birthday Win 🎂",trigger:"BIRTHDAY",action:"SEND_WHATSAPP + AWARD_POINTS",on:true,ran:89,conv:67},{id:2,name:"Inactivity Win-Back",trigger:"INACTIVITY",action:"SEND_WHATSAPP (we_miss_you_template)",on:true,ran:142,conv:38},{id:3,name:"VIP Auto-Upgrade",trigger:"TIER_UPGRADE",action:"SEND_WHATSAPP + CHANGE_SEGMENT",on:true,ran:34,conv:34},{id:4,name:"Negative Sentiment Alert",trigger:"SENTIMENT_NEGATIVE",action:"MANAGER_ALERT + pause marketing",on:true,ran:12,conv:12},{id:5,name:"Milestone 10 Visits",trigger:"VISIT_MILESTONE",action:"SEND_WHATSAPP + AWARD_POINTS (50)",on:false,ran:56,conv:41}]);
  return(
    <div className="space-y-4">
      <div className="flex items-center justify-between"><div><h1 className="text-xl font-bold text-white">Automations</h1><p className="text-xs text-slate-400 mt-0.5">reactflow canvas → compiledJson → BullMQ jobs · Zero-code IF/THEN</p></div><button onClick={onBuilder} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium text-white" style={{background:"linear-gradient(135deg,#8b5cf6,#7c3aed)"}}><Plus size={14}/>Build Automation</button></div>
      <div className="space-y-3">{autos.map(a=><div key={a.id} className={`rounded-xl p-4 transition-all ${a.on?"":"opacity-60"}`} style={{background:"rgba(30,30,45,0.8)",border:`1px solid ${a.on?"rgba(139,92,246,0.2)":"rgba(255,255,255,0.06)"}`}}>
        <div className="flex items-center justify-between gap-3"><div className="flex items-center gap-3 flex-1 min-w-0"><div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{background:a.on?"rgba(139,92,246,0.15)":"rgba(255,255,255,0.05)"}}><Zap size={16} className={a.on?"text-violet-400":"text-slate-500"}/></div><div className="min-w-0"><div className="text-sm font-medium text-white truncate">{a.name}</div><div className="text-xs text-slate-400 mt-0.5 truncate"><span className="text-cyan-400">IF</span> {a.trigger} <span className="text-amber-400">→ THEN</span> {a.action}</div></div></div><button onClick={()=>setAutos(p=>p.map(x=>x.id===a.id?{...x,on:!x.on}:x))} className={`w-10 h-5 rounded-full relative flex-shrink-0 ${a.on?"bg-violet-500":"bg-white/10"}`}><div className="w-4 h-4 rounded-full bg-white absolute top-0.5 transition-all" style={{left:a.on?22:2}}/></button></div>
        <div className="flex gap-4 mt-3 pt-3 border-t border-white/5"><div className="text-xs text-slate-400">Ran: <span className="text-white font-medium">{a.ran}</span></div><div className="text-xs text-slate-400">Converted: <span className="text-green-400 font-medium">{a.conv}</span></div><div className="text-xs text-slate-400">Rate: <span className="text-cyan-400 font-medium">{Math.round(a.conv/a.ran*100)}%</span></div></div>
      </div>)}</div>
    </div>
  );
};

// ════════════════════════════════════════════════════════════════
// APP
// ════════════════════════════════════════════════════════════════
export default function App(){
  const [loggedIn,setLoggedIn]=useState(false);const [page,setPage]=useState("dashboard");const [col,setCol]=useState(false);const [selC,setSelC]=useState(null);const [mobileMenu,setMobileMenu]=useState(false);const [wa,setWa]=useState(false);const [showWA,setShowWA]=useState(false);
  if(!loggedIn)return <LoginPage onLogin={()=>setLoggedIn(true)}/>;
  const nav=p=>{setPage(p);if(p!=="profile"&&p!=="campaign-builder"&&p!=="automation-builder")setSelC(null);setMobileMenu(false);};
  const render=()=>{switch(page){
    case"dashboard":return<DashboardPage setPage={nav}/>;
    case"customers":return<CustomersPage onSelect={c=>{setSelC(c);setPage("profile");}}/>;
    case"profile":return selC?<CustomerProfile customer={selC} onBack={()=>nav("customers")} onMsg={c=>{setSelC(c);setPage("messages");}}/>:<CustomersPage onSelect={c=>{setSelC(c);setPage("profile");}}/>;
    case"messages":return<MessagesPage wa={wa} onConnect={()=>setShowWA(true)}/>;
    case"campaigns":return<CampaignsPage onBuilder={()=>setPage("campaign-builder")}/>;
    case"campaign-builder":return<CampaignBuilderPage onBack={()=>setPage("campaigns")}/>;
    case"automations":return<AutomationsPage onBuilder={()=>setPage("automation-builder")}/>;
    case"automation-builder":return<AutomationBuilderPage onBack={()=>setPage("automations")}/>;
    case"loyalty":return<LoyaltyPage/>;
    case"datahub":return<DataHubPage/>;
    case"ai":return<AIPage/>;
    case"analytics":return<AnalyticsPage/>;
    case"settings":return<SettingsPage wa={wa} onConnect={()=>setShowWA(true)}/>;
    default:return<DashboardPage setPage={nav}/>;
  }};
  return(
    <div className="min-h-screen" style={{background:"linear-gradient(135deg,#0a0615,#1a0f2e,#0d1525)"}}>
      {showWA&&<MetaWizard onDone={()=>{setWa(true);setShowWA(false);setPage("messages");}} onClose={()=>setShowWA(false)}/>}
      <div className="hidden md:block"><Sidebar page={page} setPage={nav} col={col} setCol={setCol} onLogout={()=>setLoggedIn(false)} wa={wa}/></div>
      <div className="md:hidden fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-4 py-3" style={{background:"rgba(10,6,21,0.95)",borderBottom:"1px solid rgba(255,255,255,0.06)"}}>
        <div className="flex items-center gap-2"><div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{background:"linear-gradient(135deg,#8b5cf6,#06b6d4)"}}><span className="text-white font-bold text-xs">C</span></div><span className="text-white font-bold text-sm">Cube Retain</span></div>
        <button onClick={()=>setMobileMenu(!mobileMenu)} className="text-slate-400">{mobileMenu?<X size={20}/>:<Menu size={20}/>}</button>
      </div>
      {mobileMenu&&<div className="md:hidden fixed inset-0 z-40 pt-14" style={{background:"rgba(10,6,21,0.98)"}}><nav className="p-4 space-y-1">{NAV.map(it=><button key={it.id} onClick={()=>nav(it.id)} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm ${page===it.id?"text-white":"text-slate-400"}`} style={page===it.id?{background:"rgba(139,92,246,0.15)"}:{}}><it.icon size={18}/>{it.label}</button>)}<button onClick={()=>setLoggedIn(false)} className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm text-red-400"><LogOut size={18}/>Logout</button></nav></div>}
      <main className={`transition-all duration-300 ${col?"md:ml-16":"md:ml-56"} pt-16 md:pt-0`}><div className="p-4 md:p-6 max-w-6xl">{render()}</div></main>
    </div>
  );
}
