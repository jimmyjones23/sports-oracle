require("dotenv").config();
const express = require("express");
const Anthropic = require("@anthropic-ai/sdk");
const OpenAI = require("openai");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const path = require("path");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

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

function getEnabledModels() {
  return MODELS.filter(m => {
    if (m.provider === "anthropic") return !!process.env.ANTHROPIC_API_KEY;
    if (m.provider === "openai")    return !!process.env.OPENAI_API_KEY;
    if (m.provider === "google")    return !!process.env.GEMINI_API_KEY;
    return false;
  });
}

app.get("/api/config", (req, res) => {
  res.json({ models: getEnabledModels() });
});

// ── TRADE ANALYZER ──────────────────────────────────────────────────────────
app.post("/api/trade", async (req, res) => {
  const { sport, mode, teamA, playersA, teamB, playersB } = req.body;
  if (!sport || !playersA?.length || !playersB?.length) {
    return res.status(400).json({ error: "Missing required fields." });
  }

  const enabledModels = getEnabledModels();
  if (!enabledModels.length) return res.status(500).json({ error: "No API keys configured." });

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);
  send({ type: "models", models: enabledModels });

  const systemPrompt = `You are an elite ${sport} analyst with deep expertise in both real-life ${sport} and fantasy ${sport}. You give sharp, confident, specific trade analysis. Always declare a clear winner. Use player stats, age, position scarcity, team context, and value. Be direct and opinionated.`;

  const userPrompt = `Analyze this ${mode === "fantasy" ? "FANTASY" : "REAL LIFE"} ${sport} trade:

TEAM A gives up: ${playersA.join(", ")}${teamA ? ` (${teamA})` : ""}
TEAM B gives up: ${playersB.join(", ")}${teamB ? ` (${teamB})` : ""}

Give your analysis in this exact format:
🏆 WINNER: [Team A or Team B]
📊 VERDICT: [2-3 sentences on who wins and why]
💡 KEY FACTOR: [The single most important reason]
⚠️ RISK: [Biggest risk for the winning side]`;

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

  for (const r of results) {
    send({ type: "result", modelId: r.modelId, answer: r.answer, isError: r.isError });
  }

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

  const systemPrompt = `You are an elite ${sport} draft analyst and scout. You give sharp, specific draft recommendations for both real NFL/NHL/NBA/MLB drafts and fantasy drafts. You consider team needs, best player available, value, upside, and floor. Be confident and decisive.`;

  const userPrompt = `Give a draft recommendation for this ${mode === "fantasy" ? "FANTASY" : "REAL LIFE"} ${sport} situation:

${team ? `Team/Manager: ${team}` : ""}
Draft Position/Pick: ${pick}
${needs ? `Team Needs: ${needs}` : ""}
${available ? `Available Players to Consider: ${available}` : ""}

Give your recommendation in this exact format:
🎯 PICK: [Player Name or Position]
📋 REASONING: [2-3 sentences on why this is the right pick]
💎 UPSIDE: [Best case scenario for this pick]
📉 FLOOR: [Worst case scenario]
🔄 ALTERNATIVE: [Who to take if your top pick is gone]`;

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

  for (const r of results) {
    send({ type: "result", modelId: r.modelId, answer: r.answer, isError: r.isError });
  }

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

  const systemPrompt = `You are a fantasy ${sport} expert who gives decisive start/sit advice. You consider matchups, recent form, injuries, weather, Vegas lines, and historical trends. You never hedge — you always give a clear recommendation.`;

  const userPrompt = `Start or Sit decision for fantasy ${sport}:

Player A: ${playerA}
Player B: ${playerB}
${context ? `Additional context: ${context}` : ""}

Give your recommendation in this exact format:
✅ START: [Player Name]
❌ SIT: [Player Name]  
📊 REASONING: [2-3 sentences explaining the decision]
🎲 CONFIDENCE: [High / Medium / Low]
💥 UPSIDE ALERT: [Any ceiling game potential to know about]`;

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

  for (const r of results) {
    send({ type: "result", modelId: r.modelId, answer: r.answer, isError: r.isError });
  }

  send({ type: "done" });
  res.end();
});

app.use((req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

const port = process.env.PORT || 3000;
app.listen(port, "0.0.0.0", () => console.log(`Sports Oracle running on port ${port}`));
