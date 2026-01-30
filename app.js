/* =========================
 * 設定：URL一覧をどう用意するか選ぶ
 *  - "hardcoded" : app.js に一覧を直書き
 *  - "index"     : quizzes/index.json を fetch して一覧を取得（推奨）
 * ========================= */
const QUIZ_LIST_MODE = "index"; // ← ここを "hardcoded" か "index" に

/* hardcoded 用（必要ならここを編集） */
const HARDCODED_QUIZZES = [
  // 例: { id: "hs-entrance-grammar-001", title: "高校受験 英語 文法ミニテスト", url: "./quizzes/hs-entrance-grammar-001.json" }
];

/* index 用：デフォルトの index.json 位置 */
const DEFAULT_INDEX_URL = "./quizzes/index.json";

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

/* =========================
 * State
 * ========================= */
let currentQuiz = null;
let userAnswers = {};     // itemId -> answer payload
let resultState = {};     // itemId -> {correct, message, score?}
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
  // relative を絶対化（表示や記録に便利）
  try { return new URL(url, location.href).toString(); }
  catch { return url; }
}

/* =========================
 * Quiz list loading
 * ========================= */
async function loadQuizList() {
  const { index } = getParams();
  if (QUIZ_LIST_MODE === "hardcoded") {
    return HARDCODED_QUIZZES;
  }
  const indexUrl = index || DEFAULT_INDEX_URL;
  const data = await fetchJson(indexUrl);
  // 想定形式: { quizzes: [{id,title,url}, ...] }  or  [{...}]
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
  // 最低限のバリデーション
  if (!quiz || !Array.isArray(quiz.items)) throw new Error("quiz JSONの形式が不正です（items が必要）");
  currentQuiz = quiz;
  resetState();
  initReorderState(quiz);
  renderQuiz(quiz, absUrl(url));
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
    left.innerHTML = `<div class="qid">${item.id}</div>`;
    head.appendChild(left);

    head.appendChild(renderTags(item.tags || []));
    card.appendChild(head);

    const prompt = document.createElement("div");
    prompt.className = "prompt";
    prompt.textContent = item.prompt || "";
    card.appendChild(prompt);

    // type-specific UI
    const body = document.createElement("div");
    body.appendChild(renderItemBody(item));
    card.appendChild(body);

    // note/hint
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

    // result area
    const result = document.createElement("div");
    result.className = "result";
    result.style.display = "none";
    result.dataset.role = "result";
    card.appendChild(result);

    // answers/explanation (toggle)
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
    input.addEventListener("input", () => {
      userAnswers[item.id] = input.value;
    });
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
      radio.addEventListener("change", () => {
        userAnswers[item.id] = c.id;
      });
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
    ta.addEventListener("input", () => {
      userAnswers[item.id] = ta.value;
    });
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

      // 初期状態なら userAnswers も同期
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
    wrap.appendChild(document.createElement("div")).style.marginTop = "10px";
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

  // reorder: tokens array exact match
  if (item.type === "reorder") {
    const got = Array.isArray(ua) ? ua : [];
    const ans = item.answer || [];
    const correct = got.length === ans.length && got.every((t, i) => t === ans[i]);
    return {
      correct,
      message: correct ? "正解" : `不正解：${ans.join(" ")}`
    };
  }

  // fill: string exact (case-insensitive)
  if (item.type === "fill") {
    const got = normalizeSimple(ua);
    const ans = normalizeSimple(item.answer);
    const correct = got === ans;
    return {
      correct,
      message: correct ? "正解" : `不正解：${item.answer}`,
      explanation: item.explanation || ""
    };
  }

  // mcq/article
  if (item.type === "mcq" || item.type === "article") {
    const correct = ua === item.answerChoiceId;
    const ansText = (item.choices || []).find(c => c.id === item.answerChoiceId)?.text ?? item.answerChoiceId;
    return {
      correct,
      message: correct ? "正解" : `不正解：${ansText}`,
      explanation: item.explanation || ""
    };
  }

  // translation: accept list (exact normalized) + very simple heuristics (optional)
  if (item.type === "translation") {
    const gotRaw = (ua ?? "").toString().trim();
    const got = normalizeSimple(gotRaw);

    const accept = (item.accept || []).map(normalizeSimple);
    const exactOk = accept.includes(got);

    // 簡易スコア（5点満点想定）
    let score = 0;
    const feedback = [];

    if (!gotRaw) {
      return { correct: false, message: "未入力", score: 0, feedback };
    }

    // time (yesterday)
    if (/\byesterday\b/i.test(gotRaw)) score += 2;
    else feedback.push("yesterday が入ると時制が明確。");

    // win (won ... game/match)
    if (/\bwon\b/i.test(gotRaw) && /\b(game|match)\b/i.test(gotRaw)) score += 2;
    else feedback.push("won the game/match の形を入れると加点。");

    // happy
    if (/\bhappy\b/i.test(gotRaw) && /\bwas\b/i.test(gotRaw)) score += 1;
    else feedback.push("I was happy ... の形にすると自然。");

    // exactOk なら満点扱い
    if (exactOk) score = Math.max(score, 5);

    const correct = exactOk || score >= 4; // 目安：4点以上なら「だいたいOK」扱い
    const msg = exactOk
      ? "正解（許容解答と一致）"
      : `採点：${score}/5（自動判定）`;

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
    if (Array.isArray(r.feedback) && r.feedback.length) {
      extra.push("ヒント: " + r.feedback.join(" / "));
    }

    box.innerHTML = `<div><strong>${r.message}</strong></div>` +
      (extra.length ? `<div class="small" style="margin-top:6px;">${extra.join("<br>")}</div>` : "");

    if (r.correct) correctCount++;
  }

  // header meta にサマリ追記
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

    // 正解表示
    const p = document.createElement("div");
    p.className = "small";

    if (item.type === "reorder") {
      p.innerHTML = `<div><strong>正解:</strong> ${ (item.answer || []).join(" ") }</div>`;
    } else if (item.type === "fill") {
      p.innerHTML = `<div><strong>正解:</strong> ${ item.answer }</div>`;
    } else if (item.type === "mcq" || item.type === "article") {
      const ansText = (item.choices || []).find(c => c.id === item.answerChoiceId)?.text ?? item.answerChoiceId;
      p.innerHTML = `<div><strong>正解:</strong> ${ ansText }</div>`;
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

    // 解説
    if (item.explanation) {
      const exp = document.createElement("div");
      exp.className = "small";
      exp.style.marginTop = "8px";
      exp.innerHTML = `<strong>解説:</strong> ${item.explanation}`;
      content.appendChild(exp);
    }

    panel.style.display = showAnswers ? "block" : "none";
    panel.open = showAnswers;
  }
}

function applyAnswersVisibility() {
  showAnswers = !!toggleAnswers.checked;
  renderAnswerPanels();
}

/* =========================
 * Events
 * ========================= */
toggleAnswers.addEventListener("change", applyAnswersVisibility);

btnGrade.addEventListener("click", () => {
  if (!currentQuiz) return;
  resultState = {};
  for (const item of currentQuiz.items) {
    resultState[item.id] = gradeItem(item);
  }
  renderResults();
  renderAnswerPanels();
});

btnReset.addEventListener("click", () => {
  if (!currentQuiz) return;
  resetState();
  initReorderState(currentQuiz);
  // 再描画（入力欄を空に戻す）
  renderQuiz(currentQuiz, null);
});

quizSelect.addEventListener("change", async () => {
  const url = quizSelect.value;
  if (!url) return;
  try {
    await loadQuizFromUrl(url);
    // URL欄も同期
    quizUrlInput.value = absUrl(url);
    // URLパラメータも更新（共有しやすい）
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
    // URLパラメータ更新
    const u = new URL(location.href);
    u.searchParams.set("quiz", absUrl(url));
    history.replaceState(null, "", u.toString());
  } catch (e) {
    app.innerHTML = `<div class="card">読み込みエラー：${escapeHtml(e.message)}</div>`;
  }
});

/* =========================
 * Boot
 * ========================= */
function escapeHtml(s) {
  return (s ?? "").toString()
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function boot() {
  app.innerHTML = `<div class="card">Loading…</div>`;

  try {
    const list = await loadQuizList();
    renderQuizSelect(list);

    // 直URL（?quiz=）があれば最優先で読み込み
    const { quiz } = getParams();
    if (quiz) {
      quizUrlInput.value = quiz;
      await loadQuizFromUrl(quiz);
      // select 側も一致するなら合わせる
      const opt = Array.from(quizSelect.options).find(o => absUrl(o.value) === absUrl(quiz));
      if (opt) quizSelect.value = opt.value;
      return;
    }

    // 一覧があって先頭を自動ロードしたい場合はここを変更
    // if (list[0]?.url) await loadQuizFromUrl(list[0].url);

    app.innerHTML = `<div class="card">クイズを選択するか、URLを入力してください。</div>`;
  } catch (e) {
    app.innerHTML = `<div class="card">起動エラー：${escapeHtml(e.message)}<br><span class="small">index.json のURLやCORS、パスを確認してください。</span></div>`;
    quizSelect.innerHTML = `<option value="">起動エラー</option>`;
  }
}

boot();
