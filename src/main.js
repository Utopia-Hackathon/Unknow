import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildScene, buildFloorsAndStores } from './scene.js';
import { FLOORS, STORES, setFlowLevel, queueOf } from './mockData.js';
import { updateStoreHeat } from './dataLink.js';
import { generateSuggest } from './aiSuggest.js';

const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const scene = buildScene();
const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 200);
camera.position.set(20, 18, 24);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 4, 0);
controls.enableDamping = true;

const storeMeshes = buildFloorsAndStores(scene, FLOORS, STORES);
updateStoreHeat(storeMeshes, STORES);

function resize() {
  const w = canvas.clientWidth || window.innerWidth;
  const h = canvas.clientHeight || window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

function animate() {
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}
animate();

// ---- HUD 交互 ----
const flowInput = document.getElementById('flow');
const panel = document.getElementById('panel');
const aiOutput = document.getElementById('ai-output');

flowInput.addEventListener('input', () => {
  setFlowLevel(Number(flowInput.value));
  updateStoreHeat(storeMeshes, STORES);
});

document.getElementById('suggest').addEventListener('click', async () => {
  aiOutput.textContent = '正在生成建议…';
  const text = await generateSuggest();
  aiOutput.textContent = text;
});

// 点击店铺点位：射线检测 + 显示详情
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

canvas.addEventListener('click', (ev) => {
  const rect = canvas.getBoundingClientRect();
  pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(
    [...storeMeshes.values()].map((e) => e.mesh)
  );
  if (hits.length > 0) {
    const store = hits[0].object.userData;
    const data = STORES.find((s) => s.id === store.storeId);
    panel.innerHTML = `<strong>${store.name}</strong><br/>业态：${data.type}<br/>当前排队约 ${queueOf(data)} 人`;
  }
});
