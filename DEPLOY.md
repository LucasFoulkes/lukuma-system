# Deployment

The lukuma_system runs on a Hetzner CX23 (Helsinki) alongside the llm-frontend.

## Server

- **IP:** `204.168.180.2`
- **Public URL:** https://204-168-180-2.sslip.io
- **OS:** Ubuntu 24.04
- **User:** `root` (SSH key auth only)

## SSH

```bash
ssh root@204.168.180.2
```

If your key isn't accepted, make sure `~/.ssh/id_ed25519` exists locally and the public key (`~/.ssh/id_ed25519.pub`) is registered on the server in `/root/.ssh/authorized_keys` or in the Hetzner project's SSH keys section.

## Layout on the server

| Path | What |
|---|---|
| `/opt/lukuma-system` | This repo (cloned from GitHub) |
| `/opt/llm-frontend` | The chat frontend repo |
| `/opt/ecosystem.config.cjs` | pm2 process config for both services |
| `/etc/caddy/Caddyfile` | Reverse proxy + auto HTTPS |
| `/opt/lukuma-system/system.db` | SQLite database |
| `/opt/lukuma-system/downloads/` | Generated PDFs/forms/QR (gitignored) |
| `/opt/lukuma-system/storage/` | Uploaded signatures and croquis (gitignored) |

## Services

Both run under pm2 and auto-start on boot.

| Service | Port | Process name | Source |
|---|---|---|---|
| lukuma | 3001 | `lukuma` | `/opt/lukuma-system/src/engine.js` |
| llm | 3000 | `llm` | `/opt/llm-frontend/src/server.js` |
| Caddy | 80/443 | systemd `caddy` | `/etc/caddy/Caddyfile` |

Caddy routes `https://204-168-180-2.sslip.io`:
- `/api/*`, `/downloads/*`, `/storage/*` → `localhost:3001` (lukuma)
- everything else → `localhost:3000` (llm-frontend)

## Deploy a code change

Always edit locally → push to GitHub → pull on server. Never edit on the server directly.

```bash
# 1. on your laptop
cd ~/Projects/lukuma_system
# ...make edits...
git add -A
git commit -m "what changed"
git push origin main

# 2. on the server
ssh root@204.168.180.2 'cd /opt/lukuma-system && git pull && pm2 restart lukuma'
```

For a llm-frontend change, swap the paths and `pm2 restart llm`.

For both at once:

```bash
ssh root@204.168.180.2 'cd /opt/lukuma-system && git pull && cd /opt/llm-frontend && git pull && pm2 restart lukuma llm'
```

## Common pm2 commands

Run all of these as `root` after SSH'ing in.

```bash
pm2 list                    # status of both services
pm2 logs lukuma             # tail lukuma logs
pm2 logs llm                # tail llm logs
pm2 logs lukuma --lines 50  # last 50 lines, no follow
pm2 restart lukuma          # restart one service
pm2 restart all             # restart everything
pm2 reload all              # zero-downtime reload
pm2 save                    # persist current process list (after add/delete)
```

If you change `/opt/ecosystem.config.cjs` (e.g. update an env var), pm2's `restart --update-env` is unreliable. Do this instead:

```bash
pm2 delete llm                                   # or whichever app
pm2 start /opt/ecosystem.config.cjs --only llm
pm2 save
```

## Caddy

```bash
systemctl status caddy           # is it running
systemctl reload caddy           # apply Caddyfile changes (no downtime)
systemctl restart caddy          # full restart
caddy validate --config /etc/caddy/Caddyfile   # syntax-check before reloading
journalctl -u caddy -n 50        # recent logs
```

## Database

The DB lives at `/opt/lukuma-system/system.db`. To pull a copy down for inspection:

```bash
scp root@204.168.180.2:/opt/lukuma-system/system.db ./system.db.remote
```

To push a local DB up (overwrites the remote — be careful):

```bash
scp ./system.db root@204.168.180.2:/opt/lukuma-system/system.db
ssh root@204.168.180.2 'pm2 restart lukuma'
```

Schema changes live in `src/database.js`. To apply them on the server:

```bash
ssh root@204.168.180.2 'cd /opt/lukuma-system && npx drizzle-kit push'
```

## Environment variables

`/opt/lukuma-system/.env`:

```
JWT_SECRET=<random hex>
PORT=3001
API_BASE=https://204-168-180-2.sslip.io
```

`GEMINI_API_KEY` for the llm service is set inside `/opt/ecosystem.config.cjs`, not in a `.env` file. To rotate it:

```bash
ssh root@204.168.180.2 'sed -i "s/<OLD>/<NEW>/" /opt/ecosystem.config.cjs && pm2 delete llm && pm2 start /opt/ecosystem.config.cjs --only llm && pm2 save'
```

## Troubleshooting

**Site loads but `/api/*` returns 502** — lukuma crashed. `pm2 logs lukuma` for the error, fix, push, pull, restart.

**HTTPS cert won't issue** — Let's Encrypt rate-limited or DNS issue. Check `journalctl -u caddy -n 100`. If sslip.io is the problem, add the DNS-01 challenge fallback or switch to a real domain.

**Puppeteer "libXfixes" or other shared library errors** — install the missing lib and restart lukuma:

```bash
ssh root@204.168.180.2 'apt-get install -y libxfixes3 libxext6 libx11-6 libxcb1 libxss1 libnspr4 libdbus-1-3 libexpat1 libfontconfig1 libfreetype6 libuuid1 && pm2 restart lukuma'
```

**Out of memory / OOM kills** — CX23 has 4 GB. Puppeteer eats 400-600 MB per Chromium launch. If it's a recurring problem, ensure `browser.close()` runs in `finally` (it does in `hiring.js`), or upgrade to CX32.

**Need to roll back a bad deploy** — find the last good commit in GitHub, then on the server:

```bash
ssh root@204.168.180.2 'cd /opt/lukuma-system && git fetch && git reset --hard <commit-sha> && pm2 restart lukuma'
```
