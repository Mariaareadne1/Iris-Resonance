# Progress

Live log of the Iris / Resonance build. Newest state first.

## Current state

**Live: https://iris-resonance.vercel.app** (Vercel production; the e2e suite passes against it: 48 passed, 3 dev-only skips).

Feature-complete and verified. All of the brief's completion criteria are
checked below with their evidence. The remaining items are a live deployment
(needs a fresh Vercel login) and a human listening pass.

## Completed milestones

| Commit | Milestone |
|---|---|
| `7dca56a` | Project initialized (Vite + React + TS + Three.js, Vitest, Playwright, MIT notices) |
| `7212832` | Membrane physics: adapted Verlet cloth + wave field, pluck / grab / strain API, 11 tests |
| `272e53a` | Web Audio engine, presets, surface → scale mapping, 23 tests incl. offline rendering |
| `367c399` | Strict-typecheck fix |
| `9593d6a` | Playable instrument: rendering, gesture controller, input, UI, showcase, capture |
| `469aad6` | Solver performance 14.5 → 4 ms/frame; gesture controller tests |
| `2531945` | 17 Playwright tests in real Chrome; glide feel fixes; MP4 conversion script |
| `a77e3d6` | Realistic unit-test timeout for simulation-heavy tests |
| `5fc3cba` | Design refinement: soft folds, reflection-led shading, gentler stretch |
| `96bb06f` | Cleaner creases (render smoothing, checkerboard mesh, stiffer bends), samples, preview images |
| *(this commit)* | Docs, deploy config, env-driven OG URL |

## Working features

- One holographic membrane; idle breathing (off under reduced motion)
- Pluck: local impulse + travelling wave + note (pitch by region, velocity by strength, timbre by height)
- Stretch: stick-and-pull outward with a swelling, bending sustained tone; release note on snap-back
- Glide: stick-slip sweep with hysteresis and note-rate limiting
- Sympathetic resonance tied to measured membrane energy
- Presets Glass / Silk / Ether; Studio (scale, root, volume, reverb, attack, decay, tension, responsiveness, ringing, iridescence, background, reduced motion)
- Sound button mirrors the real AudioContext state; mute
- Keyboard play (A … '), clean view (C), Esc
- Fabric colour: 6 palettes + custom colour (Studio), `?fabric=` URL parameter
- Showcase demo (~14 s) on the real gesture API, replayable and interruptible
- PNG export, WebM/MP4 recording with audio, `npm run to-mp4`
- `?embed=1` portfolio mode; responsive desktop and mobile layouts
- Favicon, Open Graph / X card image, `vercel.json`

## Tests executed (latest)

- `npm test`: 52 / 52
- `npm run test:e2e`: 57 / 57 across Chromium, Firefox, WebKit (dev); `E2E_PROD=1` (Chromium): 16 passed + 1 dev-only skip
- `npm run build`: passes
- Recording decoded with ffmpeg: VP9 + Opus, audio peak −10.9 dBFS
- Preset measurements: see docs/sound-design.md

## Fixes driven by verification

- Soft clipper added after the compressor (240-note stress test peaked at 1.26)
- Monolithic solver deoptimized in V8 → split into small methods (3.6× faster)
- Glide misread as stretch at moderate speed → kinetic-friction slip and overreach slip
- Jagged stretch creases → peaked grab, outward membrane pull, wave damping under the finger, displacement smoothing, checkerboard triangulation, stiffer bends
- Weave normal map aliased into stripes → removed
- Resting sheet read as a "card" → soft folds, reflection-led shading
- Code review (8 medium/low findings, all fixed): resonance pad silenced in hidden tabs, deferred preset crossfade, WebGL context released on dispose, touch resumes a suspended context, guard reset ends the gesture, demo/pointer race, re-entrant recording start, AudioEngine dispose guard
- Mobile icon buttons lost accessible names → visually-hidden labels
- Cross-browser: first touch silent in Firefox/Safari → notes schedule while the context starts; WebKit WebM recordings truncated → Safari records MP4
- Default volume 0.8 → 0.7 for headroom on hard overlapping plucks
- Ladder glints at extreme folds → render mesh refined 2× from the simulation grid (Catmull-Rom); physics cost unchanged, 60 fps

## Known issues / limitations

- node-web-audio-api mis-renders future-scheduled oscillator automation. Unit tests avoid it, and glides plus samples are verified in Chrome.
- Tested in Firefox and Playwright WebKit, but not in the shipping Safari app, on iOS, or on real touch hardware.
- The local Homebrew ffmpeg is broken (missing `libx265.216.dylib`); the project uses `ffmpeg-static` instead.

## Next steps

2. A human listening pass on all three presets (docs/audio/*.m4a), then retune by ear.
3. Check recording in the shipping Safari app and on an iPhone.
