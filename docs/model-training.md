# Model training — video verdict + the real route

Source video: TECH GPT, "I Tried Building My OWN ChatGPT Using Fable 5.2!",
13m37s, uploaded 2026-11-13, 26,125 views —
https://www.youtube.com/watch?v=e3RTg2gopes
(Full auto-caption transcript read; the "en" translation track 429'd, the
original-language track worked.)

## Video verdict: there is no training in it

Seedhi baat: is video se model train karne ka koi tareeqa nahi milta,
kyunki video me training hoti hi nahi hai. Creator khud do martaba kehta
hai:

- "I haven't trained any of these selected models from scratch."
- Project ke apne About page par: "Thrones is not a fully trained model."

Jo asal me hota hai:

1. Qwen 3.5 open weights download karna (2B / 4B / 9B — hardware ke
   hisaab se chunna).
2. Claude Fable 5.2 se ChatGPT-jaisi UI banwana (dark/light mode,
   projects, custom instructions, thinking mode, web research via
   Brave/DuckDuckGo, private/offline mode).
3. "Fable 5.2 will train it" — Fable ke credits video ke beech me khatam
   ho jate hain; training phir lafzon me handover ho jati hai ("I'll get
   the model training done by Extra") aur kabhi dikhayi nahi deti.
4. Aakhir me local Qwen model UI se chal raha hai (RTX 5060 Ti 16GB +
   i3-10105F + 16GB RAM, Windows 11). 9B model ko 24GB RAM chahiye —
   creator ke apne PC me itni RAM hai hi nahi.

Toh "is video wale tareeqe se train karo" ka imaandaar jawab: video wala
tareeqa training hai hi nahi — wo downloaded weights + chat UI hai.

## Training asal me kya mangta hai

| Cheez | Haal |
|---|---|
| **1. Data** — labelled examples: prompt + achha output (approved) vs kharab output (rejected + wajah) | **Zero.** Abhi koi production example nahi hai (store total 0; pehli real batch Mon 2026-11-23 chain se). Bina data ke koi method kaam nahi karta. |
| **2. GPU** — 4B LoRA ke liye bhi GPU chahiye | Oracle VM CPU-only hai. Tool Registry me Kaggle (30 GPU-h/week), Modal (~$30 credit), Paperspace — teeno **candidate** hain: na key, na adapter, kabhi pick nahi hue. |
| **3. Host** — trained weights ko serve karne ki jagah | Groq/Gemini custom weights serve nahi karte, aur unke free tier par fine-tuning hai hi nahi. Trained model ko apni serving chahiye (vLLM / Modal / HF Space) — yahi hissa free, fast, $0 setup ko todta hai. Serving asal blocker hai, training nahi. |
| **4. Compliance scan** | Training se violations kam hote hain, zero nahi hote. Scanner training ke baad bhi mandatory rehta hai. |

## Step 1 — BUILT: training-data collector

`src/lib/hub/training-data.ts` — har hub text/code run record hota hai
(`storage/hub/training-data.jsonl`, JSONL, SFT format):

```json
{"runId":"...","createdAt":"...","kind":"chat","mode":"ensemble",
 "instruction":"<prompt>","output":"<output, max 8000 chars>",
 "verdict":"approved|rejected|failed","reason":"compliance_rejected: ...",
 "models":["openai/gpt-oss-120b","..."]}
```

- `approved` = run ok hua; `rejected` = compliance scan fail;
  `failed` = error / sandbox fail.
- Recording best-effort hai — likhna fail ho to example khota hai, run
  kabhi fail nahi hota.
- Wiring: `runHub` ke `finish()` me hai (`src/lib/hub/run.ts`) — engine
  runs (image/video/ebook) ka text output nahi hota, to wo record nahi
  hote.
- Helpers: `recordTrainingExample()`, `readTrainingData(limit)`,
  `trainingDataStats()` (total / approved / rejected / failed / byKind)
  — stats hi measure-first plan ka input hain.
- Tests: `scripts/test-training-data.ts` — **16/16** (fake caller:
  approved run → approved example; price wala run → rejected example
  with reason).

## Measure-first plan (pehle se tay, abhi bhi pending)

Pehli real batch (≥20 jobs, Mon 2026-11-23 chain ke baad) par measure
karna hai: compliance verdicts, quality verdicts, retries (hidden credit
cost) — ab training-data stats se bhi. Thresholds (proposed, not measured
facts): REJECTED + NEEDS_REVIEW > ~25% ya retries > ~30% extra calls →
training/prompt fix worth it; < ~10% → prompts hi kaafi, training not
worth it. User ka faisla abhi bhi pending hai (options 2026-11-20 ko bheje
gaye the, koi jawab nahi aaya).

## Aage ke routes (jab data ho)

1. **Prompts/examples (free)** — gold few-shot examples, strict system
   prompts. Aksar training se pehle kaafi hota hai.
2. **Style LoRA (Kaggle/Modal GPU)** — brand/style adapter train karna.
   Sirf style sikhata hai, script compliance nahi. Phir bhi serving
   chahiye.
3. **Paid fine-tune (free-first ke khilaaf)** — OpenAI/Gemini tuning.
   Sirf tab jab data kahe ke prompts kaafi nahi.

Koi bhi route pick ho, dataset yahi file se banega — isiliye collector
pehle bana hai, training baad me.
