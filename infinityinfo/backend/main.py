
import os

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

load_dotenv()

app = FastAPI(title="InfinityInfo API")

HUNTER_API_KEY = os.getenv("HUNTER_API_KEY")


class EmailSearch(BaseModel):
    first_name: str
    last_name: str
    domain: str


@app.get("/")
def home():
    return {"message": "InfinityInfo API is running"}


@app.post("/find-email")
async def find_email(search: EmailSearch):
    if not HUNTER_API_KEY:
        raise HTTPException(
            status_code=500,
            detail="Hunter API key is not configured",
        )

    params = {
        "first_name": search.first_name,
        "last_name": search.last_name,
        "domain": search.domain,
        "api_key": HUNTER_API_KEY,
    }

    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.get(
            "https://api.hunter.io/v2/email-finder",
            params=params,
        )

    if response.status_code != 200:
        raise HTTPException(
            status_code=response.status_code,
            detail="Hunter email lookup failed",
        )

    result = response.json()["data"]

    return {
        "name": f"{search.first_name} {search.last_name}",
        "email": result.get("email"),
        "confidence": result.get("score"),
        "verification": result.get("verification"),
        "status": "found" if result.get("email") else "not_found",
    }
