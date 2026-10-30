(function (root) {
  'use strict';
  const TAU = Math.PI * 2;
  function random(seed) {
    return function () {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const height = (x, z) => Math.sin(x * .059) * 1.5 + Math.cos(z * .071) * 1.1 + Math.sin(x * .17 + z * .093) * .42 + Math.cos(x * .31 - z * .21) * .12;
  const routes = [
    [[0, 16], [0, 7], [0, 0], [-5, -12], [-4, -25], [10, -34], [26, -22], [32, -4], [24, 14], [8, 26], [-13, 26], [-28, 12], [-23, -5], [-5, -12]],
    [[-4, -25], [-15, -35], [-27, -39], [-41, -34]],
    [[24, 14], [37, 22], [46, 32]],
  ];
  function samplePath(points) {
    const samples = [];
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[Math.max(0, i - 1)], p1 = points[i], p2 = points[i + 1], p3 = points[Math.min(points.length - 1, i + 2)];
      for (let n = 0; n < 12; n++) {
        const t = n / 12, t2 = t * t, t3 = t2 * t;
        samples.push([0, 1].map(k => .5 * (2 * p1[k] + (-p0[k] + p2[k]) * t + (2*p0[k] - 5*p1[k] + 4*p2[k] - p3[k]) * t2 + (-p0[k] + 3*p1[k] - 3*p2[k] + p3[k]) * t3)));
      }
    }
    samples.push(points.at(-1));
    return samples;
  }
  const paths = routes.map(samplePath);
  function pathDistance(x, z) {
    let best = Infinity;
    for (const path of paths) for (let i = 1; i < path.length; i++) {
      const [ax, az] = path[i - 1], [bx, bz] = path[i];
      const dx = bx - ax, dz = bz - az;
      const t = clamp(((x - ax) * dx + (z - az) * dz) / (dx*dx + dz*dz), 0, 1);
      best = Math.min(best, (x - ax - t * dx)**2 + (z - az - t * dz)**2);
    }
    return Math.sqrt(best);
  }
  class World {
    constructor(seed = 31010) {
      this.seed = seed; this.radius = 78; this.trees = []; this.rocks = []; this.colliders = []; this.grid = new Map();
      const rng = random(seed);
      for (let i = 0; i < 1250; i++) {
        const a = rng()*TAU, d = Math.sqrt(rng())*103;
        const x = Math.cos(a)*d, z = Math.sin(a)*d;
        if (pathDistance(x, z) < 2.4 + rng()*.8 || Math.hypot(x-24, z+24) < 6 || Math.hypot(x+27,z+39)<5 || Math.hypot(x-46,z-32)<6) continue;
        if (this.trees.some(t => Math.hypot(t.x-x,t.z-z) < 2.8)) continue;
        const tree = {x, z, y:height(x,z), h:9+rng()*10, r:.28+rng()*.43, seed:Math.floor(rng()*1e8), bare:rng()<.38};
        this.trees.push(tree); this.addCollider(x,z,tree.r+.12,tree.h);
      }
      for (let i = 0; i < 135; i++) {
        const x = (rng()-.5)*155, z = (rng()-.5)*155, r=.35+rng()*1.4;
        if (pathDistance(x,z)<2.4 || Math.hypot(x-24,z+24)<6 || Math.hypot(x+27,z+39)<3 || Math.hypot(x-46,z-32)<6) continue;
        this.rocks.push({x,z,r,y:height(x,z),a:rng()*TAU});this.addCollider(x,z,r*.8,r*1.3);
      }
      // Ruined cottage, well and the old standing stones.
      for(let x=20.5;x<=27.5;x+=.7) {this.addCollider(x,-27,.48,4);this.addCollider(x,-21,.48,2.4);}
      for(let z=-27;z<=-21;z+=.7) {this.addCollider(27.5,z,.48,3);if(z < -25.5 || z > -23)this.addCollider(20.5,z,.48,3);}
      this.addCollider(-27,-39,1.3,1.2);
      for(let i=0;i<7;i++){const a=i*TAU/7;this.addCollider(46+Math.sin(a)*3.7,32+Math.cos(a)*3.7,.65,2.7);}
    }
    addCollider(x,z,r,h) {
      const c={x,z,r,h}; this.colliders.push(c);
      for(let gx=Math.floor((x-r)/4);gx<=Math.floor((x+r)/4);gx++)for(let gz=Math.floor((z-r)/4);gz<=Math.floor((z+r)/4);gz++) {
        const key=gx+','+gz;if(!this.grid.has(key))this.grid.set(key,[]);this.grid.get(key).push(c);
      }
    }
    nearby(x,z,r=1) {
      const found=new Set();
      for(let gx=Math.floor((x-r)/4);gx<=Math.floor((x+r)/4);gx++)for(let gz=Math.floor((z-r)/4);gz<=Math.floor((z+r)/4);gz++)for(const c of this.grid.get(gx+','+gz)||[])found.add(c);
      return found;
    }
    move(x,z,dx,dz,r=.28) {
      let edge=false;
      const steps=Math.max(1,Math.ceil(Math.hypot(dx,dz)/.18));
      for(let step=0;step<steps;step++) {
        x+=dx/steps; z+=dz/steps;
        for(let pass=0;pass<3;pass++)for(const c of this.nearby(x,z,r)){
          let a=x-c.x,b=z-c.z,d=Math.hypot(a,b),min=r+c.r;
          if(d<min){if(d<.00001){a=1;b=0;d=1;x=c.x+min;z=c.z;}else{x+=a/d*(min-d);z+=b/d*(min-d);}}
        }
        const distance=Math.hypot(x,z);if(distance>this.radius){x*=this.radius/distance;z*=this.radius/distance;edge=true;}
      }
      return edge ? {x,z,edge:true} : {x,z};
    }
    cameraDistance(target, desired, radius=.22) {
      const dx=desired.x-target.x,dy=desired.y-target.y,dz=desired.z-target.z;
      const length=Math.hypot(dx,dy,dz);
      for(let d=.35;d<=length;d+=.16){
        const t=d/length,x=target.x+dx*t,y=target.y+dy*t,z=target.z+dz*t;
        if(y<height(x,z)+radius)return Math.max(.5,d-.25);
        for(const c of this.nearby(x,z,radius))if(y<height(c.x,c.z)+c.h+.15&&Math.hypot(x-c.x,z-c.z)<c.r+radius)return Math.max(.5,d-.3);
      }
      return length;
    }
  }
  root.SkogWorld={World,random,height,pathDistance,paths,clamp};
  if(typeof module!=='undefined')module.exports=root.SkogWorld;
})(globalThis);
