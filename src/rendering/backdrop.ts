import * as THREE from 'three';

/**
 * Atmosphere behind the membrane, drawn in-scene (so it appears in captures):
 * a midnight-navy radial gradient with a soft glow whose color follows the
 * pitch of what's playing and whose strength follows how much the sheet rings.
 */
export function createBackdrop() {
  const uniforms = {
    uBase: { value: new THREE.Color('#070814') },
    uGlowLow: { value: new THREE.Color('#3a2470') },
    uGlowHigh: { value: new THREE.Color('#14506e') },
    uEnergy: { value: 0 },
    uPitch: { value: 0.5 },
    uTime: { value: 0 },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    depthTest: false,
    depthWrite: false,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.9999, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uBase;
      uniform vec3 uGlowLow;
      uniform vec3 uGlowHigh;
      uniform float uEnergy;
      uniform float uPitch;
      uniform float uTime;
      varying vec2 vUv;
      void main() {
        vec2 p = vUv - vec2(0.5, 0.52);
        float r = length(p * vec2(1.0, 1.25));
        vec3 glow = mix(uGlowLow, uGlowHigh, uPitch);
        float breathe = 0.85 + 0.15 * sin(uTime * 0.25);
        float halo = exp(-r * r * 5.5) * (0.32 * breathe + uEnergy * 0.4);
        vec3 col = uBase * (1.15 - r * 0.9) + glow * halo;
        // faint top light, like a high window
        col += vec3(0.05, 0.05, 0.09) * smoothstep(0.2, 1.0, vUv.y) * 0.4;
        gl_FragColor = vec4(max(col, vec3(0.0)), 1.0);
      }
    `,
  });
  // one oversized triangle covers the screen
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2));
  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;

  return {
    mesh,
    /** glow follows the fabric palette: low notes toward `low`, high toward `high` */
    setGlow(low: string, high: string) {
      // normalise brightness so pale palettes (Pearl) don't flood the scene
      for (const [u, hex] of [[uniforms.uGlowLow, low], [uniforms.uGlowHigh, high]] as const) {
        const c = u.value.set(hex);
        const lum = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
        c.multiplyScalar(0.3 * Math.min(1, 0.35 / Math.max(lum, 1e-3)));
      }
    },
    setBase(hex: string) {
      if (/^#[0-9a-f]{6}$/i.test(hex)) uniforms.uBase.value.set(hex);
    },
    update(time: number, energy: number, pitch: number) {
      uniforms.uTime.value = time % 1000;
      uniforms.uEnergy.value = energy;
      uniforms.uPitch.value = pitch;
    },
    dispose() {
      geo.dispose();
      material.dispose();
    },
  };
}

/** Film grain, from Iris Cloth / Holocloth (MIT) — sinless hash, stable on ANGLE. */
export const GrainShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uAmount: { value: 0.045 },
    uTime: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uAmount;
    uniform float uTime;
    varying vec2 vUv;
    float gHash(vec3 p3) {
      p3 = fract(p3 * 0.1031);
      p3 += dot(p3, p3.zyx + 31.32);
      return fract((p3.x + p3.y) * p3.z);
    }
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec2 p = mod(gl_FragCoord.xy, 1024.0);
      float n = gHash(vec3(p, mod(uTime * 120.0, 512.0))) - 0.5;
      c.rgb += n * uAmount;
      gl_FragColor = c;
    }
  `,
};
