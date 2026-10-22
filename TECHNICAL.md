# Modisign MCP — technical notes

## Render browser

The renderer downloads its managed render browser on first render if needed (~100 MB; up to 120 MB depending on OS). The job reports `downloading_browser` while ensuring it, before `rendering`. A render with a title behind people reports `preparing_people_model` while the bundled people runtime starts and `preparing_people_masks` while masks are made, then `rendering` again. A request with captions reports `downloading_speech_model` while the English speech model is first downloaded and `preparing_captions` while it loads and transcribes, before `rendering`. Doctor checks that managed build rather than a system browser. Linux also needs the render browser's system libraries.

Linux ARM64 instead needs system Chromium (`sudo apt install chromium`); doctor checks that binary and no managed download is attempted. Run `npx -y @modisign/mcp doctor` to inspect your setup. No FFmpeg binary ships with this package.

## Source checkout setup

This package is the open-source client. Overlay compositions, catalog/configuration APIs and Pro authorization checks are served by [modisign.app](https://modisign.app).

In the desktop app: **Settings → MCP servers → Add server → STDIO**, command `npx`, arguments `-y @modisign/mcp`, then save and restart. The CLI and desktop share the MCP configuration. This is a local server for the desktop's local Work/Codex tools; ordinary hosted web chat does not gain access to your files.

[VS Code MCP setup](https://code.visualstudio.com/docs/agent-customization/mcp-servers). If a desktop host cannot find `npx`, use its absolute path and ensure its environment includes FFmpeg on PATH.

These commands use the npm package; it must be published before registry installation works. For a local checkout, install dependencies and build as described below, then replace `npx -y @modisign/mcp` with `node /absolute/path/to/modisign-mcp/dist/cli.js`.

## Use

Ask your assistant: “Find a free career overlay, export it as green-screen MP4” or “Put that overlay on `/absolute/path/video.mp4` starting at 1 second.” The assistant configures the overlay, starts a job and polls for your file.

| Tool | Purpose |
| --- | --- |
| `list_overlays` | Search catalog by query, family, niche, free status; paginated |
| `get_overlay` | Read editable fields, limits, current values, looks and aspects; each field has `relevant` (used by the preset’s layout now) and `showWhen` (the conditions that use it) |
| `configure_overlay` | Apply settings; return configuration URL, free/Pro tier, `relevance` and `inactiveEdits` (valid values kept but unused by the final layout, with a `notice`) |
| `render_overlay` | Start MP4, MOV or WebM export |
| `add_overlay_to_video` | Composite at a start time onto one local video up to 60 seconds |
| `edit_video` | Export a Studio sequence with two tracks, crop/place, trims, photos, pauses removed, transitions, overlays, English captions, native titles, a rapid intro and layer motion keyframes |
| `get_transcript` | Return locally generated English transcript lines and source times to your assistant for review |
| `job_status` | Read state, progress, file details and warnings |
| `cancel_job` | Cancel and clean temporary files |
| `account_status` | Check sign-in and current Pro |
| `login` | Return a device approval link and code; poll in the background |

One job renders at a time. Jobs and IDs last for the server process (up to 100 recent jobs; queue capped at 50). Canceling a tool request during validation prevents it from enqueueing; after receiving a job ID, use `cancel_job`. Clients can pass an MCP `progressToken` to receive progress notifications; `job_status` works in every client. Some clients stop displaying progress after the immediate job response. For catalog pagination, pass the returned `next_cursor` as `cursor` with the same filters.

Composites keep audio as AAC, export H.264 MP4, preserve the video's aspect and cap the long side at 1920 (even pixel dimensions). The package automatically chooses the family's nearest supported overlay aspect using the website's `closestVideoAspect` rule, reauthorizes that configuration, and returns the chosen `aspect` in the job result. The overlay scales to the video's width and is vertically centered, preserving its proportions. Overlay and video begin at their own zero time; `start_seconds` offsets the overlay. The website's `overlayStartLimit` rule limits the start to `floor(max(0, video duration − overlay duration) × 10) / 10` seconds; later starts return a field error (a 3.5-second overlay on a six-second video allows 0–2.5 seconds). Both rules are implemented in [src/own-video.ts](src/own-video.ts) to match the website. Use `edit_video` for longer or multi-clip edits up to 180 seconds.

Ask “Cut these three local clips into a 9:16 Reel, remove pauses, add Clean captions, a crossfade between clips 1 and 2, a free hook at the start and a subscribe button at the end.” Or “Review the transcript of `/absolute/path/interview.mp4`, fix John Smith to Jane Doe, then export with Karaoke captions.” Or “Make a five-frame rapid intro from grind.mp4, pour.mp4, stir.mp4, steam.mp4 and serve.mp4, then replay them with source timestamps and the labels “Grind beans”, “Pour water”, “Stir”, “Steam milk” and “Serve”, in 9:16.”

### Studio limits and settings

`edit_video` uses the website's Studio engine in the local render browser. It accepts 1–300 video/photo clips across both tracks; the maximum end of either track must be at most 180 seconds after V1 crossfade overlap. Video sources are at most 180 seconds; trims retain at least 3 frames (0.1 seconds, the shared `MIN_CLIP_DURATION`). JPEG/PNG/WebP/AVIF photos default to 3 seconds and allow 0.1–30 seconds (`out - in`); HEIC is rejected.

- Tracks: every clip requires `track: "v1"` or `"v2"`. V1 retains request order and forbids `start`; V2 requires finite nonnegative timeline `start` seconds and nonoverlapping intervals. Interspersed requests become V1 sequence then V2 sorted by start, retaining original clip/media ids. V2 can stand alone or extend output; gaps are black. Sources end naturally without looping or freezing. Align starts manually; no automatic sync or clock-drift correction.
- Crop/Place: optional creation fields use shared project types/validators, never a second validator. Omission constructs zero crop / Full once; internal documents always contain both. `crop` is exact `{top,right,bottom,left}` in oriented-source percentages, each finite 0–95; opposite edges sum to at most 95. `place` is exact `{mode}` with full/top/bottom/left/right/pip-top-left/pip-top-right/pip-bottom-left/pip-bottom-right, or `{mode:"custom",x,y,width,height}` in normalized output coordinates, contained in output with dimensions at least 0.05. Halves fill the corresponding output half; corner boxes are 0.30 × 0.30 with 0.03 margins. Geometry crops the source before Fill/Fit and clamps pan against the retained source and destination box. Invalid/unknown fields, impossible crop, rectangles, overlaps, trims and maximum end return field errors before enqueue.
- Framing: `fit` is `fill` or `fit`, `zoom` is 1–3, and `pan_x`/`pan_y` are normalized centres (0–1). `slow_zoom` belongs to photos; volume/mute/fades belong to videos.
- Punch-ins: source-second starts, lengths 0.5–4 seconds in 0.1 steps, zoom 110/125/140, at most 50 nonoverlapping rows per clip.
- Transitions: `after_clip` is a zero-based index into the original request clips array. It must name a V1 clip with a next V1 clip, skipping interspersed V2 entries. Duplicate cuts and V2 targets fail. Crossfades/dips use 0.2–1 seconds, clamped by Studio's adjacent-V1 rules.
- Silence removal: gentle/normal/strong sensitivity and 0.3/0.5/1 second shortest pause, detected from V1 video audio only. Shared synchronized removal cuts/ripples both tracks and overlay starts, subtracting overlapping ranges once. With V2 present, transition windows/repairs that cannot preserve alignment return an explicit error naming the V1 transition to remove before retrying; no output is written. Starts must initially fit overlays within the sequence.
- Output: `9x16`, `4x5`, `1x1`, `16x9`; free quality choices are 1080p (default) or 720p.
- Captions: V1 speech only, even if muted; V2/reference speech never transcribes. One of thirteen styles (free/Pro lists below), position `upper`/`center`/`lower` and size `s`/`m`/`l`. Optional `corrections: [{from, to}]` replace case-insensitive words/phrases while retaining source timing. `get_transcript` returns source-relative times, including an optional trim's offset.
- Titles: `texts` is up to 100 native titles, validated with the shared `isTextLabel`/`isTextStyle`/`isTextDuration`/`textProblem` rules. `text` is up to 120 characters (empty only with `timestamp`). A title is bound with `clip`, a request index of a V1 or V2 clip: it shows for that clip's whole span and follows its trims, splits and pause removal; `timestamp: "source"` stamps the clip's source in-point as `mm:ss` (never for photos) and `"timeline"` its timeline start, above the text. Without `clip`, `start` and `duration` (0.1–180 seconds) place it on the timeline as it is before any intro prepend. Defaults come only from `DEFAULT_TEXT_STYLE` (Montserrat 800, white, size `m`, centred, no backing), applied once while mapping the request; `font`/`weight`/`italic`, `fill` (`#RRGGBB`), `size` (`s`/`m`/`l`/`xl`), `x`/`y` (0–1) and `backing` override them. Unknown keys, out-of-range values and a clip title with `start`/`duration` are field errors before any job is accepted. Titles use the bundled caption fonts and plain titles are free. Rapid intro, captions and pause detection stay V1-only.
- Title reveal: optional `reveal: {rect?, direction?, start?, duration?, easing?}` on a title is a rectangular wipe over stationary text; its fields and semantics are those of the published tool schema. Omitted fields come only from the shared `DEFAULT_TITLE_REVEAL`; `completeReveal` stores a complete reveal and the shared `revealProblem` judges it, so errors name the request field (`texts.0.reveal.rect`, `texts.0.reveal.duration`, …) before authorization, media access or enqueue. The caller never supplies the retained phase (`animationOffset` is an unknown key): the shared reducer keeps it through trims, splits, pause removal and the rapid intro. The published schema is built from the `REVEAL_*` constants. It renders through the shared title drawing with no model, worker or extra request, and `titleEffects` (see Data flow) makes the export need Pro.
- Behind people: optional `occlusion: {clip?, threshold?, feather?, smoothing?}` puts a title behind every person the on-device people model detects in one clip; the fields and ranges are those of the published tool schema. `clip` indexes the request `clips` array, not the canonical position, so interspersed V2 clips keep their index, and an explicit title that does not share time with it fails `texts.N.occlusion.clip` once metadata is known. Omitted quality fields default only from the shared `DEFAULT_OCCLUSION`; the model is the fixed `PEOPLE_MODEL`, and `model`, `mode` or a phase are unknown keys. `completeOcclusion` stores a complete value and the shared `occlusionProblem` judges the ranges, so errors name `texts.N.occlusion.clip|threshold|feather|smoothing` before authorization or media access. The shared reducer keeps owners through splits, pause removal and the rapid intro. Like a reveal it sets `titleEffects` (see Data flow), so the export needs Pro; only that boolean leaves the machine, never the owner, quality fields or any picture.
- Rapid intro: `rapid_intro: {clips, labels, frames_per_clip?, timestamp?, mute_teasers?}` runs the engine's `rapid-intro` action after media mapping and pause removal, so repeated paths reuse one file and speech detection runs once per media. `clips` are 5–7 unique request indices of V1 clips in teaser order; each teaser is the first `frames_per_clip` (3–6, default 5) frames of that clip's current trim, muted unless `mute_teasers: false`, with no transition. The unchanged V1 body follows, each chosen clip with a bound label (`labels`: exactly one `{clip, text}` per chosen clip, text up to 120 characters, empty only when `timestamp` is not `none`) and the `timestamp` basis (`source` default, `timeline`, `none`). V2 starts, overlay starts and explicit titles move later by the teaser total, so request them as for the edit without the intro. The tool never looks at pictures: labels come from the user or assistant, never from file names. A refusal by the engine (a clip shorter than the teaser, a photo with `source`, more than 180 seconds, 300 clips or 64 KiB) names its cause and changes nothing: submission runs the action once on the mapped clips and titles and rejects the request before a job is accepted, and the render browser repeats it after pause removal and overlay setup, failing the job before any file is published.
- Motion: optional `motion: {x?, y?, scale?, rotation?, opacity?: [{at, value, easing}]}` on each clip, each title and each overlay request, with the shared contract's rows, bounds and easings (`hold`, `linear`, `ease-in`, `ease-out`, `ease-in-out` or a `[x1, y1, x2, y2]` Bezier with each number 0–1); the published schema is built from the shared `MOTION_*` constants and every request is checked with the shared `motionProblem`, reporting `Invalid clips.0.motion: Motion scale[1].value must be between 0.1 and 5.` style errors (field plus the exact reason) before authorization, media access or enqueue. Footage keys are source seconds (0–180; a photo's keys sit on its own signed clock, which starts at its `in`, so the 0–180 bound for footage is applied once the real media kind is known); title and overlay keys are local seconds from their own start (0–180). x/y are fractions of the output width/height, scale a multiplier, rotation clockwise degrees, opacity 0–1; `zoom` is static inner framing and `motion.scale` is the outer motion of the finished layer. At most 60 keys per channel and 1000 across the request. `animationOffset` is not a request field: it is saved structure created by editing. Clip and title motion map through `mapClips`/`mapTexts` into `StudioClip.motion`/`StudioText.motion`; overlay motion travels with the localized overlay descriptor into `StudioOverlay.motion`. The render browser checks the final document (after pause removal and rapid-intro duplication) with the website's `studioBudgetProblem` (titles, 1000 keys, 64 KiB) before encoding, failing the job with no output. Rapid-intro teasers start without motion; the body keeps its curves.
- Sounds: `sfx` is up to 100 sounds from the fixed ten-sound `ugc-1` pack (two each of click, typing, whoosh, pop and sparkle) and `auto_sfx` lets the tool place them; there is no file, URL or search field. The published schema is built from the shared registry constants (`SFX_ASSETS`, `MAX_STUDIO_SFX`, `SFX_OFFSET`, `SFX_GAIN`, `SFX_FADE_MAX`, `AUTO_*` options) and every request is checked with the shared `sfxSettingsProblem`/`isSfxOffset` rules and strict keys before authorization, media access or enqueue. A sound has `asset` and exactly one of `start` (seconds of the initial post-overlap edit) or `anchor`; `offset` (-2 to 2 s) only with anchor; optional `in`/`out` (seconds inside the sound, at least one sample apart), `gain` (0-2), `mute`, `fade_in`/`fade_out` (0-2, inside the retained sound). Defaults (whole sound, the sound's own gain, unmuted, no fades, offset 0) come once from the registry. Anchors are `{kind:"title-enter", text}` (request index in `texts`: the first moment the title is visible), `{kind:"transition", after_clip}` (request index of a V1 clip listed in `transitions`; the middle of a crossfade or the dip's black point, which must survive clamping) and `{kind:"overlay-cue", overlay, cue}` (request index in `overlays`; `cue` one of the family's declared taps active for that configuration, from the website's `cues` in the configuration response). Indices become runtime ids (`clip-N`, `text-N`, `overlay-N`) from the original request before V1/V2 sorting; an owner, cue or start that cannot exist is an error naming `sfx.N.…` at submission and again at dequeue. Order of operations in the render browser: map clips, titles, overlays and manual sounds; transcribe and detect silence; apply word styles, silence removal (absolute starts warp once and linked sounds follow their owners; a sound whose owner was removed is an error) and the rapid intro (absolute starts shift by the teaser total); build the automatic plan from that final structure and apply it through the reducer's `apply-auto-sfx` (the request authorizes the default-selected rows; placed and skipped counts and owner-specific reasons come back as job warnings, and a scan with no eligible events says so); run the exact `studioBudgetProblem`; export through the shared normalized mixer, which loads and verifies each pack sound against its registry SHA-256, sums sounds with the footage before the final unity clamp and truncates at the output end. Sounds never extend the output, duck speech or change footage volume. A failed or canceled sound load or encode publishes nothing. Sounds are free and add nothing to authorization, usage or history.

Files default to `~/Movies/Modisign` on macOS and `~/Videos/Modisign` elsewhere. Existing files are preserved: collisions append `-2`, `-3`, etc. Provide absolute local paths for media and custom outputs. No arbitrary HTML or commands are accepted.

### CLI

```sh
npx -y @modisign/mcp login
npx -y @modisign/mcp status
npx -y @modisign/mcp doctor
npx -y @modisign/mcp render hook-title/career-truth --aspect 16x9 --out overlay.mp4
npx -y @modisign/mcp render hook-title/career-truth --background transparent --out overlay.mov
npx -y @modisign/mcp logout
```

No arguments starts the stdio MCP server; stdout is reserved for protocol. CLI login prints the code/link, opens the browser and waits for explicit approval. The login tool shows the link without opening a browser. Logout deletes local credentials; revoke a device on the [account page](https://modisign.app/account) to invalidate its token immediately.

## Free and Pro

Each overlay family offers exactly one free preset on its default layout. An unchanged free preset exports without an account. Aspect and background edits remain free. Changing text, look, duration or other non-output settings generally makes it Pro, unless the result matches another free preset. Draft configuration is open to everyone; rendering other configurations needs sign-in and current Pro. Upgrade at [Pricing](https://modisign.app/pricing).

Caption styles: `clean`, `boxed`, `minimal` (free); `karaoke`, `bold-keyword`, `word-pop`, `highlight-box`, `neon`, `pop-up`, `typewriter`, `outline`, `editorial`, `gradient` (Pro).

Studio edits are free with no overlays or only unchanged free overlay configurations whose motion is absent or entirely neutral, and Clean/Boxed/Minimal captions. Any Pro overlay configuration, any non-neutral motion key on an overlay (active or not, even on a free preset) expressive caption style or title effect (a reveal or behind people on any title, active or not) needs current Pro. Editing footage, pauses, transitions, photos, native titles, footage and title motion, the rapid intro and quality is free. Studio exports never enter account history.

Every render attempts the website's authorization endpoint, again when its queued job starts. Previously authorized free configurations can render offline once their matching composition/assets/configuration are cached. Pro renders always require an online check. Successful overlay/composite renders by Pro accounts attempt configuration-only account history, including unchanged free presets, using the website's title and overlay name. Free configurations rendered anonymously or without Pro leave no history; a history failure produces a warning and keeps the local file.

## Privacy and local storage

### Data flow

Video, photos, audio, transcripts, local paths, clip track/start/crop/place, title text, rapid-intro labels, reveal shapes, behind-people owner clips and quality fields, masks and every motion curve, time and value are never sent to Modisign. Studio authorization is exactly `{kind:"studio",configurations,overlayMotionCustomized,captionStyle,captionCustomized,titleEffects}`, where `overlayMotionCustomized` is the fixed boolean `!motionIsIdentity` of any placed overlay (the website's classifier) and `titleEffects` is true when any title has a `reveal` or an `occlusion` (the website's `titleEffectsOn`); the same body is sent at submission and at dequeue and is the free-cache key, so a cached free request can never authorize a motion-customized or title-effect one. Usage remains only free/kind/outcome, without a family or layout data. Calling `get_transcript` returns transcript text to your assistant/provider; otherwise generated captions stay in process/browser memory. Your assistant provider sees tool arguments/results, including title text and motion keys. Overlay configurations, including typed overlay text, and Studio's caption style reach Modisign for validation and authorization.

The package downloads only first-party compositions and their approved runtime, animation and font dependencies, then localizes them. English Whisper tiny.en's pinned model downloads from Hugging Face once (~43 MB), through the Node host into the local cache. The render browser only receives loopback URLs. The people model (about 250 KB), its polarity probe, the people runtime (the worker plus one SIMD and one non-SIMD loader/wasm pair, about 19 MB) and their notices ship inside the package under `dist/studio/person-models` and `dist/studio/person-runtime`; nothing is downloaded for titles behind people. They are built from the website's canonical assets with the website's own `person-runtime` build step (hash-checked against the shared people manifest), and only a request with a person title registers their exact loopback routes: the worker, one loader/wasm pair each, the model and the probe, never the notices or a directory. The worker verifies every file's length and SHA-256 before use.

### Render isolation

Every render browser uses a secret-protected local proxy allowing only its exact page/runtime/cached assets and, for Studio, the exact local files named in the request. External navigations, workers, subresources, redirects, tunnels and other local files are blocked even if cached HTML removes its CSP.

Standalone overlay/composite renders replace the renderer's file server with one authenticated loopback listener; additional listeners are blocked. Cache files must be regular files within their cache directory, without escaping symlinks, and are pinned before the renderer compiles a private snapshot. The listener serves prepared HTML from memory and cached assets from retained descriptors.

The sound pack is served from the same loopback server at exact routes only: the ten registry WAVs (`audio/wav`), `manifest.json`, `NOTICE.txt` and the shipped licence texts under `/sfx/ugc-1/`. Unlisted names, directories, traversal and other methods are rejected, and no public sound-source domain is in the render CSP or allowlist.

Studio uses an authenticated proxy and media server. Every listener requires a random per-render 256-bit secret header. Browser requests, including workers, inherit it; the render browser uses a debugger pipe with no remote-debugging port. Named Studio files are validated and opened once per render, then served from pinned descriptors so replacing a path cannot expose a different file. Cached compositions remain a soft entitlement gate.

### Credentials and caches

Credentials are stored at `~/.config/modisign/credentials.json` (Windows: `%APPDATA%\modisign\credentials.json`), bound to the website origin. POSIX files retain mode 0600. Tokens never appear in tool results or logs.

On Windows, PowerShell uses the Windows ACL API to create the directory and credential file with a protected DACL granting only the current user Full Control, then verifies it before writing a token and before reading credentials. If protection cannot be established or verified, login and credential use fail with a clear error. Windows argument construction is unit-tested; Windows runtime execution is untested here.

Composition/configuration caches live below the same directory in `cache/v5-hf-0.8.80`; these contain overlay text. The speech model lives apart in `cache/speech/<revision>`, so a cache epoch change does not download it again. Delete the cache directory to clear it. Render scratch files are cleaned after success, failure or cancellation.

### Telemetry

Anonymous first-party usage sends only login outcomes and render family/free/kind/outcome, using a random per-process visit ID. No account link, token, path, filename, typed text or media metadata enters events. Set `MODISIGN_NO_TELEMETRY=1` or `DO_NOT_TRACK=1` to opt out. The renderer's own telemetry is always disabled through its dedicated opt-out environment variable and `DO_NOT_TRACK=1`.

### Origin and configuration overrides

`MODISIGN_URL` overrides the default `https://modisign.app`; local development uses `http://localhost:3000`. HTTPS is required except on loopback. Credentials and caches are scoped to the selected origin. Optional `MODISIGN_CONFIG_DIR` selects an absolute isolated credentials/cache directory (useful for testing); normal OS credential privacy checks still apply.

## Develop

From `mcp/` in the Modisign source workspace:

```sh
corepack pnpm install
corepack pnpm test
corepack pnpm build
```

The official MCP TypeScript SDK server and matching test client, renderer and build dependencies use exact pinned versions in package.json. Monorepo builds import the maintained source; the public source mirror includes a generated `vendor/` snapshot of exactly the Studio engine and validator's transitive dependencies. The monorepo freshness check rejects stale vendor files.

In both builds, the bundler combines the website's Studio modules into the static runner/Whisper worker. The build ships the matching speech runtime and Montserrat font with its OFL notice. Installed tarballs need no website checkout or build. The npm package contains compiled `dist`, `README.md`, the MIT license, third-party `NOTICE` and the companion skill; `TECHNICAL.md` stays outside the npm package.

### Public source mirror

The sound pack's canonical copy is `web/public/sfx/ugc-1` in the monorepo; the build copies it into `dist/studio/sfx/ugc-1/` and the generated mirror carries the same bytes under `browser/sfx/ugc-1/` (built from there when present). It is never edited or committed twice in the monorepo, and the npm package contains the files through `dist`.

Build the public mirror with `npm ci && npm run build && npm test`; no workspace checkout or pnpm is needed. From `mcp/` in the monorepo, run `npm run mirror:generate` after shared engine or validator changes and `npm run mirror:check` to verify freshness.

From the repository root, `mcp/scripts/mirror.sh` generates an isolated source mirror and requires `npm ci`, build and tests to pass. Without `--push` it verifies only and runs no git commands. An explicit `--push` publishes generated snapshots after checking the source is clean and the remote is the expected public repository. The copy allowlist excludes the monorepo's agent guides; no monorepo history, templates, app routes, credentials or local notes are exported.

### Companion skill

[skills/modisign/SKILL.md](skills/modisign/SKILL.md) is an Anthropic Agent Skill for discovery, free-first configuration and local rendering. Copy its `modisign` directory to `.claude/skills/` (project) or `~/.claude/skills/` (personal). Connect the MCP server separately; the skill does not install it or grant hosted chat local file access.

### Directories

The official Registry metadata is [server.json](server.json); `package.json.mcpName` matches `io.github.slvDev/modisign`. The repository owner can verify it with `mcp-publisher login github`; `app.modisign/modisign` instead requires domain proof. Publish npm before registry metadata. [Registry quickstart](https://modelcontextprotocol.io/registry/quickstart).

For Claude directory discovery, a local server and this skill may be submitted in a plugin bundle. [Claude publishing](https://claude.com/docs/directory/publish). No publication is performed by the build.

## License

MIT — Copyright (c) 2026 Viacheslav Sierbov. See [LICENSE](LICENSE) for the license and [NOTICE](NOTICE) for third-party notices. The renderer and the MCP SDK are Apache-2.0; FFmpeg and the render browser are not distributed. Fetched overlay compositions and fonts keep their own terms and are not covered by this license.
