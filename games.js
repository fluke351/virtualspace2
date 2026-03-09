function createTttState() {
  return {
    board: Array(9).fill(null),
    xPlayerId: null,
    oPlayerId: null,
    next: 'X',
    winner: null,
    winningLine: null,
  };
}

function tttRoleForPlayer(ttt, playerId) {
  if (ttt.xPlayerId === playerId) return 'X';
  if (ttt.oPlayerId === playerId) return 'O';
  return null;
}

function tttAssignRole(ttt, playerId) {
  const existing = tttRoleForPlayer(ttt, playerId);
  if (existing) return existing;
  if (!ttt.xPlayerId) {
    ttt.xPlayerId = playerId;
    return 'X';
  }
  if (!ttt.oPlayerId) {
    ttt.oPlayerId = playerId;
    return 'O';
  }
  return null;
}

function tttWinner(board) {
  const lines = [
    [0, 1, 2],
    [3, 4, 5],
    [6, 7, 8],
    [0, 3, 6],
    [1, 4, 7],
    [2, 5, 8],
    [0, 4, 8],
    [2, 4, 6],
  ];
  for (const [a, b, c] of lines) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return { winner: board[a], winningLine: [a, b, c] };
    }
  }
  if (board.every(Boolean)) return { winner: 'DRAW', winningLine: null };
  return { winner: null, winningLine: null };
}

function tttMove(ttt, playerId, index) {
  if (!Number.isInteger(index) || index < 0 || index > 8) {
    return { ok: false, error: 'ตำแหน่งไม่ถูกต้อง' };
  }
  if (ttt.winner) return { ok: false, error: 'เกมจบแล้ว' };
  if (ttt.board[index]) return { ok: false, error: 'ช่องนี้ถูกเล่นแล้ว' };

  const role = tttRoleForPlayer(ttt, playerId);
  if (!role) return { ok: false, error: 'คุณเป็นผู้ชม' };
  if (ttt.next !== role) return { ok: false, error: 'ยังไม่ถึงตาคุณ' };

  ttt.board[index] = role;
  const outcome = tttWinner(ttt.board);
  ttt.winner = outcome.winner;
  ttt.winningLine = outcome.winningLine;
  if (!ttt.winner) ttt.next = role === 'X' ? 'O' : 'X';
  return { ok: true };
}

function tttReset(ttt) {
  const x = ttt.xPlayerId;
  const o = ttt.oPlayerId;
  const next = ttt.next;
  const resetTo = createTttState();
  resetTo.xPlayerId = x;
  resetTo.oPlayerId = o;
  resetTo.next = next === 'X' || next === 'O' ? next : 'X';
  return resetTo;
}

function createPollState(question, options, creatorId) {
  return {
    question,
    options,
    creatorId,
    open: true,
    votesByPlayerId: {},
  };
}

function pollVote(poll, voterId, optionIndex) {
  if (!poll || !poll.open) return { ok: false, error: 'ยังไม่มีโพลหรือโพลปิดแล้ว' };
  if (!Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex >= poll.options.length) {
    return { ok: false, error: 'ตัวเลือกไม่ถูกต้อง' };
  }
  poll.votesByPlayerId[voterId] = optionIndex;
  return { ok: true };
}

function pollResults(poll) {
  const counts = Array(poll.options.length).fill(0);
  for (const k of Object.keys(poll.votesByPlayerId)) {
    const idx = poll.votesByPlayerId[k];
    if (Number.isInteger(idx) && idx >= 0 && idx < counts.length) counts[idx] += 1;
  }
  return counts;
}

module.exports = {
  createTttState,
  tttAssignRole,
  tttMove,
  tttReset,
  tttWinner,
  createPollState,
  pollVote,
  pollResults,
};

