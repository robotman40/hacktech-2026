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
        <title>Hacktech Safety Demo</title>
        <style>
          body {
            margin: 0;
            font-family: Arial, sans-serif;
            background: linear-gradient(135deg, #0f172a, #1e293b);
            color: #e2e8f0;
          }
          .wrap {
            max-width: 960px;
            margin: 0 auto;
            padding: 40px 20px 80px;
          }
          .hero {
            margin-bottom: 24px;
          }
          .hero h1 {
            margin: 0 0 10px;
            font-size: 34px;
          }
          .hero p {
            margin: 0;
            color: #cbd5e1;
            line-height: 1.6;
          }
          .grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
            gap: 18px;
            margin-top: 28px;
          }
          .card {
            background: rgba(15, 23, 42, 0.88);
            border: 1px solid rgba(148, 163, 184, 0.22);
            border-radius: 18px;
            padding: 20px;
            box-shadow: 0 20px 40px rgba(0, 0, 0, 0.25);
          }
          .chat {
            margin-top: 10px;
            display: grid;
            gap: 12px;
          }
          .msg {
            padding: 12px 14px;
            border-radius: 14px;
            line-height: 1.5;
          }
          .adult {
            background: #3f0d12;
            border: 1px solid #ef4444;
          }
          .child {
            background: #0f766e;
            border: 1px solid #14b8a6;
          }
          .pill {
            display: inline-block;
            margin-bottom: 8px;
            padding: 6px 10px;
            border-radius: 999px;
            background: #172554;
            color: #bfdbfe;
            font-size: 12px;
            text-transform: uppercase;
            letter-spacing: 0.08em;
          }
        </style>
      </head>
      <body>
        <div class="wrap">
          <div class="hero">
            <h1>Hacktech Chromium Demo</h1>
            <p>
              This page intentionally contains risky child-safety conversation patterns so the
              Chromium extension can detect them and show an alert banner after scanning.
            </p>
          </div>

          <div class="grid">
            <section class="card">
              <span class="pill">Conversation Feed</span>
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
            </section>

            <section class="card">
              <span class="pill">Expected Detection</span>
              <p>
                A strong scan should flag grooming, platform migration, and personal information
                solicitation. The popup should also show the last result after the scan finishes.
              </p>
            </section>
          </div>
        </div>
      </body>
    </html>
    """

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
