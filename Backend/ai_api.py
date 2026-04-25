import fastapi
import google

router = fastapi.APIRouter()
client = google.genai.Client()

@router.post("/generate")
async def generate():
    pass