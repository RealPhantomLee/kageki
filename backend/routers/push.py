"""
Push notification endpoints for web push notifications.

Handles subscription management, VAPID key distribution, and test notifications.
"""

import json
import logging
from typing import Optional
from datetime import datetime

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field
from pywebpush import webpush, WebPushException

from backend.config import get_settings
from backend.db.connection import get_connection

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/push", tags=["push"])


class PushSubscription(BaseModel):
    """Web push subscription object from browser."""

    endpoint: str = Field(..., description="Push service endpoint URL")
    keys: dict = Field(..., description="Encryption keys {auth, p256dh}")
    expirationTime: Optional[int] = None


class PushSubscribeRequest(BaseModel):
    """Request to subscribe to push notifications."""

    endpoint: str
    keys: dict
    expirationTime: Optional[int] = None


class PushUnsubscribeRequest(BaseModel):
    """Request to unsubscribe from push notifications."""

    endpoint: str


class VapidPublicKeyResponse(BaseModel):
    """Response containing VAPID public key."""

    publicKey: str


@router.get("/vapid-public-key", response_model=VapidPublicKeyResponse)
async def get_vapid_public_key(settings=Depends(get_settings)):
    """
    Get VAPID public key for browser push encryption.

    The client uses this to encrypt subscription data before sending to push service.
    The backend uses the corresponding private key to sign push messages.
    """
    try:
        vapid_public_key = settings.web_push.vapid_public_key
        if not vapid_public_key:
            raise HTTPException(
                status_code=500,
                detail="VAPID public key not configured",
            )

        return VapidPublicKeyResponse(publicKey=vapid_public_key)
    except AttributeError:
        logger.error("Push notifications not configured")
        raise HTTPException(
            status_code=500,
            detail="Push notifications not available",
        )


@router.post("/subscribe")
async def subscribe(request: PushSubscribeRequest, settings=Depends(get_settings)):
    """
    Register a browser's push subscription.

    The client calls this after getting a subscription from the Push Manager.
    The subscription is stored server-side for later use when sending notifications.
    """
    db = None
    try:
        endpoint = request.endpoint

        # Validate endpoint URL
        if not endpoint.startswith("https://"):
            raise HTTPException(
                status_code=400,
                detail="Endpoint must be HTTPS",
            )

        db = await get_connection()

        # Check if already subscribed
        cursor = await db.execute(
            "SELECT id FROM push_subscriptions WHERE endpoint = ?",
            (endpoint,)
        )
        existing = await cursor.fetchone()
        if existing:
            logger.info(f"Subscription already exists for endpoint {endpoint}")
            return {"status": "ok", "message": "Already subscribed"}

        # Add new subscription to database
        await db.execute(
            """INSERT INTO push_subscriptions (endpoint, p256dh, auth, user_agent)
               VALUES (?, ?, ?, ?)""",
            (
                endpoint,
                request.keys.get("p256dh"),
                request.keys.get("auth"),
                None,  # user_agent not provided in request
            )
        )
        await db.commit()

        logger.info(f"Push subscription registered for endpoint {endpoint}")
        return {"status": "ok", "message": "Subscribed successfully"}

    except Exception as e:
        logger.error(f"Failed to subscribe: {e}")
        raise HTTPException(
            status_code=500,
            detail="Failed to subscribe to push notifications",
        )
    finally:
        if db:
            await db.close()


@router.post("/unsubscribe")
async def unsubscribe(request: PushUnsubscribeRequest):
    """
    Unregister a browser's push subscription.

    Called when user clicks "Disable Notifications" or unsubscribes via browser.
    """
    db = None
    try:
        endpoint = request.endpoint
        db = await get_connection()

        # Delete subscription from database
        await db.execute(
            "DELETE FROM push_subscriptions WHERE endpoint = ?",
            (endpoint,)
        )
        await db.commit()

        logger.info(f"Unsubscribed endpoint {endpoint}")
        return {"status": "ok", "message": "Unsubscribed successfully"}

    except Exception as e:
        logger.error(f"Failed to unsubscribe: {e}")
        raise HTTPException(
            status_code=500,
            detail="Failed to unsubscribe",
        )
    finally:
        if db:
            await db.close()


@router.post("/test")
async def send_test_notification(settings=Depends(get_settings)):
    """
    Send a test push notification to the current user.

    Useful for testing the notification system during development.
    """
    db = None
    try:
        db = await get_connection()

        # Fetch all subscriptions from database
        cursor = await db.execute(
            "SELECT endpoint, p256dh, auth FROM push_subscriptions"
        )
        rows = await cursor.fetchall()

        if not rows:
            raise HTTPException(
                status_code=400,
                detail="No active subscriptions",
            )

        # Prepare test notification payload
        payload = {
            "title": "Test Notification",
            "options": {
                "body": "This is a test notification from Phantom Portal",
                "icon": "/icon-192.png",
                "badge": "/icon-192.png",
                "tag": "test-notification",
                "requireInteraction": True,
                "data": {
                    "url": "/",
                    "type": "test",
                    "timestamp": datetime.utcnow().isoformat(),
                },
            },
        }

        sent_count = 0
        failed_count = 0

        # Send notification to each subscription
        for endpoint, p256dh, auth in rows:
            try:
                subscription_info = {
                    "endpoint": endpoint,
                    "keys": {
                        "p256dh": p256dh,
                        "auth": auth,
                    }
                }
                webpush(
                    subscription_info=subscription_info,
                    data=json.dumps(payload),
                    vapid_private_key=settings.web_push.vapid_private_key,
                    vapid_claims={"sub": "mailto:admin@phantom.local"}
                )
                sent_count += 1
            except WebPushException as e:
                if e.response.status_code == 410:
                    # Subscription expired, remove it
                    await db.execute(
                        "DELETE FROM push_subscriptions WHERE endpoint = ?",
                        (endpoint,)
                    )
                    await db.commit()
                failed_count += 1
                logger.error(f"Failed to send push to {endpoint}: {e}")
            except Exception as e:
                failed_count += 1
                logger.error(f"Failed to send push to {endpoint}: {e}")

        logger.info(f"Test notification sent to {sent_count}/{len(rows)} subscriptions")

        return {
            "status": "ok",
            "message": f"Test notification sent to {sent_count}/{len(rows)} subscription(s)",
            "sent": sent_count,
            "failed": failed_count,
        }

    except Exception as e:
        logger.error(f"Failed to send test notification: {e}")
        raise HTTPException(
            status_code=500,
            detail="Failed to send test notification",
        )
    finally:
        if db:
            await db.close()


@router.get("/subscriptions/count")
async def get_subscription_count():
    """
    Get the number of active subscriptions (admin endpoint).

    For monitoring and debugging.
    """
    db = None
    try:
        db = await get_connection()
        cursor = await db.execute("SELECT COUNT(*) FROM push_subscriptions")
        row = await cursor.fetchone()
        total_subs = row[0] if row else 0
        return {"total_subscriptions": total_subs, "users": 1}
    except Exception as e:
        logger.error(f"Error counting subscriptions: {e}")
        return {"total_subscriptions": 0, "users": 0}
    finally:
        if db:
            await db.close()


# Helper function for sending notifications from other parts of the app
async def send_motion_notification(motion_event: dict, settings):
    """
    Send push notification for motion detection.

    Called from the WebSocket broadcaster when a motion event occurs.

    Args:
        motion_event: Dict with keys: camera, timestamp, confidence,
                      thumbnail_url, narration
        settings: App settings with VAPID keys
    """
    db = None
    try:
        db = await get_connection()

        # Fetch all subscriptions from database
        cursor = await db.execute(
            "SELECT endpoint, p256dh, auth FROM push_subscriptions"
        )
        rows = await cursor.fetchall()

        if not rows:
            logger.debug("No subscriptions for motion notification")
            return

        payload = {
            "title": f"Motion Detected - {motion_event.get('camera', 'Unknown')}",
            "options": {
                "body": motion_event.get(
                    "narration", f"Confidence: {motion_event.get('confidence', 0):.0%}"
                ),
                "icon": "/icon-192.png",
                "badge": "/icon-192.png",
                "tag": f"motion-{motion_event.get('camera', 'unknown')}",
                "requireInteraction": True,
                "data": {
                    "url": "/security",
                    "cameraId": motion_event.get("camera"),
                    "timestamp": motion_event.get("timestamp"),
                    "thumbnail": motion_event.get("thumbnail_url"),
                    "narration": motion_event.get("narration"),
                    "confidence": motion_event.get("confidence"),
                },
            },
        }

        logger.info(f"Sending motion notification to {len(rows)} subscriptions")

        # Send notification to each subscription
        for endpoint, p256dh, auth in rows:
            try:
                subscription_info = {
                    "endpoint": endpoint,
                    "keys": {
                        "p256dh": p256dh,
                        "auth": auth,
                    }
                }
                webpush(
                    subscription_info=subscription_info,
                    data=json.dumps(payload),
                    vapid_private_key=settings.web_push.vapid_private_key,
                    vapid_claims={"sub": f"mailto:{settings.web_push.vapid_email}"}
                )
            except WebPushException as e:
                if e.response.status_code == 410:
                    # Subscription expired, remove it
                    await db.execute(
                        "DELETE FROM push_subscriptions WHERE endpoint = ?",
                        (endpoint,)
                    )
                    await db.commit()
                logger.error(f"Failed to send motion notification to {endpoint}: {e}")
            except Exception as e:
                logger.error(f"Failed to send motion notification to {endpoint}: {e}")

    except Exception as e:
        logger.error(f"Error sending motion notification: {e}")
    finally:
        if db:
            await db.close()
