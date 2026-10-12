import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import type { Membrane, SurfacePoint, Vec3 } from '../physics/membrane.ts';
import { createResonanceMaterial, type ResonanceUniforms } from './holoMaterial.ts';
import { GrainShader, createBackdrop } from './backdrop.ts';
import type { VisualState } from './visualState.ts';

export interface SurfaceHit {
  point: SurfacePoint;
  world: Vec3;
}

export interface LookSettings {
  /** 0..1.5 iridescent intensity */
  iridescence: number;
  /** backdrop base color */
  background: string;
  reducedMotion: boolean;
}

const FOV = 34;
const TARGET = new THREE.Vector3(0, -0.04, 0);

/**
 * Everything visual: renderer, camera, lights, post-processing, the
 * membrane mesh and its resonance attributes. Pointer picking lives here too
 * because it needs the camera and the deformed geometry.
 */
export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private grain: ShaderPass;
  private geometry: THREE.BufferGeometry;
  private mesh: THREE.Mesh;
  private restMesh: THREE.Mesh;
  private uniforms: ResonanceUniforms;
  private material: THREE.MeshPhysicalMaterial;
  private backdrop: ReturnType<typeof createBackdrop>;
  private waveAttr: THREE.BufferAttribute;
  private strainAttr: THREE.BufferAttribute;
  private raycaster = new THREE.Raycaster();
  private ndc = new THREE.Vector2();
  private parallax = new THREE.Vector2();
  private parallaxTarget = new THREE.Vector2();
  private baseDistance = 6;
  private pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  private resizeObserver: ResizeObserver;
  private look: LookSettings = { iridescence: 1, background: '#070814', reducedMotion: false };
  private time = 0;

  constructor(private host: HTMLElement, private membrane: Membrane) {
    const { width, height } = this.size();
    this.renderer = new THREE.WebGLRenderer({
      antialias: false, // MSAA happens on the composer's render target
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(width, height);
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 0.92;
    this.renderer.domElement.setAttribute('aria-hidden', 'true');
    this.renderer.domElement.dataset.testid = 'stage-canvas';
    host.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(FOV, width / height, 0.1, 100);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.34;
    pmrem.dispose();

    // cool rim on one side, pink on the other, soft key from the front
    const rimA = new THREE.DirectionalLight(0x8fd8ff, 1.3);
    rimA.position.set(-4, 2.5, -3);
    const rimB = new THREE.DirectionalLight(0xff9ad8, 0.9);
    rimB.position.set(4.5, -1.5, -2.5);
    const key = new THREE.DirectionalLight(0xe8e4ff, 0.32);
    key.position.set(1.5, 3, 4);
    this.scene.add(rimA, rimB, key);

    this.backdrop = createBackdrop();
    this.scene.add(this.backdrop.mesh);

    const holo = createResonanceMaterial();
    this.material = holo.material;
    this.uniforms = holo.uniforms;
    this.uniforms.uClothSize.value.set(membrane.spec.width, membrane.spec.height);
    const aniso = this.renderer.capabilities.getMaxAnisotropy();
    if (this.material.normalMap) this.material.normalMap.anisotropy = aniso;
    if (this.material.roughnessMap) this.material.roughnessMap.anisotropy = aniso;

    this.geometry = buildGridGeometry(membrane, membrane.positions);
    const posAttr = this.geometry.getAttribute('position') as THREE.BufferAttribute;
    posAttr.setUsage(THREE.DynamicDrawUsage);
    this.waveAttr = new THREE.BufferAttribute(new Float32Array(membrane.count), 1);
    this.waveAttr.setUsage(THREE.DynamicDrawUsage);
    this.strainAttr = new THREE.BufferAttribute(new Float32Array(membrane.count), 1);
    this.strainAttr.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('aWave', this.waveAttr);
    this.geometry.setAttribute('aStrain', this.strainAttr);
    this.geometry.computeVertexNormals();
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);

    // undeformed copy (never rendered) — tells us which part of the fabric
    // sits under the pointer even while the real sheet is being pulled away
    this.restMesh = new THREE.Mesh(
      buildGridGeometry(membrane, new Float32Array(membrane.cloth.rest)),
      new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
    );
    this.restMesh.updateMatrixWorld();

    const rt = new THREE.WebGLRenderTarget(width, height, { samples: 4, type: THREE.HalfFloatType });
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.setPixelRatio(this.pixelRatio);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(width, height), 0.32, 0.75, 0.82);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.grain = new ShaderPass(GrainShader);
    this.composer.addPass(this.grain);

    this.fitCamera(width, height);
    this.resizeObserver = new ResizeObserver(() => this.onResize());
    this.resizeObserver.observe(host);
  }

  get canvas(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  private size() {
    return {
      width: Math.max(1, this.host.clientWidth || window.innerWidth),
      height: Math.max(1, this.host.clientHeight || window.innerHeight),
    };
  }

  setLook(look: LookSettings) {
    this.look = { ...look };
    const k = Math.max(0, Math.min(1.5, look.iridescence));
    this.uniforms.uHoloIntensity.value = 0.95 * k;
    this.material.iridescence = Math.min(1, 0.4 + 0.6 * k);
    this.backdrop.setBase(look.background);
    if (look.reducedMotion) this.parallaxTarget.set(0, 0);
  }

  /** Pointer position (client px) → parallax target & picking ray. */
  setPointer(clientX: number, clientY: number) {
    const rect = this.canvas.getBoundingClientRect();
    this.ndc.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    if (!this.look.reducedMotion) this.parallaxTarget.copy(this.ndc);
  }

  /** Raycast the live, deformed fabric under the last pointer position. */
  pickSurface(): SurfaceHit | null {
    this.raycaster.setFromCamera(this.ndc, this.camera);
    this.geometry.computeBoundingSphere();
    const hit = this.raycaster.intersectObject(this.mesh, false)[0];
    if (!hit || !hit.uv) return null;
    return { point: { u: hit.uv.x, v: hit.uv.y }, world: [hit.point.x, hit.point.y, hit.point.z] };
  }

  /** Raycast the resting shape: which fabric region lies under the pointer. */
  pickRestSurface(): SurfacePoint | null {
    this.raycaster.setFromCamera(this.ndc, this.camera);
    const hit = this.raycaster.intersectObject(this.restMesh, false)[0];
    return hit?.uv ? { u: hit.uv.x, v: hit.uv.y } : null;
  }

  /** Where the pointer ray crosses a camera-facing plane through `through`. */
  projectToDragPlane(through: Vec3): Vec3 | null {
    this.raycaster.setFromCamera(this.ndc, this.camera);
    const normal = new THREE.Vector3();
    this.camera.getWorldDirection(normal);
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, new THREE.Vector3(...through));
    const out = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(plane, out) ? [out.x, out.y, out.z] : null;
  }

  /** Unit vector toward the camera (for showcase pulls). */
  towardCamera(): Vec3 {
    const d = new THREE.Vector3();
    this.camera.getWorldDirection(d);
    return [-d.x, -d.y, -d.z];
  }

  /** Width of the visible scene at the fabric's depth, in world units. */
  viewWidth(): number {
    const dist = this.camera.position.distanceTo(TARGET);
    return 2 * dist * Math.tan(THREE.MathUtils.degToRad(FOV / 2)) * this.camera.aspect;
  }

  /** Push the membrane state into the GPU and draw a frame. */
  render(dt: number, visual: VisualState) {
    this.time += dt;
    const m = this.membrane;
    (this.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    this.geometry.computeVertexNormals();

    const wave = this.waveAttr.array as Float32Array;
    const strain = this.strainAttr.array as Float32Array;
    const h = m.wave.h;
    for (let i = 0; i < m.count; i++) {
      const v = Math.abs(m.wave.velocityAt(i));
      wave[i] = Math.min(1.5, v * 0.9 + Math.abs(h[i]) * 9);
      strain[i] = Math.min(1, Math.max(0, m.cloth.strain[i] * 9));
    }
    this.waveAttr.needsUpdate = true;
    this.strainAttr.needsUpdate = true;

    const u = this.uniforms;
    u.uTime.value = this.time % 1000;
    u.uPitch.value = visual.pitch;
    u.uAttack.value = visual.attack;
    u.uEnergy.value = visual.energy;
    u.uTouchUv.value.set(visual.touch.u, visual.touch.v);
    u.uTouchGlow.value = visual.touchGlow;
    this.backdrop.update(this.time, visual.energy, visual.pitch);
    this.grain.uniforms.uTime.value = this.time % 61.7;
    this.bloom.strength = 0.3 + visual.attack * 0.18 + visual.energy * 0.12;

    // gentle parallax toward the pointer
    const k = 1 - Math.exp(-dt / 0.6);
    this.parallax.lerp(this.parallaxTarget, k);
    this.placeCamera();
    this.composer.render(dt);
  }

  private placeCamera() {
    const d = this.baseDistance;
    this.camera.position.set(d * 0.3 + this.parallax.x * 0.28, d * 0.08 + this.parallax.y * 0.16, d);
    this.camera.lookAt(TARGET);
  }

  private fitCamera(width: number, height: number) {
    const aspect = width / height;
    this.camera.aspect = aspect;
    const t = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    const w = this.membrane.spec.width;
    const hgt = this.membrane.spec.height;
    const forHeight = (hgt * 1.5) / 2 / t;
    const forWidth = (w * (aspect < 1 ? 1.06 : 1.5)) / 2 / (t * aspect);
    this.baseDistance = Math.max(forHeight, forWidth);
    this.camera.updateProjectionMatrix();
    this.placeCamera();
  }

  private onResize() {
    const { width, height } = this.size();
    this.renderer.setSize(width, height);
    this.composer.setSize(width, height);
    this.bloom.setSize(width, height);
    this.fitCamera(width, height);
  }

  /** Render one frame at high resolution, without any UI, as a PNG data URL. */
  snapshotPNG(visual: VisualState): string {
    const { width, height } = this.size();
    const exportPR = Math.min(4, Math.max(2, 3200 / Math.max(width, height)));
    this.renderer.setPixelRatio(exportPR);
    this.composer.setPixelRatio(exportPR);
    this.renderer.setSize(width, height);
    this.composer.setSize(width, height);
    this.render(0, visual);
    const url = this.canvas.toDataURL('image/png');
    this.renderer.setPixelRatio(this.pixelRatio);
    this.composer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(width, height);
    this.composer.setSize(width, height);
    return url;
  }

  dispose() {
    this.resizeObserver.disconnect();
    this.composer.dispose();
    this.geometry.dispose();
    this.restMesh.geometry.dispose();
    (this.restMesh.material as THREE.Material).dispose();
    this.material.normalMap?.dispose();
    this.material.roughnessMap?.dispose();
    this.material.dispose();
    this.backdrop.dispose();
    this.scene.environment?.dispose();
    this.renderer.dispose();
    this.canvas.remove();
  }
}

/** Indexed triangle grid sharing `positions` (row 0 = top), uv.y = 1 at top. */
function buildGridGeometry(m: Membrane, positions: Float32Array): THREE.BufferGeometry {
  const { cols, rows } = m;
  const uvs = new Float32Array(cols * rows * 2);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = (r * cols + c) * 2;
      uvs[i] = c / (cols - 1);
      uvs[i + 1] = 1 - r / (rows - 1);
    }
  }
  const index: number[] = [];
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const a = r * cols + c, b = a + 1, d = a + cols, e = d + 1;
      index.push(a, d, b, b, d, e);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(index);
  return geo;
}
