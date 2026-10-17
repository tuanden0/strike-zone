// App shell: title -> (practice | online lobby -> room) -> game.
import * as THREE from '../vendor/three.module.js';
import { Sfx } from './audio.js';
import { Input, isTouch } from './input.js';
import { Hud } from './hud.js';
import { Game } from './game.js';
import { Practice } from './practice.js';
import { Net } from './net.js';
import { LobbyUI } from './lobby.js';
import { Online } from './online.js';
import { prepareMap } from './physics.js';
import { loadAssets } from './assets.js';
import { fitScreens, initFit } from './fit.js';

const $ = (id) => document.getElementById(id);

async function fetchJson(url) {
  const r = await fetch(url, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.json();
}

// three.js builds its shader-cache key from `this.onBeforeCompile.toString()`. Firefox extensions that hook Function.prototype.toString make that
// throw "Permission denied to access object" and the renderer never starts. This game never sets onBeforeCompile, so fall back to a constant key.
const cacheKey = THREE.Material.prototype.customProgramCacheKey;
THREE.Material.prototype.customProgramCacheKey = function () {
  try {
    return cacheKey.call(this);
  } catch {
    return '';
  }
};

const state = { spec: null, map: null, maps: [], mapData: {}, mapGlb: {}, safeImages: false, assets: null, game: null, net: null, lobby: null, nick: '', online: false };
const sfx = new Sfx();
state.sfx = sfx;
const canvas = $('view');
const input = new Input(canvas);
const hud = new Hud();
initFit();

function show(screen) {
  for (const id of ['screen-title', 'screen-lobby', 'screen-pause']) $(id).hidden = id !== screen;
  fitScreens();
}

function setStatus(id, msg, ok = false) {
  const e = $(id);
  e.textContent = msg || '';
  e.classList.toggle('ok', ok);
}

function cleanNick(s) {
  // eslint-disable-next-line no-control-regex
  const n = s.replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, '').trim().slice(0, 16);
  return n || 'Player';
}

// Load (once) the collision data and glb of a map from the registry and make it the game's current map.
async function applyMap(id) {
  const entry = state.maps.find((m) => m.id === id) || state.maps[0];
  if (!state.mapData[entry.id]) {
    state.mapData[entry.id] = prepareMap(await fetchJson(`shared/${entry.file}`));
    const name = entry.model.replace(/\.glb$/, '');
    const glb = state.assets[name] || (await loadAssets([name], () => {}, { safeImages: state.safeImages }))[name];
    state.mapGlb[entry.id] = glb;
  }
  const game = ensureGame();
  if (game.mapId !== entry.id) game.setMap(entry.id, state.mapData[entry.id], state.mapGlb[entry.id].scene);
  game.footsteps.setFloor(entry.floor); // default footstep surface of the map (maps.json "floor")
  return entry.id;
}

function ensureGame() {
  if (!state.game) state.game = new Game({ canvas, spec: state.spec, map: state.map, sfx, hud, input, assets: state.assets });
  return state.game;
}

function enterGame(mode, title, online) {
  const game = ensureGame();
  if (game.running) game.stop();
  state.online = online;
  $('pause-team').hidden = !online;
  $('pause-bots').hidden = !online;
  setStatus('pause-status', '');
  game.start(mode);
  $('pause-title').textContent = title;
  show('screen-pause');
}

function stopGame() {
  input.unlock();
  if (state.game && state.game.running) state.game.stop();
}

function backToTitle(msg) {
  $('conn').hidden = true;
  stopGame();
  if (state.lobby) state.lobby.close();
  if (state.net) {
    state.net.onClose = () => {};
    state.net.onStatus = () => {};
    state.net.close();
    state.net = null;
  }
  state.online = false;
  show('screen-title');
  setStatus('title-status', msg || '');
  $('btn-online').disabled = false;
}

function showLobby() {
  show('screen-lobby');
  state.lobby.open(state.net, state.nick);
}

async function goOnline() {
  state.nick = cleanNick($('nick').value);
  $('btn-online').disabled = true;
  setStatus('title-status', 'Connecting…', true);
  const net = new Net();
  state.net = net;
  net.on('welcome', () => {
    setStatus('title-status', '');
    state.lobby = state.lobby || new LobbyUI(state.spec, state.maps);
    showLobby();
  });
  let pendingPickups = []; // the server sends `pk` right after `joined`, possibly while the map is still loading
  net.on('pk', (m) => {
    pendingPickups = m.list;
  });
  net.on('joined', async (m) => {
    state.lobby.close();
    try {
      await applyMap(m.room.map);
    } catch (e) {
      console.error(e);
      net.send({ t: 'leave' });
      showLobby();
      state.lobby.status(`Could not load the map: ${e.message}`);
      return;
    }
    const mode = new Online({ spec: state.spec, net, myId: m.id, room: m.room, team: m.team, hud, sfx, pickups: pendingPickups });
    enterGame(mode, `Room: ${m.room.name}`, true);
  });
  net.on('error', (m) => {
    if (state.online) {
      setStatus('pause-status', m.msg);
      hud.setBanner(m.msg);
    }
  });
  net.on('left', () => {});
  net.on('resumed', (m) => {
    if (state.online && !m.room) {
      // the seat is gone (match closed while we were away): back to the lobby
      stopGame();
      state.online = false;
      showLobby();
    }
  });
  net.onStatus = (st) => {
    $('conn').hidden = st === 'up';
    const mode = state.game && state.game.mode;
    if (mode) mode.offline = st === 'down'; // the game stops sampling input while the link is down
  };
  net.onClose = () => {
    $('conn').hidden = true;
    backToTitle('Disconnected from server.');
  };
  try {
    await net.connect();
  } catch (e) {
    state.net = null;
    $('btn-online').disabled = false;
    setStatus('title-status', `${e.message}. Is the server running?`);
    return;
  }
  net.send({ t: 'hello', nick: state.nick });
}

function leaveGame() {
  if (state.online && state.net) {
    stopGame();
    state.net.send({ t: 'leave' });
    state.online = false;
    showLobby();
  } else {
    stopGame();
    show('screen-title');
  }
}

input.onPadConnect = (c) => ($('pause-pad').hidden = !c);
input.onLockChange = (locked) => {
  if (locked) sfx.unlock(); // (resuming with a gamepad button has no click handler)
  if (!state.game || !state.game.running) return;
  show(locked ? '' : 'screen-pause');
  if (!locked) hud.showBoard(false);
};
input.onScoreboard = (v) => hud.showBoard(v);

$('btn-practice').addEventListener('click', async () => {
  state.nick = cleanNick($('nick').value);
  $('btn-practice').disabled = true;
  try {
    const id = await applyMap($('practice-map').value);
    enterGame(new Practice(state.spec, state.mapData[id], id), 'Practice range', false);
  } catch (e) {
    console.error(e);
    setStatus('title-status', `Could not load the map: ${e.message}`);
  } finally {
    $('btn-practice').disabled = false;
  }
});
if (isTouch) {
  $('pause-hint').textContent = 'Tap Resume to play. Left stick: move · right thumb: aim and fire (tap = one shot, hold still = auto-fire, push = turn; hold and push to fire while turning) · buttons: jump, duck, reload, use, drop.';
  $('controls-hint').textContent = 'Touch: left stick moves; the right thumb aims AND fires: tap = shoot, hold still = keep shooting, push = turn (swipe-aim in the pause menu) · JUMP / R reload · USE pick up · DROP · NADE throws the chosen grenade (tap HE to change) · SCOPE (sniper) · tap the weapon list to switch';
  $('sens').previousElementSibling.textContent = 'Look sensitivity (also scales the aim stick)';
  $('pause-look').hidden = false;
  $('look-mode').value = input.touchUi.mode;
  $('look-mode').addEventListener('change', (e) => input.touchUi.setMode(e.target.value));
}
$('btn-online').addEventListener('click', goOnline);
$('btn-lobby-back').addEventListener('click', () => backToTitle(''));
$('btn-resume').addEventListener('click', () => {
  sfx.unlock();
  input.lock();
});
$('btn-leave').addEventListener('click', leaveGame);
$('btn-bot-a').addEventListener('click', () => state.net && state.net.send({ t: 'addbot', team: 'A', skill: $('bot-skill').value }));
$('btn-bot-b').addEventListener('click', () => state.net && state.net.send({ t: 'addbot', team: 'B', skill: $('bot-skill').value }));
$('btn-bot-rm').addEventListener('click', () => state.net && state.net.send({ t: 'rmbot' }));
$('btn-team-a').addEventListener('click', () => state.net && state.net.send({ t: 'team', team: 'A' }));
$('btn-team-b').addEventListener('click', () => state.net && state.net.send({ t: 'team', team: 'B' }));
$('sens').addEventListener('input', (e) => input.setSens(Number(e.target.value) / 10000));
$('vol').addEventListener('input', (e) => sfx.setVolume(Number(e.target.value) / 100));
$('sens').value = String(Math.round(input.sens * 10000));
$('quality').addEventListener('change', (e) => {
  if (state.game) state.game.setQuality(e.target.value);
  else {
    try {
      localStorage.setItem('sz.quality', e.target.value);
    } catch {
      // skip: persisting the choice is a convenience only
    }
  }
});
try {
  const q = localStorage.getItem('sz.quality');
  $('quality').value = q === 'low' || q === 'high' || q === 'ultra' ? q : isTouch ? 'low' : 'high';
} catch {
  // skip: storage blocked, keep the default
}

(async () => {
  let stage = 'game data';
  try {
    setStatus('title-status', 'Loading game data…', true);
    const [spec, maps] = await Promise.all([fetchJson('shared/spec.json'), fetchJson('shared/maps.json')]);
    state.spec = spec;
    state.maps = maps;
    input.nadeNames = spec.grenades.map((g) => g.id);
    $('t-nadesel').textContent = input.nadeNames[0].toUpperCase();
    $('practice-map').replaceChildren(...maps.map((m) => new Option(m.label, m.id)));
    state.mapData[maps[0].id] = prepareMap(await fetchJson(`shared/${maps[0].file}`));
    state.map = state.mapData[maps[0].id];
    stage = 'models';
    const progress = (p) => setStatus('title-status', `Loading models… ${Math.round(p * 100)}%`, true);
    const forceSafe = new URLSearchParams(location.search).has('safeimg'); // test hook
    state.safeImages = forceSafe;
    try {
      state.assets = await loadAssets(undefined, progress, { safeImages: forceSafe });
    } catch (e) {
      if (forceSafe) throw e;
      console.warn('model load failed, retrying with <img> texture decoding:', e);
      state.safeImages = true;
      state.assets = await loadAssets(undefined, progress, { safeImages: true });
    }
    stage = 'renderer (WebGL)';
    setStatus('title-status', 'Preparing graphics…', true);
    state.mapGlb[maps[0].id] = state.assets.map;
    const game = ensureGame();
    stage = 'shader warm-up';
    try {
      await game.warmup();
    } catch (e) {
      console.warn('shader warm-up failed (continuing, first frame may stall):', e); // non-fatal
    }
    state.input = input;
    window.__sz = state; // debug/e2e hook
    window.__sz.sfx = sfx;
    setStatus('title-status', '');
    $('btn-online').disabled = false;
    $('btn-practice').disabled = false;
  } catch (e) {
    console.error(`startup failed at stage "${stage}"`, e);
    setStatus('title-status', `Failed to load (${stage}): ${e && e.name ? e.name + ': ' : ''}${e && e.message ? e.message : e}. See the browser console (F12) for details.`);
  }
})();
