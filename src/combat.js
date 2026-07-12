import { PARTS } from './parts.js';

// Arcade combat, not real robotics. Everything is tuned by feel.
const ARENA_HALF = 15;   // robots get shoved around inside this
const START_POS = 12;
const MIN_GAP = 1.7;     // robots stop before their meshes overlap
const TIME_LIMIT = 75;

// the opponents are just designs built from the same part catalog,
// so their stats come out of the same math as yours
export const OPPONENTS = {
  rustbucket: {
    name: 'Rustbucket',
    desc: 'slow, dented, mostly rust',
    reward: 150,
    design: { stack: ['wheels-basic', 'chassis-small'], weapon: 'saw', armor: null, spikes: false, repair: false },
  },
  mangler: {
    name: 'The Mangler',
    desc: 'a fair fight if your build is decent',
    reward: 400,
    design: { stack: ['treads', 'chassis-medium'], weapon: 'hammer', armor: 'plates-scrap', spikes: false, repair: false },
  },
  goliath: {
    name: 'Goliath',
    desc: 'bring everything you have',
    reward: 900,
    design: { stack: ['treads', 'chassis-large'], weapon: 'hammer', armor: 'plates-steel', spikes: true, repair: false },
  },
};

// design = { stack: [], weapon, armor, spikes, repair }
// the stack is bottom-up: one drive part, then hull sections
export function computeStats(design) {
  let mass = 0, hp = 0, power = 0, regen = 0;
  const weapons = [];
  for (const id of design.stack) {
    const p = PARTS[id];
    mass += p.mass;
    if (p.hp) hp += p.hp;
    if (p.power) power = p.power;
  }
  if (design.weapon) {
    const w = PARTS[design.weapon];
    mass += w.mass;
    weapons.push({ dmg: w.damage, rate: w.rate, range: w.range, kind: design.weapon });
  }
  if (design.spikes) {
    const s = PARTS['spike-pair'];
    mass += s.mass;
    weapons.push({ dmg: s.damage, rate: s.rate, range: s.range, kind: 'spike-pair' });
  }
  if (design.armor) {
    mass += PARTS[design.armor].mass;
    hp += PARTS[design.armor].hp;
  }
  if (design.repair) {
    mass += PARTS['repair-kit'].mass;
    regen = PARTS['repair-kit'].regen;
  }
  // heavier robot, slower robot. same drive has to push all of it
  const speed = mass > 0 && power > 0 ? power / (mass * 4) : 0;
  const dps = weapons.reduce((t, w) => t + w.dmg * w.rate, 0);
  const reach = weapons.reduce((t, w) => Math.max(t, w.range), 0);
  return {
    mass: Math.round(mass),
    hp, power, regen, weapons, dps, reach,
    speed: Math.round(speed * 100) / 100,
  };
}

export function validateDesign(design) {
  const stack = design.stack;
  const drives = stack.filter((id) => PARTS[id].category === 'Drive');
  if (drives.length === 0) return 'It needs wheels or treads to move.';
  if (drives.length > 1) return 'One drive is plenty.';
  if (PARTS[stack[0]].category !== 'Drive') return 'The drive goes at the bottom.';
  if (!stack.some((id) => PARTS[id].category === 'Hull')) return 'It needs a hull section to bolt things to.';
  if (!design.weapon && !design.spikes) return 'No weapon fitted. Give it something to swing.';
  const s = computeStats(design);
  if (s.speed < 0.7) return 'Too heavy to move. Drop some armor or upgrade the drive.';
  return null;
}

function makeBot(stats, pos) {
  return {
    stats, pos,
    hp: stats.hp,
    maxHp: stats.hp,
    // stagger the first swings so both robots do not hit in sync
    weapons: stats.weapons.map((w) => ({ ...w, timer: 0.3 + Math.random() * 0.5 })),
    moving: false,
  };
}

export class Fight {
  constructor(design, oppId) {
    this.design = design;
    this.oppId = oppId;
    this.you = makeBot(computeStats(design), -START_POS);
    this.foe = makeBot(computeStats(OPPONENTS[oppId].design), START_POS);

    this.time = 0;
    this.held = false;
    this.done = false;
    this.events = []; // renderer/audio consume these each step
    this.result = null;
    this.dmgDealt = 0;
    this.dmgTaken = 0;
    this.firstBlood = null;

    // hull samples over time for the results graph
    this.track = [[0, 1, 1]];
    this.lastSample = 0;
  }

  hullFracs() {
    return [
      Math.max(0, this.you.hp) / this.you.maxHp,
      Math.max(0, this.foe.hp) / this.foe.maxHp,
    ];
  }

  gap() {
    return Math.abs(this.you.pos - this.foe.pos);
  }

  step(dt) {
    if (this.done || this.held) return;
    this.time += dt;
    this.events.length = 0;

    // both robots drive in until their longest weapon can touch
    for (const [me, other] of [[this.you, this.foe], [this.foe, this.you]]) {
      me.moving = false;
      if (me.stats.reach > 0 && this.gap() > me.stats.reach) {
        const d = Math.sign(other.pos - me.pos) || 1;
        me.pos += d * me.stats.speed * dt;
        if ((other.pos - me.pos) * d < MIN_GAP) me.pos = other.pos - d * MIN_GAP;
        me.moving = true;
      }
      if (me.stats.regen > 0 && me.hp > 0) {
        me.hp = Math.min(me.maxHp, me.hp + me.stats.regen * dt);
      }
    }

    // every weapon in range swings on its own clock. the clock only
    // runs while the target is close, so there is a beat between
    // contact and the first hit
    for (const [me, other, tag] of [[this.you, this.foe, 'you'], [this.foe, this.you, 'foe']]) {
      for (const w of me.weapons) {
        if (this.gap() > w.range) continue;
        w.timer -= dt;
        if (w.timer <= 0) {
          w.timer = 1 / w.rate;
          other.hp -= w.dmg;
          // big hits shove the target back a little
          const d = Math.sign(other.pos - me.pos) || 1;
          other.pos = Math.max(-ARENA_HALF, Math.min(ARENA_HALF, other.pos + d * w.dmg * 0.015));
          if (tag === 'you') this.dmgDealt += w.dmg;
          else this.dmgTaken += w.dmg;
          if (!this.firstBlood) this.firstBlood = tag;
          this.events.push({
            type: 'hit',
            target: tag === 'you' ? 'foe' : 'you',
            kind: w.kind,
            dmg: w.dmg,
          });
        }
      }
    }

    if (this.time - this.lastSample >= 0.25 && this.track.length < 400) {
      this.lastSample = this.time;
      const [a, b] = this.hullFracs();
      this.track.push([this.time, a, b]);
    }

    const youDead = this.you.hp <= 0;
    const foeDead = this.foe.hp <= 0;
    if (youDead || foeDead) {
      let winner;
      if (youDead && foeDead) winner = this.you.hp >= this.foe.hp ? 'you' : 'foe';
      else winner = youDead ? 'foe' : 'you';
      this.events.push({ type: 'ko', target: winner === 'you' ? 'foe' : 'you' });
      this.finish(winner, false);
    } else if (this.time >= TIME_LIMIT) {
      // out of time: whoever kept more of their hull wins
      const a = this.you.hp / this.you.maxHp;
      const b = this.foe.hp / this.foe.maxHp;
      const winner = Math.abs(a - b) < 0.03 ? 'draw' : a > b ? 'you' : 'foe';
      this.events.push({ type: 'decision', winner });
      this.finish(winner, true);
    }
  }

  finish(winner, decision) {
    this.done = true;
    const [a, b] = this.hullFracs();
    this.track.push([this.time, a, b]);
    this.result = {
      track: this.track,
      winner,
      decision,
      opp: this.oppId,
      time: Math.round(this.time),
      dmgDealt: Math.round(this.dmgDealt),
      dmgTaken: Math.round(this.dmgTaken),
      hpFrac: Math.max(0, this.you.hp) / this.you.maxHp,
      foeHpFrac: Math.max(0, this.foe.hp) / this.foe.maxHp,
    };
  }
}

// one-time badges, checked against the fight after every result
export const ACHIEVEMENTS = [
  {
    id: 'first-win', name: 'Still Standing',
    desc: 'win a fight',
    test: (r) => r.winner === 'you',
  },
  {
    id: 'not-a-scratch', name: 'Not a Scratch',
    desc: 'win while losing under a tenth of your hull',
    test: (r, f) => r.winner === 'you' && r.dmgTaken <= f.you.maxHp * 0.1,
  },
  {
    id: 'quick-work', name: 'Quick Work',
    desc: 'win a fight inside 12 seconds',
    test: (r) => r.winner === 'you' && r.time <= 12,
  },
  {
    id: 'photo-finish', name: 'Photo Finish',
    desc: 'win with under a tenth of your hull left',
    test: (r) => r.winner === 'you' && r.hpFrac > 0 && r.hpFrac <= 0.1,
  },
  {
    id: 'punching-up', name: 'Punching Up',
    desc: 'beat Goliath with a robot under 130 kg',
    test: (r, f) => r.winner === 'you' && r.opp === 'goliath' && f.you.stats.mass <= 130,
  },
  {
    id: 'glass-cannon', name: 'Glass Cannon',
    desc: 'win with no armor fitted',
    test: (r, f) => r.winner === 'you' && !f.design.armor,
  },
  {
    id: 'absolute-unit', name: 'Absolute Unit',
    desc: 'win with a robot over 300 kg',
    test: (r, f) => r.winner === 'you' && f.you.stats.mass >= 300,
  },
  {
    id: 'beaten-by-rusty', name: 'Beaten by a Rustbucket',
    desc: 'lose to the easiest robot in the yard',
    test: (r) => r.winner === 'foe' && r.opp === 'rustbucket',
  },
];

export function scoreFight(oppId, result) {
  const opp = OPPONENTS[oppId];
  let score = 0;
  if (result.winner === 'you') {
    score = opp.reward + Math.round(result.hpFrac * 200);
    if (result.time <= 15) score += 100; // no dawdling bonus
  } else {
    // losing still pays a little, scrap dealer rates
    score = Math.round(result.dmgDealt / 4);
  }
  return Math.max(0, score);
}
