/* app.js
 * - UI / rendering / grading
 * - calls StudyEngine for persistence, analytics, recommendations
 */

"use strict";

const QUIZ_LIST_MODE = "index"; // "hardcoded" or "index"
const HARDCODED_QUIZZES = [];
const DEFAULT_INDEX_URL = "./quizzes/index.json";

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

const btnRefreshInsights = $("#btnRefreshInsights");
const insightsDiv = $("#insights");
const btnRecommend = $("#btnRecommend");
const recDiv = $("#recommendations");

// State
let currentQuiz = null;
let currentQuizSourceUrl = null;
let userAnswers = {};
let resultState = {};
let showAnswers = false;
let reorderState = {};
let quizListCache = []; // quizId->url の逆引き用（レコメンドで別クイズを開くため）

/* URL params */
function getParams() {
  const p = new URLSearchParams(location.search);
  return { quiz: p.get("quiz"), index: p.get("index") };
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

async function fetchJson(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`JSONの読み込みに失敗: ${res.status} ${res.statusText}`);
  return await res.json();
}

/* Quiz list */
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
  const opt0 = document.createElement("option");
  opt0.value = "";
  opt0.textContent = list.length ? "選択してください" : "クイズ一覧が空です";
  quizSelect.appendChild(opt0);

  for (const q of list) {
    const opt = document.createElement("option");
    opt.value = q.url;
    opt.textContent = q.title ? q.title : q.id;
    opt.dataset.id = q.id || "";
    quizSelect.appendChild(opt);
  }
}

/* init/reset */
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

/* rendering */
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
    for (const c of (item.choices || [])) {
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

    const spacer = document.createElement("div");
    spacer.style.marginTop = "10px";
    wrap.appendChild(spacer);

    const btn = document.createElement("button");
    btn.textContent = "並べかえをクリア";
    btn.addEventListener("click", () => {
      st.availableTokens = [...(item.tokens || [])];
      st.chosenTokens = [];
      userAnswers[item.id] = [];
      render();
    });
    wrap.appendChild(btn);

    return wrap;
  }

  wrap.textContent = `未対応の type: ${item.type}`;
  return wrap;
}

/* grading */
function normalizeSimple(s) {
  return (s ?? "").toString().trim().replace(/\s+/g, " ").toLowerCase();
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
    panel.open = showAnswers;
  }
}

function applyAnswersVisibility() {
  showAnswers = !!toggleAnswers.checked;
  renderAnswerPanels();
}

/* logging helper */
function resultToQuality(item, r) {
  if (!r) return 0;
  if (item.type === "translation" && typeof r.score === "number") {
    if (r.score >= 5) return 5;
    if (r.score >= 4) return 4;
    return 2;
  }
  return r.correct ? 5 : 2;
}

function computeSummary() {
  const total = currentQuiz?.items?.length ?? 0;
  let correct = 0;
  let scoreSum = 0;
  let scoreItems = 0;

  for (const item of (currentQuiz?.items || [])) {
    const r = resultState[item.id];
    if (!r) continue;
    if (r.correct) correct++;
    if (typeof r.score === "number") { scoreSum += r.score; scoreItems++; }
  }
  return { total, correct, scoreSum, scoreItems };
}

async function logAndUpdateEngine() {
  const quizId = currentQuiz.quizId || currentQuiz.title || "unknown";
  const itemMeta = {};
  const qualityMap = {};

  for (const it of (currentQuiz.items || [])) {
    itemMeta[it.id] = { tags: Array.isArray(it.tags) ? it.tags : [], type: it.type || "" };
    const q = resultToQuality(it, resultState[it.id]);
    qualityMap[it.id] = { quality: q, tags: itemMeta[it.id].tags };
  }

  const sum = computeSummary();

  const attempt = {
    ts: Date.now(),
    quizId,
    quizTitle: currentQuiz.title || "",
    quizSourceUrl: currentQuizSourceUrl || "",
    total: sum.total,
    correct: sum.correct,
    scoreSum: sum.scoreSum,
    scoreItems: sum.scoreItems,
    itemMeta,
    userAnswers: structuredClone(userAnswers),
    resultState: structuredClone(resultState)
  };

  await StudyEngine.addAttempt(attempt);
  await StudyEngine.updateCardsFromAttempt({
    quizId,
    quizTitle: currentQuiz.title || "",
    quizSourceUrl: currentQuizSourceUrl || "",
    qualityMap
  });
}

/* history UI */
function formatTs(ts) {
  const d = new Date(ts);
  return d.toLocaleString();
}

async function refreshHistory() {
  try {
    const rows = await StudyEngine.listAttempts(50);
    if (!rows.length) {
      historyList.innerHTML = "履歴なし";
      return;
    }

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

    historyList.querySelectorAll('button[data-action="restore"]').forEach(btn => {
      btn.addEventListener("click", async () => {
        const id = Number(btn.dataset.id);
        const rows2 = await StudyEngine.listAttempts(200);
        const rec = rows2.find(x => x.id === id);
        if (!rec) return;

        // quiz load
        if (rec.quizSourceUrl) {
          try {
            await loadQuizFromUrl(rec.quizSourceUrl);
          } catch {
            app.innerHTML = `<div class="card">復元失敗：クイズJSONが取得できませんでした。</div>`;
            return;
          }
        }

        userAnswers = rec.userAnswers || {};
        resultState = rec.resultState || {};

        // restore reorder state from userAnswers
        initReorderState(currentQuiz);
        for (const item of (currentQuiz.items || [])) {
          if (item.type !== "reorder") continue;
          const st = reorderState[item.id];
          const chosen = Array.isArray(userAnswers[item.id]) ? userAnswers[item.id] : [];
          st.chosenTokens = [...chosen];
          const setChosen = new Set(chosen);
          st.availableTokens = (item.tokens || []).filter(t => !setChosen.has(t));
        }

        renderQuiz(currentQuiz, currentQuizSourceUrl);
        renderResults();

        // auto show answers on restore
        toggleAnswers.checked = true;
        applyAnswersVisibility();

        window.scrollTo({ top: 0, behavior: "smooth" });
      });
    });

  } catch (e) {
    historyList.innerHTML = `履歴の読み込みエラー：${escapeHtml(e.message)}`;
  }
}

/* insights + recommend UI */
async function refreshInsights() {
  try {
    const attempts = await StudyEngine.listAttempts(200);
    if (!attempts.length) {
      insightsDiv.textContent = "履歴なし（採点すると蓄積されます）";
      return;
    }

    const due = await StudyEngine.listDueCards(9999, Date.now());
    const dueCount = due.length;

    const { worstItems, quizzes, worstTags } = StudyEngine.analyzeAttempts(attempts);

    let html = "";
    html += `<div><strong>復習期限（Due）:</strong> ${dueCount} 問</div>`;

    html += `<div style="margin-top:8px;"><strong>苦手問題（正答率が低い順 上位10）</strong></div><ol>`;
    for (const w of worstItems) {
      html += `<li>${escapeHtml(w.key)} — ${w.correct}/${w.attempts} (${Math.round(w.acc * 100)}%)</li>`;
    }
    html += `</ol>`;

    html += `<div style="margin-top:10px;"><strong>苦手タグ（正答率が低い順 上位10）</strong></div>`;
    if (worstTags.length) {
      html += `<ul>`;
      for (const t of worstTags) {
        html += `<li>${escapeHtml(t.tag)} — ${t.correct}/${t.attempts} (${Math.round(t.acc * 100)}%)</li>`;
      }
      html += `</ul>`;
    } else {
      html += `<div><em>タグ分析は新しい採点ログから貯まります（古い履歴にはtagが無い場合があります）。</em></div>`;
    }

    html += `<div style="margin-top:10px;"><strong>クイズ別 正答率（低い順）</strong></div><ul>`;
    for (const q of quizzes) {
      html += `<li>${escapeHtml(q.quizId)} — ${q.correct}/${q.total} (${Math.round(q.acc * 100)}%)</li>`;
    }
    html += `</ul>`;

    insightsDiv.innerHTML = html;
  } catch (e) {
    insightsDiv.textContent = `分析エラー: ${e.message}`;
  }
}

function quizIdToUrl(quizId) {
  // index.json の id と quiz.quizId が一致している前提が一番きれい。
  const hit = quizListCache.find(q => (q.id || "") === quizId);
  return hit ? hit.url : null;
}

async function refreshRecommendations() {
  try {
    const due = await StudyEngine.listDueCards(12, Date.now());
    if (!due.length) {
      recDiv.innerHTML = `おすすめなし（今すぐ復習すべきカードはありません）`;
      return;
    }

    let html = `<div><strong>今やるべき（Due）</strong></div><ol>`;
    for (const c of due) {
      html += `<li>
        ${escapeHtml(c.quizId)} / ${escapeHtml(c.itemId)}
        <span class="small">— ${escapeHtml(StudyEngine.dueLabel(c.dueTs))} / reps=${c.reps ?? 0} / ease=${(c.ease ?? 0).toFixed?.(2) ?? c.ease}</span>
        <button style="margin-left:8px;" data-action="jump" data-quiz="${escapeHtml(c.quizId)}" data-item="${escapeHtml(c.itemId)}">開く</button>
      </li>`;
    }
    html += `</ol>`;
    recDiv.innerHTML = html;

    recDiv.querySelectorAll('button[data-action="jump"]').forEach(btn => {
      btn.addEventListener("click", async () => {
        const quizId = btn.dataset.quiz;
        const itemId = btn.dataset.item;

        const curId = (currentQuiz?.quizId || currentQuiz?.title || "unknown");
        if (curId !== quizId) {
          const url = quizIdToUrl(quizId);
          if (!url) {
            alert("この quizId を一覧から逆引きできません。index.json の id と quizId を合わせてください。");
            return;
          }
          await loadQuizFromUrl(url);
          // URLパラメータ更新
          const u = new URL(location.href);
          u.searchParams.set("quiz", absUrl(url));
          history.replaceState(null, "", u.toString());
        }

        // 該当問題へスクロール
        const card = app.querySelector(`[data-item-id="${CSS.escape(itemId)}"]`);
        if (card) card.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });

  } catch (e) {
    recDiv.textContent = `おすすめエラー: ${e.message}`;
  }
}

/* events */
toggleAnswers.addEventListener("change", applyAnswersVisibility);

btnGrade.addEventListener("click", async () => {
  if (!currentQuiz) return;

  // grade
  resultState = {};
  for (const item of currentQuiz.items) {
    resultState[item.id] = gradeItem(item);
  }
  renderResults();

  // auto show answers
  toggleAnswers.checked = true;
  applyAnswersVisibility();

  // log + update spaced repetition
  try {
    await logAndUpdateEngine();
  } catch (e) {
    console.warn("log/update failed:", e);
  }

  await refreshHistory();
  await refreshInsights();
  await refreshRecommendations();
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
    await StudyEngine.clearAttempts();
    await refreshHistory();
    await refreshInsights();
    await refreshRecommendations();
  } catch (e) {
    alert("削除に失敗しました: " + e.message);
  }
});

btnRefreshInsights?.addEventListener("click", refreshInsights);
btnRecommend?.addEventListener("click", refreshRecommendations);

/* boot */
async function boot() {
  app.innerHTML = `<div class="card">Loading…</div>`;
  historyList.textContent = "Loading history…";
  insightsDiv.textContent = "Loading insights…";
  recDiv.textContent = "Loading recommendations…";

  // always show persisted views first
  refreshHistory();
  refreshInsights();
  refreshRecommendations();

  try {
    quizListCache = await loadQuizList();
    renderQuizSelect(quizListCache);

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
