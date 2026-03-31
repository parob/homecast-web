import React, { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  componentStack: string | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null, componentStack: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, componentStack: null };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
    this.setState({ componentStack: info.componentStack || null });
  }

  private copyText(text: string) {
    // navigator.clipboard isn't available in WKWebView — use execCommand fallback
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
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
              onClick={() => this.copyText(detail)}
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
              Copy Error
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
