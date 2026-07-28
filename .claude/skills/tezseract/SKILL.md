---
name: tezseract
description: >
  Build a scroll-flown landing page: the visitor scrolls and a pre-rendered camera
  flies from outside a scene into its interior, then carries on into the next scene
  with no cuts, as one continuous take. Interviews for subject, story beats, brand kit
  and budget, generates the scene stills and camera clips with Higgsfield (MCP tools or
  the CLI), frame-locks every seam, and wires a portable vanilla-JS scrub engine.
  Use when someone wants a "fly through our world" hero, a scroll cinematic, a 3D
  diorama landing page, an Apple-style scroll-scrubbed product page, or wants a
  business turned into a scrollable world.
license: MIT
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, AskUserQuestion, Skill
---

# tezseract

A landing page where **scroll drives a camera**, not a timeline. The camera genuinely
moves; scroll only drives time. Same technique as Apple's scroll-through product pages,
except the footage is generated rather than filmed.

**What gets produced:** N scene stills, N camera clips, optionally N-1 link clips that
join consecutive scenes, and a self-contained scrub engine that plays the whole chain as
one flight.

**The one law:** every seam must be frame-identical. A clip that follows another clip
starts from that clip's *actual rendered last frame*, never from a fresh render of the
same scene. Break this and you get a visible pop at every scene change. Read
[Step 4](#step-4--camera-architecture) before generating anything.

No framework is assumed. `references/flight-engine.js` is vanilla JS that builds its own
DOM and injects its own CSS into a container you hand it, so it drops into static HTML,
Next.js, Vue, Astro, Rails, Django, whatever. The value here is the generation pipeline,
the prompt templates and the seam method, not the front end.

---

## Step 0: Bootstrap

Pick the Higgsfield path, in this order:

1. **Higgsfield MCP tools** (preferred). If `generate_image` / `generate_video` /
   `media_upload` are available, use them. Nothing to install, no OAuth dance. Call
   `balance` to confirm credits. Full call shapes in `references/pipeline.md` §A.
2. **Higgsfield CLI** fallback. If there are no MCP tools but `higgsfield` is on `$PATH`,
   use the CLI path in `references/pipeline.md` §B. If it is not installed and the user
   wants it, they run `higgsfield auth login` themselves (interactive OAuth, you cannot).
3. Neither available: say so and stop. Do not substitute a different image or video
   provider without asking, because the seam law depends on start-frame and end-frame
   conditioning that most providers do not expose.

Also required, locally:

- **ffmpeg and ffprobe** on `$PATH`. Non-negotiable, this is how frames are extracted and
  clips are encoded.
- **Python 3 with Pillow**, only if you want floating cutout scenes (Step 3) or the
  portrait canvases for a mobile chain.

Facts worth holding on to:

- A generation takes 3 to 8 minutes. Run them in the background and poll. Never block.
- Media inputs are referenced by **media id or job id**, never by a raw https URL. Local
  files go up through `media_upload` then `media_confirm` (MCP), or as file paths on the
  CLI.
- macOS ships bash 3.2, so no associative arrays in any script you write.
- zsh arrays are 1-indexed and bash arrays are 0-indexed. Put every chain loop in a
  `#!/bin/bash` file and run it with `bash file.sh`. Inline array loops in an interactive
  shell are the classic way to wire the wrong frames into the wrong clip.

---

## Step 1: Interview

Ask only what cannot sensibly be defaulted, and ask it in the right shape.

### 1.1 Subject: open question, never multiple choice

"What should this world be about? Your business, a client's, or any idea. A word or a
sentence is fine."

A fabricated list of industries biases the answer and reads as deciding their business
for them. Capture the subject plus a one-line pitch ("a bubble tea company, leaf to last
sip") and a brand name if they have one.

### 1.2 Brand kit: three routes, pick one

- Import from a site. MCP: no direct equivalent, read the site and extract the palette
  yourself. CLI: `higgsfield marketing-studio brand-kits fetch --url <site> --wait`, then
  `brand-kits list --json`.
- The user hands over palette, name and tone.
- You propose a palette and name, they approve.

Land on **4 to 6 named hex values**, a display name and a tone word or two. Nominate one
hex as the scene **background** (usually the lightest) and one as the **accent**.

### 1.3 Art direction: structured choice

Default: soft matte low-poly **clay diorama**, isometric, tilt-shift miniature, warm
light. Alternatives: flat papercraft, glossy vinyl toy, claymation, neon night,
photoreal architectural. Whatever is picked becomes the **style preamble**, reused
byte-for-byte in every scene prompt. That verbatim repetition is what makes the world
read as one place.

### 1.4 The journey

The ordered scenes the camera flies through. Propose a set derived from the subject's own
value chain, then let the user edit. Five to seven works well. Each scene needs: a short
subject description (what is physically in it), an eyebrow, a headline, one line of body,
and zero to three tag pills. The last scene is usually the hero product plus the CTA.

### 1.5 Mobile: always ask, never assume

Present it as a two-option choice with the cost stated out loud:

> "Want a mobile version too? It is a second camera chain rendered natively in 9:16
> portrait, composed for phones rather than cropped from the landscape film. It roughly
> doubles the video spend (about X extra generations)."

- **Yes**: render the parallel portrait chain (pipeline §6b), wire `clipMobile`,
  `linksMobile` and `posterMobile`, run the full mobile QA.
- **No**: skip the mobile encodes entirely. The engine's phone hardening (seek
  coalescing, iOS priming, safe-area insets, no-jump resize) is always on regardless.
  That is not "a mobile version", that is just the page not breaking when a phone visits.

**Never ship a centre-crop as the mobile version by default.** If credits cannot cover
the portrait chain, say so and offer the crop encodes as an explicitly labelled stopgap
the user has to approve.

### 1.6 Budget: decided before anything renders

Show the tiers, compute the total, get a go.

| Tier | Model | Notes |
|---|---|---|
| Draft / previz | `seedance_2_0_mini` | 480p or 720p only. Still frame-locks, so previz translates directly to final. |
| Standard (default) | `seedance_2_0` | Up to 1080p or 4k in `std` mode. The touchy content filter. |
| Alternate | `kling3_0` | Different look, different content filter. The sanctioned NSFW fallback. |

Total = `N stills + (2N-1) videos` (double the videos if mobile) `+ ~15% re-roll headroom`.

**Price it, do not guess it.** On MCP, call each generation once with `get_cost: true` to
get the exact credit cost without submitting, then multiply. Call `balance` for the
available credits. On CLI, run one still and one video and diff `higgsfield workspace
list` before and after. Warn whenever the estimate passes ~70% of the balance. Running
out mid-run is recoverable (finished clips survive, resume after top-up) but ugly, and
the whole point of this step is that the user decides before the spend.

If the user names a model outside the roster, honour it **only if it can frame-lock**:
`models_explore` with `action: "get"` must show `start_image` and `end_image` in its
`medias[].roles`. A model with reference-only inputs can condition a generation but
cannot continue a shot, so it physically cannot hold a seam. Decline it in one line and
use a roster model instead. This skill only ships seamless output.

The scroll mechanic itself is fixed. That is the skill.

---

## Step 2: Scene stills

One image per scene, all sharing the identical style preamble.

Default model **`gpt_image_2`**: crisp at isometric illustration and returns a solid
background, which is exactly what a floating diorama island wants. Use `nano_banana_pro`
instead when the brief is character-heavy or needs legible text.

Prompt shape (full templates in `references/prompts.md`):

```
<STYLE PREAMBLE, byte-identical every time>. On a plain solid <bg hex> background with a
soft contact shadow. <PALETTE hexes>. No text, no letters, no logos, centered, 3:2.
Subject: <what is in THIS scene>.
```

Params: `aspect_ratio: "3:2"`, `resolution: "2k"`, `quality: "high"`.

Run all N concurrently in the background, then download each result. A transient 503 is
normal, re-roll that single scene rather than restarting the batch.

**Review the stills before continuing.** They have to read as one world: same camera
angle, same palette, same light. Regenerate any that drift, optionally passing an
approved scene as an `image` role reference to lock style. Do not pass a reference for
photoreal work, it clones the same room instead of matching the style.

---

## Step 3: Float the scenes (optional)

To have dioramas float over an atmospheric background instead of sitting in a solid box,
knock the flat background out to transparency with `references/cutout.py` (border-connected
flood fill, so interior colour that happens to match the background survives), then encode
to webp. The simpler alternative is to set the page background to the same colour as the
scene background and skip this entirely.

Either way, keep the stills. They are the video posters and the reduced-motion fallback.

---

## Step 4: Camera architecture

How the camera moves *between* scenes is the biggest quality lever in the whole build.
Two shapes. Pick by aesthetic, not by convenience.

### A: One continuous forward take (default, and correct for anything grounded)

One camera that only ever glides **forward**, first scene to last, as a single take.

Generate the legs **sequentially**. Leg 0 starts from scene 0's still. Every leg after
that starts from **the previous leg's actual last frame**, extracted with ffmpeg, with a
prompt that says continue gliding forward into the next scene and never pull back. Pass
**no end image**: an end image of a wide establishing shot forces the camera to reverse,
which is the single biggest cause of stutter.

Result: every seam is frame-identical *and* the camera never reverses. There are no link
clips, skip Step 5. Wire each leg as a scene clip with `links: []` and a small crossfade
(~0.08).

Cost: strictly sequential, so it is slower, and interiors trip the NSFW filter, so budget
about three attempts per leg.

### B: Dive plus aerial link (only for miniature / god's-eye worlds)

A "dive into the scene" clip per scene, plus a link clip that pulls **up and out** and
flies over to the next scene (Step 5).

The pull-out **reverses camera direction at every seam**. In a miniature world that reads
as an intentional "zoom out to the map, fly to the next island". In a grounded
first-person walkthrough it reads as a rewind. Use B only for the map-like look. When in
doubt, use A.

### Model: one for the entire chain

Every chained clip must accept a `start_image`; link clips also need an `end_image`.
Verify with `models_explore` `action: "get"`. Confirmed roster:

| Model | start / end image | Notes |
|---|---|---|
| `seedance_2_0` (default) | yes / yes | `mode: "std"`, `resolution: "1080p"`. **`generate_audio` defaults to true, pass `false`.** |
| `kling3_0` | yes / yes | `mode: "std"`, **`sound: "off"`** (defaults on). No resolution param, `std` returns 720p native. Different content filter. |
| `seedance_2_0_mini` | yes / yes | Draft tier, 480p/720p only. Frame-locks, so previz is genuinely seamless. |

Do not mix models mid-chain. Position continuity survives (the frames still hand off) but
each renderer has its own grain, motion and colour character, and that shift reads as a
subtle pop. The one sanctioned exception is the NSFW fallback for a single stubborn clip.

### Camera grammar: "forward only" is a seam rule, not a leg rule

The physics:

- **Position continuity** at a seam comes from the frame handoff.
- **Velocity continuity** at a seam means the camera must never reverse *across* a seam.
- **Inside a leg the camera is free.** One leg is one continuous render with no seam in
  it, so orbits, crane-ups, lateral tracking and push-in-then-ease-back are all safe.

So give each leg an expressive move drawn from the scene's own logic, under a **motion
handoff contract**: every leg *ends* by settling into a slow steady forward drift toward
the next destination (final second or so), and every leg *begins* by continuing that same
drift. Keep both clauses verbatim in the prompts (templates in `references/prompts.md`).

| Concept | Mid-leg move |
|---|---|
| Product, luxury retail | slow half-orbit around the hero object, then continue past it |
| Real estate, hospitality | steadicam glide through doorways, gentle crane-up in atria |
| Industrial, logistics, process | low lateral track alongside the line, foreground parallax |
| Travel, outdoors, campus | drone-style rise and reveal, then a descending swoop |
| Food, craft, detail | push in close to the craft moment, ease back, carry on |
| Playful miniature (arch. B) | dives and aerial hops, the link clip *is* the grammar |

Honest cost: expressive moves raise re-roll odds, because the model can end a fancy move
in a state that is not a clean forward drift. Mitigate by keeping the settle clause
verbatim, **eyeballing every leg's last frame before chaining the next one** (a bad
handoff frame poisons every leg after it), and budgeting one extra re-roll per expressive
leg. A plain forward glide stays the zero-risk default.

Remember scroll is a scrubber. Visitors scroll up too, so every move also plays in
reverse. That is free and expected, and it is another reason seam velocity has to be
consistent: a seam that flips velocity reads as a stutter in both directions.

**For B**, one flight per scene: starts high and outside, descends into the interior, the
structure opens. Start image is the **solid-background still**, not the transparent
cutout, so the video has a full frame. Duration 8 (seedance) or 10 (kling).

---

## Step 5: Link clips (architecture B only)

Skip this whole step for A.

A link clip flies from the end of scene i out and into the start of scene i+1. **Both of
its endpoints must be the actual rendered frames of its neighbours.** Never the original
still.

Why: every generation renders slightly differently. If a link *ends* on a fresh render of
"the kitchen" but the next dive *starts* on its own different render of the same kitchen,
they will not match and the seam pops. Hand off the exact pixels instead:

```
start_image = the LAST frame extracted from clip i's rendered video
end_image   = the FIRST frame extracted from clip i+1's rendered video
```

Both seams are then frame-identical: `clip_i.end == link.start` and
`link.end == clip_{i+1}.start`.

```bash
ffmpeg -sseof -0.15 -i clip_i.mp4    -frames:v 1 -q:v 2 clip_i_last.png
ffmpeg -ss 0       -i clip_next.mp4  -frames:v 1 -q:v 2 clip_next_first.png
```

Duration 5 is plenty. Prompt template in `references/prompts.md`.

Insurance, not substitute: the model lands *close* to the end image but not always
pixel-perfect, so the engine also applies a short crossfade at each seam. Frame-matched
endpoints plus a small crossfade equals no visible cut. A crossfade alone cannot hide a
content jump, so never skip the frame handoff and lean on it.

---

## Step 6: Encode for scrubbing

Scrubbing means setting `video.currentTime` from scroll position. Two things matter and
both are commonly gotten wrong.

**1. Seekability, not keyframe density, is what makes scrubbing work.** Many static hosts
(and `python -m http.server`) do not serve HTTP byte-range requests, which pins
`video.seekable` to `[0,0]` and clamps every seek to frame 0. The video looks frozen. The
robust fix is to fetch each clip as a `Blob` and play it from an in-memory object URL,
because blobs are always fully seekable. The engine does this, which is why you do **not**
need all-intra video.

**2. Do not shrink quality to buy smoothness.** Encode at native resolution (do not
upscale, and do not downscale, encode whatever ffprobe reports), crf ~20, a small GOP
(`-g 8`) rather than all-intra. All-intra bloats an 8 second clip to ~25MB; GOP 8 is ~8MB
and scrubs fine through a blob. Strip audio, add faststart, and a light unsharp to counter
video softness.

```bash
ffmpeg -i src.mp4 -an -vf "unsharp=5:5:0.8:5:5:0.0" \
  -c:v libx264 -preset slow -crf 20 -pix_fmt yuv420p \
  -g 8 -keyint_min 8 -sc_threshold 0 -movflags +faststart out.mp4
```

Same settings for every clip in the chain, so quality is uniform.

**Mobile encodes** (only if the user opted in at 1.5): the portrait chain gets
`scale=720:-2`, `-g 4`, crf 23. Tighter GOP matters more than resolution here, because a
phone decoder's seek cost scales with how many frames it has to decode from the nearest
keyframe. Wire them as `clipMobile` and `linksMobile`, and extract each portrait clip's
first frame as its `posterMobile`.

---

## Step 7: Assemble

Copy `references/flight-engine.js` (and `references/index.html` for a fully standalone
page) into the project, or port it into the user's framework. Config-driven:

```js
mountFlight(document.getElementById('flight'), {
  brand: { name: 'Pearl & Co.', href: '#top' },
  sceneScroll: 1.3,       // viewport-heights of scroll per scene clip
  linkScroll: 0.9,        // ...per link clip
  scenes: [
    { id: 'farm', label: 'The Farms',
      poster: 'assets/farm.webp',
      clip: 'assets/vid/farm.mp4',
      clipMobile: 'assets/vid/farm-m.mp4',    // mobile opt-in only
      posterMobile: 'assets/farm-m.webp',     // its first frame
      scroll: 1.6, dwell: 0.45,               // optional pacing
      accent: '#8FB98A',
      eyebrow: 'From leaf to last sip',
      title: 'It starts in the hills.',
      body: 'One sentence, from the visitor’s side.',
      tags: ['Single-origin', 'Hand-picked'] },
    // ...one per scene; the last may carry a `cta`
  ],
  links:       ['assets/vid/link1.mp4', 'assets/vid/link2.mp4'],   // length = scenes-1
  linksMobile: ['assets/vid/link1-m.mp4', 'assets/vid/link2-m.mp4'],
});
```

The engine handles the interleaved chain, scroll to currentTime with rAF smoothing, blob
loading, lazy prefetch of nearby clips, seam crossfades, pinned per-scene copy (first
scene greets on landing, last holds its CTA), a route rail, `prefers-reduced-motion`, and
phone hardening.

**Pacing.** `scroll` overrides `sceneScroll` for that scene, so more scroll distance means
a longer dwell. `dwell` (0 to 1, keep it at or under 0.6) remaps time so the camera settles
mid-scene, exactly where the copy peaks, then picks up speed toward the seam. Seam frames
are untouched by design. Give the hero and finale scenes a higher `scroll` plus some
`dwell` and keep transit scenes brisk. Expressive motion belongs in the clip, restraint
belongs in the scrub mapping. They compound.

**Theme** with CSS custom properties (`--tz-bg`, `--tz-ink`, `--tz-accent`,
`--tz-font-display`, ...). The engine wraps its defaults in `@layer tezseract`, so an
unlayered `:root` or `.tz` block on the page always wins with no specificity hacks. The
visual identity comes from the clips, so keep the chrome quiet.

`links` entries may be `null`. The engine then crossfades that seam directly, which is how
a page still completes when one link clip cannot be generated.

For non-JS backends, serve the assets and drop the script tag into the rendered HTML.
Nothing in it is framework-specific.

---

## Step 8: QA the seams

Drive the page in a headless browser and verify the thing most likely to be wrong.

- Screenshot just before and just after each seam. The two frames must be near-identical.
  If they pop, either you used a still instead of a rendered frame (redo Step 5) or the
  crossfade band is too narrow.
- Console clean, `video.seekable.end(0) > 0` on every clip (proves blob loading works),
  and `currentTime` tracks scroll across each clip's band.
- Reduced motion: stills only, no video, no motes.
- **Mobile.** Desktop-only build: one sanity pass at a phone viewport, page loads, posters
  show, nothing overlaps. Mobile build: emulate a phone with CPU throttled 4 to 6 times and
  flick-scroll, the clip must track without freezing. Confirm the first scene shows
  instantly and the video takes over on scroll with no blank frame (test iOS Safari
  specifically, it is the one that goes blank). Confirm the `-m.mp4` files are actually
  served on mobile and are **natively portrait** (`videoWidth < videoHeight`, not a
  downscaled 16:9). Scroll slowly so the URL bar collapses, the page must not jump. Rotate,
  layout must recompose.

---

## Gotchas

- **Seam pop** → link endpoints were stills, not the neighbours' actual rendered frames.
- **Seam stutter, camera "jumps backward"** → velocity reverses at the seam. Inherent to
  architecture B. For anything grounded, use A.
- **Frozen video, stuck at frame 0** → `seekable` is `[0,0]`, the host is not serving byte
  ranges. Use blob URLs, which the engine does.
- **Huge files** → you encoded all-intra. Use `-g 8` plus blob.
- **Soft or muddy** → you downscaled or over-compressed. Native res, crf at or under 20,
  add unsharp. Video is inherently softer than the stills, which is another reason to keep
  the stills as posters.
- **Audio on your silent film** → seedance `generate_audio` defaults to **true** and kling
  `sound` defaults to **on**. Set them off explicitly, and `-an` on encode regardless.
- **NSFW false positives** → the video filter flags innocuous clips, especially bedroom,
  pool and spa contexts, and words like bed, pool, waterfall, wine, swim. Fixes in order:
  (1) re-roll, it is often non-deterministic and passes on the second or third try;
  (2) strip trigger words, add "empty, unoccupied, no people, no figures, architectural,
  tasteful"; (3) regenerate that one clip on `kling3_0` with the same start and end frames,
  a different provider's filter often passes what seedance blocks, at the cost of a slight
  character shift on that clip; (4) set that `links` slot to `null` and let the engine
  crossfade the seam.
- **Transient 503 or a "not enough credits" race** → common when many generations launch at
  once. Re-roll the individual failure, and check `balance` before believing it.
- **Phone scrub stutters on a fast flick** → the 1080p master is too heavy for a phone
  decoder. Ship the `-m.mp4` encodes (720 wide, `-g 4`). The engine already coalesces
  seeks; the lighter encode is the other half. Still choppy on a low-end device? `-g 2`.
- **Blank or black scene on iOS while desktop was fine** → an iOS Safari quirk, a muted
  video that was never played will not paint a seeked frame. The engine keeps the poster up
  until the clip paints and primes each video on first touch. If you port the engine, do not
  hide the poster on `loadedmetadata` and do not strip `playsinline` or `muted`.
- **Page jumps while scrolling on mobile** → something re-runs layout on the URL-bar resize.
  Gate resize handling on a width change and keep `orientationchange` for rotation.
- **Copy hidden behind the notch or URL bar** → use the safe-area-aware offsets, and make
  sure the viewport meta includes `viewport-fit=cover` (the template does).
- **Portrait crops the scene** → a 16:9 clip on a tall phone shows its centre only, which
  is why the mobile version is the native 9:16 chain and never the crop. Check
  `videoWidth < videoHeight`.
- **White box scenes** → `gpt_image_2` returns a solid background. Match the page background
  to it or knock it out (Step 3).
- **Link clip grabbed the wrong scene's frames** → the loop ran in zsh, where arrays are
  1-indexed. Put chain loops in a `#!/bin/bash` file.

---

## References

- `references/prompts.md` : intake checklist, style preambles, every prompt template with
  fill-in slots.
- `references/pipeline.md` : the full run as copy-paste steps, MCP path first, CLI fallback
  second, plus frame extraction, encoding and the portrait chain.
- `references/flight-engine.js` : the portable scrub engine.
- `references/index.html` : minimal standalone page that mounts it.
- `references/cutout.py` : border-connected background knockout for floating scenes.
