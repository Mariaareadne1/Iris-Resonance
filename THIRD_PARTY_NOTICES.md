# Third-party notices

## Holocloth / Iris (MIT)

Portions of `src/physics/cloth.ts`, `src/rendering/holoMaterial.ts`,
`src/rendering/textures.ts` and `src/rendering/backdrop.ts` (film grain) are
adapted from **Holocloth** by Dmitry Kurash and **Iris** by Maria Showalter.

    Copyright (c) 2026 Dmitry Kurash (original work, "Holocloth")
    Copyright (c) 2026 Maria Showalter (adaptations, "Iris")

Released under the MIT License, reproduced in full in [LICENSE](LICENSE).

## Runtime dependencies

| Package | License |
|---|---|
| [three](https://github.com/mrdoob/three.js) | MIT |
| [react](https://github.com/facebook/react), react-dom | MIT |

Three.js add-ons used (`RoomEnvironment`, `EffectComposer`, `RenderPass`,
`ShaderPass`, `UnrealBloomPass`, `OutputPass`) ship with three under MIT.

## Font

`public/Fraunces-Italic.ttf` — **Fraunces** by Undercase Type (Phaedra
Charles, Flavia Zimbardi), licensed under the
[SIL Open Font License 1.1](https://openfontlicense.org). Redistributed
unmodified with this project, as the OFL permits.

## Development-only tools

Vite, TypeScript, Vitest, Playwright, node-web-audio-api and ffmpeg-static
are used for building and testing only and are not part of the shipped
bundle. `ffmpeg-static` downloads an FFmpeg binary (LGPL/GPL, depending on
build) used by the test suite and `scripts/to-mp4.sh`.
