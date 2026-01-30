/* app.js */
"use strict";

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => root.querySelectorAll(sel);

// UI Elements
const appTitle = $("#appTitle");
const appMeta = $("#appMeta");
const app = $("#app");
const quizSelect = $("#quizSelect");
const quizUrlInput = $("#quizUrlInput");
const btnLoadUrl = $("#btnLoadUrl");
const btnGrade = $("#btnGrade");
const btnReset = $("#btnReset");
const toggleAnswers = $("#toggleAnswers"); // デバッグ用

// New UI Elements
const statusBar = $("#statusBar");
const progressBar = $("#progressBar");
const progressText = $("#progressText");
const resultPanel = $("#resultPanel");
const scoreValue = $("#scoreValue");
const resultMessage = $("#resultMessage");
const btnRetryMissed = $("#btnRetryMissed");

// History & Insights
const btnRefreshInsights = $("#btnRefreshInsights");
const btnClearHistory = $("#btnClearHistory");
const historyList = $("#historyList");
const insightsDiv = $("#insights");
const recDiv = $("#recommendations");

// State
let currentQuiz = null;
let currentItems = []; // 現在表示中の問題リスト（フィルタリング対応）
let userAnswers = {};  // itemId -> answer
let isGraded = false;  // 採点済みかどうか
let quizListCache = [];

/* --- Initialization --- */

async function boot() {
  // 初期ロード
  await refreshHistory();
  await refreshInsights();
  
  try {
    quizListCache = await loadQuizList();
    renderQuizSelect(quizListCache);

    // URLパラメータ処理
    const params = new URLSearchParams(location.search);
    const quizUrl = params.get("quiz");
    if (quizUrl) {
      quizUrlInput.value = quizUrl;
      await loadQuizFromUrl(quizUrl);
      // セレクトボックス同期
      const opt = Array.from(quizSelect.options).find(o => absUrl(o.value) === absUrl(quizUrl));
      if (opt) quizSelect.value = opt.value;
    }
  } catch (e) {
    app.innerHTML = `<div class="card">エラー: ${e.message}</div>`;
  }
}

// クイズ一覧の取得 (quizzes/index.json)
async function loadQuizList() {
  const res = await fetch("./index.json");
  if (!res.ok) throw new Error("index.json load failed");
  const data = await res.json();
  return data.quizzes || [];
}

function renderQuizSelect(list) {
  quizSelect.innerHTML = `<option value="">-- ドリルを選択してください --</option>`;
  list.forEach(q => {
    const opt = document.createElement("option");
    opt.value = q.url;
    opt.textContent = q.title;
    quizSelect.appendChild(opt);
  });
}

function absUrl(url) {
  try { return new URL(url, location.href).href; } catch { return url; }
}

/* --- Event Listeners --- */

quizSelect.addEventListener("change", (e) => {
  if (e.target.value) loadQuizFromUrl(e.target.value);
});

btnLoadUrl.addEventListener("click", () => {
  if (quizUrlInput.value) loadQuizFromUrl(quizUrlInput.value);
});

btnReset.addEventListener("click", () => {
  if(currentQuiz) renderQuiz(currentQuiz); // 全問リセット
});

btnGrade.addEventListener("click", () => {
  if (!currentQuiz || isGraded) return;
  gradeQuiz();
});

btnRetryMissed.addEventListener("click", () => {
  retryMissedItems();
});

// 分析系
btnRefreshInsights.addEventListener("click", async () => {
  await refreshInsights();
  await refreshHistory();
});
btnClearHistory.addEventListener("click", async () => {
  if (confirm("学習履歴を完全に消去しますか？")) {
    await StudyEngine.clearAttempts();
    await refreshHistory();
    await refreshInsights();
  }
});

/* --- Core Logic --- */

async function loadQuizFromUrl(url) {
  try {
    app.innerHTML = `<div style="padding:20px; text-align:center;">読み込み中...</div>`;
    resultPanel.style.display = "none";
    statusBar.style.display = "none";
    btnGrade.disabled = true;

    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to load ${url}`);
    const json = await res.json();
    
    currentQuiz = json;
    appTitle.textContent = json.title || "Quiz";
    appMeta.textContent = json.target || "";
    
    // 全問表示モードで開始
    renderQuiz(json);

  } catch (e) {
    app.innerHTML = `<div class="card error">読み込み失敗: ${e.message}</div>`;
  }
}

/**
 * クイズを描画する（全問 or フィルタリング後）
 * @param {Object} quizObj - クイズデータ
 * @param {Array} itemsOverride - (Optional) 特定の問題だけ表示する場合に使用
 */
function renderQuiz(quizObj, itemsOverride = null) {
  // State Reset
  userAnswers = {};
  isGraded = false;
  btnGrade.disabled = false;
  btnGrade.textContent = "採点する";
  resultPanel.style.display = "none";
  btnRetryMissed.style.display = "none";
  
  // 使用する問題リストを決定
  currentItems = itemsOverride || quizObj.items || [];
  
  // 進捗バー初期化
  statusBar.style.display = "flex";
  updateProgress();

  app.innerHTML = "";
  
  if (currentItems.length === 0) {
    app.innerHTML = `<div class="card">表示する問題がありません。</div>`;
    return;
  }

  currentItems.forEach((item, idx) => {
    const card = document.createElement("div");
    card.className = "card";
    card.id = `card-${item.id}`;
    
    // 1. 問題ヘッダー (ID, Tags)
    const header = document.createElement("div");
    header.className = "qhead";
    // 表示上の番号 (1, 2, 3...)
    const numSpan = `<span class="qnum">Q${idx + 1}</span>`; 
    // システムID (デバッグ用または控えめに)
    const idSpan = `<span class="qid">${item.id}</span>`;
    header.innerHTML = `<div>${numSpan} ${idSpan}</div>`;
    
    // 2. 問題文
    const body = document.createElement("div");
    body.className = "prompt";
    body.innerHTML = item.prompt.replace(/\n/g, "<br>");

    // 3. 回答エリア
    const answerArea = document.createElement("div");
    answerArea.className = "answer-area";

    if (item.type === "mcq") {
      // 選択式
      item.choices.forEach(choice => {
        const label = document.createElement("label");
        label.className = "choice";
        const radio = document.createElement("input");
        radio.type = "radio";
        radio.name = `q-${item.id}`;
        radio.value = choice.id;
        
        // 選択時のイベント
        radio.addEventListener("change", () => {
          userAnswers[item.id] = choice.id;
          // UIフィードバック
          card.querySelectorAll(".choice").forEach(c => c.classList.remove("selected"));
          label.classList.add("selected");
          updateProgress();
        });

        label.appendChild(radio);
        label.appendChild(document.createTextNode(" " + choice.text));
        answerArea.appendChild(label);
      });

    } else if (item.type === "sorting") {
      // 並べ替え
      userAnswers[item.id] = []; // 配列で初期化
      
      const pool = document.createElement("div");
      pool.className = "tokens";
      const line = document.createElement("div");
      line.className = "answerline";
      line.textContent = "（ここをクリックして単語を戻す）";

      // 選択肢（シャッフル）
      const shuffled = [...item.choices].sort(() => Math.random() - 0.5);
      
      shuffled.forEach(c => {
        const chip = document.createElement("span");
        chip.className = "chip";
        chip.textContent = c.text;
        chip.dataset.cid = c.id;
        
        chip.addEventListener("click", () => {
          if (chip.classList.contains("disabled")) return;
          // Move to line
          chip.classList.add("disabled");
          const ansChip = chip.cloneNode(true);
          ansChip.classList.remove("disabled");
          ansChip.classList.add("answerchip");
          
          ansChip.addEventListener("click", () => {
            // Remove from line
            ansChip.remove();
            chip.classList.remove("disabled");
            userAnswers[item.id] = userAnswers[item.id].filter(x => x !== c.id);
            if (line.children.length === 0) line.textContent = "（ここをクリックして単語を戻す）";
            updateProgress();
          });

          if (line.textContent.includes("（ここ")) line.textContent = "";
          line.appendChild(ansChip);
          userAnswers[item.id].push(c.id);
          updateProgress();
        });
        pool.appendChild(chip);
      });
      
      answerArea.appendChild(pool);
      answerArea.appendChild(line);
    }

    // 4. 解説エリア（最初は隠す）
    const explainDiv = document.createElement("div");
    explainDiv.className = "explanation";
    explainDiv.id = `expl-${item.id}`;
    explainDiv.style.display = "none"; // 初期非表示
    
    // 「正解・解説を表示」チェックボックスがONなら最初から表示（デバッグ用）
    if (toggleAnswers.checked) {
       explainDiv.style.display = "block";
       explainDiv.innerHTML = `<strong>正解: ${item.answerChoiceId || item.correctOrder.join("-")}</strong><br>${item.explanation || ""}`;
    }

    card.appendChild(header);
    card.appendChild(body);
    card.appendChild(answerArea);
    card.appendChild(explainDiv);
    app.appendChild(card);
  });
}

function updateProgress() {
  const total = currentItems.length;
  // userAnswers にキーがある数（空でないもの）
  const answered = Object.keys(userAnswers).filter(k => {
    const val = userAnswers[k];
    if (Array.isArray(val)) return val.length > 0; // sorting
    return val !== null && val !== undefined;      // mcq
  }).length;

  progressBar.max = total;
  progressBar.value = answered;
  progressText.textContent = `回答: ${answered} / ${total}`;
  
  // 全部答えたら採点ボタンを強調
  if (answered === total && total > 0) {
    btnGrade.classList.add("pulse");
  } else {
    btnGrade.classList.remove("pulse");
  }
}

/**
 * 採点ロジック
 */
async function gradeQuiz() {
  if (isGraded) return;
  
  let correctCount = 0;
  const wrongItemIds = [];
  const gradedItems = []; // For DB

  currentItems.forEach(item => {
    const card = document.getElementById(`card-${item.id}`);
    const explanation = document.getElementById(`expl-${item.id}`);
    
    // 入力を無効化（Freeze）
    const inputs = card.querySelectorAll("input, .chip");
    inputs.forEach(el => el.disabled = true);
    card.classList.add("frozen");

    let isCorrect = false;
    let userAns = userAnswers[item.id];

    if (item.type === "mcq") {
      isCorrect = (userAns === item.answerChoiceId);
    } else if (item.type === "sorting") {
      const uStr = (userAns || []).join(",");
      const aStr = item.correctOrder.join(",");
      isCorrect = (uStr === aStr);
    }

    // 正誤表示
    const resultDiv = document.createElement("div");
    resultDiv.className = isCorrect ? "result ok" : "result ng";
    resultDiv.textContent = isCorrect ? "⭕ 正解" : "❌ 不正解";
    card.insertBefore(resultDiv, explanation);

    // 解説表示
    explanation.style.display = "block";
    explanation.innerHTML = `
      <div class="ans-label">正解: <span class="correct-val">${getCorrectText(item)}</span></div>
      <div class="expl-text">${item.explanation || ""}</div>
    `;

    if (isCorrect) correctCount++;
    else wrongItemIds.push(item.id);

    gradedItems.push({
      id: item.id,
      correct: isCorrect,
      tags: item.tags || []
    });
  });

  // 結果パネル表示
  const percent = Math.round((correctCount / currentItems.length) * 100) || 0;
  scoreValue.textContent = `${percent}%`;
  scoreValue.className = percent >= 80 ? "score-value high" : "score-value low";
  
  if (wrongItemIds.length > 0) {
    resultMessage.textContent = `${currentItems.length}問中 ${correctCount}問正解です。復習しましょう！`;
    btnRetryMissed.style.display = "inline-block";
    btnRetryMissed.onclick = () => retryMissedItems(wrongItemIds);
  } else {
    resultMessage.textContent = "全問正解！素晴らしいです！";
    btnRetryMissed.style.display = "none";
  }
  
  resultPanel.style.display = "block";
  isGraded = true;
  btnGrade.textContent = "採点済み";
  btnGrade.disabled = true;

  // 上へスクロール
  resultPanel.scrollIntoView({ behavior: "smooth", block: "center" });

  // 履歴保存 (StudyEngine)
  if (window.StudyEngine && currentQuiz.id) {
    try {
      await StudyEngine.logAttempt({
        quizId: currentQuiz.id,
        quizTitle: currentQuiz.title,
        quizSourceUrl: currentQuiz.url || "", // fix source
        items: gradedItems
      });
      refreshHistory();
      refreshInsights();
    } catch(e) { console.error(e); }
  }
}

function getCorrectText(item) {
  if (item.type === "mcq") {
    const c = item.choices.find(c => c.id === item.answerChoiceId);
    return c ? c.text : item.answerChoiceId;
  }
  if (item.type === "sorting") {
    // IDからテキストに戻す
    return item.correctOrder.map(cid => {
      const c = item.choices.find(ch => ch.id === cid);
      return c ? c.text : cid;
    }).join(" ");
  }
  return "";
}

// 間違えた問題だけ再挑戦
function retryMissedItems(ids) {
  if (!currentQuiz) return;
  // idリストに一致するitemだけ抽出
  const subset = currentQuiz.items.filter(item => ids.includes(item.id));
  renderQuiz(currentQuiz, subset);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

/* --- Stats UI (StudyEngine連携) --- */

async function refreshHistory() {
  if (!window.StudyEngine) return;
  const history = await StudyEngine.getHistory();
  if (history.length === 0) {
    historyList.textContent = "履歴はまだありません。";
    return;
  }
  
  historyList.innerHTML = history.slice(0, 5).map(h => {
    const date = new Date(h.ts).toLocaleDateString() + " " + new Date(h.ts).toLocaleTimeString().slice(0,5);
    const score = Math.round((h.correctCount / h.totalCount) * 100);
    return `<div style="border-bottom:1px solid #eee; padding:4px 0;">
      <div style="font-weight:bold; font-size:12px;">${h.quizTitle}</div>
      <div style="font-size:11px; color:#666;">${date} - <span style="color:${score>=80?'green':'red'}">${score}%</span></div>
    </div>`;
  }).join("");
}

async function refreshInsights() {
  if (!window.StudyEngine) return;
  const stats = await StudyEngine.analyzeWeakness();
  
  let html = "";
  if (stats.worstTags.length > 0) {
    html += `<strong>苦手なタグ:</strong> ` + stats.worstTags.map(t => 
      `<span class="tag">${t.tag} (${Math.round(t.acc*100)}%)</span>`
    ).join(" ");
  } else {
    html += "データ収集中...";
  }
  insightsDiv.innerHTML = html;
  
  // Recommend
  const dueCards = await StudyEngine.getDueCards(3);
  if (dueCards.length > 0) {
    recDiv.innerHTML = "<strong>復習推奨:</strong> " + dueCards.length + "問の復習時期が来ています。";
  } else {
    recDiv.innerHTML = "現在、緊急の復習項目はありません。";
  }
}

// Start
window.addEventListener("DOMContentLoaded", boot);
