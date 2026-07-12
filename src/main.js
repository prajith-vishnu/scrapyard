import { Renderer } from './render.js';
import { PARTS } from './parts.js';
import { Fight, scoreFight, validateDesign, OPPONENTS, ACHIEVEMENTS } from './combat.js';
import { audio } from './audio.js';
import * as ui from './ui.js';

const renderer = new Renderer(document.getElementById('scene'));

let save = ui.loadSave();
let opponent = 'rustbucket';
let state = 'title'; // title | build | fight | results | unlocks
let fight = null;
let unlocksReturnTo = 'title';
// per-fight callout flags so each line only fires once
let callouts = {};

// current robot design. the stack is an ordered bottom-up list:
// one drive part, then hull sections
const design = {
  stack: ['wheels-basic', 'chassis-small'],
  weapon: 'saw',
  armor: 'plates-scrap',
  spikes: false,
  repair: false,
};

// a decent-looking default so the title screen has something in the pit
const titleDesign = {
  stack: ['treads', 'chassis-medium'],
  weapon: 'saw',
  armor: 'plates-scrap',
  spikes: true,
  repair: false,
};

// ---- design edits ----

function addPart(id) {
  const p = PARTS[id];
  if (p.category === 'Drive') {
    const i = design.stack.findIndex((s) => PARTS[s].category === 'Drive');
    if (i >= 0) design.stack[i] = id; // swap drives
    else design.stack.unshift(id);
  } else if (p.category === 'Hull') {
    if (design.stack.filter((s) => PARTS[s].category === 'Hull').length >= 3) return;
    design.stack.push(id);
  } else if (id === 'spike-pair') {
    design.spikes = !design.spikes;
  } else if (p.category === 'Weapon') {
    design.weapon = design.weapon === id ? null : id; // click again to remove
  } else if (p.category === 'Armor') {
    design.armor = design.armor === id ? null : id;
  } else if (id === 'repair-kit') {
    design.repair = !design.repair;
  }
  refreshBuild();
}

function removePart(key) {
  if (key === 'weapon') design.weapon = null;
  else if (key === 'armor') design.armor = null;
  else if (key === 'spikes') design.spikes = false;
  else if (key === 'repair') design.repair = false;
  else if (key.startsWith('stack:')) {
    // removing a middle part just closes the gap
    design.stack.splice(Number(key.split(':')[1]), 1);
  }
  refreshBuild();
}

function clearDesign() {
  design.stack = [];
  design.weapon = null;
  design.armor = null;
  design.spikes = false;
  design.repair = false;
  refreshBuild();
}

function refreshBuild() {
  renderer.buildRobot(design, 'you');
  ui.renderPalette(save, design, addPart);
  ui.renderStack(design, removePart);
  ui.renderStats(design);
  ui.renderOpponentPicker(opponent, (o) => {
    opponent = o;
    refreshBuild();
  });
}

// ---- state transitions ----

function goTitle() {
  state = 'title';
  fight = null;
  renderer.buildRobot(titleDesign, 'you');
  renderer.setMode('title');
  ui.updateTitleBest(save);
  ui.showScreen('title-screen');
}

function goBuild() {
  state = 'build';
  fight = null;
  audio.stopMotor();
  refreshBuild();
  renderer.setMode('build');
  ui.showScreen('build-ui');
}

function goFight() {
  if (state === 'fight' || validateDesign(design)) return;
  state = 'fight';
  callouts = {};
  fight = new Fight(design, opponent);
  renderer.buildRobot(design, 'you');
  renderer.buildRobot(OPPONENTS[opponent].design, 'foe');
  renderer.setMode('fight');
  ui.showScreen('battle-ui');
  ui.setFoeName(OPPONENTS[opponent].name);
  ui.updateBattleReadout(fight);
  audio.startMotor();
}

function goResults() {
  state = 'results';
  audio.stopMotor();

  const result = fight.result;
  const score = scoreFight(opponent, result);
  const isBest = score > save.best[opponent];
  if (isBest) save.best[opponent] = score;
  if (result.winner === 'you') save.wins += 1;
  save.points += score;

  // hand out any badges this fight earned
  const newAchievements = [];
  for (const a of ACHIEVEMENTS) {
    if (!save.achievements.includes(a.id) && a.test(result, fight)) {
      save.achievements.push(a.id);
      newAchievements.push(a);
    }
  }
  ui.storeSave(save);

  ui.renderResults(opponent, result, score, save, isBest, newAchievements);
  ui.showScreen('results-screen');
}

function goUnlocks(returnTo) {
  unlocksReturnTo = returnTo;
  state = 'unlocks';
  ui.renderUnlocks(save, buyPart);
  ui.showScreen('unlocks-screen');
}

function buyPart(id) {
  if (save.unlocked.includes(id)) return;
  if (save.points < PARTS[id].cost) return;
  save.points -= PARTS[id].cost;
  save.unlocked.push(id);
  ui.storeSave(save);
  ui.renderUnlocks(save, buyPart);
}

// ---- fight loop hooks ----

function handleFightEvents() {
  for (const ev of fight.events) {
    if (ev.type === 'hit') {
      const attacker = ev.target === 'foe' ? 'you' : 'foe';
      renderer.hitSpark(ev.target, ev.dmg);
      if (ev.kind === 'zapper') {
        renderer.zapBolt(attacker);
        audio.zap();
      } else {
        audio.clank(ev.dmg);
      }
      if (ev.kind === 'hammer') renderer.swingHammer(attacker);
    } else if (ev.type === 'ko') {
      renderer.wreckBot(ev.target);
      audio.crash();
      ui.flashEvent(ev.target === 'foe'
        ? OPPONENTS[opponent].name + ' is scrap'
        : 'You are scrap');
    } else if (ev.type === 'decision') {
      ui.flashEvent('Time. Judges call it.');
    }
  }
}

// ---- buttons ----

document.getElementById('btn-start').addEventListener('click', () => { audio.click(); goBuild(); });
document.getElementById('btn-unlocks').addEventListener('click', () => { audio.click(); goUnlocks('title'); });
document.getElementById('btn-unlocks-back').addEventListener('click', () => {
  audio.click();
  if (unlocksReturnTo === 'build') goBuild(); else goTitle();
});
document.getElementById('btn-fight').addEventListener('click', () => { audio.click(); goFight(); });
document.getElementById('btn-clear').addEventListener('click', () => { audio.click(); clearDesign(); });
document.getElementById('btn-title').addEventListener('click', () => { audio.click(); goTitle(); });
document.getElementById('btn-again').addEventListener('click', () => { audio.click(); goBuild(); });

const muteBtn = document.getElementById('btn-mute');
function refreshMuteLabel() {
  muteBtn.textContent = audio.muted ? 'Sound: Off' : 'Sound: On';
}
muteBtn.addEventListener('click', () => {
  audio.toggleMute();
  refreshMuteLabel();
  audio.click();
});
refreshMuteLabel();

// ---- main loop ----

let last = performance.now();
let resultsDelay = 0;

function frame(now) {
  requestAnimationFrame(frame);
  // clamp dt so a background tab does not fast-forward the fight
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;

  if (state === 'fight' && fight) {
    if (!fight.done) {
      fight.step(dt);
      handleFightEvents();
      ui.updateBattleReadout(fight);
      // ringside callouts as the fight turns
      const [youFrac, foeFrac] = fight.hullFracs();
      if (!callouts.blood && fight.firstBlood) {
        callouts.blood = true;
        ui.flashEvent('First blood');
        audio.ping();
      }
      if (!callouts.foeHalf && foeFrac > 0 && foeFrac <= 0.5) {
        callouts.foeHalf = true;
        ui.flashEvent(OPPONENTS[opponent].name + ' at half hull');
        audio.ping();
      }
      if (!callouts.youHalf && youFrac > 0 && youFrac <= 0.5) {
        callouts.youHalf = true;
        ui.flashEvent('Your hull at half');
        audio.ping();
      }
      const busy = fight.you.moving || fight.foe.moving;
      audio.setMotorLevel(busy ? 0.7 : 0.4);
      if (fight.done) {
        audio.stopMotor();
        resultsDelay = 2.2; // let the wreck burn for a moment
      }
    } else {
      resultsDelay -= dt;
      if (resultsDelay <= 0) goResults();
    }
  }

  // keep passing the finished fight during the results screen so the
  // camera and sparks do not snap away behind it
  renderer.update(dt, fight);
}

goTitle();
requestAnimationFrame(frame);
