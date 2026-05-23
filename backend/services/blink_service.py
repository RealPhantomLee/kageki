import logging
import os
from typing import Optional
from blinkpy.blinkpy import Blink
from blinkpy.auth import Auth
from backend.config import get_settings

logger = logging.getLogger(__name__)


class BlinkService:
    _instance: Optional["BlinkService"] = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._initialized = False
        return cls._instance

    def __init__(self):
        if self._initialized:
            return

        self.settings = get_settings()
        self.blinkpy = None  # Lazy initialization to avoid event loop issue
        self.sync_modules: dict = {}
        self._authenticated = False
        self._initialized = True

    async def authenticate(self) -> bool:
        """Authenticate with Blink cloud."""
        try:
            if self.blinkpy is None:
                self.blinkpy = Blink()

            auth_data = {
                "username": self.settings.blink.username,
                "password": self.settings.blink.password,
                "client_id": os.getenv("BLINK_CLIENT_ID", ""),
            }
            self.blinkpy.auth = Auth(auth_data)
            await self.blinkpy.start()

            # Load networks and sync modules
            await self.blinkpy.networks.get_networks()

            for network_id, network in self.blinkpy.networks.items():
                await network.get_events(http_only=True)

            self._authenticated = True
            logger.info("Blink authentication successful")
            return True
        except Exception as e:
            logger.error(f"Blink authentication failed: {e}")
            self._authenticated = False
            return False

    async def get_cameras(self) -> list[dict]:
        """Get list of all cameras."""
        if not self._authenticated:
            await self.authenticate()

        cameras = []
        try:
            for network_id, network in self.blinkpy.networks.items():
                for camera_id, camera in network.camera_list.items():
                    cameras.append({
                        "id": camera_id,
                        "name": camera.name,
                        "status": camera.status,
                        "network_id": network_id,
                        "enabled": camera.enabled,
                    })
        except Exception as e:
            logger.error(f"Error fetching cameras: {e}")

        return cameras

    async def get_snapshot(self, camera_id: str) -> Optional[bytes]:
        """Download snapshot from camera."""
        if not self._authenticated:
            await self.authenticate()

        try:
            for network_id, network in self.blinkpy.networks.items():
                for cam_id, camera in network.camera_list.items():
                    if cam_id == camera_id:
                        # Request thumbnail
                        thumbnail = await camera.get_thumbnail()
                        if thumbnail:
                            return thumbnail
        except Exception as e:
            logger.error(f"Error fetching snapshot: {e}")

        return None

    async def arm(self, system_id: str, state: bool) -> bool:
        """Arm or disarm the system."""
        if not self._authenticated:
            await self.authenticate()

        try:
            for network_id, network in self.blinkpy.networks.items():
                if network_id == system_id:
                    if state:
                        await network.arm()
                    else:
                        await network.disarm()
                    logger.info(f"System {system_id} armed={state}")
                    return True
        except Exception as e:
            logger.error(f"Error arming/disarming: {e}")

        return False

    async def download_clips(self, camera_id: str, limit: int = 5) -> list[dict]:
        """Get list of recent clips."""
        if not self._authenticated:
            await self.authenticate()

        clips = []
        try:
            for network_id, network in self.blinkpy.networks.items():
                for cam_id, camera in network.camera_list.items():
                    if cam_id == camera_id:
                        # Get media list from Blink (returns last N clips)
                        media = await network.get_media_count()
                        if media:
                            clips.extend(media[:limit])
        except Exception as e:
            logger.error(f"Error fetching clips: {e}")

        return clips


# Singleton instance
blink_service = BlinkService()
