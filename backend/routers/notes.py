"""
Notes endpoints for managing personal notes and documents.
"""

import logging
import uuid
from datetime import datetime
from typing import Optional

import aiosqlite
from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from fastapi.responses import Response
from pydantic import BaseModel

from backend.db.connection import get_connection
from backend.services.markdown_utils import (
    extract_links,
    extract_tags,
    compute_content_hash,
    serialize_json_field,
    deserialize_json_field,
)
from backend.services.import_service import (
    import_obsidian_md,
    import_obsidian_vault,
    import_apple_notes_enex,
    import_google_docs_html,
    import_notion_zip,
    import_chatgpt_zip,
)

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/notes", tags=["notes"])


class CreateNoteRequest(BaseModel):
    """Request schema for creating a note."""
    title: str
    content: str


class UpdateNoteRequest(BaseModel):
    """Request schema for updating a note."""
    title: Optional[str] = None
    content: Optional[str] = None


@router.get("/")
async def list_notes():
    """
    List all notes with summaries.

    Returns: {"notes": [{"id": "...", "title": "...", "tags": [...],
                         "outgoing_links": [...], "updated_at": "..."}]}
    """
    db = await get_connection()
    try:
        cursor = await db.execute(
            """
            SELECT id, title, tags, outgoing_links, updated_at
            FROM notes
            ORDER BY updated_at DESC
            """
        )
        rows = await cursor.fetchall()

        notes = []
        for row in rows:
            note_id, title, tags_json, links_json, updated_at = row
            notes.append({
                "id": note_id,
                "title": title,
                "tags": deserialize_json_field(tags_json),
                "outgoing_links": deserialize_json_field(links_json),
                "updated_at": updated_at,
            })

        return {"notes": notes}

    finally:
        await db.close()


@router.get("/{note_id}")
async def get_note(note_id: str):
    """
    Get a specific note with full content.

    Returns: {"id": "...", "title": "...", "content": "...", "tags": [...],
              "outgoing_links": [...], "created_at": "...", "updated_at": "..."}
    """
    db = await get_connection()
    try:
        cursor = await db.execute(
            """
            SELECT id, title, content, tags, outgoing_links, created_at, updated_at
            FROM notes
            WHERE id = ?
            """,
            (note_id,),
        )
        row = await cursor.fetchone()

        if not row:
            raise HTTPException(status_code=404, detail="Note not found")

        note_id, title, content, tags_json, links_json, created_at, updated_at = row
        return {
            "id": note_id,
            "title": title,
            "content": content,
            "tags": deserialize_json_field(tags_json),
            "outgoing_links": deserialize_json_field(links_json),
            "created_at": created_at,
            "updated_at": updated_at,
        }

    finally:
        await db.close()


@router.post("/")
async def create_note(body: CreateNoteRequest):
    """
    Create a new note.

    Request: {"title": "My Note", "content": "..."}
    Returns: {"id": "...", "status": "created", "created_at": "..."}
    """
    title = body.title.strip()
    content = body.content.strip()

    if not title:
        raise HTTPException(status_code=400, detail="title is required")
    if not content:
        raise HTTPException(status_code=400, detail="content is required")

    db = await get_connection()
    try:
        # Generate note ID and timestamp
        note_id = str(uuid.uuid4())
        now = datetime.utcnow().isoformat()

        # Extract links and tags from content
        links = extract_links(content)
        tags = extract_tags(content)

        # Compute content hash for conflict detection
        content_hash = compute_content_hash(content)

        # Serialize links and tags as JSON
        links_json = serialize_json_field(links)
        tags_json = serialize_json_field(tags)

        # Insert into database
        await db.execute(
            """
            INSERT INTO notes (id, title, content, tags, outgoing_links, content_hash, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (note_id, title, content, tags_json, links_json, content_hash, now, now),
        )
        await db.commit()

        log.info(f"Created note {note_id}: {title}")

        return {
            "id": note_id,
            "status": "created",
            "created_at": now,
        }

    except Exception as e:
        log.error(f"Error creating note: {e}")
        raise HTTPException(status_code=500, detail="Failed to create note")

    finally:
        await db.close()


@router.put("/{note_id}")
async def update_note(note_id: str, body: UpdateNoteRequest):
    """
    Update an existing note.

    Request: {"title": "Updated Title", "content": "Updated content"} (either field optional)
    Returns: {"id": "...", "status": "updated", "updated_at": "..."}
    """
    db = await get_connection()
    try:
        # Fetch current note
        cursor = await db.execute(
            "SELECT title, content FROM notes WHERE id = ?",
            (note_id,),
        )
        row = await cursor.fetchone()

        if not row:
            raise HTTPException(status_code=404, detail="Note not found")

        current_title, current_content = row

        # Use provided values or keep existing
        new_title = body.title.strip() if body.title else current_title
        new_content = body.content.strip() if body.content else current_content

        now = datetime.utcnow().isoformat()

        # Extract links and tags from updated content
        links = extract_links(new_content)
        tags = extract_tags(new_content)

        # Compute new content hash
        content_hash = compute_content_hash(new_content)

        # Serialize links and tags as JSON
        links_json = serialize_json_field(links)
        tags_json = serialize_json_field(tags)

        # Update in database
        await db.execute(
            """
            UPDATE notes
            SET title = ?, content = ?, tags = ?, outgoing_links = ?, content_hash = ?, updated_at = ?
            WHERE id = ?
            """,
            (new_title, new_content, tags_json, links_json, content_hash, now, note_id),
        )
        await db.commit()

        log.info(f"Updated note {note_id}")

        return {
            "id": note_id,
            "status": "updated",
            "updated_at": now,
        }

    except HTTPException:
        raise
    except Exception as e:
        log.error(f"Error updating note {note_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to update note")

    finally:
        await db.close()


@router.post("/import")
async def import_notes(source: str = Form(...), file: UploadFile = File(...)):
    """
    Import notes from various formats.

    Request: multipart/form-data with source and file
    - source: markdown|obsidian_vault|enex|html|notion|chatgpt
    - file: upload file

    Returns: {"imported": <count>}
    """
    file_bytes = await file.read()

    try:
        if source == "markdown":
            notes = await import_obsidian_md(file_bytes)
        elif source == "obsidian_vault":
            notes = await import_obsidian_vault(file_bytes)
        elif source == "enex":
            notes = await import_apple_notes_enex(file_bytes)
        elif source == "html":
            notes = await import_google_docs_html(file_bytes)
        elif source == "notion":
            notes = await import_notion_zip(file_bytes)
        elif source == "chatgpt":
            notes = await import_chatgpt_zip(file_bytes)
        else:
            raise HTTPException(status_code=400, detail="Unknown source")

        # Bulk insert
        db = await get_connection()
        try:
            now = datetime.utcnow().isoformat()
            inserted_count = 0

            for note_data in notes:
                note_id = str(uuid.uuid4())
                title = note_data.title.strip()
                content = note_data.content.strip()

                if not title:
                    title = "Untitled"
                if not content:
                    continue

                # Extract links and tags from content
                links = extract_links(content)
                tags = extract_tags(content)

                # Compute content hash for conflict detection
                content_hash = compute_content_hash(content)

                # Serialize links and tags as JSON
                links_json = serialize_json_field(links)
                tags_json = serialize_json_field(tags)

                # Insert into database
                await db.execute(
                    """
                    INSERT INTO notes (id, title, content, tags, outgoing_links, content_hash, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (note_id, title, content, tags_json, links_json, content_hash, now, now),
                )
                inserted_count += 1

            await db.commit()
            log.info(f"Imported {inserted_count} notes from {source}")

            return {"imported": inserted_count}

        finally:
            await db.close()

    except HTTPException:
        raise
    except Exception as e:
        log.error(f"Error importing notes: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to import notes: {str(e)}")


@router.get("/{note_id}/export")
async def export_note(note_id: str):
    """
    Export a note as plaintext markdown file.

    Returns: .md file download with proper markdown headers
    """
    db = await get_connection()
    try:
        cursor = await db.execute(
            "SELECT title, content FROM notes WHERE id = ?",
            (note_id,),
        )
        row = await cursor.fetchone()

        if not row:
            raise HTTPException(status_code=404, detail="Note not found")

        title, content = row
        markdown = f"# {title}\n\n{content}"

        return Response(
            content=markdown,
            media_type="text/markdown",
            headers={"Content-Disposition": f"attachment; filename={note_id}.md"},
        )

    finally:
        await db.close()


@router.delete("/{note_id}")
async def delete_note(note_id: str):
    """
    Delete a note.

    Returns: {"id": "...", "status": "deleted"}
    """
    db = await get_connection()
    try:
        # Check if note exists
        cursor = await db.execute(
            "SELECT id FROM notes WHERE id = ?",
            (note_id,),
        )
        row = await cursor.fetchone()

        if not row:
            raise HTTPException(status_code=404, detail="Note not found")

        # Delete the note (cascades to note_embeddings via foreign key)
        await db.execute(
            "DELETE FROM notes WHERE id = ?",
            (note_id,),
        )
        await db.commit()

        log.info(f"Deleted note {note_id}")

        return {
            "id": note_id,
            "status": "deleted",
        }

    except HTTPException:
        raise
    except Exception as e:
        log.error(f"Error deleting note {note_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to delete note")

    finally:
        await db.close()
