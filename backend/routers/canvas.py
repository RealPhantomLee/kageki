"""
Canvas endpoints: spatial arrangement of notes on a 2D canvas.
"""

import logging
import uuid
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from backend.db.connection import get_connection

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/canvas", tags=["canvas"])


class CanvasNodeCreate(BaseModel):
    """Request schema for creating a canvas node."""
    note_id: str
    x: float = 0.0
    y: float = 0.0
    width: float = 320.0
    height: float = 180.0


class CanvasNodeUpdate(BaseModel):
    """Request schema for updating a canvas node."""
    x: Optional[float] = None
    y: Optional[float] = None
    width: Optional[float] = None
    height: Optional[float] = None


@router.get("/{canvas_id}/nodes")
async def get_canvas_nodes(canvas_id: str):
    """
    List all nodes on a canvas, joined with note titles.

    Returns: {"nodes": [{"id", "canvas_id", "note_id", "note_title", "x", "y", "width", "height", "created_at"}]}
    """
    db = await get_connection()
    try:
        cursor = await db.execute(
            """
            SELECT cn.id, cn.canvas_id, cn.note_id, n.title,
                   cn.x, cn.y, cn.width, cn.height, cn.created_at
            FROM canvas_nodes cn
            LEFT JOIN notes n ON cn.note_id = n.id
            WHERE cn.canvas_id = ?
            ORDER BY cn.created_at ASC
            """,
            (canvas_id,),
        )
        rows = await cursor.fetchall()
        nodes = [
            {
                "id": r[0],
                "canvas_id": r[1],
                "note_id": r[2],
                "note_title": r[3] or "Untitled",
                "x": r[4],
                "y": r[5],
                "width": r[6],
                "height": r[7],
                "created_at": r[8],
            }
            for r in rows
        ]
        return {"nodes": nodes}
    finally:
        await db.close()


@router.post("/{canvas_id}/nodes")
async def add_canvas_node(canvas_id: str, body: CanvasNodeCreate):
    """
    Add a note to a canvas at given position.

    Returns: {"id": "...", "status": "created"}
    """
    db = await get_connection()
    try:
        # Verify note exists
        cursor = await db.execute("SELECT id FROM notes WHERE id = ?", (body.note_id,))
        if not await cursor.fetchone():
            raise HTTPException(status_code=404, detail="Note not found")

        # Prevent duplicate note on same canvas
        cursor = await db.execute(
            "SELECT id FROM canvas_nodes WHERE canvas_id = ? AND note_id = ?",
            (canvas_id, body.note_id),
        )
        if await cursor.fetchone():
            raise HTTPException(status_code=409, detail="Note already on canvas")

        node_id = str(uuid.uuid4())
        await db.execute(
            """
            INSERT INTO canvas_nodes (id, canvas_id, note_id, x, y, width, height)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (node_id, canvas_id, body.note_id, body.x, body.y, body.width, body.height),
        )
        await db.commit()

        return {"id": node_id, "status": "created"}
    except HTTPException:
        raise
    except Exception as e:
        log.error(f"Error adding canvas node: {e}")
        raise HTTPException(status_code=500, detail="Failed to add node")
    finally:
        await db.close()


@router.put("/{canvas_id}/nodes/{node_id}")
async def update_canvas_node(canvas_id: str, node_id: str, body: CanvasNodeUpdate):
    """
    Update position/size of a canvas node.

    Returns: {"id": "...", "status": "updated"}
    """
    db = await get_connection()
    try:
        cursor = await db.execute(
            "SELECT x, y, width, height FROM canvas_nodes WHERE id = ? AND canvas_id = ?",
            (node_id, canvas_id),
        )
        row = await cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Node not found")

        new_x = body.x if body.x is not None else row[0]
        new_y = body.y if body.y is not None else row[1]
        new_w = body.width if body.width is not None else row[2]
        new_h = body.height if body.height is not None else row[3]

        await db.execute(
            "UPDATE canvas_nodes SET x = ?, y = ?, width = ?, height = ? WHERE id = ?",
            (new_x, new_y, new_w, new_h, node_id),
        )
        await db.commit()
        return {"id": node_id, "status": "updated"}
    except HTTPException:
        raise
    except Exception as e:
        log.error(f"Error updating canvas node: {e}")
        raise HTTPException(status_code=500, detail="Failed to update node")
    finally:
        await db.close()


@router.delete("/{canvas_id}/nodes/{node_id}")
async def remove_canvas_node(canvas_id: str, node_id: str):
    """Remove a note from a canvas."""
    db = await get_connection()
    try:
        cursor = await db.execute(
            "SELECT id FROM canvas_nodes WHERE id = ? AND canvas_id = ?",
            (node_id, canvas_id),
        )
        if not await cursor.fetchone():
            raise HTTPException(status_code=404, detail="Node not found")
        await db.execute("DELETE FROM canvas_nodes WHERE id = ?", (node_id,))
        await db.commit()
        return {"id": node_id, "status": "deleted"}
    finally:
        await db.close()
