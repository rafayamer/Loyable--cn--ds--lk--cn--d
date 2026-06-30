# The Loyaly — 39-Point Fix Checklist

Tick the ones that test OK. We'll re-open any that aren't right when you verify.

Legend: ✅ shipped & build-verified · 🟡 partial / needs your live test · ⬜ not started · ⚙️ infra/console config (not code)

| # | Issue | Status |
|---|-------|--------|
| 1 | Terms: domain → theloyaly.com, email → support@theloyaly.com, logo | ✅ |
| 2 | Message container fits on mobile | ✅ |
| 3 | Reply shows correct customer number (not "unidentified") | ✅ |
| 4 | Remove "email me"; auto weekly (Sun) / monthly (month-end) / yearly (year-end + new-year wishes) | ✅ |
| 5 | "Send a message" opens that number → "write with AI" → AI writes → send | ✅ |
| 6 | Automations toggle now actually turns on/off (was 404 + silent fail) | ✅ |
| 7 | Campaigns: messages no longer stuck "pending" — now resolve to FAILED if undeliverable | 🟡 (needs connected WhatsApp to actually send) |
| 8 | POS/FBR: Pakistan → FBR only; tax services for 5–6 major countries | ⬜ |
| 9 | Settings (timezone/country/currency) apply per-business globally; country sets default dial code | ⬜ |
| 10 | Analytics wording → plain/layman | ⬜ |
| 11 | Heatmap should look like a heatmap, not a table | ⬜ |
| 12 | CRM fully mobile-friendly | ⬜ |
| 13 | GDPR values (proper) | ⬜ |
| 14 | Redis → fixed plan / reduce command volume (BullMQ tuning) | 🟡 (drainDelay/stalled tuning already in place) |
| 15 | Customer portal theme matches brand | ⬜ |
| 16 | Portal: login = number + name; "earn more points" adds email, DOB, Google review; business sets Google Maps location | ⬜ |
| 17 | Customer panel autofill; uploaded menu opens | ⬜ |
| 18 | Fix unsupported buttons that bounce to main website | ⬜ |
| 19 | Portal consent line: single agree line + terms link | ⬜ |
| 20 | POS layout de-congested / well ordered | ⬜ |
| 21 | Menu manager works; container works | ⬜ |
| 22 | CRM login page fits screen (no scroll/overflow) | 🟡 (login routing fixed; fit needs your check) |
| 23 | Font colour correct per theme | ⬜ |
| 24 | Glassmorphic design present | 🟡 (site done; CRM partial) |
| 25 | Analytics (i) tooltips with easy explanations | ⬜ |
| 26 | HR looks like a weekly planner form | ⬜ |
| 27 | Passwords set by owner only; staff email format (name)(business)(3-digit)(role)(branch)@theloyaly.com | 🟡 (email format generator exists) |
| 30 | HR performance & rewards works / makes sense | ⬜ |
| 31 | HR included in Growth plan | ✅ |
| 32 | Role-based: only that role's panel is shown | ⬜ |
| 32b | Pro = everything unlimited except branches & integrations | ✅ |
| 33 | Rewards calculator illustrative/easy + (i) | ⬜ |
| 34 | Website wording non-technical | 🟡 (rewritten in site overhaul; review) |
| 35 | Signup shows "continue to …railway.app" | ⚙️ Google OAuth consent screen (Cloud Console) |
| 36 | theloyaly.com default; dashboard shows railway url | ⚙️ Railway env vars (API_BASE_URL/FRONTEND_URL) |
| 37 | www.theloyaly.com doesn't work | ⚙️ DNS/Cloudflare CNAME |
| 38 | Two loyalty/rewards modules → de-duplicated | ✅ |
| 39 | Unexplained "segments" in customer → removed | ✅ |
| + | Loyalty "save points/tier settings" actually saves | ✅ |

## Notes
- **35/36/37** are not code — they're console/DNS settings. Tell me and I'll give you the exact steps (Google Cloud OAuth consent "App name" + authorized domains; Railway variables; Cloudflare CNAME for `www`).
- **7** code now finalizes undeliverable messages instead of leaving them pending. Actual sending still requires the tenant's WhatsApp number to be connected.
