import fastapi
from dotenv import load_dotenv
from google import genai

# Load environment variables from .env file
load_dotenv()

# Initialize FastAPI router
router = fastapi.APIRouter()
# Load Gemini client
client = genai.Client()

# Stub Backend
@router.post("/generate")
async def generate():
    pass