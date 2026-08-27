from fastapi import FastAPI
import psycopg2
import requests

app = FastAPI()

conn = psycopg2.connect("postgres://example")

@app.get("/health")
def health():
    response = requests.get("https://api.openai.com/v1/models")
    return {"ok": True, "status": response.status_code}
