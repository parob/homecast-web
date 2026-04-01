import React, { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  componentStack: string | null;
  copied: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null, componentStack: null, copied: false };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error, componentStack: null, copied: false };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
    this.setState({ componentStack: info.componentStack || null });
  }

  private copyText(text: string) {
    // Native bridge (WKWebView) — most reliable in iOS/Mac app
    const win = window as Window & { webkit?: { messageHandlers?: { homecast?: { postMessage: (msg: unknown) => void } } } };
    if (win.webkit?.messageHandlers?.homecast) {
      win.webkit.messageHandlers.homecast.postMessage({ action: "copy", text });
      return;
    }
    // Modern clipboard API
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).catch(() => this.execCommandCopy(text));
      return;
    }
    // Legacy fallback
    this.execCommandCopy(text);
  }

  private execCommandCopy(text: string) {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    try { document.execCommand("copy"); } catch { /* ignore */ }
    document.body.removeChild(ta);
  }

  private getFullDetail(): string {
    const parts: string[] = [];
    const err = this.state.error;
    if (err?.message) parts.push(err.message);
    if (err?.stack) parts.push("\n--- JS Stack ---\n" + err.stack);
    if (this.state.componentStack) parts.push("\n--- Component Stack ---\n" + this.state.componentStack);
    return parts.join("\n") || "Unknown error";
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    const detail = this.getFullDetail();

    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100vh",
          fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif",
          textAlign: "center",
          padding: 24,
        }}
      >
        <div style={{ maxWidth: 480 }}>
          <div style={{ fontSize: 36, marginBottom: 16, opacity: 0.5 }}>:(</div>
          <h1 style={{ fontSize: 18, fontWeight: 600, marginBottom: 12, color: "inherit" }}>
            Something went wrong
          </h1>
          <pre
            style={{
              fontSize: 11,
              opacity: 0.6,
              lineHeight: 1.5,
              marginBottom: 16,
              textAlign: "left",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              maxHeight: "40vh",
              overflow: "auto",
              padding: 12,
              borderRadius: 8,
              background: "rgba(128,128,128,0.08)",
              userSelect: "text",
              WebkitUserSelect: "text",
            }}
          >
            {detail}
          </pre>
          <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
            <button
              onClick={() => {
                this.copyText(detail);
                this.setState({ copied: true });
                setTimeout(() => this.setState({ copied: false }), 2000);
              }}
              style={{
                background: this.state.copied ? "rgba(34,197,94,0.15)" : "rgba(128,128,128,0.1)",
                color: this.state.copied ? "#16a34a" : "inherit",
                border: `1px solid ${this.state.copied ? "rgba(34,197,94,0.3)" : "rgba(128,128,128,0.2)"}`,
                borderRadius: 8,
                padding: "8px 20px",
                fontSize: 14,
                cursor: "pointer",
                transition: "all 0.2s",
              }}
            >
              {this.state.copied ? "Copied!" : "Copy Error"}
            </button>
            <button
              onClick={() => window.location.reload()}
              style={{
                background: "rgba(128,128,128,0.1)",
                color: "inherit",
                border: "1px solid rgba(128,128,128,0.2)",
                borderRadius: 8,
                padding: "8px 20px",
                fontSize: 14,
                cursor: "pointer",
              }}
            >
              Reload
            </button>
          </div>
        </div>
      </div>
    );
  }
}
