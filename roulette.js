/*
 * LUCKY ROULETTE — 룰렛 그리기 / 회전 / 효과음
 *
 * 각도 규칙
 *  - 휠 좌표계: 12시 방향이 0°, 시계 방향으로 증가.
 *  - 16칸. k번째 칸(0~15)은 휠 좌표 [k*22.5°, (k+1)*22.5°] 구간이고 숫자는 ORDER[k].
 *  - 같은 숫자는 k와 k+8 → 서로 정반대(180°) 위치.
 *  - 휠 전체를 시계 방향으로 R° 회전시키면, 12시(포인터) 아래에 오는 휠 좌표는 mod(-R, 360).
 *    R이 커질수록 포인터 아래 휠 좌표는 줄어듦 → 포인터는 각 칸의 "큰 각도 쪽 경계"로 들어감.
 */
(function () {
  'use strict';

  var HALF = [1, 5, 3, 7, 4, 6, 2, 8];        // 이웃 칸 색이 비슷하지 않도록 고른 순서
  var ORDER = HALF.concat(HALF);              // 16칸: 같은 숫자가 정반대에
  var SEGMENTS = ORDER.length;                // 16
  var SEG_ANGLE = 360 / SEGMENTS;             // 22.5°
  var EDGE_MIN = 0.10;                        // 경계에서 최소 칸 폭의 10% 안쪽
  var NEAR_MISS_RATE = 0.3;                   // 니어미스 확률
  var NEAR_MISS = [0.10, 0.20];               // 니어미스: 들어온 경계에서 칸 폭의 10~20%
  var CX = 250, CY = 250, R_WHEEL = 212;
  // 숫자별 색 (1~8): 빨강, 주황, 노랑, 청록, 파랑, 보라, 자홍, 초록
  var NUM_COLORS = { 1: '#d7263d', 2: '#f46036', 3: '#e3b505', 4: '#1b998b',
                     5: '#2e86de', 6: '#5f27cd', 7: '#c2185b', 8: '#2d7d46' };

  function mod(a, n) { return ((a % n) + n) % n; }

  /** 회전량 R일 때 포인터 아래 칸 번호(0~15) */
  function segmentAtPointer(rotation) {
    return Math.floor(mod(-rotation, 360) / SEG_ANGLE) % SEGMENTS;
  }
  /** 회전량 R일 때 포인터가 가리키는 숫자(1~8) */
  function numberAtPointer(rotation) {
    return ORDER[segmentAtPointer(rotation)];
  }
  /** 포인터 위치가 칸 안 어디쯤인지: 0 = 들어온 경계, 1 = 나갈 경계 */
  function positionInSegment(rotation) {
    var a = mod(-rotation, 360) / SEG_ANGLE;
    return 1 - (a - Math.floor(a));
  }

  /**
   * 회전 곡선 (0~1 → 0~1). 앞부분은 빠르게 감속, 마지막 tail 구간은 한 칸씩 기어가듯.
   * crawl: 마지막 구간에서 움직이는 거리 비율, tail: 마지막 구간 시간 비율.
   * 두 구간은 속도가 이어지도록 맞춤.
   */
  function makeEase(crawl, tail) {
    var t1 = 1 - tail, d1 = 1 - crawl;
    var vJoin = 2 * crawl / tail;                 // 마지막 구간 시작 속도 (2차 감속)
    var a = Math.min(vJoin * t1 / d1, 0.9);       // 앞 구간 끝 속도(정규화)
    return function (t) {
      if (t <= 0) return 0;
      if (t >= 1) return 1;
      if (t < t1) {
        var u = t / t1;
        return d1 * (a * u + (1 - a) * (1 - Math.pow(1 - u, 3)));
      }
      var w = (t - t1) / tail;
      return d1 + crawl * (1 - (1 - w) * (1 - w));
    };
  }

  /**
   * 현재 회전값에서 target 숫자(1~8)에 멈추기 위한 계획.
   * rand: 0~1 난수 함수 (테스트용 주입 가능)
   */
  function planSpin(currentRotation, target, rand) {
    rand = rand || Math.random;
    var segs = [];
    ORDER.forEach(function (n, k) { if (n === target) segs.push(k); });
    var seg = segs[Math.floor(rand() * segs.length) % segs.length];

    var nearMiss = rand() < NEAR_MISS_RATE;
    // f: 들어온 경계(칸의 큰 각도 쪽)에서부터 칸 폭 대비 위치
    var f = nearMiss
      ? NEAR_MISS[0] + rand() * (NEAR_MISS[1] - NEAR_MISS[0])
      : EDGE_MIN + rand() * (1 - 2 * EDGE_MIN);
    var wheelAngleAtPointer = (seg + 1 - f) * SEG_ANGLE;
    var finalMod = mod(-wheelAngleAtPointer, 360);
    var delta = mod(finalMod - mod(currentRotation, 360), 360);   // 0 ~ 360
    var turns = 7 + Math.floor(rand() * 2);                       // 7 또는 8바퀴 + delta → 총 7~9바퀴
    var duration = 8000 + rand() * 2000;                          // 8 ~ 10초
    var total = turns * 360 + delta;
    var tailMs = 2200 + rand() * 800;                             // 마지막 2.2~3초
    var crawlDeg = (3 + rand() * 1.5) * SEG_ANGLE;                // 그동안 3~4.5칸
    return {
      finalRotation: currentRotation + total,
      duration: duration,
      segment: seg,
      fraction: f,
      nearMiss: nearMiss,
      ease: makeEase(crawlDeg / total, tailMs / duration)
    };
  }

  // Node 환경에서 검증용으로 내보내기
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { planSpin: planSpin, numberAtPointer: numberAtPointer, segmentAtPointer: segmentAtPointer,
                       positionInSegment: positionInSegment, makeEase: makeEase, ORDER: ORDER,
                       SEG_ANGLE: SEG_ANGLE, EDGE_MIN: EDGE_MIN };
  }
  if (typeof document === 'undefined') return;

  // ---------------- SVG 그리기 ----------------
  var SVG_NS = 'http://www.w3.org/2000/svg';
  function el(tag, attrs) {
    var e = document.createElementNS(SVG_NS, tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }
  function polar(r, deg) {
    var rad = deg * Math.PI / 180;
    return [CX + r * Math.sin(rad), CY - r * Math.cos(rad)];
  }

  var wheel = document.getElementById('wheel');
  var segGroup = document.getElementById('segments');
  var segEls = [];

  for (var i = 0; i < SEGMENTS; i++) {
    var a0 = i * SEG_ANGLE, a1 = (i + 1) * SEG_ANGLE, mid = a0 + SEG_ANGLE / 2;
    var p0 = polar(R_WHEEL, a0), p1 = polar(R_WHEEL, a1);
    var color = NUM_COLORS[ORDER[i]];
    var g = el('g', { 'class': 'seg', 'data-num': ORDER[i], 'data-seg': i });
    g.style.setProperty('--seg-color', color);
    g.appendChild(el('path', {
      'class': 'seg-path',
      fill: color,
      d: 'M' + CX + ',' + CY + ' L' + p0[0] + ',' + p0[1] +
         ' A' + R_WHEEL + ',' + R_WHEEL + ' 0 0 1 ' + p1[0] + ',' + p1[1] + ' Z'
    }));
    var tp = polar(168, mid);
    var t = el('text', {
      'class': 'seg-label', x: tp[0], y: tp[1],
      transform: 'rotate(' + mid + ' ' + tp[0] + ' ' + tp[1] + ')'
    });
    t.textContent = String(ORDER[i]);
    g.appendChild(t);
    segGroup.appendChild(g);
    segEls.push(g);
  }

  var bulbGroup = document.getElementById('bulbs');
  var BULBS = 24;
  for (var b = 0; b < BULBS; b++) {
    var bp = polar(228, b * 360 / BULBS + 360 / BULBS / 2);
    bulbGroup.appendChild(el('circle', {
      'class': 'bulb' + (b % 2 ? ' alt' : ''), cx: bp[0], cy: bp[1], r: 6, filter: 'url(#glow)'
    }));
  }

  // ---------------- 사운드 (Web Audio API) ----------------
  var audioCtx = null;
  function ensureAudio() {
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!audioCtx) audioCtx = new AC();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  }
  function playTick() {
    if (!audioCtx || audioCtx.state !== 'running') return;
    var now = audioCtx.currentTime;
    var osc = audioCtx.createOscillator();
    var gain = audioCtx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(1800, now);
    osc.frequency.exponentialRampToValueAtTime(600, now + 0.03);
    gain.gain.setValueAtTime(0.18, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.04);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(now);
    osc.stop(now + 0.05);
  }
  function playWin() {
    if (!audioCtx || audioCtx.state !== 'running') return;
    var now = audioCtx.currentTime;
    [523.25, 659.25, 783.99, 1046.5].forEach(function (f, idx) {
      var t0 = now + idx * 0.09;
      var osc = audioCtx.createOscillator();
      var gain = audioCtx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(f, t0);
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(0.3, t0 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + (idx === 3 ? 0.6 : 0.2));
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(t0);
      osc.stop(t0 + 0.65);
    });
  }
  /** 정산 연출용 짧은 효과음. notes: [주파수, 시작(초), 길이(초)] 목록 */
  function blip(type, vol, notes, slideTo) {
    if (!audioCtx || audioCtx.state !== 'running') return;
    var now = audioCtx.currentTime;
    notes.forEach(function (n) {
      var t0 = now + n[1], d = n[2];
      var osc = audioCtx.createOscillator();
      var gain = audioCtx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(n[0], t0);
      if (slideTo) osc.frequency.exponentialRampToValueAtTime(n[0] * slideTo, t0 + d);
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + d);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(t0);
      osc.stop(t0 + d + 0.02);
    });
  }
  var SFX = {
    win:    function () { blip('triangle', 0.22, [[987.8, 0, 0.09], [1318.5, 0.07, 0.16]]); },
    lose:   function () { blip('sawtooth', 0.09, [[260, 0, 0.28]], 0.5); },
    fee:    function () { blip('square', 0.07, [[1400, 0, 0.05], [900, 0.05, 0.07]]); },
    mature: function () { blip('sine', 0.25, [[784, 0, 0.1], [1046.5, 0.08, 0.1], [1568, 0.16, 0.25]]); }
  };
  function sfx(kind) { if (SFX[kind]) SFX[kind](); }

  // 페이지를 한 번 클릭해 두면 오디오가 활성화됨
  document.addEventListener('pointerdown', ensureAudio);

  // ---------------- 회전 ----------------
  var rotation = 0;
  var spinning = false;

  function setRotation(r) {
    rotation = r || 0;
    wheel.setAttribute('transform', 'rotate(' + rotation + ' ' + CX + ' ' + CY + ')');
  }

  var flashTimer = null;
  var FLASH_MS = 1920;   // style.css의 winFlash (0.32s × 6회)
  /** 포인터 아래 칸을 깜빡임 (그 칸이 num이 아니면 num 칸 중 첫 번째) */
  function flash(num) {
    clearTimeout(flashTimer);
    segEls.forEach(function (s) { s.classList.remove('win'); });
    var k = segmentAtPointer(rotation);
    if (ORDER[k] !== num) k = ORDER.indexOf(num);
    var s = segEls[k];
    if (!s) return;
    void s.getBoundingClientRect();
    s.classList.add('win');
    flashTimer = setTimeout(function () { s.classList.remove('win'); }, 2100);
  }

  /** target 숫자에 멈추도록 회전. 끝나면 onDone(멈춘 숫자) 호출 */
  function spinTo(target, onDone) {
    if (spinning) return false;
    spinning = true;
    segEls.forEach(function (s) { s.classList.remove('win'); });

    var plan = planSpin(rotation, target);
    var start = rotation, end = plan.finalRotation, dur = plan.duration, ease = plan.ease;
    var t0 = null;
    var lastSeg = segmentAtPointer(start);

    function frame(ts) {
      if (t0 === null) t0 = ts;
      var p = Math.min((ts - t0) / dur, 1);
      var r = start + (end - start) * ease(p);
      wheel.setAttribute('transform', 'rotate(' + r + ' ' + CX + ' ' + CY + ')');
      var seg = segmentAtPointer(r);
      if (seg !== lastSeg) { playTick(); lastSeg = seg; }
      if (p < 1) {
        requestAnimationFrame(frame);
      } else {
        setRotation(end);
        var num = numberAtPointer(rotation);
        flash(num);
        playWin();
        spinning = false;
        if (onDone) onDone(num);
      }
    }
    requestAnimationFrame(frame);
    return true;
  }

  window.Roulette = {
    spinTo: spinTo,
    setRotation: setRotation,
    getRotation: function () { return rotation; },
    isSpinning: function () { return spinning; },
    ensureAudio: ensureAudio,
    sfx: sfx,
    FLASH_MS: FLASH_MS,
    flash: flash,
    clearFlash: function () { clearTimeout(flashTimer); segEls.forEach(function (s) { s.classList.remove('win'); }); }
  };
})();
