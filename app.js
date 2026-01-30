/* app.js */
"use strict";

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

/* --- Elements --- */

// Views
const views = {
  home: $("#view-home"),
  quiz: $("#view-quiz"),
  result: $("#view-result"),
  analysis: $("#view-analysis")
};

// Home
const quizSelect = $("#quizSelect");
const quizUrlInput = $("#quizUrlInput");
const btnLoadUrl = $("#btnLoadUrl");
const btnToAnalysis = $("#btnToAnalysis");

// Quiz
const btnQuitQuiz = $("#btnQuitQuiz");
const quizTitleDisplay = $("#quizTitleDisplay");
const quizAppBody = $("#quizAppBody");
const btnGrade = $("#btnGrade");

// Result
const scoreText = $("#scoreText");
const resultMessage = $("#resultMessage");
const resultDetails = $("#resultDetails");
const btnRetryMissed = $("#btnRetryMissed");
const btnBackToHomeFromResult = $("#btnBackToHomeFromResult");

// Analysis
const btnBackToHomeFromAnalysis = $("#btnBackToHomeFromAnalysis");
const insightsContent = $("#insightsContent");
const recommendationsContent = $("#recommendationsContent");
const historyListContent = $("#historyListContent");
const btnRefreshInsights = $("#btnRefreshInsights");
const btnClearHistory = $("#btnClearHistory");

// Other
const toggleAnswers = $("#toggleAnswers");

/* --- State --- */
let currentQuiz = null;
let currentItems = [];
let userAnswers = {};
let quizListCache = [];

/* --- Initialization --- */

async function boot() {
  switchView("home");
  
  try {
    quizListCache = await loadQuizList();
    renderQuizSelect(quizListCache);

    // URLパラメータがあれば即ロード
    const params = new URLSearchParams(location.search);
    const quizUrl = params.get("quiz");
    if (quizUrl) {
      quizUrlInput.value = quizUrl;
      await loadQuizFromUrl(quizUrl);
    }
  } catch (e) {
    console.error(e);
    alert("初期化エラー: " + e.message);
  }
}

// 画面切り替え
function switchView(viewName) {
  Object.values(views).forEach(el => el.classList.remove("active"));
  if (views[viewName]) {
    views[viewName].classList.add("active");
    window.scrollTo(0, 0);
  }
}

async function loadQuizList() {
  const res = await fetch("./index.json");
  if (!res.ok) throw new Error("index.json load failed");
  const data = await res.json();
  return data.quizzes || [];
}

function renderQuizSelect(list) {
  quizSelect.innerHTML = `<option value="">-- ドリルを選択 --</option>`;
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

/* --- Logic: Load & Quiz --- */

quizSelect.addEventListener("change", (e) => {
  if (e.target.value) loadQuizFromUrl(e.target.value);
});

btnLoadUrl.addEventListener("click", () => {
  if (quizUrlInput.value) loadQuizFromUrl(quizUrlInput.value);
});

async function loadQuizFromUrl(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to load ${url}`);
    const json = await res.json();
    
    currentQuiz = json;
    // 開始
    startQuiz(json.items, json.title);
  } catch (e) {
    alert("読み込み失敗: " + e.message);
  }
}

function startQuiz(items, title) {
  currentItems = items || [];
  userAnswers = {};
  
  quizTitleDisplay.textContent = title || "Quiz";
  
  renderQuizItems(currentItems);
  switchView("quiz");
}

function renderQuizItems(items) {
  quizAppBody.innerHTML = "";
  
  if (items.length === 0) {
    quizAppBody.innerHTML = `<div class="card">問題がありません。</div>`;
    return;
  }

  items.forEach((item, idx) => {
    const card = document.createElement("div");
    card.className = "card";
    card.id = `card-${item.id}`;
    
    // Q番号
    const head = document.createElement("div");
    head.className = "qnum-simple";
    head.textContent = `Q${idx + 1}`;
    
    // 問題文
    const prompt = document.createElement("div");
    prompt.className = "prompt";
    prompt.innerHTML = (item.prompt || "").replace(/\n/g, "<br>");

    // 回答欄
    const answerArea = document.createElement("div");
    answerArea.className = "answer-area";

    if (item.type === "mcq") {
      (item.choices || []).forEach(c => {
        const label = document.createElement("label");
        label.className = "choice";
        const radio = document.createElement("input");
        radio.type = "radio";
        radio.name = `q-${item.id}`;
        radio.value = c.id;
        radio.addEventListener("change", () => {
          userAnswers[item.id] = c.id;
          // UI feedback
          card.querySelectorAll(".choice").forEach(x => x.classList.remove("selected"));
          label.classList.add("selected");
        });
        label.append(radio, document.createTextNode(" " + c.text));
        answerArea.appendChild(label);
      });
    } else if (item.type === "sorting") {
      userAnswers[item.id] = [];
      const pool = document.createElement("div");
      pool.className = "tokens";
      const line = document.createElement("div");
      line.className = "answerline";
      line.textContent = "選択してください";

      // Shuffle
      const shuffled = [...(item.choices || [])].sort(() => Math.random() - 0.5);
      shuffled.forEach(c => {
        const chip = document.createElement("span");
        chip.className = "chip";
        chip.textContent = c.text;
        
        chip.addEventListener("click", () => {
          if (chip.classList.contains("used")) return;
          chip.classList.add("used");
          
          const ansChip = document.createElement("span");
          ansChip.className = "answerchip";
          ansChip.textContent = c.text;
          ansChip.addEventListener("click", () => {
            ansChip.remove();
            chip.classList.remove("used");
            userAnswers[item.id] = userAnswers[item.id].filter(x => x !== c.id);
            if (line.children.length === 0) line.textContent = "選択してください";
          });

          if (line.textContent === "選択してください") line.textContent = "";
          line.appendChild(ansChip);
          userAnswers[item.id].push(c.id);
        });
        pool.appendChild(chip);
      });
      answerArea.append(pool, line);
    } else {
      answerArea.textContent = "(未対応の形式)";
    }

    card.append(head, prompt, answerArea);
    quizAppBody.appendChild(card);
  });
}

btnQuitQuiz.addEventListener("click", () => {
  if (confirm("中断してメニューに戻りますか？")) {
    switchView("home");
  }
});

/* --- Logic: Grading & Result --- */

btnGrade.addEventListener("click", async () => {
  if (!currentQuiz) return;
  
  let correctCount = 0;
  const wrongIds = [];
  const gradedItems = [];
  
  // 解説生成用
  resultDetails.innerHTML = "";

  currentItems.forEach((item, idx) => {
    let isCorrect = false;
    const ua = userAnswers[item.id];

    if (item.type === "mcq") {
      isCorrect = (ua === item.answerChoiceId);
    } else if (item.type === "sorting") {
      const uStr = (ua || []).join(",");
      const aStr = (item.correctOrder || []).join(",");
      isCorrect = (uStr === aStr);
    }

    if (isCorrect) correctCount++;
    else wrongIds.push(item.id);

    gradedItems.push({ id: item.id, correct: isCorrect, tags: item.tags });

    // 解説カード生成（結果画面用）
    const detailCard = document.createElement("div");
    detailCard.className = `detail-card ${isCorrect ? "ok" : "ng"}`;
    detailCard.innerHTML = `
      <div class="detail-header">
        <span class="mark">${isCorrect ? "⭕ 正解" : "❌ 不正解"}</span>
        <span class="qid">Q${idx+1}</span>
      </div>
      <div class="prompt-sm">${item.prompt}</div>
      <div class="expl-body">
        <div><strong>正解:</strong> ${getCorrectText(item)}</div>
        <div style="margin-top:4px; color:#555;">${item.explanation || ""}</div>
      </div>
    `;
    resultDetails.appendChild(detailCard);
  });

  // スコア表示
  const pct = Math.round((correctCount / currentItems.length) * 100) || 0;
  scoreText.textContent = `${pct}%`;
  scoreText.className = pct >= 80 ? "score-high" : "score-low";
  
  if (wrongIds.length > 0) {
    resultMessage.textContent = `${currentItems.length}問中 ${correctCount}問正解。`;
    btnRetryMissed.style.display = "inline-block";
    btnRetryMissed.onclick = () => {
      // 間違えた問題だけで再構成
      const subset = currentQuiz.items.filter(i => wrongIds.includes(i.id));
      startQuiz(subset, `${currentQuiz.title} (復習)`);
    };
  } else {
    resultMessage.textContent = "全問正解！";
    btnRetryMissed.style.display = "none";
  }

  // ログ保存 (StudyEngineのAPI仕様に合わせて修正)
  if (window.StudyEngine) {
    try {
      // ログ用オブジェクト作成
      const attempt = {
        ts: Date.now(),
        quizId: currentQuiz.id || currentQuiz.title,
        quizTitle: currentQuiz.title,
        quizSourceUrl: currentQuiz.url || "",
        total: currentItems.length,
        correct: correctCount,
        scoreSum: 0, // 簡易実装では0
        scoreItems: 0,
        itemMeta: {}, // 必須ではないが簡易的に空
        userAnswers: userAnswers,
        resultState: {} // 簡易的に空
      };
      
      // itemMetaなどを埋める（analyzeAttemptsで必要になるため）
      gradedItems.forEach(g => {
        attempt.itemMeta[g.id] = { tags: g.tags, type: "standard" };
        attempt.resultState[g.id] = { correct: g.correct };
      });

      await StudyEngine.addAttempt(attempt);

      // updateCardsFromAttemptも呼ぶ必要がある（SR用）
      const qualityMap = {};
      gradedItems.forEach(g => {
        qualityMap[g.id] = { quality: g.correct ? 5 : 2, tags: g.tags };
      });
      await StudyEngine.updateCardsFromAttempt({
        quizId: attempt.quizId,
        quizTitle: attempt.quizTitle,
        quizSourceUrl: attempt.quizSourceUrl,
        qualityMap
      });

    } catch (e) {
      console.warn("Log failed:", e);
    }
  }

  switchView("result");
});

function getCorrectText(item) {
  if (item.type === "mcq") {
    const c = (item.choices||[]).find(x => x.id === item.answerChoiceId);
    return c ? c.text : item.answerChoiceId;
  }
  if (item.type === "sorting") {
    return (item.correctOrder||[]).map(cid => {
      const c = (item.choices||[]).find(x => x.id === cid);
      return c ? c.text : cid;
    }).join(" ");
  }
  return "";
}

btnBackToHomeFromResult.addEventListener("click", () => {
  switchView("home");
});

/* --- Logic: Analysis --- */

btnToAnalysis.addEventListener("click", async () => {
  switchView("analysis");
  await refreshAnalysisView();
});

btnBackToHomeFromAnalysis.addEventListener("click", () => {
  switchView("home");
});

btnRefreshInsights.addEventListener("click", refreshAnalysisView);

btnClearHistory.addEventListener("click", async () => {
  if (!confirm("履歴を削除しますか？")) return;
  if (window.StudyEngine) {
    await StudyEngine.clearAttempts();
    await refreshAnalysisView();
  }
});

async function refreshAnalysisView() {
  if (!window.StudyEngine) return;
  
  // 履歴リスト (getHistoryではなくlistAttempts)
  const attempts = await StudyEngine.listAttempts(20);
  if (attempts.length === 0) {
    historyListContent.innerHTML = "<div class='small'>履歴なし</div>";
    insightsContent.textContent = "データ不足";
    recommendationsContent.textContent = "";
    return;
  }

  historyListContent.innerHTML = attempts.map(a => {
    const d = new Date(a.ts);
    const dateStr = `${d.getMonth()+1}/${d.getDate()} ${d.getHours()}:${d.getMinutes().toString().padStart(2,'0')}`;
    return `<div class="history-item">
      <span class="date">${dateStr}</span>
      <span class="title">${a.quizTitle}</span>
      <span class="score">${a.correct}/${a.total}</span>
    </div>`;
  }).join("");

  // 分析 (analyzeAttempts)
  const analysis = StudyEngine.analyzeAttempts(attempts);
  // worstTags: [{tag, correct, attempts, acc}, ...]
  if (analysis.worstTags && analysis.worstTags.length) {
    insightsContent.innerHTML = `<strong>苦手タグTOP:</strong><br>` + 
      analysis.worstTags.slice(0, 5).map(t => 
        `・${t.tag} (正答率 ${Math.round(t.acc*100)}%)`
      ).join("<br>");
  } else {
    insightsContent.textContent = "タグ情報を含むデータがありません";
  }

  // おすすめ (listDueCards)
  const due = await StudyEngine.listDueCards(5, Date.now());
  if (due.length > 0) {
    recommendationsContent.innerHTML = `<strong>復習待ち: ${due.length}問</strong><br>` +
      `<span class="small">※特定の問題をピンポイントで復習する機能は次回実装予定</span>`;
  } else {
    recommendationsContent.textContent = "復習が必要な問題は現在ありません";
  }
}

// Start
window.addEventListener("DOMContentLoaded", boot);
