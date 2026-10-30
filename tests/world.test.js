const {test,expect}=require('bun:test');
const {World,height,pathDistance,paths}=require('../world.js');

test('forest generation is deterministic and the starting path is clear',()=>{
  const a=new World(),b=new World();
  expect(a.trees).toEqual(b.trees);expect(a.trees.length).toBeGreaterThan(500);
  expect(a.move(0,7,0,-6)).toEqual({x:0,z:expect.closeTo(1,8)});
  for(const tree of a.trees)expect(pathDistance(tree.x,tree.z)).toBeGreaterThan(2.4);
});
test('walking cannot tunnel through a trunk, and diagonal movement slides past it',()=>{
  const world=new World();world.grid.clear();world.colliders=[];world.addCollider(0,0,1,12);
  const hit=world.move(0,5,0,-10);expect(hit.z).toBeGreaterThanOrEqual(1.279);
  const slide=world.move(.6,2,2,-3);expect(slide.x).toBeGreaterThan(2);expect(Math.hypot(slide.x,slide.z)).toBeGreaterThanOrEqual(1.28);
  const center=world.move(0,0,0,0);expect(Number.isFinite(center.x)).toBe(true);expect(Math.hypot(center.x,center.z)).toBeGreaterThanOrEqual(1.28);
});
test('the camera shortens in front of trees and uneven ground',()=>{
  const world=new World();world.grid.clear();world.addCollider(0,3,1,10);
  const y=height(0,0)+1;
  expect(world.cameraDistance({x:0,y,z:0},{x:0,y:y+2,z:7})).toBeLessThan(3);
  expect(world.cameraDistance({x:0,y,z:0},{x:0,y:-5,z:-7})).toBeLessThan(4);
});
test('the mist boundary keeps the player inside the built forest',()=>{
  const world=new World();world.grid.clear();const p=world.move(77,0,10,4);
  expect(Math.hypot(p.x,p.z)).toBeLessThanOrEqual(78.000001);
});
test('paths and terrain have finite, continuous geometry',()=>{
  for(const path of paths)for(const [x,z] of path){expect(pathDistance(x,z)).toBeLessThan(.00001);expect(Number.isFinite(height(x,z))).toBe(true);expect(Math.abs(height(x+.01,z)-height(x,z))).toBeLessThan(.01);}
});
