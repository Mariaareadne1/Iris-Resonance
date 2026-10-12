# Testing

Two layers. Neither treats "it compiled" or "a button received a click" as
proof. Tests measure physical displacement, strain, signal levels, pitches and
decoded media.

## Unit tests — Vitest (`npm test`)

45 tests in `tests/unit/`, run in Node.

**Physics** (`physics.test.ts`, 11):
- the rest pose is an equilibrium; a still sheet stays still
- a pluck displaces the contact region more than 5× the far side
- displacement propagates outward: a ring 14–18 cells away grows after the strike
- stronger plucks displace more than 2× weaker ones
- vibration decays below 2% of its energy and returns near rest
- grab and stretch: the grabbed point follows the target, neighbours lag, strain rises
- release recovers with no NaNs
- 200 rapid plucks and violent grabs stay finite and bounded, then settle
- NaN / negative / huge frame deltas and invalid input are ignored
- reset restores the rest pose exactly; mismatched rest poses are rejected

**Musical mapping** (`mapping.test.ts`, 11): the default layout is exactly
D3 F3 G3 A3 C4 D4 F4 G4 A4 C5 D5; same region → same note; left → right
ascends; every note is in scale for every scale × root; out-of-range input
clamps; every continuous control stays in its range (including NaN and ±∞);
bend is monotonic and capped at 2 semitones; slow drags visit each region
once; boundary jitter never retriggers; fast jumps land directly.

**Gestures** (`gesture.test.ts`, 10), with a recording sound double: a tap is
exactly one in-scale note and no sustain; stronger taps are louder *and*
displace more; a slow pull becomes one sustained tone whose bend rises within
limits with no extra notes; releasing a stretch plays a release note and ends
the tone; if the solver's runaway guard resets the sheet mid-stretch the gesture ends cleanly; a fast sweep plays strictly rising notes, at most one per region;
2 s of frantic jitter on a boundary produces 4 notes or fewer; keyboard regions
equal the playable notes; resonance follows physical energy and settles; visual
signals respond and decay.

**Audio** (`audio.test.ts`, 13): the real `AudioGraph` rendered into an
`OfflineAudioContext` from
[node-web-audio-api](https://github.com/ircam-ismm/node-web-audio-api) and
measured. A pluck has real energy, starts from silence and never clips. Four
surface regions are detected (Goertzel) at exactly their expected MIDI
pitches. The envelope attacks and decays below 20%. Voices terminate and free
their nodes. The three presets differ spectrally. 240 full-velocity notes in
2 s keep the peak ≤ 0.98, and every voice ends. Same-pitch hits within the
guard merge. No more than 10 live voices. Mute is silent. The held tone keeps
its pitch, has no release spike and decays. A stretch bend of +2 shifts the
detected pitch by 2 semitones. The resonance follows energy and stays quiet. A second preset switch inside the reverb's fade window is deferred rather than clicking.

> node-web-audio-api mis-renders `OscillatorNode.frequency` (and the held
> tone's gain) when a `setTargetAtTime` is scheduled in the future. Chrome
> renders the same graph correctly, which we verified side by side. Live
> playing always schedules at "now", so the app is unaffected. Pitch glides
> are therefore tested in real Chrome (below), and `npm run samples` renders
> in Chrome too.

## Browser tests — Playwright (`npm run test:e2e`)

17 tests in `tests/e2e/`, real Chromium on the GPU (Metal on Apple Silicon;
set `E2E_SWIFTSHADER=1` for software WebGL elsewhere, which is much slower).
`window.__iris` (enabled by `?debug=1`) exposes read-only probes. Audio level
is measured with an `AnalyserNode` on the final mix; rendering is checked by
reading pixels back from the WebGL frame.

| Test | Verified |
|---|---|
| Opens into play mode | title, subtitle, hint; WebGL frame is lit and varied (pixel readback); audio **off** (no autoplay); no page errors |
| Click plucks | `AudioContext` reaches `running`; 1 note; mesh displacement > 0.01; **output level > 0** from the analyser; Sound button `aria-pressed=true`; hint fades |
| Repeatability | the same spot twice gives the same note; right is higher than left |
| Slow drag | phase `stretching`, `stretch-start` event, displacement > 0.3, strain > 0, audible held tone; release event; settles below 0.08 within 3.5 s |
| Quick sweep | at least 3 strictly rising notes |
| Presets | Silk / Ether / Glass switch the engine and each plays audibly |
| Mute | no new notes, output silent, fabric still moves; unmute restores sound |
| Reset | displacement > 0.1 while held → < 0.05 after Reset |
| Keyboard | A / H / ' play rising notes and start audio |
| Studio | root A + major pentatonic → the lowest key plays an A |
| Save image | PNG signature, ≥ 2560×1600, > 200 KB |
| Record video | WebM with **video and audio streams**, decoded end to end by ffmpeg, peak > −40 dBFS, extension matches MIME |
| Showcase | ≥ 4 plucks, a stretch, a glide, a release; ends by itself; replay; interrupted by touching the fabric |
| Embed | no title or studio; fabric touch stays **silent** but plays visually; Sound button starts audio |
| Iframe | canvas resizes to 640×360; mouse wheel over the embed scrolls the host page |
| Touch (390×844) | a tap plucks; the dock fits the screen |
| Glide in Chrome | `OfflineAudioContext` render of a held tone: D4 then A4 detected (dev server only) |

## Latest results (2026-10-12, Apple M2 Pro, macOS, Chromium headless on Metal)

- `npm test`: **45 / 45 passed**
- `npm run test:e2e` (dev): **17 / 17 passed**
- `E2E_PROD=1 npm run test:e2e` (production bundle): **16 passed, 1 skipped**
  (the Chrome glide test imports source modules, which only the dev server
  serves)
- `npm run build`: passes; 231 KB gzipped JS (three.js is most of it)
- Recorded file from the e2e run: `vp9 + opus`, 1280×800, 5.7 s, peak
  −10.9 dBFS. `npm run to-mp4` turned it into H.264 High + AAC, 60 fps,
  yuv420p (tv range).
- Performance: 61–62 fps at 1280–1440 px wide; physics + gestures about
  4 ms/frame, measured while the machine had a load average above 100 from
  other processes

## Visual verification

Screenshots taken with `scripts/snap.mjs` and `scripts/og-image.mjs` were
inspected for the initial composition, material, a pluck at 180 ms and 600 ms,
a maximum stretch, the release ring, the Studio panel, mobile and embed
layouts, and showcase contact sheets. Those inspections led to several fixes
(see `PROGRESS.md`).

## Not verified automatically

- **Subjective sound quality.** Not auditioned by a human during development;
  only measured (see sound-design.md).
- Safari and Firefox were not run. Recording falls back to MP4 or reports
  "unsupported" by runtime detection, and that path is untested on those
  browsers.
- Real touch hardware: touch is emulated by Playwright.
