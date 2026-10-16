# Modisign MCP

Make animated overlays and edit short videos from Claude, ChatGPT, Cursor or any MCP assistant. Everything renders on your computer.

[Website](https://modisign.app/mcp) · [Overlays](https://modisign.app/overlays)

## What you can ask

- “Make a red subscribe button for 9:16 and save it as a green-screen MP4.”
- “Put a lower third with my name on ~/Movies/intro.mp4 at 0:03.”
- “Cut these three clips into one Reel, remove the pauses and add captions.”
- “Put reference.mp4 on top, muted, me.mp4 on the bottom, crop 5% off the sides, start them together, Clean captions from my voice.”
- “Show me hook title overlays for a cooking channel.”
- “Render the countdown overlay with a transparent background.”

## Split-screen example

Pass this to `edit_video`, using your absolute local paths:

```json
{
  "clips": [
    {"path":"/absolute/me.mp4","track":"v1","in":0,"out":6,"place":{"mode":"bottom"},"crop":{"top":0,"right":5,"bottom":0,"left":5}},
    {"path":"/absolute/reference.mp4","track":"v2","start":0,"in":0,"out":6,"place":{"mode":"top"},"crop":{"top":0,"right":5,"bottom":0,"left":5},"mute":true}
  ],
  "aspect": "9x16",
  "captions": {"style":"clean","position":"lower","size":"m"}
}
```

Every clip needs `track`. V1 plays in list order; V2 needs `start` in timeline seconds and cannot overlap another V2 clip. Crop removes source-edge percentages; omitted crop/place means zero crop/full picture. Captions and pause detection use V1 only. Pause removal cuts both tracks together; remove any named conflicting V1 transition before retrying. Align starts manually; this does not correct recording drift. Both 1080p and 720p are free under the overlay/caption rules below, up to 180 seconds across both tracks.

## Install

### Claude Desktop

Add to `claude_desktop_config.json` (macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`; Windows: `%APPDATA%\Claude\claude_desktop_config.json`), then restart:

```json
{
  "mcpServers": {
    "modisign": { "command": "npx", "args": ["-y", "@modisign/mcp"] }
  }
}
```

### Claude Code

Run this in your terminal; see [Claude Code MCP setup](https://code.claude.com/docs/en/mcp).

```sh
claude mcp add --transport stdio modisign -- npx -y @modisign/mcp
```

### Codex CLI and ChatGPT/Codex desktop

In the desktop app: **Settings → MCP servers → Add server → STDIO**, command `npx`, arguments `-y @modisign/mcp`, then save and restart; or run this in Codex CLI ([setup](https://learn.chatgpt.com/docs/extend/mcp)).

```sh
codex mcp add modisign -- npx -y @modisign/mcp
```

### Cursor

Put the Claude Desktop JSON above in `~/.cursor/mcp.json` (global) or `.cursor/mcp.json` (project), then enable Modisign in MCP settings. [Cursor MCP setup](https://cursor.com/docs/context/mcp).

### VS Code / Copilot

Create `.vscode/mcp.json`, then start the server and trust it when prompted ([setup](https://code.visualstudio.com/docs/agent-customization/mcp-servers)).

```json
{
  "servers": {
    "modisign": { "type": "stdio", "command": "npx", "args": ["-y", "@modisign/mcp"] }
  }
}
```

## Requirements

Node.js 22 or newer. FFmpeg on your PATH; your assistant can run this for you:

- macOS: `brew install ffmpeg`
- Windows: `winget install Gyan.FFmpeg`
- Linux: `sudo apt install ffmpeg`

The first render downloads a private render browser once (about 100 MB).
Linux ARM64: install Chromium instead (`sudo apt install chromium`).
Run `npx -y @modisign/mcp doctor` to check your setup.

## Free and Pro

One free preset per overlay type renders without an account; format and background changes stay free.  
Customised overlays, Pro presets and expressive caption styles need Pro.  
Video edits with no overlays or only free presets and Clean, Boxed or Minimal captions are free.  
Pro is $9/month: [Pricing](https://modisign.app/pricing). Sign in with `npx -y @modisign/mcp login`.

## Privacy

- Your videos, photos and audio never leave your computer.
- Only overlay settings, overlay text and the chosen caption style reach Modisign.
- Captions are made on your computer with an English speech model downloaded once from Hugging Face (about 43 MB).
- Anonymous usage counts have no account link; turn them off with `MODISIGN_NO_TELEMETRY=1`.

Full details: https://modisign.app/privacy and [TECHNICAL.md](https://github.com/slvDev/modisign-mcp/blob/main/TECHNICAL.md).

## Commands

Run commands with `npx -y @modisign/mcp <command>`.

| Command | What it does |
| --- | --- |
| `login` | Sign in to Modisign in your browser. |
| `logout` | Sign out on this computer. |
| `status` | Check your sign-in and Pro access. |
| `doctor` | Check your setup. |
| `render <family>/<preset>` | Save an overlay as MP4, MOV or WebM. |

## License

MIT © 2026 Viacheslav Sierbov. Third-party notices: [NOTICE](NOTICE). Overlay designs fetched from modisign.app are not covered by this licence; see https://modisign.app/terms.
