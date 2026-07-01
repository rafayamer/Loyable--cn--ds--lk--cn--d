# Domain & Branding Setup — Steps for #35, #36, #37

These three are **not code** — they're settings in Google, Railway, and Cloudflare.
Do them once and they stick. Nothing to deploy.

---

## #35 — Stop signup showing "to continue to loyable-…railway.app"

That line comes from the **Google sign-in consent screen**. Google shows the app
name + the domain Google has on file — not anything in our code.

**Fix it in Google Cloud Console:**

1. Go to https://console.cloud.google.com → pick the project used for "Sign in with Google".
2. Left menu → **APIs & Services → OAuth consent screen**.
3. **App name:** set to `The Loyaly` (this is the "continue to ___" text).
4. **App logo:** upload `black.png` / your logo (optional but looks premium).
5. **App domain → Application home page:** `https://theloyaly.com`
6. **Authorized domains:** add `theloyaly.com` (remove the railway one if listed).
7. **Save**.
8. Left menu → **Credentials → your OAuth 2.0 Client ID → edit:**
   - **Authorized JavaScript origins:** add `https://theloyaly.com` and `https://app.theloyaly.com`
   - **Authorized redirect URIs:** add your real callback, e.g.
     `https://app.theloyaly.com/api/auth/google/callback`
     (keep the railway one working until DNS is fully switched, then remove it).
9. **Save**. Changes can take 5 min–few hours to show. If the consent screen is in
   "Testing", publish it (**Publish app**) so all users see the branded name.

> Do the same on the **Facebook/Meta** and **Apple** login apps if you use those:
> set the app/display name to `The Loyaly` and the domain to `theloyaly.com`.

---

## #36 — theloyaly.com should be the default; dashboard shows the railway URL

The app builds links from environment variables. Right now they point at the
railway URL, so emails/links/redirects show `…railway.app`.

**Fix it in Railway:**

1. Open https://railway.app → your project → the **API service** → **Variables** tab.
2. Set / add these (create if missing):

   | Variable | Value |
   |---|---|
   | `API_BASE_URL` | `https://app.theloyaly.com` |
   | `FRONTEND_URL` | `https://theloyaly.com` |
   | `APP_URL` | `https://app.theloyaly.com` |
   | `APP_PUBLIC_URL` | `https://app.theloyaly.com` |

   (Use `app.theloyaly.com` for the thing that serves the API/app, and the bare
   `theloyaly.com` for the public marketing site. If you serve everything from one
   domain, set all of them to that one domain.)

3. Railway → the service → **Settings → Networking → Custom Domain**: add
   `app.theloyaly.com` (and/or `theloyaly.com`). Railway shows a **CNAME target** —
   copy it for the next step.
4. **Redeploy** the service so the new variables take effect.

> The code already falls back to `https://theloyaly.com` / `https://app.theloyaly.com`
> when these aren't set, so once your DNS points at Railway it will read correctly.

---

## #37 — www.theloyaly.com doesn't work

`www` needs its own DNS record. Right now only the bare domain resolves.

**Fix it in Cloudflare (or wherever your DNS is):**

1. Cloudflare dashboard → select `theloyaly.com` → **DNS → Records**.
2. Add a record:
   - **Type:** `CNAME`
   - **Name:** `www`
   - **Target:** the Railway CNAME target from #36 step 3
     (e.g. `xxxx.up.railway.app`), or `theloyaly.com` if you just want www → root.
   - **Proxy status:** Proxied (orange cloud) is fine.
   - **Save**.
3. In Railway → Custom Domains, also add `www.theloyaly.com` so it accepts that host.
4. (Recommended) Add a redirect so `www` → non-www (or vice-versa) for one canonical
   URL: Cloudflare → **Rules → Redirect Rules → Create** →
   *When incoming host equals* `www.theloyaly.com` → *Static redirect* to
   `https://theloyaly.com` (301). This avoids SEO duplicate-content and keeps one brand URL.
5. Wait for DNS to propagate (usually minutes, up to ~24h). Test:
   `https://www.theloyaly.com` should load the site.

---

### Quick checklist
- [ ] Google OAuth app name = "The Loyaly", authorized domain = theloyaly.com, published
- [ ] Railway vars set (API_BASE_URL, FRONTEND_URL, APP_URL, APP_PUBLIC_URL) + redeploy
- [ ] Railway custom domains added (app + root + www)
- [ ] Cloudflare CNAME for `www` + optional www→root redirect
- [ ] Test: login shows "continue to The Loyaly"; emails/links use theloyaly.com; www loads
