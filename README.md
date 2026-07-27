# Kageki

A unified, secure personal web portal combining home security and encrypted notes (VaultKeeper) into a single Progressive Web App. Formerly "Phantom Portal" — renamed back to Kageki, the original project name.

## Architecture

- **Backend**: Python/FastAPI (unified from Kageki Flask + VaultKeeper Rust/Axum)
- **Frontend**: React PWA (mobile-responsive, installable to home screen)
- **Database**: SQLite with versioned migrations
- **Real-time**: MQTT for motion events, WebSocket for live updates
- **AI**: DeepSeek API for security narration, note intelligence, semantic search
- **Auth**: Tailscale VPN (cyberdeck.tail3ab12c.ts.net MagicDNS hostname)
- **Notifications**: Telegram (existing) + Web Push (new)

## Quick Start

### Prerequisites
- Python 3.14+
- Node.js 20+
- Tailscale (for `cyberdeck.tail3ab12c.ts.net` MagicDNS hostname)
- Mosquitto MQTT broker

### Setup

1. **Clone and prepare**:
   ```bash
   cd /home/jolly/Projects/phantom
   python -m venv venv
   source venv/bin/activate
   pip install -r requirements.txt
   ```

2. **Configure**:
   ```bash
   cp phantom.config.example.yaml phantom.config.yaml
   # Edit phantom.config.yaml with real secrets
   ```

3. **TLS certificate** (required for PWA service workers):
   ```bash
   tailscale cert cyberdeck.tail3ab12c.ts.net
   ```
   Cert will be at `~/.local/share/tailscale/certs/cyberdeck.tail3ab12c.ts.net.crt` and `.key`

4. **Run migrations**:
   ```bash
   python -c "from backend.db.connection import run_migrations_sync; run_migrations_sync()"
   ```

5. **Start services**:
   ```bash
   # Backend (one terminal)
   uvicorn backend.main:app --host 0.0.0.0 --port 8000 \
     --ssl-certfile=~/.local/share/tailscale/certs/cyberdeck.tail3ab12c.ts.net.crt \
     --ssl-keyfile=~/.local/share/tailscale/certs/cyberdeck.tail3ab12c.ts.net.key

   # Motion monitor (another terminal)
   python services/motion_monitor.py

   # Frontend (another terminal)
   cd frontend && pnpm install && pnpm dev
   ```

6. **Access**: https://cyberdeck.tail3ab12c.ts.net from any Tailscale-connected device

## Project Structure

```
phantom/
├── backend/                 # Python/FastAPI
│   ├── main.py              # App factory, MQTT subscriber
│   ├── config.py            # Shared Settings dataclass
│   ├── routers/             # API endpoints
│   ├── services/            # Singleton clients (Blink, HA, AI, etc.)
│   └── db/                  # SQLite + migrations
├── frontend/                # React PWA
│   ├── src/
│   │   ├── panels/          # NotesPanel, SecurityPanel, HomePanel
│   │   ├── stores/          # Zustand state (notes, security, ha)
│   │   ├── api/             # fetch() wrappers for endpoints
│   │   ├── pwa/             # Service worker, push subscription
│   │   └── App.tsx
│   └── vite.config.ts
├── services/                # systemd daemons
│   ├── motion_monitor.py    # Blink polling
│   ├── storage_manager.py   # Clip retention cleanup
│   └── telegram_bot.py      # Telegram command handler
├── deploy/
│   ├── nginx/phantom.conf
│   ├── systemd/             # Service unit files
│   └── docker-compose.yml
└── phantom.config.yaml      # Secrets (gitignored)
```

## Implementation Phases

- **Phase 0** ✅: Foundation (config, migrations, TLS)
- **Phase 1** 🚧: Notes (CRUD, wiki-links, export)
- **Phase 2** 🚧: Security (motion events, camera feed, Telegram)
- **Phase 3** 🚧: AI (DeepSeek narration, titles, semantic search)
- **Phase 4** 🚧: Home Automation (HA lights, scenes, plugs)
- **Phase 5** 🚧: PWA (installable, web push notifications)

## Key Features

### Notes
- Rich text editor (TipTap)
- Wiki-link graph (`[[link]]` syntax)
- Semantic search via DeepSeek embeddings
- AI-generated titles and key points
- Markdown export
- Real-time sync via WebSocket

### Security
- Live Blink camera feed
- Motion event log with AI narration
- Arm/disarm system via Telegram or web UI
- Telegram alerts + web push notifications
- Event history with thumbnail preview

### Home Automation
- Control Home Assistant lights, scenes, smart plugs
- Real-time device state
- One-click scene activation

### AI
- Motion event narration: "Person detected on front porch at high confidence"
- Note intelligence: title suggestions, key-point extraction
- Semantic search: "Find notes about my health"
- AI chat over note library context

## Future: Ollama Migration

The AI service is designed to swap providers via config change only:

```yaml
# phantom.config.yaml
ai:
  provider: ollama                    # change from: deepseek
  base_url: http://localhost:11434/v1
  model: llama3.2                     # or mistral:7b
```

Both DeepSeek and Ollama use the OpenAI-compatible API, so no code changes needed.

## Troubleshooting

### Service worker not registering
- Ensure HTTPS is active (Tailscale cert must be valid)
- Browser console will show exact error
- Clear site cache: DevTools → Storage → Clear Site Data

### MQTT connection errors
- Verify Mosquitto is running: `mosquitto_sub -h localhost -t "$SYS/broker/uptime"`
- Check phantom.config.yaml mosquitto settings
- motion_monitor.py logs to stdout/stderr

### Notes not syncing
- Check WebSocket connection in DevTools Network tab (/ws/sync)
- Backend must be running and reachable
- Browser console will show fetch errors

## Development

Run the full stack in Docker:
```bash
docker-compose up
```

Or run locally with hot reload:
```bash
# Terminal 1: Backend
uvicorn backend.main:app --reload

# Terminal 2: Frontend
cd frontend && pnpm dev

# Terminal 3: Motion monitor
python services/motion_monitor.py
```

## Security Notes

- **No login screen**: Tailscale membership is the auth boundary
- **TLS required**: Self-signed certs from `tailscale cert` are trusted by Tailscale
- **Database**: Encrypted notes stored server-side (not client-side encrypted)
- **Config secrets**: Never commit `phantom.config.yaml`

## License

Private home lab project.
