/* =============================================================================
   声音管理：背景音乐 + 轻音效
   -----------------------------------------------------------------------------
   · 声音默认关闭，用户点击才开启。
   · 背景音乐轻柔循环；如果 config 里没有给音频文件，就用内置的"轻音乐盒"音色。
   · 开卡、翻页等有轻音效；录音 / 视频播放时背景音乐自动降低或暂停。
   · 所有音效都用 Web Audio 本地合成，不联网、不缓存任何外部资源。
   ============================================================================= */

(function () {
  "use strict";

  let ctx = null;               // AudioContext（首次点击时创建）
  let masterGain = null;        // 总音量
  let bgGain = null;            // 背景音乐音量（可降低）
  let bgmAudio = null;          // 若配置了背景音乐文件，用它循环播放
  let musicBoxTimer = null;     // 内置音乐盒的定时器
  let enabled = false;

  const CFG = window.APP_CONFIG;

  function ensureCtx() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      masterGain = ctx.createGain();
      masterGain.gain.value = 0.9;
      masterGain.connect(ctx.destination);
      bgGain = ctx.createGain();
      bgGain.gain.value = 0.0;
      bgGain.connect(masterGain);
    }
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }

  /* ---------- 轻音效（本地合成） ---------- */

  function tone(freq, dur, type, vol, when, glideTo) {
    const c = ensureCtx();
    if (!c) return;
    const t0 = c.currentTime + (when || 0);
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type || "sine";
    osc.frequency.setValueAtTime(freq, t0);
    if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol || 0.2, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(masterGain);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  function noiseBurst(dur, vol, when, filterFreq) {
    const c = ensureCtx();
    if (!c) return;
    const t0 = c.currentTime + (when || 0);
    const len = Math.floor(c.sampleRate * dur);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = c.createBufferSource();
    src.buffer = buf;
    const filter = c.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = filterFreq || 1200;
    const g = c.createGain();
    g.gain.setValueAtTime(vol || 0.15, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filter).connect(g).connect(masterGain);
    src.start(t0);
  }

  const SFX = {
    cardOpen() {  // 纸页翻开的轻响
      noiseBurst(0.25, 0.12, 0, 2200);
      tone(520, 0.18, "sine", 0.08, 0.02, 660);
    },
    pageTurn() {  // 翻页
      noiseBurst(0.18, 0.1, 0, 1800);
      tone(360, 0.12, "sine", 0.06, 0.02, 420);
    },
    blow() {      // 吹气（检测到时）
      noiseBurst(0.4, 0.08, 0, 800);
    },
    chime() {     // 祝福响起
      tone(660, 0.5, "sine", 0.1, 0);
      tone(880, 0.6, "sine", 0.08, 0.1);
      tone(1320, 0.8, "sine", 0.05, 0.2);
    },
    extinguish() { // 吹灭
      noiseBurst(0.3, 0.1, 0, 600);
      tone(200, 0.3, "sine", 0.05, 0.02, 80);
    },
  };

  /* ---------- 内置"轻音乐盒"背景音乐 ---------- */
  // 一段轻柔的五声音阶旋律，缓慢循环，音量很低。
  const MELODY = [
    523.25, 659.25, 783.99, 659.25,
    587.33, 783.99, 880.00, 783.99,
    659.25, 523.25, 440.00, 523.25,
    587.33, 659.25, 523.25, 392.00,
  ];
  const STEP = 0.52; // 每个音间隔（秒）

  function startMusicBox() {
    stopMusicBox();
    let i = 0;
    const playNext = function () {
      if (!enabled || !ctx) return;
      const f = MELODY[i % MELODY.length];
      const c = ensureCtx();
      if (!c) return;
      const t0 = c.currentTime;
      const osc = c.createOscillator();
      const g = c.createGain();
      osc.type = "triangle";
      osc.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.5, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.6);
      osc.connect(g).connect(bgGain);
      osc.start(t0);
      osc.stop(t0 + 1.7);
      i++;
    };
    playNext();
    musicBoxTimer = setInterval(playNext, STEP * 1000);
  }

  function stopMusicBox() {
    if (musicBoxTimer) { clearInterval(musicBoxTimer); musicBoxTimer = null; }
  }

  /* ---------- 背景音乐文件（若配置） ---------- */
  function startBgmFile() {
    if (bgmAudio) return;
    const path = CFG.sound && CFG.sound.backgroundMusic;
    if (!path) { startMusicBox(); return; }
    bgmAudio = new Audio(path);
    bgmAudio.loop = true;
    bgmAudio.volume = 0.0;
    bgmAudio.addEventListener("error", function () {
      // 文件不存在或加载失败 → 回退到内置音乐盒
      stopBgmFile();
      startMusicBox();
    });
    bgmAudio.play().then(function () {
      if (enabled && bgGain) bgGain.gain.value = 0.22;
    }).catch(function () {
      stopBgmFile();
      startMusicBox();
    });
  }

  function stopBgmFile() {
    if (bgmAudio) {
      try { bgmAudio.pause(); } catch (e) {}
      bgmAudio = null;
    }
  }

  /* ---------- 对外接口 ---------- */

  window.Audio = {
    get enabled() { return enabled; },

    toggle() {
      ensureCtx();
      enabled = !enabled;
      if (enabled) {
        if (bgGain) bgGain.gain.value = 0.22;
        startBgmFile();
      } else {
        if (bgGain) bgGain.gain.value = 0.0;
        stopMusicBox();
        stopBgmFile();
      }
      return enabled;
    },

    // 播放某段轻音效
    sfx(name) {
      if (!enabled) return;   // 声音关闭时不播任何音效
      const fn = SFX[name];
      if (fn) fn();
    },

    // 录音 / 视频播放期间，压低背景音乐
    duck(on) {
      if (!bgGain) return;
      bgGain.gain.cancelScheduledValues(ctx.currentTime);
      bgGain.gain.linearRampToValueAtTime(on ? 0.03 : (enabled ? 0.22 : 0), ctx.currentTime + 0.3);
    },

    // 页面隐藏 / 退出时，释放资源
    release() {
      stopMusicBox();
      stopBgmFile();
      if (ctx && ctx.state !== "closed") { try { ctx.close(); } catch (e) {} }
      ctx = null;
    },
  };
})();
