# run_crawler_api.py (FastAPI 예시)
from fastapi import FastAPI, Request
import subprocess

app = FastAPI()

@app.post("/run-crawler")
async def run_crawler(request: Request):
    body = await request.json()
    phone = body.get("phone")

    if not phone:
        return {"error": "전화번호가 없습니다."}

    try:
        subprocess.Popen(["python3", "admin/modules/crawlers/tworld_crawler.py", phone])
        return {"status": "크롤러 실행됨"}
    except Exception as e:
        return {"error": str(e)}
