"""HTTP client functions using requests and httpx."""

import requests
import httpx


def fetch_user_sync(base_url: str, user_id: str) -> dict:
    """Fetch a user using requests (sync)."""
    response = requests.get(f"{base_url}/api/users/{user_id}")
    response.raise_for_status()
    return response.json()


def create_user_sync(base_url: str, name: str, email: str) -> dict:
    """Create a user using requests (sync)."""
    response = requests.post(
        f"{base_url}/api/users",
        json={"name": name, "email": email}
    )
    response.raise_for_status()
    return response.json()


async def fetch_user_async(base_url: str, user_id: str) -> dict:
    """Fetch a user using httpx (async)."""
    async with httpx.AsyncClient() as client:
        response = await client.get(f"{base_url}/api/users/{user_id}")
        response.raise_for_status()
        return response.json()


async def notify_service(endpoint: str, message: str) -> None:
    """Send notification to external service."""
    async with httpx.AsyncClient() as client:
        await client.post(f"{endpoint}/notify", json={"message": message})
