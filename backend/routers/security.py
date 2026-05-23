import logging
from datetime import datetime
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException, Response
from fastapi.responses import FileResponse
from pydantic import BaseModel

from backend.db.connection import get_connection
from backend.services.blink_service import blink_service

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/security", tags=["security"])


class ArmRequest(BaseModel):
    system_id: str
    state: bool


class SecurityEvent(BaseModel):
    id: str
    timestamp: str
    camera_id: str
    confidence: float
    thumbnail_url: Optional[str] = None
    narration: Optional[str] = None
    created_at: str


@router.get("/cameras")
async def list_cameras():
    """Get all Blink cameras."""
    try:
        cameras = await blink_service.get_cameras()
        return {"cameras": cameras}
    except Exception as e:
        logger.error(f"Error listing cameras: {e}")
        raise HTTPException(status_code=503, detail="Blink service unavailable")


@router.get("/snapshot/{camera_id}")
async def get_snapshot(camera_id: str):
    """Get live snapshot from camera."""
    try:
        snapshot = await blink_service.get_snapshot(camera_id)
        if not snapshot:
            raise HTTPException(status_code=404, detail="Camera not found or snapshot unavailable")
        return Response(content=snapshot, media_type="image/jpeg")
    except Exception as e:
        logger.error(f"Error fetching snapshot: {e}")
        raise HTTPException(status_code=503, detail="Snapshot service unavailable")


@router.get("/events")
async def get_events(limit: int = 50, offset: int = 0):
    """Get motion event history."""
    try:
        conn = await get_connection()
        cursor = await conn.execute("""
            SELECT id, timestamp, camera_id, confidence, thumbnail_url, narration, created_at
            FROM security_events
            ORDER BY timestamp DESC
            LIMIT ? OFFSET ?
        """, (limit, offset))
        rows = await cursor.fetchall()
        await conn.close()

        events = [
            {
                "id": row[0],
                "timestamp": row[1],
                "camera_id": row[2],
                "confidence": row[3],
                "thumbnail_url": row[4],
                "narration": row[5],
                "created_at": row[6],
            }
            for row in rows
        ]
        return {"events": events}
    except Exception as e:
        logger.error(f"Error fetching events: {e}")
        raise HTTPException(status_code=500, detail="Database error")


@router.post("/arm")
async def arm_system(request: ArmRequest):
    """Arm or disarm Blink system."""
    try:
        success = await blink_service.arm(request.system_id, request.state)
        if not success:
            raise HTTPException(status_code=400, detail="Failed to arm/disarm system")
        return {"status": "ok", "armed": request.state}
    except Exception as e:
        logger.error(f"Error arming system: {e}")
        raise HTTPException(status_code=503, detail="Blink service unavailable")


@router.post("/event")
async def log_motion_event(
    timestamp: str,
    camera_id: str,
    confidence: float,
    thumbnail_url: Optional[str] = None,
):
    """Log a motion event (called by motion monitor via MQTT)."""
    try:
        conn = await get_connection()
        await conn.execute("""
            INSERT INTO security_events (timestamp, camera_id, confidence, thumbnail_url)
            VALUES (?, ?, ?, ?)
        """, (timestamp, camera_id, confidence, thumbnail_url))
        await conn.commit()
        await conn.close()
        return {"status": "logged"}
    except Exception as e:
        logger.error(f"Error logging event: {e}")
        raise HTTPException(status_code=500, detail="Database error")


@router.get("/thumbnails/{filename}")
async def get_thumbnail(filename: str):
    """Serve thumbnail images from motion events."""
    thumbnails_dir = Path("/home/jolly/Projects/phantom/data/thumbnails")
    file_path = thumbnails_dir / filename

    # Security: prevent directory traversal
    if not str(file_path.resolve()).startswith(str(thumbnails_dir.resolve())):
        raise HTTPException(status_code=403, detail="Access denied")

    if not file_path.exists():
        raise HTTPException(status_code=404, detail="Thumbnail not found")

    return FileResponse(file_path, media_type="image/jpeg")
