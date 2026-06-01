# pylint: disable=import-error,unused-import
from fastapi import FastAPI
import psycopg2
import openai

app = FastAPI()

conn = psycopg2.connect("postgres://example")

@app.get("/items")
def list_items():
    return {"ok": True}
