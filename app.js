/* =========================
 * 設定：URL一覧をどう用意するか選ぶ
 *  - "hardcoded" : app.js に一覧を直書き
 *  - "index"     : quizzes/index.json を fetch して一覧を取得（推奨）
 * ========================= */
const QUIZ_LIST_MODE = "index"; // "hardcoded" or "index"

/* hardcoded 用（必要ならここを編集） */
const HARDCODED_QUIZZES = [
  // { id: "hs-entrance-grammar-001", title: "高校受験 英語 文法ミニテスト", url: "./quizzes/hs-entrance-grammar-001.json" }
];

/* index 用：デフォルトの index.json 位置 */
const DEFAULT_INDEX_URL = "./quizzes/index.json";

/* =========================
 * IndexedDB settings
 * ========================= */
const DB_NAME = "quiz_app_db";
const DB_VERSION = 1;
const STORE_ATTEMPTS = "attempts";

/* =========================
 * DOM
 * ========================= */
const $ = (sel, root = document) => root.querySelector(sel);

const appTitle = $("#appTitle");
const appMeta = $("#appMeta");
const app = $("#app");
const quizSelect = $("#quizSelect");
const quizUrlInput = $("#quizUrlInput");
const btnLoadUrl = $("#btnLoadUrl");
const btnGrade = $("#btnGrade");
const btnReset = $("#btnReset");
const toggleAnswers = $("#toggleAnswers");

const btnRefreshHistory = $("#btnRefreshHistory");
const btnClearHistory = $("#btnClearHistory");
const historyList = $("#historyList");

/* =========================
 * State
 * ========================= */
let currentQuiz = null;
let currentQuizSourceUrl = null; // ログに残す用
let userAnswers = {};            // itemId -> answer payload
let resultState = {};            // itemId -> {correct, message, score?}
let showAnswers = false;

/* reorder 用: itemId -> {availableTokens: string[], chosenTokens: string[]} */
let reorderState = {};

/* =========================
 * URL params
 * ========================= */
function getParams() {
  const p = new URLSearchParams(location.search);
  return {
    quiz: p.get("quiz"),   // direct quiz json url
    index: p.get("index")  // quiz list index json url
  };
}

/* =========================
 * Fetch helpers
 * ========================= */
async function fetchJson(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`JSONの読み込みに失敗: ${res.status} ${res.statusText}`);
  return await res.json();
}

function absUrl(url) {
  try { return new URL(url, location.href).toString(); }
  catch { return url; }
}

function escapeHtml(s) {
  return (s ?? "").toString()
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/* =========================
 * IndexedDB helpers
 * ========================= */
function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_ATTEMPTS)) {
        const store = db.createObjectStore(STORE_ATTEMPTS, { keyPath: "id", autoIncrement: true });
        store.createIndex("by_ts", "ts");
        store.createIndex("by_quizId_ts", ["quizId", "ts"]);
      }
    };
    req.onsuccess = () => resolve(req.result);
  });
}

async function addAttempt(attempt) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_ATTEMPTS, "readwrite");
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);

    const store = tx.objectStore(STORE_ATTEMPTS);
    store.add(attempt);
  });
}

async function listAttempts(limit = 50) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_ATTEMPTS, "readonly");
    tx.onerror = () => reject(tx.error);

    const store = tx.objectStore(STORE_ATTEMPTS);
    const idx = store.index("by_ts");

    // 新しい順に取りたいので cursor を "prev"
    const req = idx.openCursor(null, "prev");
    const out = [];
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor || out.length >= limit) {
        resolve(out);
        return;
      }
      out.push(cursor.value);
      cursor.continue();
    };
  });
}

async function clearAttempts() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_ATTEMPTS, "readwrite");
    tx.onerror = () => reject(tx.error);
    tx.oncomplete = () => resolve(true);
    tx.objectStore(STORE_ATTEMPTS).clear();
  });
}

/* =========================
 * Quiz list loading
 * ========================= */
async function loadQuizList() {
  const { index } = getParams();
  if (QUIZ_LIST_MODE === "hardcoded") return HARDCODED_QUIZZES;

  const indexUrl = index || DEFAULT_INDEX_URL;
  const data = await fetchJson(indexUrl);
  const list = Array.isArray(data) ? data : (data.quizzes || []);
  return list.map(q => ({ ...q, url: q.url }));
}

function renderQuizSelect(list) {
  quizSelect.innerHTML = "";
  if (!list.length) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "クイズ一覧が空です";
    quizSelect.appendChild(opt);
    return;
  }
  const opt0 = document.createElement("option");
  opt0.value = "";
  opt0.textContent = "選択してください";
  quizSelect.appendChild(opt0);

  for (const q of list) {
    const opt = document.createElement("option");
    opt.value = q.url;
    opt.textContent = q.title ? q.title : q.id;
    opt.dataset.id = q.id || "";
    quizSelect.appendChild(opt);
  }
}

/* =========================
 * Quiz loading + init
 * ========================= */
function resetState() {
  userAnswers = {};
  resultState = {};
  reorderState = {};
}

function initReorderState(quiz) {
  reorderState = {};
  for (const item of quiz.items || []) {
    if (item.type === "reorder") {
      reorderState[item.id] = {
        availableTokens: [...(item.tokens || [])],
        chosenTokens: []
      };
    }
  }
}

async function loadQuizFromUrl(url) {
  const quiz = await fetchJson(url);
  if (!quiz || !Array.isArray(quiz.items)) throw new Error("quiz JSONの形式が不正です（items が必要）");

  currentQuiz = quiz;
  currentQuizSourceUrl = absUrl(url);

  resetState();
  initReorderState(quiz);
  renderQuiz(quiz, currentQuizSourceUrl);
}

/* =========================
 * Rendering
 * ========================= */
function setHeader(quiz, sourceUrl) {
  appTitle.textContent = quiz.title || "Quiz";
  const meta = [];
  if (quiz.target) meta.push(`対象: ${quiz.target}`);
  if (quiz.timeLimitSec) meta.push(`目安: ${quiz.timeLimitSec}s`);
  if (sourceUrl) meta.push(`Source: ${sourceUrl}`);
  appMeta.textContent = meta.join(" / ");
}

function renderTags(tags = []) {
  const wrap = document.createElement("div");
  wrap.className = "tags";
  for (const t of tags) {
    const s = document.createElement("span");
    s.className = "tag";
    s.textContent = t;
    wrap.appendChild(s);
  }
  return wrap;
}

function renderQuiz(quiz, sourceUrl) {
  setHeader(quiz, sourceUrl);
  app.innerHTML = "";

  for (const item of quiz.items) {
    const card = document.createElement("section");
    card.className = "card";
    card.dataset.itemId = item.id;

    const head = document.createElement("div");
    head.className = "qhead";

    const left = document.createElement("div");
    left.innerHTML = `<div class="qid">${escapeHtml(item.id)}</div>`;
    head.appendChild(left);

    head.appendChild(renderTags(item.tags || []));
    card.appendChild(head);

    const prompt = document.createElement("div");
    prompt.className = "prompt";
    prompt.textContent = item.prompt || "";
    card.appendChild(prompt);

    const body = document.createElement("div");
    body.appendChild(renderItemBody(item));
    card.appendChild(body);

    if (item.note) {
      const note = document.createElement("div");
      note.className = "small";
      note.textContent = item.note;
      card.appendChild(note);
    }
    if (item.hint) {
      const hint = document.createElement("div");
      hint.className = "small";
      hint.textContent = `ヒント: ${item.hint}`;
      card.appendChild(hint);
    }

    const result = document.createElement("div");
    result.className = "result";
    result.style.display = "none";
    result.dataset.role = "result";
    card.appendChild(result);

    const details = document.createElement("details");
    details.style.display = "none";
    details.dataset.role = "answersPanel";
    const sum = document.createElement("summary");
    sum.textContent = "正解・解説";
    details.appendChild(sum);

    const ans = document.createElement("div");
    ans.dataset.role = "answersContent";
    details.appendChild(ans);

    card.appendChild(details);

    app.appendChild(card);
  }

  applyAnswersVisibility();
}

function renderItemBody(item) {
  const wrap = document.createElement("div");

  if (item.type === "fill") {
    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = "答えを入力";
    input.value = userAnswers[item.id] ?? "";
    input.addEventListener("input", () => { userAnswers[item.id] = input.value; });
    wrap.appendChild(input);
    return wrap;
  }

  if (item.type === "mcq" || item.type === "article") {
    const box = document.createElement("div");
    box.className = "choices";
    const choices = item.choices || [];
    for (const c of choices) {
      const row = document.createElement("label");
      row.className = "choice";
      const radio = document.createElement("input");
      radio.type = "radio";
      radio.name = `choice-${item.id}`;
      radio.value = c.id;
      radio.checked = (userAnswers[item.id] === c.id);
      radio.addEventListener("change", () => { userAnswers[item.id] = c.id; });
      const span = document.createElement("span");
      span.textContent = c.text;
      row.appendChild(radio);
      row.appendChild(span);
      box.appendChild(row);
    }
    wrap.appendChild(box);
    return wrap;
  }

  if (item.type === "translation") {
    const ta = document.createElement("textarea");
    ta.placeholder = "英文を書いてください";
    ta.value = userAnswers[item.id] ?? "";
    ta.addEventListener("input", () => { userAnswers[item.id] = ta.value; });
    wrap.appendChild(ta);

    const small = document.createElement("div");
    small.className = "small";
    small.textContent = "※英作文は完全一致ではなく、最低限の自動判定（許容解答/簡易チェック）です。";
    wrap.appendChild(small);
    return wrap;
  }

  if (item.type === "reorder") {
    const st = reorderState[item.id] || { availableTokens: [], chosenTokens: [] };

    const tokensBox = document.createElement("div");
    tokensBox.className = "tokens";

    const answerLine = document.createElement("div");
    answerLine.className = "answerline";

    const render = () => {
      tokensBox.innerHTML = "";
      for (let i = 0; i < st.availableTokens.length; i++) {
        const token = st.availableTokens[i];
        const chip = document.createElement("span");
        chip.className = "chip";
        chip.textContent = token;
        chip.addEventListener("click", () => {
          st.chosenTokens.push(token);
          st.availableTokens.splice(i, 1);
          userAnswers[item.id] = [...st.chosenTokens];
          render();
        });
        tokensBox.appendChild(chip);
      }

      answerLine.innerHTML = "";
      for (let i = 0; i < st.chosenTokens.length; i++) {
        const token = st.chosenTokens[i];
        const chip = document.createElement("span");
        chip.className = "answerchip";
        chip.textContent = token;
        chip.title = "クリックで戻す";
        chip.addEventListener("click", () => {
          st.availableTokens.push(token);
          st.chosenTokens.splice(i, 1);
          userAnswers[item.id] = [...st.chosenTokens];
          render();
        });
        answerLine.appendChild(chip);
      }

      userAnswers[item.id] = [...st.chosenTokens];
    };

    render();
    wrap.appendChild(tokensBox);
    wrap.appendChild(answerLine);

    const btn = document.createElement("button");
    btn.textContent = "並べかえをクリア";
    btn.addEventListener("click", () => {
      st.availableTokens = [...(item.tokens || [])];
      st.chosenTokens = [];
      userAnswers[item.id] = [];
      render();
    });
    const spacer = document.createElement("div");
    spacer.style.marginTop = "10px";
    wrap.appendChild(spacer);
    wrap.appendChild(btn);

    return wrap;
  }

  wrap.textContent = `未対応の type: ${item.type}`;
  return wrap;
}

/* =========================
 * Grading
 * ========================= */
function normalizeSimple(s) {
  return (s ?? "")
    .toString()
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function gradeItem(item) {
  const id = item.id;
  const ua = userAnswers[id];

  if (item.type === "reorder") {
    const got = Array.isArray(ua) ? ua : [];
    const ans = item.answer || [];
    const correct = got.length === ans.length && got.every((t, i) => t === ans[i]);
    return { correct, message: correct ? "正解" : `不正解：${ans.join(" ")}` };
  }

  if (item.type === "fill") {
    const got = normalizeSimple(ua);
    const ans = normalizeSimple(item.answer);
    const correct = got === ans;
    return { correct, message: correct ? "正解" : `不正解：${item.answer}`, explanation: item.explanation || "" };
  }

  if (item.type === "mcq" || item.type === "article") {
    const correct = ua === item.answerChoiceId;
    const ansText = (item.choices || []).find(c => c.id === item.answerChoiceId)?.text ?? item.answerChoiceId;
    return { correct, message: correct ? "正解" : `不正解：${ansText}`, explanation: item.explanation || "" };
  }

  if (item.type === "translation") {
    const gotRaw = (ua ?? "").toString().trim();
    const got = normalizeSimple(gotRaw);
    const accept = (item.accept || []).map(normalizeSimple);
    const exactOk = accept.includes(got);

    let score = 0;
    const feedback = [];

    if (!gotRaw) return { correct: false, message: "未入力", score: 0, feedback };

    if (/\byesterday\b/i.test(gotRaw)) score += 2;
    else feedback.push("yesterday を入れると時制が明確。");

    if (/\bwon\b/i.test(gotRaw) && /\b(game|match)\b/i.test(gotRaw)) score += 2;
    else feedback.push("won the game/match の形を入れると加点。");

    if (/\bhappy\b/i.test(gotRaw) && /\bwas\b/i.test(gotRaw)) score += 1;
    else feedback.push("I was happy ... の形にすると自然。");

    if (exactOk) score = Math.max(score, 5);

    const correct = exactOk || score >= 4;
    const msg = exactOk ? "正解（許容解答と一致）" : `採点：${score}/5（自動判定）`;

    return { correct, message: msg, score, feedback };
  }

  return { correct: false, message: "採点未対応" };
}

function renderResults() {
  if (!currentQuiz) return;

  let correctCount = 0;

  for (const item of currentQuiz.items) {
    const r = resultState[item.id];
    const card = app.querySelector(`[data-item-id="${item.id}"]`);
    const box = card.querySelector(`[data-role="result"]`);

    box.style.display = "block";
    box.classList.remove("ok", "ng");
    box.classList.add(r.correct ? "ok" : "ng");

    const extra = [];
    if (typeof r.score === "number") extra.push(`Score: ${r.score}`);
    if (r.explanation) extra.push(r.explanation);
    if (Array.isArray(r.feedback) && r.feedback.length) extra.push("ヒント: " + r.feedback.join(" / "));

    box.innerHTML =
      `<div><strong>${escapeHtml(r.message)}</strong></div>` +
      (extra.length ? `<div class="small" style="margin-top:6px;">${extra.map(escapeHtml).join("<br>")}</div>` : "");

    if (r.correct) correctCount++;
  }

  const base = [];
  if (currentQuiz.target) base.push(`対象: ${currentQuiz.target}`);
  if (currentQuiz.timeLimitSec) base.push(`目安: ${currentQuiz.timeLimitSec}s`);
  base.push(`得点: ${correctCount}/${currentQuiz.items.length}`);
  appMeta.textContent = base.join(" / ");
}

function renderAnswerPanels() {
  if (!currentQuiz) return;
  for (const item of currentQuiz.items) {
    const card = app.querySelector(`[data-item-id="${item.id}"]`);
    const panel = card.querySelector(`[data-role="answersPanel"]`);
    const content = card.querySelector(`[data-role="answersContent"]`);

    content.innerHTML = "";

    const p = document.createElement("div");
    p.className = "small";

    if (item.type === "reorder") {
      p.innerHTML = `<div><strong>正解:</strong> ${escapeHtml((item.answer || []).join(" "))}</div>`;
    } else if (item.type === "fill") {
      p.innerHTML = `<div><strong>正解:</strong> ${escapeHtml(item.answer)}</div>`;
    } else if (item.type === "mcq" || item.type === "article") {
      const ansText = (item.choices || []).find(c => c.id === item.answerChoiceId)?.text ?? item.answerChoiceId;
      p.innerHTML = `<div><strong>正解:</strong> ${escapeHtml(ansText)}</div>`;
    } else if (item.type === "translation") {
      const ul = document.createElement("ul");
      for (const a of (item.accept || [])) {
        const li = document.createElement("li");
        li.textContent = a;
        ul.appendChild(li);
      }
      p.innerHTML = `<div><strong>許容解答例:</strong></div>`;
      p.appendChild(ul);
    }

    content.appendChild(p);

    if (item.explanation) {
      const exp = document.createElement("div");
      exp.className = "small";
      exp.style.marginTop = "8px";
      exp.innerHTML = `<strong>解説:</strong> ${escapeHtml(item.explanation)}`;
      content.appendChild(exp);
    }

    panel.style.display = showAnswers ? "block" : "none";
    panel.open = showAnswers; // トグルON時は自動展開
  }
}

function applyAnswersVisibility() {
  showAnswers = !!toggleAnswers.checked;
  renderAnswerPanels();
}

/* =========================
 * Logging (attempt snapshot)
 * ========================= */
function computeSummary() {
  const total = currentQuiz?.items?.length ?? 0;
  let correct = 0;
  let scoreSum = 0;
  let scoreItems = 0;

  for (const item of (currentQuiz?.items || [])) {
    const r = resultState[item.id];
    if (!r) continue;
    if (r.correct) correct++;
    if (typeof r.score === "number") {
      scoreSum += r.score;
      scoreItems++;
    }
  }
  return {
    total,
    correct,
    scoreSum,
    scoreItems
  };
}

async function logAttempt() {
  if (!currentQuiz) return;

  const sum = computeSummary();
  const attempt = {
    ts: Date.now(),
    quizId: currentQuiz.quizId || currentQuiz.title || "unknown",
    quizTitle: currentQuiz.title || "",
    quizSourceUrl: currentQuizSourceUrl || "",
    total: sum.total,
    correct: sum.correct,
    // translation がある場合に参考で入れる（なければ 0/0）
    scoreSum: sum.scoreSum,
    scoreItems: sum.scoreItems,
    userAnswers: structuredClone(userAnswers),
    resultState: structuredClone(resultState)
  };

  await addAttempt(attempt);
}

function formatTs(ts) {
  const d = new Date(ts);
  // ローカル表示
  return d.toLocaleString();
}

async function refreshHistory() {
  try {
    const rows = await listAttempts(50);
    if (!rows.length) {
      historyList.innerHTML = "履歴なし";
      return;
    }

    // シンプルなカード一覧（復元ボタン付き）
    const html = rows.map(r => {
      const pct = r.total ? Math.round((r.correct / r.total) * 100) : 0;
      const scoreInfo = (r.scoreItems > 0) ? ` / 英作文スコア合計: ${r.scoreSum}` : "";
      const title = r.quizTitle || r.quizId;
      return `
        <div class="card" style="margin:10px 0;">
          <div style="display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap;">
            <div>
              <div><strong>${escapeHtml(title)}</strong></div>
              <div class="small">${escapeHtml(formatTs(r.ts))}</div>
              <div class="small">得点: ${r.correct}/${r.total} (${pct}%)${scoreInfo}</div>
              ${r.quizSourceUrl ? `<div class="small">Source: ${escapeHtml(r.quizSourceUrl)}</div>` : ""}
            </div>
            <div style="display:flex; gap:8px; align-items:flex-start; flex-wrap:wrap;">
              <button data-action="restore" data-id="${r.id}">この結果を復元して表示</button>
            </div>
          </div>
        </div>
      `;
    }).join("");

    historyList.innerHTML = html;

    // restore handlers
    historyList.querySelectorAll('button[data-action="restore"]').forEach(btn => {
      btn.addEventListener("click", async () => {
        const id = Number(btn.dataset.id);
        const rows2 = await listAttempts(200); // 簡単に再取得して探索
        const rec = rows2.find(x => x.id === id);
        if (!rec) return;

        // 1) クイズをロード（同じURLがあるなら優先）
        if (rec.quizSourceUrl) {
          try {
            await loadQuizFromUrl(rec.quizSourceUrl);
          } catch {
            // 取得失敗でも、すでに読み込み済みなら続行しない（ここでは終了）
            app.innerHTML = `<div class="card">復元失敗：クイズJSONが取得できませんでした。URLや公開状態を確認してください。</div>`;
            return;
          }
        }

        // 2) 回答・結果を復元
        userAnswers = rec.userAnswers || {};
        resultState = rec.resultState || {};

        // reorder の内部状態も userAnswers から復元（選択済みtokens）
        initReorderState(currentQuiz);
        for (const item of (currentQuiz.items || [])) {
          if (item.type !== "reorder") continue;
          const st = reorderState[item.id];
          const chosen = Array.isArray(userAnswers[item.id]) ? userAnswers[item.id] : [];
          st.chosenTokens = [...chosen];
          // available = tokens から chosen を引いた残り（順序は元 tokens を維持）
          const setChosen = new Set(chosen);
          st.availableTokens = (item.tokens || []).filter(t => !setChosen.has(t));
        }

        // 3) UI再描画
        renderQuiz(currentQuiz, currentQuizSourceUrl);
        renderResults();

        // 4) 採点後状態として解説を自動表示
        toggleAnswers.checked = true;
        applyAnswersVisibility();

        // 5) 結果を見やすいように上へ
        window.scrollTo({ top: 0, behavior: "smooth" });
      });
    });

  } catch (e) {
    historyList.innerHTML = `履歴の読み込みエラー：${escapeHtml(e.message)}`;
  }
}

/* =========================
 * Events
 * ========================= */
toggleAnswers.addEventListener("change", applyAnswersVisibility);

btnGrade.addEventListener("click", async () => {
  if (!currentQuiz) return;

  // 採点
  resultState = {};
  for (const item of currentQuiz.items) {
    resultState[item.id] = gradeItem(item);
  }
  renderResults();

  // ✅ 採点したら自動で「正解・解説」表示（トグルON＋展開）
  toggleAnswers.checked = true;
  applyAnswersVisibility();

  // ✅ ログ保存
  try {
    await logAttempt();
    await refreshHistory();
  } catch (e) {
    // ログ保存失敗は学習を止めない（表示だけ）
    console.warn("logAttempt failed:", e);
  }
});

btnReset.addEventListener("click", () => {
  if (!currentQuiz) return;
  resetState();
  initReorderState(currentQuiz);
  renderQuiz(currentQuiz, currentQuizSourceUrl);
});

quizSelect.addEventListener("change", async () => {
  const url = quizSelect.value;
  if (!url) return;
  try {
    await loadQuizFromUrl(url);
    quizUrlInput.value = absUrl(url);

    const u = new URL(location.href);
    u.searchParams.set("quiz", absUrl(url));
    history.replaceState(null, "", u.toString());
  } catch (e) {
    app.innerHTML = `<div class="card">読み込みエラー：${escapeHtml(e.message)}</div>`;
  }
});

btnLoadUrl.addEventListener("click", async () => {
  const url = quizUrlInput.value.trim();
  if (!url) return;
  try {
    await loadQuizFromUrl(url);

    const u = new URL(location.href);
    u.searchParams.set("quiz", absUrl(url));
    history.replaceState(null, "", u.toString());
  } catch (e) {
    app.innerHTML = `<div class="card">読み込みエラー：${escapeHtml(e.message)}</div>`;
  }
});

btnRefreshHistory?.addEventListener("click", refreshHistory);

btnClearHistory?.addEventListener("click", async () => {
  const ok = confirm("履歴を全削除します。よろしいですか？");
  if (!ok) return;
  try {
    await clearAttempts();
    await refreshHistory();
  } catch (e) {
    alert("削除に失敗しました: " + e.message);
  }
});

/* =========================
 * Boot
 * ========================= */
async function boot() {
  app.innerHTML = `<div class="card">Loading…</div>`;
  historyList.textContent = "Loading history…";

  // 履歴を先に表示（クイズ読込失敗でも見れる）
  refreshHistory();

  try {
    const list = await loadQuizList();
    renderQuizSelect(list);

    const { quiz } = getParams();
    if (quiz) {
      quizUrlInput.value = quiz;
      await loadQuizFromUrl(quiz);
      const opt = Array.from(quizSelect.options).find(o => absUrl(o.value) === absUrl(quiz));
      if (opt) quizSelect.value = opt.value;
      return;
    }

    app.innerHTML = `<div class="card">クイズを選択するか、URLを入力してください。</div>`;
  } catch (e) {
    app.innerHTML =
      `<div class="card">起動エラー：${escapeHtml(e.message)}<br>` +
      `<span class="small">index.json のURLやCORS、パスを確認してください。</span></div>`;
    quizSelect.innerHTML = `<option value="">起動エラー</option>`;
  }
}

boot();
