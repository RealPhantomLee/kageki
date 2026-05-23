#!/usr/bin/env python3
"""
Phantom Motion Monitor
Polls Blink for motion events and publishes to MQTT for the backend to fan out.
Runs as a systemd daemon (phantom-motion.service).
"""

import asyncio
import json
import logging
import sys
import time
from datetime import datetime
from pathlib import Path

import aiohttp
import aiomqtt
from blinkpy.blinkpy import Blink
from blinkpy.auth import Auth
from blinkpy.helpers.util import json_load

sys.path.insert(0, str(Path(__file__).parent.parent))
from backend.config import get_settings

BLINK_CREDS_PATH = Path("/home/jolly/Projects/phantom/data/blink_credentials.json")
THUMBNAILS_DIR = Path("/home/jolly/Projects/phantom/data/thumbnails")
POLL_INTERVAL = 30

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [MOTION] %(levelname)s %(message)s",
    handlers=[logging.StreamHandler()],
)
log = logging.getLogger(__name__)


class MotionMonitor:
    def __init__(self):
        self.blink = None
        self.session = None
        self.last_alert_times = {}

    async def start(self):
        settings = get_settings()
        self.session = aiohttp.ClientSession()
        self.blink = Blink(session=self.session)

        if BLINK_CREDS_PATH.exists():
            credentials = await json_load(str(BLINK_CREDS_PATH))
        else:
            credentials = {
                "username": settings.blink.username,
                "password": settings.blink.password,
            }

        auth = Auth(credentials)
        self.blink.auth = auth
        await self.blink.start()

        BLINK_CREDS_PATH.parent.mkdir(parents=True, exist_ok=True)
        with open(BLINK_CREDS_PATH, "w") as f:
            json.dump(self.blink.auth.login_attributes, f)

        log.info(f"Blink connected. Cameras: {list(self.blink.cameras.keys())}")

    async def download_thumbnail(self, url: str, filename: str) -> Path | None:
        THUMBNAILS_DIR.mkdir(parents=True, exist_ok=True)
        path = THUMBNAILS_DIR / filename
        try:
            async with self.session.get(url) as resp:
                if resp.status == 200:
                    path.write_bytes(await resp.read())
                    return path
        except Exception as e:
            log.error(f"Thumbnail download failed: {e}")
        return None

    async def on_motion(self, camera_name: str, thumbnail_url: str):
        last = self.last_alert_times.get(camera_name, 0)
        if time.time() - last < 60:
            return
        self.last_alert_times[camera_name] = time.time()

        ts = datetime.now().isoformat()
        log.info(f"Motion: {camera_name} at {ts}")

        thumb_filename = f"motion_{camera_name}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.jpg"
        thumb_path = await self.download_thumbnail(thumbnail_url, thumb_filename)
        thumbnail_url_local = f"/api/security/thumbnails/{thumb_filename}" if thumb_path else None

        payload = json.dumps({
            "event": "motion",
            "camera": camera_name,
            "timestamp": ts,
            "confidence": 0.85,
            "thumbnail_url": thumbnail_url_local,
            "thumbnail_description": f"Motion detected on {camera_name}",
        })

        try:
            async with aiomqtt.Client("localhost", port=1883) as client:
                await client.publish("kageki/camera/motion", payload=payload)
                log.info(f"MQTT published for {camera_name}")
        except Exception as e:
            log.error(f"MQTT publish error: {e}")

    async def poll_loop(self):
        log.info(f"Polling Blink every {POLL_INTERVAL}s")
        while True:
            try:
                await self.blink.refresh()
                for name, camera in self.blink.cameras.items():
                    if camera.motion_detected:
                        await self.on_motion(name, camera.thumbnail)
            except Exception as e:
                log.error(f"Poll error: {e}")
            await asyncio.sleep(POLL_INTERVAL)

    async def stop(self):
        if self.session:
            await self.session.close()


async def main():
    monitor = MotionMonitor()
    await monitor.start()
    try:
        await monitor.poll_loop()
    except KeyboardInterrupt:
        log.info("Shutting down")
    finally:
        await monitor.stop()


if __name__ == "__main__":
    asyncio.run(main())
