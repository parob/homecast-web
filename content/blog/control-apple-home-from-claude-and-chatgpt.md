---
title: Connecting Apple Home to Claude or ChatGPT
description: Connect Claude or ChatGPT to read your home, control accessories and create scenes.
date: 2026-10-05
category: guide
author: Rob Parker
tags: [ai, mcp, claude, chatgpt]
---

Connect Claude or ChatGPT to Homecast and try “Which lights are still on downstairs?” With control permission, you can ask it to change a light or create a scene too.

## Connect your assistant

Add a custom **MCP** connector with OAuth sign-in and this server URL:

```
https://api.homecast.cloud/mcp
```

Follow the current setup guide for [Claude](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp) or [ChatGPT](https://developers.openai.com/api/docs/guides/developer-mode); availability depends on your plan and workspace.

At sign-in, choose your homes and permissions. **View only** reads their state; **Full control** also allows changes to accessories, scenes and automations.

<details>
<summary>Permission screen and Claude Code setup</summary>

![Homecast’s consent screen with home selection and access levels](/blog/control-apple-home-from-claude-and-chatgpt/consent.webp "Choose the homes and permissions for this connection.")

In Claude Code, add the server from a terminal:

```bash
claude mcp add --transport http homecast https://api.homecast.cloud/mcp
```

Then run `/mcp` inside Claude Code to sign in.

</details>

## Create a scene

With full control, try “Create Film Night with the living room lamps at 15%, the ceiling light off and the hallway at 10%.”

Check the new scene's actions, especially if your lights have similar names. It's saved in Apple Home for later.

You can also ask about readings collected since you enabled [Analytics](/blog/apple-home-history-and-analytics/).

Change or revoke access under **Settings → Sharing → Authorized Apps**.

<details>
<summary>Connecting to Community Edition locally</summary>

Use your relay's MCP address, usually `http://your-mac.local:5656/mcp`. The assistant must be able to reach it; cloud-hosted assistants can't access your local network directly.

The [MCP reference](https://docs.homecast.cloud/reference/mcp) covers tools and authentication.

</details>
