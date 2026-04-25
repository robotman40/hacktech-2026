import fastapi
import google
from ai_api import router as ai_router

app = fastapi.FastAPI()
app.include_router(ai_router, prefix="/api")

