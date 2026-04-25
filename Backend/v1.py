import logging
import json
import os
import re
import urllib.error
import urllib.request
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
K2_API_URL = "https://api.k2think.ai/v1/chat/completions"

RISK_RULES = [
    {
        "label": "GROOMING",
        "weight": 18,
        "patterns": [
            r"don't tell your parents",
            r"our secret",
            r"keep this between us",
            r"delete this chat",
            r"erase this chat",
            r"special to me",
            r"only you understand me",
            r"you're so mature for your age",
            r"you are so mature for your age",
            r"you seem really mature for your age",
            r"i can send you a gift",
            r"tell me when your parents are asleep",
            r"tell me when you are home alone",
            r"they would not understand our connection",
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
            r"i like young girls",
            r"i like underage girls",
            r"i like little girls",
            r"young girls turn me on",
            r"underage girls turn me on",
            r"i'm into young girls",
            r"i'm attracted to young girls",
            r"i prefer younger girls",
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
        "patterns": [
            r"worthless",
            r"stupid",
            r"hate you",
            r"nobody wants you",
            r"nigger",
            r"faggot",
            r"kike",
            r"spic",
            r"chink",
        ],
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

ROLE_WEIGHTS = {
    "sender": 1.0,
    "adult": 1.0,
    "receiver": 0.55,
    "child": 0.55,
    "unknown": 0.8,
}

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


def _extract_json_object(text: str) -> dict[str, Any] | None:
    raw = str(text or "").strip()
    if not raw:
        return None
    raw = re.sub(r"^```(?:json)?\s*", "", raw)
    raw = re.sub(r"\s*```$", "", raw)
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", raw, re.DOTALL)
        if not match:
            return None
        try:
            return json.loads(match.group(0))
        except json.JSONDecodeError:
            return None

def _strip_html_tags(html: str) -> str:
    soup = BeautifulSoup(html, "lxml")
    for tag in soup(["script", "style", "noscript"]):
        tag.decompose()
    # get_text with separator preserves some structure
    text = soup.get_text(separator="\n", strip=True)
    # Collapse excessive blank lines
    lines = [line for line in text.splitlines() if line.strip()]
    return "\n".join(lines)


def _skip_balanced_json_object(s: str, start: int) -> int:
    """Return index after closing `}` for a JSON object starting at `start`, or -1."""
    if start >= len(s) or s[start] != "{":
        return -1
    depth = 0
    in_str = False
    esc = False
    k = start
    while k < len(s):
        c = s[k]
        if in_str:
            if esc:
                esc = False
            elif c == "\\":
                esc = True
            elif c == '"':
                in_str = False
        else:
            if c == '"':
                in_str = True
            elif c == "{":
                depth += 1
            elif c == "}":
                depth -= 1
                if depth == 0:
                    return k + 1
        k += 1
    return -1


def _strip_meta_flight_blobs(text: str) -> str:
    """
    Remove Instagram/Meta-style inline module config (e.g. {"require":[["qplTimingsServerJS",...]]})
    that ends up in page text but is not human chat.
    """
    if not text:
        return text
    out = text
    while True:
        j = out.find('{"require"')
        if j < 0:
            break
        end = _skip_balanced_json_object(out, j)
        if end < 0:
            out = out[:j] + " " + out[j + 1 :]
            continue
        out = out[:j] + " " + out[end:]
    while "HasteSupportData" in out:
        h = out.find("HasteSupportData")
        if h < 0:
            break
        start = out.rfind("{", 0, h)
        if start < 0:
            out = out[:h] + " " + out[h + 16 :]
            break
        end = _skip_balanced_json_object(out, start)
        if end < 0:
            break
        out = out[:start] + " " + out[end:]
    return re.sub(r"\s+", " ", out).strip()


def _is_obvious_page_noise(text: str) -> bool:
    t = (text or "").strip()
    if len(t) < 2:
        return True
    if re.search(r'\{"require"\s*:\s*\[\[', t):
        return True
    if re.search(
        r"HasteSupportData|qplTimingsServerJS|ScheduledServerJS|__bbox|clpData", t, re.I
    ):
        return True
    if len(t) > 60:
        letters = len(re.findall(r"[a-zA-Z]", t))
        structural = len(re.findall(r'[{}[\]":,\\]', t))
        if structural > 25 and letters < structural:
            return True
    return False


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


def _speaker_role(message: dict[str, Any] | None) -> str:
    role = str((message or {}).get("speaker") or "unknown").strip().lower()
    if role in {"sender", "adult"}:
        return "sender"
    if role in {"receiver", "child"}:
        return "receiver"
    return "unknown"


def _is_question_or_prompt(text: str) -> bool:
    normalized = _normalize_for_matching(text)
    starters = [
        "send",
        "move",
        "tell me",
        "what is",
        "what's",
        "where do",
        "when are",
        "call me",
        "text me",
        "add me",
        "give me",
    ]
    return "?" in text or any(normalized.startswith(starter) for starter in starters)


def _message_risk_score(text: str, message: dict[str, Any] | None = None) -> int:
    labels, _phrases, score = _run_rules(text)
    normalized = _normalize_for_matching(text)
    role = _speaker_role(message)
    weighted = int(round(score * ROLE_WEIGHTS.get(role, 0.8)))

    if _is_question_or_prompt(text) and any(label in labels for label in ["PII_SOLICITATION", "GROOMING", "PLATFORM_MIGRATION"]):
        weighted += 6 if role == "sender" else 2

    # A receiver simply acknowledging an app name is lower-signal than a sender directing a move.
    if role == "receiver" and labels == ["PLATFORM_MIGRATION"] and len(normalized.split()) <= 8:
        weighted = max(0, weighted - 12)

    if role == "receiver" and "PII_SOLICITATION" in labels and not _is_question_or_prompt(text):
        weighted = max(0, weighted - 6)

    if any(token in normalized for token in ["nigger", "faggot", "kike", "spic", "chink"]):
        weighted = max(weighted, 40)

    if "delete this chat" in normalized and "parents are asleep" in normalized:
        weighted += 22
    elif "parents are asleep" in normalized or "home alone" in normalized:
        weighted += 12

    return weighted


def _compute_conversation_boosts(messages: list[dict[str, Any]]) -> tuple[int, list[str]]:
    if not messages:
        return 0, []

    boost = 0
    notes = []
    sender_msgs = [m for m in messages if _speaker_role(m) == "sender"]
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

    if any(token in joined_norm for token in ["delete this chat", "keep this between us", "our secret"]) and any(
        token in joined_norm for token in ["parents are asleep", "home alone"]
    ):
        boost += 14
        notes.append("secrecy plus isolation timing")

    sender_questions = sum(1 for m in sender_msgs if "?" in str(m.get("text") or ""))
    receiver_questions = sum(
        1 for m in messages if str(m.get("speaker")) == "receiver" and "?" in str(m.get("text") or "")
    )
    if sender_questions >= 3 and sender_questions > receiver_questions:
        boost += 6
        notes.append("sender-led probing")

    risky_sender_count = 0
    for message in sender_msgs:
        if _message_risk_score(str(message.get("text") or ""), message) >= 24:
            risky_sender_count += 1
    if risky_sender_count >= 2:
        boost += 8
        notes.append("multiple risky sender turns")

    return boost, notes


def _find_flagged_messages(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    flagged_messages = []
    for message in messages:
        text = str(message.get("text") or "").strip()
        if not text:
            continue

        categories, phrases, base_score = _run_rules(text)
        score = _message_risk_score(text, message)

        # Skip weak receiver-only acknowledgements that mention an app name but do not direct or solicit.
        if categories and score >= 14:
            flagged_messages.append(
                {
                    "speaker": _speaker_role(message),
                    "text": text,
                    "reasons": categories,
                    "phrases": phrases,
                    "score": score,
                    "base_score": base_score,
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
    flagged_messages = _find_flagged_messages(messages)

    for item in flagged_messages:
        for reason in item.get("reasons") or []:
            if reason not in threats:
                threats.append(reason)
        for phrase in item.get("phrases") or []:
            if phrase not in flagged_phrases:
                flagged_phrases.append(phrase)

    if flagged_messages:
        strongest_message_score = max(int(item.get("score") or 0) for item in flagged_messages)
        combined_message_score = min(70, sum(int(item.get("score") or 0) for item in flagged_messages[:3]))
        score = max(score, strongest_message_score, combined_message_score)

    conversation_boost, conversation_notes = _compute_conversation_boosts(messages)
    score += conversation_boost
    danger_rating = max(0, min(100, score))
    confidence_score = 28 if not threats else min(94, 50 + len(threats) * 8 + min(conversation_boost, 12))
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
        if not highest_risk_message.strip():
            highest_risk_message = None

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
                "score": int(item.get("score") or 0),
            }
            for item in flagged_messages[:6]
            if isinstance(item, dict)
        ],
        "recommended_action": recommended_action,
        "highest_risk_message": highest_risk_message,
        "platform": str(payload.get("platform") or "generic"),
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


def _k2_prompt(analysis_text: str, messages: list[dict[str, Any]], platform: str) -> str:
    return (
        "You are a fast child-safety classifier for browser chat scans.\n"
        "Return only JSON with this schema:\n"
        "{"
        '"danger_rating": 0, '
        '"confidence": 0, '
        '"threats_detected": [], '
        '"flagged_phrases": [], '
        '"flagged_messages": [{"speaker":"sender","text":"...", "reasons":[], "phrases":[], "score":0}], '
        '"evaluation": "...", '
        '"recommended_action": "none", '
        '"highest_risk_message": "", '
        f'"platform": "{platform}"'
        "}\n"
        "Allowed recommended_action values: none, monitor, warn_user, block_and_alert_guardian.\n"
        "Threat labels must come only from: GROOMING, SEXUAL_CONTENT, PII_SOLICITATION, PLATFORM_MIGRATION, "
        "THREATS_COERCION, SELF_HARM_CONTENT, HATE_HARASSMENT, FINANCIAL_SCAM, OBFUSCATION.\n"
        "Treat secrecy, moving to another app, requests for address/location/school, predatory age interest, hate slurs, "
        "and coercive pressure as strong risk signals.\n"
        "Favor concise evidence and keep evaluation to 1-2 sentences.\n\n"
        "Transcript:\n"
        f"{_format_messages(messages)}\n\n"
        "Page text:\n"
        f"{analysis_text}"
    )


def _call_k2_classifier(analysis_text: str, messages: list[dict[str, Any]], platform: str) -> dict[str, Any] | None:
    api_key = os.environ.get("K2_API_KEY") or os.environ.get("IFM_API_KEY")
    if not api_key:
        return None

    payload = {
        "model": "MBZUAI-IFM/K2-Think-v2",
        "stream": False,
        "messages": [
            {
                "role": "system",
                "content": "Return strict JSON only. No markdown fences. No extra text.",
            },
            {
                "role": "user",
                "content": _k2_prompt(analysis_text, messages, platform),
            },
        ],
        "temperature": 0.1,
    }

    request = urllib.request.Request(
        K2_API_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "accept": "application/json",
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=6) as response:
            raw = response.read().decode("utf-8")
    except urllib.error.HTTPError:
        logging.exception("K2 HTTP request failed")
        return None
    except Exception:
        logging.exception("K2 request failed")
        return None

    payload = _extract_json_object(raw)
    if not payload:
        payload = _extract_json_object(
            (
                json.loads(raw)
                .get("choices", [{}])[0]
                .get("message", {})
                .get("content", "")
            )
            if raw.strip().startswith("{")
            else raw
        )
    if not payload and raw.strip().startswith("{"):
        try:
            parsed_raw = json.loads(raw)
            content = parsed_raw.get("choices", [{}])[0].get("message", {}).get("content", "")
            payload = _extract_json_object(content)
        except Exception:
            payload = None

    if not payload:
        return None

    normalized = _normalize_result(payload)
    normalized["platform"] = platform or normalized.get("platform") or "generic"
    return normalized

@router.post("/evaluate")
async def evaluate(request: fastapi.Request):
    html = ""
    page_text = ""
    messages: list[dict[str, Any]] = []
    platform = "generic"

    content_type = request.headers.get("content-type", "").lower()
    if "application/json" in content_type:
        body = await request.json()
        html = str(body.get("html") or "")
        page_text = str(body.get("pageText") or "")
        platform = str(body.get("platform") or "generic").strip() or "generic"
        raw_messages = body.get("messages") or []
        if isinstance(raw_messages, list):
            messages = [item for item in raw_messages if isinstance(item, dict)]
    else:
        html = (await request.body()).decode("utf-8")

    page_text = _strip_meta_flight_blobs(page_text)
    cleaned_messages: list[dict[str, Any]] = []
    for m in messages:
        if not isinstance(m, dict):
            continue
        t = _strip_meta_flight_blobs(str(m.get("text") or "")).strip()
        if not t or _is_obvious_page_noise(t):
            continue
        row = dict(m)
        row["text"] = t
        cleaned_messages.append(row)
    messages = cleaned_messages

    stripped_html = _strip_html_tags(html) if html else ""
    analysis_text = page_text.strip() or _format_messages(messages) or stripped_html
    analysis_text = _strip_meta_flight_blobs(analysis_text)
    fallback = _fallback_evaluate(analysis_text, messages)
    fallback["platform"] = platform

    k2_result = _call_k2_classifier(analysis_text, messages, platform)
    if k2_result:
        k2_result = _merge_with_fallback(k2_result, fallback)
        confidence = int(k2_result.get("confidence_score") or 0)
        danger = int(k2_result.get("danger_rating") or 0)
        if (danger <= 20 and confidence >= 60) or (danger >= 70 and confidence >= 70):
            return k2_result

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

    Ignore page boilerplate that is not human chat: JSON or JavaScript config strings (e.g. containing "require", "HasteSupportData", "qplTimings"), app telemetry, or minified data blobs. Do not use those for danger_rating, flagged_messages, or highest_risk_message.

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
      "highest_risk_message": "quote of the single most concerning message, or an empty string if none",
      "platform": "instagram/discord/whatsapp/messenger/generic"
    }

    danger_rating guidance:
    - 0-20: benign conversation, no concerning patterns
    - 21-40: mildly concerning (e.g., minor profanity, awkward but not predatory)
    - 41-60: moderate concern (e.g., persistent personal questions, age-inappropriate topics)
    - 61-80: high concern (e.g., PII solicitation, platform migration attempts, sexual undertones)
    - 81-100: severe / immediate danger (e.g., explicit sexual content, meetup requests, sextortion, self-harm encouragement)

    confidence reflects how sure you are of the rating given the available context. Short snippets warrant lower confidence.

    The CONVERSATION section contains structured messages extracted from the page — these are the human chat turns you must evaluate.
    The PAGE TEXT section contains the raw scraped text of the page, which may include UI chrome, navigation elements, and boilerplate mixed with message content.
    If the CONVERSATION section is non-empty, treat it as authoritative for identifying speakers and messages; use PAGE TEXT only to fill gaps or recover messages not captured by the parser.
    Do NOT treat UI labels, timestamp strings, like/reaction counts, or navigation text as message content

    Here is the extracted conversation transcript if available:\n\n""" + _format_messages(messages) + "\n\nHere is the page text to evaluate:\n\n" + analysis_text
    gemini_client = _get_client()
    if gemini_client is None:
        return k2_result or fallback

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
                                    "score": {"type": "integer"},
                                },
                                "required": ["speaker", "text", "reasons", "phrases", "score"],
                            },
                        },
                        "evaluation": {"type": "string"},
                        "recommended_action": {
                            "type": "string",
                            "enum": ["none", "monitor", "warn_user", "block_and_alert_guardian"],
                        },
                        "highest_risk_message": {"type": "string"},
                        "platform": {"type": "string"},
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
                        "platform",
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
        normalized["platform"] = platform
        merged = _merge_with_fallback(normalized, fallback)
        if k2_result:
            merged["confidence_score"] = max(
                int(merged.get("confidence_score") or 0),
                min(100, int(k2_result.get("confidence_score") or 0)),
            )
            if not merged.get("flagged_messages"):
                merged["flagged_messages"] = k2_result.get("flagged_messages", [])
            if not merged.get("flagged_phrases"):
                merged["flagged_phrases"] = k2_result.get("flagged_phrases", [])
        return merged
    except json.JSONDecodeError:
        return k2_result or fallback
