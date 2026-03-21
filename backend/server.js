import express from "express";
import cors from "cors";
import multer from "multer";
import { parse } from "csv-parse/sync";
import fetch from "node-fetch";
import { readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";
import pkg from "pg";
const { Pool } = pkg;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, ".env");

if (existsSync(envPath)) {
  const lines = readFileSync(envPath, "utf-8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx < 1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (key && val && !process.env[key]) process.env[key] = val;
  }
  console.log("✅ .env loaded");
} else {
  console.warn("⚠️  No .env found at:", envPath);
}

const app = express();
const PORT = process.env.PORT || 5000;
const GROQ_API_KEY = (process.env.GROQ_API_KEY || "").trim();

if (GROQ_API_KEY && GROQ_API_KEY !== "PASTE_YOUR_GROQ_KEY_HERE") {
  console.log("🔑 Groq key loaded:", GROQ_API_KEY.slice(0, 8) + "..." + GROQ_API_KEY.slice(-4));
} else {
  console.warn("⚠️  GROQ_API_KEY not set — edit backend/.env");
}

// ── PostgreSQL (Supabase) setup ────────────────────────────────────────────────
const DATABASE_URL = process.env.DATABASE_URL;
let pool = null;

if (DATABASE_URL) {
  pool = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
  pool.query(`
    CREATE TABLE IF NOT EXISTS conversations (
      id SERIAL PRIMARY KEY,
      chat_id TEXT NOT NULL,
      filename TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS messages (
      id SERIAL PRIMARY KEY,
      chat_id TEXT NOT NULL,
      role TEXT NOT NULL,
      text TEXT,
      query TEXT,
      dashboard TEXT,
      created_at TEXT NOT NULL
    );
  `).then(() => console.log("💾 PostgreSQL database ready"))
    .catch(err => console.error("❌ DB setup error:", err.message));
} else {
  console.warn("⚠️  DATABASE_URL not set — history will not persist");
}

app.use(cors({ origin: "*", methods: ["GET", "POST", "DELETE"], allowedHeaders: ["Content-Type"] }));
app.use(express.json({ limit: "500mb" }));
app.use(express.urlencoded({ extended: true, limit: "500mb" }));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 500 * 1024 * 1024 } });
const datasets = new Map();

function parseCSVBuffer(buffer) {
  const text = buffer.toString("utf-8").replace(/^\uFEFF/, "");
  const records = parse(text, { columns: true, skip_empty_lines: true, trim: true, cast: true, relax_quotes: true, relax_column_count: true });
  if (!records || records.length === 0) throw new Error("CSV is empty or invalid.");
  return { headers: Object.keys(records[0]), rows: records };
}

function buildStats(headers, rows) {
  const stats = {};
  for (const h of headers) {
    const vals = rows.map((r) => r[h]).filter((v) => v != null && v !== "");
    const nums = vals.filter((v) => typeof v === "number");
    if (nums.length > vals.length * 0.5) {
      const sum = nums.reduce((a, b) => a + b, 0);
      stats[h] = { type: "numeric", min: Math.min(...nums), max: Math.max(...nums), avg: parseFloat((sum / nums.length).toFixed(2)), sum: parseFloat(sum.toFixed(2)) };
    } else {
      const unique = [...new Set(vals.map(String))];
      stats[h] = { type: "categorical", uniqueValues: unique.slice(0, 20), totalUnique: unique.length };
    }
  }
  return stats;
}

function compactStats(stats) {
  const compact = {};
  for (const [k, v] of Object.entries(stats)) {
    if (v.type === "numeric") compact[k] = { n: true, min: v.min, max: v.max, avg: v.avg, sum: v.sum };
    else compact[k] = { n: false, vals: v.uniqueValues.slice(0, 5), total: v.totalUnique };
  }
  return compact;
}

app.get("/", (_req, res) => res.json({ message: "Insight AI Backend is running!" }));

// ── POST /api/upload ───────────────────────────────────────────────────────────
app.post("/api/upload", (req, res) => {
  upload.single("csv")(req, res, async (err) => {
    if (err) { console.error("Upload error:", err.message); return res.status(400).json({ error: err.message }); }
    try {
      if (!req.file) return res.status(400).json({ error: "No file uploaded." });
      console.log("📂 Received:", req.file.originalname, (req.file.size / 1024 / 1024).toFixed(1) + "MB");
      const { headers, rows } = parseCSVBuffer(req.file.buffer);
      const sessionId = Date.now().toString();
      const stats = buildStats(headers, rows);
      datasets.set(sessionId, { headers, rows, stats, filename: req.file.originalname });
      const chatId = sessionId;
      const now = new Date().toISOString();
      if (pool) {
        await pool.query("INSERT INTO conversations (chat_id, filename, created_at) VALUES ($1, $2, $3)", [chatId, req.file.originalname, now]);
      }
      console.log("✅ Parsed:", rows.length, "rows,", headers.length, "columns");
      res.json({ sessionId, chatId, filename: req.file.originalname, headers, totalRows: rows.length, stats, preview: rows.slice(0, 3) });
    } catch (err) { console.error("Parse error:", err.message); res.status(400).json({ error: err.message }); }
  });
});

// ── POST /api/generate ─────────────────────────────────────────────────────────
app.post("/api/generate", async (req, res) => {
  const { query, sessionId, chatId, history = [] } = req.body;
  if (!query) return res.status(400).json({ error: "Query is required." });
  if (!GROQ_API_KEY || GROQ_API_KEY === "PASTE_YOUR_GROQ_KEY_HERE") {
    return res.status(500).json({ error: "Groq API key not set." });
  }
  const dataset = sessionId ? datasets.get(sessionId) : null;
  if (!dataset) return res.status(400).json({ error: "Dataset not found. Please upload your CSV again." });

  const { headers, rows, stats, filename } = dataset;
  const sampleRows = rows.slice(0, 2);
  const cs = compactStats(stats);

  const systemPrompt =
    "You are a BI analyst. Return ONLY valid JSON dashboard. No markdown.\n" +
    "Dataset:" + filename + " Cols:" + headers.join(",") + " Rows:" + rows.length + "\n" +
    "Stats:" + JSON.stringify(cs) + "\n" +
    "Sample:" + JSON.stringify(sampleRows) + "\n" +
    "JSON structure:{title,summary,kpis:[{title,value,sub,color}],charts:[{title,insight,spec:{type,labels:[],datasets:[{label,data:[]}]}}],table:{title,headers:[],rows:[[]]}}\n" +
    "Rules:use stats for totals/avgs.line=trends,bar=compare,pie/doughnut=parts(max7),scatter=correlation.2-4 KPIs,1-3 charts.If cant answer:{error:reason}";

  const messages = [{ role: "system", content: systemPrompt }];
  for (const m of history) {
    messages.push({
      role: m.role === "assistant" ? "assistant" : "user",
      content: m.role === "assistant" && m.dashboard ? "[Dashboard:" + m.query + "]" : String(m.text || ""),
    });
  }
  messages.push({ role: "user", content: query });

  const now = new Date().toISOString();
  if (pool && chatId) {
    await pool.query("INSERT INTO messages (chat_id, role, text, query, dashboard, created_at) VALUES ($1, $2, $3, $4, $5, $6)", [chatId, "user", query, null, null, now]);
  }

  try {
    console.log("📡 Calling Groq for:", query);
    const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + GROQ_API_KEY },
      body: JSON.stringify({ model: "llama-3.1-8b-instant", messages, temperature: 0.1, max_tokens: 800, response_format: { type: "json_object" } }),
    });

    const groqData = await groqRes.json();
    if (!groqRes.ok) {
      const msg = groqData?.error?.message || "Groq HTTP " + groqRes.status;
      console.error("Groq error:", msg);
      return res.status(500).json({ error: msg });
    }

    const rawText = groqData?.choices?.[0]?.message?.content || "";
    if (!rawText) return res.status(500).json({ error: "Empty response from Groq. Please try again." });

    const cleaned = rawText.replace(/^```json\s*/i, "").replace(/```$/, "").trim();
    let dashboard;
    try { dashboard = JSON.parse(cleaned); }
    catch { return res.status(500).json({ error: "AI returned invalid format. Try rephrasing." }); }

    if (pool && chatId) {
      await pool.query("INSERT INTO messages (chat_id, role, text, query, dashboard, created_at) VALUES ($1, $2, $3, $4, $5, $6)", [chatId, "assistant", null, query, JSON.stringify(dashboard), new Date().toISOString()]);
    }

    console.log("✅ Dashboard ready:", dashboard.title || "(untitled)");
    res.json({ dashboard });
  } catch (err) {
    console.error("Network error:", err.message);
    res.status(500).json({ error: "Network error: " + err.message });
  }
});

// ── GET /api/history ───────────────────────────────────────────────────────────
app.get("/api/history", async (_req, res) => {
  if (!pool) return res.json({ conversations: [] });
  try {
    const result = await pool.query("SELECT * FROM conversations ORDER BY created_at DESC LIMIT 20");
    res.json({ conversations: result.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /api/history/:chatId ───────────────────────────────────────────────────
app.get("/api/history/:chatId", async (req, res) => {
  if (!pool) return res.status(500).json({ error: "Database not configured" });
  try {
    const { chatId } = req.params;
    const convo = await pool.query("SELECT * FROM conversations WHERE chat_id = $1", [chatId]);
    const msgs = await pool.query("SELECT * FROM messages WHERE chat_id = $1 ORDER BY created_at ASC", [chatId]);
    const parsed = msgs.rows.map(m => ({ role: m.role, text: m.text, query: m.query, dashboard: m.dashboard ? JSON.parse(m.dashboard) : null }));
    res.json({ conversation: convo.rows[0], messages: parsed });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── DELETE /api/history/:chatId ────────────────────────────────────────────────
app.delete("/api/history/:chatId", async (req, res) => {
  if (!pool) return res.status(500).json({ error: "Database not configured" });
  try {
    const { chatId } = req.params;
    await pool.query("DELETE FROM conversations WHERE chat_id = $1", [chatId]);
    await pool.query("DELETE FROM messages WHERE chat_id = $1", [chatId]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /api/health ────────────────────────────────────────────────────────────
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", geminiConfigured: !!GROQ_API_KEY && GROQ_API_KEY !== "PASTE_YOUR_GROQ_KEY_HERE" });
});

app.listen(PORT, () => {
  console.log("\n🚀 Backend running → http://localhost:" + PORT);
  console.log("   Health check  → http://localhost:" + PORT + "/api/health\n");
});
