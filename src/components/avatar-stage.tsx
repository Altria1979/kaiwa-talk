'use client';

import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { VRMLoaderPlugin, VRMUtils, type VRM } from '@pixiv/three-vrm';
import { AppError, APP_ERROR_MESSAGES } from '../../shared/app-errors';
import type { ConversationState } from '../../shared/protocol';
import { ensureBrowserSession, SERVICE_URL } from '../lib/api';
import { AVATAR_BOB_RATIO } from '../lib/avatar-framing';
import { AvatarCamera, AvatarTapGesture } from '../lib/avatar-camera';
import { getMouthOpenness } from '../lib/avatar-mouth';
import { getAvatarCaptionPosition } from '../lib/avatar-caption';
import type { AvatarEmotion } from '../../shared/avatar-emotion';
import { AvatarAnimator, classifyAvatarHit, EMPTY_AVATAR_CAPABILITIES, getAvatarHandRegions, type AvatarCapabilities, type AvatarCommand } from '../lib/avatar-animation';
import type { PlaybackCaption } from '../lib/playback-captions';
import { AvatarSpeechCaption } from './avatar-speech-caption';
import { AvatarViewControls, type AvatarViewCommand } from './avatar-view-controls';
import { useI18n } from '../i18n/provider';
import { controlsMessages, type ControlsMessageKey } from '../i18n/messages/controls';

const MAX_BYTES = 30 * 1024 * 1024;

class AvatarError extends Error {
  readonly errorCode: `controls.${ControlsMessageKey}`;

  constructor(key: ControlsMessageKey) {
    super(controlsMessages.ja[`controls.${key}`]);
    this.errorCode = `controls.${key}`;
  }
}

function checkEmbeddedModel(buffer: ArrayBuffer) {
  if (buffer.byteLength > MAX_BYTES) throw new AvatarError('avatarErrorTooLarge');
  if (buffer.byteLength < 20) throw new AvatarError('avatarErrorInvalid');
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== buffer.byteLength) throw new AvatarError('avatarErrorBinary');
  const jsonSize = view.getUint32(12, true);
  if (view.getUint32(16, true) !== 0x4e4f534a || jsonSize + 20 > buffer.byteLength) throw new AvatarError('avatarErrorIncomplete');
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, jsonSize)));
  if (json.extensions?.VRMC_vrm?.specVersion !== '1.0' && json.extensions?.VRM?.specVersion !== '0.0') throw new AvatarError('avatarErrorVersion');
  const inspect = (value: unknown) => {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (key === 'uri' && typeof child === 'string' && !child.startsWith('data:')) throw new AvatarError('avatarErrorEmbedded');
      inspect(child);
    }
  };
  inspect(json);
}

function createLoader() {
  const manager = new THREE.LoadingManager();
  manager.setURLModifier((url) => {
    if (!url.startsWith('data:') && !url.startsWith('blob:')) throw new AvatarError('avatarErrorExternal');
    return url;
  });
  const loader = new GLTFLoader(manager);
  loader.register((parser) => new VRMLoaderPlugin(parser));
  return loader;
}

function relaxArms(vrm: VRM) {
  vrm.scene.updateMatrixWorld(true);
  for (const side of ['left', 'right'] as const) {
    const upper = vrm.humanoid.getNormalizedBoneNode(`${side}UpperArm`);
    const lower = vrm.humanoid.getNormalizedBoneNode(`${side}LowerArm`);
    if (!upper?.parent || !lower) continue;
    const from = lower.getWorldPosition(new THREE.Vector3()).sub(upper.getWorldPosition(new THREE.Vector3())).normalize();
    const to = new THREE.Vector3(from.x * 0.22, -1, 0.03).normalize();
    const parentRotation = upper.parent.getWorldQuaternion(new THREE.Quaternion());
    const delta = new THREE.Quaternion().setFromUnitVectors(from, to);
    upper.quaternion.premultiply(parentRotation.clone().invert().multiply(delta).multiply(parentRotation));
    upper.updateMatrixWorld(true);
  }
  vrm.update(0);
}

export function AvatarStage({ avatarUrl, state, audioLevelRef, name, framing, caption, emotion = 'neutral', command = null, onCapabilities }: { avatarUrl: string; state: ConversationState; audioLevelRef: MutableRefObject<number>; name: string; framing: number; caption: PlaybackCaption | null; emotion?: AvatarEmotion; command?: AvatarCommand | null; onCapabilities?: (capabilities: AvatarCapabilities) => void }) {
  const { t, formatError } = useI18n();
  const host = useRef<HTMLDivElement>(null);
  const captionHost = useRef<HTMLDivElement>(null);
  const stateRef = useRef(state);
  const framingRef = useRef(framing);
  const emotionRef = useRef(emotion);
  const capabilitiesCallback = useRef(onCapabilities);
  const engine = useRef<{ load: (url: string) => Promise<void>; reframe: () => void; trigger: (command: AvatarCommand) => void; view: (command: AvatarViewCommand) => void } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<AvatarError | AppError | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => { stateRef.current = state; }, [state]);
  useEffect(() => { emotionRef.current = emotion; }, [emotion]);
  useEffect(() => { capabilitiesCallback.current = onCapabilities; }, [onCapabilities]);
  useEffect(() => { framingRef.current = framing; engine.current?.reframe(); }, [framing]);
  useEffect(() => { if (command) engine.current?.trigger(command); }, [command]);

  useEffect(() => {
    const container = host.current;
    if (!container) return;
    let disposed = false;
    let frame = 0;
    let current: VRM | null = null;
    let animator: AvatarAnimator | null = null;
    let loadVersion = 0;
    let request: AbortController | null = null;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' });
    } catch {
      queueMicrotask(() => {
        if (!disposed) {
          setError(new AvatarError('avatarErrorWebGL'));
          setLoading(false);
          capabilitiesCallback.current?.(EMPTY_AVATAR_CAPABILITIES);
        }
      });
      return () => { disposed = true; };
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0x000000, 0);
    renderer.domElement.setAttribute('aria-hidden', 'true');
    container.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(27, 1, 0.01, 50);
    const controls = new OrbitControls(camera, renderer.domElement);
    const viewCamera = new AvatarCamera(camera, controls);
    viewCamera.setEnabled(false);
    const avatarGroup = new THREE.Group();
    scene.add(avatarGroup);
    const lookTarget = new THREE.Object3D();
    scene.add(lookTarget);
    // MToon already carries painted highlights; strong fill washes out the face.
    scene.add(new THREE.HemisphereLight(0xffffff, 0xded6cd, 1.15));
    const key = new THREE.DirectionalLight(0xfffaf1, 1.5);
    key.position.set(-2, 4, 4);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xe7f4f1, 0.4);
    fill.position.set(2, 2, -1);
    scene.add(fill);
    let subjectHeight = 1.6;
    const subjectSize = new THREE.Vector3(0.6, subjectHeight, 0.3);
    const subjectCenter = new THREE.Vector3(0, subjectHeight / 2, 0);
    const reframe = () => viewCamera.reset(framingRef.current, animator?.camera ?? 0);
    const view = (command: AvatarViewCommand) => {
      if (!controls.enabled || !current) return;
      if (command === 'reset') reframe();
      else if (command === 'zoomIn' || command === 'zoomOut') viewCamera.zoom(command === 'zoomIn');
      else viewCamera.rotate(command === 'rotateLeft');
    };
    const resize = () => {
      const width = Math.max(container.clientWidth, 1);
      const height = Math.max(container.clientHeight, 1);
      renderer.setSize(width, height, false);
      viewCamera.resize(width / height, framingRef.current, animator?.camera ?? 0);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    let reducedMotion = motionQuery.matches;
    viewCamera.setReducedMotion(reducedMotion);
    const onMotion = () => { reducedMotion = motionQuery.matches; viewCamera.setReducedMotion(reducedMotion); };
    motionQuery.addEventListener('change', onMotion);
    let nextBlink = 2.8;
    let blinkStarted = -1;
    const clock = new THREE.Clock();
    let elapsed = 0;
    let mouth = 0;
    const gaze = new THREE.Vector2();
    const gazeTarget = new THREE.Vector2();
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const gesture = new AvatarTapGesture();
    const trigger = (value: AvatarCommand) => { animator?.trigger(value); };
    const hitAvatar = (clientX: number, clientY: number) => {
      if (!current || !animator) return null;
      const rect = renderer.domElement.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return null;
      pointer.set((clientX - rect.left) / rect.width * 2 - 1, 1 - (clientY - rect.top) / rect.height * 2);
      current.scene.updateMatrixWorld(true);
      // Skinned bounds otherwise remain in an earlier pose and miss raised hands.
      current.scene.traverse((object) => {
        if (object instanceof THREE.SkinnedMesh) {
          object.skeleton.update();
          object.computeBoundingSphere();
          if (object.boundingBox) object.computeBoundingBox();
        }
      });
      camera.updateMatrixWorld(true);
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObject(current.scene, true).find(({ object }) => {
        for (let node: THREE.Object3D | null = object; node; node = node.parent) if (!node.visible) return false;
        return object instanceof THREE.Mesh;
      });
      if (!hit) return null;
      const headBone = current.humanoid.getRawBoneNode('head');
      const neckBone = current.humanoid.getRawBoneNode('neck');
      const head = headBone?.getWorldPosition(new THREE.Vector3()) ?? null;
      if (head) {
        const up = neckBone ? head.clone().sub(neckBone.getWorldPosition(new THREE.Vector3())).normalize() : new THREE.Vector3(0, 1, 0);
        head.addScaledVector(up, subjectHeight * 0.045);
      }
      const hands = getAvatarHandRegions(current);
      const target = classifyAvatarHit(hit.point, subjectHeight, head, hands);
      return animator.capabilities.interactions.includes(target) ? target : null;
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!controls.enabled) return;
      gesture.down(event);
    };
    const onPointerMove = (event: PointerEvent) => {
      gesture.move(event);
      if (event.pointerType !== 'mouse' || reducedMotion) return;
      const rect = renderer.domElement.getBoundingClientRect();
      gazeTarget.set(THREE.MathUtils.clamp((event.clientX - rect.left) / rect.width * 2 - 1, -1, 1), THREE.MathUtils.clamp(1 - (event.clientY - rect.top) / rect.height * 2, -1, 1));
    };
    const onPointerUp = (event: PointerEvent) => {
      if (!gesture.up(event) || !controls.enabled) return;
      const target = hitAvatar(event.clientX, event.clientY);
      if (target) trigger({ id: event.timeStamp, kind: 'interaction', target });
    };
    const onPointerLeave = () => { gazeTarget.set(0, 0); gesture.cancel(); };
    const onPointerCancel = () => { gesture.cancel(); };
    const canvas = renderer.domElement;
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointerleave', onPointerLeave);
    canvas.addEventListener('pointercancel', onPointerCancel);
    canvas.addEventListener('lostpointercapture', onPointerCancel);
    canvas.addEventListener('wheel', onPointerCancel, { passive: true });
    const captionPoint = new THREE.Vector3();
    const positionCaption = () => {
      const node = captionHost.current;
      if (!node) return;
      const head = current?.humanoid.getRawBoneNode('jaw') ?? current?.humanoid.getRawBoneNode('head');
      if (!head || !node.firstElementChild) { node.style.visibility = 'hidden'; return; }
      head.getWorldPosition(captionPoint);
      // Head bones sit near the base of the face; a model-relative offset clears the chin.
      captionPoint.y -= subjectHeight * 0.015;
      captionPoint.project(camera);
      const position = getAvatarCaptionPosition(captionPoint,
        { width: container.clientWidth, height: container.clientHeight },
        { width: node.offsetWidth, height: node.offsetHeight });
      node.style.visibility = position ? 'visible' : 'hidden';
      if (position) node.style.transform = `translate3d(${position.x}px, ${position.y}px, 0) translateX(-50%)`;
    };
    const animate = () => {
      if (disposed) return;
      frame = requestAnimationFrame(animate);
      const delta = Math.min(clock.getDelta(), 0.05);
      elapsed += delta;
      if (current && animator) {
        mouth = getMouthOpenness(mouth, audioLevelRef.current, delta);
        current.expressionManager?.setValue('aa', mouth);
        if (reducedMotion) { gazeTarget.set(0, 0); gaze.set(0, 0); }
        gaze.lerp(gazeTarget, 1 - Math.exp(-delta * 8));
        const tilt = stateRef.current === 'thinking' ? 0.075 : stateRef.current === 'listening' ? -0.025 : 0;
        animator.update(delta, { elapsed, reducedMotion, emotion: emotionRef.current, speaking: stateRef.current === 'speaking' || mouth > 0, tilt, gazeX: gaze.x, gazeY: gaze.y });
        viewCamera.update(framingRef.current, animator.camera);
        if (!reducedMotion) {
          avatarGroup.position.y = Math.sin(elapsed * 1.5) * subjectHeight * AVATAR_BOB_RATIO;
          if (elapsed > nextBlink) { blinkStarted = elapsed; nextBlink = elapsed + 3.2 + Math.random() * 3; }
          const blinkAge = elapsed - blinkStarted;
          current.expressionManager?.setValue('blink', blinkStarted >= 0 && blinkAge < 0.18 ? Math.sin((blinkAge / 0.18) * Math.PI) : 0);
        } else {
          avatarGroup.position.y = 0;
          current.expressionManager?.setValue('blink', 0);
        }
        const head = current.humanoid.getRawBoneNode('head');
        if (head && current.lookAt) {
          if (reducedMotion || gaze.lengthSq() < 0.00001) current.lookAt.reset();
          head.getWorldPosition(lookTarget.position);
          lookTarget.position.x += gaze.x * subjectHeight * 0.45;
          lookTarget.position.y += gaze.y * subjectHeight * 0.3;
          lookTarget.position.z += subjectHeight * 2;
          current.lookAt.target = reducedMotion || gaze.lengthSq() < 0.00001 ? null : lookTarget;
        }
        current.update(delta);
      }
      renderer.render(scene, camera);
      positionCaption();
    };
    const load = async (url: string) => {
      const version = ++loadVersion;
      request?.abort();
      const controller = new AbortController();
      request = controller;
      animator = null;
      viewCamera.setEnabled(false);
      gesture.cancel();
      gaze.set(0, 0);
      gazeTarget.set(0, 0);
      avatarGroup.position.y = 0;
      if (current) { avatarGroup.remove(current.scene); VRMUtils.deepDispose(current.scene); current = null; }
      capabilitiesCallback.current?.(EMPTY_AVATAR_CAPABILITIES);
      setLoading(true);
      setError(null);
      try {
        const privateAvatar = url.startsWith('/api/');
        if (privateAvatar) await ensureBrowserSession();
        if (disposed || version !== loadVersion) return;
        const resolved = privateAvatar ? `${SERVICE_URL}${url}` : url;
        const response = await fetch(resolved, { signal: controller.signal, credentials: privateAvatar ? (SERVICE_URL ? 'include' : 'same-origin') : 'omit' });
        if (privateAvatar && response.status === 401) throw new AppError(APP_ERROR_MESSAGES.browserSessionRequired);
        if (!response.ok) throw new AvatarError('avatarErrorFetch');
        const buffer = await response.arrayBuffer();
        checkEmbeddedModel(buffer);
        const gltf = await createLoader().parseAsync(buffer, '');
        const next = gltf.userData.vrm as VRM | undefined;
        if (!next) { VRMUtils.deepDispose(gltf.scene); throw new AvatarError('avatarErrorLoad'); }
        if (disposed || version !== loadVersion) { VRMUtils.deepDispose(next.scene); return; }
        VRMUtils.rotateVRM0(next);
        relaxArms(next);
        const bounds = new THREE.Box3().setFromObject(next.scene);
        bounds.getSize(subjectSize);
        subjectHeight = subjectSize.y || 1.6;
        subjectSize.y = subjectHeight;
        bounds.getCenter(subjectCenter);
        next.scene.traverse((object) => { object.frustumCulled = false; });
        avatarGroup.add(next.scene);
        current = next;
        animator = new AvatarAnimator(next);
        if (current.lookAt) current.lookAt.autoUpdate = true;
        mouth = 0;
        current.expressionManager?.setValue('aa', 0);
        viewCamera.setSubject(subjectSize, subjectCenter, framingRef.current);
        resize();
        viewCamera.setEnabled(true);
        setLoading(false);
        capabilitiesCallback.current?.(animator.capabilities);
      } catch (cause) {
        if (disposed || version !== loadVersion || (cause instanceof Error && cause.name === 'AbortError')) return;
        setLoading(false);
        setError((cause instanceof AvatarError || cause instanceof AppError) ? cause : new AvatarError('avatarErrorUnknown'));
      }
    };
    engine.current = { load, reframe, trigger, view };
    resize();
    animate();
    return () => {
      disposed = true;
      request?.abort();
      cancelAnimationFrame(frame);
      observer.disconnect();
      motionQuery.removeEventListener('change', onMotion);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointerleave', onPointerLeave);
      canvas.removeEventListener('pointercancel', onPointerCancel);
      canvas.removeEventListener('lostpointercapture', onPointerCancel);
      canvas.removeEventListener('wheel', onPointerCancel);
      viewCamera.dispose();
      if (current) VRMUtils.deepDispose(current.scene);
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
      engine.current = null;
    };
  }, [audioLevelRef]);

  useEffect(() => { void engine.current?.load(avatarUrl); }, [avatarUrl, retry]);

  return <div className="avatar-render" role="group" aria-label={t('controls.avatarDescription', { name })}>
    <div ref={host} className="avatar-canvas" />
    <AvatarViewControls disabled={loading || !!error} onCommand={(command) => engine.current?.view(command)} />
    <div ref={captionHost} className="avatar-speech-anchor" aria-hidden="true">
      {!loading && !error && caption && <AvatarSpeechCaption key={`${caption.turnId}:${caption.sentenceId}:${caption.status}`} caption={caption} />}
    </div>
    {loading && <div className="avatar-loading"><span className="loading-ring" /><span>{t('controls.avatarLoading', { name })}</span></div>}
    {error && <div className="avatar-error" role="alert"><p>{formatError(error)}</p><button className="text-button" onClick={() => setRetry((value) => value + 1)}>{t('controls.reload')}</button></div>}
  </div>;
}
