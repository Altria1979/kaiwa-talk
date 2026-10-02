import * as THREE from 'three';
import type { VRM, VRMExpression, VRMHumanBoneName } from '@pixiv/three-vrm';
import { AVATAR_EMOTIONS, type AvatarEmotion } from '../../shared/avatar-emotion';

export type AvatarAction = 'wave' | 'nod' | 'shake' | 'bow' | 'stretch';
export type AvatarInteraction = 'head' | 'body' | 'hand';
export type AvatarCommand = { id: number; kind: 'action'; action: AvatarAction } | { id: number; kind: 'interaction'; target: AvatarInteraction };
export type AvatarCapabilities = { ready: boolean; actions: AvatarAction[]; emotions: AvatarEmotion[]; interactions: AvatarInteraction[] };
export const EMPTY_AVATAR_CAPABILITIES: AvatarCapabilities = { ready: false, actions: [], emotions: [], interactions: [] };

const motionBones = ['head', 'spine', 'leftUpperArm', 'leftLowerArm', 'leftHand', 'rightUpperArm', 'rightLowerArm', 'rightHand'] as const satisfies readonly VRMHumanBoneName[];
type MotionBone = (typeof motionBones)[number];
type MotionName = AvatarAction | 'head' | 'body';
type Rotation = [number, number, number];
export type AvatarMotionSample = { rotations: Partial<Record<MotionBone, Rotation>>; camera: number; emotion?: AvatarEmotion };
const durations: Record<MotionName, number> = { wave: 2.8, nod: 1.5, shake: 1.6, bow: 2.3, stretch: 3.2, head: 1.9, body: 1.5 };

const ease = (value: number) => { const x = THREE.MathUtils.clamp(value, 0, 1); return x * x * (3 - 2 * x); };
const motionEnvelope = (age: number, duration: number) => ease(age / 0.35) * ease((duration - age) / 0.45);

/** Offsets always refer to the saved, relaxed pose, never the previous action. */
export function sampleAvatarMotion(name: MotionName, age: number, reducedMotion = false): AvatarMotionSample {
  const duration = durations[name];
  if (age < 0 || age >= duration) return { rotations: {}, camera: 0 };
  const envelope = motionEnvelope(age, duration);
  const amount = envelope * (reducedMotion ? 0.4 : 1);
  switch (name) {
    case 'wave': return { rotations: { rightUpperArm: [0, 0.3 * amount, -0.85 * amount], rightLowerArm: [0, 0, -2.05 * amount], rightHand: [0, 0, Math.sin(age * 10) * 0.3 * amount] }, camera: envelope * 0.5 };
    case 'nod': return { rotations: { head: [Math.sin(age * Math.PI * 3 / duration) * 0.2 * amount, 0, 0] }, camera: 0 };
    case 'shake': return { rotations: { head: [0, Math.sin(age * Math.PI * 4 / duration) * 0.24 * amount, 0] }, camera: 0 };
    case 'bow': return { rotations: { spine: [0.24 * amount, 0, 0], head: [0.1 * amount, 0, 0] }, camera: 0 };
    case 'stretch': return { rotations: { leftUpperArm: [0, 0, 2.6 * amount], rightUpperArm: [0, 0, -2.6 * amount], leftLowerArm: [0, 0, 0.12 * amount], rightLowerArm: [0, 0, -0.12 * amount], spine: [-0.055 * amount, 0, 0] }, camera: envelope };
    case 'head': return { rotations: { head: [-0.04 * amount, 0, 0.16 * amount] }, camera: 0, emotion: 'happy' };
    case 'body': return { rotations: { spine: [-0.1 * amount, 0, 0], head: [-0.08 * amount, 0, 0] }, camera: 0, emotion: 'surprised' };
  }
}

export function getAvatarCapabilities(vrm: VRM): AvatarCapabilities {
  const has = (...names: VRMHumanBoneName[]) => names.every((name) => vrm.humanoid.getNormalizedBoneNode(name));
  const actions: AvatarAction[] = [];
  if (has('rightUpperArm', 'rightLowerArm', 'rightHand')) actions.push('wave');
  if (has('head')) actions.push('nod', 'shake');
  if (has('spine', 'head')) actions.push('bow');
  if (has('spine', 'leftUpperArm', 'leftLowerArm', 'rightUpperArm', 'rightLowerArm')) actions.push('stretch');
  const interactions: AvatarInteraction[] = [];
  if (has('head')) interactions.push('head');
  if (has('spine')) interactions.push('body');
  if (actions.includes('wave')) interactions.push('hand');
  // VRM loaders may create empty preset placeholders. They cannot produce a visible expression.
  const emotions = AVATAR_EMOTIONS.filter((emotion) => emotion === 'neutral' || Boolean(vrm.expressionManager?.getExpression(emotion)?.binds.length));
  return { ready: true, actions, emotions, interactions };
}

/** Preserve model rules while ensuring expression overrides cannot mute speech. */
export function getAvatarEmotionWeight(expression: Pick<VRMExpression, 'isBinary' | 'overrideMouth'>, weight: number, speaking: boolean): number {
  if (!speaking || expression.overrideMouth === 'none') return weight;
  if (expression.isBinary || expression.overrideMouth === 'block') return 0;
  return Math.min(weight, 0.4);
}

export type AvatarHandRegion = { wrist: THREE.Vector3; fingers: THREE.Vector3[][] };
const fingerJoints = [
  ['ThumbMetacarpal', 'ThumbProximal', 'ThumbDistal'],
  ['IndexProximal', 'IndexIntermediate', 'IndexDistal'],
  ['MiddleProximal', 'MiddleIntermediate', 'MiddleDistal'],
  ['RingProximal', 'RingIntermediate', 'RingDistal'],
  ['LittleProximal', 'LittleIntermediate', 'LittleDistal'],
] as const;

/** VRM bone mappings cover visible fingertips even when a mesh contains the whole body. */
export function getAvatarHandRegions(vrm: VRM): AvatarHandRegion[] {
  return (['left', 'right'] as const).flatMap((side) => {
    const wrist = vrm.humanoid.getRawBoneNode(`${side}Hand`);
    if (!wrist) return [];
    const fingers = fingerJoints.map((joints) => joints.flatMap((joint) => {
      const node = vrm.humanoid.getRawBoneNode(`${side}${joint}`);
      return node ? [node.getWorldPosition(new THREE.Vector3())] : [];
    })).filter((joints) => joints.length > 0);
    return [{ wrist: wrist.getWorldPosition(new THREE.Vector3()), fingers }];
  });
}

export function classifyAvatarHit(point: THREE.Vector3, height: number, head: THREE.Vector3 | null, hands: AvatarHandRegion[]): AvatarInteraction {
  const scale = Math.max(height, 0.001);
  const headDistance = head ? point.distanceTo(head) / (scale * 0.105) : Infinity;
  const segment = new THREE.Line3();
  const nearest = new THREE.Vector3();
  let handDistance = Infinity;
  for (const { wrist, fingers } of hands) {
    handDistance = Math.min(handDistance, point.distanceTo(wrist) / (scale * (fingers.length ? 0.04 : 0.06)));
    for (const joints of fingers) {
      let previous = wrist;
      for (const [index, joint] of joints.entries()) {
        segment.set(previous, joint).closestPointToPoint(point, true, nearest);
        handDistance = Math.min(handDistance, point.distanceTo(nearest) / (scale * (index === 0 ? 0.025 : 0.018)));
        previous = joint;
      }
      const last = joints.at(-1)!;
      const before = joints.at(-2) ?? wrist;
      // A distal bone is the last knuckle, not the skin's fingertip.
      const tip = last.clone().sub(before).clampLength(0, scale * 0.03).add(last);
      segment.set(last, tip).closestPointToPoint(point, true, nearest);
      handDistance = Math.min(handDistance, point.distanceTo(nearest) / (scale * 0.018));
    }
  }
  if (handDistance < 1 && handDistance < headDistance) return 'hand';
  if (headDistance < 1) return 'head';
  return handDistance < 1 ? 'hand' : 'body';
}

export function isAvatarTap(start: { x: number; y: number; time: number }, end: { x: number; y: number; time: number }, moved: boolean): boolean {
  return !moved && end.time - start.time <= 600 && Math.hypot(end.x - start.x, end.y - start.y) <= 8;
}

/** A single owner for procedural bones and expression blends inside the stage's RAF. */
export class AvatarAnimator {
  readonly capabilities: AvatarCapabilities;
  private readonly bones = new Map<MotionBone, { node: THREE.Object3D; rest: THREE.Quaternion }>();
  private readonly target = new THREE.Quaternion();
  private readonly rotation = new THREE.Quaternion();
  private readonly euler = new THREE.Euler();
  private readonly expressionWeights = new Map<AvatarEmotion, number>();
  private active: { name: MotionName; age: number } | null = null;
  camera = 0;

  constructor(private readonly vrm: VRM, private readonly actionRest: ReadonlyMap<VRMHumanBoneName, THREE.Quaternion> = new Map()) {
    this.capabilities = getAvatarCapabilities(vrm);
    for (const name of motionBones) {
      const node = vrm.humanoid.getNormalizedBoneNode(name);
      if (node) this.bones.set(name, { node, rest: node.quaternion.clone() });
    }
  }

  trigger(command: AvatarCommand): boolean {
    if (command.kind === 'action' && !this.capabilities.actions.includes(command.action)) return false;
    if (command.kind === 'interaction' && !this.capabilities.interactions.includes(command.target)) return false;
    this.active = { name: command.kind === 'action' ? command.action : command.target === 'hand' ? 'wave' : command.target, age: 0 };
    return true;
  }

  update(delta: number, options: { elapsed: number; reducedMotion: boolean; emotion: AvatarEmotion; speaking: boolean; tilt: number; gazeX: number; gazeY: number }) {
    const step = Math.max(0, Math.min(delta, 0.05));
    if (this.active) {
      this.active.age += step;
      if (this.active.age >= durations[this.active.name]) this.active = null;
    }
    const sample = this.active ? sampleAvatarMotion(this.active.name, this.active.age, options.reducedMotion) : { rotations: {}, camera: 0 } as AvatarMotionSample;
    const smoothing = 1 - Math.exp(-step * 16);
    for (const [name, { node, rest }] of this.bones) {
      const [x, y, z] = sample.rotations[name] ?? [0, 0, 0];
      this.euler.set(x, y, z);
      if (name === 'head' && !options.reducedMotion) {
        this.euler.x += Math.sin(options.elapsed * 0.85) * 0.013 - options.gazeY * 0.1;
        this.euler.y += Math.sin(options.elapsed * 0.5) * 0.022 + options.gazeX * 0.16;
        this.euler.z += options.tilt + Math.sin(options.elapsed * 0.7) * 0.012;
      }
      // rotateVRM0 aligns the scene, but normalized bone offsets retain VRM 0.0's axes.
      if (this.vrm.meta?.metaVersion === '0') {
        this.euler.x *= -1;
        this.euler.z *= -1;
      }
      this.target.copy(rest);
      const actionBase = this.actionRest.get(name);
      if (actionBase && this.active && (this.active.name === 'stretch' || (this.active.name === 'wave' && name.startsWith('right')))) {
        const release = motionEnvelope(this.active.age, durations[this.active.name]) * (options.reducedMotion ? 0.4 : 1);
        this.target.slerp(actionBase, release);
      }
      this.target.multiply(this.rotation.setFromEuler(this.euler));
      node.quaternion.slerp(this.target, smoothing);
      if (node.quaternion.angleTo(this.target) < 0.00001) node.quaternion.copy(this.target);
    }
    this.camera = THREE.MathUtils.lerp(this.camera, sample.camera, 1 - Math.exp(-step * 7));
    if (this.camera < 0.00001) this.camera = 0;
    const emotion = sample.emotion ?? options.emotion;
    let mouthOverrides = 0;
    for (const name of AVATAR_EMOTIONS) {
      const expression = this.vrm.expressionManager?.getExpression(name);
      if (!expression) continue;
      const wanted = name === emotion && expression.binds.length > 0 ? 1 : 0;
      const previous = this.expressionWeights.get(name) ?? 0;
      const blend = THREE.MathUtils.lerp(previous, wanted, smoothing);
      const weight = getAvatarEmotionWeight(expression, blend < 0.001 ? 0 : blend, options.speaking);
      this.expressionWeights.set(name, weight);
      if (expression.overrideMouth === 'blend') mouthOverrides += weight;
    }
    for (const [name, weight] of this.expressionWeights) {
      const expression = this.vrm.expressionManager?.getExpression(name);
      const scale = options.speaking && expression?.overrideMouth === 'blend' && mouthOverrides > 0.4 ? 0.4 / mouthOverrides : 1;
      this.vrm.expressionManager?.setValue(name, weight * scale);
    }
  }
}
