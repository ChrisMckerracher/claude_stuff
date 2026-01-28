"""FastAPI routes for user management."""

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

app = FastAPI()


class User(BaseModel):
    """User model."""

    id: str
    name: str
    email: str


class CreateUserRequest(BaseModel):
    """Request model for creating a user."""

    name: str
    email: str


users_db: dict[str, User] = {}


@app.get("/users/{user_id}")
async def get_user(user_id: str) -> User:
    """Get a user by ID."""
    if user_id not in users_db:
        raise HTTPException(status_code=404, detail="User not found")
    return users_db[user_id]


@app.post("/users")
async def create_user(request: CreateUserRequest) -> User:
    """Create a new user."""
    user_id = str(len(users_db) + 1)
    user = User(id=user_id, name=request.name, email=request.email)
    users_db[user_id] = user
    return user


@app.delete("/users/{user_id}")
async def delete_user(user_id: str) -> dict[str, str]:
    """Delete a user by ID."""
    if user_id not in users_db:
        raise HTTPException(status_code=404, detail="User not found")
    del users_db[user_id]
    return {"status": "deleted"}
