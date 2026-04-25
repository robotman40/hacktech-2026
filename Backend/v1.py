import logging
import json
import os
import re
import urllib.error
import urllib.request
import unicodedata
from dataclasses import dataclass, field
from difflib import SequenceMatcher
from typing import Any

import fastapi
from pydantic import BaseModel
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
_SOCIAL_DOMAINS: set[str] = {
    "instagram.com",
    "facebook.com",
    "messenger.com",
    "discord.com",
    "whatsapp.com",
    "web.whatsapp.com",
    "snapchat.com",
    "tiktok.com",
    "x.com",
    "twitter.com",
    "reddit.com",
    "youtube.com",
    "threads.net",
    "bsky.app",
    "mastodon.social",
}

@dataclass
class PatternRule:
    label: str
    weight: int
    pattern: str | None = None
    match_type: str = "regex"
    severity: str = "medium"
    requires_target: bool = False
    sender_only_bonus: int = 0
    notes: str = ""
    aliases: list[str] = field(default_factory=list)
    compiled: re.Pattern[str] | None = field(init=False, default=None)

    def __post_init__(self):
        if self.pattern and self.match_type == "regex":
            self.compiled = re.compile(self.pattern, re.I)


LEET_MAP = str.maketrans({
    "@": "a",
    "$": "s",
    "0": "o",
    "1": "i",
    "3": "e",
    "4": "a",
    "5": "s",
    "7": "t",
    "+": "t",
    "!": "i",
})

SECOND_PERSON = {"you", "your", "ur", "u", "youre", "you're", "youre", "yourself"}
GROUP_REFERENCES = {
    "they",
    "them",
    "those people",
    "these people",
    "your family",
    "your parents",
}
SAFE_CONTEXT_PATTERNS = [
    r"\bhe called me\b",
    r"\bshe called me\b",
    r"\bthey called me\b",
    r"\bsomeone called me\b",
    r"\bthe word\b",
    r"\bthis article\b",
    r"\bfor moderation\b",
    r"\bclassifier\b",
    r"\btraining data\b",
    r"\bexample\b",
    r"\bfor testing\b",
    r"\btest case\b",
]

HIGH_SEVERITY_HATE_TERMS = [
    "nigger",
    "nigga",
    "faggot",
    "kike",
    "spic",
    "chink",
    "gook",
    "raghead",
    "wetback",
]

FUZZY_PLATFORM_TERMS = [
    "whatsapp",
    "telegram",
    "snapchat",
    "discord",
    "signal",
]

SEVERE_THREAT_TERMS = [
    "i will kill you",
    "im going to kill you",
    "i am going to kill you",
    "i will murder you",
    "i will shoot you",
    "i will stab you",
    "i will beat you",
    "i will hunt you down",
    "i will find you",
    "i know where you live",
    "you are dead",
    "you re dead",
    "i will make you disappear",
    "i will kill your family",
]

RISK_RULES = [
    PatternRule("GROOMING", 18, r"\bdon t tell your parents\b", severity="high"),
    PatternRule("GROOMING", 18, r"\bdo not tell your parents\b", severity="high"),
    PatternRule("GROOMING", 18, r"\bour secret\b", severity="high"),
    PatternRule("GROOMING", 18, r"\bkeep this between us\b", severity="high"),
    PatternRule("GROOMING", 18, r"\bdelete this chat\b", severity="high"),
    PatternRule("GROOMING", 18, r"\berase this chat\b", severity="high"),
    PatternRule("GROOMING", 14, r"\bspecial to me\b"),
    PatternRule("GROOMING", 16, r"\bonly you understand me\b"),
    PatternRule("GROOMING", 18, r"\byou(?: re| are)? so mature for your age\b", severity="high"),
    PatternRule("GROOMING", 18, r"\byou seem really mature for your age\b", severity="high"),
    PatternRule("GROOMING", 14, r"\bi can send you a gift\b"),
    PatternRule("GROOMING", 20, r"\btell me when your parents are asleep\b", severity="high", sender_only_bonus=4),
    PatternRule("GROOMING", 20, r"\btell me when you are home alone\b", severity="high", sender_only_bonus=4),
    PatternRule("GROOMING", 16, r"\bthey would not understand our connection\b", severity="high"),

    PatternRule("SEXUAL_CONTENT", 45, r"\bnude\b", severity="critical"),
    PatternRule("SEXUAL_CONTENT", 45, r"\bshow me (your body|yourself)\b", severity="critical"),
    PatternRule("SEXUAL_CONTENT", 34, r"\bwhat are you wearing\b", severity="high"),
    PatternRule("SEXUAL_CONTENT", 36, r"\bsend (me )?(a )?(pic|photo|selfie)\b", severity="high", sender_only_bonus=4),
    PatternRule("SEXUAL_CONTENT", 24, r"\bsexy\b"),
    PatternRule("SEXUAL_CONTENT", 28, r"\bturn me on\b", severity="high"),
    PatternRule("SEXUAL_CONTENT", 45, r"\bi like young girls\b", severity="critical"),
    PatternRule("SEXUAL_CONTENT", 45, r"\bi like underage girls\b", severity="critical"),
    PatternRule("SEXUAL_CONTENT", 45, r"\bi like little girls\b", severity="critical"),
    PatternRule("SEXUAL_CONTENT", 45, r"\byoung girls turn me on\b", severity="critical"),
    PatternRule("SEXUAL_CONTENT", 45, r"\bunderage girls turn me on\b", severity="critical"),
    PatternRule("SEXUAL_CONTENT", 45, r"\bi m into young girls\b", severity="critical"),
    PatternRule("SEXUAL_CONTENT", 45, r"\bi m attracted to young girls\b", severity="critical"),
    PatternRule("SEXUAL_CONTENT", 40, r"\bi prefer younger girls\b", severity="critical"),

    PatternRule("PII_SOLICITATION", 28, r"\byour address\b", severity="high", sender_only_bonus=4),
    PatternRule("PII_SOLICITATION", 28, r"\bwhere do you live\b", severity="high", sender_only_bonus=4),
    PatternRule("PII_SOLICITATION", 22, r"\bwhat school\b", severity="high"),
    PatternRule("PII_SOLICITATION", 18, r"\bhome alone\b", severity="medium"),
    PatternRule("PII_SOLICITATION", 28, r"\bsend (me )?your location\b", severity="high", sender_only_bonus=4),
    PatternRule("PII_SOLICITATION", 22, r"\bwhat part of town\b", severity="medium"),
    PatternRule("PII_SOLICITATION", 24, r"\bwhat is your phone number\b", severity="high"),
    PatternRule("PII_SOLICITATION", 22, r"\bwhen are your parents home\b", severity="high"),

    PatternRule("PLATFORM_MIGRATION", 24, r"\bwhatsapp\b", severity="medium"),
    PatternRule("PLATFORM_MIGRATION", 24, r"\btelegram\b", severity="medium"),
    PatternRule("PLATFORM_MIGRATION", 16, r"\bdiscord\b", severity="low"),
    PatternRule("PLATFORM_MIGRATION", 22, r"\bsnapchat\b", severity="medium"),
    PatternRule("PLATFORM_MIGRATION", 20, r"\bsignal\b", severity="medium"),
    PatternRule("PLATFORM_MIGRATION", 18, r"\bvideo chat\b", severity="low"),
    PatternRule("PLATFORM_MIGRATION", 22, r"\bcall me on\b", severity="medium"),
    PatternRule("PLATFORM_MIGRATION", 22, r"\btalk somewhere else\b", severity="medium"),
    PatternRule("PLATFORM_MIGRATION", 24, r"\bmove to another app\b", severity="medium"),
    PatternRule("PLATFORM_MIGRATION", 22, r"\btext me instead\b", severity="medium"),
    PatternRule("PLATFORM_MIGRATION", 20, r"\bmeet me\b", severity="high"),

    PatternRule("THREATS_COERCION", 30, r"\bor else\b", severity="high"),
    PatternRule("THREATS_COERCION", 30, r"\byou ll regret this\b", severity="high"),
    PatternRule("THREATS_COERCION", 28, r"\bpost your\b", severity="high"),
    PatternRule("THREATS_COERCION", 24, r"\bif you loved me\b", severity="medium"),
    PatternRule("THREATS_COERCION", 22, r"\bdon t make me angry\b", severity="medium"),
    PatternRule("THREATS_COERCION", 32, r"\bi ll ruin your life\b", severity="high"),
    PatternRule("THREATS_COERCION", 32, r"\bi will ruin your life\b", severity="high"),
    PatternRule("THREATS_COERCION", 32, r"\bi ll share this\b", severity="high"),
    PatternRule("THREATS_COERCION", 28, r"\bwatch your back\b", severity="high"),
    PatternRule("THREATS_COERCION", 36, r"\bi ll hurt you\b", severity="high"),
    PatternRule("THREATS_COERCION", 36, r"\bi will hurt you\b", severity="high"),
    PatternRule("THREATS_COERCION", 36, r"\bi ll find you\b", severity="high"),
    PatternRule("THREATS_COERCION", 36, r"\bi will find you\b", severity="high"),
    PatternRule("THREATS_COERCION", 36, r"\bi ll come for you\b", severity="high"),
    PatternRule("THREATS_COERCION", 36, r"\bi will come for you\b", severity="high"),
    PatternRule("THREATS_COERCION", 36, r"\bi ll beat you\b", severity="high"),
    PatternRule("THREATS_COERCION", 36, r"\bi will beat you\b", severity="high"),

    PatternRule("SELF_HARM_CONTENT", 50, r"\bkill yourself\b", severity="critical"),
    PatternRule("SELF_HARM_CONTENT", 50, r"\bhurt yourself\b", severity="critical"),
    PatternRule("SELF_HARM_CONTENT", 50, r"\bcut yourself\b", severity="critical"),

    PatternRule("HATE_HARASSMENT", 10, r"\bworthless\b", severity="low", requires_target=True),
    PatternRule("HATE_HARASSMENT", 10, r"\bstupid\b", severity="low", requires_target=True),
    PatternRule("HATE_HARASSMENT", 10, r"\bidiot\b", severity="low", requires_target=True),
    PatternRule("HATE_HARASSMENT", 10, r"\bmoron\b", severity="low", requires_target=True),
    PatternRule("HATE_HARASSMENT", 10, r"\bloser\b", severity="low", requires_target=True),
    PatternRule("HATE_HARASSMENT", 10, r"\bfreak\b", severity="low", requires_target=True),
    PatternRule("HATE_HARASSMENT", 12, r"\bpathetic\b", severity="low", requires_target=True),
    PatternRule("HATE_HARASSMENT", 12, r"\bugly\b", severity="low", requires_target=True),
    PatternRule("HATE_HARASSMENT", 12, r"\bdisgusting\b", severity="low", requires_target=True),
    PatternRule("HATE_HARASSMENT", 14, r"\bnobody wants you\b", severity="medium", requires_target=True),
    PatternRule("HATE_HARASSMENT", 14, r"\beveryone hates you\b", severity="medium", requires_target=True),
    PatternRule("HATE_HARASSMENT", 16, r"\bhate you\b", severity="medium", requires_target=True),
    PatternRule("HATE_HARASSMENT", 16, r"\byou re gay\b", severity="medium", requires_target=True),
    PatternRule("HATE_HARASSMENT", 16, r"\byou are gay\b", severity="medium", requires_target=True),
    PatternRule("HATE_HARASSMENT", 14, r"\bthat s so gay\b", severity="low"),
    PatternRule("HATE_HARASSMENT", 14, r"\bthats so gay\b", severity="low"),

    PatternRule("FINANCIAL_SCAM", 30, r"\bgift card\b", severity="high"),
    PatternRule("FINANCIAL_SCAM", 30, r"\bpassword\b", severity="high"),
    PatternRule("FINANCIAL_SCAM", 30, r"\blogin code\b", severity="high"),
    PatternRule("FINANCIAL_SCAM", 30, r"\bsend me money\b", severity="high"),
    PatternRule("FINANCIAL_SCAM", 30, r"\bbank account\b", severity="high"),
    PatternRule("FINANCIAL_SCAM", 30, r"\bverification code\b", severity="high"),

    PatternRule("OBFUSCATION", 10, r"\bs3x\b", severity="low"),
    PatternRule("OBFUSCATION", 10, r"\bm33t\b", severity="low"),
    PatternRule("OBFUSCATION", 10, r"\bp@rk\b", severity="low"),
    PatternRule("OBFUSCATION", 10, r"\bw h a t s a p p\b", severity="low"),
    PatternRule("OBFUSCATION", 10, r"\bt3l3gr4m\b", severity="low"),
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


def _collapse_repeats(text: str) -> str:
    return re.sub(r"(.)\1{2,}", r"\1", text)


def _join_spaced_letters(text: str) -> str:
    return re.sub(r"\b(?:[a-zA-Z]\s+){2,}[a-zA-Z]\b", lambda m: m.group(0).replace(" ", ""), text)


def _normalize_for_matching(text: str) -> str:
    lowered = unicodedata.normalize("NFKC", str(text or "").lower())
    lowered = lowered.translate(LEET_MAP)
    lowered = _join_spaced_letters(lowered)
    lowered = _collapse_repeats(lowered)
    lowered = re.sub(r"[_\-.~/\\|]+", " ", lowered)
    lowered = re.sub(r"[^a-z0-9\s]", " ", lowered)
    return re.sub(r"\s+", " ", lowered).strip()


def _similar(a: str, b: str) -> float:
    return SequenceMatcher(None, a, b).ratio()


def _token_windows(tokens: list[str], max_n: int = 4) -> list[str]:
    out = []
    for n in range(1, max_n + 1):
        for i in range(len(tokens) - n + 1):
            out.append(" ".join(tokens[i:i + n]))
    return out


def _fuzzy_find_terms(text: str, terms: list[str], threshold: float = 0.92) -> list[str]:
    tokens = text.split()
    windows = _token_windows(tokens, max_n=4)
    found = []
    for term in terms:
        term_norm = _normalize_for_matching(term)
        term_despam = re.sub(r"(.)\1+", r"\1", term_norm)
        for window in windows:
            window_despam = re.sub(r"(.)\1+", r"\1", window)
            if max(
                _similar(window, term_norm),
                _similar(window_despam, term_despam),
            ) >= threshold:
                found.append(term)
                break
    return found


def _has_target(text: str) -> bool:
    normalized = _normalize_for_matching(text)
    tokens = set(normalized.split())
    return bool(tokens & SECOND_PERSON) or any(group in normalized for group in GROUP_REFERENCES)


def _is_quoted_or_reported(text: str) -> bool:
    normalized = _normalize_for_matching(text)
    return any(re.search(pattern, normalized) for pattern in SAFE_CONTEXT_PATTERNS)


def _run_rules(text: str) -> tuple[list[str], list[str], int]:
    normalized = _normalize_for_matching(text)
    labels = []
    seen_labels = set()
    phrases = []
    score = 0
    for rule in RISK_RULES:
        matches: list[str] = []
        if rule.compiled:
            matches = [m.group(0) for m in rule.compiled.finditer(normalized)]
        if not matches:
            continue
        if rule.requires_target and not _has_target(text):
            continue
        if rule.label not in seen_labels:
            labels.append(rule.label)
            seen_labels.add(rule.label)
        score += int(rule.weight)
        for match in matches[:3]:
            phrase = _normalize_phrase(match)
            if phrase and phrase not in phrases:
                phrases.append(phrase)

    for match in _fuzzy_find_terms(normalized, HIGH_SEVERITY_HATE_TERMS, threshold=0.92):
        if "HATE_HARASSMENT" not in seen_labels:
            labels.append("HATE_HARASSMENT")
            seen_labels.add("HATE_HARASSMENT")
        score = max(score, 40)
        phrase = _normalize_phrase(match)
        if phrase and phrase not in phrases:
            phrases.append(phrase)

    for match in _fuzzy_find_terms(normalized, SEVERE_THREAT_TERMS, threshold=0.94):
        if "THREATS_COERCION" not in seen_labels:
            labels.append("THREATS_COERCION")
            seen_labels.add("THREATS_COERCION")
        score = max(score, 45)
        phrase = _normalize_phrase(match)
        if phrase and phrase not in phrases:
            phrases.append(phrase)

    for match in _fuzzy_find_terms(normalized, FUZZY_PLATFORM_TERMS, threshold=0.9):
        if "PLATFORM_MIGRATION" not in seen_labels:
            labels.append("PLATFORM_MIGRATION")
            seen_labels.add("PLATFORM_MIGRATION")
        score = max(score, 24)
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


def extract_features(text: str, message: dict[str, Any] | None = None) -> dict[str, Any]:
    labels, phrases, base_score = _run_rules(text)
    normalized = _normalize_for_matching(text)
    return {
        "labels": labels,
        "phrases": phrases,
        "base_score": base_score,
        "role": _speaker_role(message),
        "is_prompt": _is_question_or_prompt(text),
        "has_target": _has_target(text),
        "quoted": _is_quoted_or_reported(text),
        "normalized": normalized,
    }


def score_features(features: dict[str, Any]) -> int:
    labels = features["labels"]
    normalized = features["normalized"]
    score = int(round(features["base_score"] * ROLE_WEIGHTS.get(features["role"], 0.8)))

    if features["quoted"]:
        score -= 10
    if features["has_target"] and "HATE_HARASSMENT" in labels:
        score += 10
    if features["is_prompt"] and any(x in labels for x in ["PII_SOLICITATION", "GROOMING", "PLATFORM_MIGRATION"]):
        score += 6 if features["role"] == "sender" else 2

    if features["role"] == "receiver" and labels == ["PLATFORM_MIGRATION"] and len(normalized.split()) <= 8:
        score -= 12
    if features["role"] == "receiver" and "PII_SOLICITATION" in labels and not features["is_prompt"]:
        score -= 6

    if (not features["quoted"]) and any(
        _similar(window, _normalize_for_matching(term)) >= 0.94
        for window in _token_windows(normalized.split(), 4)
        for term in SEVERE_THREAT_TERMS
    ):
        score = max(score, 82)
    elif "THREATS_COERCION" in labels:
        score = max(score, 34)

    if (not features["quoted"]) and any(
        _similar(window, _normalize_for_matching(term)) >= 0.92
        for window in _token_windows(normalized.split(), 3)
        for term in HIGH_SEVERITY_HATE_TERMS
    ):
        score = max(score, 40)

    if "HATE_HARASSMENT" in labels and any(
        phrase in normalized for phrase in ["nobody wants you", "everyone hates you", "worthless", "pathetic", "disgusting"]
    ):
        score = max(score, 20)

    if "delete this chat" in normalized and "parents are asleep" in normalized:
        score += 22
    elif "parents are asleep" in normalized or "home alone" in normalized:
        score += 12

    if "THREATS_COERCION" in labels and "HATE_HARASSMENT" in labels:
        score += 12

    return max(0, min(100, score))


def _message_risk_score(text: str, message: dict[str, Any] | None = None) -> int:
    return score_features(extract_features(text, message))


def _conversation_stage_features(messages: list[dict[str, Any]]) -> dict[str, bool]:
    sender_text = " ".join(
        _normalize_for_matching(str(m.get("text") or ""))
        for m in messages
        if _speaker_role(m) == "sender"
    )
    return {
        "secrecy": any(p in sender_text for p in ["our secret", "keep this between us", "delete this chat", "don t tell your parents"]),
        "migration": any(p in sender_text for p in ["whatsapp", "telegram", "snapchat", "discord", "signal", "move to another app", "talk somewhere else"]),
        "pii": any(p in sender_text for p in ["your address", "where do you live", "what school", "send your location", "phone number"]),
        "isolation": any(p in sender_text for p in ["home alone", "parents are asleep"]),
        "sexual": any(p in sender_text for p in ["nude", "what are you wearing", "show me your body", "turn me on"]),
    }


def _compute_conversation_boosts(messages: list[dict[str, Any]]) -> tuple[int, list[str]]:
    if not messages:
        return 0, []

    boost = 0
    notes = []
    sender_msgs = [m for m in messages if _speaker_role(m) == "sender"]
    joined_sender = " ".join(str(m.get("text") or "") for m in sender_msgs)
    joined_norm = _normalize_for_matching(joined_sender)

    stages = _conversation_stage_features(messages)
    if stages["secrecy"] and stages["migration"]:
        boost += 18
        notes.append("secrecy plus off-platform escalation")
    if stages["pii"] and stages["migration"]:
        boost += 16
        notes.append("contact or location plus off-platform escalation")
    if stages["sexual"] and stages["pii"]:
        boost += 20
        notes.append("sexual content plus personal data request")
    if stages["secrecy"] and stages["isolation"]:
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

    if any(token in joined_norm for token in ["meet me", "come outside"]) and stages["pii"]:
        boost += 12
        notes.append("meetup plus personal data request")

    return boost, notes


def _find_flagged_messages(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    flagged_messages = []
    for message in messages:
        text = str(message.get("text") or "").strip()
        if not text:
            continue

        features = extract_features(text, message)
        categories = features["labels"]
        phrases = features["phrases"]
        base_score = features["base_score"]
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
    base_features = extract_features(text)
    threats = list(base_features["labels"])
    flagged_phrases = list(base_features["phrases"])
    score = score_features(base_features)
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


def _is_social_url(url: str) -> bool:
    try:
        from urllib.parse import urlparse
        host = urlparse(url).hostname or ""
        host = host.removeprefix("www.")
        return host in _SOCIAL_DOMAINS or any(host.endswith("." + d) for d in _SOCIAL_DOMAINS)
    except Exception:
        return False


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


class IsSocialRequest(BaseModel):
    url: str


@router.post("/is-social")
async def check_url(body: IsSocialRequest) -> dict[str, bool]:
    return {"is_social": _is_social_url(body.url)}
