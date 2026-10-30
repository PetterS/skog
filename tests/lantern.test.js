import {test, expect} from 'bun:test';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
globalThis.THREE = require('../vendor/three.min.js');
globalThis.document = {createElementNS:()=>({addEventListener(){},removeEventListener(){}}),createElement: () => ({
  getContext: () => ({createImageData: (w,h) => ({data:new Uint8ClampedArray(w*h*4)}), putImageData() {}}),
})};
globalThis.SkogWorld = {height: () => 0};
await import('../assets/character/quaternius-character.js');
await import('../character.js');

test('lantern fades out and back in while following the child', () => {
  const child = new SkogCharacter({scene:new THREE.Scene()});
  const player = {x:2,z:3,heading:0,speed:0,walk:0};
  const advance = () => {for(let i=0;i<120;i++) child.update(i/60,1/60,player);};
  advance();
  expect(child.lanternLight.intensity).toBeGreaterThan(18);
  expect(child.lanternLight.position.distanceTo(child.group.position)).toBeLessThan(2);
  expect(child.lanternLight.position.distanceTo(child.flame.getWorldPosition(new THREE.Vector3()))).toBeLessThan(.00001);
  expect(child.lanternLight.shadow.autoUpdate).toBe(true);
  child.setLantern(false); advance();
  expect(child.lanternLight.intensity).toBeLessThan(.01);
  expect(child.flame.visible).toBe(false);
  expect(child.lanternLight.shadow.autoUpdate).toBe(false);
  child.setLantern(true); advance();
  expect(child.lanternLight.intensity).toBeGreaterThan(18);
  expect(child.flame.visible).toBe(true);
  expect(child.lanternLight.shadow.autoUpdate).toBe(true);
});

test('retargeted walk and jog stay finite, grounded and driven by travelled distance', () => {
  const child = new SkogCharacter({scene:new THREE.Scene()});
  const player = {x:0,z:0,heading:0,speed:1.85,motionSpeed:1.85,walk:0};
  for(const speed of [1.85,3.5]){
    player.speed=player.motionSpeed=speed;
    for(let i=0;i<240;i++){
      player.walk+=speed/60*3.5;child.update(i/60,1/60,player);
      for(const leg of child.legs){
        expect(Number.isFinite(leg.hip.rotation.x+leg.knee.rotation.x)).toBe(true);
        expect(Math.abs(leg.hip.rotation.x)).toBeLessThan(1.8);
        const sole=new THREE.Vector3(0,-.1275,.037).applyMatrix4(leg.foot.matrixWorld);
        expect(sole.y).toBeGreaterThan(-.025);
        expect(sole.y).toBeLessThan(.4);
      }
    }
  }
  child.motion=1;child.runBlend=1;
  child.update(4,0,player);
  const angles=child.legs.map(l=>[l.hip.rotation.x,l.knee.rotation.x]);
  child.update(40,0,player);
  expect(child.legs.map(l=>[l.hip.rotation.x,l.knee.rotation.x])).toEqual(angles);
  expect(child.stats.triangles).toBeLessThan(37000);
});
