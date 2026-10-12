# Sound design

The fabric is the instrument. Every sound comes from a contact with the
simulated surface, and every parameter is bounded so that random play still
sounds intentional.

## Surface → music

| Input | Musical response | Range / rule |
|---|---|---|
| Horizontal position `u` | Note: 11 regions, ascending through the scale left → right | default D minor pentatonic, D3–D5 (Glass: D4–D6) |
| Vertical position `v` | Timbre brightness (filter cutoff, FM index, partial level) | 0.15 at the hem → 1.0 at the top |
| Strike strength | Velocity: loudness and attack brightness | `0.22 + 0.78·s^0.8`; from pen/touch pressure, or from approach speed for a mouse |
| Stretch (structural strain) | Upward pitch bend of the held tone | `2·tanh(9·strain)` semitones, never above +2 |
| Pull distance | Loudness and openness of the held tone | `1 − e^(−2.4·d)` |
| Drag speed | Brightness / intensity while gliding | `1 − e^(−1.6·v)` (view widths / s) |
| Horizontal position | Stereo pan | ±0.55 |
| Release of a stretch | A release note at the grabbed region | only if the pull exceeded 0.12 units |
| Physical settling | Sympathetic resonance level (root, fifth, octave) | `preset.resonance · √energy`, smoothed over 0.25 s |

The mapping lives in pure functions in `src/music/mapping.ts`, so the same
spot always gives the same note. It's covered by unit tests for every scale
and root.

### Glides without machine-gunning

Sweeping across the sheet re-anchors the grab as the finger slides
(stick-slip). A new note plays only when:

- the region actually changes, with **hysteresis** of 24% of a region (a
  finger resting on a boundary can't flicker), and
- at least **75 ms** have passed since the last note.

Otherwise the membrane is stroked visually and the held tone simply glides
(45 ms portamento). The audio graph also merges same-pitch hits closer than
45 ms.

### Scales (Studio)

Minor pentatonic (default), major pentatonic, Hirajoshi and Dorian, on any
root. All are forgiving. There is no chromatic mode by design.

## Voices

**Pluck** (`PluckVoice`): a two-operator FM pair (modulator : carrier ratio
per preset) whose index falls quickly after the attack, so the transient is
complex and the tail pure. Ether and Silk double the carrier, detuned, for
chorus. One or two additive partials add shimmer, each decaying faster than
the fundamental, and a 2 ms burst of band-passed noise gives the "touch". All
of it goes through a lowpass that opens on the attack and settles, then a
stereo panner, then a VCA used only for click-free stealing.

**Sustain** (`SustainVoice`): the bowed tone under a stretch or glide. A
detuned oscillator pair with vibrato, through a resonant lowpass. Pitch,
bend, loudness and cutoff all move with `setTargetAtTime`, so it glides and
swells without zipper noise or clicks.

**Resonance** (`ResonancePad`): a quiet low root/fifth/octave that rises and
falls with the measured motion energy of the membrane. It's never triggered
by notes, so it can't retrigger. You hear the body of the instrument ring
while it physically settles.

## Mix

`voices → voice bus → { dry, convolution reverb (crossfaded A/B), feedback
delay with lowpass in the loop } + resonance → master → mute → compressor →
soft clipper (transparent below 0.7, saturating at 0.98) → output (+ recorder)`

The reverb impulse response is generated procedurally: seeded stereo noise
under an exponential decay that darkens over the tail. Switching presets
crossfades between two convolvers, so nothing clicks or cuts off.

## Presets

| | Glass (default) | Silk | Ether |
|---|---|---|---|
| Character | crystalline, bell-like pluck, shimmering tail | warm, airy, soft attack | spacious, slow, long |
| Register | +1 octave (D4–D6) | D3–D5 | D3–D5 |
| FM ratio / index | 3.5 / 2.2 (inharmonic glint) | 1 / 1.1 (warm) | 2 / 0.8 (hollow) |
| Attack / decay | 2 ms / 2.8 s | 30 ms / 3.4 s | 160 ms / 6.5 s |
| Chorus | — | 7 cents | 11 cents |
| Held tone | sine pair, 2.6 kHz | triangle pair, resonant 1.5 kHz | sine pair, slow vibrato |
| Reverb | 3.2 s, 38% | 3.8 s, 42% | 6.5 s, 60% |
| Delay | 360 ms, 28% fb | 420 ms, 22% fb | 620 ms, 38% fb |
| Fabric rings for | 1.25 s | 1.6 s | 2.3 s |

Studio controls scale these: volume, reverb, attack (0.4–3×), decay
(0.4–2×), and ringing (how long the membrane visibly vibrates, 0.3–2.5×).

## Measurements (not taste)

`npm run samples` renders the showcase phrase per preset through the real
`AudioGraph` in Chrome's `OfflineAudioContext` and measures it. Latest run:

| Preset | Peak | RMS | First-note spectral centroid | Final note, 2.5 s later |
|---|---|---|---|---|
| Glass | −5.9 dBFS | −24.4 dBFS | 787 Hz (on F4) | −44.6 dB |
| Silk | −7.9 dBFS | −25.2 dBFS | 279 Hz (on F3) | −42.7 dB |
| Ether | −5.7 dBFS | −23.3 dBFS | 215 Hz (on F3) | −13.3 dB |

So the presets sit within about 2 dB of each other, with 6–8 dB of headroom,
and they differ clearly in brightness and decay. A recording made in the
browser while playing peaked at −10.9 dBFS (mean −23.8 dBFS).

**Honest note:** these numbers come from signal analysis. Whether the
instrument sounds *beautiful* still needs a human to listen; the samples are
in `docs/audio/`.
