import { useEffect, useRef } from "react";
import * as THREE from "three";
import type { Geo } from "../geo/types";
import { C } from "../theme";
import { applyCamState, attachOrbitControls, createCamState, type CamState } from "./orbitControls";

interface ViewportState {
  mesh: THREE.Mesh;
  wire: THREE.LineSegments;
  points: THREE.Points;
  cam: CamState;
  applyCam: () => void;
}

interface ViewportProps {
  geo: Geo | null;
  frameKey: number;
}

export function Viewport({ geo, frameKey }: ViewportProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const state = useRef<ViewportState | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    host.appendChild(renderer.domElement);
    renderer.domElement.style.touchAction = "none";
    renderer.domElement.style.display = "block";

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 1000);

    const hemi = new THREE.HemisphereLight(0xdfe8f5, 0x30343c, 0.85);
    scene.add(hemi);
    const key = new THREE.DirectionalLight(0xffffff, 0.75);
    key.position.set(3, 5, 2);
    scene.add(key);

    const floor = new THREE.GridHelper(10, 10, 0x39414d, 0x272c34);
    (floor.material as THREE.Material).transparent = true;
    (floor.material as THREE.Material).opacity = 0.55;
    scene.add(floor);

    const mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(C.surface),
      roughness: 0.55,
      metalness: 0.0,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat);
    scene.add(mesh);

    const wireMat = new THREE.LineBasicMaterial({
      color: 0x0d0f12,
      transparent: true,
      opacity: 0.28,
    });
    const wire = new THREE.LineSegments(new THREE.BufferGeometry(), wireMat);
    scene.add(wire);

    // scatter等、indicesが空の点群Geo用の描画パス
    const pointsMat = new THREE.PointsMaterial({
      color: new THREE.Color(C.accent),
      size: 0.06,
      sizeAttenuation: true,
    });
    const points = new THREE.Points(new THREE.BufferGeometry(), pointsMat);
    points.visible = false;
    scene.add(points);

    const cam = createCamState();
    const applyCam = () => applyCamState(camera, cam);

    const el = renderer.domElement;
    const detachControls = attachOrbitControls(el, camera, cam, applyCam);

    // renderer.setSize(w, h, false) は使わない。updateStyle=false にすると
    // canvas に CSS サイズが付かず、devicePixelRatio>1 の端末で canvas が
    // 実寸の2倍に広がり下のパネルのタップを吸ってしまう。
    const resize = () => {
      const w = host.clientWidth, h = host.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(host);
    resize();
    applyCam();

    let raf: number;
    const loop = () => {
      renderer.render(scene, camera);
      raf = requestAnimationFrame(loop);
    };
    loop();

    state.current = { mesh, wire, points, cam, applyCam };

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      detachControls();
      mesh.geometry.dispose();
      wire.geometry.dispose();
      points.geometry.dispose();
      mat.dispose();
      wireMat.dispose();
      pointsMat.dispose();
      renderer.dispose();
      host.removeChild(el);
    };
  }, []);

  // Geo -> BufferGeometry (indicesが空なら点群としてTHREE.Pointsで描画する)
  useEffect(() => {
    const s = state.current;
    if (!s) return;
    const isPointCloud = !!geo && geo.points.length > 0 && geo.indices.length === 0;

    s.mesh.visible = !isPointCloud;
    s.wire.visible = !isPointCloud;
    s.points.visible = isPointCloud;

    if (isPointCloud && geo) {
      const pbg = new THREE.BufferGeometry();
      pbg.setAttribute("position", new THREE.BufferAttribute(geo.points, 3));
      pbg.computeBoundingSphere();
      s.points.geometry.dispose();
      s.points.geometry = pbg;
    } else {
      const bg = new THREE.BufferGeometry();
      if (geo && geo.points.length) {
        bg.setAttribute("position", new THREE.BufferAttribute(geo.points, 3));
        const n = geo.attribs.point.N;
        if (n) bg.setAttribute("normal", new THREE.BufferAttribute(n as Float32Array, 3));
        bg.setIndex(new THREE.BufferAttribute(geo.indices, 1));
        if (!n) bg.computeVertexNormals();
        bg.computeBoundingSphere();
      }
      s.mesh.geometry.dispose();
      s.mesh.geometry = bg;
      s.wire.geometry.dispose();
      s.wire.geometry = geo && geo.points.length ? new THREE.WireframeGeometry(bg) : new THREE.BufferGeometry();
    }
  }, [geo]);

  // フレーム
  useEffect(() => {
    const s = state.current;
    if (!s || !geo || !geo.points.length) return;
    const activeGeom = geo.indices.length === 0 ? s.points.geometry : s.mesh.geometry;
    const bs = activeGeom.boundingSphere;
    if (!bs) return;
    s.cam.target.copy(bs.center);
    s.cam.radius = Math.max(0.5, bs.radius * 2.8);
    s.applyCam();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frameKey]);

  return <div ref={hostRef} style={{ position: "absolute", inset: 0, overflow: "hidden" }} />;
}
