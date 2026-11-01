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
    history.push(prevJSON || JSON.stringify(state));
    if (history.length > MAX_HISTORY) history.shift();
    state = newState;
    save();
    render();
  }
  function undo() {
    if (W.isSpinning() || !history.length) return;
    state = G.normalizeState(JSON.parse(history.pop()));
    save();
    W.setRotation(state.rotation || 0);
    render();
  }
  function resetGame() {
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
    state.teams.forEach(function (t, i) { rows.appendChild(renderRow(t, i)); });

    var btn = $('primaryBtn');
    btn.hidden = false;
    btn.disabled = false;
    $('hint').textContent = '';
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
  var BREAK_MSG = '베팅하면 적금이 해지되고 보너스를 받을 수 없어요. 계속할까요?';

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

  function renderRow(t, i) {
    var p = state.phase;
    var row = h('div', 'row');
    row.dataset.idx = i;

    row.appendChild(h('div', 'c-name', t.name));

    var coins = h('div', 'c-coins');
    coins.appendChild(h('span', 'coin-num', String(t.coins)));
    if (t.broken > 0) coins.appendChild(h('small', 'held', '보관 적금 ' + t.broken));
    row.appendChild(coins);

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
        if (t.last.win) row.classList.add('winner');
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
        if (m === 'bet' && t.plan && !window.confirm(BREAK_MSG)) return;
        G.setMode(t, m);
        var fresh = renderRow(t, Number(row.dataset.idx));
        row.replaceWith(fresh);
        save();
        updateBetValidity();
        var first = fresh.querySelector('.mode-inputs select, .mode-inputs input');
        if (first && m === 'bet') first.focus();
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
      sav.addEventListener('change', function () { t.bet.saving = parseInt(sav.value, 10) || 0; onBetEdit(row, t); });
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
      commit(next, before);
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
