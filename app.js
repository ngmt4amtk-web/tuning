'use strict';

const STORAGE_KEY_LAST = 'tuning:lastUsed';
const STORAGE_KEY_HISTORY = 'tuning:history';
const STORAGE_KEY_RECENT = 'tuning:recentBuffs';
const HISTORY_MAX = 100;
const RECENT_AVOID = 2;
const COMPUTE_DELAY_MS = 2600;

let pool = null;

async function loadPool() {
  const res = await fetch('./pool.json?v=2', { cache: 'no-store' });
  pool = await res.json();
}

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function safeJson(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
  catch { return fallback; }
}

function lastUsedMap() { return safeJson(STORAGE_KEY_LAST, {}); }
function setLastUsed(mode) {
  const map = lastUsedMap();
  map[mode] = todayKey();
  localStorage.setItem(STORAGE_KEY_LAST, JSON.stringify(map));
}
function isLockedToday(mode) { return lastUsedMap()[mode] === todayKey(); }

function getRecentBuffs(mode) {
  const all = safeJson(STORAGE_KEY_RECENT, {});
  return all[mode] || [];
}
function pushRecentBuff(mode, buffId) {
  const all = safeJson(STORAGE_KEY_RECENT, {});
  const list = all[mode] || [];
  const next = [buffId, ...list.filter(id => id !== buffId)].slice(0, RECENT_AVOID);
  all[mode] = next;
  localStorage.setItem(STORAGE_KEY_RECENT, JSON.stringify(all));
}

function pushHistory(entry) {
  const h = safeJson(STORAGE_KEY_HISTORY, []);
  h.unshift(entry);
  localStorage.setItem(STORAGE_KEY_HISTORY, JSON.stringify(h.slice(0, HISTORY_MAX)));
}

const DIMENSIONS = ['arousal', 'valence', 'interoception', 'dmn', 'social', 'motor'];

function emptyVector() {
  const v = {};
  DIMENSIONS.forEach(d => v[d] = 0);
  return v;
}

function addTagsToVector(vec, tags) {
  if (!tags) return;
  DIMENSIONS.forEach(d => {
    if (typeof tags[d] === 'number') vec[d] += tags[d];
  });
}

function cosineSimilarity(a, b) {
  let dot = 0, na = 0, nb = 0;
  DIMENSIONS.forEach(d => {
    dot += (a[d] || 0) * (b[d] || 0);
    na += (a[d] || 0) ** 2;
    nb += (b[d] || 0) ** 2;
  });
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function pickBuff(mode, stateVector) {
  const buffs = pool.modes[mode].buffs;
  const recent = new Set(getRecentBuffs(mode));

  const scored = buffs.map(b => ({
    buff: b,
    score: cosineSimilarity(stateVector, b.target_vector),
    recent: recent.has(b.id)
  }));

  scored.sort((x, y) => {
    if (x.recent !== y.recent) return x.recent ? 1 : -1;
    return y.score - x.score;
  });

  return scored[0].buff;
}

function fmtDate(iso) {
  const d = new Date(iso);
  const M = d.getMonth() + 1;
  const D = d.getDate();
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${M}/${D} ${h}:${m}`;
}

function formatDateHeader() {
  const d = new Date();
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')} · ${days[d.getDay()]}`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function paperToHtml(id) {
  const p = pool.papers[id];
  if (!p) return '';
  const linkedTitle = p.doi
    ? `<a href="https://doi.org/${escapeHtml(p.doi)}" target="_blank" rel="noopener">${escapeHtml(p.title)}</a>`
    : escapeHtml(p.title);
  return `
    <li class="paper">
      <div class="paper-head">${escapeHtml(p.authors)} (${p.year}).</div>
      <div class="paper-title">${linkedTitle}</div>
      <div class="paper-journal">${escapeHtml(p.journal)}${p.doi ? `. <span class="doi">doi:${escapeHtml(p.doi)}</span>` : ''}</div>
    </li>
  `;
}

const root = document.getElementById('app');

function renderHome() {
  const modes = pool.modes;
  const cards = Object.entries(modes).map(([id, m]) => {
    const locked = isLockedToday(id);
    return `
      <button class="mode-card${locked ? ' locked' : ''}" data-mode="${id}" ${locked ? 'disabled' : ''}>
        <div class="mode-label">${escapeHtml(m.label)}</div>
        <div class="mode-sub">${escapeHtml(m.subtitle)}</div>
        ${locked ? '<div class="lock-text">本日分は測定済み</div>' : ''}
      </button>
    `;
  }).join('');

  root.innerHTML = `
    <header>
      <div class="brand">tuning</div>
      <h1 class="title">Phenomenological State Inventory</h1>
      <div class="subtitle">現在の状態を同定し、活用可能な文脈として提示する</div>
      <div class="date">${formatDateHeader()}</div>
    </header>
    <div class="modes">${cards}</div>
    <div class="footer">
      <button id="show-history">履歴を見る</button>
      <button id="reset-today">本日のロックを解除</button>
    </div>
    <div class="disclosure">
      本ツールは、回答に対して実在する査読論文を根拠とした再フレームを提示する。
      出力される解釈は、身体・認知状態の一つの読み替えであり、医療的判断に用いない。
    </div>
  `;

  root.querySelectorAll('.mode-card:not(.locked)').forEach(btn => {
    btn.addEventListener('click', () => startMode(btn.dataset.mode));
  });
  document.getElementById('show-history').addEventListener('click', renderHistory);
  document.getElementById('reset-today').addEventListener('click', () => {
    if (confirm('本日のロックを全モード解除しますか？')) {
      localStorage.removeItem(STORAGE_KEY_LAST);
      renderHome();
    }
  });
}

function startMode(modeId) {
  const mode = pool.modes[modeId];
  const questions = mode.questions.slice();
  const stateVector = emptyVector();
  const answers = [];
  let i = 0;

  function renderQuestion() {
    const q = questions[i];
    root.innerHTML = `
      <div class="question-screen">
        <div class="progress">Question ${i + 1} / ${questions.length}</div>
        <div class="q-text">${escapeHtml(q.prompt)}</div>
        <div class="choices">
          ${q.choices.map((c, idx) => `
            <button class="choice" data-idx="${idx}">${escapeHtml(c.label)}</button>
          `).join('')}
        </div>
        <div class="q-hint">一瞬で、身体の反応が近い方を選ぶ</div>
      </div>
    `;
    root.querySelectorAll('.choice').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.idx, 10);
        const chosen = q.choices[idx];
        addTagsToVector(stateVector, chosen.tags);
        answers.push({ q: q.prompt, choice: chosen.label });
        i++;
        if (i < questions.length) renderQuestion();
        else runCompute();
      });
    });
  }

  function runCompute() {
    root.innerHTML = `
      <div class="compute-screen">
        <div class="compute-label">照合中</div>
        <div class="compute-detail">
          <div>state vector: ${DIMENSIONS.map(d => `${d}=${stateVector[d]}`).join(' · ')}</div>
          <div class="compute-scan">matching against 6-dimensional buff space...</div>
        </div>
      </div>
    `;
    setTimeout(() => showResult(modeId, stateVector, answers), COMPUTE_DELAY_MS);
  }

  renderQuestion();
}

function showResult(modeId, stateVector, answers) {
  const buff = pickBuff(modeId, stateVector);
  setLastUsed(modeId);
  pushRecentBuff(modeId, buff.id);
  pushHistory({
    ts: new Date().toISOString(),
    mode: modeId,
    modeLabel: pool.modes[modeId].label,
    buffId: buff.id,
    buffNameEn: buff.mode_name_en,
    buffNameJa: buff.mode_name_ja,
    stateVector,
    answers
  });

  const papersHtml = buff.paper_ids.map(paperToHtml).join('');

  root.innerHTML = `
    <div class="result-screen">
      <div class="result-band">Identified Mode</div>
      <h1 class="mode-title">${escapeHtml(buff.mode_name_en)}</h1>
      <div class="mode-title-ja">${escapeHtml(buff.mode_name_ja)}</div>
      <hr class="result-rule"/>

      <section class="result-section">
        <div class="section-label">Observation · 観測</div>
        <div class="section-body">${escapeHtml(buff.observation)}</div>
      </section>

      <section class="result-section">
        <div class="section-label">Common Misreading · 一般的な誤解</div>
        <div class="section-body">${escapeHtml(buff.misreading)}</div>
      </section>

      <section class="result-section">
        <div class="section-label">Underlying State · 実態</div>
        <div class="section-body">${escapeHtml(buff.reality)}</div>
      </section>

      <section class="result-section">
        <div class="section-label">References · 根拠論文</div>
        <ul class="papers">${papersHtml}</ul>
      </section>

      <section class="result-section">
        <div class="section-label">Application · 活かし方</div>
        <div class="section-body">${escapeHtml(buff.application)}</div>
      </section>

      <div class="result-actions">
        <button class="primary" id="back-home">閉じる</button>
      </div>

      <div class="state-vector-strip">
        state vector · ${DIMENSIONS.map(d => `${d}:${stateVector[d] >= 0 ? '+' : ''}${stateVector[d]}`).join(' · ')}
      </div>
    </div>
  `;

  document.getElementById('back-home').addEventListener('click', renderHome);
}

function renderHistory() {
  const h = safeJson(STORAGE_KEY_HISTORY, []);
  const items = h.length === 0
    ? '<div class="history-empty">履歴はまだありません</div>'
    : h.map(e => `
        <div class="history-item">
          <div class="meta">${fmtDate(e.ts)} · ${escapeHtml(e.modeLabel)}</div>
          <div class="history-mode">${escapeHtml(e.buffNameEn || e.buffId || '')}</div>
          <div class="history-mode-ja">${escapeHtml(e.buffNameJa || '')}</div>
        </div>
      `).join('');

  const modal = document.createElement('div');
  modal.className = 'history-modal';
  modal.innerHTML = `
    <div class="history-content">
      <h2>Session History</h2>
      <div class="history-subtitle">直近 ${HISTORY_MAX} 件まで保持</div>
      ${items}
      <button class="history-close">閉じる</button>
    </div>
  `;
  modal.addEventListener('click', (e) => {
    if (e.target === modal || e.target.classList.contains('history-close')) modal.remove();
  });
  document.body.appendChild(modal);
}

(async () => {
  await loadPool();
  renderHome();
})();
