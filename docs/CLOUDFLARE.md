# Deploying with Cloudflare

Two options — pick the one that fits your setup.

---

## Option A — Cloudflare Tunnel (recommended)

Run the full app on **any VPS or server**, expose it securely via a Cloudflare Tunnel.
No IP addresses exposed, free SSL, DDoS protection, real visitor IPs in the activity log.

### What you need
- A VPS with Docker installed (Hetzner CX22 €4/mo or DigitalOcean Droplet $6/mo works fine)
- A domain on Cloudflare DNS
- 15 minutes

### 1 — Set up the VPS

```bash
# Connect to your VPS
ssh root@YOUR_VPS_IP

# Install Docker
curl -fsSL https://get.docker.com | sh

# Clone your repo
git clone https://github.com/kev-n-dev/fitness.git
cd fitness
```

### 2 — Configure the app

```bash
cp .env.production .env
nano .env   # fill in your domain and app name
```

Key fields to change:
```
RP_ID=fitness.yourdomain.com
ORIGIN=https://fitness.yourdomain.com
RP_NAME=YourAppName
```

### 3 — Install cloudflared

```bash
# Debian/Ubuntu
curl -L https://pkg.cloudflare.com/cloudflare-main.gpg \
  | sudo tee /usr/share/keyrings/cloudflare-main.gpg > /dev/null

echo 'deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] \
  https://pkg.cloudflare.com/cloudflared jammy main' \
  | sudo tee /etc/apt/sources.list.d/cloudflared.list

sudo apt update && sudo apt install cloudflared
```

### 4 — Authenticate and create the tunnel

```bash
cloudflared tunnel login
# Opens a browser window — log in to your Cloudflare account

cloudflared tunnel create fitness-app
# Note the tunnel ID from the output — you need it in step 5
```

### 5 — Configure the tunnel

```bash
mkdir -p ~/.cloudflared
nano ~/.cloudflared/config.yml
```

Paste (replace the placeholders):
```yaml
tunnel: YOUR_TUNNEL_ID_HERE
credentials-file: /root/.cloudflared/YOUR_TUNNEL_ID_HERE.json

ingress:
  - hostname: fitness.yourdomain.com
    service: http://localhost:8080
  - service: http_status:404
```

### 6 — Add the DNS record

```bash
cloudflared tunnel route dns fitness-app fitness.yourdomain.com
```

This creates a CNAME in your Cloudflare DNS pointing to the tunnel. No A record needed, no IP exposed.

### 7 — Start the app

```bash
cd ~/fitness
docker compose up -d

# Test it's healthy
curl http://localhost:8080/api/health   # should return {"ok":true,...}
```

### 8 — Start the tunnel

```bash
# Run once to test
cloudflared tunnel run fitness-app

# Install as a system service (starts on boot)
sudo cloudflared service install
sudo systemctl enable cloudflared
sudo systemctl start cloudflared
```

### 9 — Verify

Open `https://fitness.yourdomain.com` in your browser. Create your profile — you should be prompted for a passkey.

---

## Option B — Cloudflare Pages (frontend) + VPS (backend)

Deploy the React frontend to Cloudflare's global CDN. The backend stays on a VPS,
accessed via Cloudflare's proxied DNS. Gives you the fastest frontend load times
with Cloudflare's edge network serving static assets worldwide.

### Architecture

```
Browser → Cloudflare CDN (Pages) → fitness.yourdomain.com (static frontend)
Browser → Cloudflare Proxy → VPS → fitness.yourdomain.com/api/* (backend)
```

Both on the same domain — Cloudflare routes `/api/*` to the VPS, everything else to Pages.

### 1 — Deploy the frontend to Pages

**Via the dashboard (easiest):**
1. Push your code to GitHub
2. Go to Cloudflare Dashboard → Workers & Pages → Create → Pages → Connect to Git
3. Select your repo and set:
   - **Build command**: `npm run build`
   - **Build output directory**: `dist`
   - **Root directory**: `frontend`
4. Deploy

**Via CLI:**
```bash
cd frontend
npm run build
npx wrangler pages deploy dist --project-name=fitness-app
```

### 2 — Route /api/* to your VPS

In Cloudflare Dashboard → your domain → Rules → Page Rules (or Transform Rules):

Create a rule:
- URL: `fitness.yourdomain.com/api/*`
- Setting: Forwarding URL → `https://YOUR_VPS_IP:8080/api/$1`

Or use a **Cloudflare Worker** as a proxy (cleaner):

```js
// In Cloudflare Dashboard → Workers & Pages → Create Worker
export default {
  async fetch(request) {
    const url = new URL(request.url)
    if (url.pathname.startsWith('/api/')) {
      return fetch('https://YOUR_VPS_IP:8080' + url.pathname + url.search, request)
    }
    return fetch(request)
  }
}
```

### 3 — Set up the VPS backend

Same as Option A steps 1–2, then:

```bash
docker compose up -d
```

Add an A record in Cloudflare DNS pointing `api.fitness.yourdomain.com` (or `fitness.yourdomain.com`) to your VPS IP with the **orange cloud (proxy) enabled**.

---

## Option C — Full Workers + D1 migration (future)

Runs entirely on Cloudflare with no VPS needed — fully serverless.
Requires migrating the Node.js backend to Cloudflare Workers with:

| Current | Cloudflare replacement |
|---|---|
| Flat JSON files (`data/*.json`) | **D1** (SQLite) or **KV** |
| Media uploads (`data/uploads/`) | **R2** (object storage) |
| Push notification VAPID keys | **KV** |
| Session secrets | **Workers Secrets** |

This is a meaningful rewrite — the data layer, file I/O, and a few Node.js-specific
APIs all need updating. Worth doing once the app is stable and getting real traffic.

---

## Cloudflare security settings (all options)

Once live, apply these in Cloudflare Dashboard → your domain:

| Setting | Recommended value |
|---|---|
| SSL/TLS mode | **Full (strict)** |
| Always Use HTTPS | **On** |
| Minimum TLS Version | **TLS 1.2** |
| Bot Fight Mode | **On** |
| Security Level | **Medium** |
| WAF | Enable **OWASP Core Ruleset** |

### Turnstile for sign-up (optional)

Cloudflare Turnstile can protect the "Create profile" button from bots.
Set `CLOUDFLARE_TURNSTILE_SECRET` in `.env` and add the site key to the frontend
env as `VITE_TURNSTILE_KEY` — the login page can check it before registering.

---

## Passkeys and Cloudflare

Passkeys are bound to the exact `RP_ID` hostname in `.env`. A few gotchas:

- `RP_ID` must match the domain users register passkeys on. Changing it later
  invalidates all existing passkeys.
- Cloudflare's proxy does not break passkeys — the browser sees the real domain.
- Cloudflare Access in front of the app breaks passkeys (WebAuthn can't complete
  through Access's auth wall). Use a Cloudflare Tunnel or bypass Access for your
  domain and only protect the admin routes if needed.

---

## Updating the app

```bash
ssh root@YOUR_VPS_IP
cd ~/fitness
git pull
docker compose pull   # get new images
docker compose up -d  # restart with new images
```

The tunnel and DNS config never changes — only the app updates.
