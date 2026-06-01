import requests
from fastapi import FastAPI

app = FastAPI()


def ping():
    return "pong"


@app.get("/items/{item_id}")
async def read_item(item_id: int):
    response = requests.get("https://example.com/items")
    return {"item_id": item_id, "status": response.status_code}

