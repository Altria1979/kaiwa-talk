import * as THREE from 'three';
import type { VRM, VRMHumanBoneName } from '@pixiv/three-vrm';

/** Aim a bone in world space so VRM 0/1 facing conventions share the same pose. */
function aimBone(bone: THREE.Object3D, child: THREE.Object3D, direction: THREE.Vector3) {
  if (!bone.parent) return;
  const from = child.getWorldPosition(new THREE.Vector3()).sub(bone.getWorldPosition(new THREE.Vector3())).normalize();
  const parent = bone.parent.getWorldQuaternion(new THREE.Quaternion());
  const delta = new THREE.Quaternion().setFromUnitVectors(from, direction.clone().normalize());
  bone.quaternion.premultiply(parent.clone().invert().multiply(delta).multiply(parent));
  bone.updateMatrixWorld(true);
}

/** Save the gesture base, then rest both hands gently overlapped below the waist. */
export function setAvatarRestPose(vrm: VRM): Map<VRMHumanBoneName, THREE.Quaternion> {
  const actionRest = new Map<VRMHumanBoneName, THREE.Quaternion>();
  const bone = (name: VRMHumanBoneName) => vrm.humanoid.getNormalizedBoneNode(name);
  vrm.scene.updateMatrixWorld(true);
  const left = bone('leftUpperArm');
  const right = bone('rightUpperArm');
  const center = left && right
    ? left.getWorldPosition(new THREE.Vector3()).add(right.getWorldPosition(new THREE.Vector3())).multiplyScalar(0.5)
    : null;

  for (const side of ['left', 'right'] as const) {
    const upper = bone(`${side}UpperArm`);
    const lower = bone(`${side}LowerArm`);
    const hand = bone(`${side}Hand`);
    if (!upper?.parent || !lower) continue;
    const from = lower.getWorldPosition(new THREE.Vector3()).sub(upper.getWorldPosition(new THREE.Vector3())).normalize();
    aimBone(upper, lower, new THREE.Vector3(from.x * 0.22, -1, 0.03));
    for (const part of ['UpperArm', 'LowerArm', 'Hand'] as const) {
      const node = bone(`${side}${part}`);
      if (node) actionRest.set(`${side}${part}`, node.quaternion.clone());
    }
    if (!center || !hand?.parent) continue;

    const shoulder = upper.getWorldPosition(new THREE.Vector3());
    const elbow = lower.getWorldPosition(new THREE.Vector3());
    const wrist = hand.getWorldPosition(new THREE.Vector3());
    const upperLength = shoulder.distanceTo(elbow);
    const lowerLength = elbow.distanceTo(wrist);
    const length = upperLength + lowerLength;
    if (Math.min(upperLength, lowerLength) < 0.00001) continue;
    const sign = shoulder.x >= center.x ? 1 : -1;
    const target = new THREE.Vector3(center.x + sign * length * 0.1, shoulder.y - length * 0.75, center.z + length * (side === 'left' ? 0.62 : 0.55));
    const direction = target.clone().sub(shoulder);
    const distance = THREE.MathUtils.clamp(direction.length(), Math.abs(upperLength - lowerLength) + length * 0.001, length * 0.999);
    direction.normalize();
    target.copy(shoulder).addScaledVector(direction, distance);
    const along = (upperLength ** 2 - lowerLength ** 2 + distance ** 2) / (2 * distance);
    const bend = new THREE.Vector3(sign, 0, -0.25);
    bend.addScaledVector(direction, -bend.dot(direction)).normalize();
    const elbowTarget = shoulder.clone().addScaledVector(direction, along).addScaledVector(bend, Math.sqrt(Math.max(0, upperLength ** 2 - along ** 2)));
    aimBone(upper, lower, elbowTarget.sub(shoulder));
    aimBone(lower, hand, target.sub(lower.getWorldPosition(new THREE.Vector3())));

    // Fingers point diagonally down across the other hand; palms face the skirt.
    const inward = side === 'left' ? 0.62 : 0.22;
    const x = new THREE.Vector3(-inward, -sign * Math.sqrt(1 - inward ** 2), 0);
    const y = new THREE.Vector3(0, 0, 1);
    const z = new THREE.Vector3().crossVectors(x, y);
    const orientation = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
    if (vrm.meta?.metaVersion === '0') orientation.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI));
    hand.quaternion.copy(hand.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(orientation));
    hand.updateMatrixWorld(true);
    for (const [index, finger] of (['Index', 'Middle', 'Ring', 'Little'] as const).entries()) {
      for (const [joint, curl] of [['Proximal', 0.14], ['Intermediate', 0.2], ['Distal', 0.1]] as const) {
        const node = bone(`${side}${finger}${joint}`);
        if (node) node.rotation.z += (vrm.meta?.metaVersion === '0' ? 1 : -1) * sign * curl * (1 + index * 0.22);
      }
    }
    const thumb = bone(`${side}ThumbMetacarpal`);
    if (thumb) thumb.rotation.y += sign * 0.4;
  }
  vrm.update(0);
  return actionRest;
}
