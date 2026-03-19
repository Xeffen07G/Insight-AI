# 📊 Insight AI — Conversational BI Dashboard

> Upload any CSV file and ask plain-English questions to get instant interactive dashboards powered by **Google Gemini AI (FREE)**.

---

## ✨ What it does

- 📂 **Upload any CSV** — your sales data, inventory, customer list, finance sheet, anything
- 💬 **Ask in plain English** — "Show monthly revenue by region" or "Which product sold the most?"
- 📊 **Get instant dashboards** — KPI cards, line charts, bar charts, pie charts, ranked tables
- 🔄 **Follow-up questions** — "Now filter to Q4 only" or "Show only Electronics category"
- 🆓 **100% Free API** — Uses Google Gemini (free tier, no credit card needed)

---

## 🚀 Setup Guide (Step by Step)

### Step 1 — Get your FREE Gemini API Key

1. Go to 👉 **https://aistudio.google.com/app/apikey**
2. Sign in with your **Google account** (Gmail)
3. Click **"Create API Key"**
4. Copy the key (it looks like: `AIzaSy...`)

> ✅ The free tier gives you **1,500 requests/day** — more than enough!

---

### Step 2 — Open the project in VS Code

1. Unzip `insight-ai.zip` to any folder on your computer
2. Open **VS Code**
3. Go to `File → Open Folder` and select the `insight-ai` folder
4. You should see two folders: `frontend/` and `backend/`

---

### Step 3 — Add your API key

1. In VS Code, open the file: `backend/.env`
2. Replace `PASTE_YOUR_FREE_GEMINI_KEY_HERE` with your actual key:

```
GEMINI_API_KEY=AIzaSyXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
PORT=5000
```

3. Save the file (`Ctrl+S`)

---

### Step 4 — Install dependencies

Open **two terminals** in VS Code (`Terminal → New Terminal`):

**Terminal 1 — Backend:**
```bash
cd backend
npm install
```

**Terminal 2 — Frontend:**
```bash
cd frontend
npm install
```

---

### Step 5 — Start the app

Keep both terminals open and run:

**Terminal 1 (backend):**
```bash
cd backend
npm run dev
```
You should see: `✅ Insight AI backend running on http://localhost:5000`

**Terminal 2 (frontend):**
```bash
cd frontend
npm run dev
```
You should see: `Local: http://localhost:5173`

---

### Step 6 — Open in browser

Go to 👉 **http://localhost:5173**

You'll see the Insight AI dashboard. The header shows **"● API Ready"** in green if everything is set up correctly.

---

## 📁 Project Structure

```
insight-ai/
│
├── backend/
│   ├── server.js        ← Express server (handles CSV upload + Gemini API)
│   ├── package.json     ← Backend dependencies
│   └── .env             ← 🔑 PUT YOUR API KEY HERE
│
├── frontend/
│   ├── src/
│   │   ├── App.jsx      ← Full React application
│   │   └── main.jsx     ← React entry point
│   ├── index.html       ← HTML shell
│   ├── vite.config.js   ← Vite config (proxies /api → backend)
│   └── package.json     ← Frontend dependencies
│
└── README.md            ← This file
```

---

## 💬 Example Queries to Try

Once you upload a CSV, try questions like:

| Query | What you get |
|-------|-------------|
| `Show a summary of all data` | KPIs + overview charts |
| `Which category has the highest total?` | Bar chart + ranking table |
| `Show trends over time` | Line chart with time series |
| `What percentage does each group contribute?` | Pie/donut chart |
| `Compare the top 5 by revenue` | Bar chart + KPI cards |
| `Filter to only show Q3 results` | Follow-up filtering |
| `Now break this down by region` | Follow-up drill-down |

---

## 🛠 Tech Stack

| Layer | Technology | Cost |
|-------|-----------|------|
| Frontend | React 18 + Vite | Free |
| Charts | Chart.js 4 | Free |
| Backend | Node.js + Express | Free |
| AI / LLM | Google Gemini 1.5 Flash | **Free** (1500 req/day) |
| CSV Parsing | csv-parse | Free |

---

## ❓ Troubleshooting

**"API Key Missing" shown in red header**
→ Open `backend/.env` and make sure your Gemini key is pasted correctly (no spaces)

**"Cannot connect to backend"**
→ Make sure the backend terminal is running (`npm run dev` in `backend/` folder)

**"Upload failed"**
→ Make sure your file is a proper `.csv` file with a header row as the first line

**Charts not showing**
→ Hard-refresh the browser (`Ctrl+Shift+R`)

**Port already in use**
→ Change `PORT=5000` in `backend/.env` and update `vite.config.js` target accordingly

---

## 🔒 Security

- Your API key **never goes to the browser** — it stays in the backend server
- Uploaded CSV files are stored **in memory only** (not saved to disk)
- The `.gitignore` excludes `.env` so your key won't be accidentally committed

---

## 📝 CSV Format Requirements

Your CSV file should:
- ✅ Have a **header row** as the first line
- ✅ Use **commas** as separators
- ✅ Be **UTF-8 encoded** (standard for most exports)
- ✅ Be under **10MB** in size

Works great with exports from: Excel, Google Sheets, Notion, Airtable, Salesforce, QuickBooks, and more.
