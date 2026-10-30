import {test, expect} from 'bun:test';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
globalThis.THREE = require('../vendor/three.min.js');
globalThis.document = {createElement: () => ({
  getContext: () => ({createImageData: (w,h) => ({data:new Uint8ClampedArray(w*h*4)}), putImageData() {}}),
})};
globalThis.SkogWorld = {height: () => 0};
await import('../character.js');

test('lantern fades out and back in while following the child', () => {
  const child = new SkogCharacter({scene:new THREE.Scene()});
  const player = {x:2,z:3,heading:0,speed:0,walk:0};
  const advance = () => {for(let i=0;i<120;i++) child.update(i/60,1/60,player);};
  advance();
  expect(child.lanternLight.intensity).toBeGreaterThan(18);
  expect(child.lanternLight.position.distanceTo(child.group.position)).toBeLessThan(2);
  child.setLantern(false); advance();
  expect(child.lanternLight.intensity).toBeLessThan(.01);
  expect(child.flame.visible).toBe(false);
  child.setLantern(true); advance();
  expect(child.lanternLight.intensity).toBeGreaterThan(18);
  expect(child.flame.visible).toBe(true);
});
