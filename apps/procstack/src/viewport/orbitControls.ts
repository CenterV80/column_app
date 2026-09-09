import * as THREE from "three";

/**
 * three.js の OrbitControls は使わず自前実装。
 * タッチ操作を細かく制御したい（1本指=回転 / 2本指=ピンチ+パン）ための意図的な選択。
 */
export interface CamState {
  theta: number;
  phi: number;
  radius: number;
  target: THREE.Vector3;
}

export function createCamState(): CamState {
  return { theta: 0.9, phi: 1.05, radius: 4, target: new THREE.Vector3(0, 0, 0) };
}

export function applyCamState(camera: THREE.PerspectiveCamera, cam: CamState) {
  cam.phi = Math.max(0.05, Math.min(Math.PI - 0.05, cam.phi));
  cam.radius = Math.max(0.3, Math.min(200, cam.radius));
  camera.position.set(
    cam.target.x + cam.radius * Math.sin(cam.phi) * Math.sin(cam.theta),
    cam.target.y + cam.radius * Math.cos(cam.phi),
    cam.target.z + cam.radius * Math.sin(cam.phi) * Math.cos(cam.theta)
  );
  camera.lookAt(cam.target);
}

export function attachOrbitControls(
  el: HTMLElement,
  camera: THREE.PerspectiveCamera,
  cam: CamState,
  onChange: () => void
) {
  const pointers = new Map<number, { x: number; y: number }>();
  let last: { x: number; y: number; dist?: number } | null = null;

  const down = (e: PointerEvent) => {
    el.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    last = null;
  };

  const move = (e: PointerEvent) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...pointers.values()];
    if (pts.length === 1) {
      if (last) {
        cam.theta -= (pts[0].x - last.x) * 0.008;
        cam.phi -= (pts[0].y - last.y) * 0.008;
      }
      last = { ...pts[0] };
    } else if (pts.length >= 2) {
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
      if (last && last.dist) {
        cam.radius *= last.dist / dist;
        const panScale = cam.radius * 0.0022;
        const right = new THREE.Vector3().subVectors(camera.position, cam.target).cross(camera.up).normalize();
        const up = new THREE.Vector3().crossVectors(right, new THREE.Vector3().subVectors(camera.position, cam.target)).normalize();
        cam.target.addScaledVector(right, -(mid.x - last.x) * panScale);
        cam.target.addScaledVector(up, -(mid.y - last.y) * panScale);
      }
      last = { x: mid.x, y: mid.y, dist };
    }
    onChange();
  };

  const up = (e: PointerEvent) => {
    pointers.delete(e.pointerId);
    last = null;
  };

  const wheel = (e: WheelEvent) => {
    e.preventDefault();
    cam.radius *= 1 + Math.sign(e.deltaY) * 0.1;
    onChange();
  };

  el.addEventListener("pointerdown", down);
  el.addEventListener("pointermove", move);
  el.addEventListener("pointerup", up);
  el.addEventListener("pointercancel", up);
  el.addEventListener("wheel", wheel, { passive: false });

  return () => {
    el.removeEventListener("pointerdown", down);
    el.removeEventListener("pointermove", move);
    el.removeEventListener("pointerup", up);
    el.removeEventListener("pointercancel", up);
    el.removeEventListener("wheel", wheel);
  };
}
