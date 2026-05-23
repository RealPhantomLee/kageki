"""
AI Router for Phantom Portal
Handles AI-powered endpoints: chat, title suggestions, key point extraction, semantic search.
"""

import asyncio
import json
import logging
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
import aiosqlite
import numpy as np

from backend.db.connection import get_connection
from backend.services.ai_service import DeepSeekClient

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/ai", tags=["AI"])

# Initialize AI client
ai_client = DeepSeekClient()


async def _fetch_note_by_id(db: aiosqlite.Connection, note_id: str) -> Optional[dict]:
    """Helper: fetch a single note by ID."""
    cursor = await db.execute(
        "SELECT id, title, content FROM notes WHERE id = ?",
        (note_id,),
    )
    row = await cursor.fetchone()
    if row:
        return {"id": row[0], "title": row[1], "content": row[2]}
    return None


async def _fetch_relevant_notes_for_context(
    db: aiosqlite.Connection, limit: int = 3
) -> str:
    """Helper: fetch recent notes to use as context for chat."""
    cursor = await db.execute(
        "SELECT title, content FROM notes ORDER BY updated_at DESC LIMIT ?",
        (limit,),
    )
    rows = await cursor.fetchall()

    if not rows:
        return ""

    context_parts = []
    for title, content in rows:
        context_parts.append(f"**{title}**\n{content[:200]}")

    return "\n\n".join(context_parts)


def _cosine_similarity(vec_a: list[float], vec_b: list[float]) -> float:
    """Helper: compute cosine similarity between two vectors."""
    if not vec_a or not vec_b:
        return 0.0

    a = np.array(vec_a, dtype=np.float32)
    b = np.array(vec_b, dtype=np.float32)

    norm_a = np.linalg.norm(a)
    norm_b = np.linalg.norm(b)

    if norm_a == 0 or norm_b == 0:
        return 0.0

    return float(np.dot(a, b) / (norm_a * norm_b))


@router.post("/chat")
async def chat_endpoint(request: dict):
    """
    Stream chat response with context from user's notes.

    Request: {"query": "What security events happened today?"}
    Response: Server-Sent Events stream of text chunks
    """
    query = request.get("query", "").strip()

    if not query:
        raise HTTPException(status_code=400, detail="query is required")

    db = await get_connection()
    try:
        # Fetch relevant notes as context
        note_context = await _fetch_relevant_notes_for_context(db, limit=3)

        # Stream the response
        async def generate():
            try:
                async for chunk in ai_client.chat_streaming(query, note_context):
                    yield f"data: {json.dumps({'text': chunk})}\n\n"
            except Exception as e:
                log.error(f"Chat streaming error: {e}")
                yield f"data: {json.dumps({'error': str(e)})}\n\n"

        return StreamingResponse(generate(), media_type="text/event-stream")

    finally:
        await db.close()


@router.post("/notes/{note_id}/suggest-title")
async def suggest_title_endpoint(note_id: str):
    """
    Generate 3 title suggestions for a note.

    Response: {"suggestions": ["Title 1", "Title 2", "Title 3"]}
    """
    db = await get_connection()
    try:
        note = await _fetch_note_by_id(db, note_id)
        if not note:
            raise HTTPException(status_code=404, detail="Note not found")

        suggestions = await asyncio.get_event_loop().run_in_executor(None, ai_client.suggest_titles, note["content"])

        return {"suggestions": suggestions}

    finally:
        await db.close()


@router.post("/notes/{note_id}/key-points")
async def key_points_endpoint(note_id: str):
    """
    Extract key points from note content and store in ai_summary.

    Response: {"key_points": [...], "generated_at": "2025-02-10T14:32:00Z"}
    """
    db = await get_connection()
    try:
        note = await _fetch_note_by_id(db, note_id)
        if not note:
            raise HTTPException(status_code=404, detail="Note not found")

        # Extract key points
        key_points = await asyncio.get_event_loop().run_in_executor(None, ai_client.extract_key_points, note["content"])

        # Store in ai_summary column
        generated_at = datetime.utcnow().isoformat()
        ai_summary_json = json.dumps(key_points)

        await db.execute(
            "UPDATE notes SET ai_summary = ?, ai_summary_generated_at = ? WHERE id = ?",
            (ai_summary_json, generated_at, note_id),
        )
        await db.commit()

        return {
            "key_points": key_points,
            "generated_at": generated_at,
        }

    finally:
        await db.close()


@router.get("/search/semantic")
async def semantic_search_endpoint(query: str):
    """
    Semantic search across notes using embeddings.

    Query: GET /api/search/semantic?query=security%20alerts
    Response: [{"id": "...", "title": "...", "similarity_score": 0.95}, ...]
    """
    if not query or not query.strip():
        raise HTTPException(status_code=400, detail="query parameter required")

    db = await get_connection()
    try:
        # Embed the query
        query_embedding = await asyncio.get_event_loop().run_in_executor(None, ai_client.embed_text, query)

        # Fetch all notes with embeddings
        cursor = await db.execute(
            """
            SELECT n.id, n.title, ne.embedding
            FROM notes n
            LEFT JOIN note_embeddings ne ON n.id = ne.note_id
            ORDER BY n.updated_at DESC
            LIMIT 100
            """
        )
        rows = await cursor.fetchall()

        if not rows:
            return []

        # Calculate similarity scores
        results = []
        for note_id, title, embedding_blob in rows:
            if embedding_blob is None:
                # If no embedding yet, embed the note content
                cursor = await db.execute(
                    "SELECT content FROM notes WHERE id = ?",
                    (note_id,),
                )
                content_row = await cursor.fetchone()
                if content_row:
                    note_embedding = await asyncio.get_event_loop().run_in_executor(None, ai_client.embed_text, content_row[0])
                    # Store it for future use
                    await db.execute(
                        """
                        INSERT OR REPLACE INTO note_embeddings (note_id, embedding)
                        VALUES (?, ?)
                        """,
                        (note_id, bytes(np.array(note_embedding, dtype=np.float32))),
                    )
                else:
                    continue
            else:
                # Deserialize the stored embedding
                note_embedding = np.frombuffer(embedding_blob, dtype=np.float32).tolist()

            similarity = _cosine_similarity(query_embedding, note_embedding)

            if similarity > 0.1:  # Filter low-relevance results
                results.append(
                    {
                        "id": note_id,
                        "title": title,
                        "similarity_score": round(similarity, 3),
                    }
                )

        # Sort by similarity (descending) and return top 5
        results.sort(key=lambda x: x["similarity_score"], reverse=True)

        await db.commit()

        return results[:5]

    finally:
        await db.close()
