import * as THREE from 'three';

// All gameplay stats are plain integers. Mass in kg-ish arcade units,
// damage per hit, range in meters, drive power in watt-ish units.
// cost = points needed to unlock (0 = starter part).

export const PARTS = {
  'wheels-basic': {
    name: 'Junk Wheels', category: 'Drive',
    mass: 20, power: 900, cost: 0,
    desc: 'mass 20 / power 900',
  },
  'treads': {
    name: 'Tank Treads', category: 'Drive',
    mass: 45, power: 1400, hp: 40, cost: 500,
    desc: 'mass 45 / power 1400 / hull +40',
  },
  'hover': {
    name: 'Hover Pads', category: 'Drive',
    mass: 15, power: 1700, cost: 1200,
    desc: 'mass 15 / power 1700',
  },
  'chassis-small': {
    name: 'Scrap Frame', category: 'Hull',
    mass: 30, hp: 80, cost: 0,
    desc: 'mass 30 / hull 80',
  },
  'chassis-medium': {
    name: 'Steel Hull', category: 'Hull',
    mass: 55, hp: 170, cost: 250,
    desc: 'mass 55 / hull 170',
  },
  'chassis-large': {
    name: 'Forge Hull', category: 'Hull',
    mass: 90, hp: 320, cost: 800,
    desc: 'mass 90 / hull 320',
  },
  'saw': {
    name: 'Rip Saw', category: 'Weapon',
    mass: 25, damage: 12, rate: 2, range: 2.5, cost: 0,
    desc: 'dmg 24 per s / short reach',
  },
  'hammer': {
    name: 'Drop Hammer', category: 'Weapon',
    mass: 40, damage: 48, rate: 0.5, range: 3, cost: 400,
    desc: 'dmg 24 per s / big single hits',
  },
  'zapper': {
    name: 'Arc Zapper', category: 'Weapon',
    mass: 30, damage: 9, rate: 1.4, range: 9, cost: 900,
    desc: 'dmg 13 per s / reach 9',
  },
  'spike-pair': {
    name: 'Side Spikes', category: 'Weapon',
    mass: 20, damage: 7, rate: 1, range: 2.6, cost: 500,
    desc: 'dmg +7 per s up close',
  },
  'plates-scrap': {
    name: 'Scrap Plates', category: 'Armor',
    mass: 25, hp: 80, cost: 0,
    desc: 'mass 25 / hull +80',
  },
  'plates-steel': {
    name: 'Steel Plates', category: 'Armor',
    mass: 45, hp: 170, cost: 300,
    desc: 'mass 45 / hull +170',
  },
  'repair-kit': {
    name: 'Patch Kit', category: 'Utility',
    mass: 12, regen: 3, cost: 600,
    desc: 'mass 12 / fixes 3 hull per s',
  },
};

export const CATEGORY_ORDER = ['Drive', 'Hull', 'Weapon', 'Armor', 'Utility'];

// ---- materials ----

// hull texture drawn on a canvas: panel seams, rivets, rust blotches,
// and a hazard stripe band so it reads as yard-built metal instead of
// a solid color
let hullMap = null;
let hullRough = null;

function drawSeams(g, size, vStep, hStep) {
  g.strokeStyle = 'rgba(52,58,68,0.5)';
  g.lineWidth = 2;
  for (let x = 0; x <= size; x += vStep) {
    g.beginPath(); g.moveTo(x, 0); g.lineTo(x, size); g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.25)';
    g.beginPath(); g.moveTo(x + 2, 0); g.lineTo(x + 2, size); g.stroke();
    g.strokeStyle = 'rgba(52,58,68,0.5)';
  }
  for (let y = 0; y <= size; y += hStep) {
    g.beginPath(); g.moveTo(0, y); g.lineTo(size, y); g.stroke();
  }
  g.fillStyle = 'rgba(60,64,72,0.55)';
  for (let x = 0; x <= size; x += vStep) {
    for (let y = 10; y < size; y += 26) {
      g.beginPath(); g.arc((x + 7) % size, y, 2, 0, Math.PI * 2); g.fill();
    }
  }
}

function getHullTextures() {
  if (hullMap) return { map: hullMap, rough: hullRough };
  const c = document.createElement('canvas');
  c.width = 512; c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#a7abb0';
  g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 900; i++) {
    const x = Math.random() * 512;
    g.strokeStyle = 'rgba(' + (Math.random() < 0.5 ? '255,255,255' : '18,22,30') + ',' + (Math.random() * 0.05).toFixed(3) + ')';
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x + (Math.random() - 0.5) * 8, 512);
    g.stroke();
  }
  drawSeams(g, 512, 128, 170);
  // hazard stripe band near the top
  g.save();
  g.beginPath();
  g.rect(0, 26, 512, 20);
  g.clip();
  for (let x = -40; x < 552; x += 24) {
    g.fillStyle = x % 48 === 8 ? '#c9a227' : '#1d1e22';
    g.beginPath();
    g.moveTo(x, 46); g.lineTo(x + 12, 26); g.lineTo(x + 24, 26); g.lineTo(x + 12, 46);
    g.fill();
  }
  g.restore();
  // rust bleeding out of seams and bolt holes
  for (let i = 0; i < 46; i++) {
    const x = Math.random() * 512;
    const y = Math.random() * 512;
    const r = 6 + Math.random() * 26;
    const rust = g.createRadialGradient(x, y, 1, x, y, r);
    rust.addColorStop(0, 'rgba(122,64,34,' + (0.12 + Math.random() * 0.18).toFixed(2) + ')');
    rust.addColorStop(1, 'rgba(122,64,34,0)');
    g.fillStyle = rust;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // grime streaks running down from the horizontal seams
  for (let i = 0; i < 40; i++) {
    const x = Math.random() * 512;
    const y = 170 * (1 + Math.floor(Math.random() * 2));
    const len = 24 + Math.random() * 60;
    const streak = g.createLinearGradient(0, y, 0, y + len);
    streak.addColorStop(0, 'rgba(48,44,38,0.16)');
    streak.addColorStop(1, 'rgba(48,44,38,0)');
    g.fillStyle = streak;
    g.fillRect(x, y, 2 + Math.random() * 3, len);
  }
  hullMap = new THREE.CanvasTexture(c);
  hullMap.colorSpace = THREE.SRGBColorSpace;

  const rc = document.createElement('canvas');
  rc.width = 256; rc.height = 256;
  const rg = rc.getContext('2d');
  rg.fillStyle = '#8c8c8c';
  rg.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 400; i++) {
    const x = Math.random() * 256;
    rg.strokeStyle = 'rgba(' + (Math.random() < 0.5 ? '230,230,230' : '90,90,90') + ',' + (0.05 + Math.random() * 0.1).toFixed(3) + ')';
    rg.beginPath();
    rg.moveTo(x, 0);
    rg.lineTo(x + (Math.random() - 0.5) * 20, 256);
    rg.stroke();
  }
  hullRough = new THREE.CanvasTexture(rc);
  return { map: hullMap, rough: hullRough };
}

function hullMaterial() {
  const t = getHullTextures();
  return new THREE.MeshStandardMaterial({
    map: t.map,
    roughnessMap: t.rough,
    bumpMap: t.map,
    bumpScale: 0.01,
    metalness: 0.75,
    roughness: 0.6,
  });
}

function darkMetal() {
  return new THREE.MeshStandardMaterial({
    color: 0x3a3d42, metalness: 0.9, roughness: 0.4,
  });
}

function rubber() {
  return new THREE.MeshStandardMaterial({
    color: 0x1c1d20, metalness: 0.1, roughness: 0.92,
  });
}

function paintedMaterial(color) {
  return new THREE.MeshStandardMaterial({
    color, metalness: 0.3, roughness: 0.55,
  });
}

function rustMetal() {
  return new THREE.MeshStandardMaterial({
    color: 0x7a4a30, metalness: 0.6, roughness: 0.7,
  });
}

function copperPipe() {
  return new THREE.MeshStandardMaterial({
    color: 0x8a5a3a, metalness: 0.9, roughness: 0.35,
  });
}

// ---- mesh builders ----
// Each returns a THREE.Group. group.userData.height is the stacking
// height, so the assembler knows how far up the next part goes.
// Robots are built facing +x.

function buildWheels() {
  const g = new THREE.Group();
  const axle = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.26, 0.7), darkMetal());
  axle.position.y = 0.4;
  g.add(axle);
  const wheelGeo = new THREE.CylinderGeometry(0.3, 0.3, 0.16, 18);
  const hubGeo = new THREE.CylinderGeometry(0.12, 0.12, 0.18, 10);
  const rub = rubber();
  const hubMat = darkMetal();
  g.userData.spin = [];
  for (const [wx, wz] of [[-0.32, -0.48], [0.32, -0.48], [-0.32, 0.48], [0.32, 0.48]]) {
    const wheel = new THREE.Mesh(wheelGeo, rub);
    wheel.rotation.x = Math.PI / 2;
    wheel.position.set(wx, 0.3, wz);
    const hub = new THREE.Mesh(hubGeo, hubMat);
    wheel.add(hub);
    g.add(wheel);
    g.userData.spin.push(wheel);
  }
  g.userData.height = 0.55;
  return g;
}

function buildTreads() {
  const g = new THREE.Group();
  const rub = rubber();
  g.userData.spin = [];
  for (const side of [-1, 1]) {
    const tread = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.5, 0.34), rub);
    tread.position.set(0, 0.28, side * 0.45);
    g.add(tread);
    // drive sprockets showing on the outer face
    for (const sx of [-0.5, 0, 0.5]) {
      const sprocket = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.06, 12), darkMetal());
      sprocket.rotation.x = Math.PI / 2;
      sprocket.position.set(sx, 0.28, side * 0.64);
      g.add(sprocket);
      g.userData.spin.push(sprocket);
    }
  }
  const fender = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.12, 1.15), darkMetal());
  fender.position.y = 0.56;
  g.add(fender);
  g.userData.height = 0.62;
  return g;
}

function buildHover() {
  const g = new THREE.Group();
  const skirt = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.78, 0.2, 24), darkMetal());
  skirt.position.y = 0.22;
  const deck = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.62, 0.16, 24), hullMaterial());
  deck.position.y = 0.4;
  g.add(skirt, deck);
  g.userData.pads = [];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const pad = new THREE.Mesh(
      new THREE.CylinderGeometry(0.13, 0.16, 0.08, 12),
      new THREE.MeshStandardMaterial({
        color: 0x24262b, emissive: 0xff7a2a, emissiveIntensity: 0.8,
      })
    );
    pad.position.set(Math.cos(a) * 0.4, 0.1, Math.sin(a) * 0.4);
    g.add(pad);
    g.userData.pads.push(pad.material);
  }
  g.userData.height = 0.5;
  return g;
}

function buildChassis(h) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.05, h, 0.85), hullMaterial());
  body.position.y = h / 2;
  g.add(body);
  // corner posts so stacked hulls read as separate sections
  for (const [px, pz] of [[-0.5, -0.4], [0.5, -0.4], [-0.5, 0.4], [0.5, 0.4]]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.09, h, 0.09), darkMetal());
    post.position.set(px, h / 2, pz);
    g.add(post);
  }
  // vents on the front face
  for (const vy of [0.3, 0.5]) {
    const vent = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.06, 0.4), rubber());
    vent.position.set(0.54, h * vy, 0);
    g.add(vent);
  }
  g.userData.height = h;
  return g;
}

function buildSaw() {
  const g = new THREE.Group();
  const mount = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.24, 0.4), darkMetal());
  mount.position.set(0.1, 0.12, 0);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.14, 0.18), rustMetal());
  arm.position.set(0.55, 0.02, 0);
  arm.rotation.z = -0.35;
  g.add(mount, arm);
  // the disc is a group so the teeth spin with it
  const disc = new THREE.Group();
  const blade = new THREE.Mesh(new THREE.CylinderGeometry(0.48, 0.48, 0.05, 24), darkMetal());
  disc.add(blade);
  const toothGeo = new THREE.BoxGeometry(0.12, 0.06, 0.1);
  const toothMat = new THREE.MeshStandardMaterial({ color: 0xb9bec6, metalness: 0.85, roughness: 0.3 });
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const tooth = new THREE.Mesh(toothGeo, toothMat);
    tooth.position.set(Math.cos(a) * 0.5, 0, Math.sin(a) * 0.5);
    tooth.rotation.y = -a;
    disc.add(tooth);
  }
  disc.rotation.x = Math.PI / 2;
  disc.position.set(0.95, -0.12, 0);
  g.add(disc);
  g.userData.spinDisc = disc;
  g.userData.height = 0.3;
  return g;
}

function buildHammer() {
  const g = new THREE.Group();
  // a-frame posts holding the pivot up
  for (const side of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.9, 0.12), rustMetal());
    post.position.set(0, 0.42, side * 0.3);
    post.rotation.x = side * -0.18;
    g.add(post);
  }
  const pivot = new THREE.Group();
  pivot.position.set(0, 0.82, 0);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.13, 0.13), darkMetal());
  arm.position.x = 0.6;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.42, 0.34), darkMetal());
  head.position.set(1.2, -0.1, 0);
  const face = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.44, 0.36), paintedMaterial(0xc9a227));
  face.position.set(1.4, -0.1, 0);
  pivot.add(arm, head, face);
  pivot.rotation.z = -0.35;
  g.add(pivot);
  g.userData.hammer = pivot;
  g.userData.height = 1.0;
  return g;
}

function buildZapper() {
  const g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.3, 0.44), darkMetal());
  base.position.y = 0.15;
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.9, 10), darkMetal());
  mast.position.set(0.16, 0.65, 0);
  mast.rotation.z = -0.35;
  g.add(base, mast);
  // coil rings up the mast
  for (let i = 0; i < 3; i++) {
    const coil = new THREE.Mesh(new THREE.TorusGeometry(0.1 + i * 0.015, 0.02, 8, 16), copperPipe());
    coil.position.set(0.16 + i * 0.1, 0.5 + i * 0.24, 0);
    coil.rotation.z = -0.35;
    coil.rotation.x = Math.PI / 2;
    g.add(coil);
  }
  const tipMat = new THREE.MeshStandardMaterial({
    color: 0x24262b, metalness: 0.9, roughness: 0.3,
    emissive: new THREE.Color(0xff5a1f), emissiveIntensity: 0.4,
  });
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 10), tipMat);
  tip.position.set(0.48, 1.06, 0);
  g.add(tip);
  g.userData.zapTip = tip;
  g.userData.height = 1.15;
  return g;
}

function buildSpikes() {
  const g = new THREE.Group();
  const coneGeo = new THREE.ConeGeometry(0.07, 0.45, 8);
  const mat = new THREE.MeshStandardMaterial({ color: 0xb9bec6, metalness: 0.85, roughness: 0.3 });
  for (const side of [-1, 1]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.14, 0.08), rustMetal());
    rail.position.set(0.1, 0.3, side * 0.52);
    g.add(rail);
    for (const sx of [-0.2, 0.15, 0.5]) {
      const spike = new THREE.Mesh(coneGeo, mat);
      spike.rotation.z = -Math.PI / 2;
      spike.position.set(sx + 0.25, 0.3, side * 0.52);
      g.add(spike);
    }
  }
  g.userData.height = 0;
  return g;
}

function buildArmor(id) {
  const g = new THREE.Group();
  if (id === 'plates-scrap') {
    // mismatched plates bolted on at slightly wrong angles
    const mats = [rustMetal(), darkMetal(), paintedMaterial(0x6b6f74)];
    const spots = [
      [0.58, 0, 0, 0.1, 0.62, 0.7],
      [-0.58, 0, 0, 0.1, 0.56, 0.66],
      [0, 0, 0.48, 0.8, 0.58, 0.1],
      [0, 0, -0.48, 0.74, 0.52, 0.1],
    ];
    spots.forEach(([px, py, pz, sx, sy, sz], i) => {
      const plate = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mats[i % mats.length]);
      plate.position.set(px, 0.34 + py, pz);
      plate.rotation.z = (Math.random() - 0.5) * 0.12;
      plate.rotation.y = (Math.random() - 0.5) * 0.08;
      g.add(plate);
    });
  } else {
    const mat = new THREE.MeshStandardMaterial({ color: 0x4a4f57, metalness: 0.7, roughness: 0.45 });
    const boltMat = darkMetal();
    const spots = [
      [0.6, 0, 0, 0.1, 0.7, 0.78],
      [-0.6, 0, 0, 0.1, 0.7, 0.78],
      [0, 0, 0.5, 0.9, 0.7, 0.1],
      [0, 0, -0.5, 0.9, 0.7, 0.1],
    ];
    for (const [px, py, pz, sx, sy, sz] of spots) {
      const plate = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
      plate.position.set(px, 0.36 + py, pz);
      g.add(plate);
      for (const b of [-0.22, 0.22]) {
        const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.05, 8), boltMat);
        bolt.rotation.z = pz === 0 ? Math.PI / 2 : 0;
        if (pz !== 0) bolt.rotation.x = Math.PI / 2;
        bolt.position.set(px + (pz === 0 ? px * 0.06 : b), 0.36 + b * 0.8, pz + pz * 0.06);
        g.add(bolt);
      }
    }
  }
  g.userData.height = 0;
  return g;
}

function buildRepairKit() {
  const g = new THREE.Group();
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.28, 0.4), paintedMaterial(0xd6a13a));
  box.position.set(-0.62, 0.36, 0);
  const light = new THREE.Mesh(
    new THREE.CylinderGeometry(0.04, 0.04, 0.05, 8),
    new THREE.MeshStandardMaterial({ color: 0x2e7d4a, emissive: 0x2e7d4a, emissiveIntensity: 0.9 })
  );
  light.position.set(-0.62, 0.53, 0);
  g.add(box, light);
  g.userData.height = 0;
  return g;
}

export function createPartMesh(id) {
  let g;
  if (id === 'wheels-basic') g = buildWheels();
  else if (id === 'treads') g = buildTreads();
  else if (id === 'hover') g = buildHover();
  else if (id === 'chassis-small') g = buildChassis(0.65);
  else if (id === 'chassis-medium') g = buildChassis(1.0);
  else if (id === 'chassis-large') g = buildChassis(1.5);
  else if (id === 'saw') g = buildSaw();
  else if (id === 'hammer') g = buildHammer();
  else if (id === 'zapper') g = buildZapper();
  else if (id === 'spike-pair') g = buildSpikes();
  else if (id.startsWith('plates')) g = buildArmor(id);
  else if (id === 'repair-kit') g = buildRepairKit();
  else g = new THREE.Group();

  g.userData.partId = id;
  g.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  return g;
}

// free GPU memory when a part is removed or the robot is rebuilt
export function disposeGroup(group) {
  group.traverse((o) => {
    if (o.isMesh) {
      o.geometry.dispose();
      // shared hull textures stay cached on purpose
      if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
      else o.material.dispose();
    }
  });
}
