import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { PARTS, createPartMesh, disposeGroup } from './parts.js';

const MAX_PARTICLES = 1400;

// sky dome shader: deep twilight, teal at the horizon fading to a
// near-black zenith, with a cold glow where the light comes from
const skyVertex = `
  varying vec3 vPos;
  void main() {
    vPos = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const skyFragment = `
  varying vec3 vPos;
  void main() {
    vec3 dir = normalize(vPos);
    float h = dir.y * 0.5 + 0.5;
    vec3 horizon = vec3(0.16, 0.30, 0.38);
    vec3 zenith = vec3(0.02, 0.04, 0.10);
    vec3 col = mix(horizon, zenith, pow(h, 0.5));
    // light pollution from the city, a thin glow band on the skyline
    col += vec3(0.30, 0.18, 0.28) * pow(1.0 - abs(dir.y), 16.0);
    vec3 sunDir = normalize(vec3(0.62, 0.34, 0.26));
    float s = max(dot(dir, sunDir), 0.0);
    col += vec3(0.5, 0.8, 1.0) * (pow(s, 900.0) * 1.6 + pow(s, 18.0) * 0.10);
    gl_FragColor = vec4(col, 1.0);
  }
`;

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 4000);
    this.camera.position.set(6, 3, 8);

    this.mode = 'title';
    this.titleAngle = 0;
    this.animTime = 0;
    this.flashT = 0;
    this.shake = 0;
    this.camTarget = new THREE.Vector3(0, 2, 0);

    // the crowd on the bleachers, bobbing on their own clocks
    this.crowd = [];

    // loose chunks knocked off by heavy hits
    this.debris = [];
    this.debrisGeo = new THREE.BoxGeometry(0.14, 0.1, 0.12);
    this.debrisMats = [
      new THREE.MeshStandardMaterial({ color: 0x3a3d42, metalness: 0.8, roughness: 0.5 }),
      new THREE.MeshStandardMaterial({ color: 0x7a4a30, metalness: 0.5, roughness: 0.8 }),
    ];

    // two robots share the arena: yours and whoever you picked on
    this.bots = { you: this.makeBotSlot(), foe: this.makeBotSlot() };
    this.bots.foe.group.rotation.y = Math.PI; // faces you
    this.bots.foe.group.visible = false;

    this.setupLights();
    this.setupSky();
    this.setupEnvironment();
    this.setupGround();
    this.setupScenery();
    this.setupCity();
    this.setupClouds();
    this.setupParticles();

    // the environment map is there for the robots' metal. tone it way
    // down on the terrain and buildings or the desert washes out white.
    // robot parts are built later, so they keep the full reflections
    this.scene.traverse((o) => {
      if (o.isMesh && o.material && 'envMapIntensity' in o.material) {
        o.material.envMapIntensity = 0.2;
      }
    });

    // watch the framerate for the first few seconds; if this machine
    // is struggling, drop the expensive effects once and move on
    this.frameCount = 0;
    this.slowFrames = 0;
    this.qualityReduced = false;

    // mild bloom so sparks, hover pads, and the zapper tip glow
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight), 0.35, 0.7, 0.85
    );
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(new OutputPass());

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.minDistance = 3;
    this.controls.maxDistance = 25;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.controls.target.set(0, 2, 0);
    this.controls.enabled = false;

    window.addEventListener('resize', () => this.onResize());
  }

  makeBotSlot() {
    const group = new THREE.Group();
    return {
      group,
      parts: [],
      refs: { spin: [], saws: [], hammers: [], zapTips: [], pads: [] },
      height: 0,
      dead: false,
    };
  }

  setupLights() {
    // hemisphere fill so shadowed sides are not pure black
    this.hemi = new THREE.HemisphereLight(0x2c3c4c, 0x141a20, 0.65);
    this.scene.add(this.hemi);

    // moonlight does the shadow work, still low and long
    this.sun = new THREE.DirectionalLight(0x9ab8e8, 1.1);
    this.sun.position.set(28, 15, 11);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(4096, 4096);
    // wide enough to catch the buildings around the arena too
    this.sun.shadow.camera.left = -45;
    this.sun.shadow.camera.right = 45;
    this.sun.shadow.camera.top = 45;
    this.sun.shadow.camera.bottom = -45;
    this.sun.shadow.camera.far = 150;
    this.sun.shadow.bias = -0.0002;
    this.sun.shadow.normalBias = 0.03;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    // magenta rim light from behind so robot edges catch neon
    this.rim = new THREE.DirectionalLight(0xc84a8a, 0.5);
    this.rim.position.set(-10, 8, -14);
    this.scene.add(this.rim);
  }

  setupSky() {
    const skyGeo = new THREE.SphereGeometry(1800, 24, 16);
    const skyMat = new THREE.ShaderMaterial({
      vertexShader: skyVertex,
      fragmentShader: skyFragment,
      side: THREE.BackSide,
      depthWrite: false,
    });
    this.skyDome = new THREE.Mesh(skyGeo, skyMat);
    this.scene.add(this.skyDome);
  }

  setupEnvironment() {
    // a tiny fake outdoor scene baked into an environment map, so the
    // metal parts have a sky and ground to reflect. without this
    // MeshStandardMaterial metals look like gray plastic
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const envScene = new THREE.Scene();
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      vertexShader: `
        varying vec3 vPos;
        void main() {
          vPos = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        varying vec3 vPos;
        void main() {
          vec3 d = normalize(vPos);
          vec3 ground = vec3(0.33, 0.28, 0.20);
          vec3 horizon = vec3(0.85, 0.83, 0.78);
          vec3 zenith = vec3(0.30, 0.48, 0.85);
          vec3 sky = mix(horizon, zenith, pow(max(d.y, 0.0), 0.7));
          vec3 col = d.y > 0.0 ? sky : mix(horizon, ground, min(1.0, -d.y * 3.0));
          vec3 sunDir = normalize(vec3(0.45, 0.7, 0.3));
          col += vec3(1.0, 0.95, 0.85) * pow(max(dot(d, sunDir), 0.0), 250.0) * 6.0;
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    const ball = new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), mat);
    envScene.add(ball);
    this.scene.environment = pmrem.fromScene(envScene, 0.03).texture;
    ball.geometry.dispose();
    mat.dispose();
    pmrem.dispose();
  }

  // cheap layered sine noise for the terrain. flat near the yard so
  // the arena sits on level ground, hills further out
  hillHeight(x, z) {
    const h =
      Math.sin(x * 0.008) * Math.cos(z * 0.006) * 10 +
      Math.sin(x * 0.02 + 3) * Math.sin(z * 0.017 + 1) * 5 +
      Math.sin((x + z) * 0.004) * 12;
    const d = Math.sqrt(x * x + z * z);
    return h * THREE.MathUtils.smoothstep(d, 80, 260);
  }

  makeGroundTexture() {
    // one big hand-painted map: tonal patches, dirt roads, a dry lake
    const c = document.createElement('canvas');
    c.width = 2048; c.height = 2048;
    const g = c.getContext('2d');
    g.fillStyle = '#817757';
    g.fillRect(0, 0, 2048, 2048);

    const tones = ['#75694c', '#8c855f', '#665f45', '#877c58', '#7b7154'];
    for (let i = 0; i < 70; i++) {
      g.fillStyle = tones[i % tones.length];
      g.globalAlpha = 0.05 + Math.random() * 0.06;
      g.beginPath();
      g.ellipse(
        Math.random() * 2048, Math.random() * 2048,
        60 + Math.random() * 260, 40 + Math.random() * 200,
        Math.random() * Math.PI, 0, Math.PI * 2
      );
      g.fill();
    }
    g.globalAlpha = 1;

    g.fillStyle = 'rgba(40,36,28,0.08)';
    for (let i = 0; i < 3500; i++) {
      g.fillRect(Math.random() * 2048, Math.random() * 2048, 2, 2);
    }

    // dry lakebed off to the northeast
    const lake = g.createRadialGradient(1420, 660, 30, 1420, 660, 230);
    lake.addColorStop(0, 'rgba(178,168,132,0.9)');
    lake.addColorStop(1, 'rgba(178,168,132,0)');
    g.fillStyle = lake;
    g.beginPath();
    g.ellipse(1420, 660, 230, 150, 0.4, 0, Math.PI * 2);
    g.fill();

    // dirt roads out from the yard
    g.strokeStyle = 'rgba(66,60,48,0.8)';
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(1024, 1024);
    g.quadraticCurveTo(700, 1100, 250, 980);
    g.stroke();
    g.beginPath();
    g.moveTo(1024, 1024);
    g.quadraticCurveTo(1250, 1350, 1500, 1800);
    g.stroke();
    g.beginPath();
    g.moveTo(1024, 1024);
    g.quadraticCurveTo(1150, 800, 1380, 690);
    g.stroke();

    // darker worn patch right around the arena
    g.fillStyle = 'rgba(70,66,56,0.45)';
    g.fillRect(1010, 1010, 28, 28);

    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
  }

  setupGround() {
    // cold night haze so the terrain fades out instead of ending
    this.scene.fog = new THREE.Fog(0x0c141c, 300, 2600);

    const geo = new THREE.PlaneGeometry(4000, 4000, 96, 96);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      pos.setY(i, this.hillHeight(pos.getX(i), pos.getZ(i)));
    }
    geo.computeVertexNormals();
    const groundMat = new THREE.MeshStandardMaterial({
      map: this.makeGroundTexture(),
      roughness: 1,
    });
    this.ground = new THREE.Mesh(geo, groundMat);
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);

    this.buildArena();
  }

  makeConcreteTexture() {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 256;
    const g = c.getContext('2d');
    g.fillStyle = '#96958f';
    g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 600; i++) {
      g.fillStyle = 'rgba(' + (Math.random() < 0.5 ? '60,58,52' : '210,208,200') + ',' + (Math.random() * 0.06).toFixed(3) + ')';
      g.fillRect(Math.random() * 256, Math.random() * 256, 3, 3);
    }
    g.strokeStyle = 'rgba(50,48,44,0.5)';
    g.lineWidth = 2;
    for (let p = 0; p <= 256; p += 64) {
      g.beginPath(); g.moveTo(p, 0); g.lineTo(p, 256); g.stroke();
      g.beginPath(); g.moveTo(0, p); g.lineTo(256, p); g.stroke();
    }
    for (let i = 0; i < 14; i++) {
      g.fillStyle = 'rgba(70,64,54,' + (0.04 + Math.random() * 0.07).toFixed(3) + ')';
      g.beginPath();
      g.ellipse(Math.random() * 256, Math.random() * 256, 12 + Math.random() * 40, 8 + Math.random() * 24, 0, 0, Math.PI * 2);
      g.fill();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    return tex;
  }

  makeDirtTexture() {
    // packed arena dirt with tire scuffs worn into it
    const c = document.createElement('canvas');
    c.width = 512; c.height = 512;
    const g = c.getContext('2d');
    g.fillStyle = '#6b5f4a';
    g.fillRect(0, 0, 512, 512);
    const tones = ['#5f5340', '#77694f', '#544a3a'];
    for (let i = 0; i < 40; i++) {
      g.fillStyle = tones[i % tones.length];
      g.globalAlpha = 0.08 + Math.random() * 0.08;
      g.beginPath();
      g.ellipse(Math.random() * 512, Math.random() * 512, 30 + Math.random() * 90, 20 + Math.random() * 60, Math.random() * Math.PI, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;
    // tire scuff arcs from years of robots spinning out
    g.strokeStyle = 'rgba(38,32,24,0.4)';
    for (let i = 0; i < 26; i++) {
      g.lineWidth = 2 + Math.random() * 4;
      const a0 = Math.random() * Math.PI * 2;
      g.beginPath();
      g.arc(
        128 + Math.random() * 256, 128 + Math.random() * 256,
        20 + Math.random() * 100, a0, a0 + 0.5 + Math.random() * 1.5
      );
      g.stroke();
    }
    // worn pale patch in the middle where most fights end
    const wear = g.createRadialGradient(256, 256, 20, 256, 256, 200);
    wear.addColorStop(0, 'rgba(150,138,110,0.35)');
    wear.addColorStop(1, 'rgba(150,138,110,0)');
    g.fillStyle = wear;
    g.fillRect(0, 0, 512, 512);
    // the ring line, repainted in whatever glows
    g.strokeStyle = 'rgba(120,220,235,0.6)';
    g.lineWidth = 9;
    g.setLineDash([26, 15]);
    g.beginPath();
    g.arc(256, 256, 196, 0, Math.PI * 2);
    g.stroke();
    g.setLineDash([]);
    g.fillStyle = 'rgba(120,220,235,0.45)';
    g.beginPath();
    g.arc(256, 256, 10, 0, Math.PI * 2);
    g.fill();
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  makeCorrugatedTexture(hazard) {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 128;
    const g = c.getContext('2d');
    g.fillStyle = '#767b80';
    g.fillRect(0, 0, 256, 128);
    for (let x = 0; x < 256; x += 8) {
      g.fillStyle = 'rgba(255,255,255,0.10)';
      g.fillRect(x, 0, 3, 128);
      g.fillStyle = 'rgba(10,12,14,0.28)';
      g.fillRect(x + 4, 0, 3, 128);
    }
    if (hazard) {
      // lit chevron band across the middle of the panel
      g.save();
      g.beginPath();
      g.rect(0, 44, 256, 36);
      g.clip();
      for (let x = -40; x < 300; x += 22) {
        g.fillStyle = x % 44 === 4 ? '#3fd8e8' : '#10181d';
        g.globalAlpha = 0.9;
        g.beginPath();
        g.moveTo(x, 80); g.lineTo(x + 11, 44); g.lineTo(x + 22, 44); g.lineTo(x + 11, 80);
        g.fill();
      }
      g.restore();
      g.globalAlpha = 1;
    }
    for (let i = 0; i < 26; i++) {
      const x = Math.random() * 256;
      const y = Math.random() * 128;
      const r = 4 + Math.random() * 16;
      const rust = g.createRadialGradient(x, y, 1, x, y, r);
      rust.addColorStop(0, 'rgba(122,64,34,' + (0.15 + Math.random() * 0.2).toFixed(2) + ')');
      rust.addColorStop(1, 'rgba(122,64,34,0)');
      g.fillStyle = rust;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    // grime kicked up along the bottom edge
    const grime = g.createLinearGradient(0, 128, 0, 88);
    grime.addColorStop(0, 'rgba(30,26,20,0.5)');
    grime.addColorStop(1, 'rgba(30,26,20,0)');
    g.fillStyle = grime;
    g.fillRect(0, 88, 256, 40);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  makeBannerTexture() {
    const c = document.createElement('canvas');
    c.width = 1024; c.height = 128;
    const g = c.getContext('2d');
    g.fillStyle = '#1b1d21';
    g.fillRect(0, 0, 1024, 128);
    g.strokeStyle = '#3fd8e8';
    g.lineWidth = 6;
    g.strokeRect(8, 8, 1008, 112);
    g.fillStyle = '#3fd8e8';
    g.font = '900 62px "Arial Black", Impact, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('S C R A P Y A R D  W A R S', 512, 70);
    // eat little holes out of the paint so it reads as weathered
    g.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 320; i++) {
      g.fillStyle = 'rgba(0,0,0,' + (Math.random() * 0.5).toFixed(2) + ')';
      g.beginPath();
      g.arc(Math.random() * 1024, Math.random() * 128, Math.random() * 3, 0, Math.PI * 2);
      g.fill();
    }
    g.globalCompositeOperation = 'source-over';
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  buildArena() {
    // a packed-dirt fighting pit ringed with concrete barriers, out in
    // the middle of the junkyard
    const arena = new THREE.Group();
    const concrete = new THREE.MeshStandardMaterial({ map: this.makeConcreteTexture(), roughness: 0.95 });

    const pad = new THREE.Mesh(
      new THREE.CylinderGeometry(16, 16.8, 0.5, 48),
      new THREE.MeshStandardMaterial({ map: this.makeDirtTexture(), roughness: 1 })
    );
    pad.position.y = 0.25;
    pad.receiveShadow = true;
    arena.add(pad);
    this.arenaY = 0.5;

    // corrugated steel wall all the way around the pit, gaps at both
    // ends where the robots roll in
    const darkSteelWall = new THREE.MeshStandardMaterial({ color: 0x33363b, metalness: 0.7, roughness: 0.5 });
    const corrMat = new THREE.MeshStandardMaterial({ map: this.makeCorrugatedTexture(false), metalness: 0.4, roughness: 0.75 });
    // the striped panels run their own lighting
    const hazTex = this.makeCorrugatedTexture(true);
    const hazMat = new THREE.MeshStandardMaterial({
      map: hazTex, emissiveMap: hazTex, emissive: 0x8adfff, emissiveIntensity: 0.5,
      metalness: 0.4, roughness: 0.75,
    });
    const SEG = 26;
    for (let i = 0; i < SEG; i++) {
      const a = (i / SEG) * Math.PI * 2;
      if (Math.abs(Math.cos(a)) > 0.93) continue;
      const wall = new THREE.Mesh(new THREE.BoxGeometry(3.85, 2.3, 0.16), i % 6 === 2 ? hazMat : corrMat);
      wall.position.set(Math.cos(a) * 15.8, 1.15, Math.sin(a) * 15.8);
      wall.rotation.y = -a + Math.PI / 2;
      wall.castShadow = true;
      wall.receiveShadow = true;
      arena.add(wall);
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.18, 2.7, 0.18), darkSteelWall);
      const pa = a + Math.PI / SEG;
      post.position.set(Math.cos(pa) * 15.8, 1.35, Math.sin(pa) * 15.8);
      post.castShadow = true;
      arena.add(post);
    }
    // concrete chicanes flanking the two gates
    for (const [bx, bz] of [[17.6, 2.6], [17.6, -2.6], [-17.6, 2.6], [-17.6, -2.6]]) {
      const barrier = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.8, 2.4), concrete);
      barrier.position.set(bx, 0.4, bz);
      barrier.castShadow = true;
      barrier.receiveShadow = true;
      arena.add(barrier);
    }

    // bleachers behind the walls on both long sides, with a crowd
    const seatMat = new THREE.MeshStandardMaterial({ color: 0x8a6f4a, roughness: 0.9 });
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x3a3d42, metalness: 0.6, roughness: 0.6 });
    const shirtColors = [0x8a6a4a, 0x5b6a72, 0x9a5a3a, 0x66754f, 0xa8895f, 0x74584e];
    const headMat = new THREE.MeshStandardMaterial({ color: 0xc09a72, roughness: 0.8 });
    for (const side of [-1, 1]) {
      const bank = new THREE.Group();
      for (let row = 0; row < 4; row++) {
        const seat = new THREE.Mesh(new THREE.BoxGeometry(17, 0.3, 1.3), seatMat);
        seat.position.set(0, 0.8 + row * 0.62, row * 1.35);
        seat.castShadow = true;
        seat.receiveShadow = true;
        bank.add(seat);
        for (const lx of [-8, 0, 8]) {
          const leg = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.8 + row * 0.62, 0.14), frameMat);
          leg.position.set(lx, (0.8 + row * 0.62) / 2, row * 1.35);
          bank.add(leg);
        }
      }
      for (let i = 0; i < 34; i++) {
        const row = Math.floor(Math.random() * 4);
        const body = new THREE.Mesh(
          new THREE.BoxGeometry(0.34, 0.55, 0.26),
          new THREE.MeshStandardMaterial({ color: shirtColors[i % shirtColors.length], roughness: 0.9 })
        );
        body.position.set(-8 + Math.random() * 16, 1.22 + row * 0.62, row * 1.35 - 0.15);
        const head = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), headMat);
        head.position.y = 0.42;
        body.add(head);
        bank.add(body);
        this.crowd.push({ mesh: body, baseY: body.position.y, phase: Math.random() * Math.PI * 2 });
      }
      bank.position.set(0, 0, side * 20.5);
      if (side < 0) bank.rotation.y = Math.PI;
      arena.add(bank);
    }

    // the yard sign over the far bank, wired up and buzzing
    const bannerTex = this.makeBannerTexture();
    const banner = new THREE.Mesh(
      new THREE.PlaneGeometry(15, 1.9),
      new THREE.MeshStandardMaterial({
        map: bannerTex, emissiveMap: bannerTex, emissive: 0xffffff, emissiveIntensity: 0.7,
        transparent: true, roughness: 0.85, side: THREE.DoubleSide,
      })
    );
    banner.position.set(0, 3.4, -19.6);
    banner.rotation.z = 0.012;
    arena.add(banner);

    // pennant strings sagging between the floodlight towers
    const triShape = new THREE.Shape();
    triShape.moveTo(-0.28, 0);
    triShape.lineTo(0.28, 0);
    triShape.lineTo(0, -0.62);
    triShape.lineTo(-0.28, 0);
    const triGeo = new THREE.ShapeGeometry(triShape);
    const flagMats = [0x3fd8e8, 0xff4a6a, 0xd8f0f2].map(
      (col) => new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.25, roughness: 0.85, side: THREE.DoubleSide })
    );
    const wireMat = new THREE.LineBasicMaterial({ color: 0x8a8b8e, transparent: true, opacity: 0.6 });
    for (const zs of [14.8, -14.8]) {
      const wirePts = [];
      for (let i = 0; i <= 17; i++) {
        const t = i / 17;
        const x = -14.8 + t * 29.6;
        const y = 14.2 - Math.sin(t * Math.PI) * 2.6;
        wirePts.push(new THREE.Vector3(x, y, zs));
        if (i < 17) {
          const flag = new THREE.Mesh(triGeo, flagMats[i % 3]);
          flag.position.set(x + 0.87, y - Math.sin((t + 0.03) * Math.PI) * 0.1, zs);
          arena.add(flag);
        }
      }
      arena.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(wirePts), wireMat));
    }

    // floodlight towers looking down into the pit
    const darkSteel = new THREE.MeshStandardMaterial({ color: 0x3a3d42, metalness: 0.7, roughness: 0.5 });
    // cold arc floodlights, the only honest light out here
    const lampMat = new THREE.MeshStandardMaterial({
      color: 0xd8f4ff, emissive: 0xaef4ff, emissiveIntensity: 2.4,
    });
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const pole = new THREE.Mesh(new THREE.BoxGeometry(0.35, 14, 0.35), darkSteel);
      pole.position.set(Math.cos(a) * 21, 7, Math.sin(a) * 21);
      pole.castShadow = true;
      const head = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.5, 0.5), lampMat);
      head.position.set(Math.cos(a) * 21, 14.2, Math.sin(a) * 21);
      head.lookAt(0, 1, 0);
      arena.add(pole, head);
    }

    // electric flicker over the pit when metal meets metal
    this.arcLight = new THREE.PointLight(0x9fe8ff, 0, 34, 2);
    this.arcLight.position.set(0, 2.5, 0);
    arena.add(this.arcLight);

    // neon wash over the pit, cyan one side, magenta the other
    const neonA = new THREE.PointLight(0x35d8e8, 14, 50, 2);
    neonA.position.set(-9, 7, 5);
    const neonB = new THREE.PointLight(0xd84aff, 10, 50, 2);
    neonB.position.set(9, 7, -5);
    arena.add(neonA, neonB);

    this.scene.add(arena);
    this.scene.add(this.bots.you.group);
    this.scene.add(this.bots.foe.group);
  }

  makeJunkPile(x, z, count) {
    // a mound of squashed boxes and drums in rust colors
    const pile = new THREE.Group();
    const mats = [
      new THREE.MeshStandardMaterial({ color: 0x7a4a30, roughness: 0.85, metalness: 0.4 }),
      new THREE.MeshStandardMaterial({ color: 0x6b6f74, roughness: 0.7, metalness: 0.6 }),
      new THREE.MeshStandardMaterial({ color: 0x5e5347, roughness: 0.9, metalness: 0.3 }),
      new THREE.MeshStandardMaterial({ color: 0x8a5a3a, roughness: 0.8, metalness: 0.5 }),
    ];
    for (let i = 0; i < count; i++) {
      const roll = Math.random();
      let geo;
      if (roll < 0.5) geo = new THREE.BoxGeometry(0.9 + Math.random(), 0.3 + Math.random() * 0.5, 0.7 + Math.random());
      else if (roll < 0.8) geo = new THREE.CylinderGeometry(0.3, 0.3, 0.7 + Math.random() * 0.5, 10);
      else geo = new THREE.DodecahedronGeometry(0.5, 0);
      const m = new THREE.Mesh(geo, mats[i % mats.length]);
      const r = Math.random() * 2.2;
      const a = Math.random() * Math.PI * 2;
      m.position.set(x + Math.cos(a) * r, 0.3 + Math.random() * 1.1, z + Math.sin(a) * r);
      m.rotation.set(Math.random() * 0.6, Math.random() * Math.PI, Math.random() * 0.6);
      m.castShadow = true;
      m.receiveShadow = true;
      pile.add(m);
    }
    return pile;
  }

  setupScenery() {
    const scenery = new THREE.Group();

    // mountain ring on the horizon, hazed out by the fog
    const mountainMat = new THREE.MeshStandardMaterial({
      color: 0x75705f, roughness: 1, flatShading: true,
    });
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2 + Math.random() * 0.2;
      const r = 1350 + Math.random() * 350;
      const h = 40 + Math.random() * 70;
      const m = new THREE.Mesh(
        new THREE.ConeGeometry(120 + Math.random() * 150, h, 5 + Math.floor(Math.random() * 3)),
        mountainMat
      );
      m.position.set(Math.cos(a) * r, h / 2 - 12, Math.sin(a) * r);
      m.rotation.y = Math.random() * Math.PI;
      m.scale.set(1 + Math.random() * 1.6, 1, 1 + Math.random() * 0.7);
      scenery.add(m);
    }

    const concrete = new THREE.MeshStandardMaterial({ color: 0x9d9c94, roughness: 0.9 });
    const whiteMetal = new THREE.MeshStandardMaterial({ color: 0xdcdcd4, metalness: 0.4, roughness: 0.5 });
    const darkSteel = new THREE.MeshStandardMaterial({ color: 0x3a3d42, metalness: 0.7, roughness: 0.5 });

    // the workshop, a big shed with a door facing the arena
    const shop = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(16, 9, 11), whiteMetal);
    body.position.y = 4.5;
    const roof = new THREE.Mesh(new THREE.BoxGeometry(17, 0.7, 12), darkSteel);
    roof.position.y = 9.3;
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.2, 7, 7), darkSteel);
    door.position.set(8.05, 3.5, 0);
    shop.add(body, roof, door);
    shop.position.set(-36, 0, 14);
    shop.rotation.y = 0.35;
    shop.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    scenery.add(shop);

    // old fuel tanks, long since drained
    const rustTank = new THREE.MeshStandardMaterial({ color: 0x9a7a5c, metalness: 0.5, roughness: 0.7 });
    for (let i = 0; i < 3; i++) {
      const tank = new THREE.Group();
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 5.5, 18), rustTank);
      barrel.position.y = 2.75;
      const cap = new THREE.Mesh(new THREE.SphereGeometry(2.2, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), rustTank);
      cap.position.y = 5.5;
      tank.add(barrel, cap);
      tank.position.set(24 + i * 5.5, 0, -18);
      tank.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      scenery.add(tank);
    }

    // low office bunker with an antenna
    const bunker = new THREE.Mesh(new THREE.BoxGeometry(5, 2.2, 4), concrete);
    bunker.position.set(28, 1.1, 24);
    bunker.castShadow = true;
    bunker.receiveShadow = true;
    const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 5, 6), darkSteel);
    antenna.position.set(28, 4.7, 24);
    scenery.add(bunker, antenna);

    // junk piles scattered around outside the barriers
    scenery.add(this.makeJunkPile(24, -6, 9));
    scenery.add(this.makeJunkPile(-25, 8, 10));
    scenery.add(this.makeJunkPile(19, 16, 7));
    scenery.add(this.makeJunkPile(-21, -15, 8));
    scenery.add(this.makeJunkPile(30, 6, 6));

    // dirt road strips leading away from the yard
    const roadMat = new THREE.MeshStandardMaterial({ color: 0x4c4438, roughness: 1 });
    const road1 = new THREE.Mesh(new THREE.PlaneGeometry(30, 2.4), roadMat);
    road1.rotation.x = -Math.PI / 2;
    road1.position.set(-25, 0.03, 8);
    road1.rotation.z = 0.18;
    const road2 = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 26), roadMat);
    road2.rotation.x = -Math.PI / 2;
    road2.position.set(18, 0.03, 16);
    road2.receiveShadow = true;
    road1.receiveShadow = true;
    scenery.add(road1, road2);

    // crushed car bales stacked into walls along two sides of the pit
    const baleMats = [
      new THREE.MeshStandardMaterial({ color: 0x8a5a3a, metalness: 0.55, roughness: 0.75 }),
      new THREE.MeshStandardMaterial({ color: 0x5c6066, metalness: 0.65, roughness: 0.6 }),
      new THREE.MeshStandardMaterial({ color: 0x6e5a42, metalness: 0.5, roughness: 0.8 }),
      new THREE.MeshStandardMaterial({ color: 0x7d4438, metalness: 0.55, roughness: 0.7 }),
    ];
    const baleGeo = new THREE.BoxGeometry(2.0, 0.55, 1.1);
    for (const side of [1, -1]) {
      for (let i = 0; i < 7; i++) {
        const a = side * Math.PI / 2 + (i - 3) * 0.17;
        const r = 19.5;
        const stack = 2 + (i % 2);
        for (let k = 0; k < stack; k++) {
          const bale = new THREE.Mesh(baleGeo, baleMats[(i + k) % baleMats.length]);
          bale.position.set(
            Math.cos(a) * r + (Math.random() - 0.5) * 0.3,
            0.29 + k * 0.58,
            Math.sin(a) * r + (Math.random() - 0.5) * 0.3
          );
          bale.rotation.y = -a + Math.PI / 2 + (Math.random() - 0.5) * 0.12;
          bale.castShadow = true;
          bale.receiveShadow = true;
          scenery.add(bale);
        }
      }
    }

    // tire stacks, because every junkyard has tire stacks
    const tireGeo = new THREE.TorusGeometry(0.42, 0.17, 8, 14);
    const tireMat = new THREE.MeshStandardMaterial({ color: 0x1d1e21, roughness: 0.95 });
    for (const [tx, tz] of [[17, -12], [-18, 12], [-16, -13], [22, 10], [-27, -3], [13, 19]]) {
      const stack = 3 + Math.floor(Math.random() * 3);
      for (let k = 0; k < stack; k++) {
        const tire = new THREE.Mesh(tireGeo, tireMat);
        tire.rotation.x = Math.PI / 2;
        tire.position.set(tx + (Math.random() - 0.5) * 0.15, 0.17 + k * 0.34, tz + (Math.random() - 0.5) * 0.15);
        tire.castShadow = true;
        scenery.add(tire);
      }
    }

    // yard crane holding a bale over the big pile, mid-drop forever
    const crane = new THREE.Group();
    const craneMat = new THREE.MeshStandardMaterial({ color: 0x8c3b2e, metalness: 0.5, roughness: 0.6 });
    const tower = new THREE.Mesh(new THREE.BoxGeometry(0.7, 13, 0.7), craneMat);
    tower.position.y = 6.5;
    tower.castShadow = true;
    const cab = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.3, 1.4), darkSteel);
    cab.position.y = 12.6;
    const boom = new THREE.Mesh(new THREE.BoxGeometry(8, 0.45, 0.5), craneMat);
    boom.position.set(3.4, 13.4, 0);
    boom.castShadow = true;
    const counter = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.9, 0.9), darkSteel);
    counter.position.set(-1.6, 13.4, 0);
    const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 8.4, 6), darkSteel);
    cable.position.set(6.8, 9, 0);
    const magnet = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.3, 16), darkSteel);
    magnet.position.set(6.8, 4.7, 0);
    magnet.castShadow = true;
    const carried = new THREE.Mesh(baleGeo, baleMats[0]);
    carried.position.set(6.8, 4.2, 0);
    carried.castShadow = true;
    crane.add(tower, cab, boom, counter, cable, magnet, carried);
    crane.position.set(30, 0, -9);
    const aim = Math.atan2(-(-6 - -9), 24 - 30);
    crane.rotation.y = aim;
    scenery.add(crane);

    // scattered rocks and scrub bushes out to the hills
    const rockGeo = new THREE.DodecahedronGeometry(1, 0);
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x7b7266, roughness: 1, flatShading: true });
    const bushGeo = new THREE.IcosahedronGeometry(0.7, 0);
    const bushMat = new THREE.MeshStandardMaterial({ color: 0x4f5438, roughness: 1, flatShading: true });
    for (let i = 0; i < 70; i++) {
      const isRock = i % 2 === 0;
      const m = new THREE.Mesh(isRock ? rockGeo : bushGeo, isRock ? rockMat : bushMat);
      const a = Math.random() * Math.PI * 2;
      const r = 26 + Math.random() * 320;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const s = isRock ? 0.3 + Math.random() * 1.4 : 0.5 + Math.random() * 0.9;
      m.scale.set(s, s * (isRock ? 0.7 : 0.8), s);
      m.position.set(x, this.hillHeight(x, z) + s * 0.3, z);
      m.rotation.y = Math.random() * Math.PI;
      if (r < 40) m.castShadow = true;
      scenery.add(m);
    }

    this.scene.add(scenery);
  }

  makeWindowTexture() {
    // one face of a tower at night: mostly dark, some floors working late
    const c = document.createElement('canvas');
    c.width = 64; c.height = 128;
    const g = c.getContext('2d');
    g.fillStyle = '#0a0e14';
    g.fillRect(0, 0, 64, 128);
    const glows = ['#ffd98a', '#9fe8ff', '#e8f4ff', '#ffb066'];
    for (let y = 6; y < 122; y += 9) {
      for (let x = 4; x < 60; x += 8) {
        if (Math.random() < 0.32) {
          g.fillStyle = glows[Math.floor(Math.random() * glows.length)];
          g.globalAlpha = 0.45 + Math.random() * 0.55;
          g.fillRect(x, y, 4, 5);
        }
      }
    }
    g.globalAlpha = 1;
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  setupCity() {
    // the city wraps most of the horizon so it is the backdrop no
    // matter where the camera drifts. the fog would eat it at this
    // hour, so the lit faces opt out of it
    const city = new THREE.Group();
    this.beacons = [];
    const winMats = [];
    for (let i = 0; i < 4; i++) {
      const tex = this.makeWindowTexture();
      winMats.push(new THREE.MeshStandardMaterial({
        color: 0x161c26, map: tex, emissiveMap: tex,
        emissive: 0xffffff, emissiveIntensity: 1.0, roughness: 0.9, fog: false,
      }));
    }
    const mastMat = new THREE.MeshStandardMaterial({ color: 0x20262e, roughness: 0.8, fog: false });
    const signColors = [0xff3fa8, 0xff8c3a, 0x4ee87c, 0x3fd8e8, 0xff8c3a, 0xff3fa8];
    let signIdx = 0;
    // dark warehouse blocks in the near ground, big towers behind
    const nearMat = new THREE.MeshStandardMaterial({ color: 0x10141a, roughness: 1, fog: false });
    for (let i = 0; i < 18; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 150 + Math.random() * 90;
      const h = 12 + Math.random() * 30;
      const b = new THREE.Mesh(
        new THREE.BoxGeometry(24 + Math.random() * 30, h, 20 + Math.random() * 26),
        nearMat
      );
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      b.position.set(x, this.hillHeight(x, z) + h / 2 - 1, z);
      b.rotation.y = Math.random() * Math.PI;
      city.add(b);
    }
    for (let i = 0; i < 76; i++) {
      if (Math.random() < 0.22) continue; // leave some ragged gaps
      const a = (i / 76) * Math.PI * 2 + (Math.random() - 0.5) * 0.06;
      const r = 300 + Math.random() * 220;
      const w = 26 + Math.random() * 44;
      const d = 26 + Math.random() * 44;
      const tall = Math.random() < 0.16;
      const h = tall ? 140 + Math.random() * 90 : 40 + Math.random() * 85;
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), winMats[i % winMats.length]);
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      b.position.set(x, this.hillHeight(x, z) + h / 2 - 2, z);
      b.rotation.y = Math.random() * Math.PI;
      city.add(b);
      if (tall) {
        // antenna mast with a blinking aircraft beacon
        const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 1.2, 20, 6), mastMat);
        mast.position.set(x, b.position.y + h / 2 + 10, z);
        const beaconMat = new THREE.MeshStandardMaterial({
          color: 0x330a0a, emissive: 0xff2a3a, emissiveIntensity: 1, fog: false,
        });
        const beacon = new THREE.Mesh(new THREE.SphereGeometry(1.8, 8, 8), beaconMat);
        beacon.position.set(x, mast.position.y + 11, z);
        city.add(mast, beacon);
        this.beacons.push({ mat: beaconMat, phase: Math.random() * Math.PI * 2 });
        // some towers carry big lit signs facing the yard
        if (signIdx < signColors.length) {
          const sc = signColors[signIdx++];
          const sign = new THREE.Mesh(
            new THREE.PlaneGeometry(w * 0.75, 16),
            new THREE.MeshStandardMaterial({
              color: sc, emissive: sc, emissiveIntensity: 1.5, side: THREE.DoubleSide, fog: false,
            })
          );
          const pull = (Math.max(w, d) / 2 + 2) / r;
          sign.position.set(x * (1 - pull), b.position.y + h * 0.2, z * (1 - pull));
          sign.lookAt(0, sign.position.y, 0);
          city.add(sign);
        }
      }
    }
    this.scene.add(city);
  }

  setupClouds() {
    // soft billboard clouds drifting over the desert
    const c = document.createElement('canvas');
    c.width = 128; c.height = 128;
    const g = c.getContext('2d');
    const blob = (x, y, r) => {
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, 'rgba(255,255,255,0.85)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, 128, 128);
    };
    blob(64, 70, 52);
    blob(40, 62, 34);
    blob(90, 60, 36);
    blob(64, 52, 30);
    const tex = new THREE.CanvasTexture(c);

    this.clouds = [];
    for (let i = 0; i < 12; i++) {
      const mat = new THREE.SpriteMaterial({
        map: tex,
        transparent: true,
        depthWrite: false,
        opacity: 0.3 + Math.random() * 0.25,
      });
      const s = new THREE.Sprite(mat);
      const a = Math.random() * Math.PI * 2;
      const r = 30 + Math.random() * 120;
      s.position.set(Math.cos(a) * r, 55 + Math.random() * 70, Math.sin(a) * r);
      const w = 24 + Math.random() * 26;
      s.scale.set(w, w * 0.32, 1);
      s.userData.drift = 0.4 + Math.random() * 1.1;
      this.clouds.push(s);
      this.scene.add(s);
    }

    // daytime moon hanging over the mountains
    const mc = document.createElement('canvas');
    mc.width = 128; mc.height = 128;
    const mg = mc.getContext('2d');
    const moonGrad = mg.createRadialGradient(64, 64, 20, 64, 64, 62);
    moonGrad.addColorStop(0, 'rgba(240,242,248,1)');
    moonGrad.addColorStop(0.8, 'rgba(230,234,242,0.9)');
    moonGrad.addColorStop(1, 'rgba(230,234,242,0)');
    mg.fillStyle = moonGrad;
    mg.fillRect(0, 0, 128, 128);
    mg.fillStyle = 'rgba(160,168,184,0.5)';
    mg.beginPath(); mg.arc(48, 52, 14, 0, Math.PI * 2); mg.fill();
    mg.beginPath(); mg.arc(78, 74, 10, 0, Math.PI * 2); mg.fill();
    mg.beginPath(); mg.arc(66, 38, 7, 0, Math.PI * 2); mg.fill();
    const moonTex = new THREE.CanvasTexture(mc);
    this.moon = new THREE.Sprite(new THREE.SpriteMaterial({
      map: moonTex,
      transparent: true,
      depthWrite: false,
      fog: false,
      opacity: 0.85,
    }));
    this.moon.scale.set(150, 150, 1);
    this.scene.add(this.moon);

    // a second, smaller moon. nobody said this was earth
    this.moon2 = new THREE.Sprite(new THREE.SpriteMaterial({
      map: moonTex,
      transparent: true,
      depthWrite: false,
      fog: false,
      color: 0xffc9a0,
      opacity: 0.6,
    }));
    this.moon2.scale.set(46, 46, 1);
    this.scene.add(this.moon2);
  }

  setupParticles() {
    // one pooled particle system for sparks, dust, and smoke
    const geo = new THREE.BufferGeometry();
    this.pPos = new Float32Array(MAX_PARTICLES * 3);
    this.pColor = new Float32Array(MAX_PARTICLES * 3);
    this.pSize = new Float32Array(MAX_PARTICLES);
    this.pAlpha = new Float32Array(MAX_PARTICLES);
    this.pVel = new Float32Array(MAX_PARTICLES * 3);
    this.pAge = new Float32Array(MAX_PARTICLES);
    this.pLife = new Float32Array(MAX_PARTICLES);
    this.pBaseSize = new Float32Array(MAX_PARTICLES);
    this.pType = new Uint8Array(MAX_PARTICLES); // 0 = spark, 1 = dust
    this.pAge.fill(999);
    this.pLife.fill(1);

    geo.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.pColor, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(this.pSize, 1));
    geo.setAttribute('alpha', new THREE.BufferAttribute(this.pAlpha, 1));

    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: `
        attribute float size;
        attribute float alpha;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vColor = color;
          vAlpha = alpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * (120.0 / -mv.z);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          float d = length(gl_PointCoord - vec2(0.5));
          if (d > 0.5) discard;
          float a = smoothstep(0.5, 0.0, d);
          gl_FragColor = vec4(vColor, a * vAlpha);
        }
      `,
      vertexColors: true,
    });
    this.particles = new THREE.Points(geo, mat);
    this.particles.frustumCulled = false;
    this.scene.add(this.particles);
    this.nextParticle = 0;
  }

  spawnParticle(origin, baseVel, spread, life, size, type = 0) {
    const i = this.nextParticle;
    this.nextParticle = (this.nextParticle + 1) % MAX_PARTICLES;
    this.pPos[i * 3] = origin.x + (Math.random() - 0.5) * 0.15;
    this.pPos[i * 3 + 1] = origin.y;
    this.pPos[i * 3 + 2] = origin.z + (Math.random() - 0.5) * 0.15;
    this.pVel[i * 3] = baseVel.x + (Math.random() - 0.5) * spread;
    this.pVel[i * 3 + 1] = baseVel.y + (Math.random() - 0.5) * spread;
    this.pVel[i * 3 + 2] = baseVel.z + (Math.random() - 0.5) * spread;
    this.pAge[i] = 0;
    this.pLife[i] = life * (0.7 + Math.random() * 0.6);
    this.pBaseSize[i] = size;
    this.pSize[i] = size;
    this.pType[i] = type;
  }

  updateParticles(dt) {
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (this.pAge[i] >= this.pLife[i]) {
        this.pSize[i] = 0;
        continue;
      }
      this.pAge[i] += dt;
      const t = Math.min(this.pAge[i] / this.pLife[i], 1);
      this.pPos[i * 3] += this.pVel[i * 3] * dt;
      this.pPos[i * 3 + 1] += this.pVel[i * 3 + 1] * dt;
      this.pPos[i * 3 + 2] += this.pVel[i * 3 + 2] * dt;
      if (this.pType[i] === 1) {
        // dust: dull tan puffs that billow out and thin away
        const f = 0.4 * (1 - t * 0.5);
        this.pColor[i * 3] = f; this.pColor[i * 3 + 1] = f * 0.9; this.pColor[i * 3 + 2] = f * 0.72;
        this.pSize[i] = this.pBaseSize[i] * (1 + t * 1.8);
        this.pAlpha[i] = 0.35 * (1 - t);
      } else if (this.pType[i] === 2) {
        // arc bolt: blue-white, snaps out fast
        const f = 1 - t;
        this.pColor[i * 3] = 0.7 + 0.3 * f;
        this.pColor[i * 3 + 1] = 0.8 + 0.2 * f;
        this.pColor[i * 3 + 2] = 1.0;
        this.pSize[i] = this.pBaseSize[i] * (0.5 + f * 0.5);
        this.pAlpha[i] = f;
      } else {
        // sparks: white-hot to electric blue to a dim tail, falling
        this.pVel[i * 3 + 1] -= 9 * dt;
        if (t < 0.2) {
          this.pColor[i * 3] = 0.88; this.pColor[i * 3 + 1] = 0.97; this.pColor[i * 3 + 2] = 1.0;
        } else if (t < 0.6) {
          this.pColor[i * 3] = 0.3; this.pColor[i * 3 + 1] = 0.75; this.pColor[i * 3 + 2] = 1.0;
        } else {
          const f = 1 - t;
          this.pColor[i * 3] = 0.1 * f; this.pColor[i * 3 + 1] = 0.3 * f; this.pColor[i * 3 + 2] = 0.65 * f;
        }
        this.pSize[i] = this.pBaseSize[i] * (1 - t * 0.55);
        this.pAlpha[i] = 1 - t * t;
      }
    }
    const g = this.particles.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.color.needsUpdate = true;
    g.attributes.size.needsUpdate = true;
    g.attributes.alpha.needsUpdate = true;
  }

  // ---- robot assembly ----

  buildRobot(design, slotName = 'you') {
    const bot = this.bots[slotName];
    this.clearBot(slotName);

    // walk the ordered stack bottom-up: drive first, then hull sections
    let y = 0;
    let hullY = 0.6;
    let hullSeen = false;
    for (const id of design.stack) {
      const g = createPartMesh(id);
      g.position.y = y;
      bot.group.add(g);
      bot.parts.push(g);
      this.collectRefs(bot, g);
      if (!hullSeen && PARTS[id].category === 'Hull') {
        hullY = y;
        hullSeen = true;
      }
      y += g.userData.height;
    }
    const topY = y;
    if (design.weapon) {
      const g = createPartMesh(design.weapon);
      g.position.y = topY;
      bot.group.add(g);
      bot.parts.push(g);
      this.collectRefs(bot, g);
      y += g.userData.height;
    }
    // armor, spikes, and the patch kit all hang off the first hull
    for (const extra of [
      design.armor,
      design.spikes ? 'spike-pair' : null,
      design.repair ? 'repair-kit' : null,
    ]) {
      if (!extra) continue;
      const g = createPartMesh(extra);
      g.position.y = hullY;
      bot.group.add(g);
      bot.parts.push(g);
    }

    bot.height = y;
    bot.dead = false;
    bot.hammerT = 0;
    bot.zapFlash = 0;
    bot.group.rotation.z = 0;
    bot.group.visible = bot.parts.length > 0;
    return y;
  }

  collectRefs(bot, g) {
    if (g.userData.spin) bot.refs.spin.push(...g.userData.spin);
    if (g.userData.spinDisc) bot.refs.saws.push(g.userData.spinDisc);
    if (g.userData.hammer) bot.refs.hammers.push(g.userData.hammer);
    if (g.userData.zapTip) bot.refs.zapTips.push(g.userData.zapTip);
    if (g.userData.pads) bot.refs.pads.push(...g.userData.pads);
  }

  clearBot(slotName) {
    const bot = this.bots[slotName];
    for (const g of bot.parts) {
      bot.group.remove(g);
      disposeGroup(g);
    }
    bot.parts = [];
    bot.refs = { spin: [], saws: [], hammers: [], zapTips: [], pads: [] };
    bot.height = 0;
    bot.dead = false;
  }

  // ---- fight events ----

  // one-shot hammer slam, played back over the next half second
  swingHammer(slotName) {
    this.bots[slotName].hammerT = 1;
  }

  // arc bolt from the zapper tip to the other robot
  zapBolt(fromSlot) {
    const from = this.bots[fromSlot];
    const to = this.bots[fromSlot === 'you' ? 'foe' : 'you'];
    if (!from.refs.zapTips.length) return;
    const a = new THREE.Vector3();
    from.refs.zapTips[0].getWorldPosition(a);
    const b = to.group.position.clone();
    b.y += 0.9;
    for (let i = 0; i < 14; i++) {
      const t = i / 13;
      const p = a.clone().lerp(b, t);
      p.y += Math.sin(t * Math.PI) * 0.4 + (Math.random() - 0.5) * 0.35;
      p.z += (Math.random() - 0.5) * 0.35;
      this.spawnParticle(p, new THREE.Vector3(0, 0, 0), 0.6, 0.22, 1.6, 2);
    }
    from.zapFlash = 1;
    this.flashT = 1;
    this.arcLight.position.copy(b);
  }

  hitSpark(slotName, dmg) {
    const bot = this.bots[slotName];
    const p = bot.group.position;
    const n = 6 + Math.min(12, Math.round(dmg / 4));
    for (let i = 0; i < n; i++) {
      this.spawnParticle(
        new THREE.Vector3(p.x, p.y + 0.9, p.z),
        new THREE.Vector3((Math.random() - 0.5) * 7, 1.5 + Math.random() * 3.5, (Math.random() - 0.5) * 7),
        2, 0.35, 1.7
      );
    }
    this.flashT = 1;
    this.shake = Math.min(1, this.shake + dmg / 80);
    this.arcLight.position.set(p.x, 2.2, p.z);
    // heavy hits knock a chunk or two loose
    if (dmg >= 25) {
      for (let i = 0; i < 1 + Math.floor(Math.random() * 2); i++) {
        const m = new THREE.Mesh(this.debrisGeo, this.debrisMats[i % 2]);
        m.scale.setScalar(0.7 + Math.random() * 0.9);
        m.position.set(p.x, p.y + 1, p.z);
        m.castShadow = true;
        this.scene.add(m);
        this.debris.push({
          mesh: m,
          vel: new THREE.Vector3((Math.random() - 0.5) * 6, 3 + Math.random() * 3.5, (Math.random() - 0.5) * 6),
          spin: (Math.random() - 0.5) * 12,
          age: 0,
        });
      }
    }
  }

  wreckBot(slotName) {
    const bot = this.bots[slotName];
    const p = bot.group.position;
    for (let i = 0; i < 110; i++) {
      this.spawnParticle(
        new THREE.Vector3(p.x, p.y + 0.5, p.z),
        new THREE.Vector3((Math.random() - 0.5) * 10, Math.random() * 8, (Math.random() - 0.5) * 10),
        3, 1.2, 4
      );
    }
    // the loser keels over and burns instead of disappearing
    bot.dead = true;
    bot.tipT = 0;
    this.shake = 1.4;
  }

  updateDebris(dt) {
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i];
      d.age += dt;
      if (d.mesh.position.y > this.arenaY + 0.07) {
        d.vel.y -= 12 * dt;
        d.mesh.position.addScaledVector(d.vel, dt);
        d.mesh.rotation.x += d.spin * dt;
        d.mesh.rotation.z += d.spin * 0.7 * dt;
        if (d.mesh.position.y < this.arenaY + 0.07) d.mesh.position.y = this.arenaY + 0.07;
      }
      if (d.age > 3.5) {
        this.scene.remove(d.mesh);
        this.debris.splice(i, 1);
      }
    }
  }

  // ---- per-frame update ----

  setMode(mode) {
    this.mode = mode;
    this.controls.enabled = mode === 'build';
    const you = this.bots.you;
    const focusY = this.arenaY + Math.max(1.2, you.height * 0.55);
    if (mode === 'build' || mode === 'title') {
      you.group.position.set(0, this.arenaY, 0);
      you.group.rotation.set(0, 0, 0);
      you.group.visible = you.parts.length > 0;
      this.bots.foe.group.visible = false;
      // coming back from a fight the camera can be off at the far end
      if (this.camera.position.length() > 26) {
        this.camera.position.set(5.5, this.arenaY + 3, 8.5);
      }
      this.camTarget.set(0, focusY, 0);
    }
    if (mode === 'build') {
      this.controls.target.set(0, focusY, 0);
    }
    if (mode === 'title') this.titleAngle = 0;
    if (mode === 'fight') {
      you.group.position.set(-12, this.arenaY, 0);
      you.group.rotation.set(0, 0, 0);
      this.bots.foe.group.position.set(12, this.arenaY, 0);
      this.bots.foe.group.rotation.set(0, Math.PI, 0);
      this.bots.foe.group.visible = true;
      // sweep up whatever the last fight left lying around
      for (const d of this.debris) this.scene.remove(d.mesh);
      this.debris = [];
    }
  }

  reduceQuality() {
    this.qualityReduced = true;
    this.bloomPass.enabled = false;
    this.renderer.setPixelRatio(1);
    this.sun.shadow.mapSize.set(1024, 1024);
    if (this.sun.shadow.map) {
      this.sun.shadow.map.dispose();
      this.sun.shadow.map = null;
    }
    this.composer.setSize(window.innerWidth, window.innerHeight);
  }

  update(dt, fight) {
    if (!this.qualityReduced && this.frameCount < 240) {
      this.frameCount++;
      if (dt > 0.04) this.slowFrames++;
      if (this.frameCount === 240 && this.slowFrames > 120) this.reduceQuality();
    }
    this.animTime += dt;

    for (const cl of this.clouds) {
      cl.position.x += cl.userData.drift * dt;
      if (cl.position.x > 160) cl.position.x = -160;
    }

    // the crowd never sits still, and sits even less still mid-fight
    const bobAmp = this.mode === 'fight' ? 0.09 : 0.03;
    for (const c of this.crowd) {
      c.mesh.position.y = c.baseY + Math.abs(Math.sin(this.animTime * 2.6 + c.phase)) * bobAmp;
    }

    // rooftop beacons blink out of step with each other
    for (const bc of this.beacons) {
      bc.mat.emissiveIntensity = 0.25 + Math.abs(Math.sin(this.animTime * 1.8 + bc.phase)) * 1.6;
    }

    if (this.mode === 'title') {
      this.titleAngle += dt * 0.12;
      const r = 7.5;
      const goal = new THREE.Vector3(
        Math.cos(this.titleAngle) * r,
        this.arenaY + 2.6 + Math.sin(this.titleAngle * 0.4) * 0.7,
        Math.sin(this.titleAngle) * r
      );
      this.camera.position.lerp(goal, 0.03);
      // aim a touch high so the skyline stays in frame behind the bot
      this.camera.lookAt(0, this.arenaY + 1.7, 0);
    } else if (this.mode === 'build') {
      this.controls.update();
    } else if (this.mode === 'fight' && fight) {
      this.updateFightVisuals(dt, fight);
    }

    // hit flash decay
    this.flashT = Math.max(0, this.flashT - dt * 5);
    this.arcLight.intensity = this.flashT * 26;

    this.updateParticles(dt);
    this.updateDebris(dt);

    // keep the sky dome and moon anchored to the camera so they read
    // as infinitely far away
    this.skyDome.position.copy(this.camera.position);
    this.moon.position.set(
      this.camera.position.x - 620,
      this.camera.position.y + 780,
      this.camera.position.z - 980
    );
    this.moon2.position.set(
      this.camera.position.x + 540,
      this.camera.position.y + 620,
      this.camera.position.z - 1050
    );

    this.composer.render();
  }

  updateFightVisuals(dt, fight) {
    for (const [slotName, sim] of [['you', fight.you], ['foe', fight.foe]]) {
      const bot = this.bots[slotName];
      if (bot.dead) {
        // topple away from the winner, then sit there smoking
        if (bot.tipT < 1) {
          bot.tipT = Math.min(1, bot.tipT + dt * 1.4);
          const fall = bot.tipT * bot.tipT;
          bot.group.rotation.z = fall * 1.25;
          bot.group.position.y = this.arenaY + Math.sin(bot.tipT * Math.PI) * 0.12;
        }
        if (Math.random() < 0.35) {
          this.spawnParticle(
            new THREE.Vector3(bot.group.position.x, this.arenaY + 0.6, bot.group.position.z),
            new THREE.Vector3(0.3, 1.3 + Math.random(), 0),
            0.7, 1.7, 3.4, 1
          );
        }
        continue;
      }
      bot.group.position.x = sim.pos;
      // rock and bounce a little while driving
      if (sim.moving && !fight.done) {
        bot.group.position.y = this.arenaY + Math.abs(Math.sin(this.animTime * 9)) * 0.045;
        bot.group.rotation.z = Math.sin(this.animTime * 9) * 0.025;
        for (const w of bot.refs.spin) w.rotateY(-sim.stats.speed * dt * 3);
        // kicked-up dust behind the wheels
        if (Math.random() < 0.5) {
          this.spawnParticle(
            new THREE.Vector3(sim.pos + Math.sign(sim.pos), this.arenaY + 0.15, 0),
            new THREE.Vector3(0, 0.6, (Math.random() - 0.5) * 1.2),
            0.8, 0.9, 2.2, 1
          );
        }
      } else {
        bot.group.position.y = this.arenaY;
        bot.group.rotation.z = 0;
      }
      // the saw never stops spinning, that is the whole point of a saw
      if (!fight.done) {
        for (const s of bot.refs.saws) s.rotateY(13 * dt);
      }
      for (const pad of bot.refs.pads) {
        pad.emissiveIntensity = 0.6 + Math.sin(this.animTime * 7) * 0.25;
      }
      // hammer slam: quick drop, slow lift back to the ready pose
      if (bot.hammerT > 0) {
        bot.hammerT = Math.max(0, bot.hammerT - dt * 2);
        const t = 1 - bot.hammerT;
        const z = t < 0.18 ? -0.35 + (t / 0.18) * 0.95 : 0.6 - ((t - 0.18) / 0.82) * 0.95;
        for (const h of bot.refs.hammers) h.rotation.z = z;
      }
      // zapper tip flares when it fires
      if (bot.zapFlash > 0) {
        bot.zapFlash = Math.max(0, bot.zapFlash - dt * 4);
        for (const tip of bot.refs.zapTips) {
          tip.material.emissiveIntensity = 0.4 + bot.zapFlash * 2.6;
        }
      }
    }

    // ringside camera: low to the dirt, drifting slowly around the
    // action, pulling in tight as the robots close
    const mid = (fight.you.pos + fight.foe.pos) / 2;
    const gap = fight.gap();
    const dist = THREE.MathUtils.clamp(5.5 + gap * 0.5, 7, 17);
    const drift = Math.sin(this.animTime * 0.11) * 0.4;
    const goal = new THREE.Vector3(
      mid + drift * dist * 0.5,
      this.arenaY + 1.6 + dist * 0.17,
      dist
    );
    this.camera.position.lerp(goal, 1 - Math.pow(0.001, dt));
    this.camTarget.lerp(new THREE.Vector3(mid, this.arenaY + 1.0, 0), 1 - Math.pow(0.0005, dt));
    // impacts rattle the camera, big ones rattle it hard
    this.shake = Math.max(0, this.shake - dt * 2.4);
    if (this.shake > 0) {
      const s = this.shake * this.shake * 0.24;
      this.camera.position.x += (Math.random() - 0.5) * s;
      this.camera.position.y += (Math.random() - 0.5) * s;
    }
    this.camera.lookAt(this.camTarget);
  }

  // screen position above a robot, for the damage numbers
  worldToScreen(slotName) {
    const bot = this.bots[slotName];
    const v = bot.group.position.clone();
    v.y += Math.max(1.3, bot.height * 0.8);
    v.project(this.camera);
    return {
      x: (v.x * 0.5 + 0.5) * window.innerWidth,
      y: (-v.y * 0.5 + 0.5) * window.innerHeight,
    };
  }

  onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.composer.setSize(window.innerWidth, window.innerHeight);
  }
}
