/* =============================================================================
   主逻辑：场景切换、贺卡、日记、吹蜡烛、读信、照片放大
   -----------------------------------------------------------------------------
   依赖：config.js（内容）、audio.js（声音）、blow.js（吹气）。
   全部为原生 JS，无框架、无外部依赖。
   ============================================================================= */

(function () {
  "use strict";

  const CFG = window.APP_CONFIG;
  const $ = function (sel) { return document.querySelector(sel); };
  const $$ = function (sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); };

  /* ---------- 工具 ---------- */
  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  /* ---------- 场景管理 ---------- */
  const stack = [];           // 返回栈
  let completed = false;      // 是否已走完一遍流程

  function showScene(id) {
    $$(".scene").forEach(function (s) { s.classList.remove("active"); });
    const target = $("#scene-" + id);
    if (target) target.classList.add("active");
    document.body.dataset.scene = id;
  }

  function leaveCake() {
    if (Blow.isActive) Blow.stop();
    window.Audio.duck(false);
  }

  function goTo(id) {
    const cur = document.body.dataset.scene || "room";
    if (cur !== id) stack.push(cur);
    if (cur === "cake") leaveCake();
    showScene(id);
    if (id === "letter") initLetter();
  }

  function back() {
    const cur = document.body.dataset.scene || "room";
    if (cur === "cake") leaveCake();
    const prev = stack.pop();
    if (prev) showScene(prev);
  }

  // 全局返回 / 跳过
  $$(".btn-back").forEach(function (b) { b.addEventListener("click", back); });

  /* ---------- 初始化文案 ---------- */
  function fillText() {
    document.title = CFG.room.title;
    $("#room-hint").textContent = CFG.room.hint;

    $("#card-cover-title").textContent = CFG.card.coverTitle;
    $("#card-cover-sub").textContent = CFG.card.coverSub;
    const opening = $("#card-opening");
    opening.innerHTML = "";
    CFG.card.opening.forEach(function (p) { opening.appendChild(el("p", "card-opening-p", p)); });
    $("#btn-to-diary").textContent = CFG.card.nextLabel;

    $("#diary-title").textContent = CFG.diary.title;
    $("#diary-intro").textContent = CFG.diary.intro;
    $("#btn-diary-to-cake").textContent = CFG.diary.toCakeLabel;

    $("#cake-wish").textContent = CFG.cake.wishPrompt;
    $("#blow-hint").textContent = CFG.cake.blowHint;
    $("#btn-relight").textContent = CFG.cake.relight;
    $("#btn-to-letter").textContent = CFG.cake.nextLabel;

    $("#letter-title").textContent = CFG.letter.title;
    $("#letter-body").innerHTML = "";
    CFG.letter.paragraphs.forEach(function (p) {
      $("#letter-body").appendChild(el("p", "letter-p", p));
    });
    $("#letter-back-label").textContent = CFG.letter.backLabel;

    $("#replay-reread").textContent = CFG.replay.rereadLabel;
    $("#replay-diary").textContent = CFG.replay.diaryLabel;
    $("#replay-cake").textContent = CFG.replay.cakeLabel;
    $("#replay-all").textContent = CFG.replay.replayAllLabel;
    $("#replay-hint").textContent = CFG.replay.doneHint;

    updateSoundButton();
  }

  /* ---------- 声音开关 ---------- */
  const soundBtn = $("#sound-toggle");
  function updateSoundButton() {
    soundBtn.textContent = window.Audio.enabled ? CFG.sound.onLabel : CFG.sound.offLabel;
    soundBtn.classList.toggle("on", window.Audio.enabled);
  }
  soundBtn.addEventListener("click", function () {
    window.Audio.toggle();
    updateSoundButton();
  });

  /* ---------- 1. 贺卡 ---------- */
  const card = $("#card");
  let cardOpened = false;
  card.addEventListener("click", function () {
    if (cardOpened) return;
    cardOpened = true;
    window.Audio.sfx("cardOpen");
    card.classList.add("open");
    setTimeout(function () { $("#card-opening").classList.add("show"); }, 500);
  });

  /* ---------- 2. 日记 ---------- */
  let memIndex = 0;
  let flipping = false;
  const memories = CFG.diary.memories;
  const pageEl = $("#diary-page");            // 当前页（正面）内容
  const underEl = $("#diary-under-content");  // 翻页时下方露出的目标页
  const flipperEl = $("#diary-flipper");
  const diaryBook = $("#diary-book");

  function renderInto(container, i) {
    const m = memories[i];
    container.innerHTML = "";
    const wrap = el("div", "mem-wrap");

    wrap.appendChild(el("div", "mem-period", CFG.diary.periodLabels[m.period] || ""));
    wrap.appendChild(el("div", "mem-date", m.date));
    wrap.appendChild(el("div", "mem-title", m.title));
    wrap.appendChild(el("div", "mem-text", m.text));

    // 图片（1–3 张，可放大）
    if (m.images && m.images.length) {
      const imgs = el("div", "mem-images");
      m.images.forEach(function (src) {
        const img = el("img", "mem-img");
        img.src = src;
        img.alt = m.title;
        img.addEventListener("click", function () { openLightbox(src); });
        img.addEventListener("error", function () { img.style.display = "none"; });
        imgs.appendChild(img);
      });
      wrap.appendChild(imgs);
    }

    // 短视频
    if (m.video) {
      const v = el("video", "mem-video");
      v.src = m.video;
      v.controls = true;
      v.playsInline = true;
      v.preload = "none";
      v.addEventListener("play", function () { window.Audio.duck(true); });
      v.addEventListener("pause", function () { window.Audio.duck(false); });
      v.addEventListener("ended", function () { window.Audio.duck(false); });
      wrap.appendChild(v);
    }

    // 语音
    if (m.audio) {
      const a = el("audio", "mem-audio");
      a.src = m.audio;
      a.controls = true;
      a.preload = "none";
      a.addEventListener("play", function () { window.Audio.duck(true); });
      a.addEventListener("pause", function () { window.Audio.duck(false); });
      a.addEventListener("ended", function () { window.Audio.duck(false); });
      wrap.appendChild(a);
    }

    container.appendChild(wrap);
  }

  function renderMemory(i) {
    memIndex = i;
    renderInto(pageEl, i);
    $("#diary-count").textContent = (i + 1) + " / " + memories.length;
    updateDiaryNav();
  }

  function updateDiaryNav() {
    $("#diary-prev").disabled = memIndex === 0;
    $("#diary-next").disabled = memIndex === memories.length - 1;
  }

  function goMemory(delta) {
    if (flipping) return;
    const next = memIndex + delta;
    if (next < 0 || next >= memories.length) return;
    flipping = true;

    renderInto(underEl, next);
    const forward = delta > 0;
    flipperEl.classList.add(forward ? "forward" : "backward");
    setTimeout(function () { window.Audio.sfx("pageTurn"); }, 260);

    flipperEl.addEventListener("animationend", function onEnd() {
      flipperEl.removeEventListener("animationend", onEnd);
      flipperEl.classList.remove("forward", "backward");
      renderMemory(next);
      flipping = false;
    });
  }
  $("#diary-prev").addEventListener("click", function () { goMemory(-1); });
  $("#diary-next").addEventListener("click", function () { goMemory(1); });

  // 触屏滑动翻页
  let touchX = null;
  diaryBook.addEventListener("touchstart", function (e) {
    touchX = e.touches[0].clientX;
  }, { passive: true });
  diaryBook.addEventListener("touchend", function (e) {
    if (touchX == null) return;
    const dx = e.changedTouches[0].clientX - touchX;
    if (Math.abs(dx) > 45) goMemory(dx < 0 ? 1 : -1);
    touchX = null;
  });

  /* ---------- 照片放大 ---------- */
  const lightbox = $("#lightbox");
  function openLightbox(src) {
    $("#lightbox-img").src = src;
    lightbox.classList.add("active");
  }
  function closeLightbox() { lightbox.classList.remove("active"); }
  lightbox.addEventListener("click", closeLightbox);

  /* ---------- 3. 蛋糕 · 吹蜡烛 ---------- */
  const flame = $("#flame");
  const smoke = $("#smoke");
  let candleLit = true;
  let cakeState = "wish";   // wish | blowing | out | done

  function enterCake() {
    candleLit = true;
    cakeState = "wish";
    flame.classList.remove("windy");
    flame.classList.add("lit");
    smoke.classList.remove("show");
    $("#cake-wish").classList.remove("hidden");
    $("#cake-blessing").classList.remove("show");
    $("#blow-controls").classList.remove("show");
    $("#blow-controls").classList.add("hidden");
    $("#btn-relight").classList.remove("show");
    $("#btn-to-letter").classList.remove("show");
    setupBlowControls();
  }

  function setupBlowControls() {
    const tap = $("#blow-tap");
    tap.textContent = CFG.cake.tapHint;
    tap.onclick = function () { if (candleLit) extinguish(); };

    // 用户点"许愿"后，才尝试请求麦克风
    $("#cake-wish").onclick = function () {
      $("#cake-wish").classList.add("hidden");
      $("#blow-controls").classList.remove("hidden");
      $("#blow-controls").classList.add("show");
      cakeState = "blowing";
      window.Audio.duck(true);           // 检测时暂停背景音乐

      const canMic = navigator.mediaDevices && navigator.mediaDevices.getUserMedia;
      if (canMic) {
        $("#blow-hint").textContent = CFG.cake.blowHint;
        Blow.on("onLevel", function (lvl) {
          flame.classList.toggle("windy", lvl > 0.35);
        });
        Blow.on("onBlow", function () { extinguish(); });
        Blow.on("onError", function () {
          $("#blow-hint").textContent = CFG.cake.tapHint;
          tap.textContent = CFG.cake.tapHint;
        });
        Blow.start();
      } else {
        $("#blow-hint").textContent = CFG.cake.tapHint;
        tap.textContent = CFG.cake.tapHint;
      }
    };
  }

  function extinguish() {
    if (!candleLit) return;
    candleLit = false;
    cakeState = "out";
    window.Audio.sfx("extinguish");
    leaveCake();
    flame.classList.remove("lit");
    flame.classList.remove("windy");
    smoke.classList.add("show");
    $("#blow-controls").classList.remove("show");
    $("#blow-controls").classList.add("hidden");

    setTimeout(function () {
      const b = $("#cake-blessing");
      b.innerHTML = "";
      CFG.cake.blessing.forEach(function (line) { b.appendChild(el("p", "blessing-line", line)); });
      b.classList.add("show");
      $("#btn-relight").classList.add("show");
      $("#btn-to-letter").classList.add("show");
      window.Audio.sfx("chime");
      cakeState = "done";
    }, 900);
  }

  $("#btn-relight").addEventListener("click", function () {
    candleLit = true;
    cakeState = "wish";
    flame.classList.add("lit");
    flame.classList.remove("windy");
    smoke.classList.remove("show");
    $("#cake-blessing").classList.remove("show");
    $("#cake-wish").classList.remove("hidden");
    $("#blow-controls").classList.remove("show");
    $("#blow-controls").classList.add("hidden");
    $("#btn-relight").classList.remove("show");
    $("#btn-to-letter").classList.remove("show");
    leaveCake();
  });

  /* ---------- 4. 读信 ---------- */
  let speechActive = false;
  const letterAudio = $("#letter-audio");
  const playBtn = $("#letter-play");
  const stopBtn = $("#letter-stop");

  function initLetter() {
    const rec = CFG.letter.recording;
    stopSpeech();
    if (rec) {
      letterAudio.src = rec;
      letterAudio.classList.remove("hidden");
      playBtn.textContent = CFG.letter.playLabel;
    } else {
      letterAudio.classList.add("hidden");
      playBtn.textContent = CFG.letter.readLabel;
    }
    playBtn.classList.remove("hidden");
    stopBtn.classList.add("hidden");
    window.Audio.duck(false);
  }

  function stopSpeech() {
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    speechActive = false;
  }

  function refreshLetterButtons() {
    if (CFG.letter.recording) {
      playBtn.classList.toggle("hidden", !letterAudio.paused);
      stopBtn.classList.toggle("hidden", letterAudio.paused);
    } else {
      playBtn.classList.remove("hidden");
      stopBtn.classList.add("hidden");
    }
  }

  playBtn.addEventListener("click", function () {
    if (CFG.letter.recording) {
      letterAudio.play();
      window.Audio.duck(true);
      refreshLetterButtons();
      return;
    }
    // 文字转语音朗读
    if (!window.speechSynthesis) return;
    if (speechActive) { stopSpeech(); refreshLetterButtons(); return; }
    const text = CFG.letter.paragraphs.join("，");
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "zh-CN";
    u.rate = 0.95;
    u.onstart = function () { speechActive = true; window.Audio.duck(true); refreshLetterButtons(); };
    u.onend = u.onerror = function () { speechActive = false; window.Audio.duck(false); refreshLetterButtons(); };
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  });

  stopBtn.addEventListener("click", function () {
    letterAudio.pause();
    letterAudio.currentTime = 0;
    window.Audio.duck(false);
    refreshLetterButtons();
  });
  letterAudio.addEventListener("ended", function () { window.Audio.duck(false); refreshLetterButtons(); });
  letterAudio.addEventListener("pause", function () { window.Audio.duck(false); });

  /* ---------- 房间物件点击 & 回访入口 ---------- */
  function bindRoom() {
    const items = {
      "room-card": "card",
      "room-diary": "diary",
      "room-cake": "cake",
    };
    Object.keys(items).forEach(function (id) {
      const n = document.getElementById(id);
      if (n) n.addEventListener("click", function () {
        if (id === "room-cake") enterCake();
        if (id === "room-diary") renderMemory(0);
        if (id === "room-card" && cardOpened) { showScene("card"); return; }
        goTo(items[id]);
      });
    });

    $("#replay-reread").addEventListener("click", function () { goTo("letter"); });
    $("#replay-diary").addEventListener("click", function () { renderMemory(0); goTo("diary"); });
    $("#replay-cake").addEventListener("click", function () { enterCake(); goTo("cake"); });
    $("#replay-all").addEventListener("click", replayAll);
  }

  function replayAll() {
    cardOpened = false;
    card.classList.remove("open");
    $("#card-opening").classList.remove("show");
    memIndex = 0;
    completed = false;
    $("#replay-panel").classList.remove("show");
    $("#replay-hint").classList.remove("show");
    $("#room-hint").classList.remove("hidden");
    goTo("room");
  }

  function markCompleted() {
    completed = true;
    $("#replay-panel").classList.add("show");
    $("#replay-hint").classList.add("show");
    $("#room-hint").classList.add("hidden");
  }

  /* ---------- 流程按钮 ---------- */
  $("#btn-to-diary").addEventListener("click", function () { renderMemory(0); goTo("diary"); });
  $("#btn-diary-to-cake").addEventListener("click", function () { enterCake(); goTo("cake"); });
  $("#btn-to-letter").addEventListener("click", function () { markCompleted(); goTo("letter"); });
  $("#letter-back").addEventListener("click", function () {
    stopSpeech();
    letterAudio.pause();
    goTo("room");
  });

  /* ---------- 页面隐藏时释放麦克风 / 语音 ---------- */
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) {
      leaveCake();
      stopSpeech();
      if (letterAudio) letterAudio.pause();
    }
  });
  window.addEventListener("beforeunload", function () {
    Blow.stop();
    window.Audio.release();
  });

  /* ---------- 启动 ---------- */
  function boot() {
    fillText();
    bindRoom();
    renderMemory(0);
    enterCake();
    showScene("room");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
