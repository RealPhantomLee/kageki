#!/usr/bin/env python3
"""
One-time Blink authentication helper. Simplified version.
"""

import asyncio
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).parent.parent))
from backend.config import get_settings

CREDS_PATH = Path("/home/jolly/Projects/phantom/data/blink_credentials.json")


async def main():
    import aiohttp
    from blinkpy.blinkpy import Blink
    from blinkpy.auth import Auth

    settings = get_settings()

    print(f"Logging in as {settings.blink.username} ...")

    session = aiohttp.ClientSession()
    try:
        blink = Blink(session=session)

        # Create auth with credentials
        auth = Auth({"username": settings.blink.username, "password": settings.blink.password})
        blink.auth = auth

        # Startup will raise BlinkTwoFARequiredError if 2FA is needed
        try:
            await blink.auth.startup()
            print("✓ Startup successful (no 2FA required)")
        except Exception as e:
            if "TwoFA" in type(e).__name__:
                print(f"ℹ 2FA required on this account")
                code = input("Enter the 2FA code sent to your email/phone: ").strip()
                try:
                    result = await blink.auth.complete_2fa_login(code)
                    print(f"✓ 2FA verification result: {result}")
                except Exception as e2:
                    print(f"⚠ 2FA code rejected: {e2}")
                    print("  The code may be expired, incorrect, or 2FA may not be properly configured on the account.")
                    print("  Check your Blink app for the current 2FA settings.")
            else:
                print(f"✗ Startup failed: {e}")
                raise

        # Save credentials
        CREDS_PATH.parent.mkdir(parents=True, exist_ok=True)
        with open(CREDS_PATH, "w") as f:
            json.dump(blink.auth.login_attributes, f, indent=2)

        token_status = "YES ✓" if blink.auth.login_attributes.get("token") else "NO ✗"
        print(f"\n✓ Credentials saved to: {CREDS_PATH}")
        print(f"✓ Token acquired: {token_status}")
        
        if blink.auth.login_attributes.get("token"):
            print("\nNow enable phantom-motion:")
            print("  sudo systemctl enable --now phantom-motion")
        else:
            print("\n⚠ Warning: No token acquired. Check your Blink account.")

    finally:
        await session.close()


if __name__ == "__main__":
    asyncio.run(main())
