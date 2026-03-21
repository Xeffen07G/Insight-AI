import { useState, useRef, useEffect, useCallback } from "react";

const API = "https://insight-ai-backend-98tv.onrender.com";

function ChartWidget({ spec }) {
  const canvasRef = useRef(null);
  const chartRef = useRef(null);

  useEffect(() => {
    if (!canvasRef.current || !spec || !window.Chart) return;
    if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null; }
    const isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const PALETTE = ["#4f7ef7","#f7864f","#22c55e","#a855f7","#f59e0b","#06b6d4","#ef4444","#84cc16"];
    const gridC = isDark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.06)";
    const tickC = isDark ? "rgba(255,255,255,0.45)" : "rgba(0,0,0,0.45)";
    const isPie = spec.type === "pie" || spec.type === "doughnut";
    const datasets = (spec.datasets || []).map((ds, i) => ({
      ...ds,
      backgroundColor: isPie ? (spec.labels || []).map((_, j) => PALETTE[j % PALETTE.length]) : spec.type === "line" ? PALETTE[i % PALETTE.length] + "20" : PALETTE[i % PALETTE.length],
      borderColor: isPie ? undefined : PALETTE[i % PALETTE.length],
      borderWidth: spec.type === "line" ? 2.5 : spec.type === "bar" ? 0 : undefined,
      fill: spec.type === "line", tension: spec.type === "line" ? 0.35 : undefined,
      pointRadius: spec.type === "line" ? 3 : undefined, pointHoverRadius: spec.type === "line" ? 6 : undefined,
      hoverOffset: isPie ? 6 : undefined,
    }));
    chartRef.current = new window.Chart(canvasRef.current.getContext("2d"), {
      type: spec.type, data: { labels: spec.labels || [], datasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: datasets.length > 1 || isPie, labels: { color: tickC, boxWidth: 10, padding: 14, font: { size: 12 } } },
          tooltip: { callbacks: { label: (c) => { const v = c.parsed?.y ?? c.raw; const lbl = c.dataset.label || c.label || ""; return typeof v === "number" ? ` ${lbl}: ${v.toLocaleString()}` : ` ${lbl}: ${c.raw}`; } } },
        },
        scales: isPie ? undefined : {
          x: { ticks: { color: tickC, maxRotation: 45, font: { size: 11 } }, grid: { color: gridC } },
          y: { ticks: { color: tickC, font: { size: 11 }, callback: (v) => v >= 1e6 ? (v/1e6).toFixed(1)+"M" : v >= 1e3 ? (v/1e3).toFixed(0)+"k" : v }, grid: { color: gridC } },
        },
        ...(spec.options || {}),
      },
    });
    return () => { if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null; } };
  }, [spec]);

  const h = (spec.type === "pie" || spec.type === "doughnut") ? 260 : (spec.datasets?.[0]?.data?.length || 0) > 8 ? 320 : 270;
  return <div style={{ position: "relative", width: "100%", height: h }}><canvas ref={canvasRef} /></div>;
}

function KPICard({ title, value, sub, color }) {
  return (
    <div style={{ background: "var(--bg-secondary)", borderRadius: "var(--radius-md)", padding: "16px 18px", display: "flex", flexDirection: "column", gap: 5, border: "1px solid var(--border)" }}>
      <div style={{ fontSize: 11, color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 600 }}>{title}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color: color || "var(--text-primary)", lineHeight: 1.1 }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.4 }}>{sub}</div>}
    </div>
  );
}

function DashboardPanel({ data }) {
  if (!data) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {(data.title || data.summary) && (
        <div style={{ paddingBottom: 4 }}>
          {data.title && <h2 style={{ fontSize: 17, fontWeight: 600, color: "var(--text-primary)", marginBottom: 4 }}>{data.title}</h2>}
          {data.summary && <p style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.6 }}>{data.summary}</p>}
        </div>
      )}
      {data.kpis?.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10 }}>
          {data.kpis.map((k, i) => <KPICard key={i} {...k} />)}
        </div>
      )}
      {data.charts?.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: data.charts.length === 1 ? "1fr" : "repeat(auto-fit, minmax(300px, 1fr))", gap: 14 }}>
          {data.charts.map((ch, i) => (
            <div key={i} style={{ background: "var(--bg-primary)", borderRadius: "var(--radius-md)", border: "1px solid var(--border)", padding: "16px 18px", boxShadow: "var(--shadow-sm)" }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", marginBottom: 14 }}>{ch.title}</div>
              <ChartWidget spec={ch.spec} />
              {ch.insight && (
                <div style={{ marginTop: 12, fontSize: 12, color: "var(--text-secondary)", borderTop: "1px solid var(--border)", paddingTop: 10, lineHeight: 1.5, display: "flex", gap: 6 }}>
                  <span>💡</span><span>{ch.insight}</span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {data.table && (
        <div style={{ background: "var(--bg-primary)", borderRadius: "var(--radius-md)", border: "1px solid var(--border)", overflow: "hidden", boxShadow: "var(--shadow-sm)" }}>
          <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>{data.table.title}</div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ background: "var(--bg-secondary)" }}>
                  {data.table.headers.map((h, i) => (
                    <th key={i} style={{ padding: "9px 14px", textAlign: i === 0 ? "left" : "right", color: "var(--text-tertiary)", fontWeight: 600, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", borderBottom: "1px solid var(--border)", whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.table.rows.map((row, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid var(--border)" }} onMouseEnter={e => e.currentTarget.style.background = "var(--bg-secondary)"} onMouseLeave={e => e.currentTarget.style.background = ""}>
                    {row.map((cell, j) => (
                      <td key={j} style={{ padding: "9px 14px", textAlign: j === 0 ? "left" : "right", color: "var(--text-primary)" }}>
                        {typeof cell === "number" ? cell.toLocaleString() : cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function UploadZone({ onUpload, loading }) {
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef(null);
  const handleFile = async (file) => { if (!file || !file.name.endsWith(".csv")) { alert("Please upload a .csv file"); return; } onUpload(file); };
  return (
    <div onClick={() => fileRef.current?.click()} onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={e => { e.preventDefault(); setDragging(false); handleFile(e.dataTransfer.files[0]); }}
      style={{ border: `2px dashed ${dragging ? "var(--accent)" : "var(--border-hover)"}`, borderRadius: "var(--radius-lg)", padding: "28px 16px", textAlign: "center", cursor: "pointer", background: dragging ? "var(--accent-light)" : "var(--bg-primary)", transition: "all 0.2s" }}>
      <div style={{ fontSize: 28, marginBottom: 8 }}>{loading ? "⏳" : "📂"}</div>
      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", marginBottom: 4 }}>{loading ? "Uploading..." : "Drop CSV here"}</div>
      <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>or click to browse</div>
      <input ref={fileRef} type="file" accept=".csv" style={{ display: "none" }} onChange={e => handleFile(e.target.files[0])} />
    </div>
  );
}

function DatasetBadge({ info, onClear }) {
  return (
    <div style={{ background: "var(--accent-light)", border: "1px solid var(--accent)", borderRadius: "var(--radius-md)", padding: "10px 12px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, overflow: "hidden" }}>
        <span style={{ fontSize: 16 }}>📊</span>
        <div style={{ overflow: "hidden" }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--accent)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{info.filename}</div>
          {info.totalRows > 0 && <div style={{ fontSize: 10, color: "var(--text-secondary)" }}>{info.totalRows.toLocaleString()} rows · {info.headers?.length} cols</div>}
        </div>
      </div>
      <button onClick={onClear} style={{ background: "none", border: "1px solid var(--accent)", borderRadius: "var(--radius-sm)", padding: "3px 8px", fontSize: 11, color: "var(--accent)", cursor: "pointer", flexShrink: 0 }}>Change</button>
    </div>
  );
}

function HistorySidebar({ onLoadChat }) {
  const [history, setHistory] = useState([]);
  const [loadingH, setLoadingH] = useState(true);

  useEffect(() => {
    fetch(`${API}/api/history`).then(r => r.json()).then(d => setHistory(d.conversations || [])).catch(() => setHistory([])).finally(() => setLoadingH(false));
  }, []);

  const deleteChat = async (chatId, e) => {
    e.stopPropagation();
    await fetch(`${API}/api/history/${chatId}`, { method: "DELETE" }).catch(() => {});
    setHistory(prev => prev.filter(c => c.chat_id !== chatId));
  };

  const formatDate = (iso) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

  if (loadingH) return <div style={{ fontSize: 12, color: "var(--text-tertiary)", textAlign: "center", padding: 12 }}>Loading…</div>;
  if (history.length === 0) return <div style={{ fontSize: 12, color: "var(--text-tertiary)", textAlign: "center", padding: 12 }}>No past conversations yet</div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {history.map((c) => (
        <div key={c.chat_id} onClick={() => onLoadChat(c.chat_id)}
          style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", padding: "8px 10px", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", transition: "all 0.15s" }}
          onMouseEnter={e => e.currentTarget.style.borderColor = "var(--accent)"}
          onMouseLeave={e => e.currentTarget.style.borderColor = "var(--border)"}>
          <div style={{ overflow: "hidden" }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>📊 {c.filename}</div>
            <div style={{ fontSize: 10, color: "var(--text-tertiary)" }}>{formatDate(c.created_at)}</div>
          </div>
          <button onClick={(e) => deleteChat(c.chat_id, e)} style={{ background: "none", border: "none", color: "var(--text-tertiary)", cursor: "pointer", fontSize: 13, padding: "2px 4px", flexShrink: 0 }} title="Delete">🗑</button>
        </div>
      ))}
    </div>
  );
}

function SuggestedPrompts({ headers, onSelect }) {
  const suggestions = [
    `Show a summary of all numeric columns with key statistics`,
    `Which ${headers[0] || "category"} has the highest values?`,
    `Show the distribution of data across all categories`,
    `Compare top 5 entries by the most important metric`,
    `Show trends and patterns in this dataset`,
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Try these</div>
      {suggestions.map((s, i) => (
        <button key={i} onClick={() => onSelect(s)}
          style={{ background: "var(--bg-primary)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", padding: "8px 12px", fontSize: 12, color: "var(--text-secondary)", cursor: "pointer", textAlign: "left", lineHeight: 1.4, transition: "all 0.15s" }}
          onMouseEnter={e => { e.target.style.borderColor = "var(--accent)"; e.target.style.color = "var(--text-primary)"; }}
          onMouseLeave={e => { e.target.style.borderColor = "var(--border)"; e.target.style.color = "var(--text-secondary)"; }}>
          ↗ {s}
        </button>
      ))}
    </div>
  );
}

export default function App() {
  const [datasetInfo, setDatasetInfo] = useState(null);
  const [sessionId, setSessionId]     = useState(null);
  const [chatId, setChatId]           = useState(null);
  const [messages, setMessages]       = useState([]);
  const [query, setQuery]             = useState("");
  const [loading, setLoading]         = useState(false);
  const [uploading, setUploading]     = useState(false);
  const [phase, setPhase]             = useState("");
  const [listening, setListening]     = useState(false);
  const [backendOk, setBackendOk]     = useState(null);
  const [showHistory, setShowHistory] = useState(false);
  const [historyKey, setHistoryKey]   = useState(0);
  const bottomRef   = useRef(null);
  const textareaRef = useRef(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, loading]);
  useEffect(() => { fetch(`${API}/api/health`).then(r => r.json()).then(d => setBackendOk(d)).catch(() => setBackendOk(null)); }, []);

  const handleUpload = useCallback(async (file) => {
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("csv", file);
      const res = await fetch(`${API}/api/upload`, { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");
      setDatasetInfo(data);
      setSessionId(data.sessionId);
      setChatId(data.chatId);
      setMessages([]);
      setHistoryKey(k => k + 1);
    } catch (err) { alert(`Upload failed: ${err.message}`); }
    finally { setUploading(false); }
  }, []);

  const handleLoadChat = async (cId) => {
    try {
      const res = await fetch(`${API}/api/history/${cId}`);
      const data = await res.json();
      if (!data.messages) return;
      setMessages(data.messages);
      setDatasetInfo({ filename: data.conversation.filename, totalRows: 0, headers: [] });
      setChatId(cId);
      setShowHistory(false);
    } catch (err) { alert("Could not load chat: " + err.message); }
  };

  const handleVoice = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { alert("Voice input requires Chrome."); return; }
    const r = new SR();
    r.lang = "en-US"; r.interimResults = false;
    r.onstart = () => setListening(true);
    r.onend   = () => setListening(false);
    r.onresult = (e) => { const t = e.results[0][0].transcript; setQuery(t); setTimeout(() => handleSubmit(), 500); };
    r.onerror = () => setListening(false);
    r.start();
  };

  const handleSubmit = async () => {
    const q = query.trim();
    if (!q || loading || !sessionId) return;
    setQuery("");
    setLoading(true);
    setPhase("Analyzing your query…");
    setMessages(prev => [...prev, { role: "user", text: q }]);
    try {
      setTimeout(() => setPhase("Building your dashboard…"), 1200);
      const res = await fetch(`${API}/api/generate`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q, sessionId, chatId, history: messages }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      const { dashboard } = data;
      if (dashboard.error) {
        setMessages(prev => [...prev, { role: "assistant", text: `⚠️ ${dashboard.error}`, query: q }]);
      } else {
        setMessages(prev => [...prev, { role: "assistant", dashboard, query: q }]);
      }
    } catch (err) {
      setMessages(prev => [...prev, { role: "assistant", text: `❌ Error: ${err.message}`, query: q }]);
    } finally { setLoading(false); setPhase(""); }
  };

  const handleKey = (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSubmit(); } };

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", background: "var(--bg-tertiary)" }}>

      {/* Header */}
      <header style={{ background: "var(--bg-sidebar)", padding: "0 24px", display: "flex", alignItems: "center", justifyContent: "space-between", height: 56, flexShrink: 0, borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: "linear-gradient(135deg, #4f7ef7, #7c3aed)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17 }}>📊</div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#f1f5f9", lineHeight: 1.2 }}>Insight AI</div>
            <div style={{ fontSize: 11, color: "#64748b" }}>Natural Language → BI Dashboard</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {backendOk !== null && (
            <div style={{ fontSize: 11, padding: "4px 10px", borderRadius: 99, background: backendOk?.geminiConfigured ? "rgba(34,197,94,0.15)" : "rgba(239,68,68,0.15)", color: backendOk?.geminiConfigured ? "#22c55e" : "#ef4444", border: `1px solid ${backendOk?.geminiConfigured ? "rgba(34,197,94,0.3)" : "rgba(239,68,68,0.3)"}` }}>
              {backendOk?.geminiConfigured ? "● API Ready" : "● API Key Missing"}
            </div>
          )}
          <button onClick={() => setShowHistory(h => !h)}
            style={{ background: showHistory ? "var(--accent)" : "var(--bg-secondary)", color: showHistory ? "#fff" : "var(--text-secondary)", border: "1px solid var(--border-hover)", borderRadius: "var(--radius-md)", padding: "5px 12px", fontSize: 12, cursor: "pointer", transition: "all 0.2s" }}>
            🕐 History
          </button>
          {datasetInfo && datasetInfo.totalRows > 0 && <div style={{ fontSize: 11, color: "#94a3b8" }}>{datasetInfo.filename} · {datasetInfo.totalRows.toLocaleString()} rows</div>}
        </div>
      </header>

      {/* Main */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>

        {/* Left sidebar */}
        <aside style={{ width: 255, flexShrink: 0, background: "var(--bg-primary)", borderRight: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: 16, padding: 16, overflowY: "auto" }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 8 }}>Dataset</div>
            {datasetInfo ? <DatasetBadge info={datasetInfo} onClear={() => { setDatasetInfo(null); setSessionId(null); setChatId(null); setMessages([]); }} /> : <UploadZone onUpload={handleUpload} loading={uploading} />}
          </div>
          {datasetInfo && datasetInfo.headers?.length > 0 && (
            <>
              <div style={{ borderTop: "1px solid var(--border)", paddingTop: 14 }}>
                <SuggestedPrompts headers={datasetInfo.headers} onSelect={(s) => { setQuery(s); setTimeout(() => textareaRef.current?.focus(), 50); }} />
              </div>
              <div style={{ borderTop: "1px solid var(--border)", paddingTop: 14 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 8 }}>Columns ({datasetInfo.headers.length})</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                  {datasetInfo.headers.map((h, i) => (
                    <span key={i} style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "2px 7px", fontSize: 10, color: "var(--text-secondary)" }}>{h}</span>
                  ))}
                </div>
              </div>
            </>
          )}
        </aside>

        {/* History panel */}
        {showHistory && (
          <div style={{ width: 255, flexShrink: 0, background: "var(--bg-primary)", borderRight: "1px solid var(--border)", display: "flex", flexDirection: "column", padding: 16, overflowY: "auto" }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 12 }}>Past Conversations</div>
            <HistorySidebar key={historyKey} onLoadChat={handleLoadChat} />
          </div>
        )}

        {/* Chat */}
        <main style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{ flex: 1, overflowY: "auto", padding: "24px", display: "flex", flexDirection: "column", gap: 20 }}>

            {!datasetInfo && (
              <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", padding: 40 }}>
                <div style={{ fontSize: 52, marginBottom: 16 }}>📊</div>
                <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--text-primary)", marginBottom: 8 }}>Upload your CSV to get started</h1>
                <p style={{ fontSize: 14, color: "var(--text-secondary)", lineHeight: 1.7, maxWidth: 400 }}>Drop any CSV file in the sidebar. Insight AI will analyze it and generate interactive dashboards from plain-English questions.</p>
                <div style={{ marginTop: 12, fontSize: 13, color: "var(--text-tertiary)" }}>Or click <strong style={{ color: "var(--text-secondary)" }}>🕐 History</strong> to reload a past conversation</div>
                <div style={{ marginTop: 20, display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
                  {["📈 Sales reports", "📦 Inventory data", "👥 Customer data", "💰 Finance sheets"].map((tag, i) => (
                    <span key={i} style={{ background: "var(--bg-primary)", border: "1px solid var(--border)", borderRadius: 99, padding: "6px 14px", fontSize: 13, color: "var(--text-secondary)" }}>{tag}</span>
                  ))}
                </div>
              </div>
            )}

            {datasetInfo && messages.length === 0 && (
              <div style={{ textAlign: "center", padding: "40px 20px" }}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>🎯</div>
                <h2 style={{ fontSize: 18, fontWeight: 600, color: "var(--text-primary)", marginBottom: 8 }}>Ask anything about <span style={{ color: "var(--accent)" }}>{datasetInfo.filename}</span></h2>
                <p style={{ fontSize: 13, color: "var(--text-secondary)" }}>Type or speak a question · pick a suggestion · or click 🎤 to use voice</p>
              </div>
            )}

            {messages.map((msg, i) => (
              <div key={i}>
                {msg.role === "user" && (
                  <div style={{ display: "flex", justifyContent: "flex-end" }}>
                    <div style={{ background: "var(--accent)", color: "#fff", borderRadius: "var(--radius-lg) var(--radius-lg) 4px var(--radius-lg)", padding: "10px 16px", maxWidth: 600, fontSize: 14, lineHeight: 1.5 }}>{msg.text}</div>
                  </div>
                )}
                {msg.role === "assistant" && (
                  <div style={{ background: "var(--bg-primary)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: "20px 22px", boxShadow: "var(--shadow-sm)" }}>
                    {msg.text && <p style={{ fontSize: 14, color: "var(--text-primary)", lineHeight: 1.6 }}>{msg.text}</p>}
                    {msg.dashboard && <DashboardPanel data={msg.dashboard} />}
                  </div>
                )}
              </div>
            ))}

            {loading && (
              <div style={{ display: "flex", alignItems: "center", gap: 12, background: "var(--bg-primary)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: "14px 18px", width: "fit-content", boxShadow: "var(--shadow-sm)" }}>
                <div style={{ display: "flex", gap: 4 }}>{[0,1,2].map(j => <div key={j} style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--accent)", animation: `bounce 1.1s ease-in-out ${j * 0.2}s infinite` }} />)}</div>
                <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>{phase}</span>
              </div>
            )}

            {listening && (
              <div style={{ display: "flex", alignItems: "center", gap: 10, background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.3)", borderRadius: "var(--radius-lg)", padding: "12px 18px", width: "fit-content" }}>
                <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#22c55e", animation: "bounce 1s ease-in-out infinite" }} />
                <span style={{ fontSize: 13, color: "#22c55e", fontWeight: 500 }}>Listening… speak your question</span>
              </div>
            )}

            <div ref={bottomRef} />
          </div>

          {/* Input bar */}
          <div style={{ background: "var(--bg-primary)", borderTop: "1px solid var(--border)", padding: "14px 20px" }}>
            {!datasetInfo && <div style={{ textAlign: "center", padding: "10px", fontSize: 13, color: "var(--text-tertiary)", background: "var(--bg-secondary)", borderRadius: "var(--radius-md)" }}>⬅ Upload a CSV file first to start asking questions</div>}
            {datasetInfo && (
              <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
                <textarea ref={textareaRef} value={query} onChange={e => setQuery(e.target.value)} onKeyDown={handleKey}
                  placeholder={listening ? "🎤 Listening..." : `Ask about ${datasetInfo.filename}…`}
                  rows={1} disabled={loading}
                  style={{ flex: 1, resize: "none", border: "1px solid var(--border-hover)", borderRadius: "var(--radius-md)", padding: "10px 14px", fontSize: 14, lineHeight: 1.5, fontFamily: "inherit", color: "var(--text-primary)", background: "var(--bg-secondary)", outline: "none", minHeight: 42, maxHeight: 140, overflowY: "auto" }}
                  onInput={e => { e.target.style.height = "auto"; e.target.style.height = Math.min(e.target.scrollHeight, 140) + "px"; }}
                  onFocus={e => e.target.style.borderColor = "var(--accent)"}
                  onBlur={e => e.target.style.borderColor = "var(--border-hover)"} />
                <button onClick={handleVoice} disabled={loading || !datasetInfo} title="Click to speak"
                  style={{ background: listening ? "#22c55e" : "var(--bg-secondary)", border: listening ? "1px solid #22c55e" : "1px solid var(--border-hover)", borderRadius: "var(--radius-md)", padding: "10px 14px", fontSize: 18, cursor: loading || !datasetInfo ? "not-allowed" : "pointer", height: 42, transition: "all 0.2s" }}>
                  {listening ? "🔴" : "🎤"}
                </button>
                <button onClick={handleSubmit} disabled={loading || !query.trim()}
                  style={{ background: loading || !query.trim() ? "var(--bg-secondary)" : "var(--accent)", color: loading || !query.trim() ? "var(--text-tertiary)" : "#fff", border: "none", borderRadius: "var(--radius-md)", padding: "10px 22px", fontSize: 14, fontWeight: 600, cursor: loading || !query.trim() ? "not-allowed" : "pointer", height: 42, whiteSpace: "nowrap", transition: "all 0.2s" }}>
                  Generate ↗
                </button>
              </div>
            )}
            <div style={{ marginTop: 6, fontSize: 11, color: "var(--text-tertiary)" }}>Enter to submit · Shift+Enter for new line · 🎤 voice · 🕐 history</div>
          </div>
        </main>
      </div>

      <style>{`
        @keyframes bounce {
          0%, 80%, 100% { transform: scale(0.55); opacity: 0.35; }
          40% { transform: scale(1); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
