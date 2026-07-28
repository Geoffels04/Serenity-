# tezseract-website

A scroll-flown landing page built with the [tezseract](https://github.com/tez-ferguson/tezseract)
skill by Tez Ferguson: the visitor scrolls, and a pre-rendered camera flies from outside a
scene into its interior, then carries on into the next scene with no cuts, as one
continuous take. The footage is generated with Higgsfield rather than filmed; scroll only
drives time.

## Contents

```
.claude/skills/tezseract/   the skill itself, so any Claude Code session here can run it
index.html                  the page (starter config until the scenes are generated)
flight-engine.js            the portable vanilla-JS scrub engine
assets/                     scene posters (.webp) and camera clips (.mp4) land here
```

## How a build works

1. Interview: subject, brand kit, art direction, the journey (5–7 scenes), mobile yes/no,
   and budget — priced with Higgsfield `get_cost` before anything is spent.
2. Generate one scene still per beat, all sharing a byte-identical style preamble.
3. Fly the camera: one clip per scene, each leg starting from the previous leg's actual
   rendered last frame (the seam law).
4. Encode for scrubbing (crf 20, GOP 8, faststart) and wire the scenes into `index.html`.

## Local preview

The engine loads clips as blobs, so any static server works:

```bash
python3 -m http.server 8000
```

## Requirements (for generation, not for serving)

- Higgsfield (MCP connector or CLI) — generation costs credits
- ffmpeg and ffprobe
- Python 3 with Pillow (only for floating cutouts / portrait canvases)

## License

MIT — see [LICENSE](LICENSE), which carries the notices for tezseract and the
scroll-world project it rebuilds.
