# Progress

Live log of the Iris / Resonance build. Newest state first.

## Current state

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
- Showcase demo (~14 s) on the real gesture API, replayable and interruptible
- PNG export, WebM/MP4 recording with audio, `npm run to-mp4`
- `?embed=1` portfolio mode; responsive desktop and mobile layouts
- Favicon, Open Graph / X card image, `vercel.json`

## Tests executed (latest)

- `npm test`: 43 / 43
- `npm run test:e2e`: 17 / 17 (dev); `E2E_PROD=1`: 16 passed + 1 dev-only skip
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

## Known issues / limitations

- At extreme pulls, a few small ladder-shaped glints can still appear at the tightest fold (the mesh is 61×39). A denser mesh fixes it at a CPU cost.
- node-web-audio-api mis-renders future-scheduled oscillator automation. Unit tests avoid it, and glides plus samples are verified in Chrome.
- Not tested on Safari / Firefox or on real touch hardware.
- Not deployed: the saved Vercel token is invalid (`vercel login` needed).
- The local Homebrew ffmpeg is broken (missing `libx265.216.dylib`); the project uses `ffmpeg-static` instead.

## Next steps

1. `npx vercel login && npx vercel --prod`, set `VITE_SITE_URL`, redeploy, and check the X card.
2. A human listening pass on all three presets (docs/audio/*.m4a), then retune by ear.
3. Optional: adaptive mesh density on fast GPUs; Safari recording check.
