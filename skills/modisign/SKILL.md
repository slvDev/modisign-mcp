---
name: modisign
description: Find and render Modisign animated overlays, or create a finished local Studio video with cuts, captions, transitions and overlays through MCP.
---

Use for animated hooks, subscribe/follow buttons, lower thirds and CTAs. Rendering runs locally; Modisign receives overlay settings and chosen text, never footage.

1. Call `account_status`. Prefer unchanged free presets when the user has not asked for customization. Free needs no login; custom text, looks, colors or Pro presets require current Pro. Aspect and output/background changes remain free.
2. Call `list_overlays` with relevant search/filter options, then `get_overlay` for the chosen result. Never invent family/preset IDs, looks or fields; use the returned schema and limits.
3. Call `configure_overlay`, including only requested edits. Check the returned tier before rendering. If Pro is needed, explain why and offer an unchanged free option or https://modisign.app/pricing. Use `login` when the user chooses to sign in; show its approval link/code, then check `account_status`. Never ask for passwords or tokens.
4. Call `render_overlay` for standalone MP4 (green screen by default), transparent ProRes MOV or VP9 WebM. For a composite, ask for the video's local path when missing, resolve it to an absolute path, then call `add_overlay_to_video` with the requested start in seconds. Videos must be at most 60 seconds. Respect the returned start limit and chosen overlay aspect; composites preserve the video's aspect, cap the long side at 1920 and include its audio.
5. For multi-clip edits, optionally call `get_transcript` first when the user wants to review or fix speech; explain that its transcript text is returned to the assistant/provider. Then call `edit_video` with absolute clip paths, requested trims, settings, transitions, pause removal, configured overlays and captions. `after_clip` is zero-based; punch-ins use source seconds. Include caption style, position and size and any agreed `corrections: [{from, to}]`. Studio supports 180 seconds, video and JPEG/PNG/WebP/AVIF photos, and free 1080p/720p. No overlays or unchanged free overlays with Clean/Boxed/Minimal captions need no account; expressive styles and Pro configurations need Pro. Studio exports never enter history.
6. Poll `job_status` until completion, failure or cancellation. Report the finished path and any warnings; do not announce success from a queued response. Use `cancel_job` if the user stops it.

Node 22+, FFmpeg and ffprobe on PATH are required. On an FFmpeg error, offer the returned installation command and retry once installed. The first render may report `downloading_browser` while downloading a private render browser (about 100 MB); keep polling. Linux ARM64 requires Chromium. If setup fails, run `npx -y @modisign/mcp doctor` when shell tools are available and follow its diagnosis; do not invent another browser installer.

Default outputs go to `~/Movies/Modisign` on macOS and `~/Videos/Modisign` elsewhere. Custom output paths must be absolute. Existing files are preserved with numbered suffixes. Jobs last only for this server process; successful Pro configurations attempt account history, while a history warning never removes the local file.
