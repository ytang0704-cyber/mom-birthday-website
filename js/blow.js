/* =============================================================================
   吹气检测（吹蜡烛）
   -----------------------------------------------------------------------------
   · 用户点击后才请求麦克风，不做任何录音 / 上传。
   · 用 Web Audio 在本地分析音量：先校准底噪，再近似检测"持续吹气"。
   · 检测时暂停背景音乐；完成、退出或切到后台即释放麦克风。
   · 任何时候都保留"点这里吹灭"作为兜底，不受授权 / 识别影响。
   ============================================================================= */

(function () {
  "use strict";

  let stream = null;
  let audioCtx = null;
  let analyser = null;
  let data = null;
  let rafId = null;
  let state = "idle";        // idle | calibrating | listening | done
  let noiseFloor = 0;        // 校准得到的底噪 RMS
  let calibrated = false;
  let blowHeld = 0;          // 持续吹气的帧数
  let sampleCount = 0;

  const CALIBRATE_FRAMES = 45;   // 约 0.75 秒 @ 60fps
  const HOLD_FRAMES = 10;        // 持续约 0.17 秒才判定为吹气
  const THRESHOLD_RATIO = 2.6;   // 超过底噪的倍数

  const handlers = {
    onLevel: null,      // 实时音量（0~1），用于让火苗随吹气摇动
    onBlow: null,       // 判定为吹气（持续）
    onError: null,      // 麦克风不可用
  };

  function rms() {
    analyser.getByteTimeDomainData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      const v = (data[i] - 128) / 128;
      sum += v * v;
    }
    return Math.sqrt(sum / data.length);
  }

  function tick() {
    if (state !== "calibrating" && state !== "listening") return;
    const level = rms();

    if (state === "calibrating") {
      noiseFloor = Math.max(noiseFloor, level);
      sampleCount++;
      if (sampleCount >= CALIBRATE_FRAMES) {
        calibrated = true;
        state = "listening";
      }
      rafId = requestAnimationFrame(tick);
      return;
    }

    // listening
    const threshold = Math.max(noiseFloor * THRESHOLD_RATIO, 0.02);
    const norm = Math.min(1, level / Math.max(threshold * 2.2, 0.05));
    if (handlers.onLevel) handlers.onLevel(norm);

    if (level > threshold) {
      blowHeld++;
      if (handlers.onBlow && blowHeld === HOLD_FRAMES) {
        handlers.onBlow();
      }
    } else {
      blowHeld = 0;
    }
    rafId = requestAnimationFrame(tick);
  }

  function release() {
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    if (stream) {
      stream.getTracks().forEach(function (t) { t.stop(); });
      stream = null;
    }
    if (audioCtx && audioCtx.state !== "closed") {
      try { audioCtx.close(); } catch (e) {}
    }
    audioCtx = null;
    analyser = null;
    data = null;
    state = "idle";
    calibrated = false;
    blowHeld = 0;
    sampleCount = 0;
    noiseFloor = 0;
  }

  window.Blow = {
    get isActive() { return state === "listening" || state === "calibrating"; },

    // 开始：请求麦克风并校准
    start() {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        if (handlers.onError) handlers.onError();
        return;
      }
      const AC = window.AudioContext || window.webkitAudioContext;
      navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false } })
        .then(function (s) {
          stream = s;
          audioCtx = new AC();
          const src = audioCtx.createMediaStreamSource(stream);
          analyser = audioCtx.createAnalyser();
          analyser.fftSize = 2048;
          analyser.smoothingTimeConstant = 0.4;
          data = new Uint8Array(analyser.fftSize);
          src.connect(analyser);
          state = "calibrating";
          sampleCount = 0;
          noiseFloor = 0;
          blowHeld = 0;
          rafId = requestAnimationFrame(tick);
        })
        .catch(function () {
          if (handlers.onError) handlers.onError();
        });
    },

    stop() { release(); },
    on(name, fn) { handlers[name] = fn; },
  };
})();
