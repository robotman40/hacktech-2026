import fastapi
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
from v1 import router as v1_router

app = fastapi.FastAPI()
app.include_router(v1_router, prefix="/v1")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)