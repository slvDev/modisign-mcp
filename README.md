# Modisign MCP

Make animated overlays and edit short videos from Claude, ChatGPT, Cursor or any MCP assistant. Everything renders on your computer.

[Website](https://modisign.app/mcp) · [Overlays](https://modisign.app/overlays)

## What you can ask

- “Make a red subscribe button for 9:16 and save it as a green-screen MP4.”
- “Put a lower third with my name on ~/Movies/intro.mp4 at 0:03.”
- “Cut these three clips into one Reel, remove the pauses and add captions.”
- “Put reference.mp4 on top, muted, me.mp4 on the bottom, crop 5% off the sides, start them together, Clean captions from my voice.”
- “Make a five-frame rapid intro from grind.mp4, pour.mp4, stir.mp4, steam.mp4 and serve.mp4, then replay them with source timestamps and the labels “Grind beans”, “Pour water”, “Stir”, “Steam milk” and “Serve”, in 9:16.”
- “On the first clip, smoothly zoom from 100% at source 0s to 120% at 2s, then slide 15% left by 3s; fade ‘Watch this’ in over its first half-second, in 9:16.”
- “Add a quiet interface click at 1.2 seconds and a bubble pop when the title “My three tips” appears; keep the clip's speech volume unchanged.”
- “Add subtle whooshes at my crossfades and clicks at declared overlay taps, using different variants; tell me which overlays have no tap cue.”
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

## Rapid intro and titles example

A rapid intro opens with 5–7 teaser cuts of three to six frames each (default five), then replays the unchanged clips with a label and a timestamp over each. Give the descriptions yourself or tell your assistant what each clip shows: Modisign does not look at pictures. Plain titles are free and stay on your computer. The prompt above is one `edit_video` call:

```json
{
  "clips": [
    {"path":"/absolute/grind.mp4","track":"v1","in":5,"out":9},
    {"path":"/absolute/pour.mp4","track":"v1","in":65,"out":69},
    {"path":"/absolute/stir.mp4","track":"v1","in":12,"out":16},
    {"path":"/absolute/steam.mp4","track":"v1","in":0,"out":4},
    {"path":"/absolute/serve.mp4","track":"v1","in":125,"out":129}
  ],
  "rapid_intro": {
    "clips": [0, 1, 2, 3, 4],
    "frames_per_clip": 5,
    "timestamp": "source",
    "labels": [
      {"clip":0,"text":"Grind beans"}, {"clip":1,"text":"Pour water"}, {"clip":2,"text":"Stir"},
      {"clip":3,"text":"Steam milk"}, {"clip":4,"text":"Serve"}
    ]
  },
  "texts": [{"text":"Coffee in five steps","start":0,"duration":2,"y":0.2}],
  "aspect": "9x16"
}
```

`timestamp: "source"` stamps each label with the clip's starting time in its source file (`timeline` uses the output time; `none` shows only the text). Teasers are muted unless `mute_teasers` is false. Every time you give for V2 clips, overlays or titles moves later by the intro's length, so give it as for the edit without the intro. The video must keep every clip at least as long as its teaser (3 frames, 0.1 seconds, is the shortest any clip can be).

A title can also take an optional `reveal`, a rectangular wipe over stationary text: `"reveal":{"direction":"right","duration":0.5}` shows “Coffee in five steps” growing from its left edge over half a second. Every field is optional and the tool schema lists them. It is drawn on your computer, and a title with a reveal needs Pro to export.

To put a title behind a person, add `occlusion`: “Put the title ‘Sunday reset’ behind me in this clip from 1 to 4 seconds, near the top, with a soft edge” is `"texts":[{"text":"Sunday reset","start":1,"duration":3,"y":0.25,"occlusion":{"clip":0,"feather":2}}]`. `clip` is the index in `clips` of the clip whose people stand in front; the tool schema has the other fields and rules. People are found on your computer with a small people model that ships inside the package, and nothing about them leaves your computer. A title behind people needs Pro to export.

## Motion example

Clips, titles and overlays take optional `motion`: keyframes for `x`, `y`, `scale`, `rotation` and `opacity` that move, scale, rotate or fade the whole layer. The motion prompt above is one `edit_video` call:

```json
{
  "clips": [{
    "path": "/absolute/clip.mp4", "track": "v1", "in": 0, "out": 4,
    "motion": {
      "scale": [{"at":0,"value":1,"easing":"ease-in-out"}, {"at":2,"value":1.2,"easing":"linear"}],
      "x": [{"at":0,"value":0,"easing":"hold"}, {"at":2,"value":0,"easing":"ease-in-out"}, {"at":3,"value":-0.15,"easing":"linear"}]
    }
  }],
  "texts": [{
    "text": "Watch this", "start": 0, "duration": 4,
    "motion": {"opacity": [{"at":0,"value":0,"easing":"ease-out"}, {"at":0.5,"value":1,"easing":"linear"}]}
  }],
  "aspect": "9x16"
}
```

Each key is `{at, value, easing}`; `at` is source seconds for footage (photos use the photo's own clock, from its `in`) and local seconds from its own start for titles and overlays. `x` and `y` are fractions of the output width and height (positive right and down), `scale` is a multiplier, `rotation` is clockwise degrees and `opacity` runs 0–1. `easing` shapes the segment after its key: `hold`, `linear`, `ease-in`, `ease-out`, `ease-in-out` or a custom `[x1, y1, x2, y2]` curve with each number from 0 to 1. Before the first key and after the last, the value holds. `zoom` stays static framing inside the picture; `motion.scale` moves the whole placed picture. Up to 60 keys per channel and 1000 per request. Footage and title motion are free; any non-neutral motion key on a catalog overlay, even on a free preset, needs Pro.

## Sound effects example

`edit_video` can add short effects from a free built-in pack of ten sounds (click, typing, whoosh, pop and sparkle, two of each). They play alongside your clips, never change speech volume or the video's length, and cannot be replaced by your own files or links. The first prompt above is one `sfx` list:

```json
{
  "clips": [{ "path": "/Users/me/take.mp4", "track": "v1", "out": 8 }],
  "texts": [{ "text": "My three tips", "start": 0.8, "duration": 2 }],
  "sfx": [
    { "asset": "ugc-click-01", "start": 1.2, "gain": 0.25 },
    { "asset": "ugc-pop-01", "anchor": { "kind": "title-enter", "text": 0 } }
  ],
  "aspect": "9x16"
}
```

A sound starts at a time (seconds of the edit as you describe it before pause removal or a rapid intro, which move it along) or follows a title appearing, a transition or an overlay tap. The second prompt is `"auto_sfx": {"events": ["transition", "cta-tap"], "intensity": "subtle"}`: Modisign places one sound per event on the finished edit and the job result lists what it added and skipped, such as overlays without a declared tap. Sounds are free.

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
Customised overlays (including overlay motion), Pro presets and expressive caption styles need Pro.  
Video edits with no overlays or only unchanged free presets and Clean, Boxed or Minimal captions are free, including footage and title motion, plain titles, the rapid intro and sound effects. A title with a reveal or behind people needs Pro.
Pro is $9/month: [Pricing](https://modisign.app/pricing). Sign in with `npx -y @modisign/mcp login`.

## Privacy

- Your videos, photos and audio never leave your computer.
- Only overlay settings, overlay text, the chosen caption style and two yes/no facts (whether an overlay's motion was customised, whether a title uses a reveal or Behind people) reach Modisign.
- Titles, rapid-intro labels, sound choices and motion keys never reach Modisign; your assistant sees them in the request.
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
