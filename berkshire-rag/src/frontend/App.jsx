import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const THREAD_KEY = "berkshire-thread-id";
const SOURCES_MARKER = "\n---SOURCES---\n";

function getOrCreateThreadId() {
  try {
    let id = localStorage.getItem(THREAD_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(THREAD_KEY, id);
    }
    return id;
  } catch {
    return "default-thread";
  }
}

export default function App() {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const threadId = useMemo(() => getOrCreateThreadId(), []);
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const newConversation = useCallback(() => {
    try {
      localStorage.setItem(THREAD_KEY, crypto.randomUUID());
    } catch {
      /* ignore */
    }
    window.location.reload();
  }, []);

  const send = async () => {
    const trimmed = input.trim();
    if (!trimmed || loading) return;

    setError(null);
    setLoading(true);
    setInput("");
    setMessages((prev) => [
      ...prev,
      { role: "user", text: trimmed },
      { role: "ai", text: "", sources: null, streaming: true },
    ]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: trimmed, threadId }),
      });

      if (!res.ok) {
        const errBody = await res.text();
        throw new Error(errBody || `HTTP ${res.status}`);
      }

      let buffer = "";
      const decoder = new TextDecoder();

      if (res.body) {
        const reader = res.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const idx = buffer.indexOf(SOURCES_MARKER);
          const displayText = idx >= 0 ? buffer.slice(0, idx) : buffer;
          setMessages((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            if (last?.role === "ai") last.text = displayText;
            return next;
          });
        }
      } else {
        buffer = await res.text();
        const idx = buffer.indexOf(SOURCES_MARKER);
        const displayText = idx >= 0 ? buffer.slice(0, idx) : buffer;
        setMessages((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last?.role === "ai") last.text = displayText;
          return next;
        });
      }

      const idx = buffer.indexOf(SOURCES_MARKER);
      let sources = null;
      let finalText = buffer;
      if (idx >= 0) {
        finalText = buffer.slice(0, idx);
        try {
          sources = JSON.parse(buffer.slice(idx + SOURCES_MARKER.length));
        } catch {
          sources = null;
        }
      }

      setMessages((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last?.role === "ai") {
          last.text = finalText;
          last.sources = sources;
          delete last.streaming;
        }
        return next;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setMessages((prev) => {
        const next = [...prev];
        if (next[next.length - 1]?.streaming) next.pop();
        return next;
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto p-4 min-h-screen flex flex-col gap-3">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b pb-3">
        <div>
          <h1 className="text-xl font-semibold">Berkshire Hathaway Intelligence</h1>
          <p className="text-sm text-gray-600">
            RAG over shareholder letters · streaming · Mastra agent + memory
          </p>
        </div>
        <button
          type="button"
          className="text-sm px-3 py-1 border rounded hover:bg-gray-50"
          onClick={newConversation}
        >
          New conversation
        </button>
      </header>

      {error ? (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-2">
          {error}
        </div>
      ) : null}

      <div className="flex-1 border rounded p-3 overflow-auto bg-gray-50 min-h-[50vh]">
        {messages.map((m, i) => (
          <div key={i} className="mb-4">
            <div className="text-xs uppercase text-gray-500 mb-1">{m.role}</div>
            <div className="whitespace-pre-wrap text-sm bg-white border rounded p-2">
              {m.text}
              {m.streaming ? (
                <span className="inline-block w-2 h-4 ml-0.5 bg-gray-400 animate-pulse align-middle" />
              ) : null}
            </div>
            {m.sources?.chunks?.length ? (
              <div className="mt-2 text-xs border-t pt-2">
                <div className="font-semibold text-gray-700 mb-1">Retrieved excerpts (metadata)</div>
                <ul className="space-y-1 list-disc pl-4 text-gray-600">
                  {m.sources.chunks.slice(0, 8).map((c) => (
                    <li key={c.id}>
                      <span className="font-medium">{c.sourceFile || "unknown"}</span>
                      {c.year ? ` (${c.year})` : ""} · score {typeof c.score === "number" ? c.score.toFixed(3) : c.score}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="flex gap-2">
        <input
          className="flex-1 border rounded px-3 py-2 text-sm"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), send())}
          placeholder="Ask about Berkshire Hathaway shareholder letters…"
          disabled={loading}
        />
        <button
          type="button"
          onClick={send}
          disabled={loading || !input.trim()}
          className="px-4 py-2 bg-black text-white rounded text-sm disabled:opacity-50"
        >
          {loading ? "…" : "Send"}
        </button>
      </div>
    </div>
  );
}
