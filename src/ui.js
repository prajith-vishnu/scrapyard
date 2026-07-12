import { PARTS, CATEGORY_ORDER } from './parts.js';
import { computeStats, validateDesign, OPPONENTS } from './combat.js';
import { audio } from './audio.js';

const $ = (id) => document.getElementById(id);

// ---- persistent state ----

export function loadSave() {
  let save;
  try {
    save = JSON.parse(localStorage.getItem('sy-save')) || {};
  } catch {
    save = {};
  }
  return {
    points: save.points ?? 0,
    unlocked: save.unlocked ?? [],
    best: save.best ?? { rustbucket: 0, mangler: 0, goliath: 0 },
    wins: save.wins ?? 0,
  };
}

export function storeSave(save) {
  localStorage.setItem('sy-save', JSON.stringify(save));
}

export function isUnlocked(save, id) {
  return PARTS[id].cost === 0 || save.unlocked.includes(id);
}

// ---- screen switching ----

const SCREENS = ['title-screen', 'build-ui', 'battle-ui', 'results-screen', 'unlocks-screen'];

export function showScreen(name) {
  for (const s of SCREENS) $(s).classList.toggle('hidden', s !== name);
}

// ---- build mode UI ----

export function renderPalette(save, design, onAdd) {
  const list = $('palette-list');
  list.innerHTML = '';
  for (const cat of CATEGORY_ORDER) {
    const label = document.createElement('div');
    label.className = 'part-category';
    label.textContent = cat;
    list.appendChild(label);
    for (const [id, p] of Object.entries(PARTS)) {
      if (p.category !== cat) continue;
      const btn = document.createElement('button');
      btn.className = 'part-btn';
      const owned = isUnlocked(save, id);
      const active =
        design.stack.includes(id) ||
        design.weapon === id || design.armor === id ||
        (id === 'spike-pair' && design.spikes) ||
        (id === 'repair-kit' && design.repair);
      if (active) btn.classList.add('active');
      btn.innerHTML =
        '<span>' + p.name + '</span>' +
        '<span class="part-sub">' + (owned ? p.desc : 'locked - ' + p.cost + ' pts') + '</span>';
      if (owned) {
        btn.addEventListener('click', () => { audio.click(); onAdd(id); });
        btn.addEventListener('mouseenter', () => audio.hover());
      } else {
        btn.classList.add('locked');
      }
      list.appendChild(btn);
    }
  }
}

export function renderStack(design, onRemove) {
  const list = $('stack-list');
  list.innerHTML = '';
  const rows = [];
  if (design.weapon) rows.push({ key: 'weapon', label: PARTS[design.weapon].name });
  if (design.repair) rows.push({ key: 'repair', label: PARTS['repair-kit'].name });
  // the stack is stored bottom-up, the list reads top-down
  for (let i = design.stack.length - 1; i >= 0; i--) {
    rows.push({ key: 'stack:' + i, label: PARTS[design.stack[i]].name });
  }
  if (design.armor) rows.push({ key: 'armor', label: PARTS[design.armor].name });
  if (design.spikes) rows.push({ key: 'spikes', label: PARTS['spike-pair'].name });

  if (rows.length === 0) {
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent = 'Empty bench. Add parts from the left.';
    list.appendChild(p);
    return;
  }
  for (const row of rows) {
    const btn = document.createElement('button');
    btn.className = 'stack-item';
    btn.textContent = row.label;
    btn.addEventListener('click', () => { audio.click(); onRemove(row.key); });
    list.appendChild(btn);
  }
}

export function renderStats(design) {
  const s = computeStats(design);
  $('stat-mass').textContent = s.mass + ' kg';
  $('stat-hp').textContent = s.hp + ' hp';
  $('stat-dmg').textContent = s.dps > 0 ? Math.round(s.dps) + ' per s' : '-';
  $('stat-reach').textContent = s.reach > 0 ? s.reach.toFixed(1) + ' m' : '-';

  const spEl = $('stat-speed');
  spEl.textContent = s.speed > 0 ? s.speed.toFixed(1) + ' m/s' : '-';
  spEl.className = s.speed >= 2 ? 'stat-good' : s.speed >= 1.2 ? '' : 'stat-bad';

  const warning = validateDesign(design);
  const warnEl = $('build-warning');
  warnEl.textContent = warning || '';
  $('btn-fight').disabled = !!warning;
}

export function renderOpponentPicker(current, onPick) {
  const box = $('opponent-picker');
  box.innerHTML = '';
  for (const [id, o] of Object.entries(OPPONENTS)) {
    const s = computeStats(o.design);
    const btn = document.createElement('button');
    btn.className = 'opp-btn' + (id === current ? ' active' : '');
    btn.innerHTML =
      '<span>' + o.name + '</span>' +
      '<span class="part-sub">' + o.desc + '</span>' +
      '<span class="part-sub">hull ' + s.hp + ' / dmg ' + Math.round(s.dps) + ' per s</span>';
    btn.addEventListener('click', () => { audio.click(); onPick(id); });
    box.appendChild(btn);
  }
}

// ---- battle readout ----

export function setFoeName(name) {
  $('foe-name').textContent = name;
}

export function updateBattleReadout(fight) {
  const youFrac = Math.max(0, fight.you.hp) / fight.you.maxHp;
  const foeFrac = Math.max(0, fight.foe.hp) / fight.foe.maxHp;
  $('bt-you-hp').textContent = Math.max(0, Math.round(fight.you.hp)) + ' / ' + fight.you.maxHp;
  $('bt-foe-hp').textContent = Math.max(0, Math.round(fight.foe.hp)) + ' / ' + fight.foe.maxHp;
  $('bt-you-fill').style.width = (youFrac * 100) + '%';
  $('bt-foe-fill').style.width = (foeFrac * 100) + '%';
  $('bt-time').textContent = Math.floor(fight.time) + ' s';
}

let eventTimer = null;
export function flashEvent(text) {
  const el = $('fight-event');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(eventTimer);
  eventTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

// ---- results ----

// hull-over-time plot for both robots. red ink is you, gray is them,
// a dot marks the moment the loser went down
function drawFightGraph(result) {
  const canvas = $('res-graph');
  if (!canvas) return;
  const track = result.track;
  if (!track || track.length < 2) {
    canvas.classList.add('hidden');
    return;
  }
  canvas.classList.remove('hidden');
  const g = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  g.clearRect(0, 0, W, H);

  const tMax = Math.max(track[track.length - 1][0], 1);
  const L = 8, R = 8, T = 16, B = 8;
  const X = (t) => L + (t / tMax) * (W - L - R);
  const Y = (f) => T + (1 - f) * (H - T - B);

  // faint gridlines, printed-chart style
  g.strokeStyle = 'rgba(26,27,29,0.14)';
  g.lineWidth = 1;
  for (let i = 1; i <= 3; i++) {
    const y = T + ((H - T - B) / 4) * i;
    g.beginPath(); g.moveTo(L, y); g.lineTo(W - R, y); g.stroke();
  }
  // the floor
  g.strokeStyle = 'rgba(26,27,29,0.5)';
  g.beginPath(); g.moveTo(L, Y(0)); g.lineTo(W - R, Y(0)); g.stroke();

  for (const [idx, color] of [[2, '#6f6a5a'], [1, '#d8451f']]) {
    g.strokeStyle = color;
    g.lineWidth = 2;
    g.beginPath();
    track.forEach((p, i) => (i ? g.lineTo(X(p[0]), Y(p[idx])) : g.moveTo(X(p[0]), Y(p[idx]))));
    g.stroke();
  }

  // dot where the loser went down
  if (result.winner !== 'draw' && !result.decision) {
    const last = track[track.length - 1];
    const idx = result.winner === 'you' ? 2 : 1;
    g.fillStyle = '#1a1b1d';
    g.beginPath();
    g.arc(X(last[0]), Y(Math.max(0, last[idx])), 3.5, 0, Math.PI * 2);
    g.fill();
  }

  g.font = '10px ui-monospace, Menlo, Consolas, monospace';
  g.fillStyle = '#d8451f';
  g.fillText('you', L + 2, 11);
  g.fillStyle = '#6f6a5a';
  g.fillText('them', L + 32, 11);
}

export function renderResults(oppId, result, score, save, isBest) {
  drawFightGraph(result);
  $('results-heading').textContent =
    result.winner === 'you' ? 'Victory' : result.winner === 'draw' ? 'Draw' : 'Wrecked';
  $('res-opp').textContent = OPPONENTS[oppId].name;
  $('res-time').textContent = result.time + ' s' + (result.decision ? ' (decision)' : '');
  $('res-dealt').textContent = result.dmgDealt + ' hp';
  $('res-taken').textContent = result.dmgTaken + ' hp';
  $('res-score').textContent = String(score);
  $('res-best').textContent = isBest
    ? 'New best against this opponent.'
    : 'Best against this opponent: ' + save.best[oppId];
  $('res-points').textContent = 'Points earned: ' + score + ' (total ' + save.points + ')';
}

// ---- unlocks ----

export function renderUnlocks(save, onBuy) {
  $('unlock-points').textContent = save.points + ' points available';
  const list = $('unlock-list');
  list.innerHTML = '';
  for (const [id, p] of Object.entries(PARTS)) {
    if (p.cost === 0) continue;
    const row = document.createElement('div');
    row.className = 'unlock-row';
    const info = document.createElement('div');
    info.innerHTML = '<div>' + p.name + '</div><span class="part-sub">' + p.desc + '</span>';
    row.appendChild(info);
    if (save.unlocked.includes(id)) {
      const tag = document.createElement('span');
      tag.className = 'unlock-owned';
      tag.textContent = 'Unlocked';
      row.appendChild(tag);
    } else {
      const btn = document.createElement('button');
      btn.className = 'btn';
      btn.textContent = p.cost + ' pts';
      btn.disabled = save.points < p.cost;
      btn.addEventListener('click', () => { audio.click(); onBuy(id); });
      row.appendChild(btn);
    }
    list.appendChild(row);
  }
}

export function updateTitleBest(save) {
  $('title-best').textContent = save.wins > 0 || save.points > 0
    ? 'Wins: ' + save.wins + ' / points: ' + save.points
    : '';
}
