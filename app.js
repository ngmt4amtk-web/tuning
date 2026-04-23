'use strict';

const QUESTION_COUNT = 7;
const RECENT_AVOID = 3;
const PAUSE_MS = 2400;
const STORAGE_KEY_LAST = 'tuning:lastUsed';
const STORAGE_KEY_HISTORY = 'tuning:history';
const STORAGE_KEY_RECENT = 'tuning:recentBuffs';
const HISTORY_MAX = 100;

let pool = null;

async function loadPool() {
  const res = await fetch('./pool.json');
  pool = await res.json();
}

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function lastUsedMap() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY_LAST) || '{}'); }
  catch { return {}; }
}

function setLastUsed(mode) {
  const map = lastUsedMap();
  map[mode] = todayKey();
  localStorage.setItem(STORAGE_KEY_LAST, JSON.stringify(map));
}

function isLockedToday(mode) {
  return lastUsedMap()[mode] === todayKey();
}

function getRecentBuffs(mode) {
  try {
    const all = JSON.parse(localStorage.getItem(STORAGE_KEY_RECENT) || '{}');
    return all[mode] || [];
  } catch { return []; }
}

function pushRecentBuff(mode, buff) {
  let all = {};
  try { all = JSON.parse(localStorage.getItem(STORAGE_KEY_RECENT) || '{}'); } catch {}
  const list = all[mode] || [];
  list.unshift(buff);
  all[mode] = list.slice(0, RECENT_AVOID);
  localStorage.setItem(STORAGE_KEY_RECENT, JSON.stringify(all));
}

function pushHistory(entry) {
  let h = [];
  try { h = JSON.parse(localStorage.getItem(STORAGE_KEY_HISTORY) || '[]'); } catch {}
  h.unshift(entry);
  localStorage.setItem(STORAGE_KEY_HISTORY, JSON.stringify(h.slice(0, HISTORY_MAX)));
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pickQuestions(mode) {
  const all = pool.modes[mode].questions;
  return shuffle(all).slice(0, QUESTION_COUNT);
}

function pickBuff(mode) {
  const all = pool.modes[mode].buffs;
  const recent = new Set(getRecentBuffs(mode));
  const candidates = all.filter(b => !recent.has(b));
  const source = candidates.length > 0 ? candidates : all;
  return source[Math.floor(Math.random() * source.length)];
}

function fmtDate(iso) {
  const d = new Date(iso);
  const M = d.getMonth()+1;
  const D = d.getDate();
  const h = String(d.getHours()).padStart(2,'0');
  const m = String(d.getMinutes()).padStart(2,'0');
  return `${M}/${D} ${h}:${m}`;
}

const root = document.getElementById('app');

function renderHome() {
  const dateStr = (() => {
    const d = new Date();
    const days = ['日','月','火','水','木','金','土'];
    return `${d.getFullYear()}.${d.getMonth()+1}.${d.getDate()}(${days[d.getDay()]})`;
  })();

  const modes = pool.modes;
  const cards = Object.entries(modes).map(([id, m]) => {
    const locked = isLockedToday(id);
    return `
      <button class="mode-card${locked ? ' locked' : ''}" data-mode="${id}" ${locked ? 'disabled' : ''}>
        <div class="mode-label">${m.label}</div>
        <div class="mode-sub">${m.subtitle}</div>
        ${locked ? '<div class="lock-text">今日はもうチューニング済み</div>' : ''}
      </button>
    `;
  }).join('');

  root.innerHTML = `
    <header>
      <h1 class="title">チューニング</h1>
      <div class="date">${dateStr}</div>
    </header>
    <div class="modes">${cards}</div>
    <div class="footer">
      <button id="show-history">履歴</button>
      <button id="reset-today">今日のロック解除</button>
    </div>
  `;

  root.querySelectorAll('.mode-card:not(.locked)').forEach(btn => {
    btn.addEventListener('click', () => startMode(btn.dataset.mode));
  });
  document.getElementById('show-history').addEventListener('click', renderHistory);
  document.getElementById('reset-today').addEventListener('click', () => {
    if (confirm('今日のロックを全部解除する？')) {
      localStorage.removeItem(STORAGE_KEY_LAST);
      renderHome();
    }
  });
}

function startMode(mode) {
  const questions = pickQuestions(mode);
  const answers = [];
  let i = 0;

  function renderQuestion() {
    const [a, b] = questions[i];
    root.innerHTML = `
      <div class="question-screen">
        <div class="progress">${i+1} / ${QUESTION_COUNT}</div>
        <div class="q-text">${escapeHtml(a)} ／ ${escapeHtml(b)}</div>
        <div class="choices">
          <button class="choice" data-choice="0">${escapeHtml(a)}</button>
          <button class="choice" data-choice="1">${escapeHtml(b)}</button>
        </div>
      </div>
    `;
    root.querySelectorAll('.choice').forEach(btn => {
      btn.addEventListener('click', () => {
        answers.push(parseInt(btn.dataset.choice, 10));
        i++;
        if (i < QUESTION_COUNT) {
          renderQuestion();
        } else {
          showResult(mode, answers);
        }
      });
    });
  }

  renderQuestion();
}

function showResult(mode, answers) {
  root.innerHTML = `
    <div class="result-screen">
      <div class="result-pause">. . .</div>
    </div>
  `;

  setTimeout(() => {
    const buff = pickBuff(mode);
    setLastUsed(mode);
    pushRecentBuff(mode, buff);
    pushHistory({
      ts: new Date().toISOString(),
      mode,
      modeLabel: pool.modes[mode].label,
      buff,
      answers
    });

    root.innerHTML = `
      <div class="result-screen">
        <div class="buff-text">${escapeHtml(buff)}</div>
        <div class="buff-hint">声に出して、1回読んでみて</div>
        <div class="result-actions">
          <button class="primary" id="back-home">戻る</button>
          <button id="another-buff">違うやつにする</button>
        </div>
      </div>
    `;

    document.getElementById('back-home').addEventListener('click', renderHome);
    document.getElementById('another-buff').addEventListener('click', () => {
      const newBuff = pickBuff(mode);
      pushRecentBuff(mode, newBuff);
      const last = JSON.parse(localStorage.getItem(STORAGE_KEY_HISTORY) || '[]');
      if (last[0]) { last[0].buff = newBuff; localStorage.setItem(STORAGE_KEY_HISTORY, JSON.stringify(last)); }
      document.querySelector('.buff-text').textContent = newBuff;
    });
  }, PAUSE_MS);
}

function renderHistory() {
  let h = [];
  try { h = JSON.parse(localStorage.getItem(STORAGE_KEY_HISTORY) || '[]'); } catch {}

  const items = h.length === 0
    ? '<div style="color:var(--sub);font-size:14px;text-align:center;padding:20px;">まだ履歴なし</div>'
    : h.map(e => `
        <div class="history-item">
          <div class="meta">${fmtDate(e.ts)} ・ ${escapeHtml(e.modeLabel)}</div>
          <div>${escapeHtml(e.buff)}</div>
        </div>
      `).join('');

  const modal = document.createElement('div');
  modal.className = 'history-modal';
  modal.innerHTML = `
    <div class="history-content">
      <h2>履歴（直近${HISTORY_MAX}件）</h2>
      ${items}
      <button class="history-close">閉じる</button>
    </div>
  `;
  modal.addEventListener('click', (e) => {
    if (e.target === modal || e.target.classList.contains('history-close')) {
      modal.remove();
    }
  });
  document.body.appendChild(modal);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

(async () => {
  await loadPool();
  renderHome();
})();
