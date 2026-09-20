'use strict';

const $ = (s) => document.querySelector(s);
const entryScreen = $('#entryScreen');
const lobbyScreen = $('#lobbyScreen');
const gameScreen = $('#gameScreen');
const entryError = $('#entryError');
const lobbyPlayers = $('#lobbyPlayers');
const startOnlineBtn = $('#startOnlineBtn');
const testOnlineBtn = $('#testOnlineBtn');
const bgmToggleBtn = $('#bgmToggleBtn');
const joinCodeInput = $('#joinCode');
const roomCodeText = $('#roomCodeText');
const gameRoomCode = $('#gameRoomCode');
const playerList = $('#playerList');
const eventLog = $('#eventLog');
const ruleList = $('#ruleList');
const activeTrap = $('#activeTrap');
const trapHistory = $('#trapHistory');
const spotlightCard = $('#spotlightCard');
const handEl = $('#hand');
const selectedCardPreview = $('#selectedCardPreview');
const playSelectedBtn = $('#playSelectedBtn');
const actionHint = $('#actionHint');
const drawBtn = $('#drawBtn');
const endTurnBtn = $('#endTurnBtn');
const chatInput = $('#chatInput');
const chatSendBtn = $('#chatSendBtn');
const modal = $('#modal');
const modalTitle = $('#modalTitle');
const modalBody = $('#modalBody');
const modalActions = $('#modalActions');
const toast = $('#toast');
const interruptFx = $('#interruptFx');
const interruptChain = $('#interruptChain');
const eliminationFx = $('#eliminationFx');
const eliminationName = $('#eliminationName');
const eliminationReason = $('#eliminationReason');

let session = null;
let source = null;
let state = null;
let selectedUid = null;
let privacyMode = false;
let currentPromptId = null;
let fxTimer = null;

// --- ゆったりピアノ風BGM（Web Audioで生成。音源ファイル不要） ---
let bgmEnabled = true;
let audioCtx = null;
let bgmMaster = null;
let bgmTimer = null;
let bgmPhrase = 0;

function midiToHz(m) { return 440 * Math.pow(2, (m - 69) / 12); }
function playPianoNote(midi, when, duration = 2.8, volume = 0.11) {
  if (!audioCtx || !bgmMaster) return;
  const osc1 = audioCtx.createOscillator();
  const osc2 = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  const filter = audioCtx.createBiquadFilter();
  osc1.type = 'sine';
  osc2.type = 'triangle';
  osc1.frequency.setValueAtTime(midiToHz(midi), when);
  osc2.frequency.setValueAtTime(midiToHz(midi) * 2, when);
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(1700, when);
  filter.Q.setValueAtTime(0.6, when);
  gain.gain.setValueAtTime(0.0001, when);
  gain.gain.exponentialRampToValueAtTime(volume, when + 0.018);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, volume * 0.35), when + 0.45);
  gain.gain.exponentialRampToValueAtTime(0.0001, when + duration);
  osc1.connect(gain);
  osc2.connect(gain);
  gain.connect(filter);
  filter.connect(bgmMaster);
  osc1.start(when); osc2.start(when);
  osc1.stop(when + duration + 0.05); osc2.stop(when + duration + 0.05);
}
function scheduleBgmPhrase() {
  if (!bgmEnabled || !audioCtx || audioCtx.state !== 'running') return;
  const progressions = [
    [48, 55, 60, 64, 67], // Cmaj7
    [45, 52, 57, 60, 64], // Am7
    [41, 48, 53, 57, 60], // Fmaj7
    [43, 50, 55, 57, 62], // Gsus2
  ];
  const chord = progressions[bgmPhrase % progressions.length];
  const start = audioCtx.currentTime + 0.08;
  playPianoNote(chord[0], start, 5.8, 0.09);
  [0, 1.35, 2.7, 4.05].forEach((offset, i) => {
    playPianoNote(chord[1 + (i % 4)], start + offset, 2.5, 0.095);
    if (i === 2) playPianoNote(chord[4], start + offset + 0.45, 2.1, 0.06);
  });
  bgmPhrase++;
}
async function ensureBgmStarted() {
  if (!bgmEnabled) return;
  try {
    if (!audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      audioCtx = new AC();
      bgmMaster = audioCtx.createGain();
      bgmMaster.gain.value = 0.22;
      const delay = audioCtx.createDelay(2.0);
      const feedback = audioCtx.createGain();
      const wet = audioCtx.createGain();
      delay.delayTime.value = 0.24;
      feedback.gain.value = 0.15;
      wet.gain.value = 0.16;
      bgmMaster.connect(audioCtx.destination);
      bgmMaster.connect(delay);
      delay.connect(feedback); feedback.connect(delay);
      delay.connect(wet); wet.connect(audioCtx.destination);
    }
    if (audioCtx.state === 'suspended') await audioCtx.resume();
    if (!bgmTimer) {
      scheduleBgmPhrase();
      bgmTimer = setInterval(scheduleBgmPhrase, 5500);
    }
  } catch (_) {}
}
async function setBgmEnabled(enabled) {
  bgmEnabled = !!enabled;
  bgmToggleBtn.textContent = bgmEnabled ? '♪ BGM ON' : '♪ BGM OFF';
  bgmToggleBtn.setAttribute('aria-pressed', String(bgmEnabled));
  bgmToggleBtn.classList.toggle('off', !bgmEnabled);
  if (bgmEnabled) {
    await ensureBgmStarted();
  } else {
    if (bgmTimer) { clearInterval(bgmTimer); bgmTimer = null; }
    if (audioCtx?.state === 'running') await audioCtx.suspend().catch(() => {});
  }
}

const storageKey = 'coolSoulOnlineSession';
const esc = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c]));

function showScreen(screen) {
  [entryScreen, lobbyScreen, gameScreen].forEach((x) => x.classList.remove('active'));
  screen.classList.add('active');
}
function showError(text) {
  entryError.textContent = text;
  entryError.classList.remove('hidden');
  clearTimeout(showError.t);
  showError.t = setTimeout(() => entryError.classList.add('hidden'), 5000);
}
function showToast(text) {
  toast.textContent = text;
  toast.classList.remove('hidden');
  clearTimeout(showToast.t);
  showToast.t = setTimeout(() => toast.classList.add('hidden'), 3200);
}
async function post(url, body) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '通信に失敗したわ。');
  return data;
}
function saveSession(data) {
  session = { roomCode: data.roomCode, playerId: data.playerId, token: data.token };
  localStorage.setItem(storageKey, JSON.stringify(session));
}
function clearSession() {
  session = null;
  localStorage.removeItem(storageKey);
  if (source) source.close();
  source = null;
}

async function createRoom() {
  try {
    const name = $('#createName').value.trim();
    if (!name) return showError('名前を入れなさい。');
    const data = await post('/api/create', { name });
    saveSession(data);
    connectEvents();
  } catch (e) { showError(e.message); }
}
async function joinRoom() {
  try {
    const name = $('#joinName').value.trim();
    const roomCode = $('#joinCode').value.trim().toUpperCase();
    if (!name || roomCode.length !== 6) return showError('名前と6文字のルームコードを確認して。');
    const data = await post('/api/join', { name, roomCode });
    saveSession(data);
    connectEvents();
  } catch (e) { showError(e.message); }
}
async function reconnectSaved() {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return;
    session = JSON.parse(raw);
    await post('/api/reconnect', session);
    connectEvents();
  } catch (_) {
    clearSession();
  }
}

function connectEvents() {
  if (!session) return;
  if (source) source.close();
  const q = new URLSearchParams(session);
  source = new EventSource(`/events?${q}`);
  source.addEventListener('state', (e) => {
    state = JSON.parse(e.data);
    render();
  });
  source.addEventListener('prompt', (e) => showPrompt(JSON.parse(e.data)));
  source.addEventListener('notice', (e) => showToast(JSON.parse(e.data).text || 'お知らせ'));
  source.addEventListener('fx', (e) => playFx(JSON.parse(e.data)));
  source.onopen = () => setConnection(true);
  source.onerror = () => setConnection(false);
}
function setConnection(ok) {
  const lobby = $('#lobbyConnection');
  if (lobby) { lobby.textContent = ok ? '接続中' : '再接続中…'; lobby.classList.toggle('offline', !ok); }
  const dot = $('#connectionDot');
  if (dot) dot.classList.toggle('offline', !ok);
}

function render() {
  if (!state) return;
  if (state.status === 'lobby') {
    showScreen(lobbyScreen);
    renderLobby();
  } else {
    showScreen(gameScreen);
    renderGame();
  }
}
function renderLobby() {
  roomCodeText.textContent = state.roomCode;
  lobbyPlayers.innerHTML = '';
  state.players.forEach((p, i) => {
    const d = document.createElement('div');
    d.className = `lobby-player ${p.connected ? '' : 'offline'}`;
    d.innerHTML = `<div class="lobby-avatar">${i + 1}</div><div><strong>${esc(p.name)}</strong><span>${p.id === state.hostId ? 'HOST' : 'PLAYER'} · ${p.connected ? '接続中' : '切断中'}</span></div>${p.id === state.me ? '<em>YOU</em>' : ''}`;
    lobbyPlayers.appendChild(d);
  });
  const isHost = state.me === state.hostId;
  startOnlineBtn.style.display = isHost ? 'inline-flex' : 'none';
  startOnlineBtn.disabled = !state.canStart;
  testOnlineBtn.style.display = isHost && state.players.length === 2 ? 'inline-flex' : 'none';
  testOnlineBtn.disabled = !state.canTestStart;
}
function renderGame() {
  gameRoomCode.textContent = state.roomCode;
  $('#roundNumber').textContent = state.round;
  $('#deckCount').textContent = state.deckCount;
  $('#discardCount').textContent = state.discardCount;
  $('#playerCount').textContent = `${state.players.filter((p) => p.alive).length}/${state.players.length}`;
  const me = state.players.find((p) => p.id === state.me);
  $('#playCount').textContent = me ? `${Math.min(me.playedThisTurn, 1)}/1` : '0/1';
  $('#drawState').textContent = state.currentPlayerId === state.me ? (state.drawnThisTurn ? '実行済み' : '未実行') : '待機';
  $('#syncState').textContent = state.busy ? '効果処理中' : '同期済み';
  $('#turnBanner').textContent = state.currentPlayerId === state.me ? 'あなたのターン' : `${state.currentPlayerName} のターン`;

  renderPlayers();
  renderLogs();
  renderRules();
  renderTraps();
  renderSpotlight();
  renderHand();
  renderSelected();

  drawBtn.disabled = !state.canDraw || state.busy;
  endTurnBtn.disabled = !state.canEndTurn || state.busy;
  chatSendBtn.disabled = !me?.alive || me?.away;
  chatInput.disabled = !me?.alive || me?.away;
}
function renderPlayers() {
  playerList.innerHTML = '';
  const top = Math.max(0, ...state.players.map((p) => p.points));
  state.players.forEach((p) => {
    const d = document.createElement('div');
    d.className = `player-card ${p.id === state.currentPlayerId ? 'current' : ''} ${p.alive ? '' : 'out'} ${p.away ? 'away' : ''}`;
    const crown = p.points === top && top > 0 ? '👑' : '';
    d.innerHTML = `<div class="player-top"><div><div class="player-name">${esc(p.name)} ${p.id === state.me ? '<small>YOU</small>' : ''}</div><div class="player-meta"><span>${p.points} pt</span><span>手札 ${p.handCount}枚</span></div></div><div class="player-points">${crown}</div></div><div class="player-meta"><span class="player-badge ${p.alive ? 'alive' : 'out'}">${p.alive ? (p.away ? '退避中' : '生存中') : '脱落'}</span><span>${esc(p.statusText)} ${p.connected ? '' : ' · 切断中'}</span></div>`;
    if (p.id === state.currentPlayerId && p.alive) {
      const tag = document.createElement('div'); tag.className = 'player-turn-tag'; tag.textContent = p.id === state.me ? 'あなたのターン' : 'TURN'; d.appendChild(tag);
    }
    playerList.appendChild(d);
  });
}
function renderLogs() {
  eventLog.innerHTML = '';
  if (!state.logs.length) return eventLog.innerHTML = '<div class="empty-box">まだ何も起きていないわ。</div>';
  state.logs.forEach((e) => {
    const d = document.createElement('div'); d.className = `log-item ${e.type || 'normal'}`;
    d.innerHTML = `<span class="log-time">${esc(e.time)}</span>${esc(e.msg)}`; eventLog.appendChild(d);
  });
}
function renderRules() {
  ruleList.innerHTML = state.rules.length ? '' : '<div class="empty-box">現在適用中の継続ルールはないわ。</div>';
  state.rules.forEach((r) => { const d = document.createElement('div'); d.className = 'rule-pill'; d.textContent = r; ruleList.appendChild(d); });
}
function renderTraps() {
  activeTrap.innerHTML = state.activeTrap ? `<div class="trap-card"><div class="name">${esc(state.activeTrap.name)}</div><div class="sub">${esc(state.activeTrap.description)}</div></div>` : '<div class="empty-box">いま表に出ているTRAPはないわ。</div>';
  trapHistory.innerHTML = state.trapHistory.length ? '' : '<div class="empty-box">TRAP履歴はまだないわ。</div>';
  state.trapHistory.forEach((t, i) => { const d = document.createElement('div'); d.className = 'trap-item'; d.innerHTML = `<strong>${i + 1}. ${esc(t.name)}</strong><div class="muted">${esc(t.description)}</div>`; trapHistory.appendChild(d); });
}
function renderSpotlight() {
  if (!state.lastPlayed) {
    spotlightCard.className = 'spotlight-card';
    spotlightCard.innerHTML = `<div class="spotlight-type">ONLINE</div><div class="spotlight-name">理不尽、同期中。</div><div class="spotlight-text">別々の端末から同じルームへ参加中。手札は本人にしか見えないわ。</div><div class="spotlight-meta">現在：${esc(state.currentPlayerName)}</div>`;
    return;
  }
  const c = state.lastPlayed;
  spotlightCard.className = `spotlight-card ${c.type === 'TRAP' ? 'trap' : ''}`;
  spotlightCard.innerHTML = `<div class="spotlight-type ${c.type === 'TRAP' ? 'trap' : ''}">${esc(c.type)}</div><div class="spotlight-name">${esc(c.name)}</div><div class="spotlight-text">${esc(c.text)}</div><div class="spotlight-meta">使用者：${esc(c.by || '--')}${c.target ? ` ｜ 対象：${esc(c.target)}` : ''}</div>`;
}
function renderHand() {
  handEl.innerHTML = '';
  if (selectedUid && !state.myHand.some((c) => c.uid === selectedUid)) selectedUid = null;
  if (privacyMode) {
    state.myHand.forEach(() => { const d = document.createElement('div'); d.className = 'card hidden-card'; d.innerHTML = '<strong>手札</strong>'; handEl.appendChild(d); });
    return;
  }
  state.myHand.forEach((c) => {
    const d = document.createElement('div');
    const selected = c.uid === selectedUid;
    const unavailable = c.type === '割込' || c.type === '強制' || !state.canPlayTurnCard;
    d.className = `card ${c.type === 'TRAP' ? 'trap' : ''} ${selected ? 'selected' : ''} ${unavailable ? 'disabled-card' : ''}`;
    d.innerHTML = `<div class="card-type ${c.type === 'TRAP' ? 'trap' : ''}">${esc(c.type)}</div><h3>${esc(c.name)}</h3><div class="text">${esc(c.text)}</div><div class="card-footer"><span>${c.type === '割込' ? '条件成立時に確認' : c.type === '強制' ? '自動発動' : c.type === 'TRAP' ? 'UIトラップ' : 'カード効果'}</span><span class="card-state">${selected ? '選択中' : 'クリックで選択'}</span></div>`;
    d.onclick = () => { selectedUid = c.uid; renderHand(); renderSelected(); };
    handEl.appendChild(d);
  });
  $('#handMeta').textContent = `(${state.myHand.length}枚) ｜ 初期手札 5枚 ｜ 通常系は1ターン1枚 ｜ 割込は条件成立時に別枠`;
}
function renderSelected() {
  const c = state.myHand.find((x) => x.uid === selectedUid);
  if (!c) {
    selectedCardPreview.textContent = 'カードを1枚選んで。';
    playSelectedBtn.disabled = true;
    actionHint.textContent = state.currentPlayerId === state.me ? '使うカードを選びなさい。' : '自分のターンになるまで手札でも眺めてなさい。';
    return;
  }
  selectedCardPreview.innerHTML = `<div class="preview-type">${esc(c.type)}</div><div class="preview-name">${esc(c.name)}</div><div>${esc(c.text)}</div>`;
  const interrupt = c.type === '割込';
  const forced = c.type === '強制';
  playSelectedBtn.disabled = !state.canPlayTurnCard || interrupt || forced || state.busy;
  actionHint.textContent = interrupt ? '割込カードは条件が起きた時に専用確認が出るわ。' : forced ? '強制カードは条件成立時に自動発動。' : state.canPlayTurnCard ? '準備OK。押したら戻せないわよ。' : '今は使えないわ。';
}

function showPrompt(p) {
  currentPromptId = p.requestId;
  modal.classList.remove('trap-mode', 'trap-right-mode');
  if (p.skin === 'trap') modal.classList.add('trap-mode');
  if (p.skin === 'trap-right') modal.classList.add('trap-mode', 'trap-right-mode');
  modalTitle.textContent = p.title || '選択';
  modalBody.innerHTML = `<div class="prompt-message">${esc(p.message || '').replace(/\n/g, '<br>')}</div>`;
  modalActions.innerHTML = '';
  (p.options || []).forEach((opt) => {
    const b = document.createElement('button');
    b.textContent = opt.label;
    b.className = opt.primary ? 'primary' : 'secondary';
    if (p.skin?.startsWith('trap')) b.className = opt.primary ? 'trap-danger-choice' : 'trap-safe-choice';
    b.onclick = () => respondPrompt(p.requestId, opt.value);
    modalActions.appendChild(b);
  });
  modal.classList.remove('hidden');
  if (p.kind === 'trap') showToast('TRAP UIがあなたの画面に侵入したわ。');
  else playFx({ type: 'interruptPrompt', title: p.title });
}
async function respondPrompt(requestId, value) {
  if (!session || currentPromptId !== requestId) return;
  [...modalActions.querySelectorAll('button')].forEach((b) => b.disabled = true);
  try {
    await post('/api/action', { ...session, action: 'promptResponse', payload: { requestId, value } });
    modal.classList.add('hidden');
    currentPromptId = null;
  } catch (e) { showToast(e.message); modal.classList.add('hidden'); currentPromptId = null; }
}

function playFx(fx) {
  clearTimeout(fxTimer);
  if (fx.type === 'interrupt' || fx.type === 'interruptPrompt') {
    interruptChain.innerHTML = '';
    const entries = fx.entries || [{ name: fx.title || '割り込み確認', owner: 'あなた' }];
    entries.forEach((e, i) => {
      if (i) { const a = document.createElement('div'); a.textContent = '→'; a.style.fontSize = '36px'; a.style.fontWeight = '1000'; interruptChain.appendChild(a); }
      const d = document.createElement('div'); d.className = 'interrupt-chain-card'; d.innerHTML = `<strong>${esc(e.name)}</strong><span>${esc(e.owner || '')}</span>`; interruptChain.appendChild(d);
    });
    interruptFx.classList.remove('hidden');
    fxTimer = setTimeout(() => interruptFx.classList.add('hidden'), 1200);
  } else if (fx.type === 'elimination') {
    eliminationName.textContent = fx.name;
    eliminationReason.textContent = `理由：${fx.reason}`;
    eliminationFx.classList.remove('hidden');
    document.body.classList.add('elimination-shake');
    fxTimer = setTimeout(() => { eliminationFx.classList.add('hidden'); document.body.classList.remove('elimination-shake'); }, 1300);
  } else if (fx.type === 'roundWin') {
    showBigMessage('ROUND WIN', `${fx.name} +1 POINT`);
  } else if (fx.type === 'gameWin') {
    showBigMessage('THE COOL SOUL WINNER', `${fx.name} / 3 POINT`, 4200);
  } else if (fx.type === 'coin') {
    showBigMessage('🪙 COIN TOSS', `${fx.winner} の勝ち`, 1800);
  } else if (fx.type === 'allOut') {
    showBigMessage('全滅', 'このラウンド、勝者なし。', 2600);
  }
}
function showBigMessage(title, sub, ms = 3000) {
  interruptChain.innerHTML = `<div class="interrupt-chain-card"><strong>${esc(title)}</strong><span>${esc(sub)}</span></div>`;
  interruptFx.classList.remove('hidden');
  fxTimer = setTimeout(() => interruptFx.classList.add('hidden'), ms);
}

async function action(action, payload = {}) {
  if (!session) return;
  try { await post('/api/action', { ...session, action, payload }); }
  catch (e) { showToast(e.message); }
}

$('#createRoomBtn').onclick = createRoom;
$('#joinRoomBtn').onclick = joinRoom;

// IME変換中に value を書き換えると、環境によって YY / HH のように二重入力されることがある。
// 変換中は触らず、確定後だけ正規化する。
let joinCodeComposing = false;
function normalizeJoinCode() {
  if (!joinCodeInput || joinCodeComposing) return;
  const normalized = joinCodeInput.value
    .normalize('NFKC')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 6);
  if (joinCodeInput.value !== normalized) joinCodeInput.value = normalized;
}
joinCodeInput.addEventListener('compositionstart', () => { joinCodeComposing = true; });
joinCodeInput.addEventListener('compositionend', () => { joinCodeComposing = false; normalizeJoinCode(); });
joinCodeInput.addEventListener('input', normalizeJoinCode);
joinCodeInput.addEventListener('paste', () => setTimeout(normalizeJoinCode, 0));

$('#copyCodeBtn').onclick = async () => { if (state?.roomCode) { await navigator.clipboard?.writeText(state.roomCode).catch(() => {}); showToast(`参加コード ${state.roomCode} をコピーしたわ。`); } };
startOnlineBtn.onclick = async () => { try { await post('/api/start', session); } catch (e) { showToast(e.message); } };
testOnlineBtn.onclick = async () => { try { await post('/api/start', { ...session, testMode: true }); } catch (e) { showToast(e.message); } };

bgmToggleBtn.onclick = () => setBgmEnabled(!bgmEnabled);
// ブラウザの自動再生制限対策：最初のユーザー操作後に静かなBGMを開始。
document.addEventListener('pointerdown', () => { if (bgmEnabled) ensureBgmStarted(); }, { once: true, capture: true });
drawBtn.onclick = () => action('draw');
endTurnBtn.onclick = () => action('endTurn');
playSelectedBtn.onclick = () => selectedUid && action('playCard', { uid: selectedUid });
chatSendBtn.onclick = () => { const text = chatInput.value.trim(); if (!text) return; chatInput.value = ''; action('chat', { text }); };
chatInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); chatSendBtn.click(); } });
$('#togglePrivacyBtn').onclick = () => { privacyMode = !privacyMode; $('#togglePrivacyBtn').textContent = privacyMode ? '手札を表示' : '手札を隠す'; if (state?.status === 'playing') renderHand(); };

reconnectSaved();
