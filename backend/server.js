import express from "express";
import cors from "cors";
import multer from "multer";
import { parse } from "csv-parse/sync";
import fetch from "node-fetch";
import { readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";
import Database from "better-sqlite3";

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

// ── SQLite ─────────────────────────────────────────────────────────────────────
const db = new Database(path.join(__dirname, "history.db"));
db.exec(`
  CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id TEXT NOT NULL,
    filename TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id TEXT NOT NULL,
    role TEXT NOT NULL,
    text TEXT,
    query TEXT,
    dashboard TEXT,
    created_at TEXT NOT NULL
  );
`);
console.log("💾 SQLite database ready");

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

// ── Compact stats to save tokens ───────────────────────────────────────────────
function compactStats(stats) {
  const compact = {};
  for (const [k, v] of Object.entries(stats)) {
    if (v.type === "numeric") {
      compact[k] = { n: true, min: v.min, max: v.max, avg: v.avg, sum: v.sum };
    } else {
      compact[k] = { n: false, vals: v.uniqueValues.slice(0, 5), total: v.totalUnique };
    }
  }
  return compact;
}

app.get("/", (_req, res) => res.json({ message: "Insight AI Backend is running!" }));

// ── POST /api/upload ───────────────────────────────────────────────────────────
app.post("/api/upload", (req, res) => {
  upload.single("csv")(req, res, (err) => {
    if (err) { console.error("Upload error:", err.message); return res.status(400).json({ error: err.message }); }
    try {
      if (!req.file) return res.status(400).json({ error: "No file uploaded." });
      console.log("📂 Received:", req.file.originalname, (req.file.size / 1024 / 1024).toFixed(1) + "MB");
      const { headers, rows } = parseCSVBuffer(req.file.buffer);
      const sessionId = Date.now().toString();
      const stats = buildStats(headers, rows);
      datasets.set(sessionId, { headers, rows, stats, filename: req.file.originalname });
      const chatId = sessionId;
      db.prepare("INSERT INTO conversations (chat_id, filename, created_at) VALUES (?, ?, ?)").run(chatId, req.file.originalname, new Date().toISOString());
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

  // Ultra compact prompt to save tokens
  const sampleRows = rows.slice(0, 2);
  const cs = compactStats(stats);

  const systemPrompt =
    "You are a BI analyst. Return ONLY valid JSON dashboard. No markdown.\n" +
    "Dataset:" + filename + " Cols:" + headers.join(",") + " Rows:" + rows.length + "\n" +
    "Stats(n=numeric,n=false=categorical):" + JSON.stringify(cs) + "\n" +
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

  if (chatId) {
    db.prepare("INSERT INTO messages (chat_id, role, text, query, dashboard, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(chatId, "user", query, null, null, new Date().toISOString());
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

    if (chatId) {
      db.prepare("INSERT INTO messages (chat_id, role, text, query, dashboard, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(chatId, "assistant", null, query, JSON.stringify(dashboard), new Date().toISOString());
    }

    console.log("✅ Dashboard ready:", dashboard.title || "(untitled)");
    res.json({ dashboard });
  } catch (err) {
    console.error("Network error:", err.message);
    res.status(500).json({ error: "Network error: " + err.message });
  }
});

// ── GET /api/history ───────────────────────────────────────────────────────────
app.get("/api/history", (_req, res) => {
  try {
    const convos = db.prepare("SELECT * FROM conversations ORDER BY created_at DESC LIMIT 20").all();
    res.json({ conversations: convos });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /api/history/:chatId ───────────────────────────────────────────────────
app.get("/api/history/:chatId", (req, res) => {
  try {
    const { chatId } = req.params;
    const convo = db.prepare("SELECT * FROM conversations WHERE chat_id = ?").get(chatId);
    const msgs = db.prepare("SELECT * FROM messages WHERE chat_id = ? ORDER BY created_at ASC").all(chatId);
    const parsed = msgs.map(m => ({ role: m.role, text: m.text, query: m.query, dashboard: m.dashboard ? JSON.parse(m.dashboard) : null }));
    res.json({ conversation: convo, messages: parsed });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── DELETE /api/history/:chatId ────────────────────────────────────────────────
app.delete("/api/history/:chatId", (req, res) => {
  try {
    const { chatId } = req.params;
    db.prepare("DELETE FROM conversations WHERE chat_id = ?").run(chatId);
    db.prepare("DELETE FROM messages WHERE chat_id = ?").run(chatId);
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
