// Trusted, browser-only studio shared by generated simulators. No network or assets.
import * as THREE from 'three';

export function ringGeometry({outerRadius = 1, innerRadius = 0.7, depth = 0.3, bevel = 0.02, segments = 64} = {}) {
  if (!(outerRadius > innerRadius && innerRadius > 0 && depth > 0)) throw new Error('invalid_ring_dimensions');
  const edge = Math.max(0, Math.min(bevel, (outerRadius - innerRadius) / 4, depth / 4));
  const points = [];
  const corner = (r, y, start) => {
    for (let step = 0; step <= 4; step++) {
      const angle = start + step / 4 * Math.PI / 2;
      points.push(new THREE.Vector2(r + Math.cos(angle) * edge, y + Math.sin(angle) * edge));
    }
  };
  if (edge) {
    corner(outerRadius - edge, -depth / 2 + edge, -Math.PI / 2);
    corner(outerRadius - edge, depth / 2 - edge, 0);
    corner(innerRadius + edge, depth / 2 - edge, Math.PI / 2);
    corner(innerRadius + edge, -depth / 2 + edge, Math.PI);
  } else {
    points.push(new THREE.Vector2(outerRadius, -depth / 2), new THREE.Vector2(outerRadius, depth / 2), new THREE.Vector2(innerRadius, depth / 2), new THREE.Vector2(innerRadius, -depth / 2));
  }
  points.push(points[0].clone());
  // LatheGeometry shares its angular normals, so a polished cylinder does not
  // reveal the faceted normals of a non-indexed extrusion.
  const geometry = new THREE.LatheGeometry(points, Math.max(24, Math.min(segments, 128)));
  geometry.rotateX(Math.PI / 2);
  return geometry;
}

export function createMechanicalStage({container, background = '#f2f1ee', floor = true, onInteract = () => {}} = {}) {
  if (!container?.appendChild) throw new Error('stage_container_required');
  const canvas = document.createElement('canvas');
  Object.assign(canvas.style, {display: 'block', width: '100%', height: '100%', touchAction: 'none'});
  canvas.setAttribute('aria-label', '3D 模型，可拖动旋转、滚轮或双指缩放');
  container.appendChild(canvas);
  const renderer = new THREE.WebGLRenderer({canvas, antialias: true, alpha: false, powerPreference: 'high-performance'});
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.75));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.VSMShadowMap;
  renderer.localClippingEnabled = true;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(background);
  const camera = new THREE.PerspectiveCamera(32, 1, 0.01, 1000);
  const environment = new THREE.Scene();
  environment.background = new THREE.Color('#b7b9bd');
  const addBox = (width, height, position, strength) => {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({color: new THREE.Color().setScalar(strength), side: THREE.DoubleSide}));
    mesh.position.set(...position); mesh.lookAt(0, 0, 0); environment.add(mesh);
  };
  addBox(10, 10, [0, 12, 2], 2.7);
  addBox(3, 12, [-10, 3, 6], 3.2);
  addBox(4, 10, [9, 4, -4], 2.3);
  addBox(12, 2, [0, 1, 10], 1.5);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const environmentTarget = pmrem.fromScene(environment, 0.04);
  scene.environment = environmentTarget.texture;
  scene.environmentIntensity = 0.65;
  pmrem.dispose();
  environment.traverse(object => {object.geometry?.dispose(); object.material?.dispose();});
  const key = new THREE.DirectionalLight('#fff7ef', 3.1);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.bias = -0.0002;
  key.shadow.radius = 5;
  key.shadow.blurSamples = 12;
  scene.add(key, key.target);
  const fill = new THREE.DirectionalLight('#dbe8ff', 1.1);
  scene.add(fill);
  scene.add(new THREE.HemisphereLight('#ffffff', '#b2ada5', 1.2));
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShadowMaterial({color: '#57534e', opacity: 0.2, depthWrite: false}));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  ground.visible = floor;
  scene.add(ground);
  const target = new THREE.Vector3();
  const orbit = new THREE.Spherical(8, Math.PI / 2.8, Math.PI / 4);
  let radius = 1;
  let width = 1; let height = 1;
  let fitted = false;
  const poseCamera = () => {
    orbit.phi = THREE.MathUtils.clamp(orbit.phi, 0.04, Math.PI - 0.04);
    orbit.radius = THREE.MathUtils.clamp(orbit.radius, radius * 0.7, radius * 20);
    camera.position.setFromSpherical(orbit).add(target);
    camera.lookAt(target);
    camera.updateMatrixWorld();
  };
  const resize = () => {
    const bounds = container.getBoundingClientRect();
    width = Math.max(1, Math.round(bounds.width)); height = Math.max(1, Math.round(bounds.height));
    const previousAspect = camera.aspect;
    renderer.setSize(width, height, false); camera.aspect = width / height; camera.updateProjectionMatrix();
    if (fitted && previousAspect !== camera.aspect) {
      const halfFov = THREE.MathUtils.degToRad(camera.fov / 2);
      const before = Math.min(halfFov, Math.atan(Math.tan(halfFov) * previousAspect));
      const after = Math.min(halfFov, Math.atan(Math.tan(halfFov) * camera.aspect));
      orbit.radius *= Math.sin(before) / Math.sin(after);
      poseCamera();
    }
  };
  const fit = (object, {padding = 1.25, direction = [4, 2.4, 4]} = {}) => {
    resize(); object.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(object);
    if (box.isEmpty()) return;
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    target.copy(sphere.center); radius = Math.max(sphere.radius, 0.0001);
    const halfFov = THREE.MathUtils.degToRad(camera.fov / 2);
    const effectiveFov = Math.min(halfFov, Math.atan(Math.tan(halfFov) * camera.aspect));
    const distance = radius / Math.sin(effectiveFov) * Math.max(1.05, padding);
    const offset = new THREE.Vector3(...direction);
    if (offset.lengthSq() < 0.00001) offset.set(4, 2.4, 4);
    orbit.setFromVector3(offset.normalize().multiplyScalar(distance));
    camera.near = Math.max(radius / 1000, 0.00001); camera.far = radius * 100;
    camera.updateProjectionMatrix();
    ground.position.set(target.x, box.min.y - radius * 0.006, target.z);
    ground.scale.setScalar(radius * 14);
    key.position.copy(target).add(new THREE.Vector3(-2.5, 4, 3).multiplyScalar(radius));
    key.target.position.copy(target);
    Object.assign(key.shadow.camera, {left: -radius * 2, right: radius * 2, top: radius * 2, bottom: -radius * 2, near: radius * 0.1, far: radius * 12});
    key.shadow.camera.updateProjectionMatrix();
    key.shadow.normalBias = radius * 0.002;
    fill.position.copy(target).add(new THREE.Vector3(3, 1.5, -2).multiplyScalar(radius));
    fitted = true;
    poseCamera();
  };
  const setView = name => {
    const views = {front: [0, 0.02, 1], side: [1, 0.02, 0], top: [0.01, 1, 0], perspective: [4, 2.4, 4]};
    if (!Object.hasOwn(views, name)) return;
    orbit.setFromVector3(new THREE.Vector3(...views[name]).normalize().multiplyScalar(orbit.radius)); poseCamera();
  };
  const pointers = new Map();
  let pinchDistance = 0;
  const pinch = () => { const [a, b] = [...pointers.values()]; return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0; };
  const down = event => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    pointers.set(event.pointerId, {x: event.clientX, y: event.clientY});
    canvas.setPointerCapture(event.pointerId); pinchDistance = pinch(); onInteract();
  };
  const move = event => {
    const previous = pointers.get(event.pointerId); if (!previous) return;
    pointers.set(event.pointerId, {x: event.clientX, y: event.clientY});
    if (pointers.size === 1) {
      orbit.theta -= (event.clientX - previous.x) * 0.006;
      orbit.phi -= (event.clientY - previous.y) * 0.006;
    } else {
      const distance = pinch(); if (pinchDistance > 0 && distance > 0) orbit.radius *= pinchDistance / distance; pinchDistance = distance;
    }
    poseCamera(); onInteract();
  };
  const up = event => {pointers.delete(event.pointerId); pinchDistance = pinch();};
  const wheel = event => {event.preventDefault(); orbit.radius *= Math.exp(THREE.MathUtils.clamp(event.deltaY, -100, 100) * 0.0015); poseCamera(); onInteract();};
  canvas.addEventListener('pointerdown', down); canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('wheel', wheel, {passive: false});
  const observer = new ResizeObserver(resize); observer.observe(container);
  resize(); poseCamera();
  const projected = new THREE.Vector3();
  const project = point => {
    projected.copy(point).project(camera);
    return {x: (projected.x * 0.5 + 0.5) * width, y: (-projected.y * 0.5 + 0.5) * height, visible: projected.z >= -1 && projected.z <= 1 && Math.abs(projected.x) <= 1 && Math.abs(projected.y) <= 1};
  };
  const dispose = () => {
    observer.disconnect();
    canvas.removeEventListener('pointerdown', down); canvas.removeEventListener('pointermove', move);
    canvas.removeEventListener('pointerup', up); canvas.removeEventListener('pointercancel', up); canvas.removeEventListener('wheel', wheel);
    environmentTarget.dispose(); ground.geometry.dispose(); ground.material.dispose(); key.shadow.map?.dispose(); renderer.dispose(); canvas.remove();
  };
  return {scene, camera, renderer, canvas, fit, setView, resize, project, render: () => renderer.render(scene, camera), dispose};
}
