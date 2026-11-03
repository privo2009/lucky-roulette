/*
 * LUCKY ROULETTE — 룰렛 그리기 / 회전 / 효과음
 *
 * 각도 규칙
 *  - 휠 좌표계: 12시 방향이 0°, 시계 방향으로 증가.
 *  - 숫자 n(1~8) 칸은 휠 좌표 [(n-1)*45°, n*45°] 구간, 중심은 (n-1)*45 + 22.5°.
 *  - 휠 전체를 시계 방향으로 R° 회전시키면, 12시(포인터) 아래에 오는 휠 좌표는 mod(-R, 360).
 */
(function () {
  'use strict';

  var SEGMENTS = 8;
  var SEG_ANGLE = 360 / SEGMENTS;           // 45°
  var EDGE_MARGIN = 5;                      // 칸 경계에서 최소 5° 안쪽에 멈춤
  var MAX_OFFSET = SEG_ANGLE / 2 - EDGE_MARGIN; // 중심에서 ±17.5° 이내
  var CX = 250, CY = 250, R_WHEEL = 212;
  var COLORS = ['#d7263d', '#f46036', '#e3b505', '#1b998b',
                '#2e86de', '#5f27cd', '#c2185b', '#2d7d46'];

  function mod(a, n) { return ((a % n) + n) % n; }

  /** 회전량 R일 때 포인터가 가리키는 숫자(1~8) */
  function numberAtPointer(rotation) {
    return Math.floor(mod(-rotation, 360) / SEG_ANGLE) + 1;
  }

  /**
   * 현재 회전값에서 target 숫자에 멈추기 위한 최종 회전값을 계산.
   * rand: 0~1 난수 함수 (테스트용 주입 가능)
   */
  function planSpin(currentRotation, target, rand) {
    rand = rand || Math.random;
    var offset = (rand() * 2 - 1) * MAX_OFFSET;                  // 칸 안에서 무작위 어긋남
    var wheelAngleAtPointer = (target - 1) * SEG_ANGLE + SEG_ANGLE / 2 + offset;
    var finalMod = mod(-wheelAngleAtPointer, 360);               // 최종 회전값 (mod 360)
    var delta = mod(finalMod - mod(currentRotation, 360), 360);  // 0 ~ 360
    var turns = 5 + Math.floor(rand() * 2);                      // 5 또는 6 바퀴 + delta → 총 5~7바퀴
    var duration = 5000 + rand() * 1500;                         // 5.0 ~ 6.5초
    return {
      finalRotation: currentRotation + turns * 360 + delta,
      duration: duration,
      offset: offset
    };
  }

  // Node 환경에서 검증용으로 내보내기
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { planSpin: planSpin, numberAtPointer: numberAtPointer, MAX_OFFSET: MAX_OFFSET };
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
    var g = el('g', { 'class': 'seg', 'data-num': i + 1 });
    g.style.setProperty('--seg-color', COLORS[i]);
    g.appendChild(el('path', {
      'class': 'seg-path',
      fill: COLORS[i],
      d: 'M' + CX + ',' + CY + ' L' + p0[0] + ',' + p0[1] +
         ' A' + R_WHEEL + ',' + R_WHEEL + ' 0 0 1 ' + p1[0] + ',' + p1[1] + ' Z'
    }));
    var tp = polar(152, mid);
    var t = el('text', {
      'class': 'seg-label', x: tp[0], y: tp[1],
      transform: 'rotate(' + mid + ' ' + tp[0] + ' ' + tp[1] + ')'
    });
    t.textContent = String(i + 1);
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
  function easeOutQuart(t) { return 1 - Math.pow(1 - t, 4); }

  var flashTimer = null;
  var FLASH_MS = 1920;   // style.css의 winFlash (0.32s × 6회)
  function flash(num) {
    clearTimeout(flashTimer);
    segEls.forEach(function (s) { s.classList.remove('win'); });
    var s = segEls[num - 1];
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
    var start = rotation, end = plan.finalRotation, dur = plan.duration;
    var t0 = null;
    var lastSeg = Math.floor(mod(-start, 360) / SEG_ANGLE);

    function frame(ts) {
      if (t0 === null) t0 = ts;
      var p = Math.min((ts - t0) / dur, 1);
      var r = start + (end - start) * easeOutQuart(p);
      wheel.setAttribute('transform', 'rotate(' + r + ' ' + CX + ' ' + CY + ')');
      var seg = Math.floor(mod(-r, 360) / SEG_ANGLE);
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
