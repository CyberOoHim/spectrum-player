# Cozy Atmosphere Visualizers

| Field | Value |
|---|---|
| **Status** | Kernel + Ember Hearth proof shipped. Remaining four scenes parked until hearth is accepted in the player. |
| **Default visualizer** | `bars` (3D Bars). Atmosphere is opt-in. |
| **Family** | Lumina Lava (existing) + five cozy scenes beside it |
| **Proof scene** | Ember Hearth (`hearth`) |
| **Later alternate** | Candle Cluster — only if hearth fails the cozy bar |

This is the scene family plan. The original player architecture lives in [plan.md](plan.md) and is not replaced by this document.

---

## Goal

Add **five hyper-realistic, lively atmosphere modes** that feel cozy, relaxing, and healing. Each mode is a small physical place that *lives with the music*, not another abstract EQ.

Existing spectrum modes (`bars`, `radial`, `particles`, `orb`, `2d`) stay. Lumina Lava stays as the first atmosphere scene. These five sit beside it as a new **Atmosphere** family.

---

## Why this shape

Lumina Lava already proved the product direction: a staged object (brass lamp, glass, wax physics) driven by bass / mid / treble, with orbit camera, reduced-motion freeze, and dynamic pixel-ratio degrade.

The new modes reuse that contract. They do **not** go into `spectrum-3d.ts` (already crowded with bars / radial / particles / orb). Each is a dedicated scene class, same as `LavaLamp`.

What “hyper-realistic and lively” means here:

- **Hyper-realistic**: materials, light, and volume that read as a real room or landscape (procedural textures + shaders, not downloaded HDRIs or GLTFs).
- **Lively**: the scene is always breathing — fire, rain, water, leaves, fish — even when the track is quiet.
- **Healing**: motion is organic and heavily smoothed. No strobe, no club lasers, no sudden camera cuts.

---

## Review decisions

| Question | Decision |
|---|---|
| Scope now | Scene kernel + **Ember Hearth only**, as a proof |
| Default visualizer | Stay **3D Bars**. Atmosphere is opt-in |
| Other four scenes | Parked until hearth is seen in the player |
| Candle cluster | Kept as a later alternate, not the proof |
| Hyper-realism bar | Lava-lamp class: staged, tactile, shader-lit — not photogrammetry |

If hearth hits the bar, rain / tide / grove / pond follow on the same kernel. If it does not, stop and revise the look before any other scene work.

---

## The five proposed modes

### 1. Ember Hearth — `hearth`

**Status:** implemented as the proof (`src/viz/scenes/hearth.ts`).

An open night campfire you can walk around. A pile of oak logs on dark earth, no fireplace walls — just a living fire, coals, and rising sparks under a night sky.

| Layer | What you see | Audio |
|---|---|---|
| Bass | Flame height, tongue lean, heat bloom on the ground | Slow swell |
| Mid | Log glow, ember swirl, wood-crackle texture | Texture |
| Treble | Fine sparks spraying into the night | Sparkle |
| Idle | Low flame and occasional ember pop | Always on, quieter when paused |

**Why this one:** highest “cozy” signal. Closest sibling to lava (heat, volumetric glow). First scene after the shared kernel.

**Technique:** stacked log meshes with canvas-generated bark; raymarched fire volume with dancing tongues; point lights that pulse with bass. Full 360° orbit.

The expanded proof spec is in [Ember Hearth, explained](#ember-hearth-explained).

---

### 2. Rainlight Window — `rain`

**Status:** parked.

Looking out a rain-streaked cabin window at night. Condensation, droplets with refraction, a wet sill, distant forest or porch lights in fog.

| Layer | What you see | Audio |
|---|---|---|
| Bass | Fog thickness, distant light bloom, glass flex | Atmosphere |
| Mid | Rain density, streak speed, drip cadence | Weather |
| Treble | Droplet highlights, new droplet births, lightning-far flicker (very rare, never white flash) | Sparkle |
| Idle | Soft rain and slow condensation crawl | Always on |

**Why this one:** strongest “healing / stay-in” feeling. Indoor safety + outdoor weather. Distinct from hearth (cool palette, glass, water).

**Technique:** fullscreen glass shader (normals from noise + spawned droplets); background as a cheap depth plane with fog; optional mug / candle silhouette on the sill as a static mesh so it still feels like a room.

---

### 3. Moonlit Tide — `tide`

**Status:** parked.

A quiet shoreline at night. Wet sand, foam lace, moonlight path, small waves rolling toward the camera.

| Layer | What you see | Audio |
|---|---|---|
| Bass | Swell height and period | Large, slow |
| Mid | Foam breakup, wet-sand sheen | Texture |
| Treble | Specular sparkles on the moon path | Sparkle |
| Idle | Gentle 8–12s wave cycle | Always on |

**Why this one:** classic regulation / breathing visual. Lively through water, never frantic. Complements rain (open water vs glass).

**Technique:** displaced plane or gerstner-ish shader water; foam via noise + shore distance; moon as a soft disc + bloom; wet sand as a dark PBR plane with high roughness contrast.

---

### 4. Grove Lightwells — `grove`

**Status:** parked.

A small forest clearing. God rays through canopy, floating pollen, a few leaves that lift and settle.

| Layer | What you see | Audio |
|---|---|---|
| Bass | Ray brightness and shaft width | Breath |
| Mid | Leaf rustle, canopy sway | Wind |
| Treble | Pollen / dust motes, sun flicker through leaves | Sparkle |
| Idle | Slow shaft drift and pollen float | Always on |

**Why this one:** the “healing nature” scene. Warm daylight instead of night fire/water, so the five modes are not all dark rooms.

**Technique:** layered billboard / card canopy (no full tree GI); volumetric shafts in a fullscreen or box shader; instanced motes; very slow camera drift, never a fly-through.

---

### 5. Lantern Pond — `pond`

**Status:** parked.

A night garden pond. Lily pads, koi, paper lanterns, fireflies, still water with lantern reflections.

| Layer | What you see | Audio |
|---|---|---|
| Bass | Lantern glow and water-ripple amplitude | Warm pulse |
| Mid | Koi swim speed and path energy | Life |
| Treble | Firefly blinks, water sparkles | Sparkle |
| Idle | Slow koi loops and rare firefly pulses | Always on |

**Why this one:** most *alive* without being energetic. Completes the set: fire, weather, ocean, forest, garden.

**Technique:** planar water with reflection/refraction; 4–8 simple koi (instanced elongated meshes + sine swim); instanced fireflies with additive points; lanterns as emissive paper cylinders.

---

## Later alternate (not in the five)

If hearth fails the cozy bar: **Candle Cluster** (`candle`) — tabletop candles, wax, smoke. Not the first proof.

Closest swaps if any of the parked four are rejected:

| Instead of | Alternate |
|---|---|
| Rain | Snow Cabin Window |
| Tide | Hot Spring Steam (onsen, rock, mist) |
| Grove | Autumn Window Seat |
| Pond | Terrarium (glass box, moss, tiny ferns) |

---

## Shared feel rules (all five)

These are non-negotiable so the family reads as one product:

1. **Heavy smoothing.** Band energy is lerped (similar to lava’s `0.14–0.22` smoothers). Onsets create a breath, not a jump.
2. **Idle life.** When paused, the scene keeps a quieter idle loop. The room does not die.
3. **No camera violence.** Orbit damping stays. Auto-rotate is slow. Reduced motion freezes simulation and orbit, leaves a still frame.
4. **Palette remaps, does not flatten.** `mood` / `spectrum` / `mono` shift temperature and accent color. They do not turn the fireplace into neon bars.
5. **One scene at a time.** Switching modes destroys the previous WebGL scene (same as lava today).
6. **Healing motion budget.** No strobe, no full-screen flashes, no sudden FOV changes.

Suggested default mapping for every scene:

```
bass   → large, slow volume (heat, swell, fog, shafts, lanterns)
mid    → medium texture (embers, rain, foam, leaves, koi)
treble → small sparkle (sparks, droplets, glitter, motes, fireflies)
energy → overall brightness / density, never hue-disco
```

---

## Ember Hearth, explained

### What you are looking at

A **close, slightly low camera** on an open campfire at night. You are sitting by the pile, not looking into a fireplace.

The frame is a shallow outdoor stage:

```
              night sky / faint stars
                 rising sparks
              volumetric fire tongues
           oak log pile + glowing coals
         ash bed on dark earth / sand
              warm ground glow
```

You should be able to read **five physical things** without a label:

1. **Log pile** — split oak logs stacked in a nest, bark, char, and embers in the cracks.
2. **Fire volume** — a living body of flame with dancing tongues, not a sprite sheet and not neon ribbons.
3. **Embers and sparks** — coals in the bed; sparks lift and spray into the night.
4. **Ground light** — the fire is the lamp. Dark earth takes that light.
5. **Open air** — no brick surround, no firebox walls. The pile can be seen from every side.

Camera sits about where a person by the fire would look: slightly off-center, eye height just above the logs. Full 360° orbit is the point; it never goes under the ground.

### How it should feel

- **Cozy:** warmth, night, a small bright fire on dark earth.
- **Lively:** the flame has weight. Logs breathe. A spark lifts and dies. The fire never freezes unless reduced motion is on.
- **Healing:** the fire *breathes* with the music. Bass is a slow inhale of heat. Treble is a few sparks. Nothing jumps, flashes white, or beats like a club light.

Think “sitting by a campfire with a record on,” not “festival VJ fireplace.”

### What the music does

Band energy is smoothed the same way lava already does (`~0.14–0.22` lerps, plus a short heat pulse on onsets). Sensitivity still scales the input.

| Audio | Fire | Why this is healing |
|---|---|---|
| **Bass** | Flame height and thickness. Heat bloom on the ground. Point-light intensity. | Large and slow. The whole fire inhales. |
| **Mid** | Ember bed brightness. Log-crack glow. A few coals shift. | Texture, not size. Wood feels alive. |
| **Treble** | Spark birth rate and spray. Tiny flame-edge flicker. | Sparkle only. Never a full-screen flicker. |
| **Onset** (kick / swell) | A short extra lift in the flame, then it settles. | One breath, then decay. No strobe. |
| **Paused / idle** | Low flame, occasional ember, rare spark. | The room stays alive. It just gets quieter. |
| **Reduced motion** | Still photograph: lit logs, frozen flame shape, no orbit. | Comfort first. |

`sceneSpeed` (generalized from `lavaSpeed`) scales simulation rate, default `0.8`. The drawer slider is labeled **Fire breath** while hearth is active.

Palette remaps **temperature**, not the object:

- `mood` (default-friendly for hearth) — amber / rose coals, cooler night shadow.
- `spectrum` — fire still reads as fire; spectrum only tints the hottest core and sparks along the band.
- `mono` — classic wood-fire orange, no hue travel.

Palette must not turn the fireplace into cyan bars or a rainbow wall.

### What it is not

- Not a 2D looped video of a fireplace.
- Not particles that look like a sparkler or a galaxy.
- Not the lava lamp with a brick texture.
- Not a boxed fireplace insert and not a living-room interior. The campfire pile *is* the scene.
- Not the candle-cluster alternate.

### How it is built (proof scope)

Same class of work as `LavaLamp`: one Three.js scene, procedural textures, one or two shaders, no downloaded assets.

| Piece | Implementation |
|---|---|
| Stage | Dark earth disc + night sky dome. Canvas-generated sand / ash map (same idea as lava’s brass maps). |
| Logs | 6–7 tapered cylinders stacked as an open nest. Bark+char canvas map. Emissive driven by mid. |
| Flame | A centered raymarched volume with several dancing tongues. Noise + upward advection. Bass scales height and lean. |
| Coals | Small instanced spheres / blobs in the ash bed. Mid drives emissive. |
| Sparks | Additive points, tens to ~80. Treble + onsets spray them into the night. |
| Light | One key point light in the pile, one low fill on the ground, dim cool ambient. Intensities follow smoothed bass. |
| Camera | OrbitControls, damped, framed on the pile. Full azimuth. Polar angle locked so you cannot go under the ground. |

No GLTF, no HDRI files. `RoomEnvironment` PMREM (already used by lava) is enough for brick/log metalness.

### Quality bar for the proof

The proof is done when all of these are true:

1. A quiet track makes the fire breathe. A louder track makes it fuller, not frantic.
2. Pause does not kill the fire; it only settles.
3. Reduced motion leaves a still, pretty hearth.
4. WebGL loss falls back to 2D spectrum (existing path).
5. Slow GPU drops pixel ratio, then spark/coal counts — it never auto-switches hearth to `bars`.
6. Mid-mobile holds 30–60 fps. Desktop holds ~60.
7. Switching away from hearth destroys the scene (no leaked renderer).
8. Reload restores `hearth` if that was the last mode. First-time / reset users still get `bars`.

---

## Architecture

### Current wiring

```
settings.visualizerMode
  ├─ 2d                         → Spectrum2D
  ├─ bars | radial | particles | orb
                                → Spectrum3D
  └─ lava | hearth              → SceneVisualizer via registry
```

Target after the parked family ships:

```
settings.visualizerMode
  ├─ 2d                         → Spectrum2D
  ├─ bars | radial | particles | orb
                                → Spectrum3D
  └─ lava | hearth | rain | tide | grove | pond
                                → SceneVisualizer via registry
```

Shared contract, extracted from `LavaLamp`:

```ts
interface SceneVisualizer {
  render(bands: Float32Array, settings: AppSettingsV1): void;
  degradeQuality(): boolean;
  destroy(): void;
}
```

### Modules

| File | Role | Status |
|---|---|---|
| `src/viz/scene.ts` | `SceneVisualizer` interface, `atmosphereSpeed`, reduced-motion helper | shipped |
| `src/viz/scene-runtime.ts` | Renderer, OrbitControls, resize, context-loss, ACES, DPR adapt, framing | shipped |
| `src/viz/audio-energy.ts` | Shared bass / mid / treble / energy / onset smoothing | shipped |
| `src/viz/scenes/registry.ts` | `lava` and `hearth` factories today; more later | shipped |
| `src/viz/lava-lamp.ts` | Existing lamp, on the shared runtime (kept at this path) | shipped |
| `src/viz/scenes/hearth.ts` | Ember Hearth | shipped (proof) |
| `src/viz/scenes/rain.ts` | Rainlight Window | parked |
| `src/viz/scenes/tide.ts` | Moonlit Tide | parked |
| `src/viz/scenes/grove.ts` | Grove Lightwells | parked |
| `src/viz/scenes/pond.ts` | Lantern Pond | parked |

`app.ts` holds `vizScene: SceneVisualizer | null`. Atmosphere degrade calls `vizScene.degradeQuality()` first.

### Settings

No storage key bump.

- Add `'hearth'` to `visualizerMode` now; add `'rain' | 'tide' | 'grove' | 'pond'` when those scenes ship. Unknown modes still fall back to `'bars'`.
- `lavaSpeed` → `sceneSpeed` (0.1–1.5, default 0.8). Load old `lavaSpeed` if present.
- Default `visualizerMode` stays `'bars'`.
- Drawer slider visible for atmosphere modes. Label: “Lava lamp flow” vs “Fire breath” (and scene-specific labels later).

### UI

Mode select uses groups:

```
Spectrum
  3D Bars
  3D Radial
  3D Particles
  3D Shader Orb
  2D Canvas
Atmosphere
  Lumina Lava
  Ember Hearth
  Rainlight Window      (parked)
  Moonlit Tide          (parked)
  Grove Lightwells      (parked)
  Lantern Pond          (parked)
```

Host class: `atmosphere-stage` plus `data-scene="hearth"` (and later `rain` / `tide` / `grove` / `pond`) so the canvas-host background can match the room without a flash of the spectrum accent.

### Assets

No new npm deps. No photos, HDRIs, or GLTFs. All maps are canvas-generated at runtime, same as lava brass.

---

## Performance and comfort

Same budget as lava.

| Device | Target |
|---|---|
| Desktop | 60 fps |
| Mid mobile | 30–60 fps, start at lower DPR |
| Hidden tab | rAF stopped |
| Reduced motion | freeze sim + orbit; still frame remains |

Atmosphere degrade ladder:

1. Drop pixel ratio.
2. Drop scene-specific extras (spark/coal count, droplet count, koi count, mote count, water tessellation, flame raymarch quality).
3. Stay on the atmosphere scene. Do **not** auto-switch to `bars`.

`particles` / `orb` keep their existing “fall back to bars” path. That path does not apply to atmosphere scenes.

---

## Implementation order

### PR 1 — Scene kernel + lava migration — done

Extract the runtime, move lava onto it, generalize `lavaSpeed` → `sceneSpeed`, update settings tests. **Exit:** lava is visually unchanged.

### PR 2 — Ember Hearth proof — code shipped, look still under review

Add `hearth`, optgroup, fire-breath slider, stage CSS, settings persistence, degrade + 2D fallback. **Exit:** the quality bar above is met in the running player.

Then stop. Review hearth in the player before rain / tide / grove / pond.

### PR 3 — Rainlight Window + Moonlit Tide — not started

Water family. Shared water/glass helpers if they stay small; do not force a mega-shader.

### PR 4 — Grove Lightwells + Lantern Pond — not started

Nature family. Completes the five.

### Tests

- Settings: `hearth` persists; unknown still → `bars`; `lavaSpeed` still loads as `sceneSpeed`; default remains `bars`.
- Registry: registered atmosphere ids construct.
- No shader unit tests.

---

## What we are not doing

- Not implementing rain, tide, grove, pond, or candle cluster until hearth is accepted.
- Not changing the default mode to hearth.
- Not replacing lava or any spectrum mode.
- Not adding video, webcam, or AI frames.
- Not adding camera shake or beat-drop cuts.
- Not putting these scenes inside `spectrum-3d.ts`.
- Not bundling photos, HDRIs, or GLTFs.
- Not changing playback, library, or PWA behavior.
- Not rewriting [plan.md](plan.md) or [3d-spectrum-player.md](3d-spectrum-player.md).

---

## Success

A reviewer can sit with a quiet track, switch through the family, and feel:

- they are in a small safe place
- the place is alive, not a wallpaper
- the music is felt as weather / heat / water / wind, not as a graphic equalizer
- nothing startles
- low-power devices still get a still, pretty room rather than a crash or a bar graph

For the current proof, that review is Ember Hearth only.
