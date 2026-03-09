const test = require('node:test');
const assert = require('node:assert/strict');
const games = require('./games');

test('tttWinner detects row win', () => {
  const b = ['X', 'X', 'X', null, null, null, null, null, null];
  const out = games.tttWinner(b);
  assert.equal(out.winner, 'X');
  assert.deepEqual(out.winningLine, [0, 1, 2]);
});

test('tttWinner detects draw', () => {
  const b = ['X','O','X','X','O','O','O','X','X'];
  const out = games.tttWinner(b);
  assert.equal(out.winner, 'DRAW');
});

test('tttMove enforces turns and roles', () => {
  const s = games.createTttState();
  games.tttAssignRole(s, 'p1');
  games.tttAssignRole(s, 'p2');

  let res = games.tttMove(s, 'p2', 0);
  assert.equal(res.ok, false);

  res = games.tttMove(s, 'p1', 0);
  assert.equal(res.ok, true);

  res = games.tttMove(s, 'p1', 1);
  assert.equal(res.ok, false);
});

test('pollVote counts votes correctly', () => {
  const poll = games.createPollState('Q', ['A', 'B', 'C'], 'host');
  games.pollVote(poll, 'u1', 0);
  games.pollVote(poll, 'u2', 2);
  games.pollVote(poll, 'u3', 2);
  assert.deepEqual(games.pollResults(poll), [1, 0, 2]);
});

