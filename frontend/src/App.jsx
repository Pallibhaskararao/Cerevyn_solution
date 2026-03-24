import { useEffect, useRef, useState } from "react";

const API_BASE = import.meta.env.VITE_API_BASE || "http://127.0.0.1:8000";

const starterMessages = [
  {
    id: "welcome",
    role: "bot",
    text: "Knowledge base is ready. Upload your documents and ask me anything — I'll retrieve the most relevant context and answer precisely from it.",
    meta: null,
  },
];

export default function App() {
  const [messages, setMessages] = useState(starterMessages);
  const [input, setInput] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [status, setStatus] = useState("ready");
  const [isLoading, setIsLoading] = useState(false);
  const [files, setFiles] = useState([]);
  const [uploadState, setUploadState] = useState("idle");
  const [uploadMsg, setUploadMsg] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const listEndRef = useRef(null);
  const textareaRef = useRef(null);

  useEffect(() => {
    listEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  function autoResize(el) {
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
  }

  async function sendMessage(event) {
    event?.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || isLoading) return;

    setMessages((c) => [...c, { id: `${Date.now()}-user`, role: "user", text: trimmed, meta: null }]);
    setInput("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    setStatus("searching");
    setIsLoading(true);

    try {
      const response = await fetch(`${API_BASE}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: trimmed, session_id: sessionId || null }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.detail || "Backend request failed");
      }

      const data = await response.json();
      setSessionId(data.session_id);
      setMessages((c) => [
        ...c,
        {
          id: `${Date.now()}-bot`,
          role: "bot",
          text: data.answer,
          meta: {
            route: data.route,
            usedContext: data.used_context,
            sources: data.sources,
            chunks: data.retrieved_chunks,
          },
        },
      ]);
      setStatus(data.used_context ? "context" : "ready");
    } catch (error) {
      setMessages((c) => [
        ...c,
        { id: `${Date.now()}-error`, role: "bot", text: `Error: ${error.message}`, meta: null },
      ]);
      setStatus("error");
    } finally {
      setIsLoading(false);
    }
  }

  async function uploadDocuments(event) {
    event.preventDefault();
    if (!files.length) {
      setUploadMsg("Select at least one file.");
      return;
    }

    const formData = new FormData();
    files.forEach((f) => formData.append("files", f));
    setUploadState("uploading");
    setUploadMsg("Indexing...");

    try {
      const response = await fetch(`${API_BASE}/upload-documents`, { method: "POST", body: formData });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.detail || "Upload failed");
      }
      const data = await response.json();
      setUploadState("done");
      setUploadMsg(`${data.uploaded_files.length} file(s) · ${data.chunks_indexed} chunks indexed`);
      setFiles([]);
    } catch (error) {
      setUploadState("error");
      setUploadMsg(error.message);
    }
  }

  const handleKey = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const statusLabel = {
    ready: "Ready",
    searching: "Searching…",
    context: "Context retrieved",
    error: "Error",
  }[status] || "Ready";

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@300;400;500&family=DM+Sans:ital,wght@0,300;0,400;0,500;1,300&display=swap');

        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        :root {
          --bg: #0a0a0f;
          --bg2: #111118;
          --bg3: #18181f;
          --bg4: #1e1e28;
          --border: rgba(255,255,255,0.07);
          --border2: rgba(255,255,255,0.12);
          --accent: #c8ff00;
          --accent2: #7c3aed;
          --accent3: #00d4ff;
          --text: #f0f0f5;
          --text2: #9999aa;
          --text3: #55556a;
          --user-bubble: #1a1a2e;
          --bot-bubble: #111118;
          --font-display: 'Syne', sans-serif;
          --font-mono: 'IBM Plex Mono', monospace;
          --font-body: 'DM Sans', sans-serif;
          --sidebar: 280px;
          --radius: 4px;
          --radius-lg: 12px;
        }

        html, body, #root { height: 100%; }
        body { background: var(--bg); color: var(--text); font-family: var(--font-body); font-size: 15px; line-height: 1.6; }

        /* ── Layout ── */
        .shell { display: flex; height: 100vh; overflow: hidden; }

        /* ── Sidebar ── */
        .sidebar {
          width: var(--sidebar);
          min-width: var(--sidebar);
          background: var(--bg2);
          border-right: 1px solid var(--border);
          display: flex;
          flex-direction: column;
          transition: width 0.3s ease, min-width 0.3s ease, opacity 0.3s ease;
          overflow: hidden;
        }
        .sidebar.closed { width: 0; min-width: 0; opacity: 0; pointer-events: none; }

        .sidebar-header {
          padding: 28px 24px 20px;
          border-bottom: 1px solid var(--border);
        }
        .logo-mark {
          font-family: var(--font-display);
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.18em;
          text-transform: uppercase;
          color: var(--accent);
          margin-bottom: 6px;
        }
        .sidebar-title {
          font-family: var(--font-display);
          font-size: 18px;
          font-weight: 700;
          color: var(--text);
          line-height: 1.2;
        }

        .sidebar-section {
          padding: 20px 24px;
          border-bottom: 1px solid var(--border);
          flex-shrink: 0;
        }
        .section-label {
          font-family: var(--font-mono);
          font-size: 10px;
          font-weight: 500;
          letter-spacing: 0.15em;
          text-transform: uppercase;
          color: var(--text3);
          margin-bottom: 14px;
        }

        /* Upload area */
        .drop-zone {
          border: 1px dashed var(--border2);
          border-radius: var(--radius-lg);
          padding: 20px 16px;
          text-align: center;
          cursor: pointer;
          transition: border-color 0.2s, background 0.2s;
          position: relative;
          overflow: hidden;
        }
        .drop-zone:hover { border-color: var(--accent); background: rgba(200,255,0,0.03); }
        .drop-zone input[type="file"] {
          position: absolute; inset: 0; opacity: 0; cursor: pointer; width: 100%; height: 100%;
        }
        .drop-icon { font-size: 22px; margin-bottom: 8px; }
        .drop-label { font-size: 12px; color: var(--text2); font-family: var(--font-mono); }
        .drop-types { font-size: 10px; color: var(--text3); margin-top: 3px; font-family: var(--font-mono); }

        .file-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
        .file-chip {
          background: var(--bg4); border: 1px solid var(--border2);
          border-radius: 100px; padding: 3px 10px;
          font-size: 11px; color: var(--text2); font-family: var(--font-mono);
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 200px;
        }

        .upload-btn {
          width: 100%;
          margin-top: 12px;
          background: var(--accent);
          color: #0a0a0f;
          border: none;
          border-radius: var(--radius);
          padding: 9px 16px;
          font-family: var(--font-display);
          font-size: 12px;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          cursor: pointer;
          transition: opacity 0.2s, transform 0.15s;
        }
        .upload-btn:hover { opacity: 0.88; transform: translateY(-1px); }
        .upload-btn:active { transform: translateY(0); }

        .upload-status {
          margin-top: 10px;
          font-size: 11px;
          font-family: var(--font-mono);
          color: var(--text3);
          min-height: 16px;
        }
        .upload-status.done { color: var(--accent); }
        .upload-status.error { color: #ff5555; }
        .upload-status.uploading { color: var(--accent3); }

        /* Status indicator */
        .status-block {
          margin-top: auto;
          padding: 16px 24px;
          border-top: 1px solid var(--border);
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .status-dot {
          width: 7px; height: 7px; border-radius: 50%;
          flex-shrink: 0;
          background: var(--text3);
          transition: background 0.4s;
          box-shadow: 0 0 0 0px var(--text3);
        }
        .status-dot.ready { background: var(--accent); box-shadow: 0 0 8px var(--accent); }
        .status-dot.searching { background: var(--accent3); animation: pulse-dot 1s infinite; }
        .status-dot.context { background: var(--accent2); box-shadow: 0 0 8px var(--accent2); }
        .status-dot.error { background: #ff5555; }
        @keyframes pulse-dot {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
        .status-text { font-family: var(--font-mono); font-size: 11px; color: var(--text2); }

        /* ── Main ── */
        .main { flex: 1; display: flex; flex-direction: column; overflow: hidden; background: var(--bg); }

        .topbar {
          padding: 16px 28px;
          border-bottom: 1px solid var(--border);
          display: flex;
          align-items: center;
          gap: 14px;
          background: var(--bg);
          flex-shrink: 0;
        }
        .toggle-btn {
          width: 32px; height: 32px;
          background: var(--bg3); border: 1px solid var(--border2);
          border-radius: var(--radius);
          cursor: pointer; color: var(--text2);
          display: flex; align-items: center; justify-content: center;
          font-size: 14px; transition: background 0.2s, color 0.2s;
          flex-shrink: 0;
        }
        .toggle-btn:hover { background: var(--bg4); color: var(--text); }

        .topbar-info { flex: 1; }
        .topbar-eyebrow {
          font-family: var(--font-mono);
          font-size: 10px; letter-spacing: 0.15em;
          text-transform: uppercase; color: var(--text3);
        }
        .topbar-title {
          font-family: var(--font-display);
          font-size: 16px; font-weight: 700; color: var(--text);
          line-height: 1.2;
        }

        .session-badge {
          font-family: var(--font-mono); font-size: 10px;
          color: var(--text3); background: var(--bg3);
          border: 1px solid var(--border); border-radius: 100px;
          padding: 3px 10px;
        }

        /* ── Messages ── */
        .messages-area { flex: 1; overflow-y: auto; padding: 32px 0; }
        .messages-area::-webkit-scrollbar { width: 4px; }
        .messages-area::-webkit-scrollbar-track { background: transparent; }
        .messages-area::-webkit-scrollbar-thumb { background: var(--border2); border-radius: 2px; }

        .messages-inner { max-width: 780px; margin: 0 auto; padding: 0 28px; }

        .msg-row {
          display: flex; gap: 14px;
          margin-bottom: 28px;
          animation: msg-in 0.3s ease forwards;
          opacity: 0; transform: translateY(10px);
        }
        @keyframes msg-in {
          to { opacity: 1; transform: translateY(0); }
        }

        .avatar {
          width: 32px; height: 32px; border-radius: var(--radius);
          display: flex; align-items: center; justify-content: center;
          font-family: var(--font-mono); font-size: 10px; font-weight: 500;
          flex-shrink: 0; margin-top: 2px; letter-spacing: 0.05em;
        }
        .avatar.user { background: var(--accent); color: #0a0a0f; }
        .avatar.bot { background: var(--bg4); color: var(--text2); border: 1px solid var(--border2); }

        .bubble-wrap { flex: 1; min-width: 0; }
        .bubble-role {
          font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.1em;
          text-transform: uppercase; color: var(--text3); margin-bottom: 7px;
        }
        .msg-row.user .bubble-role { color: rgba(200,255,0,0.5); }

        .bubble {
          background: var(--bot-bubble);
          border: 1px solid var(--border);
          border-radius: var(--radius-lg);
          padding: 16px 20px;
          font-size: 14.5px;
          line-height: 1.7;
          color: var(--text);
        }
        .msg-row.user .bubble {
          background: var(--user-bubble);
          border-color: rgba(200,255,0,0.15);
        }

        /* Evidence */
        .evidence {
          margin-top: 14px;
          border-top: 1px solid var(--border);
          padding-top: 12px;
        }
        .evidence-header {
          display: flex; align-items: center; gap: 8px;
          margin-bottom: 10px;
        }
        .evidence-label {
          font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.1em;
          text-transform: uppercase; color: var(--text3);
        }
        .route-tag {
          font-family: var(--font-mono); font-size: 10px;
          background: rgba(124,58,237,0.15); color: var(--accent2);
          border: 1px solid rgba(124,58,237,0.25); border-radius: 100px;
          padding: 2px 8px;
        }

        .source-row { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
        .source-chip {
          font-family: var(--font-mono); font-size: 10px;
          background: rgba(0,212,255,0.08); color: var(--accent3);
          border: 1px solid rgba(0,212,255,0.18); border-radius: 100px;
          padding: 3px 10px;
        }

        .chunk-cards { display: flex; flex-direction: column; gap: 8px; }
        .chunk-card {
          background: var(--bg3); border: 1px solid var(--border);
          border-left: 2px solid var(--accent2);
          border-radius: var(--radius);
          padding: 10px 14px;
        }
        .chunk-source {
          font-family: var(--font-mono); font-size: 10px; color: var(--text3);
          margin-bottom: 5px; text-transform: uppercase; letter-spacing: 0.1em;
        }
        .chunk-text { font-size: 12px; color: var(--text2); line-height: 1.5; }

        /* Typing */
        .typing-dots { display: flex; gap: 5px; align-items: center; padding: 4px 0; }
        .typing-dots span {
          width: 5px; height: 5px; border-radius: 50%;
          background: var(--text3); animation: bounce 1.2s infinite;
        }
        .typing-dots span:nth-child(2) { animation-delay: 0.2s; }
        .typing-dots span:nth-child(3) { animation-delay: 0.4s; }
        @keyframes bounce {
          0%, 80%, 100% { transform: translateY(0); opacity: 0.4; }
          40% { transform: translateY(-5px); opacity: 1; }
        }

        /* ── Composer ── */
        .composer-area {
          padding: 16px 28px 24px;
          border-top: 1px solid var(--border);
          background: var(--bg);
          flex-shrink: 0;
        }
        .composer-inner {
          max-width: 780px; margin: 0 auto;
          display: flex; align-items: flex-end; gap: 10px;
          background: var(--bg2);
          border: 1px solid var(--border2);
          border-radius: var(--radius-lg);
          padding: 12px 14px;
          transition: border-color 0.2s;
        }
        .composer-inner:focus-within { border-color: rgba(200,255,0,0.3); }
        .composer-inner textarea {
          flex: 1; background: transparent; border: none; outline: none;
          color: var(--text); font-family: var(--font-body); font-size: 14.5px;
          line-height: 1.6; resize: none; min-height: 24px;
          caret-color: var(--accent);
        }
        .composer-inner textarea::placeholder { color: var(--text3); }
        .composer-inner textarea:disabled { opacity: 0.5; }

        .send-btn {
          width: 36px; height: 36px; border-radius: var(--radius);
          background: var(--accent); border: none; cursor: pointer;
          display: flex; align-items: center; justify-content: center;
          flex-shrink: 0; transition: opacity 0.2s, transform 0.15s;
          color: #0a0a0f;
        }
        .send-btn:disabled { opacity: 0.35; cursor: not-allowed; transform: none !important; }
        .send-btn:hover:not(:disabled) { opacity: 0.85; transform: translateY(-1px); }
        .send-btn svg { display: block; }

        .hint-row {
          max-width: 780px; margin: 8px auto 0;
          font-family: var(--font-mono); font-size: 10px; color: var(--text3);
          padding: 0 4px;
          display: flex; justify-content: space-between;
        }

        /* Divider between welcome msg and rest */
        .welcome-divider {
          display: flex; align-items: center; gap: 12px;
          margin-bottom: 32px; color: var(--text3);
          font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.1em; text-transform: uppercase;
        }
        .welcome-divider::before, .welcome-divider::after {
          content: ''; flex: 1; height: 1px; background: var(--border);
        }

        @media (max-width: 640px) {
          .sidebar { position: fixed; z-index: 100; height: 100%; }
          .sidebar.closed { width: 0; min-width: 0; }
          .topbar { padding: 12px 16px; }
          .messages-inner, .composer-area { padding-left: 16px; padding-right: 16px; }
        }
      `}</style>

      <div className="shell">
        {/* ── Sidebar ── */}
        <aside className={`sidebar ${sidebarOpen ? "" : "closed"}`}>
          <div className="sidebar-header">
            <div className="logo-mark">RAG · PS-6</div>
            <div className="sidebar-title">Knowledge<br />Retrieval</div>
          </div>

          <div className="sidebar-section">
            <div className="section-label">Document Upload</div>

            <form onSubmit={uploadDocuments}>
              <label className="drop-zone">
                <input
                  type="file"
                  accept=".txt,.md,.pdf"
                  multiple
                  onChange={(e) => setFiles(Array.from(e.target.files || []))}
                />
                <div className="drop-icon">⬆</div>
                <div className="drop-label">
                  {files.length ? `${files.length} file(s) selected` : "Drop or click to choose"}
                </div>
                <div className="drop-types">.txt · .md · .pdf</div>
              </label>

              {files.length > 0 && (
                <div className="file-chips">
                  {files.map((f, i) => (
                    <span className="file-chip" key={i}>{f.name}</span>
                  ))}
                </div>
              )}

              <button className="upload-btn" type="submit">
                Upload & Index
              </button>

              <div className={`upload-status ${uploadState}`}>
                {uploadMsg || "No files uploaded yet"}
              </div>
            </form>
          </div>

          <div className="status-block">
            <div className={`status-dot ${status}`} />
            <span className="status-text">{statusLabel}</span>
          </div>
        </aside>

        {/* ── Main ── */}
        <main className="main">
          {/* Topbar */}
          <div className="topbar">
            <button className="toggle-btn" onClick={() => setSidebarOpen((v) => !v)} title="Toggle sidebar">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <rect x="0" y="2" width="14" height="1.5" fill="currentColor" rx="1"/>
                <rect x="0" y="6.25" width="14" height="1.5" fill="currentColor" rx="1"/>
                <rect x="0" y="10.5" width="14" height="1.5" fill="currentColor" rx="1"/>
              </svg>
            </button>
            <div className="topbar-info">
              <div className="topbar-eyebrow">Problem Statement 6</div>
              <div className="topbar-title">Dynamic Knowledge Retrieval Chatbot</div>
            </div>
            {sessionId && <div className="session-badge">session · {sessionId.slice(0, 8)}</div>}
          </div>

          {/* Messages */}
          <div className="messages-area">
            <div className="messages-inner">
              {messages.map((msg, idx) => (
                <div key={msg.id}>
                  {idx === 1 && messages.length > 1 && (
                    <div className="welcome-divider">conversation start</div>
                  )}
                  <article className={`msg-row ${msg.role}`}>
                    <div className={`avatar ${msg.role}`}>{msg.role === "user" ? "YOU" : "AI"}</div>
                    <div className="bubble-wrap">
                      <div className="bubble-role">{msg.role === "user" ? "You" : "Assistant"}</div>
                      <div className="bubble">
                        <div>{msg.text}</div>

                        {msg.meta && msg.meta.sources?.length > 0 && (
                          <div className="evidence">
                            <div className="evidence-header">
                              <span className="evidence-label">
                                {msg.meta.usedContext ? "Context retrieved" : "No context"}
                              </span>
                              <span className="route-tag">{msg.meta.route}</span>
                            </div>
                            <div className="source-row">
                              {msg.meta.sources.map((s) => (
                                <span className="source-chip" key={s}>{s}</span>
                              ))}
                            </div>
                            <div className="chunk-cards">
                              {msg.meta.chunks.slice(0, 2).map((chunk, i) => (
                                <div className="chunk-card" key={`${chunk.source}-${i}`}>
                                  <div className="chunk-source">{chunk.source}</div>
                                  <div className="chunk-text">{chunk.preview}</div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </article>
                </div>
              ))}

              {isLoading && (
                <article className="msg-row bot">
                  <div className="avatar bot">AI</div>
                  <div className="bubble-wrap">
                    <div className="bubble-role">Assistant</div>
                    <div className="bubble">
                      <div className="typing-dots">
                        <span /><span /><span />
                      </div>
                    </div>
                  </div>
                </article>
              )}

              <div ref={listEndRef} />
            </div>
          </div>

          {/* Composer */}
          <div className="composer-area">
            <div className="composer-inner">
              <textarea
                ref={textareaRef}
                rows={1}
                value={input}
                disabled={isLoading}
                placeholder="Ask a question about your documents…"
                onChange={(e) => {
                  setInput(e.target.value);
                  autoResize(e.target);
                }}
                onKeyDown={handleKey}
              />
              <button className="send-btn" onClick={sendMessage} disabled={isLoading || !input.trim()}>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M2 8L14 8M14 8L9 3M14 8L9 13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
            </div>
            <div className="hint-row">
              <span>Enter to send · Shift+Enter for newline</span>
              <span>{input.length > 0 ? `${input.length} chars` : ""}</span>
            </div>
          </div>
        </main>
      </div>
    </>
  );
}