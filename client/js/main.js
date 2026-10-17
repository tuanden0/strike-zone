// App shell: title -> (practice | online lobby -> room) -> game.
import { Sfx } from './audio.js';
import { Input } from './input.js';
import { Hud } from './hud.js';
import { Game } from './game.js';
import { Practice } from './practice.js';
import { Net } from './net.js';
import { LobbyUI } from './lobby.js';
import { Online } from './online.js';
import { prepareMap } from './physics.js';
import { loadAssets } from './assets.js';

const $ = (id) => document.getElementById(id);

async function fetchJson(url) {
  const r = await fetch(url, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.json();
}

const state = { spec: null, map: null, assets: null, game: null, net: null, lobby: null, nick: '', online: false };
const sfx = new Sfx();
state.sfx = sfx;
const canvas = $('view');
const input = new Input(canvas);
const hud = new Hud();

function show(screen) {
  for (const id of ['screen-title', 'screen-lobby', 'screen-pause']) $(id).hidden = id !== screen;
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

function ensureGame() {
  if (!state.game) state.game = new Game({ canvas, spec: state.spec, map: state.map, sfx, hud, input, assets: state.assets });
  return state.game;
}

function enterGame(mode, title, online) {
  const game = ensureGame();
  if (game.running) game.stop();
  state.online = online;
  $('pause-team').hidden = !online;
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
  stopGame();
  if (state.lobby) state.lobby.close();
  if (state.net) {
    state.net.onClose = () => {};
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
    state.lobby = state.lobby || new LobbyUI(state.spec);
    showLobby();
  });
  net.on('joined', (m) => {
    state.lobby.close();
    const mode = new Online({ spec: state.spec, net, myId: m.id, room: m.room, team: m.team, hud, sfx });
    enterGame(mode, `Room: ${m.room.name}`, true);
  });
  net.on('error', (m) => {
    if (state.online) {
      setStatus('pause-status', m.msg);
      hud.setBanner(m.msg);
    }
  });
  net.on('left', () => {});
  net.onClose = () => backToTitle('Disconnected from server.');
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

input.onLockChange = (locked) => {
  if (!state.game || !state.game.running) return;
  show(locked ? '' : 'screen-pause');
  if (!locked) hud.showBoard(false);
};
input.onScoreboard = (v) => hud.showBoard(v);

$('btn-practice').addEventListener('click', () => {
  state.nick = cleanNick($('nick').value);
  enterGame(new Practice(state.spec, state.map), 'Practice range', false);
});
$('btn-online').addEventListener('click', goOnline);
$('btn-lobby-back').addEventListener('click', () => backToTitle(''));
$('btn-resume').addEventListener('click', () => {
  sfx.unlock();
  input.lock();
});
$('btn-leave').addEventListener('click', leaveGame);
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
  $('quality').value = localStorage.getItem('sz.quality') === 'low' ? 'low' : 'high';
} catch {
  // skip: storage blocked, keep the default
}

(async () => {
  let stage = 'game data';
  try {
    setStatus('title-status', 'Loading game data…', true);
    const [spec, mapJson] = await Promise.all([fetchJson('shared/spec.json'), fetchJson('shared/map.json')]);
    state.spec = spec;
    state.map = prepareMap(mapJson);
    stage = 'models';
    state.assets = await loadAssets(undefined, (p) => setStatus('title-status', `Loading models… ${Math.round(p * 100)}%`, true));
    stage = 'renderer (WebGL)';
    setStatus('title-status', 'Preparing graphics…', true);
    const game = ensureGame();
    stage = 'shader warm-up';
    try {
      await game.warmup();
    } catch (e) {
      console.warn('shader warm-up failed (continuing, first frame may stall):', e); // non-fatal
    }
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
