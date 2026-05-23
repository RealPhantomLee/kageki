"""
Telegram notification service for sending alerts via Telegram bot.
Provides async send_message and send_photo methods.
"""

import logging
from functools import lru_cache
from typing import Optional

import aiohttp

from backend.config import get_settings

log = logging.getLogger(__name__)


class TelegramService:
    """Thin async wrapper around Telegram Bot API."""

    def __init__(self, settings):
        """Initialize with bot token and chat ID."""
        self.bot_token = settings.telegram.bot_token
        self.chat_id = settings.telegram.chat_id
        self.base_url = f"https://api.telegram.org/bot{self.bot_token}"

    async def send_message(self, text: str) -> bool:
        """
        Send a text message via Telegram.

        Args:
            text: The message text to send

        Returns:
            True if successful, False otherwise (never raises)
        """
        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    f"{self.base_url}/sendMessage",
                    json={"chat_id": self.chat_id, "text": text},
                    timeout=aiohttp.ClientTimeout(total=10),
                ) as resp:
                    if resp.status == 200:
                        log.debug(f"Telegram message sent successfully")
                        return True
                    else:
                        log.error(f"Telegram sendMessage failed: HTTP {resp.status}")
                        return False
        except Exception as e:
            log.error(f"Failed to send Telegram message: {e}")
            return False

    async def send_photo(self, photo_bytes: bytes, caption: str = "") -> bool:
        """
        Send a photo via Telegram.

        Args:
            photo_bytes: Raw bytes of the photo
            caption: Optional caption for the photo

        Returns:
            True if successful, False otherwise (never raises)
        """
        try:
            async with aiohttp.ClientSession() as session:
                data = aiohttp.FormData()
                data.add_field("chat_id", self.chat_id)
                data.add_field("photo", photo_bytes, filename="photo.jpg")
                if caption:
                    data.add_field("caption", caption)

                async with session.post(
                    f"{self.base_url}/sendPhoto",
                    data=data,
                    timeout=aiohttp.ClientTimeout(total=10),
                ) as resp:
                    if resp.status == 200:
                        log.debug(f"Telegram photo sent successfully")
                        return True
                    else:
                        log.error(f"Telegram sendPhoto failed: HTTP {resp.status}")
                        return False
        except Exception as e:
            log.error(f"Failed to send Telegram photo: {e}")
            return False


@lru_cache(maxsize=1)
def get_telegram_service() -> Optional[TelegramService]:
    """
    Get or create the singleton Telegram service instance.

    Returns None if Telegram is not configured.
    """
    try:
        settings = get_settings()
        if not settings.telegram.bot_token or not settings.telegram.chat_id:
            log.warning("Telegram not configured; service unavailable")
            return None
        return TelegramService(settings)
    except Exception as e:
        log.error(f"Failed to initialize Telegram service: {e}")
        return None
