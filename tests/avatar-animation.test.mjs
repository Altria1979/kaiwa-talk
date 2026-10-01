import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { VRMUtils } from '@pixiv/three-vrm';
import { AvatarAnimator, classifyAvatarHit, getAvatarCapabilities, getAvatarEmotionWeight, getAvatarHandRegions, isAvatarTap, sampleAvatarMotion } from '../src/lib/avatar-animation.ts';

const boneNames = ['head', 'spine', 'leftUpperArm', 'leftLowerArm', 'rightUpperArm', 'rightLowerArm', 'rightHand'];
function fixture(names = boneNames) {
  const bones = new Map(names.map((name, index) => {
    const node = new THREE.Object3D();
    // Deliberately nonidentity: action recovery must retain an imported model's relaxed base.
    node.quaternion.setFromEuler(new THREE.Euler(0.03 * index, -0.02 * index, 0.16 * index));
    return [name, node];
  }));
  const expressions = new Map(['happy', 'relaxed', 'sad', 'angry', 'surprised'].map((name) => [name, { binds: [{}], isBinary: false, overrideMouth: 'none' }]));
  const weights = new Map();
  const vrm = { humanoid: { getNormalizedBoneNode: (name) => bones.get(name) ?? null }, expressionManager: { getExpression: (name) => expressions.get(name), setValue: (name, value) => weights.set(name, value) } };
  return { bones, expressions, weights, vrm };
}
const still = { elapsed: 0, reducedMotion: true, emotion: 'neutral', speaking: false, tilt: 0, gazeX: 0, gazeY: 0 };
function advance(animator, seconds, options = still) {
  for (let frame = 0; frame < Math.ceil(seconds * 60); frame++) animator.update(1 / 60, options);
}

function facingFixture(metaVersion) {
  const result = fixture();
  const { vrm, bones } = result;
  const scene = new THREE.Object3D();
  for (const bone of bones.values()) bone.quaternion.identity();
  const spine = bones.get('spine');
  scene.add(spine);
  spine.position.y = 0.9;
  spine.add(bones.get('head'));
  bones.get('head').position.y = 0.55;
  for (const [side, sign] of [['left', 1], ['right', -1]]) {
    const upper = bones.get(`${side}UpperArm`);
    const lower = bones.get(`${side}LowerArm`);
    spine.add(upper);
    upper.position.set(sign * 0.2, 0.35, 0);
    upper.rotation.z = -sign * 1.35;
    upper.add(lower);
    lower.position.x = sign * 0.28;
    if (side === 'right') {
      lower.add(bones.get('rightHand'));
      bones.get('rightHand').position.x = sign * 0.25;
    }
  }
  if (metaVersion === '0') {
    // VRM 0.0 faces -Z before the stage applies rotateVRM0.
    for (const bone of bones.values()) {
      bone.position.x *= -1;
      bone.position.z *= -1;
      bone.quaternion.x *= -1;
      bone.quaternion.z *= -1;
    }
  }
  vrm.meta = { metaVersion };
  vrm.scene = scene;
  VRMUtils.rotateVRM0(vrm);
  return { ...result, position: name => bones.get(name).getWorldPosition(new THREE.Vector3()) };
}

test('VRM 0.0 and 1.0 bow toward the viewer after the stage corrects facing direction', () => {
  for (const version of ['0', '1']) {
    const { vrm, position } = facingFixture(version);
    const animator = new AvatarAnimator(vrm);
    const before = position('head');
    animator.trigger({ id: 1, kind: 'action', action: 'bow' });
    advance(animator, 0.8, { ...still, reducedMotion: false });
    const bowed = position('head');
    assert.ok(bowed.z > before.z + 0.1, `VRM ${version} must lean toward the +Z camera`);
    assert.ok(bowed.y < before.y, `VRM ${version} must lower its head`);
  }
});

test('VRM 0.0 waves through the same world-space hand path as VRM 1.0 and restores its pose', () => {
  const models = ['0', '1'].map(version => {
    const model = facingFixture(version);
    return { ...model, animator: new AvatarAnimator(model.vrm) };
  });
  const baseline = models[0].position('rightHand');
  for (const model of models) model.animator.trigger({ id: 1, kind: 'action', action: 'wave' });
  for (let step = 0; step < 12; step++) {
    for (const model of models) advance(model.animator, 0.2, { ...still, reducedMotion: false });
    assert.ok(models[0].position('rightHand').distanceTo(models[1].position('rightHand')) < 1e-7, 'waving must follow the same direction across VRM versions');
    if (step === 3) assert.ok(models[0].position('rightHand').y > baseline.y + 0.2, 'a wave raises the relaxed hand');
  }
  for (const model of models) {
    advance(model.animator, 5);
    assert.ok(model.position('rightHand').distanceTo(baseline) < 1e-7, 'waving must recover the relaxed hand position');
  }
});

test('all actions recover the relaxed bone pose and camera across repeated plays', () => {
  const { vrm, bones } = fixture();
  const bases = new Map([...bones].map(([name, bone]) => [name, bone.quaternion.clone()]));
  const animator = new AvatarAnimator(vrm);
  for (let repeat = 0; repeat < 4; repeat++) {
    for (const action of ['wave', 'nod', 'shake', 'bow', 'stretch']) {
      assert.equal(animator.trigger({ id: repeat, kind: 'action', action }), true);
      advance(animator, 0.8);
      assert.ok([...bones].some(([name, node]) => node.quaternion.angleTo(bases.get(name)) > 0.01), `${action} did not move`);
      advance(animator, 5);
      for (const [name, node] of bones) assert.ok(node.quaternion.angleTo(bases.get(name)) < 1e-7, `${action} drifted ${name}`);
      assert.equal(animator.camera, 0);
    }
  }
});

test('a replacement blends from the current pose, repeats restart, and old actions never queue', () => {
  const { vrm, bones } = fixture();
  const animator = new AvatarAnimator(vrm);
  animator.trigger({ id: 1, kind: 'action', action: 'stretch' });
  advance(animator, 1, { ...still, reducedMotion: false });
  const before = bones.get('rightUpperArm').quaternion.clone();
  animator.trigger({ id: 2, kind: 'action', action: 'nod' });
  assert.equal(bones.get('rightUpperArm').quaternion.angleTo(before), 0);
  animator.update(1 / 60, still);
  assert.ok(bones.get('rightUpperArm').quaternion.angleTo(before) < 0.65);
  animator.trigger({ id: 3, kind: 'action', action: 'nod' });
  advance(animator, 0.8);
  assert.ok(bones.get('head').quaternion.angleTo(new THREE.Quaternion()) > 0.005);
  advance(animator, 5);
  assert.equal(animator.camera, 0);
  assert.ok(bones.get('head').quaternion.angleTo(new THREE.Quaternion()) < 1e-7);
});

test('reduced motion removes autonomous head/gaze changes and reduces explicit actions', () => {
  const { vrm, bones } = fixture();
  const animator = new AvatarAnimator(vrm);
  advance(animator, 1, { ...still, elapsed: 3, tilt: 0.1, gazeX: 1, gazeY: 1 });
  assert.equal(bones.get('head').quaternion.angleTo(new THREE.Quaternion()), 0);
  for (const action of ['wave', 'nod', 'shake', 'bow', 'stretch', 'head', 'body']) {
    const normal = sampleAvatarMotion(action, 0.8);
    const reduced = sampleAvatarMotion(action, 0.8, true);
    for (const [name, rotation] of Object.entries(normal.rotations)) {
      rotation.forEach((value, index) => assert.ok(Math.abs(reduced.rotations[name][index] - value * 0.4) < 1e-9));
    }
    assert.deepEqual(sampleAvatarMotion(action, 10), { rotations: {}, camera: 0 });
  }
});

test('interaction expressions temporarily override the selected emotion and restore it', () => {
  const { vrm, weights } = fixture();
  const animator = new AvatarAnimator(vrm);
  const options = { ...still, emotion: 'sad' };
  advance(animator, 1, options);
  assert.ok(weights.get('sad') > 0.99);
  animator.trigger({ id: 1, kind: 'interaction', target: 'head' });
  advance(animator, 0.8, options);
  assert.ok(weights.get('happy') > 0.99);
  assert.equal(weights.get('sad'), 0);
  advance(animator, 3, options);
  assert.equal(weights.get('happy'), 0);
  assert.ok(weights.get('sad') > 0.99);
  animator.trigger({ id: 2, kind: 'interaction', target: 'body' });
  advance(animator, 0.8, options);
  assert.ok(weights.get('surprised') > 0.99);
  advance(animator, 3, { ...options, emotion: 'relaxed' });
  assert.ok(weights.get('relaxed') > 0.99, 'restore the latest selected expression');
});

test('natural uses an authored neutral expression and safely falls back for an empty preset', () => {
  const { vrm, expressions, weights } = fixture();
  expressions.set('neutral', { binds: [{}], isBinary: false, overrideMouth: 'blend' });
  const animator = new AvatarAnimator(vrm);
  advance(animator, 1);
  assert.ok(weights.get('neutral') > 0.99);
  animator.update(1 / 60, { ...still, speaking: true });
  assert.ok(weights.get('neutral') <= 0.4, 'authored neutral respects lip sync too');
  advance(animator, 1, { ...still, emotion: 'happy' });
  assert.equal(weights.get('neutral'), 0);
  expressions.get('neutral').binds = [];
  advance(animator, 1);
  assert.equal(weights.get('happy'), 0);
  assert.equal(weights.get('neutral'), 0);
});

test('mouth override limits preserve speech, including expression crossfades, without changing model rules', () => {
  const { vrm, expressions, weights } = fixture();
  expressions.get('happy').overrideMouth = 'blend';
  expressions.get('sad').overrideMouth = 'blend';
  expressions.get('angry').overrideMouth = 'block';
  expressions.get('surprised').overrideMouth = 'blend';
  expressions.get('surprised').isBinary = true;
  const animator = new AvatarAnimator(vrm);
  advance(animator, 1, { ...still, emotion: 'happy' });
  assert.ok(weights.get('happy') > 0.99);
  for (const emotion of ['happy', 'sad', 'angry', 'surprised']) {
    for (let frame = 0; frame < 60; frame++) {
      animator.update(1 / 60, { ...still, emotion, speaking: true });
      assert.ok(weights.get('happy') + weights.get('sad') <= 0.400001);
      assert.equal(weights.get('angry'), 0);
      assert.equal(weights.get('surprised'), 0);
    }
  }
  assert.equal(expressions.get('happy').overrideMouth, 'blend');
  assert.equal(expressions.get('angry').overrideMouth, 'block');
  assert.equal(getAvatarEmotionWeight({ isBinary: true, overrideMouth: 'none' }, 1, true), 1);
});

test('capabilities detect missing bones and empty expression presets, and reject unsupported commands', () => {
  const full = fixture();
  assert.deepEqual(getAvatarCapabilities(full.vrm).actions, ['wave', 'nod', 'shake', 'bow', 'stretch']);
  const partial = fixture(['head', 'spine']);
  partial.expressions.get('happy').binds = [];
  partial.expressions.delete('angry');
  const capabilities = getAvatarCapabilities(partial.vrm);
  assert.deepEqual(capabilities.actions, ['nod', 'shake', 'bow']);
  assert.deepEqual(capabilities.interactions, ['head', 'body']);
  assert.deepEqual(capabilities.emotions, ['neutral', 'relaxed', 'sad', 'surprised']);
  const animator = new AvatarAnimator(partial.vrm);
  assert.equal(animator.trigger({ id: 1, kind: 'action', action: 'wave' }), false);
  assert.equal(animator.trigger({ id: 2, kind: 'interaction', target: 'hand' }), false);
});

test('hit regions use bone positions and model-relative size, including a raised hand near the head', () => {
  for (const scale of [0.25, 1, 4]) {
    const offset = new THREE.Vector3(2, -1, 3);
    const point = (x, y, z = 0) => new THREE.Vector3(x, y, z).multiplyScalar(scale).add(offset);
    const head = point(0, 1.6);
    const hands = [point(-0.3, 0.85), point(0.17, 1.6)].map((wrist) => ({ wrist, fingers: [] }));
    assert.equal(classifyAvatarHit(point(0, 1.66), 1.8 * scale, head, hands), 'head');
    assert.equal(classifyAvatarHit(point(0.18, 1.61), 1.8 * scale, head, hands), 'hand');
    assert.equal(classifyAvatarHit(point(-0.32, 0.83), 1.8 * scale, head, hands), 'hand');
    assert.equal(classifyAvatarHit(point(0, 1), 1.8 * scale, head, hands), 'body');
  }
});

test('mapped finger capsules include fingertips beyond the wrist without swallowing nearby torso', () => {
  for (const scale of [0.25, 1, 4]) {
    const origin = new THREE.Vector3(2, -1, 3);
    const point = (x, y, z = 0) => new THREE.Vector3(x, y, z).multiplyScalar(scale).add(origin);
    const mapped = new Map([
      ['rightHand', point(-0.24, 0.9)],
      ['rightMiddleProximal', point(-0.28, 0.82)],
      ['rightMiddleIntermediate', point(-0.29, 0.78)],
      ['rightMiddleDistal', point(-0.295, 0.75)],
    ].map(([name, position]) => {
      const node = new THREE.Object3D();
      node.name = 'arbitrary mesh-independent name';
      node.position.copy(position);
      return [name, node];
    }));
    const vrm = { humanoid: { getRawBoneNode: (name) => mapped.get(name) ?? null } };
    const hands = getAvatarHandRegions(vrm);
    assert.equal(hands.length, 1);
    assert.equal(hands[0].fingers[0].length, 3);
    const head = point(0, 1.6);
    const fingertip = point(-0.3, 0.716, 0.012);
    assert.ok(fingertip.distanceTo(hands[0].wrist) > 1.8 * scale * 0.06, 'regression lies outside the old wrist sphere');
    assert.equal(classifyAvatarHit(fingertip, 1.8 * scale, head, hands), 'hand');
    assert.equal(classifyAvatarHit(point(-0.27, 0.85, 0.012), 1.8 * scale, head, hands), 'hand');
    assert.equal(classifyAvatarHit(point(-0.12, 0.9), 1.8 * scale, head, hands), 'body');
    assert.equal(classifyAvatarHit(point(-0.18, 0.75), 1.8 * scale, head, hands), 'body');
  }
});

test('touch taps accept small movement, reject swipes, long presses, and swipes that return to their origin', () => {
  const start = { x: 100, y: 200, time: 50 };
  assert.equal(isAvatarTap(start, { x: 103, y: 202, time: 160 }, false), true);
  assert.equal(isAvatarTap(start, { x: 100, y: 225, time: 160 }, false), false);
  assert.equal(isAvatarTap(start, { x: 100, y: 200, time: 800 }, false), false);
  assert.equal(isAvatarTap(start, { x: 100, y: 200, time: 160 }, true), false);
});
