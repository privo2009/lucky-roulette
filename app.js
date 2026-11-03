/*
 * 수업 진행 화면: 설정 → (베팅 입력 → 룰렛 → 정산) × 라운드 → 종료
 * 진행 상황은 localStorage에 저장되어 새로고침해도 유지됨.
 */
(function () {
  'use strict';

  var G = window.Game, W = window.Roulette;
  var KEY = 'luckyRoulette.state.v1';
  var HKEY = 'luckyRoulette.history.v1';
  var MAX_HISTORY = 80;

  var state, history;

  function $(id) { return document.getElementById(id); }
  function h(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }
  function signed(n) { return (n > 0 ? '+' : n < 0 ? '−' : '±') + Math.abs(n); }

  // ---------------- 저장 / 되돌리기 ----------------
  function load() {
    try { state = JSON.parse(localStorage.getItem(KEY)); } catch (e) { state = null; }
    try { history = JSON.parse(localStorage.getItem(HKEY)) || []; } catch (e) { history = []; }
    if (!state || !state.phase) { state = G.initialState(); history = []; }
    G.normalizeState(state);
  }
  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
      localStorage.setItem(HKEY, JSON.stringify(history));
    } catch (e) { /* 저장 실패 시에도 진행은 계속 */ }
  }
  function commit(newState, prevJSON) {
    if (anim && newState.phase !== 'result') cancelAnim();
    history.push(prevJSON || JSON.stringify(state));
    if (history.length > MAX_HISTORY) history.shift();
    state = newState;
    save();
    render();
  }
  function undo() {
    if (W.isSpinning() || !history.length) return;
    cancelAnim();
    state = G.normalizeState(JSON.parse(history.pop()));
    save();
    W.setRotation(state.rotation || 0);
    render();
  }
  function resetGame() {
    cancelAnim();
    var settings = state.settings || G.defaultSettings();
    state = G.initialState(settings);
    state.rotation = W.getRotation();
    history = [];
    save();
    render();
  }

  // ---------------- 화면 그리기 ----------------
  function render() {
    var p = state.phase;
    document.body.dataset.phase = p;
    $('setup').hidden = p !== 'setup';
    $('end').hidden = p !== 'end';

    $('resultNum').textContent = (p === 'result' || p === 'end') && state.lastResult ? state.lastResult : '?';

    if (p === 'setup' || p === 'bet') W.clearFlash();
    if (p === 'setup') { renderSetup(); renderBoardEmpty(); return; }
    renderBoard();
    if (p === 'end') renderEnd();
  }

  function renderBoardEmpty() {
    $('roundBadge').textContent = '게임 준비';
    $('phaseLabel').textContent = '';
    $('feeBox').hidden = true;
    $('rows').innerHTML = '';
    $('primaryBtn').hidden = true;
    $('hint').textContent = '';
    $('undoBtn').disabled = true;
  }

  function renderBoard() {
    var p = state.phase;
    $('roundBadge').innerHTML = '';
    $('roundBadge').appendChild(h('b', null, String(state.round)));
    $('roundBadge').appendChild(document.createTextNode(' / ' + state.totalRounds + ' 라운드'));
    $('phaseLabel').textContent = {
      bet: '① 베팅 입력', spin: '② 베팅 마감 · 룰렛!', result: '③ 정산 결과', end: '게임 종료'
    }[p] || '';
    $('phaseLabel').className = 'phase-label ' + p;

    var feeOn = G.feeApplies(state.round);
    $('feeBox').hidden = !feeOn;
    if (feeOn) renderFeeTable();

    $('lastColLabel').textContent = p === 'bet' ? '확인' : p === 'spin' ? '' : '증감';

    var rows = $('rows');
    rows.innerHTML = '';
    var n = state.teams.length;
    rows.style.setProperty('--s', n <= 6 ? 1 : n <= 8 ? 0.85 : 0.72);
    var pending = !!anim && p === 'result';
    var order = state.teams.map(function (t, i) { return i; });
    if ((p === 'result' || p === 'end') && !pending) order = rankOrder();
    order.forEach(function (i) { rows.appendChild(renderRow(state.teams[i], i, pending)); });

    var btn = $('primaryBtn');
    btn.hidden = false;
    btn.disabled = pending;
    $('hint').textContent = pending ? 'Space·Enter 건너뛰기' : '';
    $('hint').classList.toggle('soft', pending);
    if (p === 'bet') {
      btn.textContent = '베팅 마감';
      updateBetValidity();
    } else if (p === 'spin') {
      btn.hidden = true;
    } else if (p === 'result') {
      btn.textContent = state.round >= state.totalRounds ? '최종 결과 보기' : '다음 라운드 ▶';
    } else {
      btn.hidden = true;
    }
    $('undoBtn').disabled = history.length === 0;
  }

  function renderFeeTable() {
    var box = $('feeTable');
    box.innerHTML = '';
    var lo = 1;
    G.FEE_TABLE.forEach(function (row) {
      var range = row[0] === Infinity ? lo + '~' : lo + '~' + row[0];
      var chip = h('span', 'fee-chip');
      chip.appendChild(h('span', null, range));
      chip.appendChild(h('b', null, String(row[1])));
      box.appendChild(chip);
      lo = row[0] + 1;
    });
  }

  function planText(plan) {
    return plan ? plan.amount + '코인 × ' + plan.count + '/' + G.SAVING_ROUNDS + '회' : '없음';
  }

  var MODE_LABEL = { bet: '베팅', save: '적금', rest: '쉬기' };

  // ---------------- 적금 해지 확인 모달 ----------------
  var modalCb = null;
  function modalOpen() { return !$('breakModal').hidden; }
  function askBreak(team, onOk, onCancel) {
    $('breakMsg').textContent = team.name + '의 적금이 해지되고 보너스를 받을 수 없어요. 계속할까요?';
    modalCb = { ok: onOk, cancel: onCancel };
    $('breakModal').hidden = false;
    $('breakCancel').focus();
  }
  function closeModal(ok) {
    var cb = modalCb;
    modalCb = null;
    $('breakModal').hidden = true;
    var fn = cb && (ok ? cb.ok : cb.cancel);
    if (fn) fn();
  }
  $('breakOk').addEventListener('click', function () { closeModal(true); });
  $('breakCancel').addEventListener('click', function () { closeModal(false); });
  $('breakModal').addEventListener('pointerdown', function (e) { if (e.target === this) closeModal(false); });

  /** 이 선택이 진행 중인 적금을 깨는지 (금액 미선택 상태는 아직 해지로 보지 않음) */
  function breaksPlan(plan, bet) {
    if (!plan) return false;
    if (bet.mode === 'save' && !bet.saving) return false;
    return G.savingWillBreak({ plan: plan, bet: bet });
  }
  /** 적금이 새로 깨지는 변경이면 모달로 확인 후 apply, 취소하면 revert */
  function guardBreak(t, nextBet, apply, revert) {
    if (!breaksPlan(t.plan, t.bet) && breaksPlan(t.plan, nextBet)) {
      askBreak(t, apply, revert);
    } else {
      apply();
    }
  }

  /** 진행/결과 화면용 "이번 라운드" 표시 */
  function actionView(t, cell) {
    var b = t.bet, r = t.last;
    var mode = r ? r.mode : b.mode;
    if (mode === 'bet') {
      cell.appendChild(h('span', 'act act-bet', '🎲 ' + (r ? r.num : b.num) + '번 / ' + (r ? r.bet : b.amount) + '코인'));
    } else if (mode === 'save') {
      var amt = r ? r.saving : b.saving;
      var cnt = r ? r.savingCount : (t.plan && t.plan.amount === amt ? t.plan.count + 1 : 1);
      cell.appendChild(h('span', 'act act-save', '💰 적금 ' + amt + '코인 (' + cnt + '/' + G.SAVING_ROUNDS + '회)'));
    } else {
      cell.appendChild(h('span', 'act act-rest', '😴 쉬기'));
    }
  }

  /** 정산 화면 표시 순서: 보유 코인 많은 순 (같으면 원래 순서) */
  function rankOrder() {
    return state.teams.map(function (t, i) { return i; }).sort(function (a, b) {
      return (state.teams[b].coins - state.teams[a].coins) || (a - b);
    });
  }

  function setBankrupt(row, on) {
    row.classList.toggle('bankrupt', on);
    var tag = row.querySelector('.bankrupt-tag');
    if (on && !tag) row.querySelector('.c-coins').appendChild(h('span', 'bankrupt-tag', '파산'));
    if (!on && tag) tag.remove();
  }

  /** pending: 정산 연출 전 상태 (이전 코인 표시, 결과 칸 숨김) */
  function renderRow(t, i, pending) {
    var p = state.phase;
    var row = h('div', 'row' + (pending ? ' pending' : ''));
    row.dataset.idx = i;

    row.appendChild(h('div', 'c-name', t.name));

    var shownCoins = pending && t.last ? t.coins - t.last.delta : t.coins;
    var coins = h('div', 'c-coins');
    coins.appendChild(h('span', 'coin-num', String(shownCoins)));
    if (t.broken > 0) coins.appendChild(h('small', 'held', '보관 적금 ' + t.broken));
    row.appendChild(coins);
    setBankrupt(row, shownCoins === 0);

    var actCell = h('div', 'c-act');
    var saveCell = h('div', 'c-save');
    var lastCell = h('div', 'c-last');

    if (p === 'bet') {
      buildBetInputs(t, row, actCell);
      saveCell.appendChild(h('span', 'save-main', planText(t.plan)));
      saveCell.appendChild(h('small', 'save-status'));
    } else {
      actionView(t, actCell);
      if (p === 'spin') {
        saveCell.appendChild(h('span', 'save-main', planText(t.plan)));
        if (G.savingWillBreak(t)) saveCell.appendChild(h('small', 'save-sub bad', '이번 라운드에 해지'));
      } else {
        var r = t.last || {};
        if (r.matured) {
          saveCell.appendChild(h('span', 'save-main good', '만기! +' + r.matured));
          saveCell.appendChild(h('small', 'save-sub', '원금 ' + (r.matured - r.bonus) + ' + 보너스 ' + r.bonus));
        } else {
          saveCell.appendChild(h('span', 'save-main', planText(t.plan)));
        }
        if (r.brokenAmount) saveCell.appendChild(h('small', 'save-sub bad', '적금 해지 · 원금 ' + r.brokenAmount + ' 보관'));
      }
      if ((p === 'result' || p === 'end') && t.last) {
        var d = t.last.delta;
        lastCell.appendChild(h('span', 'delta ' + (d > 0 ? 'up' : d < 0 ? 'down' : 'zero'), signed(d)));
        var note = [];
        if (t.last.mode === 'bet') {
          if (t.last.win) note.push('당첨 +' + t.last.gross + (t.last.fee ? ' (수수료 −' + t.last.fee + ')' : ''));
          else note.push('낙첨 −' + t.last.bet);
        } else if (t.last.mode === 'save') {
          note.push('적금 납입 −' + t.last.saving);
        }
        note.forEach(function (x) { lastCell.appendChild(h('small', 'delta-note', x)); });
        if (t.last.win && !pending) row.classList.add('winner');
      }
    }

    row.appendChild(actCell);
    row.appendChild(saveCell);
    row.appendChild(lastCell);
    if (p === 'bet') updateRowStatus(row, t);
    return row;
  }

  function buildBetInputs(t, row, cell) {
    var tabs = h('div', 'mode-tabs');
    G.MODES.forEach(function (m) {
      var btn = h('button', 'mode-btn mode-' + m + (t.bet.mode === m ? ' active' : ''), MODE_LABEL[m]);
      btn.type = 'button';
      btn.addEventListener('click', function () {
        btn.blur();
        if (t.bet.mode === m) return;
        var next = { mode: m, num: 0, amount: 0, saving: m === 'save' && t.plan ? t.plan.amount : 0 };
        guardBreak(t, next, function () {
          G.setMode(t, m);
          var fresh = renderRow(t, Number(row.dataset.idx));
          row.replaceWith(fresh);
          save();
          updateBetValidity();
          var first = fresh.querySelector('.mode-inputs select, .mode-inputs input');
          if (first && m === 'bet') first.focus();
        });
      });
      tabs.appendChild(btn);
    });
    cell.appendChild(tabs);

    var box = h('div', 'mode-inputs');
    if (t.bet.mode === 'bet') {
      var num = h('select', 'in-num');
      num.appendChild(new Option('번호', '0'));
      for (var k = 1; k <= 8; k++) num.appendChild(new Option(k + '번', String(k)));
      num.value = String(t.bet.num || 0);
      var amt = h('input', 'in-amt');
      amt.type = 'number'; amt.min = '1'; amt.step = '1'; amt.inputMode = 'numeric';
      amt.placeholder = '금액';
      amt.value = t.bet.amount ? String(t.bet.amount) : '';
      num.addEventListener('change', function () { t.bet.num = parseInt(num.value, 10) || 0; onBetEdit(row, t); });
      amt.addEventListener('input', function () {
        var v = amt.value.trim();
        t.bet.amount = v === '' ? 0 : Number(v);
        onBetEdit(row, t);
      });
      box.appendChild(num);
      box.appendChild(amt);
    } else if (t.bet.mode === 'save') {
      var sav = h('select', 'in-save');
      sav.appendChild(new Option('금액', '0'));
      G.SAVING_OPTIONS.forEach(function (a) { sav.appendChild(new Option(a + '코인', String(a))); });
      sav.value = String(t.bet.saving || 0);
      sav.addEventListener('change', function () {
        var v = parseInt(sav.value, 10) || 0;
        var prev = t.bet.saving;
        guardBreak(t, { mode: 'save', num: 0, amount: 0, saving: v }, function () {
          t.bet.saving = v;
          onBetEdit(row, t);
        }, function () {
          sav.value = String(prev || 0);
        });
      });
      box.appendChild(sav);
    } else {
      box.appendChild(h('span', 'muted', '이번 라운드 쉬기'));
    }
    cell.appendChild(box);
  }

  function onBetEdit(row, t) {
    save();
    updateRowStatus(row, t);
    updateBetValidity();
  }

  function updateRowStatus(row, t) {
    var status = row.querySelector('.save-status');
    var last = row.querySelector('.c-last');
    var b = t.bet;
    status.className = 'save-status';
    var txt = '';
    if (t.plan && G.savingWillBreak(t)) {
      txt = b.mode === 'save' ? '⚠ 금액 변경 → 해지' : b.mode === 'bet' ? '⚠ 베팅 → 해지' : '⚠ 쉬면 해지';
      status.classList.add('bad');
    } else if (t.plan) {
      txt = t.plan.count + 1 >= G.SAVING_ROUNDS ? '→ 이번에 만기!' : '→ ' + (t.plan.count + 1) + '회차';
    } else if (b.mode === 'save') {
      txt = '새 적금 시작';
    }
    status.textContent = txt;

    last.innerHTML = '';
    var err = G.validateBet(t);
    row.classList.toggle('invalid', !!err);
    if (err) {
      last.appendChild(h('span', 'err', err));
    } else {
      last.appendChild(h('span', 'ok', '남는 코인 ' + (t.coins - b.amount - b.saving)));
    }
  }

  function updateBetValidity() {
    var ok = G.allValid(state);
    $('primaryBtn').disabled = !ok;
    $('hint').textContent = ok ? '' : '빨간 칸을 확인하세요';
  }

  // ---------------- 정산 결과 연출 ----------------
  var START_DELAY = 500;   // 당첨 칸 깜빡임이 끝난 뒤 대기
  var STEP = 350;          // 모둠 간 간격
  var ROLL_MS = 600;       // 코인 숫자 롤링
  var FEE_DELAY = 380;     // 당첨 숫자 뒤 수수료 숫자
  var FLOAT_MS = 900;      // 떠오르는 숫자 지속 시간
  var FLIP_MS = 500;       // 재정렬

  var anim = null;         // 연출 중이면 { timers: [] }

  function later(ms, fn) {
    var a = anim;
    a.timers.push(setTimeout(function () { if (anim === a) fn(); }, ms));
  }
  function cancelAnim() {
    if (!anim) return;
    anim.timers.forEach(clearTimeout);
    anim = null;
  }
  function skipAnim() {
    cancelAnim();
    render();
  }

  function rollNumber(el, from, to, ms) {
    var a = anim, t0 = null;
    if (from === to) { el.textContent = String(to); return; }
    function step(ts) {
      if (anim !== a) return;
      if (t0 === null) t0 = ts;
      var k = Math.min((ts - t0) / ms, 1);
      var e = 1 - Math.pow(1 - k, 3);
      el.textContent = String(Math.round(from + (to - from) * e));
      if (k < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  function floatText(row, text, kind) {
    var f = h('span', 'float ' + kind, text);
    f.style.animationDuration = FLOAT_MS + 'ms';
    row.querySelector('.c-coins').appendChild(f);
    f.addEventListener('animationend', function () { f.remove(); });
  }

  function fx(row, cls) {
    row.classList.remove(cls);
    void row.offsetWidth;
    row.classList.add(cls);
  }

  /** 한 모둠 결과 공개 (걸리는 시간은 revealDuration) */
  function revealRow(row, t) {
    var r = t.last;
    var before = t.coins - r.delta;
    row.classList.remove('pending');
    rollNumber(row.querySelector('.coin-num'), before, t.coins, ROLL_MS);

    if (r.mode === 'bet' && r.win) {
      row.classList.add('winner');
      fx(row, 'fx-win');
      floatText(row, '+' + r.gross, 'up');
      W.sfx('win');
      if (r.fee) {
        later(FEE_DELAY, function () { floatText(row, '−' + r.fee + ' 수수료', 'fee'); W.sfx('fee'); });
      }
    } else if (r.mode === 'bet') {
      fx(row, 'fx-lose');
      floatText(row, '−' + r.bet, 'down');
      W.sfx('lose');
    } else if (r.matured) {
      fx(row, 'fx-mature');
      floatText(row, '💰 만기 +' + r.matured, 'gold');
      W.sfx('mature');
    } else {
      fx(row, 'fx-soft');
    }
    later(ROLL_MS, function () { setBankrupt(row, t.coins === 0); });
  }

  /** FLIP: 현재 위치 기록 → 새 순서로 DOM 재배치 → 이전 위치에서 새 위치로 이동 */
  function flipReorder(done) {
    var rows = $('rows');
    var els = Array.prototype.slice.call(rows.children);
    var first = els.map(function (el) { return el.getBoundingClientRect().top; });
    els.forEach(function (el) { el.classList.remove('fx-win', 'fx-lose', 'fx-mature', 'fx-soft'); });
    var byIdx = {};
    els.forEach(function (el) { byIdx[el.dataset.idx] = el; });
    rankOrder().forEach(function (i) { rows.appendChild(byIdx[i]); });
    var moved = false;
    els.forEach(function (el, k) {
      var dy = first[k] - el.getBoundingClientRect().top;
      if (Math.abs(dy) < 1) return;
      moved = true;
      el.style.transition = 'none';
      el.style.transform = 'translateY(' + dy + 'px)';
    });
    if (!moved) { done(); return; }
    void rows.offsetWidth;
    els.forEach(function (el) {
      if (!el.style.transform) return;
      el.style.transition = 'transform ' + FLIP_MS + 'ms cubic-bezier(.2,.8,.2,1)';
      el.style.transform = '';
    });
    later(FLIP_MS + 30, done);
  }

  /** 룰렛 정지 직후 호출: state는 이미 정산된 상태 */
  function startResultAnim() {
    cancelAnim();
    anim = { timers: [] };
  }
  function runResultAnim() {
    later(W.FLASH_MS + START_DELAY, function () {
      var rowEls = Array.prototype.slice.call($('rows').children);
      var end = 0;
      rowEls.forEach(function (row, k) {
        var t = state.teams[Number(row.dataset.idx)];
        var at = k * STEP;
        later(at, function () { revealRow(row, t); });
        end = Math.max(end, at + revealDuration(t));
      });
      later(end, function () {
        flipReorder(function () { anim = null; render(); });
      });
    });
  }
  function revealDuration(t) {
    var r = t.last;
    if (r.mode === 'bet' && r.win && r.fee) return FEE_DELAY + FLOAT_MS;
    if (r.mode === 'bet' || r.matured) return FLOAT_MS;
    return ROLL_MS;
  }

  // ---------------- 설정 화면 ----------------
  function renderSetup() {
    var s = state.settings || G.defaultSettings();
    $('setTeams').value = s.teamCount;
    $('setRounds').value = s.rounds;
    $('setCoins').value = s.startCoins;
    renderNameInputs(s.teamCount, s.names);
  }
  function currentNames() {
    return Array.prototype.map.call($('nameGrid').querySelectorAll('input'), function (x) { return x.value; });
  }
  function renderNameInputs(n, names) {
    var grid = $('nameGrid');
    grid.innerHTML = '';
    for (var i = 0; i < n; i++) {
      var inp = h('input');
      inp.type = 'text';
      inp.maxLength = 12;
      inp.placeholder = G.defaultName(i);
      inp.value = names[i] && names[i] !== G.defaultName(i) ? names[i] : '';
      grid.appendChild(inp);
    }
  }
  function clampInt(v, lo, hi, def) {
    v = parseInt(v, 10);
    if (isNaN(v)) return def;
    return Math.max(lo, Math.min(hi, v));
  }
  $('setTeams').addEventListener('input', function () {
    var n = clampInt(this.value, 2, 10, 6);
    renderNameInputs(n, currentNames());
  });
  $('setupForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var n = clampInt($('setTeams').value, 2, 10, 6);
    var settings = {
      teamCount: n,
      rounds: clampInt($('setRounds').value, 1, 30, 10),
      startCoins: clampInt($('setCoins').value, 1, 1000, 20),
      names: currentNames().slice(0, n).map(function (x, i) { return x.trim() || G.defaultName(i); })
    };
    if (document.activeElement) document.activeElement.blur();
    commit(G.newGame(settings, W.getRotation()));
  });

  // ---------------- 종료 화면 ----------------
  function renderEnd() {
    var list = G.standings(state);
    var ol = $('ranking');
    ol.innerHTML = '';
    list.forEach(function (x) {
      var li = h('li', 'rank-' + x.rank);
      li.appendChild(h('span', 'rk', x.rank + '위'));
      li.appendChild(h('span', 'nm', x.name));
      var tot = h('span', 'tot', x.total + ' 코인');
      li.appendChild(tot);
      li.appendChild(h('small', 'brk', x.returned ? '보유 ' + x.coins + ' + 적금 반환 ' + x.returned : ''));
      ol.appendChild(li);
    });

    var sm = G.summary(state);
    var stats = $('statList');
    stats.innerHTML = '';
    [
      ['전체 모둠이 베팅한 총액', sm.totalBet],
      ['당첨으로 돌려받은 총액', sm.grossPayout],
      ['수수료로 나간 총액', sm.fees],
      ['당첨 횟수', sm.winCount + ' / ' + sm.betCount + '번']
    ].forEach(function (r) {
      var d = h('div', 'stat');
      d.appendChild(h('span', null, r[0]));
      d.appendChild(h('b', null, String(r[1])));
      stats.appendChild(d);
    });
    $('casinoNum').textContent = sm.casinoTake + ' 코인';

    var cmp = $('savingCompare');
    cmp.innerHTML = '';
    var avg = list.reduce(function (a, x) { return a + x.total; }, 0) / list.length;
    sm.savingsOnly.forEach(function (s) {
      var d = h('div', 'cmp');
      d.appendChild(h('span', null, '매 라운드 ' + s.amount + '씩 적금'));
      d.appendChild(h('b', null, '→ ' + s.final + ' 코인'));
      cmp.appendChild(d);
    });
    var ref = h('div', 'cmp ref');
    ref.appendChild(h('span', null, '우리 반 모둠 평균 (시작 ' + state.startCoins + ')'));
    ref.appendChild(h('b', null, (Math.round(avg * 10) / 10) + ' 코인'));
    cmp.appendChild(ref);
  }

  // ---------------- 버튼 ----------------
  $('primaryBtn').addEventListener('click', function () {
    if (W.isSpinning()) return;
    if (state.phase === 'bet') {
      if (!G.allValid(state)) return;
      this.blur();
      commit(G.closeBets(state));
    } else if (state.phase === 'result') {
      this.blur();
      commit(G.nextRound(state));
    }
  });
  $('undoBtn').addEventListener('click', function () { this.blur(); undo(); });
  $('endUndoBtn').addEventListener('click', function () { this.blur(); undo(); });

  function armReset(btn) {
    var label = btn.textContent;
    var timer = null;
    btn.addEventListener('click', function () {
      if (W.isSpinning()) return;
      if (!btn.classList.contains('armed')) {
        btn.classList.add('armed');
        btn.textContent = '정말? 한 번 더 클릭';
        timer = setTimeout(function () { btn.classList.remove('armed'); btn.textContent = label; }, 4000);
        return;
      }
      clearTimeout(timer);
      btn.classList.remove('armed');
      btn.textContent = label;
      if (window.confirm('모든 모둠의 진행 기록이 삭제됩니다.\n정말 게임을 초기화할까요?')) resetGame();
    });
  }
  armReset($('resetBtn'));
  armReset($('endResetBtn'));

  // ---------------- 키보드 ----------------
  function digitFromEvent(e) {
    var m = /^(?:Digit|Numpad)([1-8])$/.exec(e.code || '');
    if (m) return parseInt(m[1], 10);
    if (/^[1-8]$/.test(e.key)) return parseInt(e.key, 10);
    return 0;
  }
  function isTyping(t) {
    return t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
  }
  function toggleFullscreen() {
    var d = document;
    if (!(d.fullscreenElement || d.webkitFullscreenElement)) {
      var root = d.documentElement;
      var fn = root.requestFullscreen || root.webkitRequestFullscreen;
      if (fn) fn.call(root);
    } else {
      var ex = d.exitFullscreen || d.webkitExitFullscreen;
      if (ex) ex.call(d);
    }
  }

  document.addEventListener('keydown', function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    W.ensureAudio();
    if (modalOpen()) {
      if (e.key === 'Escape') { e.preventDefault(); closeModal(false); }
      else if (e.key === 'Tab') {
        e.preventDefault();
        ($('breakOk') === document.activeElement ? $('breakCancel') : $('breakOk')).focus();
      }
      return;   // Enter/Space는 포커스된 버튼이 처리
    }
    if (anim && (e.code === 'Space' || e.key === ' ' || e.key === 'Enter')) {
      e.preventDefault();
      skipAnim();
      return;
    }
    if (isTyping(e.target)) return;   // 입력칸에 타이핑 중이면 단축키 전부 무시

    if (e.code === 'KeyF' || e.key === 'f' || e.key === 'F' || e.key === 'ㄹ') {
      e.preventDefault();
      if (!e.repeat) toggleFullscreen();
      return;
    }

    // 룰렛 키(1~8)는 ② 룰렛 단계에서만 동작
    if (state.phase !== 'spin') return;
    var n = digitFromEvent(e);
    if (!n) return;
    e.preventDefault();
    if (e.repeat || W.isSpinning()) return;

    var before = JSON.stringify(state);
    W.spinTo(n, function (stopped) {
      var next = G.settle(state, stopped);
      next.rotation = W.getRotation();
      startResultAnim();
      commit(next, before);
      runResultAnim();
    });
  });

  document.addEventListener('pointerdown', function () { W.ensureAudio(); });

  // ---------------- 시작 ----------------
  load();
  W.setRotation(state.rotation || 0);
  if (state.phase === 'result' || state.phase === 'end') {
    if (state.lastResult) W.flash(state.lastResult);
  }
  render();
})();
