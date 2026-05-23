"""
AI service for Phantom Portal
Handles OpenAI-compatible API (DeepSeek, Ollama cluster) for narration, suggestions, embeddings, and streaming chat.
"""

import asyncio
import json
import logging
from datetime import datetime
from typing import AsyncGenerator

from openai import AsyncOpenAI, OpenAI

from backend.config import get_settings
from backend.services.ollama_cluster import get_ollama_cluster

log = logging.getLogger(__name__)


class DeepSeekClient:
    """Singleton wrapper around OpenAI-compatible DeepSeek client."""

    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    def __init__(self):
        if not hasattr(self, "_initialized"):
            settings = get_settings()

            # Sync client for synchronous operations
            self._sync_client = OpenAI(
                api_key=settings.deepseek.api_key,
                base_url=settings.deepseek.base_url,
            )

            # Async client for streaming operations
            self._async_client = AsyncOpenAI(
                api_key=settings.deepseek.api_key,
                base_url=settings.deepseek.base_url,
            )

            self._model = settings.deepseek.model
            self._initialized = True

    async def narrate_motion_event(self, event: dict) -> str:
        """
        Generate a one-sentence narration for a motion detection event.

        Args:
            event: Dict with keys: camera_id, timestamp, confidence, thumbnail_description

        Returns:
            One-sentence narration (e.g., "Person detected on front porch at high confidence")
        """
        camera_id = event.get("camera_id", "unknown")
        timestamp = event.get("timestamp", datetime.now().isoformat())
        confidence = event.get("confidence", 0.0)
        thumbnail_desc = event.get("thumbnail_description", "")

        system_prompt = """You are a security system AI for a Raspberry Pi home security setup.
When you receive motion detection alerts, generate a brief, factual one-sentence narration.
Your narration is used for Telegram alerts and the security log.
Be concise and direct. Do not include emojis or dramatic language.
Example output: "Person detected on front porch at high confidence"."""

        user_prompt = (
            f"Camera: {camera_id}\n"
            f"Timestamp: {timestamp}\n"
            f"Confidence: {confidence:.1%}\n"
            f"Description: {thumbnail_desc}\n\n"
            f"Generate a one-sentence security alert narration."
        )

        try:
            response = await self._async_client.chat.completions.create(
                model=self._model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                max_tokens=128,
                temperature=0.3,
            )
            return response.choices[0].message.content.strip()
        except Exception as e:
            log.error(f"DeepSeek narration failed: {e}")
            return f"Motion detected on {camera_id} at {confidence:.1%} confidence"

    def suggest_titles(self, content: str) -> list[str]:
        """
        Generate 3 title suggestions for note content.

        Args:
            content: The note content to title

        Returns:
            List of 3 suggested titles
        """
        system_prompt = """You are a note-taking assistant helping users find good titles.
Given note content, suggest 3 concise, descriptive titles that capture the essence.
Return ONLY a JSON array of 3 strings, nothing else.
Example: ["Security Alert Log", "Home Automation Notes", "Device Status Update"]"""

        try:
            response = self._sync_client.chat.completions.create(
                model=self._model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": f"Content:\n{content[:500]}"},
                ],
                max_tokens=256,
                temperature=0.7,
            )

            response_text = response.choices[0].message.content.strip()
            suggestions = json.loads(response_text)
            return suggestions[:3]  # Ensure exactly 3
        except Exception as e:
            log.error(f"Title suggestion failed: {e}")
            return [
                "Untitled Note",
                "New Note",
                "Draft",
            ]

    def extract_key_points(self, content: str) -> list[str]:
        """
        Extract 3-5 key points from note content.

        Args:
            content: The note content to analyze

        Returns:
            List of 3-5 key point strings
        """
        system_prompt = """You are a note-taking assistant helping users summarize content.
Given note content, extract the 3-5 most important key points.
Return ONLY a JSON array of strings (each 1-2 sentences), nothing else.
Be factual and concise.
Example: ["Motion detected at 14:32 UTC", "High confidence detection (0.92)", "Archived for review"]"""

        try:
            response = self._sync_client.chat.completions.create(
                model=self._model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": f"Content:\n{content}"},
                ],
                max_tokens=512,
                temperature=0.5,
            )

            response_text = response.choices[0].message.content.strip()
            key_points = json.loads(response_text)
            return key_points[0:5]  # Limit to 5
        except Exception as e:
            log.error(f"Key points extraction failed: {e}")
            return []

    def embed_text(self, text: str) -> list[float]:
        """
        Generate embedding vector for text (for semantic search).
        Routes to AI Pi's nomic-embed-text model for efficient embeddings.

        Args:
            text: The text to embed

        Returns:
            Embedding vector (list of floats)
        """
        try:
            # Use Ollama cluster's nomic-embed-text (on AI Pi for efficiency)
            # The cluster routes this to the AI Pi's specialized embedding model
            response = self._sync_client.embeddings.create(
                model="nomic-embed-text",  # Lightweight embedding model on AI Pi
                input=text,
            )
            return response.data[0].embedding
        except Exception as e:
            log.warning(f"Nomic embeddings failed, returning fallback: {e}")
            # Fallback: simple hash-based "embedding" for demo/testing
            # In production, use a proper embedding model or cache
            import hashlib
            hash_val = hashlib.sha256(text.encode()).digest()
            return [float(b) / 256.0 for b in hash_val[:32]]

    async def chat_streaming(
        self, query: str, note_context: str = ""
    ) -> AsyncGenerator[str, None]:
        """
        Stream chat responses with note context.

        Args:
            query: The user's question
            note_context: Relevant notes to include as context

        Yields:
            Text chunks from the streaming response
        """
        system_prompt = """You are a helpful assistant with access to the user's notes.
Answer questions based on the context provided.
Be concise and factual. If the context doesn't contain relevant information, say so.
Provide clear, organized responses."""

        context_section = ""
        if note_context:
            context_section = f"\n\nUser's Notes Context:\n{note_context}\n"

        full_system = system_prompt + context_section

        try:
            stream = await self._async_client.chat.completions.create(
                model=self._model,
                messages=[
                    {"role": "system", "content": full_system},
                    {"role": "user", "content": query},
                ],
                max_tokens=1024,
                temperature=0.7,
                stream=True,
            )

            async for chunk in stream:
                if chunk.choices[0].delta.content:
                    yield chunk.choices[0].delta.content
        except Exception as e:
            log.error(f"Chat streaming failed: {e}")
            yield f"Error: Unable to process your question right now ({str(e)[:50]})"
