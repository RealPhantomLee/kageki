import aiosqlite
import sqlite3
from pathlib import Path
from typing import Optional


DB_PATH = Path(__file__).parent.parent.parent / "data" / "phantom.db"
MIGRATIONS_DIR = Path(__file__).parent / "migrations"


def _get_sync_connection() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH))
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    return conn


async def get_connection() -> aiosqlite.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = await aiosqlite.connect(str(DB_PATH))
    await conn.execute("PRAGMA journal_mode=WAL")
    await conn.execute("PRAGMA synchronous=NORMAL")
    await conn.execute("PRAGMA foreign_keys = ON")
    return conn


def _init_schema_versions(conn: sqlite3.Connection):
    conn.execute("""
        CREATE TABLE IF NOT EXISTS schema_versions (
            version INTEGER PRIMARY KEY,
            applied_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
    """)
    conn.commit()


def _get_applied_versions(conn: sqlite3.Connection) -> set[int]:
    cursor = conn.execute("SELECT version FROM schema_versions")
    return {row[0] for row in cursor.fetchall()}


def run_migrations_sync():
    conn = _get_sync_connection()
    try:
        _init_schema_versions(conn)
        applied = _get_applied_versions(conn)

        migration_files = sorted(MIGRATIONS_DIR.glob("*.sql"))

        for migration_file in migration_files:
            version = int(migration_file.stem.split("_")[0])

            if version not in applied:
                with open(migration_file) as f:
                    sql = f.read()
                conn.executescript(sql)
                conn.execute(
                    "INSERT INTO schema_versions (version) VALUES (?)",
                    (version,)
                )
                conn.commit()
                print(f"Applied migration {version}: {migration_file.name}")
    finally:
        conn.close()


async def run_migrations_async():
    conn = await get_connection()
    try:
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS schema_versions (
                version INTEGER PRIMARY KEY,
                applied_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
        """)
        await conn.commit()

        cursor = await conn.execute("SELECT version FROM schema_versions")
        applied = {row[0] for row in await cursor.fetchall()}

        migration_files = sorted(MIGRATIONS_DIR.glob("*.sql"))

        for migration_file in migration_files:
            version = int(migration_file.stem.split("_")[0])

            if version not in applied:
                with open(migration_file) as f:
                    sql = f.read()
                await conn.executescript(sql)
                await conn.execute(
                    "INSERT INTO schema_versions (version) VALUES (?)",
                    (version,)
                )
                await conn.commit()
                print(f"Applied migration {version}: {migration_file.name}")
    finally:
        await conn.close()
