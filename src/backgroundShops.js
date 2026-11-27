import * as THREE from 'three';
import { createSignTexture } from './texturePipeline.js';
import { VERTICALS } from './floorPlan.js';

// 垂直交通（扶梯 / 电梯厅）。
//
// 导览牌上这些位置是明确标注的（每层 4–7 处扶梯 + 3 个电梯厅）。
// 建出来之后，跨层动线才有落点，总览视角也才像真的商场——
// 只有一圈店铺没有垂直交通，看着像单层的展览摊位。

// 扶梯：倾斜踏板 + 侧栏 + 玻璃挡板，够读出方向即可
function createEscalator() {
  const g = new THREE.Group();
  const stepMat = new THREE.MeshStandardMaterial({ color: 0x59616f, roughness: 0.6, metalness: 0.35 });
  const railMat = new THREE.MeshStandardMaterial({ color: 0x2b3340, roughness: 0.5, metalness: 0.4 });
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x9fc4d8, transparent: true, opacity: 0.28, roughness: 0.15, metalness: 0.2,
  });

  const run = 5.6;
  const rise = 3.2;
  const slope = Math.hypot(run, rise);
  const angle = Math.atan2(rise, run);

  const step = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.18, slope), stepMat);
  step.position.set(0, rise / 2, 0);
  step.rotation.x = -angle;
  g.add(step);

  for (const sx of [-0.9, 0.9]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.16, slope), railMat);
    rail.position.set(sx, rise / 2 + 1.0, 0);
    rail.rotation.x = -angle;
    g.add(rail);
    const glass = new THREE.Mesh(new THREE.BoxGeometry(0.04, 1.0, slope), glassMat);
    glass.position.set(sx, rise / 2 + 0.5, 0);
    glass.rotation.x = -angle;
    g.add(glass);
  }
  g.userData = { kind: 'escalator' };
  return g;
}

// 电梯厅：带两扇门的方盒 + 楼层牌
function createElevatorBank(floorLabel) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(3.8, 3.1, 2.2),
    new THREE.MeshStandardMaterial({ color: 0x454d5c, roughness: 0.85 })
  );
  body.position.y = 1.55;
  g.add(body);

  const doorMat = new THREE.MeshStandardMaterial({
    color: 0x9aa4b5, roughness: 0.3, metalness: 0.6,
    emissive: 0x33405a, emissiveIntensity: 0.55,
  });
  for (const dx of [-0.9, 0.9]) {
    const door = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 2.2), doorMat);
    door.position.set(dx, 1.2, 1.12);
    g.add(door);
  }

  const signTex = createSignTexture({ name: '电梯厅', category: '', _floorLabel: floorLabel });
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(2.4, 0.5),
    new THREE.MeshStandardMaterial({
      map: signTex, emissiveMap: signTex, emissive: 0xffffff, emissiveIntensity: 0.7,
    })
  );
  sign.position.set(0, 2.78, 1.12);
  g.add(sign);

  g.userData = { kind: 'elevator' };
  return g;
}

export function buildVerticals({ floorLabel, floorTop, group }) {
  let escalators = 0;
  let elevators = 0;

  for (const [x, z] of VERTICALS.escalators) {
    const esc = createEscalator();
    esc.position.set(x, floorTop, z);
    esc.rotation.y = Math.atan2(-x, -z); // 朝中庭方向升起
    group.add(esc);
    escalators += 1;
  }

  for (const [x, z] of VERTICALS.elevators) {
    const lift = createElevatorBank(floorLabel);
    lift.position.set(x, floorTop, z);
    lift.rotation.y = Math.atan2(-x, -z);
    group.add(lift);
    elevators += 1;
  }

  return { escalators, elevators };
}
