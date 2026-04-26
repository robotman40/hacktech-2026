import fastapi
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
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

@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/demo", response_class=HTMLResponse)
async def demo():
    return """
    <!doctype html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1.0" />
        <title>Instabam — demo</title>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
        <style>
          :root {
            --ig-bg: #fafafa;
            --ig-surface: #fff;
            --ig-line: #dbdbdb;
            --ig-incoming: #efefef;
            --ig-outgoing1: #3797f0;
            --ig-outgoing2: #6b4eff;
            --ig-text: #262626;
            --ig-sub: #8e8e8e;
            --inbox-w: 320px;
          }
          * { box-sizing: border-box; }
          body {
            margin: 0;
            min-height: 100vh;
            font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            background: #fff;
            color: var(--ig-text);
          }
          .page {
            min-height: 100vh;
            display: flex;
            flex-direction: column;
            background: #fff;
          }
          .desktop {
            flex: 1;
            display: flex;
            max-width: 1000px;
            width: 100%;
            margin: 0 auto;
            min-height: 0;
            border: 1px solid var(--ig-line);
            background: var(--ig-surface);
          }
          .inbox {
            width: var(--inbox-w);
            flex-shrink: 0;
            display: flex;
            flex-direction: column;
            border-right: 1px solid var(--ig-line);
            min-height: 520px;
            max-height: min(100vh - 80px, 900px);
          }
          .inbox-top {
            padding: 10px 14px 8px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            border-bottom: 1px solid var(--ig-line);
          }
          .inbox-top .wordmark {
            display: flex; align-items: center; gap: 8px;
            font-weight: 700; font-size: 1.05rem; letter-spacing: -0.03em;
          }
          .inbox-top .logo-ico {
            width: 28px; height: 28px; border-radius: 8px;
            background: linear-gradient(135deg, #f09433, #e6683c, #dc2743, #cc2366, #bc1888);
            display: flex; align-items: center; justify-content: center;
            color: #fff; font-size: 9px; font-weight: 800;
          }
          .inbox-top .edit-ico { font-size: 1.2rem; color: #262626; cursor: default; opacity: 0.7; }
          .inbox-me {
            padding: 4px 14px 10px; font-size: 0.8rem; color: var(--ig-sub);
            font-weight: 500;
          }
          .inbox-search {
            margin: 0 12px 10px; padding: 8px 12px; border-radius: 8px;
            border: none; background: #efefef; font: inherit; font-size: 0.85rem; color: var(--ig-sub);
          }
          .inbox-list {
            flex: 1;
            overflow-y: auto;
            border-top: 1px solid var(--ig-line);
          }
          .conv {
            display: flex; align-items: center; gap: 12px;
            padding: 10px 14px; cursor: pointer;
            border-bottom: 1px solid #fafafa;
            text-align: left; width: 100%; background: #fff; border: none;
            font: inherit; color: inherit;
            transition: background 0.12s;
          }
          .conv:hover { background: #fafafa; }
          .conv.is-active { background: #efefef; }
          .conv-avatar {
            width: 44px; height: 44px; border-radius: 50%; flex-shrink: 0;
            display: flex; align-items: center; justify-content: center;
            font-size: 0.75rem; font-weight: 600; color: #fff;
          }
          .conv-body { min-width: 0; flex: 1; }
          .conv-top {
            display: flex; align-items: baseline; justify-content: space-between; gap: 8px; margin-bottom: 2px;
          }
          .conv-name { font-weight: 600; font-size: 0.88rem; letter-spacing: -0.02em; }
          .conv-time { font-size: 0.7rem; color: var(--ig-sub); flex-shrink: 0; }
          .conv-preview { font-size: 0.78rem; color: var(--ig-sub);
            white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
          }
          .main-pane {
            flex: 1;
            min-width: 0;
            display: flex;
            flex-direction: column;
            background: #fff;
            max-height: min(100vh - 80px, 900px);
          }
          .main-top {
            display: flex; align-items: center; gap: 10px; padding: 8px 16px;
            border-bottom: 1px solid var(--ig-line);
            flex-shrink: 0;
          }
          .main-top .back {
            display: none; width: 28px; height: 28px; border: none; background: none;
            font-size: 22px; line-height: 1; color: #262626; cursor: pointer; border-radius: 50%;
          }
          .main-top .back:hover { background: #fafafa; }
          .active-peer {
            display: flex; align-items: center; gap: 10px; min-width: 0;
          }
          .active-peer .conv-avatar { width: 32px; height: 32px; font-size: 0.65rem; }
          .active-peer h2 { margin: 0; font-size: 0.95rem; font-weight: 600; line-height: 1.2; }
          .active-peer .sub { display: block; font-size: 0.7rem; color: var(--ig-sub); font-weight: 500; }
          .thread {
            flex: 1;
            padding: 16px 20px 20px;
            display: flex;
            flex-direction: column;
            gap: 2px;
            overflow-y: auto;
            background: var(--ig-bg);
            min-height: 200px;
          }
          .chat {
            display: flex;
            flex-direction: column;
            gap: 4px;
            min-height: 0;
          }
          .msg {
            max-width: 65%;
            padding: 10px 14px;
            line-height: 1.45;
            font-size: 0.9rem;
            word-wrap: break-word;
          }
          .msg.adult {
            align-self: flex-start;
            margin-right: auto;
            margin-left: 0;
            background: var(--ig-incoming);
            color: #000;
            border-radius: 18px 18px 18px 4px;
            box-shadow: 0 1px 0 rgba(0,0,0,0.04);
          }
          .msg.child {
            align-self: flex-end;
            margin-left: auto;
            margin-right: 0;
            background: linear-gradient(130deg, var(--ig-outgoing1), var(--ig-outgoing2));
            color: #fff;
            border-radius: 18px 18px 4px 18px;
            box-shadow: 0 1px 2px rgba(75, 85, 255, 0.2);
          }
          .bottom-sheet {
            flex-shrink: 0;
            padding: 10px 16px 16px;
            background: var(--ig-surface);
            border-top: 1px solid var(--ig-line);
          }
          .hint {
            font-size: 0.7rem; color: var(--ig-sub); line-height: 1.4; margin-bottom: 8px;
          }
          .composer-grid { display: flex; flex-direction: column; gap: 8px; }
          textarea {
            width: 100%;
            min-height: 72px; resize: vertical;
            border-radius: 20px; border: 1px solid var(--ig-line);
            background: #fafafa; color: var(--ig-text);
            padding: 10px 14px; font: inherit; font-size: 0.88rem;
          }
          textarea::placeholder { color: #a8a8a8; }
          .controls { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
          select {
            border-radius: 8px; border: 1px solid var(--ig-line);
            padding: 8px 10px; font: inherit; font-size: 0.82rem; background: #fff;
            color: var(--ig-text);
          }
          button {
            border: none; border-radius: 8px; padding: 8px 14px; font: inherit; font-size: 0.82rem;
            font-weight: 600; cursor: pointer; background: #0095f6; color: #fff;
          }
          button:hover { background: #1877d3; }
          button.secondary { background: #efefef; color: #262626; }
          button.secondary:hover { background: #e0e0e0; }
          .side-panel {
            max-width: 1000px; margin: 0 auto; padding: 12px 16px 24px;
            font-size: 0.8rem; line-height: 1.5; color: var(--ig-sub);
          }
          @media (max-width: 700px) {
            .desktop { flex-direction: column; max-height: none; }
            .inbox {
              width: 100%;
              max-height: 280px;
              border-right: none;
              border-bottom: 1px solid var(--ig-line);
            }
            .main-top .back { display: flex; align-items: center; justify-content: center; }
            :root { --inbox-w: 100%; }
          }
        </style>
      </head>
      <body>
        <div class="page">
          <div class="desktop" role="application" aria-label="Instabam messages">
            <aside class="inbox" aria-label="Direct messages list">
              <div class="inbox-top">
                <div class="wordmark">
                  <div class="logo-ico" aria-hidden="true">IB</div>
                  Instabam
                </div>
                <span class="edit-ico" title="New message" aria-hidden="true">✎</span>
              </div>
              <div class="inbox-me">skyler.k</div>
              <input class="inbox-search" type="search" readonly placeholder="Search" tabindex="-1" />
              <div class="inbox-list" id="inboxList">
                <button type="button" class="conv is-active" data-id="stranger" aria-current="true">
                  <div class="conv-avatar" style="background:linear-gradient(135deg,#6366f1,#8b5cf6)">s9</div>
                  <div class="conv-body">
                    <div class="conv-top">
                      <span class="conv-name">stranger_92</span>
                      <span class="conv-time">now</span>
                    </div>
                    <div class="conv-preview">You: What kind of surprise?</div>
                  </div>
                </button>
                <button type="button" class="conv" data-id="mia">
                  <div class="conv-avatar" style="background:linear-gradient(135deg,#ec4899,#f43f5e)">MC</div>
                  <div class="conv-body">
                    <div class="conv-top">
                      <span class="conv-name">mia.creates</span>
                      <span class="conv-time">2h</span>
                    </div>
                    <div class="conv-preview">haha see you tmrw then</div>
                  </div>
                </button>
                <button type="button" class="conv" data-id="jordan">
                  <div class="conv-avatar" style="background:linear-gradient(135deg,#14b8a6,#0d9488)">JL</div>
                  <div class="conv-body">
                    <div class="conv-top">
                      <span class="conv-name">jordan.lee</span>
                      <span class="conv-time">yest.</span>
                    </div>
                    <div class="conv-preview">You sent an attachment</div>
                  </div>
                </button>
                <button type="button" class="conv" data-id="snack">
                  <div class="conv-avatar" style="background:linear-gradient(135deg,#f59e0b,#ea580c)">S</div>
                  <div class="conv-body">
                    <div class="conv-top">
                      <span class="conv-name">the_snack_squad</span>
                      <span class="conv-time">Mon</span>
                    </div>
                    <div class="conv-preview">alex: whos bringing chips</div>
                  </div>
                </button>
                <button type="button" class="conv" data-id="taylor">
                  <div class="conv-avatar" style="background:linear-gradient(135deg,#64748b,#475569)">TR</div>
                  <div class="conv-body">
                    <div class="conv-top">
                      <span class="conv-name">taylor</span>
                      <span class="conv-time">3d</span>
                    </div>
                    <div class="conv-preview">Sounds good, thanks!</div>
                  </div>
                </button>
                <button type="button" class="conv" data-id="camp_hackday">
                  <div class="conv-avatar" style="background:linear-gradient(135deg,#22c55e,#16a34a)">H</div>
                  <div class="conv-body">
                    <div class="conv-top">
                      <span class="conv-name">camp_hackday</span>
                      <span class="conv-time">1w</span>
                    </div>
                    <div class="conv-preview">reminder: bring ID</div>
                  </div>
                </button>
              </div>
            </aside>
            <div class="main-pane">
              <div class="main-top">
                <button type="button" class="back" aria-label="Back">‹</button>
                <div class="active-peer" id="activePeer">
                  <div class="conv-avatar" id="activeAvatar" style="background:linear-gradient(135deg,#6366f1,#8b5cf6)">s9</div>
                  <div>
                    <h2 id="activeName">stranger_92</h2>
                    <span class="sub" id="activeSub">Active now</span>
                  </div>
                </div>
              </div>
              <div class="thread" id="threadScroll">
                <div class="chat">
                  <div class="msg adult">
                    You seem really mature for your age. Do not tell your parents we talk, okay?
                  </div>
                  <div class="msg child">
                    Why not? They usually check my messages.
                  </div>
                  <div class="msg adult">
                    They would not understand our connection. Move to WhatsApp and send me your address
                    so I can mail you a surprise.
                  </div>
                  <div class="msg child">
                    I do have WhatsApp. What kind of surprise?
                  </div>
                </div>
              </div>
              <div class="bottom-sheet">
                <p class="hint" id="composerHint">Add messages; the extension rescans on DOM change.</p>
                <div class="composer-grid">
                  <textarea id="messageInput" placeholder="Message…" aria-label="Message"></textarea>
                  <div class="controls">
                    <select id="speakerSelect" title="Bubble alignment" aria-label="Send as">
                      <option value="adult">Other person (left)</option>
                      <option value="child">You (right)</option>
                    </select>
                    <button type="button" id="addMessage">Send</button>
                    <button type="button" id="resetChat" class="secondary">Reset thread</button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        <p class="side-panel">
          <strong>Expected:</strong> on <strong>stranger_92</strong>, grooming / off-platform / personal info patterns
          should be flagged. Other threads are inert examples.
        </p>
        <script>
          const seedMessages = [
            { speaker: "adult", text: "You seem really mature for your age. Do not tell your parents we talk, okay?" },
            { speaker: "child", text: "Why not? They usually check my messages." },
            {
              speaker: "adult",
              text: "They would not understand our connection. Move to WhatsApp and send me your address so I can mail you a surprise."
            },
            { speaker: "child", text: "I do have WhatsApp. What kind of surprise?" }
          ];

          const safeThreads = {
            mia: [
              { speaker: "adult", text: "Still on for the museum tomorrow?" },
              { speaker: "child", text: "Yep! 2pm at the main entrance" },
              { speaker: "adult", text: "haha see you tmrw then" }
            ],
            jordan: [
              { speaker: "child", text: "Can you share the group doc link again?" },
              { speaker: "adult", text: "Just sent in email — lmk if it works" }
            ],
            snack: [
              { speaker: "adult", text: "whos bringing chips" },
              { speaker: "child", text: "I can grab 2 bags" }
            ],
            taylor: [
              { speaker: "child", text: "Submitted the form on their site" },
              { speaker: "adult", text: "Sounds good, thanks!" }
            ],
            camp_hackday: [
              { speaker: "adult", text: "reminder: bring ID" },
              { speaker: "child", text: "got it" }
            ]
          };

          const contactMeta = {
            stranger: { name: "stranger_92", initials: "s9", grad: "linear-gradient(135deg,#6366f1,#8b5cf6)", sub: "Active now" },
            mia: { name: "mia.creates", initials: "MC", grad: "linear-gradient(135deg,#ec4899,#f43f5e)", sub: "Active 5m ago" },
            jordan: { name: "jordan.lee", initials: "JL", grad: "linear-gradient(135deg,#14b8a6,#0d9488)", sub: "Active 1h ago" },
            snack: { name: "the_snack_squad", initials: "S", grad: "linear-gradient(135deg,#f59e0b,#ea580c)", sub: "3 members" },
            taylor: { name: "taylor", initials: "TR", grad: "linear-gradient(135deg,#64748b,#475569)", sub: "Not on Instabam" },
            camp_hackday: { name: "camp_hackday", initials: "H", grad: "linear-gradient(135deg,#22c55e,#16a34a)", sub: "Group · 8 members" }
          };

          const chat = document.querySelector(".chat");
          const messageInput = document.getElementById("messageInput");
          const speakerSelect = document.getElementById("speakerSelect");
          const addButton = document.getElementById("addMessage");
          const resetButton = document.getElementById("resetChat");
          const activeName = document.getElementById("activeName");
          const activeSub = document.getElementById("activeSub");
          const activeAvatar = document.getElementById("activeAvatar");
          const composerHint = document.getElementById("composerHint");
          const inboxList = document.getElementById("inboxList");

          let currentId = "stranger";

          function getBaselineMessages() {
            if (currentId === "stranger") return seedMessages.map((m) => ({ ...m }));
            if (safeThreads[currentId]) return safeThreads[currentId].map((m) => ({ ...m }));
            return [];
          }

          function renderMessages(messages) {
            chat.innerHTML = "";
            for (const message of messages) {
              const bubble = document.createElement("div");
              bubble.className = `msg ${message.speaker}`;
              bubble.textContent = message.text;
              chat.appendChild(bubble);
            }
          }

          function setActiveInbox(id) {
            currentId = id;
            for (const btn of inboxList.querySelectorAll(".conv")) {
              const on = btn.getAttribute("data-id") === id;
              btn.classList.toggle("is-active", on);
              btn.setAttribute("aria-current", on ? "true" : "false");
            }
            const meta = contactMeta[id] || contactMeta.stranger;
            activeName.textContent = meta.name;
            activeSub.textContent = meta.sub;
            activeAvatar.textContent = meta.initials;
            activeAvatar.style.background = meta.grad;
            const isDemo = id === "stranger";
            composerHint.textContent = isDemo
              ? "Add messages; the extension rescans on DOM change."
              : "Placeholder thread — switch to stranger_92 for the safety demo.";
            renderMessages(getBaselineMessages());
            messageInput.value = "";
            messageInput.focus();
          }

          for (const btn of inboxList.querySelectorAll(".conv")) {
            btn.addEventListener("click", () => setActiveInbox(btn.getAttribute("data-id")));
          }

          addButton.addEventListener("click", () => {
            const text = messageInput.value.trim();
            if (!text) return;
            const bubble = document.createElement("div");
            bubble.className = `msg ${speakerSelect.value}`;
            bubble.textContent = text;
            chat.appendChild(bubble);
            messageInput.value = "";
            messageInput.focus();
          });

          messageInput.addEventListener("keydown", (event) => {
            if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
              addButton.click();
            }
          });

          resetButton.addEventListener("click", () => {
            renderMessages(getBaselineMessages());
            messageInput.value = "";
          });

          setActiveInbox("stranger");
        </script>
      </body>
    </html>
    """

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
