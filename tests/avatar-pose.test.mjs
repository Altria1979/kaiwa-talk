import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { VRMUtils } from '@pixiv/three-vrm';
import { AvatarAnimator } from '../src/lib/avatar-animation.ts';
import { setAvatarRestPose } from '../src/lib/avatar-pose.ts';

const still = { elapsed: 0, reducedMotion: true, emotion: 'neutral', speaking: false, tilt: 0, gazeX: 0, gazeY: 0 };
const sides = ['left', 'right'];

function fixture({ version = '1', scale = 1, fingers = true, missing = [] } = {}) {
  const scene = new THREE.Object3D();
  scene.scale.setScalar(scale);
  const bones = new Map();
  const add = (name, parent, x, y, z = 0) => {
    const node = new THREE.Object3D();
    node.name = name;
    node.position.set(x, y, z);
    parent.add(node);
    bones.set(name, node);
    return node;
  };
  const hips = add('hips', scene, 0, 1);
  const spine = add('spine', hips, 0, 0.15);
  add('head', spine, 0, 0.6);
  for (const [side, sign] of [['left', 1], ['right', -1]]) {
    const shoulder = add(`${side}Shoulder`, spine, sign * 0.11, 0.27);
    const upper = add(`${side}UpperArm`, shoulder, sign * 0.09, 0);
    const lower = add(`${side}LowerArm`, upper, sign * 0.3, 0);
    const hand = add(`${side}Hand`, lower, sign * 0.28, 0);
    if (fingers) {
      for (const [index, finger] of ['Index', 'Middle', 'Ring', 'Little'].entries()) {
        const proximal = add(`${side}${finger}Proximal`, hand, sign * 0.06, 0, (index - 1.5) * 0.016);
        const intermediate = add(`${side}${finger}Intermediate`, proximal, sign * 0.032, 0);
        add(`${side}${finger}Distal`, intermediate, sign * 0.02, 0);
      }
      const thumb = add(`${side}ThumbMetacarpal`, hand, sign * 0.014, -0.005, -0.025);
      const thumbProximal = add(`${side}ThumbProximal`, thumb, sign * 0.025, 0, -0.015);
      add(`${side}ThumbDistal`, thumbProximal, sign * 0.02, 0, -0.01);
    }
  }
  if (version === '0') {
    // Match the mirrored local axes of VRM 0 before the stage corrects its facing.
    for (const bone of bones.values()) {
      bone.position.x *= -1;
      bone.position.z *= -1;
      bone.quaternion.x *= -1;
      bone.quaternion.z *= -1;
    }
  }
  for (const name of missing) bones.delete(name);
  const vrm = {
    scene,
    meta: { metaVersion: version },
    humanoid: {
      getNormalizedBoneNode: name => bones.get(name) ?? null,
      getRawBoneNode: name => bones.get(name) ?? null,
    },
    update: () => scene.updateMatrixWorld(true),
  };
  VRMUtils.rotateVRM0(vrm);
  scene.updateMatrixWorld(true);
  return { vrm, bones, position: name => bones.get(name).getWorldPosition(new THREE.Vector3()) };
}

function advance(animator, seconds) {
  for (let frame = 0; frame < Math.ceil(seconds * 60); frame++) {
    animator.update(1 / 60, { ...still, reducedMotion: false });
  }
}

function armLengths(model, side) {
  return [
    model.position(`${side}UpperArm`).distanceTo(model.position(`${side}LowerArm`)),
    model.position(`${side}LowerArm`).distanceTo(model.position(`${side}Hand`)),
  ];
}

test('resting hands meet below the waist and in front of the body across VRM versions and model sizes', () => {
  for (const scale of [0.5, 1, 2]) {
    const models = ['0', '1'].map(version => fixture({ version, scale }));
    for (const model of models) {
      const lengths = new Map(sides.map(side => [side, armLengths(model, side)]));
      setAvatarRestPose(model.vrm);
      const left = model.position('leftHand');
      const right = model.position('rightHand');
      const hips = model.position('hips');
      const armLength = lengths.get('left').reduce((sum, value) => sum + value, 0);
      assert.ok(Math.abs(left.x - right.x) < armLength * 0.35, 'wrists should meet near the centerline');
      assert.ok(Math.abs((left.x + right.x) / 2 - hips.x) < armLength * 0.1, 'hands should rest in front of the center of the body');
      for (const side of sides) {
        const hand = model.position(`${side}Hand`);
        assert.ok(hand.y < hips.y, `${side} hand must rest below the waist`);
        assert.ok(hand.z > hips.z + armLength * 0.15, `${side} hand must clear the front of the body`);
        armLengths(model, side).forEach((length, index) => {
          assert.ok(Math.abs(length - lengths.get(side)[index]) < 1e-7, 'posing must preserve limb lengths');
        });
      }
      assert.ok(Math.abs(left.z - right.z) > armLength * 0.025, 'overlapping hands need depth separation');
    }
    for (const name of ['leftUpperArm', 'leftLowerArm', 'leftHand', 'rightUpperArm', 'rightLowerArm', 'rightHand']) {
      assert.ok(models[0].position(name).distanceTo(models[1].position(name)) < 1e-7, `${name} must use the same world-space pose for VRM 0 and 1`);
    }
  }
});

test('wave and stretch release the folded arms and return to the saved rest pose without drift', () => {
  for (const version of ['0', '1']) {
    const model = fixture({ version });
    const actionRest = setAvatarRestPose(model.vrm);
    const restingRotations = new Map([...model.bones].map(([name, bone]) => [name, bone.quaternion.clone()]));
    const restingHands = new Map(sides.map(side => [side, model.position(`${side}Hand`)]));
    const animator = new AvatarAnimator(model.vrm, actionRest);
    for (let repeat = 0; repeat < 3; repeat++) {
      animator.trigger({ id: repeat * 2, kind: 'action', action: 'wave' });
      advance(animator, 0.8);
      assert.ok(model.position('rightHand').y > restingHands.get('right').y + 0.2, 'wave must lift the hand from the folded pose');
      advance(animator, 5);
      for (const side of sides) assert.ok(model.position(`${side}Hand`).distanceTo(restingHands.get(side)) < 1e-7, 'wave must restore the resting hands');
      animator.trigger({ id: repeat * 2 + 1, kind: 'action', action: 'stretch' });
      advance(animator, 0.8);
      for (const side of sides) {
        assert.ok(model.position(`${side}Hand`).y > model.position(`${side}UpperArm`).y, 'stretch must raise both hands above the shoulders');
      }
      advance(animator, 5);
      // Disable autonomous head motion before comparing the entire saved skeleton.
      for (let frame = 0; frame < 180; frame++) animator.update(1 / 60, still);
      for (const [name, bone] of model.bones) {
        assert.ok(bone.quaternion.angleTo(restingRotations.get(name)) < 1e-7, `${name} must recover its saved rest rotation`);
      }
      assert.equal(animator.camera, 0);
    }
  }
});

test('optional fingers and incomplete arms do not prevent a safe rest pose', () => {
  for (const version of ['0', '1']) {
    for (const missing of [[], ['leftHand'], ['rightLowerArm'], ['leftUpperArm', 'rightHand']]) {
      const model = fixture({ version, fingers: false, missing });
      assert.doesNotThrow(() => setAvatarRestPose(model.vrm));
      for (const bone of model.bones.values()) {
        assert.ok(bone.quaternion.toArray().every(Number.isFinite), 'partial rigs must keep finite rotations');
        assert.ok(Math.abs(bone.quaternion.length() - 1) < 1e-7, 'partial rigs must keep normalized rotations');
        assert.ok(bone.getWorldPosition(new THREE.Vector3()).toArray().every(Number.isFinite), 'partial rigs must keep finite positions');
      }
    }
  }
});
