/*
 * 게임 규칙 / 정산 로직 (화면과 무관한 순수 함수들)
 * 브라우저에서는 window.Game, Node에서는 require('./game.js')로 사용.
 */
(function (root) {
  'use strict';

  var FEE_START_ROUND = 3;
  var SAVING_ROUNDS = 3;
  // [베팅금 상한, 수수료]
  var FEE_TABLE = [[5, 1], [10, 2], [15, 4], [20, 5], [25, 7], [30, 8], [Infinity, 10]];
  var SAVING_BONUS = { 3: 5, 4: 6, 5: 8, 6: 10 };
  var SAVING_OPTIONS = [3, 4, 5, 6];

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function fee(bet) {
    if (!bet || bet <= 0) return 0;
    for (var i = 0; i < FEE_TABLE.length; i++) if (bet <= FEE_TABLE[i][0]) return FEE_TABLE[i][1];
    return 0;
  }
  function feeApplies(round) { return round >= FEE_START_ROUND; }

  function defaultSettings() {
    return { teamCount: 6, names: [], rounds: 10, startCoins: 20 };
  }
  function defaultName(i) { return (i + 1) + '모둠'; }

  function initialState(settings) {
    return { phase: 'setup', settings: settings || defaultSettings(), rotation: 0 };
  }

  function emptyBet(team) {
    return { num: 0, amount: 0, saving: team && team.plan ? team.plan.amount : 0 };
  }

  function newGame(settings, rotation) {
    var teams = [];
    for (var i = 0; i < settings.teamCount; i++) {
      var name = (settings.names[i] || '').trim() || defaultName(i);
      var t = { name: name, coins: settings.startCoins, plan: null, broken: 0, last: null };
      t.bet = emptyBet(t);
      teams.push(t);
    }
    return {
      phase: 'bet',
      settings: clone(settings),
      round: 1,
      totalRounds: settings.rounds,
      startCoins: settings.startCoins,
      teams: teams,
      stats: { totalBet: 0, grossPayout: 0, fees: 0, savingBonus: 0, betCount: 0, winCount: 0 },
      lastResult: null,
      rotation: rotation || 0
    };
  }

  /** 모둠 한 곳의 베팅 입력 검사. 오류 메시지 또는 '' 반환 */
  function validateBet(team) {
    var b = team.bet;
    if (!isInt(b.amount) || b.amount < 0) return '베팅 금액 오류';
    if (b.saving !== 0 && SAVING_OPTIONS.indexOf(b.saving) < 0) return '적금은 3~6만 가능';
    if (b.amount > 0 && !(b.num >= 1 && b.num <= 8)) return '번호를 고르세요';
    if (b.amount + b.saving > team.coins) return '코인 부족';
    return '';
  }
  function isInt(v) { return typeof v === 'number' && isFinite(v) && Math.floor(v) === v; }

  function allValid(state) {
    return state.teams.every(function (t) { return validateBet(t) === ''; });
  }

  /** 이번 납입으로 적금이 깨지는지 (화면 경고용) */
  function savingWillBreak(team) {
    return !!team.plan && team.bet.saving !== team.plan.amount;
  }

  function closeBets(state) {
    var s = clone(state);
    s.phase = 'spin';
    s.teams.forEach(function (t) { if (t.bet.amount === 0) t.bet.num = 0; });
    return s;
  }

  /** 룰렛 결과(1~8)로 라운드 정산 */
  function settle(state, result) {
    var s = clone(state);
    var applyFee = feeApplies(s.round);
    s.lastResult = result;
    s.teams.forEach(function (t) {
      var before = t.coins;
      var bet = t.bet.amount, pay = t.bet.saving;
      var r = { bet: bet, num: t.bet.num, saving: pay, win: false, gross: 0, fee: 0,
                matured: 0, bonus: 0, brokenAmount: 0, delta: 0 };

      t.coins -= bet + pay;

      // 베팅
      if (bet > 0) {
        s.stats.totalBet += bet;
        s.stats.betCount++;
        if (t.bet.num === result) {
          r.win = true;
          r.gross = bet * 2;
          r.fee = applyFee ? fee(bet) : 0;
          t.coins += r.gross - r.fee;
          s.stats.grossPayout += r.gross;
          s.stats.fees += r.fee;
          s.stats.winCount++;
        }
      }

      // 적금
      if (pay > 0) {
        if (t.plan && t.plan.amount === pay) {
          t.plan.count++;
        } else {
          if (t.plan) { r.brokenAmount = t.plan.amount * t.plan.count; t.broken += r.brokenAmount; }
          t.plan = { amount: pay, count: 1 };
        }
        if (t.plan.count >= SAVING_ROUNDS) {
          r.bonus = SAVING_BONUS[pay];
          r.matured = pay * SAVING_ROUNDS + r.bonus;
          t.coins += r.matured;
          s.stats.savingBonus += r.bonus;
          t.plan = null;
        }
      } else if (t.plan) {
        r.brokenAmount = t.plan.amount * t.plan.count;
        t.broken += r.brokenAmount;
        t.plan = null;
      }

      r.delta = t.coins - before;
      t.last = r;
    });
    s.phase = 'result';
    return s;
  }

  function nextRound(state) {
    var s = clone(state);
    if (s.round >= s.totalRounds) {
      s.phase = 'end';
      return s;
    }
    s.round++;
    s.phase = 'bet';
    s.lastResult = null;
    s.teams.forEach(function (t) { t.last = null; t.bet = emptyBet(t); });
    return s;
  }

  /** 게임 종료 시 돌려받는 적금 원금(깨진 적금 + 만기 전 진행 중 적금) */
  function returnedSavings(team) {
    return team.broken + (team.plan ? team.plan.amount * team.plan.count : 0);
  }

  function standings(state) {
    var list = state.teams.map(function (t) {
      var ret = returnedSavings(t);
      return { name: t.name, coins: t.coins, returned: ret, total: t.coins + ret };
    });
    list.sort(function (a, b) { return b.total - a.total; });
    var rank = 0, prev = null;
    list.forEach(function (x, i) { if (x.total !== prev) { rank = i + 1; prev = x.total; } x.rank = rank; });
    return list;
  }

  /** 매 라운드 amount씩 적금만 했을 때 최종 코인 */
  function savingsOnlyFinal(startCoins, rounds, amount) {
    var coins = startCoins, count = 0, held = 0;
    for (var r = 1; r <= rounds; r++) {
      if (coins >= amount) {
        coins -= amount; count++;
        if (count === SAVING_ROUNDS) { coins += amount * SAVING_ROUNDS + SAVING_BONUS[amount]; count = 0; }
      } else if (count > 0) {
        held += amount * count; count = 0;
      }
    }
    return coins + held + amount * count;
  }

  function summary(state) {
    var st = state.stats;
    var netReturned = st.grossPayout - st.fees;
    return {
      totalBet: st.totalBet,
      grossPayout: st.grossPayout,
      fees: st.fees,
      netReturned: netReturned,
      casinoTake: st.totalBet - netReturned,
      betCount: st.betCount,
      winCount: st.winCount,
      savingBonus: st.savingBonus,
      savingsOnly: SAVING_OPTIONS.map(function (a) {
        return { amount: a, final: savingsOnlyFinal(state.startCoins, state.totalRounds, a) };
      })
    };
  }

  var api = {
    FEE_START_ROUND: FEE_START_ROUND, FEE_TABLE: FEE_TABLE, SAVING_BONUS: SAVING_BONUS,
    SAVING_OPTIONS: SAVING_OPTIONS, SAVING_ROUNDS: SAVING_ROUNDS,
    fee: fee, feeApplies: feeApplies, defaultSettings: defaultSettings, defaultName: defaultName,
    initialState: initialState, newGame: newGame, validateBet: validateBet, allValid: allValid,
    savingWillBreak: savingWillBreak, closeBets: closeBets, settle: settle, nextRound: nextRound,
    returnedSavings: returnedSavings, standings: standings, savingsOnlyFinal: savingsOnlyFinal,
    summary: summary
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Game = api;
})(this);
