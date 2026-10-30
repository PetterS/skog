(function(root){
  'use strict';
  const T=THREE, W=SkogWorld, TAU=Math.PI*2;
  const up=new T.Vector3(0,1,0), dummy=new T.Object3D();
  function canvasTexture(size,paint){const c=document.createElement('canvas');c.width=c.height=size;paint(c.getContext('2d'),size);const t=new T.CanvasTexture(c);t.colorSpace=T.SRGBColorSpace;return t;}
  function glowTexture(){return canvasTexture(128,(c,s)=>{const g=c.createRadialGradient(s/2,s/2,0,s/2,s/2,s/2);g.addColorStop(0,'rgba(255,247,206,1)');g.addColorStop(.12,'rgba(255,233,180,.65)');g.addColorStop(.4,'rgba(255,233,180,.12)');g.addColorStop(1,'rgba(255,233,180,0)');c.fillStyle=g;c.fillRect(0,0,s,s);});}
  function material(color,extra={}){return new T.MeshStandardMaterial({color,roughness:.95,...extra});}
  function mesh(geometry,mat,parent,x=0,y=0,z=0){const m=new T.Mesh(geometry,mat);m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;parent.add(m);return m;}
  class Batch {
    constructor(scene){this.scene=scene;this.buckets=new Map();}
    add(geometry,mat,pos,scale,rotation=null,color=null){
      const key=geometry.uuid+mat.uuid;let b=this.buckets.get(key);
      if(!b){b={geometry,mat,items:[]};this.buckets.set(key,b);}
      dummy.position.copy(pos);dummy.scale.set(scale.x,scale.y,scale.z);dummy.quaternion.identity();
      if(rotation instanceof T.Quaternion)dummy.quaternion.copy(rotation);else if(rotation)dummy.rotation.set(rotation.x,rotation.y,rotation.z);
      dummy.updateMatrix();b.items.push({matrix:dummy.matrix.clone(),color});
    }
    segment(geo,mat,a,b,r1,r2=1){const d=new T.Vector3().subVectors(b,a);this.add(geo,mat,new T.Vector3().addVectors(a,b).multiplyScalar(.5),new T.Vector3(r1,d.length(),r1*r2),new T.Quaternion().setFromUnitVectors(up,d.normalize()));}
    finish(){for(const b of this.buckets.values()){const m=new T.InstancedMesh(b.geometry,b.mat,b.items.length);b.items.forEach((item,i)=>{m.setMatrixAt(i,item.matrix);if(item.color)m.setColorAt(i,item.color);});m.castShadow=b.mat.userData.shadow!==false;m.receiveShadow=true;m.computeBoundingSphere();this.scene.add(m);}this.buckets.clear();}
  }
  class Forest {
    constructor(canvas,world){
      this.world=world;this.scene=new T.Scene();this.scene.background=new T.Color('#293e46');this.scene.fog=new T.FogExp2('#293e46',.033);
      this.renderer=new T.WebGLRenderer({canvas,antialias:true,alpha:false,powerPreference:'high-performance'});
      this.renderer.setPixelRatio(Math.min(devicePixelRatio,1.6));this.renderer.setSize(innerWidth,innerHeight);
      this.renderer.outputColorSpace=T.SRGBColorSpace;this.renderer.toneMapping=T.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.08;
      this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=T.PCFSoftShadowMap;
      this.camera=new T.PerspectiveCamera(56,innerWidth/innerHeight,.1,180);
      this.scene.add(new T.HemisphereLight('#9cbfc2','#333128',1.15));
      this.moonlight=new T.DirectionalLight('#b7d3da',2.2);this.moonlight.position.set(-24,38,-36);this.moonlight.castShadow=true;
      const shadow=this.moonlight.shadow;shadow.mapSize.set(1024,1024);shadow.camera.left=-22;shadow.camera.right=22;shadow.camera.top=22;shadow.camera.bottom=-22;shadow.camera.near=1;shadow.camera.far=100;shadow.normalBias=.045;shadow.bias=-.0003;
      this.scene.add(this.moonlight,this.moonlight.target);
      this.glow=glowTexture();this.batch=new Batch(this.scene);this.rng=W.random(911);
      this.geo={trunk:new T.CylinderGeometry(.72,1,1,7,1,true),branch:new T.CylinderGeometry(.38,1,1,5,1,true),rock:new T.IcosahedronGeometry(1,1),leaf:new T.IcosahedronGeometry(1,0),box:new T.BoxGeometry(1,1,1),sphere:new T.SphereGeometry(1,10,7)};
      const barkMap=canvasTexture(128,(c,s)=>{const rng=W.random(16);c.fillStyle='#948879';c.fillRect(0,0,s,s);for(let i=0;i<320;i++){const x=rng()*s,y=rng()*s;c.strokeStyle=`rgba(26,29,25,${rng()*.42})`;c.lineWidth=.4+rng()*1.7;c.beginPath();c.moveTo(x,y);c.bezierCurveTo(x+3,y+8,x-2,y+16,x+rng()*4-2,y+24+rng()*50);c.stroke();}});barkMap.wrapS=barkMap.wrapT=T.RepeatWrapping;
      this.bark=material('#665e51',{map:barkMap});this.twig=material('#383b35');this.foliage=material('#343e34',{flatShading:true});this.foliage.userData.shadow=false;
      this.stone=material('#65726c',{flatShading:true});this.wood=material('#544b3b');this.moss=material('#505c38');
      this.buildGround();this.buildSky();this.buildTrees();this.buildUndergrowth();this.buildLandmarks();this.batch.finish();this.buildAtmosphere();this.buildChild();
      this.scene.updateMatrixWorld(true);this.lastShadow=new T.Vector3(999,999,999);this.frames=0;
    }
    buildGround(){
      const tex=canvasTexture(256,(c,s)=>{const r=W.random(22);c.fillStyle='#aaa58d';c.fillRect(0,0,s,s);for(let i=0;i<15000;i++){const v=90+r()*115;c.fillStyle=`rgba(${v},${v},${v*.88},${r()*.36})`;const size=r()*2.5+.4;c.fillRect(r()*s,r()*s,size,size);}for(let i=0;i<150;i++){c.strokeStyle='#454a3733';c.beginPath();const x=r()*s,y=r()*s;c.moveTo(x,y);c.lineTo(x+r()*12-6,y+r()*12-6);c.stroke();}});
      tex.wrapS=tex.wrapT=T.RepeatWrapping;tex.repeat.set(44,44);tex.anisotropy=Math.min(4,this.renderer.capabilities.getMaxAnisotropy());
      const geo=new T.PlaneGeometry(240,240,170,170);geo.rotateX(-Math.PI/2);const pos=geo.attributes.position,colors=[];
      const forest=new T.Color('#465047'),path=new T.Color('#85775d'),color=new T.Color(),rng=W.random(23);
      for(let i=0;i<pos.count;i++){const x=pos.getX(i),z=pos.getZ(i);pos.setY(i,W.height(x,z));const distance=W.pathDistance(x,z);const t=1-W.clamp((distance-1.05)/1.3,0,1);color.copy(forest).lerp(path,t*.83).multiplyScalar(.78+rng()*.3);colors.push(color.r,color.g,color.b);}
      geo.setAttribute('color',new T.Float32BufferAttribute(colors,3));geo.computeVertexNormals();
      const ground=mesh(geo,material('#ffffff',{map:tex,vertexColors:true}),this.scene);ground.castShadow=false;
      // A quiet pool next to the old well. Its surface catches the moon.
      const water=new T.CircleGeometry(3.1,48);water.rotateX(-Math.PI/2);
      this.water=mesh(water,material('#2a474b',{metalness:.7,roughness:.22,transparent:true,opacity:.83}),this.scene,-32,W.height(-32,-35)+.04,-35);this.water.scale.set(1,.7,1.5);this.water.castShadow=false;
    }
    buildSky(){
      const moon=mesh(new T.SphereGeometry(4.2,24,16),new T.MeshBasicMaterial({color:'#e1e3c6',fog:false}),this.scene,-35,61,-100);moon.castShadow=false;
      const halo=new T.Sprite(new T.SpriteMaterial({map:this.glow,color:'#bfd4cb',transparent:true,opacity:.24,depthWrite:false,fog:false,blending:T.AdditiveBlending}));halo.position.copy(moon.position);halo.scale.set(32,32,1);this.scene.add(halo);
      const starPos=[],rng=W.random(17);for(let i=0;i<230;i++){const x=(rng()-.5)*260,z=(rng()-.5)*260,y=75+rng()*45;starPos.push(x,y,z);}
      const stars=new T.BufferGeometry();stars.setAttribute('position',new T.Float32BufferAttribute(starPos,3));this.scene.add(new T.Points(stars,new T.PointsMaterial({color:'#c1d5cf',size:.12,transparent:true,opacity:.45,fog:false,depthWrite:false})));
    }
    buildTrees(){
      const b=this.batch,g=this.geo,trunkVertices=[],trunkUV=[];
      for(const tree of this.world.trees){
        const rng=W.random(tree.seed),p=new T.Vector3(tree.x,tree.y-.15,tree.z),h=tree.h;
        const bendX=(rng()-.5)*3,bendZ=(rng()-.5)*3,points=[p];
        for(let i=1;i<=5;i++){const t=i/5;points.push(new T.Vector3(tree.x+bendX*t*t+Math.sin(t*5)*.35,tree.y+h*t,tree.z+bendZ*t*t));}
        // Shared rings make the bent, tapered trunk continuous at every joint.
        const ring=(level,side)=>{const a=side/8*TAU,r=tree.r*(1-level/5*.82)*(level===0?1.35:1),p=points[level];return [p.x+Math.cos(a)*r,p.y,p.z+Math.sin(a)*r];};
        for(let level=0;level<5;level++)for(let side=0;side<8;side++){
          for(const [l,s] of [[level,side],[level+1,side],[level,side+1],[level,side+1],[level+1,side],[level+1,side+1]]){trunkVertices.push(...ring(l,s));trunkUV.push(s/8,l*.9);}
        }
        // Flared roots anchor every trunk to the uneven forest floor.
        for(let i=0;i<4;i++){const a=rng()*TAU;const q=new T.Vector3(tree.x+Math.cos(a)*tree.r*3,W.height(tree.x+Math.cos(a)*tree.r*3,tree.z+Math.sin(a)*tree.r*3)+.04,tree.z+Math.sin(a)*tree.r*3);b.segment(g.branch,this.bark,q,p.clone().add(new T.Vector3(0,.75,0)),tree.r*.52);}
        for(let i=0;i<7;i++){
          const level=2+Math.floor(rng()*3),a=i*2.4+rng(),length=(2.5+rng()*2.8)*(1-level*.1),start=points[level].clone();
          const elbow=start.clone().add(new T.Vector3(Math.cos(a)*length*.65,length*.3,Math.sin(a)*length*.65));
          const tip=elbow.clone().add(new T.Vector3(Math.cos(a+.35)*length*.55,1+rng()*2,Math.sin(a+.35)*length*.55));
          b.segment(g.branch,this.bark,start,elbow,tree.r*.49);b.segment(g.branch,this.twig,elbow,tip,tree.r*.23);
          const fork=tip.clone().add(new T.Vector3(Math.cos(a-1)*1.1,.6+rng(),Math.sin(a-1)*1.1));b.segment(g.branch,this.twig,elbow.clone().lerp(tip,.5),fork,.07);
          if(!tree.bare&&i%2===0){const c=new T.Color().setHSL(.16+rng()*.12,.12+rng()*.16,.17+rng()*.1);b.add(g.rock,this.foliage,tip,new T.Vector3(2.2+rng(),.8+rng()*.5,1.8+rng()),new T.Euler(rng(),rng()*TAU,rng()),c);}
        }
      }
      const trunks=new T.BufferGeometry();trunks.setAttribute('position',new T.Float32BufferAttribute(trunkVertices,3));trunks.setAttribute('uv',new T.Float32BufferAttribute(trunkUV,2));trunks.computeVertexNormals();mesh(trunks,this.bark,this.scene);
      for(const r of this.world.rocks){b.add(g.rock,this.stone,new T.Vector3(r.x,r.y+r.r*.3,r.z),new T.Vector3(r.r,r.r*.75,r.r*.85),new T.Euler(.2,r.a,.3));b.add(g.rock,this.moss,new T.Vector3(r.x,r.y+r.r*.75,r.z),new T.Vector3(r.r*.68,r.r*.2,r.r*.6),new T.Euler(0,r.a,.1));}
    }
    buildUndergrowth(){
      const rng=W.random(83),b=this.batch,g=this.geo;
      const fernMat=material('#5b6a48',{side:T.DoubleSide});fernMat.userData.shadow=false;
      const fernGeo=new T.BufferGeometry(),vertices=[];
      for(let j=0;j<7;j++){const t=j/7,y=t*.7,z=t*.75,w=(1-t)*.26;vertices.push(0,y,z,-w,y-.04,z-.14,0,y+.1,z+.15,0,y,z,w,y-.04,z-.14,0,y+.1,z+.15);}
      fernGeo.setAttribute('position',new T.Float32BufferAttribute(vertices,3));fernGeo.computeVertexNormals();
      const grassMat=material('#5d6244',{side:T.DoubleSide});grassMat.userData.shadow=false;
      const grassGeo=new T.BufferGeometry();grassGeo.setAttribute('position',new T.Float32BufferAttribute([-.06,0,0,.06,0,0,.12,.65,.1,0,0,-.05,0,0,.05,-.1,.5,0],3));grassGeo.computeVertexNormals();
      const leafMat=material('#9d7548',{side:T.DoubleSide});leafMat.userData.shadow=false;
      const leafGeo=new T.CircleGeometry(.13,5);leafGeo.rotateX(-Math.PI/2);leafGeo.scale(.55,1,1);
      for(let i=0;i<4200;i++){
        const a=rng()*TAU,d=Math.sqrt(rng())*81,x=Math.cos(a)*d,z=Math.sin(a)*d,pd=W.pathDistance(x,z),y=W.height(x,z);
        if(pd>1.9){const scale=.35+rng()*.65;
          if(i%4===0)for(let j=0;j<5;j++)b.add(fernGeo,fernMat,new T.Vector3(x,y,z),new T.Vector3(scale,scale,scale),new T.Euler(0,j*TAU/5+rng()*.3,0));
          else b.add(grassGeo,grassMat,new T.Vector3(x,y,z),new T.Vector3(1,.35+rng(),1),new T.Euler(0,rng()*TAU,0));
        }
        if(d<60){const color=new T.Color().setHSL(.065+rng()*.07,.3+rng()*.2,.2+rng()*.2);b.add(leafGeo,leafMat,new T.Vector3(x,y+.025,z),new T.Vector3(1+rng(),1,1+rng()),new T.Euler(0,rng()*TAU,0),color);}
      }
      // Fallen timber, and tiny pale mushrooms tucked into its lee.
      for(const [x,z,a] of [[-6,4,1.1],[7,-18,.4],[-17,17,1.9],[35,8,.2],[-21,-31,2.4]]){
        const y=W.height(x,z),end=new T.Vector3(x+Math.cos(a)*4,y+.35,z+Math.sin(a)*4);b.segment(g.trunk,this.bark,new T.Vector3(x,y+.25,z),end,.45);for(let step=0;step<=8;step++)this.world.addCollider(x+Math.cos(a)*step*.5,z+Math.sin(a)*step*.5,.43,.7);
        for(let k=0;k<6;k++){const mx=x+(rng()-.5)*2,mz=z+(rng()-.5)*2,my=W.height(mx,mz),s=.06+rng()*.08;b.add(g.trunk,this.wood,new T.Vector3(mx,my+s,mz),new T.Vector3(s*.25,s*2,s*.25));b.add(g.sphere,materialCache('mushroom','#b4b39a'),new T.Vector3(mx,my+s*2,mz),new T.Vector3(s,s*.42,s));}
      }
    }
    buildLandmarks(){
      const b=this.batch,g=this.geo,rng=W.random(390),base=W.height(24,-24);
      // Roofless stone cottage. A real gap in the west wall admits the child.
      for(let row=0;row<5;row++){
        for(let col=0;col<10;col++)for(const z of [-27,-21]){
          if(z===-21&&row>2&&col>2&&col<7)continue;
          const x=20.5+col*.76+(row%2)*.18;
          b.add(g.box,this.stone,new T.Vector3(x,base+.33+row*.55,z),new T.Vector3(.73,.48+rng()*.1,.58),new T.Euler(0,(rng()-.5)*.1,(rng()-.5)*.06));
        }
        for(let col=0;col<8;col++)for(const x of [20.5,27.5]){
          const z=-26.5+col*.72;if(x===20.5&&z>-25.5&&z<-23&&row<4)continue;
          if(x===27.5&&col>2&&col<6&&row>1&&row<4)continue;
          b.add(g.box,this.stone,new T.Vector3(x,base+.33+row*.55,z),new T.Vector3(.56,.5,.69),new T.Euler(0,0,(rng()-.5)*.08));
        }
      }
      b.segment(g.trunk,this.wood,new T.Vector3(20.5,base+3,-27),new T.Vector3(24,base+5,-27),.16);
      b.segment(g.trunk,this.wood,new T.Vector3(24,base+5,-27),new T.Vector3(27.5,base+3,-27),.16);
      b.segment(g.trunk,this.wood,new T.Vector3(24,base+5,-27),new T.Vector3(24,base+3.1,-23),.13);
      for(let i=0;i<12;i++){const x=21+rng()*6,z=-26+rng()*4;b.add(g.rock,this.stone,new T.Vector3(x,base+.13,z),new T.Vector3(.2+rng()*.35,.2,.25),new T.Euler(rng(),rng(),rng()));}
      // An abandoned well, open at the centre.
      const wx=-27,wz=-39,wy=W.height(wx,wz);
      for(let row=0;row<3;row++)for(let i=0;i<12;i++){const a=(i+(row%2)*.5)*TAU/12;b.add(g.box,this.stone,new T.Vector3(wx+Math.sin(a),wy+.22+row*.38,wz+Math.cos(a)),new T.Vector3(.55,.35,.5),new T.Euler(0,a,0));}
      const dark=mesh(new T.CircleGeometry(.83,24),material('#070d10'),this.scene,wx,wy+.12,wz);dark.rotation.x=-Math.PI/2;
      for(let i=0;i<7;i++){const a=i*TAU/7,x=46+Math.sin(a)*3.7,z=32+Math.cos(a)*3.7;b.add(g.rock,this.stone,new T.Vector3(x,W.height(x,z)+1,z),new T.Vector3(.6,1.5+rng()*.5,.5),new T.Euler(.12,a,.15));}
      // A weathered sign at the first fork, deliberately without a destination.
      const sx=-2.3,sz=-10.5,sy=W.height(sx,sz);
      b.add(g.trunk,this.wood,new T.Vector3(sx,sy+.95,sz),new T.Vector3(.09,1.9,.09),new T.Euler(.08,0,.12));
      b.add(g.box,this.wood,new T.Vector3(sx,sy+1.6,sz),new T.Vector3(1.25,.27,.09),new T.Euler(0,-.3,-.08));
      this.pumpkins=[];
      for(const [x,z,s] of [[2.5,1.2,.32],[3.15,.5,.22],[-3.3,-9,.28],[19.9,-22.7,.34],[28,-20,.24],[-25,-37,.24]])this.pumpkin(x,z,s);
    }
    pumpkin(x,z,s){
      const group=new T.Group();group.position.set(x,W.height(x,z)+s*.78,z);group.rotation.y=Math.atan2(-x,7-z);this.scene.add(group);
      const orange=materialCache('pumpkin','#a84e1e'),stem=materialCache('stem','#4b5030');
      for(let i=0;i<9;i++){const a=i*TAU/9;const m=mesh(this.geo.sphere,orange,group,Math.sin(a)*s*.38,0,Math.cos(a)*s*.38);m.scale.set(s*.66,s*.82,s*.66);}
      const stalk=mesh(this.geo.trunk,stem,group,0,s*.87,0);stalk.scale.set(s*.13,s*.4,s*.13);stalk.rotation.z=.3;
      const emissive=materialCache('carving','#ffc56a',{emissive:'#ff9d24',emissiveIntensity:2.8,side:T.DoubleSide});
      const tri=new T.BufferGeometry();tri.setAttribute('position',new T.Float32BufferAttribute([-.07,-.04,0,.07,-.04,0,0,.085,0],3));tri.computeVertexNormals();
      for(const sign of [-1,1]){const eye=mesh(tri,emissive,group,sign*s*.36,s*.15,s*.91);eye.scale.setScalar(s*2.2);eye.rotation.y=sign*.25;}
      const mouth=mesh(new T.BoxGeometry(s*.63,s*.1,.015),emissive,group,0,-s*.28,s*.98);mouth.rotation.z=.06;
      const glow=new T.Sprite(new T.SpriteMaterial({map:this.glow,color:'#ff9e35',transparent:true,opacity:.16,depthWrite:false,blending:T.AdditiveBlending}));glow.position.set(0,.1,s);glow.scale.setScalar(s*4);group.add(glow);this.pumpkins.push(glow);
    }
    buildAtmosphere(){
      const fogMap=canvasTexture(128,(c,s)=>{const g=c.createRadialGradient(64,64,0,64,64,64);g.addColorStop(0,'rgba(208,225,220,.24)');g.addColorStop(.4,'rgba(208,225,220,.14)');g.addColorStop(1,'rgba(208,225,220,0)');c.fillStyle=g;c.fillRect(0,0,s,s);});
      this.mist=[];const rng=W.random(222);
      for(let i=0;i<36;i++){const x=(rng()-.5)*105,z=(rng()-.5)*105;const sprite=new T.Sprite(new T.SpriteMaterial({map:fogMap,color:'#a6c1bb',opacity:.22,transparent:true,depthWrite:false}));sprite.position.set(x,W.height(x,z)+.6+rng()*1.1,z);sprite.scale.set(13+rng()*15,2+rng()*2,1);this.scene.add(sprite);this.mist.push({sprite,x,z,phase:rng()*TAU});}
      const positions=[];this.moteData=[];for(let i=0;i<100;i++){const x=(rng()-.5)*100,z=(rng()-.5)*100,y=W.height(x,z)+.5+rng()*3;positions.push(x,y,z);this.moteData.push({x,y,z,phase:rng()*TAU});}
      const geo=new T.BufferGeometry();geo.setAttribute('position',new T.Float32BufferAttribute(positions,3));this.motes=new T.Points(geo,new T.PointsMaterial({map:this.glow,color:'#d6d5a2',size:.14,transparent:true,opacity:.7,depthWrite:false,blending:T.AdditiveBlending}));this.scene.add(this.motes);
    }
    buildChild(){
      const group=new T.Group();this.child=group;this.scene.add(group);this.body=new T.Group();group.add(this.body);
      const coat=material('#c18a3a'),trim=material('#d9a94f'),skin=material('#bda080'),hat=material('#8f4138'),dark=material('#272e2c'),bag=material('#4b5849'),leather=material('#70543a');
      const torso=mesh(new T.CylinderGeometry(.2,.29,.52,10),coat,this.body,0,.83,0);torso.scale.z=.78;
      const hem=mesh(new T.CylinderGeometry(.286,.29,.065,10),trim,this.body,0,.58,0);hem.scale.z=.79;
      const hood=mesh(new T.SphereGeometry(.235,12,8),trim,this.body,0,1.09,-.07);hood.scale.set(1,.75,.85);
      this.head=new T.Group();this.head.position.set(0,1.22,.01);this.body.add(this.head);
      const face=mesh(new T.SphereGeometry(.205,16,12),skin,this.head);face.scale.set(.92,1.05,.94);
      const cap=mesh(new T.SphereGeometry(.216,14,10,0,TAU,0,Math.PI*.53),hat,this.head,0,.06,-.012);
      const band=mesh(new T.CylinderGeometry(.216,.216,.075,14),hat,this.head,0,.066,-.012);
      mesh(new T.SphereGeometry(.065,10,7),hat,this.head,.015,.286,-.02);
      for(const sign of [-1,1]){const eye=mesh(new T.SphereGeometry(.018,8,6),dark,this.head,sign*.078,.015,.172);eye.scale.z=.5;mesh(new T.SphereGeometry(.047,8,6),skin,this.head,sign*.185,-.01,0);}
      mesh(new T.SphereGeometry(.035,8,6),skin,this.head,0,-.035,.197);
      const backpack=mesh(new T.BoxGeometry(.29,.34,.14),bag,this.body,0,.85,-.24);const flap=mesh(new T.BoxGeometry(.3,.11,.16),leather,this.body,0,1,-.245);flap.rotation.x=-.12;
      for(const sign of [-1,1]){const strap=mesh(new T.BoxGeometry(.045,.43,.03),leather,this.body,sign*.14,.86,.17);strap.rotation.z=sign*.08;}
      this.legs=[];this.arms=[];
      for(const sign of [-1,1]){
        const leg=new T.Group();leg.position.set(sign*.115,.6,0);this.body.add(leg);
        mesh(new T.CylinderGeometry(.085,.071,.45,8),dark,leg,0,-.22,0);const boot=mesh(new T.BoxGeometry(.16,.2,.26),dark,leg,0,-.5,.045);this.legs.push(leg);
        const arm=new T.Group();arm.position.set(sign*.235,1.02,0);this.body.add(arm);arm.rotation.z=sign*.13;
        mesh(new T.CylinderGeometry(.09,.07,.34,8),coat,arm,0,-.14,0);mesh(new T.SphereGeometry(.072,10,8),skin,arm,0,-.34,0);this.arms.push(arm);
      }
      this.lantern=new T.Group();this.arms[0].add(this.lantern);this.lantern.position.set(0,-.57,.015);
      const metal=material('#403b2e',{metalness:.55,roughness:.45});
      const handle=mesh(new T.TorusGeometry(.08,.012,5,12,Math.PI),metal,this.lantern,0,.17,0);
      mesh(new T.CylinderGeometry(.105,.13,.065,8),metal,this.lantern,0,.105,0);
      mesh(new T.CylinderGeometry(.13,.105,.05,8),metal,this.lantern,0,-.1,0);
      const glass=mesh(new T.CylinderGeometry(.085,.085,.17,8),material('#ffe5a5',{emissive:'#ffad39',emissiveIntensity:3}),this.lantern);glass.castShadow=false;
      for(let i=0;i<4;i++){const a=i*TAU/4;mesh(new T.CylinderGeometry(.009,.009,.23,5),metal,this.lantern,Math.sin(a)*.09,0,Math.cos(a)*.09);}
      this.lanternGlow=new T.Sprite(new T.SpriteMaterial({map:this.glow,color:'#ffb854',opacity:.58,transparent:true,depthWrite:false,blending:T.AdditiveBlending}));this.lanternGlow.scale.set(1.1,1.1,1);this.lantern.add(this.lanternGlow);
      this.lanternLight=new T.PointLight('#ffc477',13,12,1.65);this.lantern.add(this.lanternLight);
      // The character uses a moving contact shadow; cached moon shadows belong
      // to the forest, avoiding a stale silhouette when the child walks away.
      group.traverse(object=>{object.castShadow=false;});
      // Soft contact shadow remains stable even on lower-resolution phones.
      const contact=canvasTexture(64,(c)=>{const g=c.createRadialGradient(32,32,0,32,32,32);g.addColorStop(0,'rgba(0,0,0,.6)');g.addColorStop(1,'rgba(0,0,0,0)');c.fillStyle=g;c.fillRect(0,0,64,64);});
      this.contact=mesh(new T.PlaneGeometry(1.3,1.3),new T.MeshBasicMaterial({map:contact,transparent:true,depthWrite:false}),this.scene);this.contact.rotation.x=-Math.PI/2;this.contact.castShadow=false;
    }
    update(t,dt,player,camera){
      this.child.position.set(player.x,W.height(player.x,player.z)+.025,player.z);this.child.rotation.y=player.heading;
      const walk=player.walk,amount=player.speed/3.1;
      this.body.position.y=Math.sin(walk*2)*.025*amount;this.body.rotation.z=Math.sin(walk)*.025*amount;
      this.legs[0].rotation.x=Math.sin(walk)*.55*amount;this.legs[1].rotation.x=-Math.sin(walk)*.55*amount;
      this.arms[1].rotation.x=Math.sin(walk)*.4*amount;this.arms[0].rotation.x=-.14-Math.sin(walk)*.18*amount;
      this.lantern.rotation.x=Math.sin(walk+.7)*.12*amount+Math.sin(t*1.2)*.025;
      this.head.rotation.y=Math.sin(t*.37)*.08;this.lanternLight.intensity=13+Math.sin(t*7.7)*.55+Math.sin(t*13.1)*.3;
      this.contact.position.set(player.x,this.child.position.y+.025,player.z);
      const target=new T.Vector3(player.x,this.child.position.y+1.05,player.z);
      const distance=camera.distance,desired=new T.Vector3(player.x+Math.sin(camera.yaw)*distance*Math.cos(camera.pitch),target.y+Math.sin(camera.pitch)*distance,player.z+Math.cos(camera.yaw)*distance*Math.cos(camera.pitch));
      const allowed=this.world.cameraDistance(target,desired),desiredLength=desired.distanceTo(target);
      const arm=desired.clone().sub(target).normalize().multiplyScalar(Math.min(allowed,desiredLength));
      camera.actualDistance=camera.actualDistance===undefined?allowed:T.MathUtils.lerp(camera.actualDistance,allowed,allowed<camera.actualDistance?1:1-Math.exp(-dt*4));
      arm.setLength(Math.min(camera.actualDistance,desiredLength));desired.copy(target).add(arm);
      this.camera.position.copy(desired);this.camera.lookAt(target);
      // Avoid an opaque head filling the view when backing up against a tree.
      this.child.visible=allowed>1;
      if(this.lastShadow.distanceToSquared(this.child.position)>9){this.moonlight.position.copy(this.child.position).add(new T.Vector3(-24,38,-36));this.moonlight.target.position.copy(this.child.position);this.lastShadow.copy(this.child.position);this.renderer.shadowMap.needsUpdate=true;}
      for(const m of this.mist){m.sprite.position.x=m.x+Math.sin(t*.035+m.phase)*4;m.sprite.position.z=m.z+Math.cos(t*.027+m.phase)*2;}
      const pos=this.motes.geometry.attributes.position;for(let i=0;i<this.moteData.length;i++){const m=this.moteData[i];pos.setXYZ(i,m.x+Math.sin(t*.2+m.phase)*.5,m.y+Math.sin(t*.45+m.phase)*.25,m.z+Math.cos(t*.16+m.phase)*.5);}pos.needsUpdate=true;
      this.pumpkins.forEach((p,i)=>p.material.opacity=.13+Math.sin(t*3+i)*.025);
      this.renderer.render(this.scene,this.camera);this.renderer.shadowMap.autoUpdate=false;this.frames++;
    }
    resize(){this.camera.aspect=innerWidth/innerHeight;this.camera.fov=innerWidth<innerHeight?64:56;this.camera.updateProjectionMatrix();this.renderer.setSize(innerWidth,innerHeight);}
    setQuality(ratio){this.renderer.setPixelRatio(ratio);this.renderer.setSize(innerWidth,innerHeight);}
  }
  const mats=new Map();function materialCache(key,color,extra){if(!mats.has(key))mats.set(key,material(color,extra));return mats.get(key);}
  root.SkogForest=Forest;
})(globalThis);
