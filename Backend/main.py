import fastapi
import uvicorn
from ai_api import router as ai_router

app = fastapi.FastAPI()
app.include_router(ai_router, prefix="/api")

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)