# Homecast Web App

The React web app for [Homecast Community Edition](https://github.com/parob/homecast). Runs inside the Mac app's WKWebView and is served to LAN clients for device control.

## Development

```bash
npm install
npm run dev     # Dev server on port 8080
npm run build   # Production build → dist/
```

## Community Server Modules

The `src/server/` directory contains the Community mode server logic:

| Module | Purpose |
|--------|---------|
| `local-server.ts` | WebSocket request handler for external clients |
| `local-graphql.ts` | GraphQL resolver backed by IndexedDB |
| `local-db.ts` | IndexedDB persistence layer |
| `local-auth.ts` | Local authentication (PBKDF2 + JWT) |
| `local-rest.ts` | REST API endpoints |
| `local-mcp.ts` | MCP endpoint for AI assistants |
| `local-broadcast.ts` | Real-time event broadcasting |
| `local-tokens.ts` | API token management |

## Stack

React 18, TypeScript, Vite 5, Tailwind CSS, Radix UI (shadcn/ui), Apollo Client

## License

[MIT](LICENSE)
