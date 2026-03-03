if (process.env.NODE_ENV !== 'production') require("dotenv").config();
const express = require("express");
const Anthropic = require("@anthropic-ai/sdk");
const OpenAI = require("openai");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const path = require("path");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const CURRENT_YEAR = 2026;
const CURRENT_DATE = "March 2026";

const MODELS = [
  { id: "claude",  label: "Claude",  color: "#ff6b35", provider: "anthropic" },
  { id: "gpt4",   label: "ChatGPT", color: "#19c37d", provider: "openai"    },
  { id: "gemini", label: "Gemini",  color: "#4285f4", provider: "google"    },
];

function getEnabledModels() {
  return MODELS.filter(m => {
    if (m.provider === "anthropic") return !!process.env.ANTHROPIC_API_KEY;
    if (m.provider === "openai")    return !!process.env.OPENAI_API_KEY;
    if (m.provider === "google")    return !!process.env.GEMINI_API_KEY;
    return false;
  });
}

async function callModel(modelId, systemPrompt, userPrompt) {
  if (modelId === "claude") {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const msg = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1000,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    });
    return msg.content[0].text;
  }
  if (modelId === "gpt4") {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const res = await client.chat.completions.create({
      model: "gpt-4o-mini", max_tokens: 1000,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });
    return res.choices[0].message.content;
  }
  if (modelId === "gemini") {
    const client = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = client.getGenerativeModel({ model: "gemini-2.5-flash", systemInstruction: systemPrompt });
    const result = await model.generateContent(userPrompt);
    return result.response.text();
  }
}

app.get("/api/config", (req, res) => {
  res.json({ models: getEnabledModels() });
});

// ── TRADE ANALYZER ──────────────────────────────────────────────────────────
app.post("/api/trade", async (req, res) => {
  const { sport, mode, teamA, playersA, teamB, playersB } = req.body;
  if (!sport || !playersA?.length || !playersB?.length)
    return res.status(400).json({ error: "Missing required fields." });

  const enabledModels = getEnabledModels();
  if (!enabledModels.length) return res.status(500).json({ error: "No API keys configured." });

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);
  send({ type: "models", models: enabledModels });

  const systemPrompt = `You are an elite ${sport} analyst. Today's date is ${CURRENT_DATE}. The current year is ${CURRENT_YEAR}. You have up-to-date knowledge of rosters, contracts, injuries, and player values as of ${CURRENT_DATE}. Only reference players, picks, and roster situations that are current as of ${CURRENT_DATE}. Be bold, confident, and decisive.`;

  const userPrompt = `Analyze this ${mode === "fantasy" ? "FANTASY" : "REAL LIFE"} ${sport} trade:

TEAM A gives up: ${playersA.join(", ")}${teamA ? ` (${teamA})` : ""}
TEAM B gives up: ${playersB.join(", ")}${teamB ? ` (${teamB})` : ""}

Respond in EXACTLY this format with no deviations:
WINNER: [TEAM A or TEAM B]
CONFIDENCE: [a number from 1-100]
VERDICT: [One punchy sentence declaring the winner and why - be bold]
ANALYSIS: [2-3 sentences of deeper reasoning covering value, age, position, context]
KEY FACTOR: [The single most important reason in one sentence]
RISK: [Biggest risk for the winning side in one sentence]`;

  const results = await Promise.all(
    enabledModels.map(async (model) => {
      try {
        const answer = await callModel(model.id, systemPrompt, userPrompt);
        return { modelId: model.id, answer, isError: false };
      } catch (err) {
        return { modelId: model.id, answer: `Error: ${err.message}`, isError: true };
      }
    })
  );

  for (const r of results) send({ type: "result", modelId: r.modelId, answer: r.answer, isError: r.isError });
  send({ type: "done" });
  res.end();
});

// ── DRAFT ADVISOR ────────────────────────────────────────────────────────────
app.post("/api/draft", async (req, res) => {
  const { sport, mode, team, pick, needs, available } = req.body;
  if (!sport || !pick) return res.status(400).json({ error: "Missing required fields." });

  const enabledModels = getEnabledModels();
  if (!enabledModels.length) return res.status(500).json({ error: "No API keys configured." });

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);
  send({ type: "models", models: enabledModels });

  const systemPrompt = `You are an elite ${sport} draft analyst. Today's date is ${CURRENT_DATE}. The current year is ${CURRENT_YEAR}. For REAL drafts, only recommend players who are eligible to be drafted in ${CURRENT_YEAR} — do NOT suggest players who were already drafted in previous years. For fantasy drafts, only recommend players currently on active rosters as of ${CURRENT_DATE}. Be bold and decisive.`;

  const userPrompt = `Give a draft recommendation for this ${mode === "fantasy" ? "FANTASY" : "REAL LIFE"} ${sport} ${mode === "real" ? CURRENT_YEAR : ""} draft:

${team ? `Team/Manager: ${team}` : ""}
Draft Position/Pick: ${pick}
${needs ? `Team Needs: ${needs}` : ""}
${available ? `Players Being Considered: ${available}` : ""}

Respond in EXACTLY this format with no deviations:
PICK: [Player Name and Position]
CONFIDENCE: [a number from 1-100]
VERDICT: [One bold punchy sentence on why this is the pick]
REASONING: [2-3 sentences on fit, value, upside]
UPSIDE: [Best case scenario in one sentence]
FLOOR: [Worst case in one sentence]
ALTERNATIVE: [One player to take if your pick is gone]`;

  const results = await Promise.all(
    enabledModels.map(async (model) => {
      try {
        const answer = await callModel(model.id, systemPrompt, userPrompt);
        return { modelId: model.id, answer, isError: false };
      } catch (err) {
        return { modelId: model.id, answer: `Error: ${err.message}`, isError: true };
      }
    })
  );

  for (const r of results) send({ type: "result", modelId: r.modelId, answer: r.answer, isError: r.isError });
  send({ type: "done" });
  res.end();
});

// ── START / SIT ──────────────────────────────────────────────────────────────
app.post("/api/startsit", async (req, res) => {
  const { sport, playerA, playerB, context } = req.body;
  if (!sport || !playerA || !playerB) return res.status(400).json({ error: "Missing required fields." });

  const enabledModels = getEnabledModels();
  if (!enabledModels.length) return res.status(500).json({ error: "No API keys configured." });

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);
  send({ type: "models", models: enabledModels });

  const systemPrompt = `You are a fantasy ${sport} expert. Today's date is ${CURRENT_DATE}. The current year is ${CURRENT_YEAR}. Use your knowledge of current ${CURRENT_YEAR} season performance, matchups, and injury reports. Never hedge — always give a clear decisive recommendation.`;

  const userPrompt = `Start or Sit decision for fantasy ${sport} (${CURRENT_DATE}):

Player 1: ${playerA}
Player 2: ${playerB}
${context ? `Context: ${context}` : ""}

Respond in EXACTLY this format with no deviations:
START: [Player Name]
CONFIDENCE: [a number from 1-100]
VERDICT: [One bold punchy sentence on who to start and why]
REASONING: [2-3 sentences on matchup, form, and situation]
CEILING: [Best case for the player you said to start]
WATCH OUT: [One thing that could make this the wrong call]`;

  const results = await Promise.all(
    enabledModels.map(async (model) => {
      try {
        const answer = await callModel(model.id, systemPrompt, userPrompt);
        return { modelId: model.id, answer, isError: false };
      } catch (err) {
        return { modelId: model.id, answer: `Error: ${err.message}`, isError: true };
      }
    })
  );

  for (const r of results) send({ type: "result", modelId: r.modelId, answer: r.answer, isError: r.isError });
  send({ type: "done" });
  res.end();
});

app.use((req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

const port = process.env.PORT || 3000;
app.listen(port, "0.0.0.0", () => console.log(`Sports Oracle running on port ${port}`));
