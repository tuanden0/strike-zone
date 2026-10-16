// App shell: title -> (practice | online lobby) -> game.
import { Sfx } from './audio.js';
import { Input } from './input.js';
import { Hud } from './hud.js';
import { Game } from './game.js';
import { Practice } from './practice.js';
import { prepareMap } from './physics.js';

const $ = (id) => document.getElementById(id);

async function fetchJson(url) {
  const r = await fetch(url, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.json();
}

const state = { spec: null, map: null, game: null, nick: '' };
const sfx = new Sfx();
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
  const n = s.replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim().slice(0, 16);
  return n || 'Player';
}

function ensureGame() {
  if (!state.game) state.game = new Game({ canvas, spec: state.spec, map: state.map, sfx, hud, input });
  return state.game;
}

function enterGame(mode, title) {
  const game = ensureGame();
  if (game.running) game.stop();
  game.start(mode);
  $('pause-title').textContent = title;
  show('screen-pause');
}

function leaveGame() {
  input.unlock();
  if (state.game && state.game.running) state.game.stop();
  show('screen-title');
}

input.onLockChange = (locked) => {
  if (!state.game || !state.game.running) return;
  show(locked ? '' : 'screen-pause');
  if (!locked) hud.showBoard(false);
};
input.onScoreboard = (v) => hud.showBoard(v);

$('btn-practice').addEventListener('click', () => {
  state.nick = cleanNick($('nick').value);
  enterGame(new Practice(state.spec, state.map), 'Practice range');
});
$('btn-online').addEventListener('click', () => setStatus('title-status', 'Online play is not available in this build yet.'));
$('btn-resume').addEventListener('click', () => {
  sfx.unlock();
  input.lock();
});
$('btn-leave').addEventListener('click', leaveGame);
$('sens').addEventListener('input', (e) => input.setSens(Number(e.target.value) / 10000));
$('vol').addEventListener('input', (e) => sfx.setVolume(Number(e.target.value) / 100));
$('sens').value = String(Math.round(input.sens * 10000));

(async () => {
  try {
    const [spec, mapJson] = await Promise.all([fetchJson('shared/spec.json'), fetchJson('shared/map.json')]);
    state.spec = spec;
    state.map = prepareMap(mapJson);
    window.__sz = state; // debug/e2e hook
  } catch (e) {
    setStatus('title-status', `Failed to load game data: ${e.message}`);
    $('btn-online').disabled = true;
    $('btn-practice').disabled = true;
  }
})();
