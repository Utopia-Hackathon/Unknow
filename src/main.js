import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { buildScene } from './scene.js';
import { loadStores, CATALOG_NO_COORDS } from './mockData.js';
import { createFloorView } from './floorView.js';
import { searchStores } from './search.js';
import { createGuide } from './guide.js';
import { createPerfMonitor, pixelRatioFor } from './perf.js';
import { createStorefront, facingToAtrium, STORE_BOX } from './storefront.js';
import { loadStorefront } from './texturePipeline.js';
import { createShell } from './shell.js';

const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(pixelRatioFor(0));

const scene = buildScene();
const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 400);
// 总览默认机位：套上建筑外壳（约 40m 高）之后必须退远，
// 原来的 (20,18,24) 只框得住三层楼板，外壳会把画面撑破。
const VIEW_HOME = { x: 38, y: 26, z: 46, tx: 0, ty: 0, tz: 0 };
camera.position.set(VIEW_HOME.x, VIEW_HOME.y, VIEW_HOME.z);

const orbit = new OrbitControls(camera, renderer.domElement);
orbit.target.set(VIEW_HOME.tx, VIEW_HOME.ty, VIEW_HOME.tz);
orbit.enableDamping = true;

const pointer = new PointerLockControls(camera, renderer.domElement);

const ui = {
  floorBar: document.getElementById('floor-bar'),
  searchInput: document.getElementById('search-input'),
  searchBtn: document.getElementById('search-btn'),
  results: document.getElementById('results'),
  panel: document.getElementById('panel'),
  viewBtn: document.getElementById('view-btn'),
  stepBtn: document.getElementById('step-btn'),
  nextBtn: document.getElementById('next-btn'),
  dataBadge: document.getElementById('data-badge'),
};

let floors = [];
let stores = [];
let floorView;
let shell;
let guide;
let storeMeshes = new Map();
let viewMode = 'orbit';
let stepMode = false;
let startStoreId = null;
const keys = new Set();

// 帧率监控（Issue #19 / E-03）。默认不显示 HUD，答辩画面里不能出现调试面板；
// 验收时用 ?debug=1 打开，控制台有 window.__perf.stats() / dump() 可落盘 JSON。
const perf = createPerfMonitor({
  debug: new URLSearchParams(location.search).has('debug'),
  onLevelChange: (levelIndex) => applyQuality(levelIndex),
});

// 降档只降画质，不降交互：像素比先降，L2 再让场景侧关掉次要细节。
function applyQuality(levelIndex) {
  renderer.setPixelRatio(pixelRatioFor(levelIndex));
  const w = canvas.clientWidth || window.innerWidth;
  const h = canvas.clientHeight || window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  // floorView / shell 在 init() 里才创建；降档可能在它之前触发，用可选调用。
  if (levelIndex >= 2) {
    if (typeof floorView?.setDetailLevel === 'function') floorView.setDetailLevel(2);
    if (typeof shell?.setDetailLevel === 'function') shell.setDetailLevel(2);
  }
}

function resize() {
  const w = canvas.clientWidth || window.innerWidth;
  const h = canvas.clientHeight || window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

function setMessage(text, kind = 'info') {
  if (!ui.panel) return;
  ui.panel.className = `hud-panel ${kind}`;
  ui.panel.innerHTML = text;
}

// 门脸体块（D008）：替换原来的 1.6³ 纯色方块。
// 有贴图用贴图、无图用文字招牌，两条路都在 texturePipeline / storefront 里，
// 这里只负责摆位与朝向——店正面朝中庭，相机飞近时看到的是门脸而不是后墙。
function buildStoreMeshes() {
  for (const entry of storeMeshes.values()) {
    entry.group.parent?.remove(entry.group);
    entry.group.traverse((o) => {
      if (o.isMesh) {
        o.geometry?.dispose();
        if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
        else o.material?.dispose();
      }
    });
  }
  storeMeshes = new Map();

  for (const s of stores) {
    const floor = floors.find((f) => f.id === s.floor);
    if (!floor) continue;
    const top = floorView.getFloorTop(s.floor);
    const { dirX, dirZ, rotY } = facingToAtrium(s);
    const entry = createStorefront(s, { floorLabel: floor.name });
    // 体块深 3m：中心后退 d/2，让「正面」正好落在点位坐标上，
    // 这样 entrance（点位外侧 1.5m）才确实站在门外，而不是嵌进门脸里。
    entry.group.position.set(s.x - dirX * (STORE_BOX.d / 2), top, s.z - dirZ * (STORE_BOX.d / 2));
    entry.group.rotation.y = rotY;
    floorView.getGroup(s.floor).add(entry.group);
    storeMeshes.set(s.id, entry);
  }

  // 贴图按表加载（texturePipeline.TEXTURES）。表里没有 = 保持文字招牌，
  // 这是 11-29 采集前的正常状态，不是失败。
  for (const s of stores) {
    loadStorefront(s.id).then((tex) => {
      if (!tex) return;
      storeMeshes.get(s.id)?.setVisual({ texture: tex });
    });
  }
}

function highlightFloorButton(floorId) {
  if (!ui.floorBar) return;
  [...ui.floorBar.querySelectorAll('button')]
    .forEach((b) => b.classList.toggle('active', b.dataset.floor === floorId));
}

// 切层时相机跟着楼层走（A01：保留水平视角、只挪高度）。
// 原来切层只是改可见性，镜头还停在整栋楼外面，切到 8F 看到的是一块远处的小板。
function focusFloor(floorId) {
  if (viewMode !== 'orbit') return; // 第一人称由玩家自己走，不抢镜头
  if (floorId === 'all') {
    camera.position.set(VIEW_HOME.x, VIEW_HOME.y, VIEW_HOME.z);
    orbit.target.set(VIEW_HOME.tx, VIEW_HOME.ty, VIEW_HOME.tz);
    orbit.update();
    return;
  }
  const top = floorView.getFloorTop(floorId);
  if (typeof top !== 'number') return;
  // 到该层上方斜看：横向距离和总览同一比例，只是整体下移，观感才连续
  camera.position.set(26, top + 12, 32);
  orbit.target.set(0, top + 1.4, 0);
  orbit.update();
}

function renderFloorBar() {
  if (!ui.floorBar) return;
  ui.floorBar.innerHTML = '';
  const opts = [{ id: 'all', name: '全部' }, ...floors];
  for (const f of opts) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = f.name;
    btn.dataset.floor = f.id;
    btn.addEventListener('click', () => {
      floorView.setFloor(f.id);
      guide.setVisibleFloor(f.id);
      highlightFloorButton(f.id);
      focusFloor(f.id);
      setMessage(f.id === 'all' ? '全部楼层（半透明楼板）' : `已切到 ${f.name}`);
    });
    ui.floorBar.appendChild(btn);
  }
  highlightFloorButton('all');
}

function showResult(result) {
  if (!ui.results) return;
  ui.results.innerHTML = '';
  if (result.status === 'found') {
    for (const s of result.matches) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'result-item';
      btn.textContent = `${s.name} · ${floors.find((f) => f.id === s.floor)?.name || s.floor}`;
      btn.addEventListener('click', () => {
        guide.highlightStore(s.id);
        if (startStoreId && startStoreId !== s.id) {
          const ok = guide.guideTo(startStoreId, s.id, { stepMode });
          if (ok) {
            setMessage(`从「${stores.find((x) => x.id === startStoreId)?.name}」前往「${s.name}」${stepMode ? '（讲解模式：点下一步继续）' : ''}`);
          }
        } else {
          const ok = guide.flyToStore(s.id);
          setMessage(ok ? `镜头飞近「${s.name}」门口` : `「${s.name}」缺少 entrance 坐标，数据待补`);
        }
        startStoreId = s.id;
      });
      ui.results.appendChild(btn);
    }
    setMessage(result.message, 'ok');
  } else if (result.status === 'noCoords') {
    const c = result.matches[0];
    setMessage(`<strong>数据待补</strong><br/>${c.note}<br/><span class="dim">来源：${c.source}；未虚构点位坐标</span>`, 'warn');
  } else if (result.status === 'notFound') {
    setMessage(result.message, 'warn');
  } else {
    setMessage(result.message);
  }
}

function doSearch() {
  const q = ui.searchInput?.value || '';
  showResult(searchStores(q, stores, CATALOG_NO_COORDS, floors));
}

function setViewMode(mode) {
  viewMode = mode;
  if (mode === 'firstPerson') {
    orbit.enabled = false;
    // 从当前所在层进入；「全部」视图时落到最底层，避免站到半空。
    const cur = floorView.getFloor();
    const baseId = cur === 'all' ? floors[0]?.id : cur;
    const top = floorView.getFloorTop(baseId);
    camera.position.set(0, (typeof top === 'number' ? top : 4) + 1.6, 8);
    // 不自动 lock：一旦锁定鼠标，UI 按钮全部点不到（只能 Esc）。
    // 改为点画面才锁，保证「下一步 / 讲解模式」等按钮随时可用。
    setMessage('第一人称：<strong>点击画面</strong>锁定鼠标漫游，WASD 移动，Esc 退出', 'ok');
  } else {
    pointer.unlock();
    orbit.enabled = true;
    camera.position.set(VIEW_HOME.x, VIEW_HOME.y, VIEW_HOME.z);
    orbit.target.set(VIEW_HOME.tx, VIEW_HOME.ty, VIEW_HOME.tz);
    orbit.update();
    setMessage('已切回总览视角');
  }
  if (ui.viewBtn) ui.viewBtn.textContent = mode === 'orbit' ? '切换到第一人称' : '切换到总览';
}

function bindUI() {
  ui.searchBtn?.addEventListener('click', doSearch);
  ui.searchInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doSearch();
  });
  ui.viewBtn?.addEventListener('click', () => setViewMode(viewMode === 'orbit' ? 'firstPerson' : 'orbit'));
  ui.stepBtn?.addEventListener('click', () => {
    stepMode = !stepMode;
    if (ui.stepBtn) ui.stepBtn.textContent = stepMode ? '讲解模式：开' : '讲解模式：关';
    setMessage(stepMode ? '讲解模式已开：路径分段暂停，点「下一步」继续' : '讲解模式已关：连续自动走');
  });
  ui.nextBtn?.addEventListener('click', () => guide.nextStep());
  pointer.addEventListener('unlock', () => {
    if (viewMode === 'firstPerson') setViewMode('orbit');
  });
  window.addEventListener('keydown', (e) => keys.add(e.code));
  window.addEventListener('keyup', (e) => keys.delete(e.code));
}

// 第一人称移动：贴地、限制在楼板范围内，不穿墙、不掉出楼板。
function updateFirstPerson(dt) {
  if (viewMode !== 'firstPerson') return;
  const speed = 6 * dt;
  const forward = new THREE.Vector3();
  camera.getWorldDirection(forward);
  forward.y = 0;
  forward.normalize();
  const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
  const move = new THREE.Vector3();
  if (keys.has('KeyW')) move.add(forward);
  if (keys.has('KeyS')) move.sub(forward);
  if (keys.has('KeyD')) move.add(right);
  if (keys.has('KeyA')) move.sub(right);
  if (move.lengthSq() === 0) return;
  move.normalize().multiplyScalar(speed);
  camera.position.add(move);
  camera.position.x = THREE.MathUtils.clamp(camera.position.x, -13, 13);
  camera.position.z = THREE.MathUtils.clamp(camera.position.z, -9, 9);
  const currentFloor = floorView.getFloor();
  const baseId = currentFloor === 'all' ? floors[0]?.id : currentFloor;
  const top = floorView.getFloorTop(baseId);
  if (typeof top === 'number') camera.position.y = top + 1.6;
}

const raycaster = new THREE.Raycaster();
function onCanvasClick(ev) {
  if (viewMode === 'firstPerson') {
    if (!pointer.isLocked) pointer.lock();
    return;
  }
  const rect = canvas.getBoundingClientRect();
  const ndc = new THREE.Vector2(
    ((ev.clientX - rect.left) / rect.width) * 2 - 1,
    -((ev.clientY - rect.top) / rect.height) * 2 + 1
  );
  raycaster.setFromCamera(ndc, camera);
  // 坑 3：Raycaster 不跳过 visible=false 的对象，必须手动过滤隐藏楼层。
  // 体块现在是一个 group（墙/招牌/光带/角标），所以要递归命中再逐级查父链，
  // 并且只认 mesh——否则会点到「数据待补」角标那个 Sprite。
  const visible = [...storeMeshes.values()]
    .filter(({ group }) => {
      let o = group;
      while (o) {
        if (!o.visible) return false;
        o = o.parent;
      }
      return true;
    })
    .map(({ group }) => group);
  const hits = raycaster.intersectObjects(visible, true).filter((h) => h.object.isMesh);
  if (!hits.length) return;
  const store = hits[0].object.userData;
  const s = stores.find((x) => x.id === store.storeId);
  if (!s) return;
  guide.highlightStore(s.id);
  startStoreId = s.id;
  if (!s.entrance) {
    setMessage(`<strong>${s.name}</strong><br/>缺少 entrance 坐标，点击跳转不可用（数据待补）`, 'warn');
  } else {
    guide.flyToStore(s.id);
    setMessage(`<strong>${s.name}</strong><br/>${floors.find((f) => f.id === s.floor)?.name || ''} · ${s.category || ''}<br/><span class="dim">来源 ${s.source} · ${s.verified}</span>`);
  }
}

async function init() {
  const loaded = await loadStores();
  floors = loaded.floors;
  stores = loaded.stores;
  floorView = createFloorView(floors, scene);
  shell = createShell(scene);
  buildStoreMeshes();
  guide = createGuide({
    scene, camera, controls: orbit, stores, floors, floorView, storeMeshes,
    onStep: (node, i, total) => setMessage(`导览进度 ${i + 1}/${total}（讲解模式，点「下一步」继续）`),
    onFloorChange: (id) => highlightFloorButton(id),
  });
  renderFloorBar();
  bindUI();
  canvas.addEventListener('click', onCanvasClick);
  if (ui.dataBadge) {
    ui.dataBadge.textContent = loaded.source === 'file'
      ? '点位：data/stores.json'
      : '点位：占位示意值（待 B 现场核实）';
  }
  const clock = new THREE.Clock();
  function animate(ts) {
    const dt = Math.min(clock.getDelta(), 0.05);
    perf.frame(ts);
    updateFirstPerson(dt);
    guide.update(dt);
    if (viewMode === 'orbit') orbit.update();
    renderer.render(scene, camera);
    requestAnimationFrame(animate);
  }
  requestAnimationFrame(animate);
  setMessage('点击店铺查看详情；搜索店名生成导览路径', 'ok');
}

init();
