import asyncio
import json
import logging
from contextlib import asynccontextmanager
from typing import Set

import aiohttp
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
import aiomqtt

from backend.config import get_settings
from backend.db.connection import run_migrations_async
from backend.routers import homeassistant, ai, security, notes, push, cluster, infra
from backend.services.ai_service import DeepSeekClient
from backend.services.ollama_cluster import get_ollama_cluster

log = logging.getLogger(__name__)


# WebSocket connection manager for broadcasting
class ConnectionManager:
    def __init__(self):
        self.active_security: Set[WebSocket] = set()
        self.active_sync: Set[WebSocket] = set()

    async def connect_security(self, ws: WebSocket):
        await ws.accept()
        self.active_security.add(ws)

    async def connect_sync(self, ws: WebSocket):
        await ws.accept()
        self.active_sync.add(ws)

    def disconnect_security(self, ws: WebSocket):
        self.active_security.discard(ws)

    def disconnect_sync(self, ws: WebSocket):
        self.active_sync.discard(ws)

    async def broadcast_security(self, message: dict):
        dead = set()
        for ws in self.active_security:
            try:
                await ws.send_json(message)
            except Exception:
                dead.add(ws)
        self.active_security -= dead

    async def broadcast_sync(self, message: dict):
        dead = set()
        for ws in self.active_sync:
            try:
                await ws.send_json(message)
            except Exception:
                dead.add(ws)
        self.active_sync -= dead


manager = ConnectionManager()

# Global app state for HA connectivity
app_state = {
    "ha_available": False,
}


async def check_home_assistant_connectivity():
    """Check Home Assistant connectivity on startup."""
    settings = get_settings()
    try:
        if not settings.home_assistant.url or not settings.home_assistant.token:
            log.warning("Home Assistant config missing; skipping connectivity check")
            app_state["ha_available"] = False
            return

        headers = {
            "Authorization": f"Bearer {settings.home_assistant.token}",
            "Content-Type": "application/json",
        }

        async with aiohttp.ClientSession() as session:
            try:
                async with session.get(
                    f"{settings.home_assistant.url}/api/states",
                    headers=headers,
                    timeout=aiohttp.ClientTimeout(total=5),
                ) as resp:
                    if resp.status == 200:
                        app_state["ha_available"] = True
                        log.info("Home Assistant is reachable")
                    else:
                        app_state["ha_available"] = False
                        log.warning(f"Home Assistant returned status {resp.status}")
            except asyncio.TimeoutError:
                app_state["ha_available"] = False
                log.warning("Home Assistant connectivity check timed out")
            except Exception as e:
                app_state["ha_available"] = False
                log.warning(f"Home Assistant unreachable: {e}")
    except Exception as e:
        log.error(f"Error in HA connectivity check: {e}")
        app_state["ha_available"] = False


async def mqtt_subscriber():
    """Subscribe to MQTT topics and fan out events to WebSocket clients and services."""
    settings = get_settings()
    ai_client = DeepSeekClient()

    try:
        async with aiomqtt.Client(
            settings.mosquitto.host,
            port=settings.mosquitto.port,
            username=settings.mosquitto.username or None,
            password=settings.mosquitto.password or None,
        ) as client:
            await client.subscribe("kageki/camera/motion")

            async for message in client.messages:
                payload = json.loads(message.payload.decode())

                # Generate AI narration for the motion event
                narration = None
                try:
                    event_dict = {
                        "camera_id": payload.get("camera", "unknown"),
                        "timestamp": payload.get("timestamp"),
                        "confidence": payload.get("confidence", 0.0),
                        "thumbnail_description": payload.get("thumbnail_description", ""),
                    }
                    narration = await ai_client.narrate_motion_event(event_dict)
                except Exception as e:
                    log.error(f"Failed to generate narration: {e}")

                # Broadcast to SecurityPanel WebSocket clients
                broadcast_msg = {
                    "type": "motion_event",
                    "timestamp": payload.get("timestamp"),
                    "camera": payload.get("camera"),
                    "confidence": payload.get("confidence"),
                    "thumbnail_url": payload.get("thumbnail_url"),
                }
                if narration:
                    broadcast_msg["narration"] = narration

                await manager.broadcast_security(broadcast_msg)
    except Exception as e:
        log.error(f"MQTT subscriber error: {e}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    print("Running database migrations...")
    await run_migrations_async()

    print("Checking Home Assistant connectivity...")
    await check_home_assistant_connectivity()

    print("Initializing Ollama cluster...")
    cluster = get_ollama_cluster()
    await cluster.initialize()

    print("Starting MQTT subscriber...")
    mqtt_task = asyncio.create_task(mqtt_subscriber())

    yield

    # Shutdown
    mqtt_task.cancel()
    try:
        await mqtt_task
    except asyncio.CancelledError:
        pass


app = FastAPI(
    title="Phantom Portal",
    description="Unified secure personal web portal",
    version="0.1.0",
    lifespan=lifespan,
)

# CORS for Tailscale-local requests
app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://cyberdeck.tail3ab12c.ts.net", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register routers
app.include_router(notes.router)
app.include_router(security.router)
app.include_router(ai.router)
app.include_router(homeassistant.router)
app.include_router(push.router)
app.include_router(cluster.router)
app.include_router(infra.router)


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "service": "phantom-portal",
        "home_assistant_available": app_state["ha_available"],
    }


# WebSocket endpoints for real-time updates
@app.websocket("/ws/security")
async def websocket_security(ws: WebSocket):
    await manager.connect_security(ws)
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        manager.disconnect_security(ws)


@app.websocket("/ws/sync")
async def websocket_sync(ws: WebSocket):
    await manager.connect_sync(ws)
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        manager.disconnect_sync(ws)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000, ssl_certfile="/home/jolly/Projects/phantom/cyberdeck.tail3ab12c.ts.net.crt", ssl_keyfile="/home/jolly/Projects/phantom/cyberdeck.tail3ab12c.ts.net.key")
