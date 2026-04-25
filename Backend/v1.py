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

RISK_RULES = [
    {
        "label": "GROOMING",
        "weight": 18,
        "patterns": [
            r"don't tell your parents",
            r"our secret",
            r"keep this between us",
            r"special to me",
            r"only you understand me",
            r"you're so mature for your age",
            r"i can send you a gift",
        ],
    },
    {
        "label": "SEXUAL_CONTENT",
        "weight": 45,
        "patterns": [
            r"nude",
            r"show me your body",
            r"what are you wearing",
            r"send (me )?(a )?pic",
            r"sexy",
            r"turn me on",
        ],
    },
    {
        "label": "PII_SOLICITATION",
        "weight": 28,
        "patterns": [
            r"your address",
            r"where do you live",
            r"what school",
            r"home alone",
            r"send your location",
            r"what part of town",
            r"what is your phone number",
            r"when are your parents home",
        ],
    },
    {
        "label": "PLATFORM_MIGRATION",
        "weight": 24,
        "patterns": [
            r"whatsapp",
            r"telegram",
            r"discord",
            r"snapchat",
            r"signal",
            r"video chat",
            r"call me on",
            r"talk somewhere else",
            r"move to another app",
            r"text me instead",
            r"meet me",
        ],
    },
    {
        "label": "THREATS_COERCION",
        "weight": 30,
        "patterns": [
            r"or else",
            r"regret this",
            r"post your",
            r"if you loved me",
            r"don't make me angry",
            r"i'll ruin your life",
            r"i'll share this",
        ],
    },
    {
        "label": "SELF_HARM_CONTENT",
        "weight": 50,
        "patterns": [r"kill yourself", r"hurt yourself", r"cut yourself"],
    },
    {
        "label": "HATE_HARASSMENT",
        "weight": 16,
        "patterns": [r"worthless", r"stupid", r"hate you", r"nobody wants you"],
    },
    {
        "label": "FINANCIAL_SCAM",
        "weight": 30,
        "patterns": [
            r"gift card",
            r"password",
            r"login code",
            r"send me money",
            r"bank account",
            r"verification code",
        ],
    },
    {
        "label": "OBFUSCATION",
        "weight": 10,
        "patterns": [r"s3x", r"m33t", r"p@rk", r"w h a t s a p p", r"t3l3gr4m"],
    },
]

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


def _normalize_for_matching(text: str) -> str:
    lowered = text.lower()
    lowered = re.sub(r"[@$]", "a", lowered)
    lowered = re.sub(r"0", "o", lowered)
    lowered = re.sub(r"1", "i", lowered)
    lowered = re.sub(r"3", "e", lowered)
    lowered = re.sub(r"5", "s", lowered)
    lowered = re.sub(r"[^a-z0-9\s]", " ", lowered)
    return re.sub(r"\s+", " ", lowered).strip()


def _run_rules(text: str) -> tuple[list[str], list[str], int]:
    normalized = _normalize_for_matching(text)
    labels = []
    phrases = []
    score = 0
    for rule in RISK_RULES:
        matches = []
        for pattern in rule["patterns"]:
            matches.extend(re.findall(pattern, normalized))
        if matches:
            labels.append(rule["label"])
            score += int(rule["weight"])
            for match in matches[:3]:
                phrase = _normalize_phrase(match)
                if phrase and phrase not in phrases:
                    phrases.append(phrase)
    return labels, phrases[:6], score


def _message_risk_score(text: str) -> int:
    labels, _phrases, score = _run_rules(text)
    normalized = _normalize_for_matching(text)
    if "sender" in normalized and "receiver" in normalized:
        score += 2
    if "?" in text and any(label in labels for label in ["PII_SOLICITATION", "GROOMING"]):
        score += 4
    return score


def _compute_conversation_boosts(messages: list[dict[str, Any]]) -> tuple[int, list[str]]:
    if not messages:
        return 0, []

    boost = 0
    notes = []
    sender_msgs = [m for m in messages if str(m.get("speaker")) == "sender"]
    joined_sender = " ".join(str(m.get("text") or "") for m in sender_msgs)
    joined_norm = _normalize_for_matching(joined_sender)

    if "don't tell your parents" in joined_norm and any(
        token in joined_norm for token in ["whatsapp", "telegram", "snapchat", "discord", "signal"]
    ):
        boost += 14
        notes.append("secrecy plus migration pattern")

    if any(token in joined_norm for token in ["your address", "send your location", "where do you live"]) and any(
        token in joined_norm for token in ["meet me", "whatsapp", "call me on", "another app"]
    ):
        boost += 12
        notes.append("contact plus location escalation")

    sender_questions = sum(1 for m in sender_msgs if "?" in str(m.get("text") or ""))
    receiver_questions = sum(
        1 for m in messages if str(m.get("speaker")) == "receiver" and "?" in str(m.get("text") or "")
    )
    if sender_questions >= 3 and sender_questions > receiver_questions:
        boost += 6
        notes.append("sender-led probing")

    return boost, notes


def _find_flagged_messages(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    flagged_messages = []
    for message in messages:
        text = str(message.get("text") or "").strip()
        if not text:
            continue

        categories, phrases, score = _run_rules(text)

        if categories:
            flagged_messages.append(
                {
                    "speaker": str(message.get("speaker") or "unknown"),
                    "text": text,
                    "reasons": categories,
                    "phrases": phrases,
                    "score": score,
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
    threats, flagged_phrases, score = _run_rules(text)

    conversation_boost, conversation_notes = _compute_conversation_boosts(messages)
    score += conversation_boost
    danger_rating = max(0, min(100, score))
    confidence_score = 28 if not threats else min(94, 50 + len(threats) * 8 + min(conversation_boost, 12))
    flagged_messages = _find_flagged_messages(messages)
    if flagged_messages:
        highest_risk_message = max(flagged_messages, key=lambda item: int(item.get("score") or 0))["text"]
    elif any(token in _normalize_for_matching(text) for token in ["gift card", "your address", "or else", "whatsapp", "don't tell your parents"]):
        highest_risk_message = text[:200]
    else:
        highest_risk_message = None

    if conversation_notes and flagged_phrases:
        for note in conversation_notes:
            if note not in flagged_phrases:
                flagged_phrases.append(note)

    return {
        "danger_rating": danger_rating,
        "confidence_score": confidence_score,
        "evaluation": (
            "Fallback classifier detected potential child-safety risk patterns in the conversation."
            if threats
            else "Fallback classifier did not detect a strong child-safety risk pattern in the conversation."
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
                "phrases": [str(phrase) for phrase in (item.get("phrases") or [])],
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
      "flagged_messages": [{"speaker": "sender/receiver/unknown", "text": "full flagged message", "reasons": ["category names"], "phrases": ["matched snippets"]}],
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
                                    "phrases": {
                                        "type": "array",
                                        "items": {"type": "string"},
                                    },
                                },
                                "required": ["speaker", "text", "reasons", "phrases"],
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
