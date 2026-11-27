import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { buildScene } from './scene.js';
import { loadStores, CATALOG_NO_COORDS } from './mockData.js';
import { createFloorView } from './floorView.js';
import { searchStores } from './search.js';
import { createGuide } from './guide.js';
import { createPerfMonitor, pixelRatioFor } from './perf.js';
import { createShopUnit } from './storefront.js';
import { loadStorefront } from './texturePipeline.js';
import { createShell } from './shell.js';
import { BACKDROP, isOnSlab, ringSlots } from './floorPlan.js';
import { buildVerticals } from './backgroundShops.js';

const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(pixelRatioFor(0));

const scene = buildScene();
const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 600);
// 总览默认机位：楼层按导览牌改成 47×43 的环形板、外壳 56×52 之后要退到 ~64m，
// 原来的 (20,18,24) 连一层楼都框不下。
// 抬高俯角：店铺一律面朝中庭，机位太低就只看见一圈后背。
const VIEW_HOME = { x: 30, y: 46, z: 40, tx: 0, ty: -2, tz: 0 };
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

// 铺位生成（D008 + 导览牌结构）。
//
// 真实商场的铺位是沿走廊切出来的：面宽随楼层轮廓变化、临街面常常是斜的、
// 进深各不相同。所以不用统一方盒子，而是用 floorPlan.ringSlots() 沿外轮廓
// 切出 26 块铺位，核心点位吸附到最近的槽位，背景铺位吃剩下的。
const SLOT_COUNT = 26;
const SLOT_DEPTH = 5.5;
const MAX_BACKDROP = 12; // D011 §3 上限
const BACKDROP_COLORS = [0x3f4757, 0x464e5f, 0x3a4251, 0x4a5263, 0x424a5a];

function clearShops() {
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
}

function buildShops() {
  clearShops();
  const coreNames = stores.map((s) => s.name);

  for (const f of floors) {
    const top = floorView.getFloorTop(f.id);
    const group = floorView.getGroup(f.id);
    const slots = ringSlots(SLOT_COUNT, SLOT_DEPTH);
    const taken = new Set();

    // 1) 核心点位：吸附到最近的空槽位
    for (const s of stores.filter((x) => x.floor === f.id)) {
      let bestIdx = -1;
      let bestD = Infinity;
      slots.forEach((slot, i) => {
        if (taken.has(i)) return;
        const d = Math.hypot(slot.cx - s.x, slot.cz - s.z);
        if (d < bestD) { bestD = d; bestIdx = i; }
      });
      if (bestIdx < 0) continue;
      taken.add(bestIdx);
      const slot = slots[bestIdx];

      // 坐标吸附到实际铺位：光圈、路径、飞近落点都跟着几何走，
      // 否则会出现「店在这块地，光圈画在旁边」的错位。
      s.x = slot.cx;
      s.z = slot.cz;
      s.entrance = { x: slot.face.x, z: slot.face.z };

      const unit = createShopUnit({
        storeId: s.id, name: s.name, category: s.category,
        floorLabel: f.name, floorId: f.id,
        poly: slot.poly, face: slot.face, rotY: slot.rotY,
      });
      unit.group.position.y = top;
      group.add(unit.group);
      storeMeshes.set(s.id, unit);
    }

    // 2) 背景铺位：剩余槽位里均匀抽（D011 §3）
    const names = (BACKDROP[f.id] || []).filter(
      (n) => !coreNames.some((cn) => cn.includes(n) || n.includes(cn))
    );
    const free = [...slots.keys()].filter((i) => !taken.has(i));
    const want = Math.min(names.length, MAX_BACKDROP, free.length);
    for (let i = 0; i < want; i++) {
      const slot = slots[free[Math.floor((i * free.length) / want)]];
      const unit = createShopUnit({
        name: names[i], floorLabel: f.name, floorId: f.id,
        poly: slot.poly, face: slot.face, rotY: slot.rotY,
        color: BACKDROP_COLORS[i % BACKDROP_COLORS.length],
        interactive: false,
      });
      unit.group.position.y = top;
      group.add(unit.group);
    }

    // 3) 空槽位填成连续墙面：真实商场的铺位界面是连着的，
    //    隔一段空一段会像「一排展台」而不是「一圈商铺」。这些墙没有招牌、
    //    没有店名，不算背景铺位（D011 §3 的 8–12 个上限不受影响）。
    const usedIdx = new Set([...taken]);
    const pickedIdx = new Set();
    for (let i = 0; i < want; i++) pickedIdx.add(free[Math.floor((i * free.length) / want)]);
    for (const idx of slots.keys()) {
      if (usedIdx.has(idx) || pickedIdx.has(idx)) continue;
      const slot = slots[idx];
      const fill = createShopUnit({
        name: '', floorLabel: f.name, floorId: f.id,
        poly: slot.poly, face: slot.face, rotY: slot.rotY,
        color: 0x333a48, interactive: false, withSign: false,
      });
      fill.group.position.y = top;
      group.add(fill.group);
    }

    // 4) 垂直交通
    buildVerticals({ floorLabel: f.name, floorTop: top, group });
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
    shell?.setRoofVisible(true);
    camera.position.set(VIEW_HOME.x, VIEW_HOME.y, VIEW_HOME.z);
    orbit.target.set(VIEW_HOME.tx, VIEW_HOME.ty, VIEW_HOME.tz);
    orbit.update();
    return;
  }
  const top = floorView.getFloorTop(floorId);
  if (typeof top !== 'number') return;
  // 到该层上方斜看。楼板 47×43，站太远招牌就只剩几个像素——
  // 这个距离下大约能看清半个环，正好是「站在中庭边上看一层」的观感。
  shell?.setRoofVisible(false);
  // 距离 ~26m：能看清半圈铺位和店名，又不至于被前景一堵墙挡住。
  // 再远一点（40m）招牌就只剩几十像素，等于白建。
  // 站在中庭南侧上方朝北看：前景是中庭洞（空的），对面一整排铺位的正面进画面。
  // 机位放到环外的话，最近的那排铺位会变成一堵墙挡住全部。
  camera.position.set(5, top + 10, 10);
  orbit.target.set(5, top + 1.2, -9);
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

  // 用户一动手就把镜头控制权交还给他。
  // 自动漫游每帧覆盖 camera.position，不中断的话拖拽和滚轮全被盖掉——
  // 表现就是「点完一家店之后画面动不了」。
  canvas.addEventListener('mousedown', () => guide?.cancelAnimation());
  canvas.addEventListener('wheel', () => guide?.cancelAnimation(), { passive: true });

  // Esc：中断漫游 + 退回总览。给用户一条明确的退出路径，
  // 免得飞近之后不知道该点哪儿才能恢复。
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    guide?.cancelAnimation();
    if (viewMode === 'firstPerson') {
      setViewMode('orbit');
      return;
    }
    if (floorView.getFloor() !== 'all') {
      floorView.setFloor('all');
      guide.setVisibleFloor('all');
      highlightFloorButton('all');
      focusFloor('all');
      setMessage('已回到总览（Esc）');
    }
  });
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

  // 楼板现在是环形的、中间有中庭洞，不能再靠矩形 clamp ——
  // 那样人会直接走进中庭掉下去。按 floorPlan 的真实轮廓判断，
  // 并且分轴试探：贴着墙走的时候还能沿着墙滑动，不会一下卡死。
  const nx = camera.position.x + move.x;
  const nz = camera.position.z + move.z;
  if (isOnSlab(nx, nz, 0.9)) {
    camera.position.x = nx;
    camera.position.z = nz;
  } else {
    if (isOnSlab(nx, camera.position.z, 0.9)) camera.position.x = nx;
    if (isOnSlab(camera.position.x, nz, 0.9)) camera.position.z = nz;
  }

  const currentFloor = floorView.getFloor();
  const baseId = currentFloor === 'all' ? floors[0]?.id : currentFloor;
  const top = floorView.getFloorTop(baseId);
  if (typeof top === 'number') camera.position.y = top + 1.6;
}

const raycaster = new THREE.Raycaster();
// 拖动旋转松手时浏览器也会补一个 click，不区分的话会误触发「跳到这家店」。
// 记下按下位置，移动超过 6px 就当拖拽，不当作点击。
let downPoint = null;
canvas.addEventListener('pointerdown', (ev) => {
  downPoint = { x: ev.clientX, y: ev.clientY };
});

function onCanvasClick(ev) {
  if (downPoint && Math.hypot(ev.clientX - downPoint.x, ev.clientY - downPoint.y) > 6) return;
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
  buildShops();
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
