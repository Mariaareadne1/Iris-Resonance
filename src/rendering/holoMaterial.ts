import * as THREE from 'three';
import { makeGrainRoughnessMap } from './textures.ts';

/**
 * Holographic membrane material.
 *
 * Base and diffraction layer come from Iris Cloth / Holocloth (MIT):
 * MeshPhysicalMaterial thin-film iridescence + sheen + clearcoat, with an
 * injected micro-flake diffraction term whose hue sweeps with view angle.
 *
 * Added for Resonance — the surface answers the sound:
 *  - aWave   (per vertex) vibration energy from the wave field → luminous
 *            ripples that travel with the real displacement
 *  - aStrain (per vertex) stretch → a pale silver-pink sheen where pulled
 *  - uTouch  a soft glow around the most recent contact point
 *  - uPitch  low notes lean violet, high notes lean cyan
 *  - uAttack a brief iridescent swell on each note
 *  - uEnergy overall ringing of the sheet → gentle shimmer
 */
export interface ResonanceUniforms {
  uHoloIntensity: THREE.IUniform<number>;
  uHoloScale: THREE.IUniform<number>;
  uBandFreq: THREE.IUniform<number>;
  uSaturation: THREE.IUniform<number>;
  uHueShift: THREE.IUniform<number>;
  uSparkle: THREE.IUniform<number>;
  uSpecTint: THREE.IUniform<number>;
  uPalMix: THREE.IUniform<number>;
  uPalA: THREE.IUniform<THREE.Color>;
  uPalB: THREE.IUniform<THREE.Color>;
  uPalC: THREE.IUniform<THREE.Color>;
  uHueCenter: THREE.IUniform<number>;
  uHueRange: THREE.IUniform<number>;
  uTime: THREE.IUniform<number>;
  uPitch: THREE.IUniform<number>;
  uAttack: THREE.IUniform<number>;
  uEnergy: THREE.IUniform<number>;
  uTouchUv: THREE.IUniform<THREE.Vector2>;
  uTouchGlow: THREE.IUniform<number>;
  uWaveGlow: THREE.IUniform<number>;
  uCornerRound: THREE.IUniform<number>;
  uClothSize: THREE.IUniform<THREE.Vector2>;
}

export interface ResonanceMaterial {
  material: THREE.MeshPhysicalMaterial;
  uniforms: ResonanceUniforms;
}

export function createResonanceMaterial(): ResonanceMaterial {
  const material = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color('#3b3a5c'),
    metalness: 1.0,
    roughness: 0.18,
    // no weave normal map: at this scale it only aliased into stripes
    roughnessMap: makeGrainRoughnessMap(),
    clearcoat: 0.45,
    clearcoatRoughness: 0.08,
    sheen: 0.5,
    sheenRoughness: 0.5,
    sheenColor: new THREE.Color('#d8ccff'),
    iridescence: 1.0,
    iridescenceIOR: 1.3,
    iridescenceThicknessRange: [160, 520],
    side: THREE.DoubleSide,
  });
  // rounded-corner cutout resolves smoothly under the MSAA target
  material.alphaToCoverage = true;

  const uniforms: ResonanceUniforms = {
    uHoloIntensity: { value: 0.95 },
    uHoloScale: { value: 120 },
    uBandFreq: { value: 1.2 },
    uSaturation: { value: 0.85 },
    uHueShift: { value: 0.6 },
    uSparkle: { value: 0.55 },
    uSpecTint: { value: 0.45 },
    uPalMix: { value: 0.7 },
    uPalA: { value: new THREE.Color('#9d7bff') }, // violet
    uPalB: { value: new THREE.Color('#7fe6ff') }, // cyan
    uPalC: { value: new THREE.Color('#ffc2ea') }, // pale pink
    uHueCenter: { value: 0.66 },
    uHueRange: { value: 0.14 },
    uTime: { value: 0 },
    uPitch: { value: 0.5 },
    uAttack: { value: 0 },
    uEnergy: { value: 0 },
    uTouchUv: { value: new THREE.Vector2(0.5, 0.5) },
    uTouchGlow: { value: 0 },
    uWaveGlow: { value: 1 },
    uCornerRound: { value: 0.07 },
    uClothSize: { value: new THREE.Vector2(3.6, 2.3) },
  };

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);

    shader.vertexShader =
      'varying vec2 vHoloUv;\nattribute float aWave;\nattribute float aStrain;\nvarying float vWave;\nvarying float vStrain;\n' +
      shader.vertexShader.replace(
        '#include <uv_vertex>',
        '#include <uv_vertex>\n\tvHoloUv = uv;\n\tvWave = aWave;\n\tvStrain = aStrain;',
      );

    shader.fragmentShader =
      /* glsl */ `
      varying vec2 vHoloUv;
      varying float vWave;
      varying float vStrain;
      uniform float uHoloIntensity;
      uniform float uHoloScale;
      uniform float uBandFreq;
      uniform float uSaturation;
      uniform float uHueShift;
      uniform float uSparkle;
      uniform float uSpecTint;
      uniform float uPalMix;
      uniform vec3 uPalA;
      uniform vec3 uPalB;
      uniform vec3 uPalC;
      uniform float uHueCenter;
      uniform float uHueRange;
      uniform float uTime;
      uniform float uPitch;
      uniform float uAttack;
      uniform float uEnergy;
      uniform vec2 uTouchUv;
      uniform float uTouchGlow;
      uniform float uWaveGlow;
      uniform float uCornerRound;
      uniform vec2 uClothSize;

      float holoHash(vec2 p) {
        vec3 p3 = fract(vec3(p.xyx) * 0.1031);
        p3 += dot(p3, p3.yzx + 33.33);
        return fract((p3.x + p3.y) * p3.z);
      }

      vec3 holoHsv2rgb(vec3 c) {
        vec3 rgb = clamp(abs(mod(c.x * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
        rgb = rgb * rgb * (3.0 - 2.0 * rgb);
        return c.z * mix(vec3(1.0), rgb, c.y);
      }

      vec3 palRamp(float t) {
        t = fract(t) * 3.0;
        if (t < 1.0) return mix(uPalA, uPalB, t);
        if (t < 2.0) return mix(uPalB, uPalC, t - 1.0);
        return mix(uPalC, uPalA, t - 2.0);
      }
      ` +
      shader.fragmentShader.replace(
        '#include <emissivemap_fragment>',
        /* glsl */ `#include <emissivemap_fragment>
        {
          // rounded-corner cutout (from Iris Cloth): rounded-rect SDF in cloth space
          vec2 cp = (vHoloUv - 0.5) * uClothSize;
          float cr = uCornerRound * 0.5 * min(uClothSize.x, uClothSize.y);
          vec2 cq = abs(cp) - (0.5 * uClothSize - vec2(cr));
          float cd = length(max(cq, vec2(0.0))) + min(max(cq.x, cq.y), 0.0) - cr;
          float cEdge = fwidth(cd) + 1e-4;
          float cMask = 1.0 - smoothstep(-cEdge, cEdge, cd);
          if (cMask <= 0.0) discard;
          diffuseColor.a *= cMask;

          vec3 hView = normalize(vViewPosition);
          float facing = clamp(abs(dot(normal, hView)), 0.0, 1.0);
          float fres = pow(1.0 - facing, 1.5);

          vec2 cellUv = vHoloUv * vec2(uHoloScale * 1.55, uHoloScale);
          vec2 cellId = floor(cellUv);
          float rnd = holoHash(cellId);
          float rnd2 = holoHash(cellId + 71.7);

          // diffraction sweep (view angle + radial), nudged by flakes; the
          // whole palette drifts toward violet for low notes, cyan for high
          float radial = length(vHoloUv - 0.5) * 1.1 + dot(vHoloUv, vec2(0.55, 0.3));
          float pitchShift = (uPitch - 0.5) * 0.22;
          float rawPhase = fract(uHueShift + pitchShift + facing * uBandFreq + radial
                                 + rnd * 0.05 + uTime * 0.012 + vWave * 0.08);
          // fold hue into the palette's arc (Iris: lavender / violet / cyan) rather than a full rainbow
          float hue = fract(uHueCenter + uHueRange * cos(6.28318 * rawPhase) - pitchShift * 0.6);
          vec3 rainbow = holoHsv2rgb(vec3(hue, uSaturation, 1.0));
          rainbow = mix(rainbow, palRamp(rawPhase), uPalMix);

          float flake = 0.82 + 0.18 * rnd2;
          float gate = fract(rnd2 * 13.7 + facing * 6.0 + uTime * 0.03);
          float glint = smoothstep(1.0 - 0.012 * uSparkle * (1.0 + uEnergy * 2.0), 1.0, gate) * 5.0;

          float swell = 1.0 + uAttack * 0.9 + uEnergy * 0.35;
          float energy = (0.09 + 0.91 * fres) * flake;
          totalEmissiveRadiance += rainbow * uHoloIntensity * swell * (energy * 0.5 + glint * fres * 0.5);

          // vibration: ripples glow where the membrane is actually moving
          float w = clamp(vWave, 0.0, 1.5);
          vec3 waveTint = mix(palRamp(rawPhase + 0.33), vec3(0.92, 0.95, 1.0), 0.35);
          totalEmissiveRadiance += waveTint * w * w * 0.55 * uWaveGlow;

          // stretch: a pale pink-silver sheen where the fabric is pulled taut
          float st = clamp(vStrain, 0.0, 1.0);
          totalEmissiveRadiance += mix(vec3(1.0, 0.78, 0.94), vec3(0.78, 0.86, 1.0), fres) * st * 0.16;

          // hem light: a thin luminous edge, like light caught in the selvage
          float rim = exp(-abs(cd) * 26.0) * (0.35 + 0.65 * fres);
          totalEmissiveRadiance += mix(uPalB, uPalA, vHoloUv.x) * rim * 0.32 * (1.0 + uEnergy * 0.6);

          // touch: a soft halo around the most recent contact
          vec2 td = (vHoloUv - uTouchUv) * vec2(1.55, 1.0);
          float halo = exp(-dot(td, td) * 90.0) * uTouchGlow;
          totalEmissiveRadiance += mix(uPalB, vec3(1.0), 0.4) * halo * 0.35;

          vec3 tinted = diffuseColor.rgb * (0.25 + rainbow * 1.9);
          diffuseColor.rgb = mix(diffuseColor.rgb, tinted, uSpecTint);
        }`,
      );
  };

  return { material, uniforms };
}
