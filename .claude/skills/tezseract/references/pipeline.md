# Pipeline

Two ways to reach Higgsfield. **§A is the MCP path and the default.** **§B is the CLI
fallback.** Everything from §C onward (frame extraction, encoding, the portrait chain) is
local ffmpeg work and is identical either way.

Set up a scratch directory first.

```bash
WORK=/tmp/tezseract          # prompts, raw renders, extracted frames
ASSETS=./assets              # what the page actually serves
mkdir -p "$WORK" "$ASSETS/vid"
SCENES="farm kitchen shop delivery plaza finale"   # your scene ids, in order
```

---

## §A. MCP path (default)

### A0. Preflight the spend

```
balance                                   → available credits, plan
generate_image { params: { model: "gpt_image_2", prompt: "...", get_cost: true } }
generate_video { params: { model: "seedance_2_0", prompt: "...", get_cost: true } }
```

`get_cost: true` returns the credit cost without submitting anything. Multiply:
`N × still_cost + (2N-1) × video_cost`, double the video term if the mobile chain is on,
add ~15% for re-rolls. State the total and get a go before generating.

### A1. Scene stills

One call per scene, fired concurrently.

```
generate_image {
  params: {
    model: "gpt_image_2",
    prompt: "<style preamble + subject>",
    aspect_ratio: "3:2",
    resolution: "2k",
    quality: "high"
  }
}
```

Keep every returned **job id**. Download each result URL to `$WORK/still_<id>.png` with
curl so ffmpeg can use it locally.

Review all N side by side for cohesion before continuing. To lock style on a re-roll, pass
an approved scene as a reference:

```
medias: [ { role: "image", value: "<job id of the approved still>" } ]
```

### A2. Referencing media: the three routes

`medias[].value` takes a **media id or a job id, never an https URL.**

| Source | How |
|---|---|
| A previous generation | pass its **job id** straight through. No upload needed. |
| A web URL | `media_import_url { url }` → use the returned `media_id` |
| A local file (extracted frames, portrait canvases) | `media_upload` → PUT the bytes → `media_confirm` |

The local-file route in full:

```
media_upload { files: [ { filename: "last_farm.png" } ] }
   → returns a media_id and a presigned upload_url per file
```

```bash
curl -X PUT --upload-file "$WORK/last_farm.png" "<upload_url>"
```

```
media_confirm { type: "image", media_ids: ["<media_id>", ...] }
```

Batch it. `media_upload` accepts a `files[]` array and `media_confirm` accepts
`media_ids[]`, so all the frames for one chain step go up in two calls plus a curl loop.

### A3. Camera clips

**Architecture A, sequential legs.** Leg 0 takes the scene-0 still's job id directly.

```
generate_video {
  params: {
    model: "seedance_2_0",
    prompt: "<leg prompt>",
    medias: [ { role: "start_image", value: "<job id of still_0>" } ],
    aspect_ratio: "16:9",
    duration: 8,
    mode: "std",
    resolution: "1080p",
    generate_audio: false
  }
}
```

Then for every leg after that: download the previous leg, extract its last frame (§C),
upload and confirm it (A2), and pass that media id as `start_image`. **No `end_image`.**
Look at each last frame before chaining onward.

**Architecture B, dives.** Same call, but every dive starts from its own scene still's job
id, so all N run concurrently.

### A4. Link clips (architecture B only)

Extract the boundary frames (§C), upload them (A2), then per adjacent pair:

```
generate_video {
  params: {
    model: "seedance_2_0",
    prompt: "<link prompt>",
    medias: [
      { role: "start_image", value: "<media id of last frame of clip i>" },
      { role: "end_image",   value: "<media id of first frame of clip i+1>" }
    ],
    aspect_ratio: "16:9",
    duration: 5,
    mode: "std",
    resolution: "1080p",
    generate_audio: false
  }
}
```

### A5. Notes

- `generate_audio` defaults to **true** on seedance and `sound` defaults to **on** on
  kling. Turn them off on every single call.
- A generation takes minutes. Fire them and carry on, do not sit in a poll loop. Re-display
  a finished job with `job_display { id }`.
- A transient 503 or a "not enough credits" race under heavy concurrency is normal. Re-roll
  the one failure and confirm the real balance with `balance` before believing it.
- Roughly 5 or 6 concurrent generations is comfortable. Much more and the races start.

---

## §B. CLI fallback

Same shape, different surface. Requires `higgsfield` on `$PATH` and an authenticated
session (`higgsfield auth login`, interactive, the user has to run it).

```bash
VMODEL=seedance_2_0
case "$VMODEL" in                       # bash 3.2 safe, no associative arrays
  kling3_0)          VOPTS="--mode std --sound off";        DIVE_DUR=10; LINK_DUR=5 ;;
  seedance_2_0_mini) VOPTS="--mode std --resolution 720p";  DIVE_DUR=8;  LINK_DUR=5 ;;
  *)                 VOPTS="--mode std --resolution 1080p"; DIVE_DUR=8;  LINK_DUR=5 ;;
esac
```

Every `--wait` call below takes minutes, so run the whole script backgrounded and poll its
log. Never block the foreground.

**Stills**

```bash
gen_still() { # $1 = scene id
  higgsfield generate create gpt_image_2 --prompt "$(cat "$WORK/still_$1.txt")" \
    --aspect_ratio 3:2 --resolution 2k --quality high --wait --wait-timeout 15m --json \
    > "$WORK/still_$1.json" 2> "$WORK/still_$1.err"
  url=$(jq -r '.[0].result_url // empty' "$WORK/still_$1.json")
  [ -n "$url" ] && curl -fsSL "$url" -o "$WORK/still_$1.png" && echo "still $1 ok" || echo "still $1 FAIL"
}
for n in $SCENES; do gen_still "$n" & done; wait
```

**Clips** (`$VOPTS` is deliberately unquoted so the flags word-split)

```bash
gen_clip() { # $1 = scene id, $2 = start image path
  higgsfield generate create "$VMODEL" --prompt "$(cat "$WORK/clip_$1.txt")" \
    --start-image "$2" $VOPTS --aspect_ratio 16:9 --duration "$DIVE_DUR" \
    --wait --wait-timeout 20m --json > "$WORK/clip_$1.json" 2> "$WORK/clip_$1.err"
  url=$(jq -r '.[0].result_url // empty' "$WORK/clip_$1.json")
  [ -n "$url" ] && curl -fsSL "$url" -o "$WORK/clip_$1.mp4" && echo "clip $1 ok" || echo "clip $1 FAIL"
}
```

Architecture A: call `gen_clip` one at a time, passing the previous leg's extracted last
frame. Architecture B: `for n in $SCENES; do gen_clip "$n" "$WORK/still_$n.png" & done; wait`.

**Links**

```bash
gen_link() { # $1 = index, $2 = start png, $3 = end png
  higgsfield generate create "$VMODEL" --prompt "$(cat "$WORK/link_$1.txt")" \
    --start-image "$2" --end-image "$3" $VOPTS --aspect_ratio 16:9 --duration "$LINK_DUR" \
    --wait --wait-timeout 20m --json > "$WORK/link_$1.json" 2> "$WORK/link_$1.err"
  url=$(jq -r '.[0].result_url // empty' "$WORK/link_$1.json")
  [ -n "$url" ] && curl -fsSL "$url" -o "$WORK/link_$1.mp4" && echo "link $1 ok" || echo "link $1 FAIL"
}

set -- $SCENES; i=0; prev=""
for n in "$@"; do
  if [ -n "$prev" ]; then i=$((i+1)); gen_link "$i" "$WORK/last_$prev.png" "$WORK/first_$n.png" & fi
  prev="$n"
done; wait
```

CLI notes: pass **local file paths** to `--start-image` and `--end-image`, a job UUID is
rejected. `kling3_0` has no `--resolution` flag at all. Do not pass `--generate-audio` on
seedance, it errors. `.[0].result_url` is the field on the `--wait --json` job object;
`.min_result_url` is a lower-res preview.

---

## §C. Extract the boundary frames

The seam handoff. Always from the **rendered videos**, never from the stills.

```bash
for n in $SCENES; do
  ffmpeg -v error -ss 0     -i "$WORK/clip_$n.mp4" -frames:v 1 -q:v 2 "$WORK/first_$n.png"
  ffmpeg -v error -sseof -0.15 -i "$WORK/clip_$n.mp4" -frames:v 1 -q:v 2 "$WORK/last_$n.png"
done
```

Architecture A needs only `last_*`. Architecture B needs both.

---

## §D. Encode for scrubbing

Native resolution, crf 20, GOP 8, light sharpen, no audio, faststart. Check what you
actually have first, and never upscale.

```bash
ffprobe -v error -select_streams v:0 -show_entries stream=width,height \
  -of csv=p=0 "$WORK/clip_farm.mp4"
```

```bash
enc() {
  ffmpeg -v error -y -i "$1" -an -vf "unsharp=5:5:0.8:5:5:0.0" \
    -c:v libx264 -preset slow -crf 20 -pix_fmt yuv420p \
    -g 8 -keyint_min 8 -sc_threshold 0 -movflags +faststart "$2"
  echo "enc $2 $(du -h "$2" | cut -f1)"
}

for n in $SCENES; do enc "$WORK/clip_$n.mp4" "$ASSETS/vid/$n.mp4"; done
i=0; for f in "$WORK"/link_*.mp4; do i=$((i+1)); enc "$f" "$ASSETS/vid/link$i.mp4"; done
```

Stills to webp for the posters (run `cutout.py` first if you want them floating):

```bash
for n in $SCENES; do cwebp -quiet -q 84 -resize 1800 0 "$WORK/still_$n.png" -o "$ASSETS/$n.webp"; done
```

The engine config then reads `scenes[k].clip = assets/vid/<id>.mp4`,
`scenes[k].poster = assets/<id>.webp`, and `links = ['assets/vid/link1.mp4', ...]` with
length N-1, in order.

---

## §E. The portrait chain (mobile opt-in)

This is what "the mobile version" means: a **parallel 9:16 chain**, frame-locked against
its own renders. Same seam law. Budget about 2N-1 extra video generations plus re-rolls.

1. **Portrait start canvases.** Do not hand the model a 3:2 still and hope. Composite each
   scene onto a 1080x1920 canvas in the page background colour, scene at ~94% width, visual
   centre at ~45% height. The render then opens on exactly what the portrait poster shows.
   Composite RGBA cutouts over the background colour first.

   ```python
   from PIL import Image
   BG = (245, 237, 224)
   src = Image.open("still_farm.png").convert("RGBA")
   canvas = Image.new("RGB", (1080, 1920), BG)
   w = int(1080 * 0.94); h = round(src.height * w / src.width)
   src = src.resize((w, h), Image.LANCZOS)
   canvas.paste(src, ((1080 - w) // 2, int(1920 * 0.45) - h // 2), src)
   canvas.save("portrait_farm.png")
   ```

2. **Clips**: same prompt templates with the portrait clause prepended,
   `aspect_ratio: "9:16"`, same model and params as the main chain.
3. **Links**: extract first and last frames **from the 9:16 renders** and generate 9:16
   links between them. A native portrait scene sitting between cropped landscape neighbours
   pops at both seams. The portrait chain has to be complete, not partial.
4. **Encode** portrait-oriented: `scale=720:-2`, `-g 4`, crf 23. These are the `-m.mp4`
   files.

   ```bash
   encm() {
     ffmpeg -v error -y -i "$1" -an -vf "scale=720:-2,unsharp=5:5:0.6:5:5:0.0" \
       -c:v libx264 -preset slow -crf 23 -pix_fmt yuv420p \
       -g 4 -keyint_min 4 -sc_threshold 0 -movflags +faststart "$2"
   }
   ```

5. **Posters**: extract each portrait clip's first frame, convert to webp, wire as
   `posterMobile`, so nothing flashes from landscape to portrait when the video paints.

### Centre-crop stopgap

Only when the user opted into mobile and credits cannot cover the portrait chain, and only
after telling them. Re-encode the landscape masters at `scale=-2:720`, `-g 4`, crf 23 and
wire them as the mobile variants. Portrait phones will see roughly the middle quarter of
the frame. Label it as a stopgap in writing, never ship it silently.

---

## Notes

- **Previz on the cheap.** Run the entire chain once on `seedance_2_0_mini`. It still
  frame-locks, so the previz is genuinely seamless and the journey it validates translates
  directly. Then re-render the final legs on the full model.
- **NSFW fallback across models.** If one clip keeps getting flagged after re-rolls and
  prompt scrubbing, regenerate that one clip on `kling3_0` with the same start and end
  frames, then go back to the chain model. Expect a slight render-character shift on that
  clip. Behind a crossfade on a 5 second link, that beats a missing link.
- **If a whole batch stalls**, check credits (`balance`, or `higgsfield workspace list`) and
  read the `.err` files.
- **Chain loops belong in a `#!/bin/bash` file** run as `bash file.sh`. zsh arrays are
  1-indexed, which is how link clips end up wired to the wrong scenes.
