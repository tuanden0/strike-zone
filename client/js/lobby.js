// Room list + create form. Everything from the server is rendered with textContent.

const $ = (id) => document.getElementById(id);

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export class LobbyUI {
  constructor(spec) {
    this.spec = spec;
    this.net = null;
    this.timer = 0;
    const sel = $('c-max');
    sel.replaceChildren();
    for (let n = 2; n <= spec.match.maxPlayers; n++) sel.append(new Option(String(n), String(n)));
    sel.value = String(spec.match.maxPlayers);
    $('create-form').addEventListener('submit', (e) => {
      e.preventDefault();
      this.create();
    });
  }

  status(msg, ok = false) {
    const e = $('lobby-status');
    e.textContent = msg || '';
    e.classList.toggle('ok', ok);
  }

  open(net, nick) {
    this.net = net;
    $('lobby-nick').textContent = nick;
    this.status('');
    this.offs = [
      net.on('rooms', (m) => this.render(m.rooms)),
      net.on('error', (m) => this.status(m.msg)),
    ];
    this.refresh();
    this.timer = setInterval(() => this.refresh(), 3000);
  }

  close() {
    clearInterval(this.timer);
    (this.offs || []).forEach((off) => off());
    this.offs = [];
  }

  refresh() {
    if (this.net) this.net.send({ t: 'rooms' });
  }

  create() {
    const minutes = Number($('c-time').value);
    this.status('');
    this.net.send({
      t: 'create',
      name: $('c-name').value,
      password: $('c-pass').value,
      max: Number($('c-max').value),
      timeLimit: Math.round(minutes * 60),
      scoreLimit: Number($('c-score').value),
      team: $('pref-team').value,
    });
  }

  join(room, password) {
    this.status('');
    this.net.send({ t: 'join', room: room.id, password, team: $('pref-team').value });
  }

  render(rooms) {
    const body = $('room-body');
    body.replaceChildren();
    $('room-empty').hidden = rooms.length > 0;
    for (const r of rooms) {
      const tr = el('tr');
      tr.append(el('td', '', (r.locked ? '[locked] ' : '') + r.name));
      tr.append(el('td', '', `${r.players}/${r.max}`));
      tr.append(el('td', '', `${Math.round(r.timeLimit / 60)} min · ${r.scoreLimit} kills`));
      tr.append(el('td', '', r.st === 'ended' ? 'intermission' : 'playing'));
      const td = el('td');
      let pw = null;
      if (r.locked) {
        pw = el('input');
        pw.type = 'password';
        pw.maxLength = 32;
        pw.placeholder = 'password';
        pw.setAttribute('aria-label', `Password for ${r.name}`);
        td.append(pw, ' ');
      }
      const btn = el('button', '', 'Join');
      btn.disabled = r.players >= r.max;
      btn.addEventListener('click', () => this.join(r, pw ? pw.value : ''));
      td.append(btn);
      tr.append(td);
      body.append(tr);
    }
  }
}
