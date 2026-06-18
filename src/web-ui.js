module.exports = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>walkie web</title>
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>&#128225;</text></svg>">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }

    :root {
      --bg: #0a0a0a;
      --surface: #141414;
      --border: #222;
      --text: #e0e0e0;
      --muted: #888;
      --accent: #22c55e;
      --accent-dim: #16a34a;
      --mono: 'SF Mono', 'Fira Code', 'Consolas', monospace;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: var(--bg);
      color: var(--text);
      height: 100vh;
      overflow: hidden;
      -webkit-font-smoothing: antialiased;
    }

    .app { display: flex; flex-direction: column; height: 100vh; }

    /* Header — thin bar like terminal-header */
    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 16px;
      border-bottom: 1px solid var(--border);
      font-size: 0.8rem;
      color: var(--muted);
    }

    .header-left {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .header .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #666;
      transition: background 0.3s;
    }

    .header .dot.connected { background: var(--accent); opacity: 0.7; }
    .header .dot.connecting { background: #eab308; opacity: 0.7; }

    .header-title {
      font-family: var(--mono);
      color: var(--text);
      font-weight: 600;
      font-size: 0.85rem;
    }

    .header-title span { color: var(--accent); }

    .header-right {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .header-status {
      font-family: var(--mono);
      font-size: 0.75rem;
    }

    .header-name {
      font-family: var(--mono);
      font-size: 0.75rem;
      color: var(--text);
      cursor: pointer;
      padding: 2px 8px;
      border-radius: 4px;
      border: 1px solid transparent;
      transition: border-color 0.2s;
    }

    .header-name:hover { border-color: var(--border); }

    .header-name-input {
      font-family: var(--mono);
      font-size: 0.75rem;
      color: var(--text);
      background: var(--bg);
      border: 1px solid var(--accent);
      border-radius: 4px;
      padding: 2px 8px;
      outline: none;
      width: 120px;
    }

    /* Main layout */
    .main { display: flex; flex: 1; overflow: hidden; }

    /* Sidebar — minimal list */
    .sidebar {
      width: 200px;
      border-right: 1px solid var(--border);
      display: flex;
      flex-direction: column;
      flex-shrink: 0;
    }

    .sidebar-label {
      padding: 16px 16px 8px;
      font-size: 0.7rem;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--muted);
    }

    .channel-list {
      flex: 1;
      overflow-y: auto;
      padding: 0 8px;
    }

    .channel-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 6px 8px;
      border-radius: 4px;
      cursor: pointer;
      font-family: var(--mono);
      font-size: 0.8rem;
      color: var(--muted);
    }

    .channel-item:hover { color: var(--text); }
    .channel-item.active { color: var(--accent); }
    .channel-item.joining { opacity: 0.5; }

    .joining-dot {
      display: inline-block;
      color: var(--muted);
      font-family: var(--mono);
      font-size: 0.7rem;
      animation: pulse 1.2s infinite;
    }

    @keyframes pulse { 0%,100% { opacity: 0.3; } 50% { opacity: 1; } }

    .joining-msg {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--muted);
      font-family: var(--mono);
      font-size: 0.8rem;
      gap: 8px;
    }

    .channel-item .leave-x {
      display: none;
      background: none;
      border: none;
      color: var(--muted);
      cursor: pointer;
      font-size: 0.85rem;
      padding: 0 4px;
      font-family: var(--mono);
    }

    .channel-item:hover .leave-x { display: block; }
    .channel-item .leave-x:hover { color: var(--text); }

    .channel-item .badge {
      font-size: 0.65rem;
      color: var(--accent);
      font-family: var(--mono);
    }

    .sidebar-join {
      padding: 12px 16px;
      border-top: 1px solid var(--border);
    }

    .sidebar-join button {
      background: none;
      border: 1px solid var(--border);
      color: var(--muted);
      font-family: var(--mono);
      font-size: 0.75rem;
      padding: 6px 0;
      width: 100%;
      border-radius: 6px;
      cursor: pointer;
      transition: border-color 0.2s, color 0.2s;
    }

    .sidebar-join button:hover {
      border-color: var(--accent);
      color: var(--accent);
    }

    /* Chat area — terminal-style */
    .chat {
      flex: 1;
      display: flex;
      flex-direction: column;
      min-width: 0;
    }

    .chat-bar {
      padding: 10px 16px;
      border-bottom: 1px solid var(--border);
      font-family: var(--mono);
      font-size: 0.8rem;
      color: var(--muted);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .chat-bar .name { color: var(--accent); }

    .chat-bar .members {
      font-size: 0.7rem;
      color: #444;
      margin-left: 10px;
    }

    .chat-bar .clear-btn {
      background: none;
      border: none;
      color: #333;
      font-family: var(--mono);
      font-size: 0.7rem;
      cursor: pointer;
      transition: color 0.2s;
    }

    .chat-bar .clear-btn:hover { color: var(--muted); }

    .messages {
      flex: 1;
      overflow-y: auto;
      padding: 16px;
      font-family: var(--mono);
      font-size: 0.8rem;
      line-height: 1.5;
    }

    .msg { color: var(--text); }

    .msg .ts {
      color: #444;
      margin-right: 8px;
    }

    .msg .who {
      color: var(--muted);
      margin-right: 4px;
    }

    .msg .who::after { content: ':'; }

    .msg.own .who { color: var(--accent); }

    .msg.sys {
      color: #444;
      font-style: italic;
      font-size: 0.7rem;
      padding: 2px 0;
      text-align: center;
    }

    .msg.gap { margin-top: 6px; }

    .msg .tag {
      font-size: 0.6rem;
      color: #555;
      border: 1px solid #333;
      border-radius: 3px;
      padding: 0 4px;
      margin-left: 4px;
      vertical-align: middle;
    }

    .msg .mention { color: var(--accent); font-weight: 600; }
    .msg.mentioned { border-left: 2px solid var(--accent); padding-left: 8px; margin-left: -10px; }

    .channel-item .ping {
      color: var(--accent);
      font-size: 0.65rem;
      font-family: var(--mono);
    }

    /* Autocomplete dropdown */
    .ac {
      position: absolute;
      bottom: 100%;
      left: 0;
      right: 0;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 6px;
      margin-bottom: 4px;
      max-height: 140px;
      overflow-y: auto;
      font-family: var(--mono);
      font-size: 0.8rem;
      z-index: 50;
    }

    .ac.hidden { display: none; }

    .ac-item {
      padding: 4px 10px;
      cursor: pointer;
      color: var(--muted);
    }

    .ac-item:hover, .ac-item.sel { background: rgba(255,255,255,0.05); color: var(--text); }

    .input-row { position: relative; }

    /* Input — terminal prompt style */
    .input-row {
      padding: 12px 16px;
      border-top: 1px solid var(--border);
      display: flex;
      align-items: center;
      gap: 0;
    }

    .input-row .prompt {
      color: var(--accent);
      font-family: var(--mono);
      font-size: 0.8rem;
      margin-right: 8px;
      flex-shrink: 0;
    }

    .input-row input {
      flex: 1;
      background: none;
      border: none;
      color: var(--text);
      font-family: var(--mono);
      font-size: 0.8rem;
      outline: none;
    }

    .input-row input::placeholder { color: #333; }

    /* Empty state */
    .empty {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #333;
      font-family: var(--mono);
      font-size: 0.85rem;
    }

    /* Join modal — same surface style as marketing site boxes */
    .modal-bg {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.5);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 100;
    }

    .modal-bg.hidden { display: none; }

    .modal {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 24px;
      width: 320px;
    }

    .modal h3 {
      font-family: var(--mono);
      font-size: 0.85rem;
      font-weight: 600;
      margin-bottom: 20px;
      color: var(--text);
    }

    .modal label {
      display: block;
      font-size: 0.7rem;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--muted);
      margin-bottom: 4px;
    }

    .modal input {
      width: 100%;
      background: var(--bg);
      border: 1px solid var(--border);
      color: var(--text);
      font-family: var(--mono);
      font-size: 0.8rem;
      padding: 8px 10px;
      border-radius: 6px;
      margin-bottom: 14px;
      outline: none;
      transition: border-color 0.2s;
    }

    .modal input:focus { border-color: var(--accent); }

    .modal-btns {
      display: flex;
      gap: 8px;
      justify-content: flex-end;
      margin-top: 4px;
    }

    .modal-btns button {
      font-family: var(--mono);
      font-size: 0.75rem;
      padding: 6px 14px;
      border-radius: 6px;
      cursor: pointer;
      border: 1px solid var(--border);
      background: none;
      color: var(--muted);
      transition: border-color 0.2s, color 0.2s;
    }

    .modal-btns button:hover {
      border-color: var(--accent);
      color: var(--accent);
    }

    .modal-btns .go {
      border-color: var(--accent);
      color: var(--accent);
    }

    @media (max-width: 600px) {
      .sidebar { width: 160px; }
    }
  </style>
</head>
<body>
  <div class="app">
    <div class="header">
      <div class="header-left">
        <div class="dot" id="dot"></div>
        <div class="header-title"><span>walkie</span> web</div>
      </div>
      <div class="header-right">
        <div class="header-status" id="statusText">connecting</div>
        <div class="header-name" id="nameEl" onclick="editName()"></div>
      </div>
    </div>
    <div class="main">
      <div class="sidebar">
        <div class="sidebar-label">Channels</div>
        <div class="channel-list" id="channelList"></div>
        <div class="sidebar-join">
          <button onclick="showJoin()">+ join channel</button>
        </div>
      </div>
      <div class="chat" id="chatArea">
        <div class="empty">join a channel to start</div>
      </div>
    </div>
  </div>

  <div class="modal-bg hidden" id="joinModal" onclick="if(event.target===this)hideJoin()">
    <div class="modal">
      <h3>join channel</h3>
      <label>Channel</label>
      <input type="text" id="inCh" placeholder="ops" autocomplete="off">
      <label>Secret <span style="opacity:0.5;text-transform:none;letter-spacing:0">(optional — defaults to channel name)</span></label>
      <input type="text" id="inSec" placeholder="shared-secret" autocomplete="off">
      <div class="modal-btns">
        <button onclick="hideJoin()">cancel</button>
        <button class="go" onclick="doJoin()">join</button>
      </div>
    </div>
  </div>

  <div class="modal-bg hidden" id="welcomeModal">
    <div class="modal">
      <h3>welcome to walkie web</h3>
      <label>Your name</label>
      <input type="text" id="welcomeName" placeholder="e.g. vikas" autocomplete="off">
      <div class="modal-btns">
        <button onclick="skipWelcome()">skip</button>
        <button class="go" onclick="setWelcomeName()">go</button>
      </div>
    </div>
  </div>

  <script>
    let ws, clientId, active;
    const ch = new Map();
    const members = new Map(); // channel -> { members: [], peers: 0 }
    let storedName = null;
    let totalUnread = 0;
    const baseTitle = 'walkie web';

    // Request notification permission on first interaction
    document.addEventListener('click', function reqPerm() {
      if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission();
      }
      document.removeEventListener('click', reqPerm);
    }, { once: true });

    function notify(who, text, channel) {
      // Update title badge
      totalUnread++;
      document.title = '(' + totalUnread + ') ' + baseTitle;

      // Browser notification when tab not focused
      if (!document.hasFocus() && 'Notification' in window && Notification.permission === 'granted') {
        const n = new Notification(who + ' in #' + channel, {
          body: text.slice(0, 100),
          tag: 'walkie-' + channel,
          silent: false
        });
        n.onclick = () => { window.focus(); n.close(); };
      }
    }

    function clearTitleBadge() {
      totalUnread = 0;
      document.title = baseTitle;
    }

    const MAX_MSGS = 200;
    const STORAGE_KEY = 'walkie:web:state:v1';
    let saveTimer = null;

    function snapshotState() {
      const data = {};
      for (const [n, c] of ch) {
        data[n] = { secret: c.secret, msgs: c.msgs.slice(-MAX_MSGS) };
      }
      return { channels: data, active: active || null, name: storedName || null };
    }

    function normalizeState(state) {
      if (!state || typeof state !== 'object') return null;
      const channels = {};
      if (state.channels && typeof state.channels === 'object') {
        for (const [n, v] of Object.entries(state.channels)) {
          if (typeof n !== 'string' || !n) continue;
          if (typeof v === 'string') {
            if (v) channels[n] = { secret: v, msgs: [] };
            continue;
          }
          if (!v || typeof v !== 'object' || !v.secret) continue;
          channels[n] = {
            secret: v.secret,
            msgs: Array.isArray(v.msgs) ? v.msgs.slice(-MAX_MSGS) : []
          };
        }
      }
      return {
        channels,
        active: typeof state.active === 'string' ? state.active : null,
        name: typeof state.name === 'string' ? state.name : null
      };
    }

    function applyState(state) {
      const normalized = normalizeState(state);
      if (!normalized) return false;
      for (const [n, v] of Object.entries(normalized.channels)) {
        ch.set(n, { secret: v.secret, msgs: v.msgs, unread: 0 });
      }
      storedName = normalized.name;
      if (normalized.active && ch.has(normalized.active)) active = normalized.active;
      return true;
    }

    function readLocalState() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        return normalizeState(JSON.parse(raw));
      } catch {
        return null;
      }
    }

    function writeLocalState(state) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        return true;
      } catch {
        return false;
      }
    }

    function save() {
      const state = snapshotState();
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        // Write to durable server file first, fall back to localStorage
        fetch('/state', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(state)
        })
          .then(() => writeLocalState(state))
          .catch(() => writeLocalState(state));
      }, 500);
    }

    async function loadServerState() {
      try {
        const resp = await fetch('/state');
        const state = await resp.json();
        return normalizeState(state);
      } catch {
        return null;
      }
    }

    async function load() {
      // Prefer durable server-side state (survives browser clears + restarts)
      const serverState = await loadServerState();
      if (serverState) {
        applyState(serverState);
        // keep a local copy for offline resilience
        writeLocalState(snapshotState());
        return;
      }

      const localState = readLocalState();
      if (localState) {
        applyState(localState);
      }
    }

    function joinAll() {
      for (const [n, c] of ch) {
        if (c.secret) { c.joining = true; tx({ type: 'join', channel: n, secret: c.secret }); }
      }
      sidebar(); renderChat();
    }

    function go() {
      setS('connecting');
      const p = location.protocol === 'https:' ? 'wss:' : 'ws:';
      ws = new WebSocket(p + '//' + location.host + '/ws');
      ws.onopen = () => {
        setS('connected');
        sidebar(); renderChat();
      };
      ws.onmessage = e => {
        let m; try { m = JSON.parse(e.data); } catch { return; }
        if (m.type === 'hello') {
          clientId = m.clientId;
          showName();
          if (storedName && storedName !== clientId) {
            tx({ type: 'rename', name: storedName });
          } else {
            joinAll();
            if (!storedName && clientId.startsWith('web-')) {
              document.getElementById('welcomeModal').classList.remove('hidden');
              document.getElementById('welcomeName').focus();
            }
          }
          return;
        }
        if (m.type === 'renamed') { clientId = m.clientId; storedName = clientId; save(); showName(); joinAll(); return; }
        if (m.type === 'members') {
          members.set(m.channel, { members: m.members || [], peers: m.peers || 0 });
          if (m.channel === active) renderChatBar();
          return;
        }
        if (m.type === 'joined') {
          const isNew = !ch.has(m.channel) || ch.get(m.channel).msgs.length === 0;
          if (!ch.has(m.channel)) ch.set(m.channel, { secret: null, msgs: [], unread: 0 });
          ch.get(m.channel).joining = false;
          if (isNew) sysMsg(m.channel, 'joined #' + m.channel);
          tx({ type: 'members', channel: m.channel });
          if (!active) sw(m.channel);
          else if (m.channel === active) renderChat();
          sidebar();
          return;
        }
        if (m.type === 'messages' && ch.has(m.channel)) {
          const c = ch.get(m.channel);
          for (const x of m.messages) {
            const isSys = x.from === 'system' || x.from === 'daemon';
            // Skip own join/leave notifications
            if (isSys && clientId && (x.data === clientId + ' joined' || x.data === clientId + ' left')) continue;
            c.msgs.push({ ts: fmtTime(x.ts), who: isSys ? '' : x.from, text: x.data, own: false, sys: isSys });
            if (!isSys) notify(x.from, x.data, m.channel);
            if (m.channel !== active) {
              c.unread++;
              if (isMentioned(x.data)) c.pinged = true;
            }
          }
          if (m.channel === active) renderMsgs();
          else save();
          sidebar();
          return;
        }
        if (m.type === 'left') {
          ch.delete(m.channel);
          save();
          if (active === m.channel) active = ch.size > 0 ? ch.keys().next().value : null;
          sidebar(); renderChat();
          return;
        }
      };
      ws.onclose = () => { setS('disconnected'); setTimeout(go, 2000); };
      ws.onerror = () => ws.close();
    }

    function tx(o) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); }

    function setS(s) {
      document.getElementById('dot').className = 'dot' + (s === 'connected' ? ' connected' : s === 'connecting' ? ' connecting' : '');
      document.getElementById('statusText').textContent = s;
    }

    function fmtTime(ts) {
      return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }

    function showJoin() {
      document.getElementById('joinModal').classList.remove('hidden');
      document.getElementById('inCh').focus();
    }

    function hideJoin() {
      document.getElementById('joinModal').classList.add('hidden');
      document.getElementById('inCh').value = '';
      document.getElementById('inSec').value = '';
    }

    function setWelcomeName() {
      const v = document.getElementById('welcomeName').value.trim();
      document.getElementById('welcomeModal').classList.add('hidden');
      if (v) {
        storedName = v;
        tx({ type: 'rename', name: v });
        save();
      }
    }

    function skipWelcome() {
      document.getElementById('welcomeModal').classList.add('hidden');
    }

    function doJoin() {
      const n = document.getElementById('inCh').value.trim();
      const s = document.getElementById('inSec').value.trim() || n;
      if (!n) return;
      if (!ch.has(n)) ch.set(n, { secret: s, msgs: [], unread: 0 });
      else ch.get(n).secret = s;
      ch.get(n).joining = true;
      tx({ type: 'join', channel: n, secret: s });
      save();
      hideJoin();
      if (!active) sw(n);
      sidebar();
    }

    function doLeave(n, e) { e && e.stopPropagation(); tx({ type: 'leave', channel: n }); }

    function sw(n) {
      active = n;
      const c = ch.get(n);
      if (c) { c.unread = 0; c.pinged = false; }
      tx({ type: 'members', channel: n });
      sidebar(); renderChat();
    }

    function sysMsg(n, t) {
      const c = ch.get(n);
      if (!c) return;
      c.msgs.push({ ts: fmtTime(Date.now()), text: t, sys: true, own: false, who: '' });
      if (n === active) renderMsgs();
    }

    function clearMsgs() {
      if (!active) return;
      const c = ch.get(active);
      if (c) { c.msgs = []; save(); renderMsgs(); }
    }

    function send() {
      const inp = document.getElementById('msgIn');
      const t = inp.value.trim();
      if (!t || !active) return;
      tx({ type: 'send', channel: active, message: t });
      const c = ch.get(active);
      if (c) {
        c.msgs.push({ ts: fmtTime(Date.now()), who: clientId || 'you', text: t, own: true, sys: false });
        renderMsgs();
      }
      inp.value = '';
    }

    function sidebar() {
      const el = document.getElementById('channelList');
      el.innerHTML = '';
      for (const [n, c] of ch) {
        const d = document.createElement('div');
        d.className = 'channel-item' + (n === active ? ' active' : '') + (c.joining ? ' joining' : '');
        d.onclick = () => sw(n);
        let h = '# ' + esc(n);
        if (c.joining) h += ' <span class="joining-dot">...</span>';
        else if (c.pinged) h += ' <span class="ping">@</span>';
        else if (c.unread > 0) h += ' <span class="badge">' + c.unread + '</span>';
        h += '<button class="leave-x" onclick="doLeave(\\'' + esc(n) + '\\',event)">x</button>';
        d.innerHTML = h;
        el.appendChild(d);
      }
    }

    function renderChat() {
      const el = document.getElementById('chatArea');
      if (!active || !ch.has(active)) {
        el.innerHTML = '<div class="empty">join a channel to start</div>';
        return;
      }
      const c = ch.get(active);
      if (c && c.joining) {
        el.innerHTML =
          '<div class="chat-bar"><span># <span class="name">' + esc(active) + '</span></span></div>' +
          '<div class="joining-msg"><span class="joining-dot">...</span> joining channel</div>';
        return;
      }
      el.innerHTML =
        '<div class="chat-bar"><span># <span class="name">' + esc(active) + '</span><span class="members">' + memberInfo() + '</span></span><button class="clear-btn" onclick="clearMsgs()">clear</button></div>' +
        '<div class="messages" id="msgList"></div>' +
        '<div class="input-row">' +
          '<div class="ac hidden" id="acList"></div>' +
          '<span class="prompt">&gt;</span>' +
          '<input type="text" id="msgIn" placeholder="message" autocomplete="off">' +
        '</div>';
      renderMsgs();
      const inp = document.getElementById('msgIn');
      inp.focus();
      inp.addEventListener('keydown', acKey);
      inp.addEventListener('input', acInput);
    }

    function memberInfo() {
      if (!active) return '';
      const m = members.get(active);
      if (!m) return '';
      const local = m.members.filter(n => n !== clientId);
      const parts = [];
      if (local.length > 0) {
        const names = local.slice(0, 3).join(', ');
        const extra = local.length > 3 ? ' +' + (local.length - 3) : '';
        parts.push(names + extra);
      }
      if (m.peers > 0) parts.push(m.peers + ' peer' + (m.peers > 1 ? 's' : ''));
      return parts.join(' · ');
    }

    function renderChatBar() {
      const bar = document.querySelector('.chat-bar .members');
      if (bar) bar.textContent = memberInfo();
    }

    function isWebUser(name) {
      return /^web-[0-9a-f]{8}\$/.test(name);
    }

    function renderText(text) {
      // Split on @mentions, escape each part, wrap mentions in span
      return esc(text).replace(/@([a-zA-Z0-9_-]+)/g, '<span class="mention">@$1</span>');
    }

    function isMentioned(text) {
      if (!clientId) return false;
      const re = new RegExp('@' + clientId.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\\\$&') + '\\\\b', 'i');
      return re.test(text);
    }

    function renderMsgs() {
      const el = document.getElementById('msgList');
      if (!el) return;
      const c = ch.get(active);
      if (!c) return;
      let prevWho = null;
      el.innerHTML = c.msgs.map(m => {
        if (m.sys) { prevWho = null; return '<div class="msg sys">' + esc(m.text) + '</div>'; }
        const gap = prevWho !== null && prevWho !== m.who;
        prevWho = m.who;
        const mentioned = !m.own && isMentioned(m.text);
        const tag = isWebUser(m.who) ? '<span class="tag">web</span>' : '';
        return '<div class="msg' + (m.own ? ' own' : '') + (mentioned ? ' mentioned' : '') + (gap ? ' gap' : '') + '">' +
          '<span class="ts">' + esc(m.ts) + '</span>' +
          '<span class="who">' + esc(m.who) + '</span>' + tag +
          ' ' + renderText(m.text) +
        '</div>';
      }).join('');
      el.scrollTop = el.scrollHeight;
      save();
    }

    function showName() {
      document.getElementById('nameEl').textContent = clientId || '';
    }

    function editName() {
      const el = document.getElementById('nameEl');
      const cur = clientId || '';
      el.innerHTML = '<input class="header-name-input" id="nameIn" value="' + esc(cur) + '" placeholder="name">';
      const inp = document.getElementById('nameIn');
      inp.focus();
      inp.select();
      const done = () => {
        const v = inp.value.trim();
        if (v && v !== cur) tx({ type: 'rename', name: v });
        else showName();
      };
      inp.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); done(); }
        if (e.key === 'Escape') { e.preventDefault(); showName(); }
      });
      inp.addEventListener('blur', done);
    }

    // Autocomplete state
    let acSel = 0, acItems = [], acStart = -1;

    function getKnownUsers() {
      if (!active) return [];
      const c = ch.get(active);
      if (!c) return [];
      const seen = new Set();
      for (const m of c.msgs) {
        if (!m.sys && m.who && m.who !== clientId && m.who !== 'system' && m.who !== 'daemon') seen.add(m.who);
      }
      return [...seen].sort();
    }

    function acInput() {
      const inp = document.getElementById('msgIn');
      const v = inp.value, pos = inp.selectionStart;
      // Find @ before cursor
      const before = v.slice(0, pos);
      const at = before.lastIndexOf('@');
      if (at === -1 || (at > 0 && before[at - 1] !== ' ')) { acHide(); return; }
      const query = before.slice(at + 1).toLowerCase();
      if (/\\s/.test(query)) { acHide(); return; }
      acStart = at;
      acItems = getKnownUsers().filter(u => u.toLowerCase().startsWith(query));
      if (acItems.length === 0) { acHide(); return; }
      acSel = 0;
      acRender();
    }

    function acRender() {
      const el = document.getElementById('acList');
      if (!el) return;
      el.classList.remove('hidden');
      el.innerHTML = acItems.map((u, i) =>
        '<div class="ac-item' + (i === acSel ? ' sel' : '') + '" onmousedown="acPick(' + i + ')">' + esc(u) + '</div>'
      ).join('');
    }

    function acHide() {
      acItems = []; acStart = -1;
      const el = document.getElementById('acList');
      if (el) el.classList.add('hidden');
    }

    function acPick(i) {
      const inp = document.getElementById('msgIn');
      const user = acItems[i];
      const before = inp.value.slice(0, acStart);
      const after = inp.value.slice(inp.selectionStart);
      inp.value = before + '@' + user + ' ' + after;
      acHide();
      inp.focus();
      const cur = (before + '@' + user + ' ').length;
      inp.setSelectionRange(cur, cur);
    }

    function acKey(e) {
      if (acItems.length > 0) {
        if (e.key === 'ArrowDown') { e.preventDefault(); acSel = (acSel + 1) % acItems.length; acRender(); return; }
        if (e.key === 'ArrowUp') { e.preventDefault(); acSel = (acSel - 1 + acItems.length) % acItems.length; acRender(); return; }
        if (e.key === 'Tab' || e.key === 'Enter') {
          if (acItems.length > 0) { e.preventDefault(); acPick(acSel); return; }
        }
        if (e.key === 'Escape') { e.preventDefault(); acHide(); return; }
      }
      if (e.key === 'Enter') send();
    }

    function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') { hideJoin(); skipWelcome(); }
      if (e.key === 'Enter' && !document.getElementById('joinModal').classList.contains('hidden')) doJoin();
      if (e.key === 'Enter' && !document.getElementById('welcomeModal').classList.contains('hidden')) setWelcomeName();
    });

    // Refresh members every 10s
    setInterval(() => {
      if (active && ch.has(active)) tx({ type: 'members', channel: active });
    }, 10000);

    window.addEventListener('focus', clearTitleBadge);

    // Load state from server, apply URL params, then connect
    load().then(() => {
      (new URLSearchParams(location.search)).getAll('c').forEach(p => {
        const i = p.indexOf(':');
        const n = i === -1 ? p : p.slice(0, i);
        const s = i === -1 ? p : p.slice(i + 1);
        if (n && s && !ch.has(n)) ch.set(n, { secret: s, msgs: [], unread: 0 });
      });
      go();
    });
  </script>
</body>
</html>`;
