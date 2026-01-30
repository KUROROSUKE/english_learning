/* study_engine.js
 * - IndexedDB (attempts/cards)
 * - analytics (weakness)
 * - recommendations (due cards)
 * - SM-2-ish spaced repetition scheduler
 * Exports: window.StudyEngine
 */

(function () {
  "use strict";

  const DB_NAME = "quiz_app_db";
  const STORE_ATTEMPTS = "attempts";
  const STORE_CARDS = "cards";
  // 既存ユーザーで cards store を追加するために version を上げる
  const DB_VERSION = 2;

  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
  function nowTs() { return Date.now(); }
  function safeArr(x) { return Array.isArray(x) ? x : []; }

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

        if (!db.objectStoreNames.contains(STORE_CARDS)) {
          const store = db.createObjectStore(STORE_CARDS, { keyPath: "key" });
          store.createIndex("by_due", "dueTs");
          store.createIndex("by_quiz_due", ["quizId", "dueTs"]);
          store.createIndex("by_tag_due", ["tag", "dueTs"]);
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
      tx.objectStore(STORE_ATTEMPTS).add(attempt);
    });
  }

  async function listAttempts(limit = 50) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_ATTEMPTS, "readonly");
      tx.onerror = () => reject(tx.error);
      const store = tx.objectStore(STORE_ATTEMPTS);
      const idx = store.index("by_ts");
      const req = idx.openCursor(null, "prev");
      const out = [];
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor || out.length >= limit) return resolve(out);
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

  async function getCard(key) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_CARDS, "readonly");
      tx.onerror = () => reject(tx.error);
      const req = tx.objectStore(STORE_CARDS).get(key);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => resolve(req.result || null);
    });
  }

  async function putCard(card) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_CARDS, "readwrite");
      tx.onerror = () => reject(tx.error);
      tx.oncomplete = () => resolve(true);
      tx.objectStore(STORE_CARDS).put(card);
    });
  }

  async function listDueCards(limit = 20, ts = nowTs()) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_CARDS, "readonly");
      tx.onerror = () => reject(tx.error);
      const idx = tx.objectStore(STORE_CARDS).index("by_due");
      const range = IDBKeyRange.upperBound(ts);
      const req = idx.openCursor(range, "prev"); // 遅れているもの優先
      const out = [];
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor || out.length >= limit) return resolve(out);
        out.push(cursor.value);
        cursor.continue();
      };
    });
  }

  // quality: 0..5
  function updateSm2(card, quality, ts = nowTs()) {
    let reps = card.reps ?? 0;
    let intervalDays = card.intervalDays ?? 0;
    let ease = card.ease ?? 2.5;

    if (quality < 3) {
      reps = 0;
      intervalDays = 0.02; // ~30分
    } else {
      reps += 1;
      if (reps === 1) intervalDays = 1;
      else if (reps === 2) intervalDays = 3;
      else intervalDays = intervalDays * ease;
    }

    ease = ease + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
    ease = clamp(ease, 1.3, 2.7);

    const dueTs = ts + Math.round(intervalDays * 24 * 60 * 60 * 1000);

    return {
      ...card,
      reps,
      intervalDays,
      ease,
      lastQuality: quality,
      lastTs: ts,
      dueTs
    };
  }

  function dueLabel(dueTs) {
    const diff = dueTs - nowTs();
    const mins = Math.round(diff / 60000);
    if (mins <= 0) return `期限切れ（${-mins}分遅れ）`;
    if (mins < 60) return `あと${mins}分`;
    const hrs = Math.round(mins / 60);
    if (hrs < 48) return `あと${hrs}時間`;
    const days = Math.round(hrs / 24);
    return `あと${days}日`;
  }

  // attempt に itemMeta がある前提なら tag分析が可能
  function analyzeAttempts(attempts) {
    const itemAgg = new Map(); // key -> {attempts, correct}
    const quizAgg = new Map(); // quizId -> {total, correct}
    const tagAgg = new Map();  // tag -> {attempts, correct}

    for (const a of attempts) {
      const quizId = a.quizId || "unknown";
      const rs = a.resultState || {};
      const meta = a.itemMeta || {};

      const vals = Object.values(rs);
      const q = quizAgg.get(quizId) || { total: 0, correct: 0 };
      q.total += vals.length;
      q.correct += vals.filter(x => x && x.correct).length;
      quizAgg.set(quizId, q);

      for (const [itemId, r] of Object.entries(rs)) {
        const key = `${quizId}::${itemId}`;
        const o = itemAgg.get(key) || { attempts: 0, correct: 0 };
        o.attempts += 1;
        if (r && r.correct) o.correct += 1;
        itemAgg.set(key, o);

        const tags = safeArr(meta[itemId]?.tags);
        for (const t of tags) {
          const tg = tagAgg.get(t) || { attempts: 0, correct: 0 };
          tg.attempts += 1;
          if (r && r.correct) tg.correct += 1;
          tagAgg.set(t, tg);
        }
      }
    }

    const worstItems = [...itemAgg.entries()]
      .map(([key, v]) => ({ key, ...v, acc: v.attempts ? v.correct / v.attempts : 0 }))
      .sort((a, b) => a.acc - b.acc)
      .slice(0, 10);

    const quizzes = [...quizAgg.entries()]
      .map(([quizId, v]) => ({ quizId, ...v, acc: v.total ? v.correct / v.total : 0 }))
      .sort((a, b) => a.acc - b.acc);

    const worstTags = [...tagAgg.entries()]
      .map(([tag, v]) => ({ tag, ...v, acc: v.attempts ? v.correct / v.attempts : 0 }))
      .sort((a, b) => a.acc - b.acc)
      .slice(0, 10);

    return { worstItems, quizzes, worstTags };
  }

  // 学習結果を cards に反映（問題単位）
  // caller が qualityMap を用意する： itemId -> {quality, tags[]}
  async function updateCardsFromAttempt({ quizId, quizTitle, quizSourceUrl, qualityMap }) {
    const ts = nowTs();
    for (const [itemId, info] of Object.entries(qualityMap)) {
      const tags = safeArr(info.tags);
      const tag = tags.length ? tags[0] : "(untagged)";
      const key = `${quizId}::${itemId}`;
      const prev = (await getCard(key)) || {
        key,
        quizId,
        itemId,
        tag,
        reps: 0,
        intervalDays: 0,
        ease: 2.5,
        dueTs: ts
      };
      prev.tag = tag;
      const updated = updateSm2(prev, info.quality, ts);
      await putCard(updated);
    }
  }

  // Public API
  window.StudyEngine = {
    // db
    openDb,
    addAttempt,
    listAttempts,
    clearAttempts,
    // cards
    getCard,
    putCard,
    listDueCards,
    updateCardsFromAttempt,
    // analytics / rec
    analyzeAttempts,
    dueLabel
  };
})();
