import json
import fastapi
import logging
from dotenv import load_dotenv
from google import genai
from google.genai import types
from bs4 import BeautifulSoup, Comment

# Load environment variables from .env file
load_dotenv()

# Initialize FastAPI router
router = fastapi.APIRouter()
# Load Gemini client
client = genai.Client()

def _strip_html_tags(html: str) -> str:
    soup = BeautifulSoup(html, "lxml")
    for tag in soup(["script", "style", "noscript"]):
        tag.decompose()
    # get_text with separator preserves some structure
    text = soup.get_text(separator="\n", strip=True)
    # Collapse excessive blank lines
    lines = [line for line in text.splitlines() if line.strip()]
    return "\n".join(lines)

@router.post("/evaluate")
async def evaluate(request: fastapi.Request):
    html = _strip_html_tags((await request.body()).decode("utf-8"))
    request = """You are a child safety classifier evaluating direct messages for signs of harm to minors. Assume the recipient is a child (under 13) unless explicitly stated otherwise.

    Evaluate the conversation for the following threat categories. For each, decide whether it is present:

    1. GROOMING — building inappropriate trust, isolating the child from family/friends, normalizing secrecy ("don't tell your parents"), excessive flattery, age-inappropriate emotional intimacy, gift offers, claims of special/unique relationship.

    2. SEXUAL_CONTENT — sexual language, requests for sexual images or descriptions, sharing of sexual content, sexualized roleplay, age-inappropriate romantic advances.

    3. PII_SOLICITATION — requests for real name, address, school, phone number, location, photos of face/home, daily schedule, or when the child is alone.

    4. PLATFORM_MIGRATION — attempts to move conversation to less-monitored platforms (Discord, Snapchat, WhatsApp, Telegram, video chat, in-person meetup). This is a major grooming red flag.

    5. THREATS_COERCION — threats, blackmail, intimidation, sextortion, manipulation through guilt or fear, threats to harm the child or their family.

    6. SELF_HARM_CONTENT — encouragement of self-harm, suicide, eating disorders, or dangerous challenges.

    7. HATE_HARASSMENT — slurs, targeted harassment, bullying, discrimination.

    8. FINANCIAL_SCAM — requests for money, gift cards, account credentials, in-game items under suspicious pretenses.

    9. OBFUSCATION — use of leetspeak, code words, deliberate misspellings, or symbol substitution to evade detection (e.g., "s3x", "m33t", "p@rk"). Note this separately as it elevates concern for any other category present.

    Consider the FULL conversation context, not just individual messages. Grooming unfolds over time — early messages may seem innocent but become alarming in the context of later ones. Conversely, a single concerning message in an otherwise normal exchange may be a joke or misunderstanding.

    When uncertain, err toward flagging. False positives are recoverable; missed grooming is not.

    Return ONLY a JSON object matching this schema:

    {
      "danger_rating": integer 0-100,
      "confidence": integer 0-100,
      "threats_detected": [list of category names from above that are present],
      "evaluation": "2-3 sentence explanation citing specific message content",
      "recommended_action": one of "none" | "monitor" | "warn_user" | "block_and_alert_guardian",
      "highest_risk_message": "quote of the single most concerning message, or null"
    }

    danger_rating guidance:
    - 0-20: benign conversation, no concerning patterns
    - 21-40: mildly concerning (e.g., minor profanity, awkward but not predatory)
    - 41-60: moderate concern (e.g., persistent personal questions, age-inappropriate topics)
    - 61-80: high concern (e.g., PII solicitation, platform migration attempts, sexual undertones)
    - 81-100: severe / immediate danger (e.g., explicit sexual content, meetup requests, sextortion, self-harm encouragement)

    confidence reflects how sure you are of the rating given the available context. Short snippets warrant lower confidence.

    Here is the HTML body to evaluate:\n\n""" + html
    try:
        response = client.models.generate_content(
            model="gemini-3-flash-preview",
            contents=request,
            config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    response_schema={
                        "type": "object",
                        "properties": {
                            "danger_rating": {"type": "integer"},
                            "confidence_score": {"type": "number"},
                            "evaluation": {"type": "string"}
                        },
                        "required": ["danger_rating", "confidence_score", "evaluation"]
                    }
                )
        )
    except Exception as e:
        logging.exception(f"Gemini call failed: {e}")
        raise fastapi.HTTPException(status_code=500, detail="Failed to generate content")

    if not response or not response.text:
        raise fastapi.HTTPException(status_code=502, detail="No response from Gemini")

    try:
        return json.loads(response.text)
    except json.JSONDecodeError:
        raise fastapi.HTTPException(status_code=502, detail="Invalid JSON response from Gemini")
