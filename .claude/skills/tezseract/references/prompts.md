# Prompts and intake

Everything here is fill-in-the-slots. Keep the **style preamble** byte-for-byte identical
across every scene still. That identical text is the whole reason the world reads as one
place rather than five unrelated pictures.

---

## Intake checklist

Write these down before generating anything.

| Field | What it is |
|---|---|
| `SUBJECT` | the business plus a one-line pitch |
| `BRAND_NAME` | display name |
| `PALETTE` | 4 to 6 named hexes, e.g. `taro #9B7EBD, cream #F5EDE0, caramel #C88A5A, matcha #8FB98A, plum #3A2E48` |
| `BG_HEX` | one palette colour nominated as the scene background, usually the lightest |
| `ACCENT_HEX` | one nominated as the accent, used for buttons and the active nav |
| `TONE` | a word or two: cozy, premium, playful, industrial |
| `STYLE` | the art direction, one of the preambles below |
| `SCENES[]` | ordered. Each: `id`, `label`, `subject`, `eyebrow`, `title`, `body`, `tags[]` (0 to 3). Last scene is the hero plus the CTA |
| `ARCH` | A (continuous forward take) or B (dive plus aerial link) |
| `MOBILE` | yes or no. Always asked out loud with the credit cost stated |
| `TIER` | `seedance_2_0_mini` draft, `seedance_2_0` standard, `kling3_0` alternate |

---

## Style preambles

Pick one, then reuse it verbatim in every scene prompt. Swap the bracketed slots for the
brand's values.

### Clay diorama (default)

```
Isometric low-poly 3D diorama floating as a small rounded island on a plain solid
[BG_HEX] background with a soft contact shadow beneath it. Soft matte clay 3D render,
rounded toy-model shapes, gentle warm studio lighting, soft long shadows, tilt-shift
miniature look. Cohesive color palette of [PALETTE]. Highly detailed, centered
composition, absolutely no text, no letters, no numbers, no logos.
```

### Alternates

Swap the first two sentences, keep the palette and no-text tail.

- **Flat papercraft**: "Isometric layered paper-craft diorama, matte cardstock, clean
  die-cut edges, subtle drop shadows between layers."
- **Glossy toy**: "Isometric glossy vinyl-toy diorama, smooth plastic shading, soft rim
  light, collectible figurine look."
- **Claymation**: "Isometric stop-motion clay set, visible thumbprints, handmade
  plasticine texture, soft studio softbox light."
- **Neon night**: "Isometric miniature at night, warm interior glow and neon signage,
  moody rim light, wet reflective ground."

### Photoreal architectural (real estate, hospitality, luxury)

```
Ultra-photorealistic architectural photography of a single cohesive [SUBJECT],
cinematic wide-angle, warm golden-hour light, natural materials, restrained designer
furnishings, a breathtaking view, editorial magazine quality, shallow depth of field,
no people, no text.
```

Photoreal changes three things. Drop the floating-island framing and the cutout step, the
scenes are full-bleed (a dark page background reads premium). The dive glides *through
doorways and glass* rather than opening a roof. Cohesion comes entirely from the identical
preamble, so do **not** pass a reference image, it clones the same room instead of matching
the style. Interiors trip the content filter often, budget re-rolls.

---

## Scene still prompt

```
[STYLE PREAMBLE]
Subject: [SCENE.subject: the building or space, a few characters doing the work, the
props that signal this stage of the business].
```

- **Name concrete props.** They anchor the scene: tanks, cauldrons, conveyor, crates,
  awning, string lights, benches, scooters, map pins.
- **Compose for the centre.** Every clip renders `object-fit: cover`. Keep the focal
  subject horizontally centred with a little headroom and nothing essential at the far
  edges. This is not about surviving a crop (mobile gets its own portrait chain), it is
  that the camera dives toward the focal point, so the focal point needs to be where the
  camera is going.
- **Hero scene**: for the final one, drop the island framing and prompt a single oversized
  product centrepiece floating on the same background with a few small orbiting props.
- Params: `aspect_ratio: "3:2"`, `resolution: "2k"`, `quality: "high"`.

---

## Leg prompt: architecture A, continuous forward take

`start_image` = the previous leg's **actual last frame**. Leg 0 uses the first scene's
still. **No end image.**

The bolded clauses are the motion handoff contract. Keep them verbatim. The mid-leg move
is where the expression goes.

```
Single continuous cinematic camera move, no cuts. **Continue the same slow, steady
forward glide.** [MID-LEG MOVE, optional, from the library below.] The camera moves into
[SCENE i] toward [FOCAL POINT]. **In the final second, settle back into a slow, steady
forward glide toward [the doorway / opening / direction of the next scene].**
[STYLE tail plus PALETTE]. Smooth, graceful, slow motion, subtle parallax. No text, no
captions.
```

### Mid-leg move library

Reversals are safe *inside* a leg, because a leg is one continuous render with no seam in
it. That is why "ease back out" is fine here and fatal at a seam.

| Move | Use for | Phrasing |
|---|---|---|
| Half-orbit | product, luxury | "sweeping in a slow half-orbit around [the hero object], keeping it centered, then continuing past it" |
| Crane-up reveal | scale, atria, campuses | "rising smoothly as the full scale of [the space] reveals below" |
| Low lateral track | production lines, counters, shelves | "tracking low and level alongside [the line], foreground objects sliding past in parallax" |
| Push-in and ease back | craft, detail | "pushing in close to [the craft moment] until it nearly fills the frame, then easing gently back out" |
| Rise and swoop | travel, outdoors | "climbing in a gentle arc over [the terrain], then swooping down toward [the next focal point]" |

**After rendering each leg, look at its last frame before generating the next one.** It
should read as a frame from a calm forward glide: no sideways motion blur, no half-finished
orbit. If it does not, re-roll this leg. A bad handoff frame poisons every leg after it.

---

## Dive prompt: architecture B

`start_image` = the scene still, solid-background version.

```
Single continuous cinematic camera move, no cuts. Begin high and far, looking down at the
whole [SCENE.subject] from outside like a tiny model. The camera slowly glides forward and
descends toward it, sweeping in toward [FOCAL POINT], as if flying inside. As the camera
pushes in, the roof and upper structure gently lift and open away to reveal the warm
interior. [STYLE tail: soft matte clay diorama, tilt-shift miniature, warm light,
[PALETTE]]. Smooth, graceful, slow motion, subtle parallax. No text, no captions.
```

For scenes with no building to open (a field, a plaza, a road), replace the roof clause
with "the camera flies low across [the scene] toward [focal point]".

---

## Link prompt: architecture B

`start_image` = clip i's extracted **last** frame. `end_image` = clip i+1's extracted
**first** frame. Both from the rendered videos, never the stills.

```
Single continuous cinematic camera move, no cuts. The camera smoothly pulls up and back
out of [SCENE i], rising into the sky, then glides forward across the connected miniature
world and arrives above [SCENE i+1], beginning to descend toward it. One connected
miniature world, seamless flowing aerial transition. [STYLE tail plus PALETTE]. Smooth
graceful slow motion. No text, no captions.
```

For the last link into a hero-product finale: "...glides forward and the world dissolves
toward a single giant [PRODUCT] floating in soft [BG] space, arriving in front of it."

---

## Portrait clause (mobile chain only)

Prepend to every prompt in the 9:16 chain, and set `aspect_ratio: "9:16"`:

```
Vertical portrait composition, the scene centered with generous [BG_HEX] space above and
below.
```

---

## Video params by model

| | `seedance_2_0` | `seedance_2_0_mini` | `kling3_0` |
|---|---|---|---|
| mode | `std` | n/a | `std` |
| resolution | `1080p` | `720p` | no such param, `std` gives 720p |
| audio | `generate_audio: false` | `generate_audio: false` | `sound: "off"` |
| duration, legs and dives | 8 | 8 | 10 |
| duration, links | 5 | 5 | 5 |
| aspect_ratio | `16:9`, or `9:16` for the mobile chain | same | same |

Audio defaults to on for all three. Always turn it off: it costs credits, it is wasted
(the page mutes anyway), and `-an` strips it at encode regardless.

---

## Copy per scene

- `eyebrow`: 2 to 4 words, a value-prop label, reads as uppercase.
- `title`: 3 to 6 words, the beat's headline. First scene doubles as the site's hero line,
  last one is the payoff and carries the CTA.
- `body`: one sentence, plain-spoken, written from the visitor's side rather than the
  company's.
- `tags`: 0 to 3 short proof chips, e.g. "Fresh-cooked", "30-min delivery".
