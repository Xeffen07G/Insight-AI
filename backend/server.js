import express from "express";
import cors from "cors";
import multer from "multer";
import { parse } from "csv-parse/sync";
import fetch from "node-fetch";
import { readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

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
    if (key && val && !process.env[key]) {
      process.env[key] = val;
    }
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

app.use(cors());
app.use(express.json({ limit: "500mb" }));
app.use(express.urlencoded({ extended: true, limit: "500mb" }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 * 1024 },
});

const datasets = new Map();

function parseCSVBuffer(buffer) {
  const text = buffer.toString("utf-8").replace(/^\uFEFF/, "");
  const records = parse(text, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    cast: true,
    relax_quotes: true,
    relax_column_count: true,
  });
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
      stats[h] = {
        type: "numeric",
        min: Math.min(...nums),
        max: Math.max(...nums),
        avg: parseFloat((sum / nums.length).toFixed(2)),
        sum: parseFloat(sum.toFixed(2)),
      };
    } else {
      const unique = [...new Set(vals.map(String))];
      stats[h] = {
        type: "categorical",
        uniqueValues: unique.slice(0, 20),
        totalUnique: unique.length,
      };
    }
  }
  return stats;
}

app.get("/", (_req, res) => {
  res.json({ message: "Insight AI Backend is running!" });
});

app.post("/api/upload", (req, res) => {
  upload.single("csv")(req, res, (err) => {
    if (err) {
      console.error("Upload error:", err.message);
      return res.status(400).json({ error: err.message });
    }
    try {
      if (!req.file) return res.status(400).json({ error: "No file uploaded." });
      console.log("📂 Received:", req.file.originalname, (req.file.size / 1024 / 1024).toFixed(1) + "MB");
      const { headers, rows } = parseCSVBuffer(req.file.buffer);
      const sessionId = Date.now().toString();
      const stats = buildStats(headers, rows);
      datasets.set(sessionId, { headers, rows, stats, filename: req.file.originalname });
      console.log("✅ Parsed:", rows.length, "rows,", headers.length, "columns");
      res.json({
        sessionId,
        filename: req.file.originalname,
        headers,
        totalRows: rows.length,
        stats,
        preview: rows.slice(0, 3),
      });
    } catch (err) {
      console.error("Parse error:", err.message);
      res.status(400).json({ error: err.message });
    }
  });
});

app.post("/api/generate", async (req, res) => {
  const { query, sessionId, history = [] } = req.body;

  if (!query) return res.status(400).json({ error: "Query is required." });

  if (!GROQ_API_KEY || GROQ_API_KEY === "PASTE_YOUR_GROQ_KEY_HERE") {
    return res.status(500).json({
      error: "Groq API key not set. Open backend/.env and paste your free key from https://console.groq.com then restart the backend.",
    });
  }

  const dataset = sessionId ? datasets.get(sessionId) : null;
  if (!dataset) return res.status(400).json({ error: "Dataset not found. Please upload your CSV again." });

  const { headers, rows, stats, filename } = dataset;

  const sampleRows = rows.slice(0, 50);

  const systemPrompt = "You are an expert BI analyst. Analyze the data and return a JSON dashboard.\n\n" +
    "DATASET: " + filename + "\n" +
    "COLUMNS: " + headers.join(", ") + "\n" +
    "TOTAL ROWS: " + rows.length + "\n\n" +
    "COLUMN STATS (computed from ALL rows):\n" + JSON.stringify(stats, null, 2) + "\n\n" +
    "SAMPLE DATA (first 50 rows):\n" + JSON.stringify(sampleRows, null, 2) + "\n\n" +
    "RETURN ONLY VALID JSON. No markdown, no code fences, no explanation.\n\n" +
    "Structure:\n" +
    "{\n" +
    "  \"title\": \"string\",\n" +
    "  \"summary\": \"string\",\n" +
    "  \"kpis\": [{ \"title\": \"string\", \"value\": \"string\", \"sub\": \"string\", \"color\": \"#hex\" }],\n" +
    "  \"charts\": [{\n" +
    "    \"title\": \"string\",\n" +
    "    \"insight\": \"string\",\n" +
    "    \"spec\": {\n" +
    "      \"type\": \"line|bar|pie|doughnut|scatter\",\n" +
    "      \"labels\": [\"string\"],\n" +
    "      \"datasets\": [{ \"label\": \"string\", \"data\": [0] }]\n" +
    "    }\n" +
    "  }],\n" +
    "  \"table\": { \"title\": \"string\", \"headers\": [\"string\"], \"rows\": [[0]] }\n" +
    "}\n\n" +
    "RULES:\n" +
    "1. Use the COLUMN STATS for aggregated values like totals, averages, min, max — these are computed from ALL rows.\n" +
    "2. Use SAMPLE DATA for row-level analysis and patterns.\n" +
    "3. line=time trends, bar=comparisons, pie or doughnut=parts of whole max 7 slices, scatter=correlations.\n" +
    "4. Include 2-4 KPIs and 1-3 charts. Table is optional max 10 rows.\n" +
    "5. If unanswerable return: { \"error\": \"reason\" }\n" +
    "6. For follow-up queries filter or modify according to the instruction.";

  const messages = [{ role: "system", content: systemPrompt }];

  for (const m of history) {
    messages.push({
      role: m.role === "assistant" ? "assistant" : "user",
      content: m.role === "assistant" && m.dashboard
        ? "[Dashboard rendered for: " + m.query + "]"
        : String(m.text || ""),
    });
  }
  messages.push({ role: "user", content: query });

  try {
    console.log("📡 Calling Groq for:", query);

    const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + GROQ_API_KEY,
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages,
        temperature: 0.1,
        max_tokens: 8192,
        response_format: { type: "json_object" },
      }),
    });

    const groqData = await groqRes.json();

    if (!groqRes.ok) {
      const msg = groqData?.error?.message || "Groq HTTP " + groqRes.status;
      console.error("Groq error:", msg);
      return res.status(500).json({ error: msg });
    }

    const rawText = groqData?.choices?.[0]?.message?.content || "";

    if (!rawText) {
      return res.status(500).json({ error: "Empty response from Groq. Please try again." });
    }

    const cleaned = rawText.replace(/^```json\s*/i, "").replace(/```$/, "").trim();

    let dashboard;
    try {
      dashboard = JSON.parse(cleaned);
    } catch (e) {
      console.error("JSON parse failed. Raw:", rawText.slice(0, 400));
      return res.status(500).json({ error: "AI returned invalid format. Try rephrasing your question." });
    }

    console.log("✅ Dashboard ready:", dashboard.title || "(untitled)");
    res.json({ dashboard });

  } catch (err) {
    console.error("Network error:", err.message);
    res.status(500).json({ error: "Network error: " + err.message });
  }
});

app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    geminiConfigured: !!GROQ_API_KEY && GROQ_API_KEY !== "PASTE_YOUR_GROQ_KEY_HERE",
  });
});

app.listen(PORT, () => {
  console.log("\n🚀 Backend running → http://localhost:" + PORT);
  console.log("   Health check  → http://localhost:" + PORT + "/api/health\n");
});
