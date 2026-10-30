(function (root) {
  'use strict';
  const T = THREE, W = SkogWorld, TAU = Math.PI * 2, CELL = 24;
  const v3 = (x=0,y=0,z=0) => new T.Vector3(x,y,z);
  const smooth = (a,b,x) => { const t=W.clamp((x-a)/(b-a),0,1);return t*t*(3-2*t); };
  const noise = (x,y,z) => Math.sin(x*2.31+z*.91)*Math.cos(y*1.73-z*1.13)*.55 + Math.sin(y*3.73+x*1.17)*Math.cos(z*3.11+x*.53)*.28 + Math.sin(x*8.17+y*4.37+z*6.31)*.12;
  function canvasTexture(size,paint) {
    const c=document.createElement('canvas');c.width=c.height=size;paint(c.getContext('2d'),size);
    const texture=new T.CanvasTexture(c);texture.colorSpace=T.SRGBColorSpace;return texture;
  }
  function material(color,extra={}) { return new T.MeshStandardMaterial({color,roughness:.92,...extra}); }
  function softenNormals(geometry) {
    geometry.computeVertexNormals();
    const p=geometry.attributes.position,n=geometry.attributes.normal,shared=new Map();
    for(let i=0;i<p.count;i++) {
      const key=[p.getX(i),p.getY(i),p.getZ(i)].map(v=>Math.round(v*100000)).join(',');
      if(!shared.has(key))shared.set(key,{normal:v3(),indices:[]});
      const entry=shared.get(key);entry.normal.add(v3(n.getX(i),n.getY(i),n.getZ(i)));entry.indices.push(i);
    }
    for(const entry of shared.values()){entry.normal.normalize();for(const i of entry.indices)n.setXYZ(i,entry.normal.x,entry.normal.y,entry.normal.z);}
    return geometry;
  }
  function boulder(seed=1,segments=28) {
    const geo=new T.SphereGeometry(1,segments,20),p=geo.attributes.position,colors=[],phase=seed*1.97;
    const color=new T.Color();
    for(let i=0;i<p.count;i++) {
      const x=p.getX(i),y=p.getY(i),z=p.getZ(i);
      const n=noise(x+phase,y,z),radius=1+n*.19+Math.sin(x*4+phase)*Math.sin(z*3-y)*.055;
      p.setXYZ(i,x*radius,y*radius*.9,z*radius);
      const moss=smooth(.18,.8,y+noise(x*2,y*2,z*2)*.42);
      color.setRGB(.84,.84,.77).lerp(new T.Color('#88905b'),moss*.48).multiplyScalar(.88+noise(x+4,y,z)*.08);
      colors.push(color.r,color.g,color.b);
    }
    geo.setAttribute('color',new T.Float32BufferAttribute(colors,3));return softenNormals(geo);
  }
  function roundedStone(seed=1) {
    const geo=new T.BoxGeometry(1,1,1,6,6,6),p=geo.attributes.position,colors=[];
    for(let i=0;i<p.count;i++) {
      const x=p.getX(i),y=p.getY(i),z=p.getZ(i),inside=v3(W.clamp(x,-.41,.41),W.clamp(y,-.41,.41),W.clamp(z,-.41,.41));
      const d=v3(x,y,z).sub(inside).normalize().multiplyScalar(.09);
      const s=1+noise(x*2+seed,y*2,z*2)*.045;
      p.setXYZ(i,(inside.x+d.x)*s,(inside.y+d.y)*s,(inside.z+d.z)*s);
      const shade=.82+noise(x+seed,y,z)*.07;colors.push(shade,shade,shade*.93);
    }
    const uv=geo.attributes.uv;
    for(let i=0;i<uv.count;i++)uv.setXY(i,uv.getX(i)*.48+(seed*.173)%1,uv.getY(i)*.48+(seed*.317)%1);
    geo.setAttribute('color',new T.Float32BufferAttribute(colors,3));return softenNormals(geo);
  }
  function tube(points,startRadius,endRadius,segments=10,sides=8,ridges=.025) {
    const curve=new T.CatmullRomCurve3(points),frames=curve.computeFrenetFrames(segments,false),positions=[],uvs=[],indices=[];
    const length=curve.getLength();
    for(let i=0;i<=segments;i++) {
      const t=i/segments,p=curve.getPointAt(t),radius=T.MathUtils.lerp(startRadius,endRadius,t)*(1+Math.sin(t*Math.PI)*.06);
      for(let j=0;j<=sides;j++) {
        const a=j/sides*TAU,r=radius*(1+Math.sin(a*5+t*2)*ridges),n=frames.normals[i],b=frames.binormals[i];
        positions.push(p.x+r*(Math.cos(a)*n.x+Math.sin(a)*b.x),p.y+r*(Math.cos(a)*n.y+Math.sin(a)*b.y),p.z+r*(Math.cos(a)*n.z+Math.sin(a)*b.z));
        uvs.push(j/sides*1.1,t*length/2);
        if(i<segments&&j<sides){const k=i*(sides+1)+j;indices.push(k,k+1,k+sides+1,k+1,k+sides+2,k+sides+1);}
      }
    }
    const geo=new T.BufferGeometry();geo.setAttribute('position',new T.Float32BufferAttribute(positions,3));geo.setAttribute('uv',new T.Float32BufferAttribute(uvs,2));geo.setIndex(indices);return softenNormals(geo);
  }
  // Static geometry and instances are partitioned spatially. Objects behind the
  // fog are not submitted to the GPU, and each chunk has its own frustum bounds.
  class Batches {
    constructor(scene){this.scene=scene;this.instances=new Map();this.geometry=new Map();this.meshes=[];this.dummy=new T.Object3D();}
    cell(x,z){return `${Math.floor(x/CELL)},${Math.floor(z/CELL)}`;}
    add(geo,mat,p,scale=v3(1,1,1),rotation=null,color=null) {
      const cell=this.cell(p.x,p.z),key=cell+':'+geo.uuid+':'+mat.uuid;
      if(!this.instances.has(key))this.instances.set(key,{cell,geo,mat,items:[]});
      const d=this.dummy;d.position.copy(p);d.scale.copy(scale);d.quaternion.identity();
      if(rotation?.isQuaternion)d.quaternion.copy(rotation);else if(rotation)d.rotation.set(rotation.x,rotation.y,rotation.z);
      d.updateMatrix();this.instances.get(key).items.push({matrix:d.matrix.clone(),color});
    }
    merge(geo,mat,x,z) {
      const cell=this.cell(x,z),key=cell+':'+mat.uuid;
      if(!this.geometry.has(key))this.geometry.set(key,{cell,mat,position:[],normal:[],uv:[],index:[]});
      const bucket=this.geometry.get(key),offset=bucket.position.length/3;
      for(const [key,name] of [['position','position'],['normal','normal'],['uv','uv']])bucket[key].push(...geo.attributes[name].array);
      if(geo.index)for(const index of geo.index.array)bucket.index.push(offset+index);
      else for(let i=0;i<geo.attributes.position.count;i++)bucket.index.push(offset+i);
      geo.dispose();
    }
    register(mesh,cell) {
      const [x,z]=cell.split(',').map(Number);mesh.userData.chunk=v3((x+.5)*CELL,0,(z+.5)*CELL);
      mesh.castShadow=mesh.material.userData.shadow!==false;mesh.receiveShadow=true;
      mesh.frustumCulled=true;this.meshes.push(mesh);this.scene.add(mesh);
    }
    finish() {
      for(const b of this.instances.values()) {
        const m=new T.InstancedMesh(b.geo,b.mat,b.items.length);
        b.items.forEach((item,i)=>{m.setMatrixAt(i,item.matrix);if(item.color)m.setColorAt(i,item.color);});m.computeBoundingSphere();this.register(m,b.cell);
      }
      for(const b of this.geometry.values()) {
        const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(b.position,3));g.setAttribute('normal',new T.Float32BufferAttribute(b.normal,3));g.setAttribute('uv',new T.Float32BufferAttribute(b.uv,2));g.setIndex(b.index);g.computeBoundingSphere();this.register(new T.Mesh(g,b.mat),b.cell);
      }
      this.instances.clear();this.geometry.clear();
    }
    update(player) {for(const m of this.meshes){const p=m.userData.chunk;m.visible=Math.hypot(player.x-p.x,player.z-p.z)<70;}}
  }
  class Environment {
    constructor(forest) {
      this.forest=forest;this.scene=forest.scene;this.world=forest.world;this.renderer=forest.renderer;
      this.batches=new Batches(this.scene);this.windShaders=[];this.time={value:0};this.promises=[];this.textureCache=new Map();
      const stones=[roundedStone(4),roundedStone(7),roundedStone(12)];
      this.geo={rocks:[boulder(1),boulder(5),boulder(11)],stones,stone:stones[0],box:new T.BoxGeometry(1,1,1),sphere:new T.SphereGeometry(1,20,14)};
      const barkColor=this.texture('bark-color'),barkNormal=this.texture('bark-normal',false);
      this.bark=material('#a69c88',{map:barkColor,normalMap:barkNormal,normalScale:new T.Vector2(.95,.95),roughness:.95});
      this.twig=material('#696356',{map:barkColor,normalMap:barkNormal,normalScale:new T.Vector2(.55,.55)});
      this.stone=material('#c0c5b9',{map:this.texture('rock-color'),normalMap:this.texture('rock-normal',false),normalScale:new T.Vector2(.85,.85),vertexColors:true,roughness:.93});
      this.wood=material('#8a7457',{map:barkColor,normalMap:barkNormal,normalScale:new T.Vector2(.4,.4)});
      this.leafMaterial=material('#909b65',{map:this.leafClusterTexture(),alphaTest:.35,side:T.DoubleSide,roughness:.95});this.leafMaterial.shadowSide=T.DoubleSide;this.wind(this.leafMaterial,.12);
      this.fernMaterial=material('#70864e',{side:T.DoubleSide,roughness:.87});this.fernMaterial.userData.shadow=false;this.wind(this.fernMaterial,.035);
      this.grassMaterial=material('#838857',{side:T.DoubleSide,roughness:.95});this.grassMaterial.userData.shadow=false;this.wind(this.grassMaterial,.07);
      this.assetsReady=Promise.all(this.promises);
    }
    texture(name,color=true,repeat=1) {
      const key=name+':'+repeat;if(this.textureCache.has(key))return this.textureCache.get(key);
      const src=root.SkogTextureSources?.[name];if(!src)return null;
      let resolve;const promise=new Promise(r=>resolve=r);this.promises.push(promise);
      const texture=new T.TextureLoader().load(src,()=>resolve(true),undefined,()=>resolve(false));
      texture.colorSpace=color?T.SRGBColorSpace:T.NoColorSpace;texture.wrapS=texture.wrapT=T.RepeatWrapping;texture.repeat.set(repeat,repeat);texture.anisotropy=Math.min(8,this.renderer.capabilities.getMaxAnisotropy());
      this.textureCache.set(key,texture);return texture;
    }
    wind(mat,amount) {
      mat.onBeforeCompile=shader=>{shader.uniforms.skogWindTime=this.time;shader.vertexShader='uniform float skogWindTime;\n'+shader.vertexShader;
        shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
          vec3 swayPosition = position;
          #ifdef USE_INSTANCING
            swayPosition = (instanceMatrix * vec4(position,1.0)).xyz;
          #endif
          float windPhase = skogWindTime*.7 + swayPosition.x*.31 + swayPosition.z*.19;
          transformed.x += (sin(windPhase)+sin(windPhase*1.77)*.28)*${amount.toFixed(3)}*clamp(position.y,0.0,1.5);
          transformed.z += cos(windPhase*.83)*${(amount*.42).toFixed(3)}*clamp(position.y,0.0,1.5);`);
      };mat.customProgramCacheKey=()=>`skog-wind-${amount}`;
    }
    leafClusterTexture() {
      return canvasTexture(512,(c,s)=>{
        const rng=W.random(2003);c.lineCap='round';
        for(let branch=0;branch<9;branch++) {
          const angle=branch*2.4,ex=256+Math.cos(angle)*(130+rng()*95),ey=256+Math.sin(angle)*(100+rng()*125);
          c.strokeStyle='#5a5237';c.lineWidth=2.5;c.beginPath();c.moveTo(256,280);c.quadraticCurveTo(256+(ex-256)*.5,200+(ey-200)*.5,ex,ey);c.stroke();
          for(let k=0;k<15;k++) {
            const t=.1+rng()*.9,x=256+(ex-256)*t+(rng()-.5)*90,y=270+(ey-270)*t+(rng()-.5)*80,a=rng()*TAU,len=11+rng()*18,w=len*(.33+rng()*.2);
            c.save();c.translate(x,y);c.rotate(a);const g=c.createLinearGradient(-w,0,w,0);g.addColorStop(0,'#475336');g.addColorStop(.47,'#84905b');g.addColorStop(1,'#4d5a32');c.fillStyle=g;
            c.beginPath();c.moveTo(0,-len);c.bezierCurveTo(w,-len*.3,w,len*.3,0,len);c.bezierCurveTo(-w,len*.3,-w,-len*.3,0,-len);c.fill();
            c.strokeStyle='#b6ad6d80';c.lineWidth=.6;c.beginPath();c.moveTo(0,-len*.85);c.lineTo(0,len*.85);c.stroke();c.restore();
          }
        }
      });
    }
    build() {this.buildGround();this.buildTrees();this.buildUndergrowth();this.buildLandmarks();this.batches.finish();this.assetsReady=Promise.all(this.promises);}
    buildGround() {
      const geo=new T.PlaneGeometry(240,240,170,170);geo.rotateX(-Math.PI/2);const p=geo.attributes.position,colors=[],color=new T.Color();
      const under=new T.Color('#96977d'),path=new T.Color('#d0baa0');
      for(let i=0;i<p.count;i++) {
        const x=p.getX(i),z=p.getZ(i),d=W.pathDistance(x,z);p.setY(i,W.height(x,z));
        color.copy(under).lerp(path,1-smooth(1.1,2.7,d)).multiplyScalar(.93+noise(x*.4,0,z*.4)*.04);colors.push(color.r,color.g,color.b);
      }
      geo.setAttribute('color',new T.Float32BufferAttribute(colors,3));geo.computeVertexNormals();
      const map=this.texture('ground-color',true,94),normal=this.texture('ground-normal',false,94);
      const mat=material('#bcbba9',{map,normalMap:normal,normalScale:new T.Vector2(.58,.58),roughness:.95,vertexColors:true});
      const ground=new T.Mesh(geo,mat);ground.receiveShadow=true;this.scene.add(ground);
      // The shallow water follows the ground rather than floating over a bank.
      const g=new T.CircleGeometry(3,64);g.rotateX(-Math.PI/2);const wp=g.attributes.position;
      for(let i=0;i<wp.count;i++){const x=wp.getX(i),z=wp.getZ(i);wp.setY(i,W.height(x-32,z-35)+.028);}
      g.computeVertexNormals();this.water=new T.Mesh(g,material('#334b46',{metalness:.45,roughness:.18,transparent:true,opacity:.67}));this.water.position.set(-32,0,-35);this.scene.add(this.water);
    }
    buildTrees() {
      const b=this.batches,leafGeo=new T.PlaneGeometry(1,1,2,2);leafGeo.translate(0,.5,0);
      for(const tree of this.world.trees) {
        const rng=W.random(tree.seed),x=tree.x,z=tree.z,h=tree.h,r=tree.r,bendX=(rng()-.5)*3,bendZ=(rng()-.5)*3;
        const points=[];for(let i=0;i<=6;i++){const t=i/6;points.push(v3(x+bendX*t*t+Math.sin(t*4)*.22,tree.y+h*t-.12,z+bendZ*t*t));}
        b.merge(tube(points,r*1.2,r*.055,14,10,.06),this.bark,x,z);
        for(let j=0;j<4;j++) {
          const a=j*TAU/4+rng()*.7,reach=r*(2.1+rng()*1.3),rx=x+Math.cos(a)*reach,rz=z+Math.sin(a)*reach;
          b.merge(tube([v3(x,tree.y+.65,z),v3(x+Math.cos(a)*reach*.35,tree.y+.19,z+Math.sin(a)*reach*.35),v3(rx,W.height(rx,rz)-.045,rz)],r*.46,.018,5,6),this.bark,x,z);
        }
        for(let i=0;i<6;i++) {
          const level=2+Math.floor(rng()*4),start=points[level].clone(),a=i*2.4+rng()*.7,length=(2.6+rng()*2.1)*(1-level*.07);
          const elbow=start.clone().add(v3(Math.cos(a)*length*.52,.22+rng()*.65,Math.sin(a)*length*.52));
          const tip=elbow.clone().add(v3(Math.cos(a+.3)*length*.65,1.2+rng()*1.5,Math.sin(a+.3)*length*.65));
          b.merge(tube([start,elbow,tip],r*(.34-level*.025),.015,7,6),this.bark,x,z);
          for(let fork=0;fork<2;fork++) {
            const angle=a+(fork?-.9:.9),joint=elbow.clone().lerp(tip,.45),end=tip.clone().add(v3(Math.cos(angle)*(.7+rng()),.45+rng()*.7,Math.sin(angle)*(.7+rng())));
            b.merge(tube([joint,tip.clone().lerp(end,.4),end],.045,.004,4,4),this.twig,x,z);
          }
          if(!tree.bare&&i%2===0) {
            const size=3.1+rng()*1.5;
            for(let card=0;card<3;card++) {
              const pos=tip.clone().add(v3((rng()-.5)*1.1,-.5,(rng()-.5)*1.1));
              b.add(leafGeo,this.leafMaterial,pos,v3(size,size*.73,1),new T.Euler(-.5+rng(),a+card*Math.PI/3,(rng()-.5)*.7),new T.Color().setHSL(.16+rng()*.075,.18,.69+rng()*.2));
            }
          }
        }
      }
      for(let i=0;i<this.world.rocks.length;i++) {
        const r=this.world.rocks[i];b.add(this.geo.rocks[i%3],this.stone,v3(r.x,r.y+r.r*.38,r.z),v3(r.r,r.r*.82,r.r*.9),new T.Euler(.12,r.a,.12));
      }
    }
    fernGeometry() {
      const positions=[],uvs=[];
      const center=t=>v3(0,Math.sin(t*Math.PI*.72)*.76,t*.95);
      for(let i=1;i<11;i++) {
        const t=i/12,p=center(t),length=Math.sin(t*Math.PI)*.27;
        for(const sign of [-1,1])for(let segment=0;segment<3;segment++) {
          const a=segment/3,b=(segment+1)/3;
          const leaf=(q,edge)=>v3(sign*length*q,p.y+.09*Math.sin(q*Math.PI)-.035*q+edge*.015,p.z-q*.12+edge*Math.sin(q*Math.PI)*.034);
          const v=[leaf(a,-1),leaf(a,1),leaf(b,-1),leaf(a,1),leaf(b,1),leaf(b,-1)];
          for(const point of v){positions.push(point.x,point.y,point.z);uvs.push(0,0);}
        }
      }
      const geo=new T.BufferGeometry();geo.setAttribute('position',new T.Float32BufferAttribute(positions,3));geo.setAttribute('uv',new T.Float32BufferAttribute(uvs,2));return softenNormals(geo);
    }
    grassGeometry() {
      const rng=W.random(71),positions=[];
      for(let blade=0;blade<6;blade++) {
        const a=rng()*TAU,h=.28+rng()*.5,w=.009+rng()*.009,x=(rng()-.5)*.2,z=(rng()-.5)*.2;
        const point=(t,side)=>v3(x+Math.sin(a)*t*t*h*.47+Math.cos(a)*side*w*(1-t),h*t,z+Math.cos(a)*t*t*h*.47-Math.sin(a)*side*w*(1-t));
        for(let j=0;j<3;j++)for(const [t,side] of [[j/3,-1],[j/3,1],[(j+1)/3,-1],[j/3,1],[(j+1)/3,1],[(j+1)/3,-1]]){const p=point(t,side);positions.push(p.x,p.y,p.z);}
      }
      const geo=new T.BufferGeometry();geo.setAttribute('position',new T.Float32BufferAttribute(positions,3));return softenNormals(geo);
    }
    buildUndergrowth() {
      const b=this.batches,rng=W.random(83),fern=this.fernGeometry(),grass=this.grassGeometry();
      const leafGeo=new T.SphereGeometry(1,8,4,0,TAU,0,Math.PI);leafGeo.scale(.06,.012,.13);
      const fallenLeaf=material('#795435',{roughness:.98,side:T.DoubleSide});fallenLeaf.userData.shadow=false;
      for(let i=0;i<4100;i++) {
        const a=rng()*TAU,d=Math.sqrt(rng())*80,x=Math.cos(a)*d,z=Math.sin(a)*d,pd=W.pathDistance(x,z),y=W.height(x,z);
        if(pd>1.8) {
          const size=.48+rng()*.66;
          if(i%5===0)for(let j=0;j<5;j++)b.add(fern,this.fernMaterial,v3(x,y,z),v3(size,size,size),new T.Euler(0,j*TAU/5+rng()*.3,0),new T.Color().setHSL(.2+rng()*.06,.25,.55+rng()*.25));
          else b.add(grass,this.grassMaterial,v3(x,y,z),v3(.7+rng()*.5,.6+rng()*.6,.7+rng()*.5),new T.Euler(0,rng()*TAU,0),new T.Color().setHSL(.12+rng()*.08,.2,.6+rng()*.25));
        }
        if(d<60&&i%2===0){const lx=x+.2+rng()*.7,lz=z+(rng()-.5)*1.2;b.add(leafGeo,fallenLeaf,v3(lx,W.height(lx,lz)+.012,lz),v3(1+rng(),1,1+rng()),new T.Euler(0,rng()*TAU,0),new T.Color().setHSL(.045+rng()*.08,.28,.55+rng()*.35));}
      }
      const mushroom=material('#d0c5a5',{roughness:.8}),mushStem=material('#a49d83');mushroom.userData.shadow=mushStem.userData.shadow=false;
      const cap=new T.SphereGeometry(1,16,10,0,TAU,0,Math.PI*.58),stem=new T.CylinderGeometry(.4,.6,1,8);
      const cutTexture=canvasTexture(256,(c,s)=>{c.fillStyle='#968465';c.fillRect(0,0,s,s);const rng=W.random(65);for(let i=0;i<35;i++){c.strokeStyle=i%3?'#5a4a3550':'#c1ac8555';c.lineWidth=.5+rng()*2;c.beginPath();c.ellipse(s/2,s/2,4+i*3.7,3+i*3.4,.2,0,TAU);c.stroke();}for(let i=0;i<8;i++){const a=rng()*TAU;c.strokeStyle='#302d26';c.beginPath();c.moveTo(128+Math.sin(a)*80,128+Math.cos(a)*80);c.lineTo(128+Math.sin(a)*125,128+Math.cos(a)*125);c.stroke();}});
      const cut=material('#b9a482',{map:cutTexture,roughness:.98}),disk=new T.CircleGeometry(1,28);
      for(const [x,z,a] of [[-6,4,1.1],[7,-18,.4],[-17,17,1.9],[35,8,.2],[-21,-31,2.4]]) {
        const y=W.height(x,z),start=v3(x,y+.24,z),end=v3(x+Math.cos(a)*4,y+.34,z+Math.sin(a)*4);
        b.merge(tube([start,start.clone().lerp(end,.5).add(v3(0,.06,0)),end],.38,.31,12,14,.05),this.bark,x,z);
        const direction=end.clone().sub(start).normalize(),rotation=new T.Quaternion().setFromUnitVectors(v3(0,0,1),direction);
        b.add(disk,cut,end.clone().addScaledVector(direction,.006),v3(.31,.31,1),rotation);
        b.add(disk,cut,start.clone().addScaledVector(direction,-.006),v3(.38,.38,1),new T.Quaternion().setFromUnitVectors(v3(0,0,1),direction.clone().negate()));
        for(let step=0;step<=8;step++)this.world.addCollider(x+Math.cos(a)*step*.5,z+Math.sin(a)*step*.5,.43,.7);
        for(let k=0;k<8;k++){const mx=x+(rng()-.5)*2,mz=z+(rng()-.5)*2,my=W.height(mx,mz),s=.055+rng()*.085;b.add(stem,mushStem,v3(mx,my+s,mz),v3(s*.38,s*2,s*.38));b.add(cap,mushroom,v3(mx,my+s*2,mz),v3(s,s*.4,s));}
      }
    }
    buildLandmarks() {
      const b=this.batches,g=this.geo,rng=W.random(390),base=W.height(24,-24);
      for(let row=0;row<5;row++) {
        for(let col=0;col<10;col++)for(const z of [-27,-21]) {
          if(z===-21&&row>2&&col>2&&col<7)continue;
          if(row===4&&rng()<.18)continue;
          const x=20.5+col*.76+(row%2)*.18;
          b.add(g.stones[(row+col)%3],this.stone,v3(x,base+.31+row*.55,z),v3(.76,.53+rng()*.07,.66),new T.Euler((rng()-.5)*.04,(rng()-.5)*.06,(rng()-.5)*.045));
        }
        for(let col=0;col<8;col++)for(const x of [20.5,27.5]) {
          const z=-26.5+col*.72;if(x===20.5&&z>-25.5&&z<-23&&row<4)continue;
          if(x===27.5&&col>2&&col<6&&row>1&&row<4)continue;
          b.add(g.stones[(row+col)%3],this.stone,v3(x,base+.31+row*.55,z),v3(.65,.53,.73),new T.Euler(0,0,(rng()-.5)*.035));
        }
      }
      for(const points of [[v3(20.5,base+3,-27),v3(24,base+5,-27)],[v3(24,base+5,-27),v3(27.5,base+3,-27)],[v3(24,base+5,-27),v3(24,base+3.1,-23)]])b.merge(tube(points,.14,.11,5,8),this.wood,24,-24);
      for(let i=0;i<24;i++){const x=21+rng()*6,z=-26+rng()*4;b.add(g.rocks[i%3],this.stone,v3(x,base+.13,z),v3(.15+rng()*.3,.14+rng()*.15,.2+rng()*.15),new T.Euler(rng(),rng(),rng()));}
      const wx=-27,wz=-39,wy=W.height(wx,wz);
      for(let row=0;row<3;row++)for(let i=0;i<12;i++){const a=(i+(row%2)*.5)*TAU/12;b.add(g.stones[(row+i)%3],this.stone,v3(wx+Math.sin(a),wy+.2+row*.37,wz+Math.cos(a)),v3(.57,.37,.52),new T.Euler(0,a,0));}
      const dark=new T.Mesh(new T.CircleGeometry(.84,40),material('#080f12'));dark.rotation.x=-Math.PI/2;dark.position.set(wx,wy+.1,wz);this.scene.add(dark);
      for(let i=0;i<7;i++){const a=i*TAU/7,x=46+Math.sin(a)*3.7,z=32+Math.cos(a)*3.7;b.add(g.rocks[i%3],this.stone,v3(x,W.height(x,z)+1.1,z),v3(.61,1.65+rng()*.3,.52),new T.Euler(.08,a,.09));}
      const sx=-2.3,sz=-10.5,sy=W.height(sx,sz);
      b.merge(tube([v3(sx,sy,sz),v3(sx+.12,sy+1.9,sz+.02)],.085,.065,5,10),this.wood,sx,sz);
      // Gently bevelled plank, backed by two iron nail heads.
      b.add(g.stone,this.wood,v3(sx+.1,sy+1.6,sz),v3(1.3,.28,.085),new T.Euler(0,-.3,-.08));
      const iron=material('#453e32',{metalness:.65,roughness:.65});for(const dx of [-.25,.25])b.add(g.sphere,iron,v3(sx+.1+dx,sy+1.6,sz+.06),v3(.016,.016,.012));
      this.forest.pumpkins=[];
      for(const [x,z,s] of [[2.5,1.2,.32],[3.15,.5,.22],[-3.3,-9,.28],[19.9,-22.7,.34],[28,-20,.24],[-25,-37,.24]])this.pumpkin(x,z,s);
    }
    pumpkin(x,z,s) {
      const group=new T.Group();group.position.set(x,W.height(x,z)+s*.76,z);group.rotation.y=Math.atan2(-x,7-z);this.scene.add(group);
      const geometry=new T.SphereGeometry(1,48,28),p=geometry.attributes.position;
      for(let i=0;i<p.count;i++){const px=p.getX(i),py=p.getY(i),pz=p.getZ(i),angle=Math.atan2(px,pz),rib=1+.065*Math.cos(angle*10);p.setXYZ(i,px*rib*s,py*s*.77-Math.exp(-Math.hypot(px,pz)*7)*s*.13,pz*rib*s);}
      softenNormals(geometry);const skin=material('#be622c',{roughness:.73});const fruit=new T.Mesh(geometry,skin);fruit.castShadow=fruit.receiveShadow=true;group.add(fruit);
      const stem=new T.Mesh(tube([v3(0,s*.65,0),v3(s*.06,s*.96,s*.02),v3(s*.12,s*1.08,s*.015)],s*.12,s*.065,8,9,.12),this.wood);stem.castShadow=true;group.add(stem);
      const face=canvasTexture(256,(c)=>{c.fillStyle='#ffe1a3';c.beginPath();c.moveTo(45,112);c.lineTo(102,106);c.lineTo(84,66);c.fill();c.beginPath();c.moveTo(154,106);c.lineTo(212,112);c.lineTo(174,66);c.fill();c.beginPath();c.moveTo(62,157);c.lineTo(89,173);c.lineTo(107,170);c.lineTo(109,181);c.lineTo(142,181);c.lineTo(145,169);c.lineTo(163,171);c.lineTo(193,154);c.lineTo(179,190);c.lineTo(143,204);c.lineTo(112,203);c.lineTo(79,187);c.closePath();c.fill();});
      const faceGeo=new T.SphereGeometry(s*1.008,32,20,Math.PI*.14,Math.PI*.72,Math.PI*.2,Math.PI*.64);faceGeo.scale(1,.77,1);
      // Curved cutouts hug the fruit rather than floating as flat neon triangles.
      const carving=new T.Mesh(faceGeo,new T.MeshStandardMaterial({map:face,emissiveMap:face,emissive:'#ff9b38',emissiveIntensity:1.7,alphaTest:.5,roughness:.8,side:T.DoubleSide}));group.add(carving);
      const glow=new T.Sprite(new T.SpriteMaterial({map:this.forest.glow,color:'#ffab48',opacity:.12,transparent:true,depthWrite:false,blending:T.AdditiveBlending}));glow.position.set(0,.05,s*.9);glow.scale.setScalar(s*3.4);group.add(glow);this.forest.pumpkins.push(glow);
    }
    get stats() {
      let visibleChunks=0,visibleTriangles=0,geometryBytes=0;const seen=new Set();
      for(const mesh of this.batches.meshes)if(!seen.has(mesh.geometry)){seen.add(mesh.geometry);for(const attr of Object.values(mesh.geometry.attributes))geometryBytes+=attr.array.byteLength;geometryBytes+=mesh.geometry.index?.array.byteLength||0;}
      for(const mesh of this.batches.meshes)if(mesh.visible){visibleChunks++;visibleTriangles+=(mesh.geometry.index?.count||mesh.geometry.attributes.position.count)/3*(mesh.isInstancedMesh?mesh.count:1);}
      return {chunks:this.batches.meshes.length,visibleChunks,visibleTriangles,textures:this.textureCache.size,geometryBytes};
    }
    update(t,player) {this.time.value=t;this.batches.update(player);}
  }
  root.SkogEnvironment=Environment;
})(globalThis);
