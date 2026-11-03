import test from 'node:test';
import assert from 'node:assert/strict';
import { createMatch, pointTo, positions, currentGame, gameStatus, umpireCall, swapPositions } from '../public/engine.js';

const play = (s, seq) => [...seq].reduce((st, c) => pointTo(st, c), s);

test('3x15: game to 15 with two clear, cap at 21', () => {
  assert.equal(gameStatus('3x15', 15, 13).done, true);
  assert.equal(gameStatus('3x15', 15, 14).done, false);
  assert.equal(gameStatus('3x15', 14, 14).setting, true);
  assert.equal(gameStatus('3x15', 16, 14).done, true);
  assert.equal(gameStatus('3x15', 20, 20).capPoint, true);
  assert.equal(gameStatus('3x15', 21, 20).done, true);
  assert.equal(gameStatus('3x15', 14, 13).gamePointFor, 'A');
});

test('3x21: game to 21, cap at 30', () => {
  assert.equal(gameStatus('3x21', 21, 19).done, true);
  assert.equal(gameStatus('3x21', 21, 20).done, false);
  assert.equal(gameStatus('3x21', 30, 29).done, true);
  assert.equal(gameStatus('3x21', 29, 29).capPoint, true);
});

test('singles: server serves from right on even, left on odd', () => {
  let s = createMatch({ discipline: 'singles' });
  assert.equal(positions(s).court, 'right');
  s = pointTo(s, 'A'); // 1-0 A serving
  assert.equal(positions(s).court, 'left');
  s = pointTo(s, 'B'); // B wins, B serves on 1 -> left
  assert.equal(s.server, 'B');
  assert.deepEqual(s.events, ['service-over']);
  assert.equal(positions(s).court, 'left');
  s = pointTo(s, 'B'); // B 2 -> right
  assert.equal(positions(s).court, 'right');
});

test('doubles: serving side swaps courts, receiving side never moves', () => {
  let s = createMatch({ discipline: 'doubles', players: { A: ['a0', 'a1'], B: ['b0', 'b1'] } });
  let p = positions(s);
  assert.equal(p.server, 0); // a0 in right serves at 0
  assert.equal(p.receiver, 0); // b0 in right receives
  s = pointTo(s, 'A'); // A 1-0: a0 moves to left and serves again
  p = positions(s);
  assert.equal(s.right.A, 1);
  assert.equal(p.court, 'left');
  assert.equal(p.server, 0);
  assert.equal(p.receiver, 1); // b1 is in B's left court
  s = pointTo(s, 'B'); // B 1: no movement, B server is player in B's left court = b1
  p = positions(s);
  assert.equal(s.right.B, 0);
  assert.equal(p.server, 1);
  assert.equal(p.court, 'left');
  s = pointTo(s, 'A'); // A 2: A regains serve, server = player in A's right = a1
  p = positions(s);
  assert.equal(p.court, 'right');
  assert.equal(p.serverSide, 'A');
  assert.equal(p.server, 1);
});

test('3x15: interval at 8, change ends at 8 only in game three', () => {
  let s = createMatch();
  s = play(s, 'AAAAAAA');
  assert.ok(!s.events.includes('interval'));
  s = pointTo(s, 'A');
  assert.ok(s.events.includes('interval'));
  assert.ok(!s.events.includes('change-ends'));
  s = play(s, 'AAAAAAA'); // 15-0
  assert.equal(s.games.length, 2);
  assert.ok(s.events.includes('game'));
  assert.equal(s.leftEnd, 'B');
  s = play(s, 'BBBBBBBBBBBBBBB'); // B takes game 2
  assert.equal(s.games.length, 3);
  assert.equal(s.server, 'B');
  s = play(s, 'BBBBBBB');
  const before = s.leftEnd;
  s = pointTo(s, 'B');
  assert.ok(s.events.includes('change-ends'));
  assert.notEqual(s.leftEnd, before);
});

test('match point and match win', () => {
  let s = createMatch();
  s = play(s, 'AAAAAAAAAAAAAAA');
  s = play(s, 'AAAAAAAAAAAAAA'); // 14-0 in game 2
  assert.ok(s.events.includes('match-point-A'));
  s = pointTo(s, 'A');
  assert.equal(s.winner, 'A');
  assert.equal(umpireCall(s).main.startsWith('Match won'), true);
  assert.equal(pointTo(s, 'B'), s); // no play after match end
});

test('cap: at 20-all the next point wins in 3x15', () => {
  let s = createMatch();
  for (let i = 0; i < 20; i++) s = play(s, 'AB');
  assert.deepEqual([currentGame(s).A, currentGame(s).B], [20, 20]);
  assert.ok(s.events.includes('cap-point'));
  s = pointTo(s, 'B');
  assert.equal(s.games[0].winner, 'B');
});

test('umpire call puts the server score first', () => {
  let s = createMatch();
  s = play(s, 'AAAB'); // B serving 1-3
  assert.equal(umpireCall(s).main, 'Service over, 1–3');
  s = play(s, 'BB');
  assert.equal(umpireCall(s).main, '3 all');
});

test('swap positions only before the first rally of a game', () => {
  let s = createMatch({ discipline: 'doubles' });
  s = swapPositions(s, 'A');
  assert.equal(s.right.A, 1);
  s = pointTo(s, 'A');
  const t = swapPositions(s, 'A');
  assert.equal(t, s);
});
