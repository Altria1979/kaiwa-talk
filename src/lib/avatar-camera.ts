import { MathUtils, Vector3, type PerspectiveCamera } from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { getAvatarFraming } from './avatar-framing';
import { isAvatarTap } from './avatar-animation';

/** Keep automatic action framing until the viewer actually moves the camera. */
export class AvatarCamera {
  private readonly size = new Vector3(0.6, 1.6, 0.3);
  private readonly center = new Vector3(0, 0.8, 0);
  private readonly framingSize = new Vector3();
  private manual = false;
  private interacting = false;
  private applyingView = false;
  private connected = true;

  constructor(private readonly camera: PerspectiveCamera, private readonly controls: OrbitControls) {
    controls.enableDamping = true;
    controls.dampingFactor = 0.12;
    controls.rotateSpeed = 0.65;
    controls.zoomSpeed = 0.8;
    controls.panSpeed = 0.7;
    controls.minPolarAngle = Math.PI * 0.12;
    controls.maxPolarAngle = Math.PI * 0.88;
    controls.addEventListener('start', this.onStart);
    controls.addEventListener('end', this.onEnd);
    controls.addEventListener('change', this.onChange);
    this.setLimits();
  }

  private readonly onStart = () => { this.interacting = true; };
  private readonly onEnd = () => { this.interacting = false; };
  private readonly onChange = () => {
    if (this.interacting && !this.applyingView) this.manual = true;
  };

  private setLimits() {
    const height = this.size.y;
    this.controls.minDistance = Math.max(height * 0.28, Math.hypot(this.size.x, this.size.z) * 0.6, 0.05);
    this.controls.maxDistance = Math.max(height * 12, getAvatarFraming(this.size, this.camera.fov, this.camera.aspect, 0).distance * 3);
    this.controls.cursor.copy(this.center);
    this.controls.maxTargetRadius = height * 1.5;
    this.camera.far = Math.max(50, this.controls.maxDistance + height * 3);
    this.camera.updateProjectionMatrix();
  }

  setEnabled(enabled: boolean) {
    this.controls.enabled = enabled;
    const element = this.controls.domElement;
    if (element && enabled !== this.connected) {
      if (enabled) {
        this.controls.connect(element);
        this.controls.cursorStyle = 'grab';
      } else {
        this.controls.disconnect();
      }
    }
    this.connected = enabled;
    if (!enabled) this.interacting = false;
  }

  setReducedMotion(reduced: boolean) {
    this.controls.enableDamping = !reduced;
  }

  setSubject(size: Vector3, center: Vector3, framing: number) {
    this.size.copy(size);
    this.center.copy(center);
    this.setLimits();
    this.reset(framing);
  }

  update(framing: number, widening = 0) {
    this.applyingView = true;
    if (!this.manual) {
      this.framingSize.copy(this.size);
      this.framingSize.x *= 1 + widening * 0.3;
      this.framingSize.y *= 1 + widening * 0.12;
      const { distance, centerOffsetY } = getAvatarFraming(this.framingSize, this.camera.fov, this.camera.aspect, framing * (1 - widening * 0.72));
      const targetY = this.center.y + centerOffsetY + this.size.y * widening * 0.04;
      this.controls.target.set(this.center.x, targetY, this.center.z);
      this.camera.position.set(this.center.x, targetY, this.center.z + distance);
    }
    this.controls.update();
    this.applyingView = false;
  }

  resize(aspect: number, framing: number, widening = 0) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    // Do not change the target, orbit, or distance of a view the user composed.
    if (!this.manual) this.setLimits();
    this.update(framing, widening);
  }

  reset(framing: number, widening = 0) {
    // Flush residual rotation/pan before applying the front view; otherwise damping
    // would continue the old drag after the reset button or framing slider is used.
    const damping = this.controls.enableDamping;
    this.controls.enableDamping = false;
    this.applyingView = true;
    this.controls.update();
    this.controls.enableDamping = damping;
    this.applyingView = false;
    this.manual = false;
    this.setLimits();
    this.update(framing, widening);
  }

  zoom(inward: boolean) {
    this.manual = true;
    if (inward) this.controls.dollyIn(0.8);
    else this.controls.dollyOut(0.8);
  }

  rotate(left: boolean) {
    this.manual = true;
    this.controls.rotateLeft(MathUtils.degToRad(left ? 30 : -30));
  }

  dispose() {
    this.controls.removeEventListener('start', this.onStart);
    this.controls.removeEventListener('end', this.onEnd);
    this.controls.removeEventListener('change', this.onChange);
    if (this.controls.domElement) this.controls.dispose();
  }
}

type PointerSample = Pick<PointerEvent, 'pointerId' | 'clientX' | 'clientY' | 'timeStamp'>;

/** A complete multi-pointer gesture can never become a model tap. */
export class AvatarTapGesture {
  private readonly pointers = new Set<number>();
  private start: { id: number; x: number; y: number; time: number; moved: boolean } | null = null;

  down(event: PointerSample & Pick<PointerEvent, 'isPrimary' | 'button' | 'ctrlKey' | 'metaKey' | 'shiftKey'>) {
    this.pointers.add(event.pointerId);
    if (this.pointers.size !== 1 || !event.isPrimary || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey) {
      this.start = null;
      return;
    }
    this.start = { id: event.pointerId, x: event.clientX, y: event.clientY, time: event.timeStamp, moved: false };
  }

  move(event: PointerSample) {
    if (this.start?.id === event.pointerId && Math.hypot(event.clientX - this.start.x, event.clientY - this.start.y) > 8) this.start.moved = true;
  }

  up(event: PointerSample) {
    this.pointers.delete(event.pointerId);
    const start = this.start;
    this.start = null;
    return this.pointers.size === 0 && start?.id === event.pointerId && isAvatarTap(start, { x: event.clientX, y: event.clientY, time: event.timeStamp }, start.moved);
  }

  cancel() {
    this.pointers.clear();
    this.start = null;
  }
}
