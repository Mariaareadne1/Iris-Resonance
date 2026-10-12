# Architecture

Iris / Resonance is a frontend-only Vite + React + TypeScript app. React only
draws the interface. Everything that runs every frame (physics, gesture
handling, audio parameter updates, rendering) lives in plain TypeScript
classes owned by `Instrument` and never goes through React state.

```
src/
  physics/       restPose · cloth (Verlet) · waveField · membrane (facade)
  music/         scales · mapping (pure surface → note functions, quantizer)
  audio/         reverb (IR) · voices · graph (signal graph) · engine (lifecycle)
  interaction/   gestureController (the hub) · pointerInput · keyboard
  rendering/     stage · holoMaterial · backdrop · visualState · textures
  showcase/      demo (scripted performance on the real API)
  capture/       recorder (MediaRecorder) + download helpers
  presets/       sound presets · studio settings → subsystem parameters
  app/           instrument (owns the frame loop and every subsystem)
  components/    React UI
```

## One frame

```
requestAnimationFrame (renderer.setAnimationLoop)
  └─ Instrument.tick(dt ≤ 50 ms)
       ├─ Showcase.update        (only while the demo plays: calls the controller)
       ├─ Membrane.step           cloth substeps @120 Hz · wave substeps @240 Hz · compose
       ├─ GestureController.update
       │     ├─ audio: sustain voice params from strain / pull / speed (setTargetAtTime)
       │     ├─ audio: sympathetic resonance level from measured membrane energy
       │     └─ VisualState.update (attack, pitch, energy, sustain, touch glow)
       └─ Stage.render            positions + per-vertex wave/strain → GPU, uniforms, post
```

## One gesture

```
pointerdown on canvas
  └─ PointerInput: raycast the *deformed* mesh → surface point (u,v) + world point
       └─ GestureController.press(point, strength)
            ├─ Membrane.pluckAt     wave-field strike + cloth impulse along the normal
            ├─ AudioEngine.pluck    note = f(u), velocity = f(strength), timbre = f(v), pan = f(u)
            ├─ VisualState.onNote   attack swell, pitch colour, touch halo
            └─ Membrane.beginGrab   hold the fabric in case this becomes a pull
pointermove
  └─ PointerInput: drag-plane target + raycast the *rest* mesh (what lies under the finger)
       └─ GestureController.drag(target, over, speed)
            ├─ stick: membranePull (lateral → outward lift), clamp to the pull limit,
            │         sustain starts after a small threshold, bend = f(strain)
            └─ slip:  fast travel, overreach, or already sliding → re-anchor the grab;
                      a region change (with hysteresis, ≥ 75 ms apart) plays a glide note
pointerup
  └─ GestureController.release → endGrab (snap-back strikes the wave field),
       sustain release, release note if the stretch was real
```

Pointer input, the keyboard and the showcase all drive the same controller
methods (`press`, `drag`, `release`, `pluck`, `playRegion`). That's why the
demo is a genuine performance and not a canned animation.

## Physics

### Cloth (`physics/cloth.ts`, adapted from Iris Cloth / Holocloth)

Kept: position-based Verlet integration, distance constraints (structural 1.0,
shear 0.85, bend), the weighted multi-vertex grab, the fixed-substep
accumulator with a frame-delta clamp.

Changed:

- **Rest lengths come from the sculpted rest pose** (`restPose.ts`), so the
  resting shape is an exact equilibrium. The sheet always comes home.
- **Home spring** (`tension`): every vertex is pulled toward a target shape,
  slightly firmer at the hem. This makes it a tensioned membrane rather than
  free-floating gel. The target drifts slowly along the normals for idle
  "breathing", with no audio and switched off under reduced motion.
- **Low viscosity**, so motion rings instead of dying instantly.
- **Displacement-space Laplacian smoothing.** Iris Cloth smoothed raw
  positions, which flattens a sculpted shape. Smoothing the displacement from
  home removes grid-scale buckling and keeps the shape.
- **Stiffer bend constraints** (0.8) keep creases wider than a grid cell.
- **Peaked grab falloff** (smoothstep^1.6): the fingertip holds firmly and the
  constraints shape a smooth tent around it instead of a rigid disk.
- **Guards:** non-finite state resets the sheet; any vertex further than 1.6
  units from rest is clamped and its velocity zeroed.
- **Performance:** the solver is split into small monomorphic methods
  (`integrate`, `pullHome`, `smoothDisplacement`, `relax`, `applyGrab`). The
  original monolithic substep ran deoptimized in V8. Grid is 61×39 with 6
  iterations: about 4 ms/frame measured in Chrome on an M2 Pro under heavy load.

### Waves (`physics/waveField.ts`)

A damped 2D wave equation on the same grid,
`∂²h/∂t² = c²∇²h − ω₀²h − damping`, Verlet at 240 Hz, edges pinned like a
drumhead. A pluck is a Gaussian velocity impulse. The decay time constant is
tied to the active sound preset (`ring`), so what you see and hear fade
together. The field is damped under a held finger, since a pressed membrane
doesn't ring there. Amplitude is clamped.

### Composition (`physics/membrane.ts`)

`Membrane` combines both. The rendered surface is the cloth shape, lightly
smoothed (two Jacobi passes that cancel grid-scale zig-zags in tight creases),
plus `h × normal`. It exposes the musical-gesture API used by the controller
and the tests: `pluckAt`, `beginGrab`, `updateGrab`, `endGrab`,
`getLocalDisplacement`, `getLocalVelocity`, `getLocalStrain`, `energy`,
`reset`.

## Audio

See [sound-design.md](sound-design.md). The structure:

- `AudioGraph` builds the whole signal graph on any `BaseAudioContext`, so it
  renders identically live and in an `OfflineAudioContext` (tests, samples).
- `AudioEngine` owns the lifecycle. It creates the context only inside a user
  gesture, follows its real `state` (the UI shows `running` / `suspended`
  truthfully), resumes after tab switches, releases held tones when hidden,
  and exposes a post-limiter `MediaStream` for recording.
- Voices are one-shot node chains that disconnect themselves when they end.
  At most 10 plucks sound at once (the oldest are stolen with a 25 ms fade).
  Re-plucking a ringing pitch damps the old one, and same-pitch hits within
  45 ms merge.

## Rendering

`Stage` owns the renderer (antialias off, with MSAA on the composer's
half-float target), a fitted camera with gentle pointer parallax, three
coloured directional lights plus `RoomEnvironment` IBL, and post-processing
(bloom, output/tone-mapping, film grain). The material is the Iris Cloth
holographic `MeshPhysicalMaterial` (thin-film iridescence, sheen, clearcoat,
injected diffraction flakes), extended with:

- `aWave` (per vertex, from the wave field) → luminous travelling ripples
- `aStrain` (per vertex, from the cloth) → a pale sheen where pulled taut
- `uTouch*` → a halo at the contact point
- `uPitch` → hue leans violet for low notes and cyan for high
- `uAttack`, `uEnergy` → a brief swell per note and a shimmer while ringing
- rounded-corner cutout and a soft hem light

The backdrop is drawn in-scene (one full-screen triangle), so it appears in
PNG exports and video recordings. Its glow follows pitch and membrane energy.
The mesh uses a checkerboard triangulation so creases render cleanly in any
direction.

## React and state

`App` creates one `Instrument` in an effect and subscribes to coarse state
only: audio status, demo, recording, interaction, clean view, messages.
Studio settings live in React state and are pushed through
`Instrument.applySettings`, which maps them into membrane, music, mix and look
parameters (`presets/settings.ts`). Every Studio control is wired to something
real.

## Lifecycle and cleanup

`Instrument.dispose` stops the animation loop and any recording, removes
pointer/keyboard/visibility listeners, stops voices and the resonance pad,
closes the `AudioContext`, and disposes geometry, materials, textures, render
targets and the renderer. A `ResizeObserver` keeps the canvas and camera
fitted, including inside iframes.

## URL flags

| Flag | Effect |
|---|---|
| `?embed=1` | Compact portfolio embed (see README) |
| `?debug=1` | Exposes `window.__iris` for tests and diagnostics (always on in dev) |
