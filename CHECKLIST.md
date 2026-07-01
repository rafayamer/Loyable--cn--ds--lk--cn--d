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
| 9 | Settings (timezone/country/currency) apply per-business globally; country sets default dial code | ✅ |
| 10 | Analytics wording → plain/layman | ✅ |
| 11 | Heatmap should look like a heatmap, not a table | ✅ |
| 12 | CRM fully mobile-friendly | ✅ (verified 390px: dashboard, POS, settings, login — no overflow) |
| 13 | GDPR values (proper) | ✅ (access/export + retention + erasure) |
| 14 | Redis → fixed plan / reduce command volume (BullMQ tuning) | ✅ (drainDelay/stalled tuning + 60s status poll) |
| 15 | Customer portal theme matches brand | ✅ |
| 16 | Portal: login = number + name; "earn more points" adds email, DOB, Google review; business sets Google Maps location | ✅ |
| 17 | Customer panel autofill; uploaded menu opens | ✅ |
| 18 | Fix unsupported buttons that bounce to main website | ✅ (audited: no dead links; root cause was login bounce, fixed) |
| 19 | Portal consent line: single agree line + terms link | ✅ |
| 20 | POS layout de-congested / well ordered | ✅ (form 2×2, menu manager rebuilt) |
| 21 | Menu manager works; container works | ✅ (persists server-side + rebuilt editor) |
| 22 | CRM login page fits screen (no scroll/overflow) | ✅ (verified 390px, fits exactly) |
| 23 | Font colour correct per theme | ✅ (light-mode input text fixed + verified) |
| 24 | Glassmorphic design present | ✅ (glass .gc/liquid-glass cards across CRM) |
| 25 | Analytics (i) tooltips with easy explanations | ✅ (KPIs + all chart panels) |
| 26 | HR looks like a weekly planner form | ✅ (weekly rota planner grid) |
| 27 | Passwords set by owner only; staff email format (name)(business)(3-digit)(role)(branch)@theloyaly.com | ✅ (owner sets password; email matches format) |
| 30 | HR performance & rewards works / makes sense | ✅ (per-staff scorecards: shifts/hours/points) |
| 31 | HR included in Growth plan | ✅ |
| 32 | Role-based: only that role's panel is shown | ✅ |
| 32b | Pro = everything unlimited except branches & integrations | ✅ |
| 33 | Rewards calculator illustrative/easy + (i) | ✅ |
| 34 | Website wording non-technical | ✅ (audited: no jargon in copy) |
| 35 | Signup shows "continue to …railway.app" | ⚙️ Google OAuth consent screen (Cloud Console) |
| 36 | theloyaly.com default; dashboard shows railway url | ⚙️ Railway env vars (API_BASE_URL/FRONTEND_URL) |
| 37 | www.theloyaly.com doesn't work | ⚙️ DNS/Cloudflare CNAME |
| 38 | Two loyalty/rewards modules → de-duplicated | ✅ |
| 39 | Unexplained "segments" in customer → removed | ✅ |
| + | Loyalty "save points/tier settings" actually saves | ✅ |

## Follow-up fixes & features (after first 39)
| Item | Status |
|------|--------|
| Loyalty tier save (type/validation errors) | ✅ |
| Campaign Builder button (role-guard regression) | ✅ |
| Automation on/off + delete (status mapping) | ✅ |
| Dashboard "Today's Tasks" delete/dismiss | ✅ |
| POS Menu Manager rebuilt (editor no longer overflows) | ✅ |
| HR: weekly rota planner + per-staff scorecards | ✅ |
| HR: bulk shift scheduling (many days at once) | ✅ |
| HR: GPS clock in/out (within 20 m of business) | ✅ |
| HR: staff/manager self-service "My Work" window | ✅ |
| HR: apply for leave (staff) + revoke approved leave (owner) | ✅ |
| HR: annual leave allotment → auto-unpaid once used up | ✅ |
| Settings: business GPS location + check-in radius | ✅ |
| HR: create staff login + owner-set password (in HR, not Settings) | ✅ |
| HR: terminate deletes login + emails staff; suspend disables login | ✅ |
| AI reports: skip LLM if that week/month/year report already exists (save tokens) | ✅ |

## Notes
- **35/36/37** are not code — they're console/DNS settings. Tell me and I'll give you the exact steps (Google Cloud OAuth consent "App name" + authorized domains; Railway variables; Cloudflare CNAME for `www`).
- **7** code now finalizes undeliverable messages instead of leaving them pending. Actual sending still requires the tenant's WhatsApp number to be connected.
