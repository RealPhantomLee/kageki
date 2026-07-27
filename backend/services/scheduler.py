"""
Phantom Scheduler — APScheduler-based background task service.

Tasks:
  daily_note_and_health  — 00:00 daily
  hourly_embedding_sync  — :00 every hour
  weekly_maintenance     — Sunday 03:00
"""

import os
os.environ.setdefault("TZ", "UTC")

import asyncio
import logging
import shutil
import struct
from datetime import datetime, date, timedelta
from functools import partial
from pathlib import Path
from typing import Callable, Awaitable, Optional

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

from backend.db.connection import get_connection, DB_PATH
from backend.services.ai_service import DeepSeekClient
from backend.services.ha_service import HomeAssistantClient
from backend.services.markdown_utils import (
    extract_links, extract_tags, compute_content_hash,
    serialize_json_field, deserialize_json_field,
)

log = logging.getLogger(__name__)

# ─────────────────────────────────────────────────────────────
# Internal utilities
# ─────────────────────────────────────────────────────────────


async def _log_run(task_name: str, status: str, message: str, duration_ms: int):
    """Write task execution log and update task status."""
    db = await get_connection()
    try:
        now = datetime.utcnow().isoformat()
        await db.execute(
            """
            INSERT INTO scheduler_logs (task_name, ran_at, status, message, duration_ms)
            VALUES (?, ?, ?, ?, ?)
            """,
            (task_name, now, status, message, duration_ms),
        )
        await db.execute(
            """
            UPDATE scheduled_tasks
            SET last_run_at = ?, last_status = ?, last_error = ?,
                run_count = run_count + 1
            WHERE name = ?
            """,
            (now, status, message if status == 'error' else None, task_name),
        )
        await db.commit()
    finally:
        await db.close()


async def _update_next_run(task_name: str, next_run: Optional[str]):
    """Update the next_run_at timestamp for a task."""
    db = await get_connection()
    try:
        await db.execute(
            "UPDATE scheduled_tasks SET next_run_at = ? WHERE name = ?",
            (next_run, task_name),
        )
        await db.commit()
    finally:
        await db.close()


async def _with_retry(
    task_name: str,
    coro_fn: Callable[[], Awaitable[str]],
    max_retries: int = 3
) -> None:
    """
    Execute coro_fn with up to max_retries retries and exponential backoff.
    Logs each attempt outcome to scheduler_logs.
    """
    start = datetime.utcnow()
    for attempt in range(max_retries + 1):
        try:
            result_msg = await coro_fn()
            duration_ms = int((datetime.utcnow() - start).total_seconds() * 1000)
            await _log_run(task_name, 'success', result_msg, duration_ms)
            log.info(f"[{task_name}] succeeded: {result_msg}")
            return
        except Exception as e:
            err_msg = str(e)
            log.warning(f"[{task_name}] attempt {attempt + 1} failed: {err_msg}")
            if attempt < max_retries:
                backoff = 2 ** attempt
                log.info(f"[{task_name}] retrying in {backoff}s")
                await asyncio.sleep(backoff)
            else:
                duration_ms = int((datetime.utcnow() - start).total_seconds() * 1000)
                await _log_run(task_name, 'error', err_msg, duration_ms)
                log.error(f"[{task_name}] all retries exhausted: {err_msg}")


# ─────────────────────────────────────────────────────────────
# Task implementations
# ─────────────────────────────────────────────────────────────


async def _daily_note_and_health_impl() -> str:
    """
    Midnight task:
    1. Get or create today's daily note.
    2. Prepend a Weather & System Health summary from HA + psutil.
    """
    import uuid
    import psutil

    today = date.today().isoformat()
    db = await get_connection()
    try:
        # Find or create daily note
        cursor = await db.execute(
            "SELECT id, content FROM notes WHERE title = ? LIMIT 1",
            (today,),
        )
        row = await cursor.fetchone()

        if row:
            note_id, content = row
        else:
            note_id = str(uuid.uuid4())
            content = f"# {today}\n\n"
            now = datetime.utcnow().isoformat()
            await db.execute(
                """INSERT INTO notes (id, title, content, tags, outgoing_links, content_hash, created_at, updated_at)
                VALUES (?, ?, ?, '[]', '[]', ?, ?, ?)""",
                (note_id, today, content, compute_content_hash(content), now, now),
            )
            await db.commit()

        # Collect system health
        cpu = psutil.cpu_percent(interval=1)
        mem = psutil.virtual_memory()
        disk = psutil.disk_usage('/')

        # Collect HA weather (best-effort)
        weather_line = "Weather: unavailable"
        try:
            ha = HomeAssistantClient()
            states = await ha.get("/states")
            if isinstance(states, list):
                weather_state = next(
                    (s for s in states if s.get("entity_id", "").startswith("weather.")), None
                )
                if weather_state:
                    attrs = weather_state.get("attributes", {})
                    weather_line = (
                        f"Weather: {weather_state.get('state', 'unknown')}, "
                        f"{attrs.get('temperature', '?')}°{attrs.get('temperature_unit', 'C')}"
                    )
        except Exception as e:
            log.warning(f"HA weather fetch failed: {e}")

        summary = (
            f"\n\n> [!INFO] System Health — {today}\n"
            f"> {weather_line}\n"
            f"> CPU: {cpu}% | RAM: {mem.percent}% ({round(mem.available / 1e9, 1)} GB free)"
            f" | Disk: {disk.percent}% ({round(disk.free / 1e9, 1)} GB free)\n\n"
        )

        # Prepend if not already present
        if "System Health" not in content:
            new_content = content.rstrip() + summary
            links = extract_links(new_content)
            tags = extract_tags(new_content)
            await db.execute(
                """UPDATE notes SET content = ?, outgoing_links = ?, tags = ?, content_hash = ?, updated_at = ?
                WHERE id = ?""",
                (
                    new_content,
                    serialize_json_field(links),
                    serialize_json_field(tags),
                    compute_content_hash(new_content),
                    datetime.utcnow().isoformat(),
                    note_id,
                ),
            )
            await db.commit()

        return f"Daily note {today} processed: {note_id}"
    finally:
        await db.close()


async def _hourly_embedding_sync_impl() -> str:
    """
    Hourly task: embed notes that have been updated since the last embedding.
    Uses asyncio.sleep(0) between notes to yield to the event loop.
    """
    ai_client = DeepSeekClient()

    db = await get_connection()
    try:
        # Find notes updated more recently than their embedding
        cursor = await db.execute(
            """
            SELECT n.id, n.content
            FROM notes n
            LEFT JOIN note_embeddings ne ON n.id = ne.note_id
            WHERE ne.note_id IS NULL
               OR n.updated_at > ne.embedded_at
            ORDER BY n.updated_at DESC
            LIMIT 50
            """
        )
        rows = await cursor.fetchall()

        if not rows:
            return "No notes need embedding"

        count = 0
        for note_id, content in rows:
            await asyncio.sleep(0)  # Yield to event loop
            try:
                loop = asyncio.get_event_loop()
                embedding = await loop.run_in_executor(
                    None, ai_client.embed_text, content[:4000]
                )
                # Serialize embedding as binary blob (float32 LE)
                blob = struct.pack(f"{len(embedding)}f", *embedding)
                now = datetime.utcnow().isoformat()
                await db.execute(
                    """INSERT OR REPLACE INTO note_embeddings (note_id, embedding, embedded_at)
                    VALUES (?, ?, ?)""",
                    (note_id, blob, now),
                )
                count += 1
            except Exception as e:
                log.warning(f"Failed to embed note {note_id}: {e}")

        await db.commit()
        return f"Embedded {count}/{len(rows)} notes"
    finally:
        await db.close()


async def _weekly_maintenance_impl() -> str:
    """
    Sunday 03:00 task:
    1. VACUUM the SQLite database.
    2. Copy phantom.db to data/backups/phantom_YYYY-MM-DD.db.
    3. Purge backups older than 30 days.
    """
    today_str = date.today().isoformat()
    backup_dir = DB_PATH.parent / "backups"
    backup_dir.mkdir(parents=True, exist_ok=True)
    backup_path = backup_dir / f"phantom_{today_str}.db"

    # VACUUM (must be done outside a transaction, use a fresh connection)
    db = await get_connection()
    try:
        await db.execute("VACUUM")
        await db.commit()
    finally:
        await db.close()

    # Copy DB file in executor
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, shutil.copy2, str(DB_PATH), str(backup_path))

    # Purge old backups (>30 days)
    cutoff = datetime.utcnow() - timedelta(days=30)
    purged = 0
    for f in backup_dir.glob("phantom_*.db"):
        try:
            mtime = datetime.utcfromtimestamp(f.stat().st_mtime)
            if mtime < cutoff:
                f.unlink()
                purged += 1
        except Exception:
            pass

    return f"Vacuumed, backed up to {backup_path.name}, purged {purged} old backups"


# ─────────────────────────────────────────────────────────────
# Scheduler lifecycle
# ─────────────────────────────────────────────────────────────

_scheduler: Optional[AsyncIOScheduler] = None


def get_scheduler() -> AsyncIOScheduler:
    """Get or create the APScheduler instance."""
    global _scheduler
    if _scheduler is None:
        _scheduler = AsyncIOScheduler(timezone="UTC")
    return _scheduler


async def start_scheduler():
    """Initialize and start the APScheduler; call from main.py lifespan."""
    scheduler = get_scheduler()

    # Midnight daily — daily note + health summary
    scheduler.add_job(
        partial(_with_retry, 'daily_note_and_health', _daily_note_and_health_impl),
        CronTrigger(hour=0, minute=0),
        id='daily_note_and_health',
        name='Daily Note & Health',
        replace_existing=True,
        misfire_grace_time=3600,  # 1-hour grace for startup delays
    )

    # Every hour — embedding sync
    scheduler.add_job(
        partial(_with_retry, 'hourly_embedding_sync', _hourly_embedding_sync_impl),
        CronTrigger(minute=0),
        id='hourly_embedding_sync',
        name='Hourly Embedding Sync',
        replace_existing=True,
        misfire_grace_time=1800,
    )

    # Every Sunday at 03:00 — maintenance
    scheduler.add_job(
        partial(_with_retry, 'weekly_maintenance', _weekly_maintenance_impl),
        CronTrigger(day_of_week='sun', hour=3, minute=0),
        id='weekly_maintenance',
        name='Weekly Maintenance',
        replace_existing=True,
        misfire_grace_time=7200,
    )

    scheduler.start()

    # Persist next_run_at for each job after scheduling
    db = await get_connection()
    try:
        for job in scheduler.get_jobs():
            next_run = job.next_run_time.isoformat() if job.next_run_time else None
            await db.execute(
                "UPDATE scheduled_tasks SET next_run_at = ? WHERE name = ?",
                (next_run, job.id),
            )
        await db.commit()
    finally:
        await db.close()

    log.info("Phantom Scheduler started with 3 jobs")


async def stop_scheduler():
    """Graceful shutdown; call from main.py lifespan cleanup."""
    scheduler = get_scheduler()
    if scheduler.running:
        scheduler.shutdown(wait=False)
        log.info("Phantom Scheduler stopped")


async def trigger_task_now(task_name: str) -> bool:
    """Manually trigger a named task. Returns False if task not found."""
    task_map = {
        'daily_note_and_health': _daily_note_and_health_impl,
        'hourly_embedding_sync': _hourly_embedding_sync_impl,
        'weekly_maintenance': _weekly_maintenance_impl,
    }
    impl = task_map.get(task_name)
    if not impl:
        return False
    asyncio.create_task(_with_retry(task_name, impl))
    return True
