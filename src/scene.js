import * as THREE from 'three';

// 场景基础：背景、灯光。楼层与店铺体块由 floorView.js / main.js 负责生成。
// 后续门脸体块与贴图由 C-01（#11）替换，本文件只保留场景级元素。

export function buildScene() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0f172a);

  scene.add(new THREE.AmbientLight(0xffffff, 0.72));
  // 半球光：地面偏暖、天顶偏冷。只有环境光时，环形楼板的上下两个面亮度一样，
  // 看不清「这是几层」，加半球光之后层与层之间才有明暗关系。
  scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x3a3226, 0.55));

  const dir = new THREE.DirectionalLight(0xffffff, 1.2);
  dir.position.set(10, 20, 10);
  scene.add(dir);

  return scene;
}
