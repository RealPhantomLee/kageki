# Phantom Portal — New Session Handoff Prompt

## FIRST ACTION REQUIRED: Interview the User

Before touching any code, interview the user to confirm the current project vision. Ask about:
1. What they see when they open the portal right now (so you know what's working vs broken)
2. Which features are highest priority: visual overhaul vs notes import vs Kubernetes
3. Confirm: do they want Docker containers accessible by Tailscale (private tailnet only) or also public internet?
4. Any new requirements since last session?

Use `AskUserQuestion` with targeted questions. Do NOT skip this step.

---

## Project: Phantom Portal

A unified personal web portal combining home security, notes, and home automation.

**GitHub**: https://github.com/RealPhantomLee/phantom-portal  
**Live URL**: `https://cyberdeck.tail3ab12c.ts.net` (Tailscale tailnet only)  
**Stack**: FastAPI (Python 3.14) + React 18 PWA (TypeScript) + SQLite + nginx + Ollama cluster

---

## Device Inventory & Roles

### 1. cyberdeck — PRIMARY SERVER
- **Hardware**: Raspberry Pi 5, 8GB RAM
- **OS**: Arch Linux ARM (aarch64) — `pacman` package manager, NOT apt/apt-get
- **Tailscale IP**: 100.121.96.1
- **Local IP**: 192.168.1.16 (approx)
- **Role**: Main server hosting the Phantom Portal, all Docker containers, primary Ollama
- **Project path**: `/home/jolly/Projects/phantom/`
- **Services**:
  - `phantom-backend.service` (systemd) — FastAPI on `127.0.0.1:8000`
  - `nginx.service` (systemd) — reverse proxy on `127.0.0.1:7080`
  - `tailscale serve` → `https://cyberdeck.tail3ab12c.ts.net` → nginx:7080
  - 18+ Docker containers (see container list below)
  - Ollama (host) — models: qwen2.5:1.5b, qwen2.5-coder (3b, 7b, 14b), gemma3:latest, deepseek-coder-v2:lite
- **Python venv**: `/home/jolly/Projects/phantom/venv/` (Python 3.14.5)
- **Sudo password**: REDACTED (use `echo "REDACTED" | sudo -S <command>`)
- **NOTE**: /home/jolly has `chmod o+x` — nginx needs this to serve frontend files

### 2. aipi — AI INFERENCE NODE
- **Hardware**: Raspberry Pi 5, 8GB RAM, AI HAT accelerator
- **OS**: Raspberry Pi OS (Debian-based) — use `apt` NOT `pacman`
- **Tailscale IP**: 100.76.179.112
- **Hostname**: aipi (merry@aipi)
- **Role**: Specialized AI inference node for embeddings and secondary LLM tasks
- **Services**:
  - Ollama — models: `llama3.2:3b`, `mistral:7b`, `nomic-embed-text:latest`, `phi3:mini`
  - The Phantom Portal cluster routes embedding requests here via the OllamaCluster service
- **Access**: `ssh pi@192.168.1.15` or `ssh merry@aipi` via Tailscale
- **NOTE**: Uses Raspberry Pi OS (Debian), so install commands differ from cyberdeck

### 3. blacknode — LAPTOP (SECONDARY NODE)
- **Hardware**: Laptop (x86_64)
- **OS**: Arch Linux (standard x86_64) — `pacman` package manager
- **Tailscale IP**: 100.90.234.21
- **Role**: Potential additional k3s agent node, exit node capable
- **Status**: Was offline 2h ago in last check — verify before relying on it
- **NOTE**: This is a laptop, NOT a Raspberry Pi — different architecture from cyberdeck/aipi

### 4. fishbowl — Windows Machine
- **Tailscale IP**: 100.110.136.62
- **Status**: Offline 4+ days — low priority for current tasks

### 5. fishtank — Windows Machine
- **Tailscale IP**: 100.98.224.125
- **Status**: Offline, check before using

### 6. Anonymous iOS device
- **Tailscale IP**: 100.91.177.24
- **Role**: Mobile client for Phantom Portal testing
- **Status**: Active

---

## Current Project File Structure

```
/home/jolly/Projects/phantom/
├── backend/
│   ├── main.py              # FastAPI + MQTT subscriber (lifespan)
│   ├── config.py            # Settings from phantom.config.yaml
│   ├── routers/
│   │   ├── notes.py         # CRUD + wiki-link extraction
│   │   ├── security.py      # Camera, motion events, arm/disarm
│   │   ├── ai.py            # Chat, title suggest, key-points, semantic search
│   │   ├── homeassistant.py # HA lights, scenes, switches
│   │   ├── push.py          # VAPID web push
│   │   └── cluster.py       # Ollama cluster management
│   ├── services/
│   │   ├── ai_service.py    # DeepSeekClient (Ollama-backed)
│   │   ├── ollama_cluster.py # Routes to Main Pi or AI Pi
│   │   ├── blink_service.py # Blink camera API
│   │   ├── ha_service.py    # Home Assistant REST client
│   │   ├── telegram_service.py
│   │   ├── push_service.py  # VAPID push
│   │   └── markdown_utils.py # Wiki-link + tag extraction
│   └── db/
│       ├── connection.py    # WAL-mode SQLite + migration runner
│       └── migrations/
│           ├── 001_notes.sql
│           ├── 002_ai_summary.sql
│           ├── 003_security.sql
│           └── 004_push_subs.sql
├── frontend/
│   ├── src/
│   │   ├── App.tsx          # Narrow icon sidebar, status bars, panel routing
│   │   ├── index.css        # Obsidian theme vars (#0d0d0d bg, #7c3aed accent)
│   │   ├── panels/
│   │   │   ├── NotesPanel.tsx    # 4-zone: tree|editor|backlinks|graph
│   │   │   ├── SecurityPanel.tsx # Camera snapshot, ARM/DISARM, motion feed
│   │   │   └── HomePanel.tsx     # HA lights, scenes, switches
│   │   ├── api/client.ts    # Axios wrappers for all endpoints
│   │   ├── api/websocket.ts # WS manager with auto-reconnect
│   │   └── pwa/             # sw.ts, push.ts, install.ts
│   ├── dist/                # Built frontend (served by nginx)
│   ├── tailwind.config.js   # Obsidian color tokens
│   └── vite.config.ts       # PWA plugin
├── services/
│   ├── motion_monitor.py    # Blink → MQTT publisher
│   └── blink_auth.py        # 2FA helper (user fixing manually, skip this)
├── deploy/
│   ├── nginx/phantom.conf   # nginx on 127.0.0.1:7080, no SSL
│   ├── systemd/             # phantom-backend.service, phantom-motion.service
│   └── docker-compose.yml
├── data/
│   ├── phantom.db           # SQLite (7 tables, all migrations applied)
│   ├── thumbnails/          # Motion event thumbnails
│   └── blink_credentials.json
├── venv/                    # Python 3.14, all packages installed
└── phantom.config.yaml      # All secrets populated (Telegram, HA, Blink, VAPID)
```

---

## Running Docker Containers on cyberdeck

(All managed standalone or via various compose files in /home/jolly/)

| Container | Image | Ports | Notes |
|-----------|-------|-------|-------|
| navidrome | deluan/navidrome | 4533 | Music server |
| grafana | grafana/grafana | 3030→3000 | Metrics dashboard |
| prometheus | prom/prometheus | 9091→9090 | Metrics collection |
| node-red | nodered/node-red | 1880 | Automation flows |
| gitea | gitea/gitea | 3003→3000, 2222 | Git server |
| uptime-kuma | louislam/uptime-kuma | 3004→3001 | Uptime monitoring |
| vaultwarden | vaultwarden/server | (internal) | Password manager |
| ntfy | binwiederhier/ntfy | 80 | Push notifications |
| adguard | adguard/adguardhome | (internal) | DNS + ad blocking |
| wetty | wettyoss/wetty | 3002 | Web terminal |
| filebrowser | filebrowser/filebrowser | 8081 | File manager |
| anythingllm | mintplexlabs/anythingllm | 3001 | Local AI workspace |
| code-server | codercom/code-server | 10080 | VS Code in browser |
| pihole | pihole/pihole | 1053, 11080, 11443 | DNS/ad blocking |
| mosquitto | eclipse-mosquitto:2 | 1883 | MQTT broker |
| homeassistant | ghcr.io/home-assistant/... | 8123 | Smart home hub |
| homarr | ghcr.io/homarr-labs/homarr | 7575 | Dashboard |
| vaultkeeper-sync | compose-vaultkeeper-sync | 3456 | Legacy sync service |

**Port 80**: ntfy container (cannot be moved without finding its run command)  
**Port 443**: tailscaled (Tailscale Serve handles HTTPS externally)

---

## CRITICAL BUG OUTSTANDING: 503 on API endpoints

**Problem**: nginx upstream uses `server localhost:8000` but on Arch Linux, `localhost` resolves to IPv6 `[::1]`. Uvicorn binds IPv4 only (`127.0.0.1:8000`). Result: every `/api/` and `/ws/` request gets "Connection refused" and returns 503.

**File to fix**: `/home/jolly/Projects/phantom/deploy/nginx/phantom.conf` line 2  
**Change**: `server localhost:8000;` → `server 127.0.0.1:8000;`  
**Deploy**: 
```bash
echo "REDACTED" | sudo -S cp /home/jolly/Projects/phantom/deploy/nginx/phantom.conf /etc/nginx/conf.d/phantom.conf
echo "REDACTED" | sudo -S nginx -t && echo "REDACTED" | sudo -S systemctl reload nginx
```
**Test**: `curl https://cyberdeck.tail3ab12c.ts.net/api/notes/`

**This must be the FIRST fix before any frontend work.**

---

## Work Items — Prioritized

### Priority 1: Fix 503 (< 5 min, fix immediately at session start)
See "CRITICAL BUG OUTSTANDING" above.

### Priority 2: Frontend Visual Overhaul

The portal is functional but visually needs improvement. User wants it "way more impressive."

**Known issues**:
- Missing PWA icons (`icon-192.png`, `icon-512.png`, `apple-touch-icon.png`) → nginx 404s on these
- `obsidian-success`, `obsidian-warning`, `obsidian-error` CSS vars exist in `index.css` but NOT in `tailwind.config.js` — Tailwind utility classes like `bg-obsidian-success` compile to nothing
- Bottom status bar ("API Connected", "3 Nodes", "MQTT Live") is hardcoded green, not wired to real state
- Markdown preview in NotesPanel is raw `whitespace-pre-wrap`, not rendered HTML
- AI Chat drawer is not wired to the `/api/ai/chat` endpoint (UI shell only)
- Export endpoint (`GET /api/notes/{id}/export`) doesn't exist in `backend/routers/notes.py` — returns 404
- `SecurityPanel.tsx` has naming collision: `Camera` imported from both `lucide-react` and types file
- Duplicate `<link rel="manifest">` tags in `index.html`
- `theme-color` inconsistency: HTML meta has `#1a1a1a`, manifest has `#7c3aed`

**Desired improvements**:
- Generate SVG/PNG phantom logo icons for all PWA icon sizes
- Glass morphism panel cards (backdrop-filter blur)
- Subtle dot-grid background texture
- Real-time status indicators (poll `/health` every 10s)
- Markdown rendering with syntax highlighting (add `marked` + `highlight.js`)
- Smooth panel transitions, skeleton loaders
- Swipe gestures on mobile (touch events)
- Better typography (Inter or JetBrains Mono)

**Build & deploy cycle**:
```bash
cd /home/jolly/Projects/phantom/frontend
npm run build  # or: pnpm run build
# Then permissions must be set:
echo "REDACTED" | sudo -S chmod -R o+rx /home/jolly/Projects/phantom/frontend/dist
```

### Priority 3: Notes Import Feature

Add import support for 5 sources. No import infrastructure exists — requires both backend and frontend work.

**Backend** — new file: `backend/services/import_service.py`  
**New route**: `POST /api/notes/import` in `backend/routers/notes.py`

Import sources to implement:
1. **Obsidian `.md` files** — already in correct format, just extract H1 as title or use filename; handles `[[wiki-links]]` natively via existing `extract_links()`
2. **Apple Notes `.enex`** — XML format, parse with `xml.etree.ElementTree` (stdlib), convert HTML body to markdown via `html2text` library
3. **Google Docs exported HTML** — use `html2text` to convert
4. **Notion export zip** — unzip, find `.md` files, import each
5. **ChatGPT export zip** — parse `conversations.json` inside ZIP; each conversation becomes one note; format as markdown transcript with `**User:**` and `**Assistant:**` labels; use conversation title as note title

**Required Python packages** (install in venv):
```bash
/home/jolly/Projects/phantom/venv/bin/pip install html2text
```

**Frontend** — add to `frontend/src/panels/NotesPanel.tsx`:
- Import button in left sidebar header (next to New Note)
- File picker dialog with drag-and-drop zone
- Source selector: Markdown | Apple Notes (.enex) | Obsidian (zip/.md) | Google Docs (.html) | Notion (zip) | ChatGPT (zip)
- Progress indicator + "N notes imported" completion toast

### Priority 4: Kubernetes + Container Federation

**Goal**: k3s cluster across cyberdeck + aipi, all Docker containers visible/manageable from Phantom Portal's new InfraPanel.

**IMPORTANT OS DIFFERENCES**:
- **cyberdeck**: Arch Linux ARM → `pacman -S`, systemd, `/etc/systemd/system/`
- **aipi**: Raspberry Pi OS (Debian) → `apt install`, systemd, same paths
- **blacknode**: Arch Linux x86_64 → `pacman -S` (may be available as 3rd node)

**k3s installation — cyberdeck (server node)**:
```bash
# Run on cyberdeck:
curl -sfL https://get.k3s.io | INSTALL_K3S_EXEC="--flannel-iface=tailscale0 --node-ip=100.121.96.1 --tls-san=100.121.96.1 --tls-san=cyberdeck.tail3ab12c.ts.net --disable=traefik" sh -
echo "REDACTED" | sudo -S cat /var/lib/rancher/k3s/server/node-token  # save this
echo "REDACTED" | sudo -S chmod 644 /etc/rancher/k3s/k3s.yaml
export KUBECONFIG=/etc/rancher/k3s/k3s.yaml
kubectl get nodes
```

**k3s installation — aipi (agent node, Raspberry Pi OS)**:
```bash
# Run on aipi (SSH: ssh merry@aipi):
curl -sfL https://get.k3s.io | K3S_URL="https://100.121.96.1:6443" K3S_TOKEN="<token-from-cyberdeck>" INSTALL_K3S_EXEC="--flannel-iface=tailscale0 --node-ip=100.76.179.112" sh -
```

**Key**: Use `--flannel-iface=tailscale0` on BOTH nodes so k3s routes inter-node traffic through Tailscale VPN. This works even if the Pi's are on different physical networks.

**Portainer CE deployment** (manages Docker + K8s from one UI):
```yaml
# deploy/k8s/portainer.yaml
# Portainer server + agent setup via K8s manifest
```

**Docker TCP on aipi** (for remote container inspection):
```bash
# On aipi — enable Docker TCP on Tailscale IP only:
echo '{"hosts": ["unix:///var/run/docker.sock", "tcp://100.76.179.112:2375"]}' | sudo tee /etc/docker/daemon.json
sudo systemctl restart docker
```

**InfraPanel** — new panel in Phantom Portal:
- File: `frontend/src/panels/InfraPanel.tsx`
- Shows: container status from cyberdeck (via Docker SDK) + aipi (via TCP), k3s node status, system metrics (CPU/RAM/disk via psutil)
- Backend: `backend/routers/infra.py` — new router
- Required packages: `docker` (Docker SDK), `psutil`, `kubernetes` (k8s client)

**Adding new devices**: Design InfraPanel to support adding arbitrary Tailscale IP + Docker port combos, stored in a `infra_nodes` table in SQLite. This allows adding blacknode or any future device without code changes.

**Tailscale for ALL Docker containers**:
Each container can be connected to Tailscale one of two ways:
1. **Sidecar approach** (per-container): Add `tailscale/tailscale` sidecar to each docker-compose service — gives each container its own Tailscale IP
2. **Host network approach** (simpler): Containers already inherit the host's Tailscale connectivity since they're on the same host network
3. **Proxy approach** (recommended): Use Tailscale Serve/Funnel per-service so each service gets a `<service>.tail3ab12c.ts.net` subdomain

**Recommended approach**: Use `tailscale serve` per-service to create named endpoints:
```bash
tailscale serve --bg --set-path /grafana http://localhost:3030
tailscale serve --bg --set-path /gitea http://localhost:3003
# etc.
```
Then update Phantom Portal's InfraPanel to link to each `https://cyberdeck.tail3ab12c.ts.net/<service>`.

---

## Networking Architecture (Current)

```
Internet/External
    ↑
Tailscale VPN (end-to-end encrypted)
    ├── cyberdeck (100.121.96.1) — PRIMARY
    │   ├── tailscale serve → https://cyberdeck.tail3ab12c.ts.net → nginx:7080
    │   ├── nginx (127.0.0.1:7080) → FastAPI:8000 + static files
    │   ├── FastAPI (127.0.0.1:8000)
    │   ├── MQTT mosquitto (:1883, Docker)
    │   ├── Ollama (:11434) — main LLM models
    │   └── 17+ Docker services (various ports)
    │
    ├── aipi (100.76.179.112) — AI NODE
    │   ├── Ollama (:11434) — embeddings + secondary LLM
    │   └── Phantom Portal connects via: http://192.168.1.15:11434
    │
    ├── blacknode (100.90.234.21) — LAPTOP (offline)
    ├── fishbowl (100.110.136.62) — Windows (offline)
    ├── fishtank (100.98.224.125) — Windows (offline)
    └── anonymous (100.91.177.24) — iOS client
```

**Target architecture after this session**:
```
Tailscale VPN
    ├── cyberdeck — k3s SERVER + Docker host
    │   └── k3s + Portainer managing all workloads
    ├── aipi — k3s AGENT + Docker host
    │   └── Docker TCP exposed on 100.76.179.112:2375
    └── All services accessible via Tailscale hostnames
```

---

## Sub-Agent Usage Requirement

**CRITICAL: Use sub-agents (parallel Agent tool calls) for ALL independent workstreams.**

Example parallelism:
- Fix 503 (nginx change) + install html2text in venv → parallel
- Frontend icon generation + backend import service + nginx config deploy → parallel
- k3s install on cyberdeck + k3s prep on aipi (separate SSH sessions) → parallel
- Build frontend + update backend + test endpoints → parallel

Never do sequential steps that could run in parallel. Each agent should be briefed with full context since they start cold.

---

## Running the Backend

```bash
# Restart backend after code changes:
echo "REDACTED" | sudo -S systemctl restart phantom-backend

# Check status:
echo "REDACTED" | sudo -S systemctl status phantom-backend --no-pager -l | tail -15

# Check logs:
echo "REDACTED" | sudo -S journalctl -u phantom-backend --no-pager -n 30
```

## Building and Deploying Frontend

```bash
cd /home/jolly/Projects/phantom/frontend
npm run build
# Fix permissions after build (required for nginx to read files):
echo "REDACTED" | sudo -S chmod -R o+rx /home/jolly/Projects/phantom/frontend/dist
echo "REDACTED" | sudo -S chmod o+x /home/jolly/Projects/phantom/frontend
```

## Testing the Stack

```bash
# Health check:
curl https://cyberdeck.tail3ab12c.ts.net/health

# Notes API (should return notes, NOT 503):
curl https://cyberdeck.tail3ab12c.ts.net/api/notes/

# Cluster status:
curl https://cyberdeck.tail3ab12c.ts.net/api/cluster/status
```

---

## What Has Already Been Done (Do NOT redo)

- ✅ Full FastAPI backend with 6 routers (notes, security, ai, ha, push, cluster)
- ✅ SQLite database with 4 migrations, 7 tables, WAL mode
- ✅ React PWA with Obsidian theme (dark, purple accent) — needs visual polish
- ✅ nginx configured on 127.0.0.1:7080 (just needs the 503 fix)
- ✅ Tailscale Serve routing HTTPS → nginx
- ✅ Both Pi Ollama nodes healthy with smart cluster routing
- ✅ Systemd services deployed (phantom-backend, nginx)
- ✅ GitHub repo: https://github.com/RealPhantomLee/phantom-portal
- ✅ All secrets configured (Telegram, HA, Blink, VAPID, MQTT)
- ✅ PWA manifest, service worker, web push VAPID setup
- ✅ All frontend panels: NotesPanel (4-zone), SecurityPanel (command center), HomePanel
- ✅ shadcn/ui component library (Button, Badge, Dialog, Drawer, Tooltip, ScrollArea, Separator)

---

## Memory Files (for this project)

- `/home/jolly/.claude/projects/-home-jolly-Projects/memory/project_phantom_current.md` — full system state
- `/home/jolly/.claude/projects/-home-jolly-Projects/memory/user_profile.md` — user preferences
- `/home/jolly/.claude/plans/i-need-you-to-parallel-shamir.md` — detailed implementation plan

**Start the session by reading these memory files and the plan file for full context.**
