import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getMouthOpenness } from '../src/lib/avatar-mouth.ts';

function advance(previous, rms, seconds, fps) {
  let openness = previous;
  for (let frame = 0; frame < seconds * fps; frame++) openness = getMouthOpenness(openness, rms, 1 / fps);
  return openness;
}

test('silent playback and reset signals immediately close the mouth', () => {
  assert.equal(getMouthOpenness(0.6, 0, 1 / 60), 0);
  assert.equal(getMouthOpenness(0.6, 0, 0), 0);
  assert.equal(getMouthOpenness(0, 0.003, 1 / 60), 0, 'background noise does not open the mouth');
  assert.equal(advance(0.6, 0.003, 1, 60), 0, 'low noise releases all the way to closed');
});

test('ordinary speech has a useful dynamic range and loud samples remain below full opening', () => {
  const quiet = advance(0, 0.025, 1, 60);
  const speech = advance(0, 0.09, 1, 60);
  const loud = advance(0, 1, 1, 60);
  assert.ok(quiet > 0.03 && quiet < speech);
  assert.ok(speech > 0.25 && speech < 0.6, 'ordinary speech must not saturate');
  assert.ok(loud > speech && loud <= 0.75);
  assert.equal(getMouthOpenness(0.75, 20, 1), 0.75);
});

test('mouth attack and release are smooth and independent of frame rate', () => {
  const initialOpening = getMouthOpenness(0, 0.1, 1 / 60);
  assert.ok(initialOpening > 0 && initialOpening < 0.3);
  const initialRelease = getMouthOpenness(0.6, 0.003, 1 / 60);
  assert.ok(initialRelease > 0.3 && initialRelease < 0.6);
  for (const [previous, rms] of [[0, 0.1], [0.6, 0.02], [0.6, 0.003]]) {
    const at30 = advance(previous, rms, 0.2, 30);
    assert.ok(Math.abs(at30 - advance(previous, rms, 0.2, 60)) < 1e-10);
    assert.ok(Math.abs(at30 - advance(previous, rms, 0.2, 120)) < 1e-10);
  }
});

test('invalid samples and time deltas never create invalid model expression weights', () => {
  assert.equal(getMouthOpenness(0.5, Number.NaN, 0.1), 0);
  assert.equal(getMouthOpenness(0.5, Number.POSITIVE_INFINITY, 0.1), 0);
  assert.equal(getMouthOpenness(0.5, -1, 0.1), 0);
  assert.equal(getMouthOpenness(0.2, 0.1, -1), 0.2);
  assert.equal(getMouthOpenness(0.2, 0.1, Number.NaN), 0.2);
  assert.ok(getMouthOpenness(Number.NaN, 0.1, 0.1) > 0);
});
