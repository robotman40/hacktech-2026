import logging
import json
import os
import re
from typing import Any

import fastapi
from bs4 import BeautifulSoup
from dotenv import load_dotenv
from google import genai
from google.genai import types

# Load environment variables from .env file
load_dotenv()

# Initialize FastAPI router
router = fastapi.APIRouter()
client = None

def _get_client():
    global client
    if client is not None:
        return client

    api_key = os.environ.get("GOOGLE_API_KEY") or os.environ.get("GEMINI_API_KEY")
    if not api_key:
        return None

    try:
        client = genai.Client(api_key=api_key)
    except Exception:
        logging.exception("Failed to initialize Gemini client")
        client = None
    return client

def _strip_html_tags(html: str) -> str:
    soup = BeautifulSoup(html, "lxml")
    for tag in soup(["script", "style", "noscript"]):
        tag.decompose()
    # get_text with separator preserves some structure
    text = soup.get_text(separator="\n", strip=True)
    # Collapse excessive blank lines
    lines = [line for line in text.splitlines() if line.strip()]
    return "\n".join(lines)


def _normalize_phrase(phrase: str) -> str:
    return re.sub(r"\s+", " ", phrase).strip(" \n\r\t\"'.,:;!?")


def _message_risk_score(text: str) -> int:
    lowered = text.lower()
    score = 0
    if any(token in lowered for token in ["don't tell your parents", "our secret", "special to me", "gift"]):
        score += 18
    if any(token in lowered for token in ["nude", "show me your body", "what are you wearing"]):
        score += 45
    if any(token in lowered for token in ["your address", "where do you live", "what school", "home alone"]):
        score += 28
    if any(token in lowered for token in ["whatsapp", "telegram", "discord", "snapchat", "video chat", "meet me"]):
        score += 24
    if any(token in lowered for token in ["or else", "regret this", "post your", "if you loved me"]):
        score += 30
    return score


def _find_flagged_messages(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    flagged_messages = []
    for message in messages:
        text = str(message.get("text") or "").strip()
        if not text:
            continue

        categories = []
        lowered = text.lower()
        if any(token in lowered for token in ["don't tell your parents", "our secret", "special to me", "gift"]):
            categories.append("GROOMING")
        if any(token in lowered for token in ["nude", "show me your body", "what are you wearing"]):
            categories.append("SEXUAL_CONTENT")
        if any(token in lowered for token in ["your address", "where do you live", "what school", "home alone"]):
            categories.append("PII_SOLICITATION")
        if any(token in lowered for token in ["whatsapp", "telegram", "discord", "snapchat", "video chat", "meet me"]):
            categories.append("PLATFORM_MIGRATION")
        if any(token in lowered for token in ["or else", "regret this", "post your", "if you loved me"]):
            categories.append("THREATS_COERCION")

        if categories:
            flagged_messages.append(
                {
                    "speaker": str(message.get("speaker") or "unknown"),
                    "text": text,
                    "reasons": categories,
                }
            )
    return flagged_messages


def _format_messages(messages: list[dict[str, Any]]) -> str:
    lines = []
    for message in messages:
        text = str(message.get("text") or "").strip()
        if not text:
            continue
        speaker = str(message.get("speaker") or "unknown").strip() or "unknown"
        lines.append(f"{speaker}: {text}")
    return "\n".join(lines)


def _fallback_evaluate(text: str, messages: list[dict[str, Any]] | None = None):
    messages = messages or []
    rules = [
        ("GROOMING", 18, [r"don't tell your parents", r"our secret", r"special to me", r"gift"]),
        ("SEXUAL_CONTENT", 45, [r"nude", r"show me your body", r"what are you wearing"]),
        ("PII_SOLICITATION", 28, [r"your address", r"where do you live", r"what school", r"home alone"]),
        ("PLATFORM_MIGRATION", 24, [r"whatsapp", r"telegram", r"discord", r"snapchat", r"video chat", r"meet me"]),
        ("THREATS_COERCION", 30, [r"or else", r"regret this", r"post your", r"if you loved me"]),
        ("SELF_HARM_CONTENT", 50, [r"kill yourself", r"hurt yourself"]),
        ("HATE_HARASSMENT", 16, [r"worthless", r"stupid", r"hate you"]),
        ("FINANCIAL_SCAM", 30, [r"gift card", r"password", r"login code", r"send me money"]),
        ("OBFUSCATION", 10, [r"s3x", r"m33t", r"p@rk"])
    ]

    lowered = text.lower()
    threats = []
    score = 0
    highest_risk_message = None
    flagged_phrases = []
    for label, weight, patterns in rules:
        matched = []
        for pattern in patterns:
            matched.extend(re.findall(pattern, lowered))
        if matched:
            threats.append(label)
            score += weight
            for phrase in matched[:2]:
                normalized = _normalize_phrase(str(phrase))
                if normalized and normalized not in flagged_phrases:
                    flagged_phrases.append(normalized)

    danger_rating = max(0, min(100, score))
    confidence_score = 28 if not threats else min(90, 48 + len(threats) * 8)
    flagged_messages = _find_flagged_messages(messages)
    if flagged_messages:
        highest_risk_message = max(flagged_messages, key=lambda item: _message_risk_score(item["text"]))["text"]
    elif any(token in lowered for token in ["gift card", "your address", "or else", "whatsapp", "don't tell your parents"]):
        highest_risk_message = text[:200]

    return {
        "danger_rating": danger_rating,
        "confidence_score": confidence_score,
        "evaluation": (
            "Fallback classifier detected potential child-safety risk patterns in the page content."
            if threats
            else "Fallback classifier did not detect a strong child-safety risk pattern in the page content."
        ),
        "threats_detected": threats,
        "flagged_phrases": flagged_phrases[:6],
        "flagged_messages": flagged_messages[:6],
        "recommended_action": (
            "block_and_alert_guardian"
            if danger_rating >= 75
            else "warn_user"
            if danger_rating >= 40
            else "monitor"
            if danger_rating >= 20
            else "none"
        ),
        "highest_risk_message": highest_risk_message
    }


def _normalize_result(payload: dict[str, Any]) -> dict[str, Any]:
    threats = payload.get("threats_detected") or []
    if not isinstance(threats, list):
        threats = [str(threats)]

    flagged_phrases = payload.get("flagged_phrases") or []
    if not isinstance(flagged_phrases, list):
        flagged_phrases = [str(flagged_phrases)]

    flagged_messages = payload.get("flagged_messages") or []
    if not isinstance(flagged_messages, list):
        flagged_messages = []

    recommended_action = str(payload.get("recommended_action") or "none")
    if recommended_action not in {"none", "monitor", "warn_user", "block_and_alert_guardian"}:
        recommended_action = "monitor"

    highest_risk_message = payload.get("highest_risk_message")
    if highest_risk_message is not None:
        highest_risk_message = str(highest_risk_message)

    return {
        "danger_rating": max(0, min(100, int(payload.get("danger_rating", 0) or 0))),
        "confidence_score": max(
            0,
            min(
                100,
                int(
                    payload.get("confidence_score", payload.get("confidence", 0)) or 0
                ),
            ),
        ),
        "evaluation": str(payload.get("evaluation") or "No evaluation returned."),
        "threats_detected": [str(item) for item in threats],
        "flagged_phrases": [str(item) for item in flagged_phrases[:6]],
        "flagged_messages": [
            {
                "speaker": str(item.get("speaker") or "unknown"),
                "text": str(item.get("text") or ""),
                "reasons": [str(reason) for reason in (item.get("reasons") or [])],
            }
            for item in flagged_messages[:6]
            if isinstance(item, dict)
        ],
        "recommended_action": recommended_action,
        "highest_risk_message": highest_risk_message,
    }


def _merge_with_fallback(primary: dict[str, Any], fallback: dict[str, Any]) -> dict[str, Any]:
    merged = dict(primary)
    if not merged.get("threats_detected"):
        merged["threats_detected"] = fallback.get("threats_detected", [])
    if not merged.get("flagged_phrases"):
        merged["flagged_phrases"] = fallback.get("flagged_phrases", [])
    if not merged.get("flagged_messages"):
        merged["flagged_messages"] = fallback.get("flagged_messages", [])
    if not merged.get("highest_risk_message"):
        merged["highest_risk_message"] = fallback.get("highest_risk_message")
    if merged.get("recommended_action") in {None, "", "none"} and fallback.get("recommended_action") not in {None, ""}:
        merged["recommended_action"] = fallback.get("recommended_action")
    return merged

@router.post("/evaluate")
async def evaluate(request: fastapi.Request):
    html = ""
    page_text = ""
    messages: list[dict[str, Any]] = []

    content_type = request.headers.get("content-type", "").lower()
    if "application/json" in content_type:
        body = await request.json()
        html = str(body.get("html") or "")
        page_text = str(body.get("pageText") or "")
        raw_messages = body.get("messages") or []
        if isinstance(raw_messages, list):
            messages = [item for item in raw_messages if isinstance(item, dict)]
    else:
        html = (await request.body()).decode("utf-8")

    stripped_html = _strip_html_tags(html) if html else ""
    analysis_text = page_text.strip() or _format_messages(messages) or stripped_html

    prompt = """You are a child safety classifier evaluating direct messages for signs of harm to minors. Assume the recipient is a child (under 13) unless explicitly stated otherwise.

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
      "flagged_phrases": ["exact short suspicious phrases quoted from the conversation"],
      "flagged_messages": [{"speaker": "sender/receiver/unknown", "text": "full flagged message", "reasons": ["category names"]}],
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

    Here is the extracted conversation transcript if available:\n\n""" + _format_messages(messages) + "\n\nHere is the page text to evaluate:\n\n" + analysis_text
    gemini_client = _get_client()
    if gemini_client is None:
        return _fallback_evaluate(analysis_text, messages)

    try:
        response = gemini_client.models.generate_content(
            model="gemini-2.5-flash",
            contents=prompt,
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                temperature=0.1,
                response_schema={
                    "type": "object",
                    "properties": {
                        "danger_rating": {"type": "integer"},
                        "confidence": {"type": "integer"},
                        "threats_detected": {
                            "type": "array",
                            "items": {"type": "string"},
                        },
                        "flagged_phrases": {
                            "type": "array",
                            "items": {"type": "string"},
                        },
                        "flagged_messages": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "speaker": {"type": "string"},
                                    "text": {"type": "string"},
                                    "reasons": {
                                        "type": "array",
                                        "items": {"type": "string"},
                                    },
                                },
                                "required": ["speaker", "text", "reasons"],
                            },
                        },
                        "evaluation": {"type": "string"},
                        "recommended_action": {
                            "type": "string",
                            "enum": ["none", "monitor", "warn_user", "block_and_alert_guardian"],
                        },
                        "highest_risk_message": {
                            "type": ["string", "null"],
                        },
                    },
                    "required": [
                        "danger_rating",
                        "confidence",
                        "threats_detected",
                        "flagged_phrases",
                        "flagged_messages",
                        "evaluation",
                        "recommended_action",
                        "highest_risk_message",
                    ],
                },
            ),
        )
    except Exception as e:
        logging.exception(f"Gemini call failed: {e}")
        return _fallback_evaluate(analysis_text, messages)

    if not response or not response.text:
        raise fastapi.HTTPException(status_code=502, detail="No response from Gemini")

    try:
        parsed = json.loads(response.text)
        normalized = _normalize_result(parsed)
        fallback = _fallback_evaluate(analysis_text, messages)
        return _merge_with_fallback(normalized, fallback)
    except json.JSONDecodeError:
        return _fallback_evaluate(analysis_text, messages)
