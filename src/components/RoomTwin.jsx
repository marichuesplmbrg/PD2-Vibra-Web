import React, { useEffect, useRef } from "react";
import * as THREE from "three";

/* Fitted shell, detected floor edges, glowing billboarded sprite
   markers for hot / dead zones, and a manual drag orbit (no
   OrbitControls). Idle auto-rotation stops on drag and respects
   reduced-motion. */

export default function RoomTwin({ room, markers, colors }) {
  const mountRef = useRef(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    mount.appendChild(renderer.domElement);
    renderer.domElement.style.display = "block";
    renderer.domElement.style.cursor = "grab";

    // Mirrored world group for correct handedness.
    const world = new THREE.Group();
    world.scale.x = -1;
    scene.add(world);

    const W = room.width || 1;
    const L = room.length || 1;
    const H = room.height || 1;

    // Faint translucent shell volume.
    const shellGeo = new THREE.BoxGeometry(W, H, L);
    const shellMesh = new THREE.Mesh(
      shellGeo,
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(colors.shell),
        transparent: true,
        opacity: 0.05,
        depthWrite: false,
        side: THREE.BackSide,
      })
    );
    world.add(shellMesh);

    // Shell wireframe.
    world.add(
      new THREE.LineSegments(
        new THREE.EdgesGeometry(shellGeo),
        new THREE.LineBasicMaterial({
          color: new THREE.Color(colors.shell),
          transparent: true,
          opacity: 0.85,
        })
      )
    );

    // Detected floor edges (amber).
    const f = [
      new THREE.Vector3(-W / 2, -H / 2, -L / 2),
      new THREE.Vector3(W / 2, -H / 2, -L / 2),
      new THREE.Vector3(W / 2, -H / 2, L / 2),
      new THREE.Vector3(-W / 2, -H / 2, L / 2),
      new THREE.Vector3(-W / 2, -H / 2, -L / 2),
    ];
    world.add(
      new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(f),
        new THREE.LineBasicMaterial({ color: new THREE.Color(colors.edge) })
      )
    );

    // Floor grid.
    const grid = new THREE.GridHelper(
      Math.max(W, L),
      Math.max(1, Math.round(Math.max(W, L))),
      new THREE.Color(colors.line),
      new THREE.Color(colors.line)
    );
    grid.position.y = -H / 2 + 0.002;
    grid.material.transparent = true;
    grid.material.opacity = 0.4;
    world.add(grid);

    // Glowing sprite marker with radial-gradient canvas texture.
    const makeSprite = (hex, scale) => {
      const size = 128;
      const cv = document.createElement("canvas");
      cv.width = cv.height = size;
      const ctx = cv.getContext("2d");
      const c = new THREE.Color(hex);
      const r = Math.round(c.r * 255);
      const g = Math.round(c.g * 255);
      const b = Math.round(c.b * 255);
      const grad = ctx.createRadialGradient(
        size / 2, size / 2, 0,
        size / 2, size / 2, size / 2
      );
      grad.addColorStop(0, `rgba(${r},${g},${b},0.95)`);
      grad.addColorStop(0.35, `rgba(${r},${g},${b},0.55)`);
      grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, size, size);
      const sp = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: new THREE.CanvasTexture(cv),
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        })
      );
      sp.scale.set(scale, scale, scale);
      return sp;
    };

    const markerScale = Math.max(W, L, H) * 0.28;
    const addMarkers = (list = [], hex) =>
      list.forEach((m) => {
        const s = makeSprite(hex, markerScale);
        s.position.set(m.x, m.y - H / 2, m.z);
        world.add(s);
      });
    addMarkers(markers.hot, colors.hot);
    addMarkers(markers.dead, colors.dead);

    scene.add(new THREE.AmbientLight(0xffffff, 0.9));

    // ---- manual orbit ----
    const target = new THREE.Vector3(0, 0, 0);
    const radius = Math.max(W, L, H) * 1.85;
    let az = 0.9;
    let pol = 1.05;
    let autoRotate = !window.matchMedia("(prefers-reduced-motion: reduce)")
      .matches;

    const applyCamera = () => {
      pol = Math.max(0.25, Math.min(Math.PI - 0.25, pol));
      camera.position.set(
        target.x + radius * Math.sin(pol) * Math.cos(az),
        target.y + radius * Math.cos(pol),
        target.z + radius * Math.sin(pol) * Math.sin(az)
      );
      camera.lookAt(target);
    };
    applyCamera();

    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    const onDown = (e) => {
      dragging = true;
      autoRotate = false;
      lastX = e.clientX;
      lastY = e.clientY;
      renderer.domElement.style.cursor = "grabbing";
    };
    const onMove = (e) => {
      if (!dragging) return;
      az -= (e.clientX - lastX) * 0.006;
      pol -= (e.clientY - lastY) * 0.006;
      lastX = e.clientX;
      lastY = e.clientY;
      applyCamera();
    };
    const onUp = () => {
      dragging = false;
      renderer.domElement.style.cursor = "grab";
    };
    renderer.domElement.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);

    // ---- resize ----
    const resize = () => {
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(mount);
    resize();

    // ---- loop ----
    let raf = 0;
    const tick = () => {
      if (autoRotate) {
        az += 0.0016;
        applyCamera();
      }
      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    };
    tick();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      renderer.dispose();
      if (renderer.domElement.parentNode) {
        renderer.domElement.parentNode.removeChild(renderer.domElement);
      }
    };
  }, [room, markers, colors]);

  return <div ref={mountRef} style={{ position: "absolute", inset: 0 }} />;
}
