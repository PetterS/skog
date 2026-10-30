/* Things in the dark: eyeshine at the edge of the lantern, moths drawn to it. */
(function (root) {
  'use strict';
  const T = THREE, W = SkogWorld, TAU = Math.PI * 2;
  const smooth = (a,b,x) => {const t=W.clamp((x-a)/(b-a),0,1);return t*t*(3-2*t);};
  function canvasTexture(size,paint){const c=document.createElement('canvas');c.width=c.height=size;paint(c.getContext('2d'),size);const t=new T.CanvasTexture(c);t.colorSpace=T.SRGBColorSpace;return t;}
  function eyeTexture(){return canvasTexture(64,(c,s)=>{const g=c.createRadialGradient(s/2,s/2,0,s/2,s/2,s/2);g.addColorStop(0,'rgba(255,255,255,1)');g.addColorStop(.16,'rgba(255,255,255,.92)');g.addColorStop(.32,'rgba(255,255,255,.22)');g.addColorStop(1,'rgba(255,255,255,0)');c.fillStyle=g;c.fillRect(0,0,s,s);});}
  function wingTexture(){
    return canvasTexture(128,(c,s)=>{
      // One pair of dusty forewings and hindwings, veined, on a transparent card.
      c.translate(s/2,s/2);
      for(const side of [-1,1]){
        c.save();c.scale(side,1);
        const g=c.createLinearGradient(0,0,58,0);g.addColorStop(0,'#6f6250');g.addColorStop(.6,'#a4957a');g.addColorStop(1,'#80725b');
        c.fillStyle=g;c.beginPath();c.moveTo(2,-6);c.bezierCurveTo(26,-40,58,-34,60,-14);c.bezierCurveTo(56,0,26,4,2,4);c.fill();
        c.fillStyle='#8d7f68';c.beginPath();c.moveTo(2,2);c.bezierCurveTo(30,4,44,22,34,34);c.bezierCurveTo(20,38,6,22,2,8);c.fill();
        c.strokeStyle='rgba(50,42,32,.55)';c.lineWidth=1.2;
        for(const a of [-.75,-.45,-.15]){c.beginPath();c.moveTo(3,-1);c.lineTo(Math.cos(a)*56,Math.sin(a)*40);c.stroke();}
        c.fillStyle='rgba(40,34,26,.6)';c.beginPath();c.arc(34,-16,4,0,TAU);c.fill();
        c.restore();
      }
      c.fillStyle='#4a4033';c.beginPath();c.ellipse(0,4,3.4,15,0,0,TAU);c.fill();
    });
  }
  class Presence {
    constructor(forest) {
      this.forest=forest;this.scene=forest.scene;this.world=forest.world;
      // Attention builds while the lantern burns and slowly fades in the dark.
      this.attention=0;this.litTime=0;this.wasLit=true;this.stalk=0;this.nextEye=18+Math.random()*10;this.lastDistance=26;
      this.onSound=null;this.events={eyes:0,retreats:0};
      this.view=new T.Vector3();this.temp=new T.Vector3();this.side=new T.Vector3();
      const eyeMap=eyeTexture();
      this.eyes=[0,1].map(()=>{
        const group=new T.Group();group.visible=false;this.scene.add(group);
        const pair=[0,1].map(()=>{const s=new T.Sprite(new T.SpriteMaterial({map:eyeMap,color:new T.Color(),transparent:true,depthWrite:false,blending:T.AdditiveBlending,fog:false}));group.add(s);return s;});
        return {group,pair,state:'idle',age:0,life:0,blink:0,watched:0,tint:new T.Color(),size:.1,spacing:.12,phase:0,base:new T.Vector3()};
      });
      const wing=new T.PlaneGeometry(.09,.09);wing.rotateX(-Math.PI/2+.25);
      this.mothMaterial=new T.MeshStandardMaterial({map:wingTexture(),alphaTest:.4,side:T.DoubleSide,roughness:.9,color:'#cbbda0',emissive:'#6a4a26',emissiveIntensity:.5});
      this.moths=new T.InstancedMesh(wing,this.mothMaterial,9);this.moths.frustumCulled=false;this.moths.castShadow=false;this.scene.add(this.moths);
      this.mothData=[...Array(9)].map((_,i)=>({phase:Math.random()*TAU,speed:.8+Math.random()*.9,radius:.22+Math.random()*.42,arrival:0,threshold:i/9,position:new T.Vector3(),flap:9+Math.random()*7}));
      this.dummy=new T.Object3D();
      // Dust only exists where the lantern reaches. It is hidden in darkness.
      const count=140,positions=new Float32Array(count*3),colors=new Float32Array(count*3);
      this.dust=[...Array(count)].map(()=>({x:(Math.random()-.5)*9,y:Math.random()*2.6,z:(Math.random()-.5)*9,phase:Math.random()*TAU,speed:.05+Math.random()*.12}));
      const geo=new T.BufferGeometry();geo.setAttribute('position',new T.BufferAttribute(positions,3));geo.setAttribute('color',new T.BufferAttribute(colors,3));
      this.dustPoints=new T.Points(geo,new T.PointsMaterial({map:forest.glow,size:.035,vertexColors:true,transparent:true,depthWrite:false,blending:T.AdditiveBlending}));
      this.dustPoints.frustumCulled=false;this.scene.add(this.dustPoints);
    }
    // Eyes peek from beside a trunk, off to the side of the view, out where the
    // lantern barely reaches. Encounters creep closer as attention grows.
    spawn(eye,player,camera) {
      const forward=this.view.set(-Math.sin(camera.yaw),0,-Math.cos(camera.yaw));
      const near=Math.max(11,21-this.attention*9),farther=near+10,candidates=[];
      for(const tree of this.world.trees){
        const dx=tree.x-player.x,dz=tree.z-player.z,d=Math.hypot(dx,dz);
        if(d<near||d>farther)continue;
        const angle=Math.acos(W.clamp((dx*forward.x+dz*forward.z)/d,-1,1));
        if(angle<.1||angle>.6)continue;
        candidates.push(tree);
      }
      // Without a trunk to hide behind, they wait out in the open dark.
      if(!candidates.length){
        const a=Math.atan2(forward.x,forward.z)+(Math.random()<.5?-1:1)*(.12+Math.random()*.4),d=near+Math.random()*8;
        candidates.push({x:player.x+Math.sin(a)*d,z:player.z+Math.cos(a)*d,r:-.3,h:0});
      }
      let tree,x,z;
      for(let attempt=0;attempt<8&&!tree;attempt++){
        const option=candidates[Math.floor(Math.random()*candidates.length)];
        const dx=option.x-player.x,dz=option.z-player.z,d=Math.hypot(dx,dz),sign=Math.random()<.5?-1:1;
        this.side.set(-dz/d*sign,0,dx/d*sign);
        x=option.x+this.side.x*(option.r+.45);z=option.z+this.side.z*(option.r+.45);
        if(![...this.world.nearby(x,z,.4)].some(c=>(c.x!==option.x||c.z!==option.z)&&Math.hypot(c.x-x,c.z-z)<c.r))tree=option;
      }
      if(!tree)return false;
      const d=Math.hypot(tree.x-player.x,tree.z-player.z),tall=Math.random()<.18+this.attention*.2;
      eye.base.set(x,W.height(x,z)+(tall?1.8+Math.random()*.35:.65+Math.random()*.45),z);
      eye.size=tall?.09:.07+Math.random()*.02;eye.spacing=tall?.15:.075+Math.random()*.04;
      eye.tint.set(tall?'#ffb38a':Math.random()<.5?'#c8ffb4':'#ffe9a6');
      eye.state='in';eye.age=0;eye.life=4+Math.random()*7;eye.blink=1.5+Math.random()*2;eye.watched=0;eye.phase=Math.random()*TAU;
      eye.facing=Math.atan2(player.x-x,player.z-z);eye.group.visible=true;this.events.eyes++;this.lastDistance=d;
      return true;
    }
    retreat(eye,sound) {
      if(eye.state==='idle'||eye.state==='out')return;
      eye.state='out';eye.age=0;
      if(sound&&Math.random()<.7){this.events.retreats++;this.onSound?.('branch',{x:eye.base.x,y:eye.base.y,z:eye.base.z});}
    }
    update(t,dt,player,camera,lanternLevel,lantern) {
      const lit=lanternLevel>.5;
      // Dousing the light does not mean whatever noticed it has gone.
      if(this.wasLit&&!lit&&this.attention>.3)this.stalk=3+Math.random()*5;
      this.wasLit=lit;
      if(this.stalk>0&&(this.stalk-=dt)<=0){
        if(!lit){const a=camera.yaw+(Math.random()-.5)*1.6,d=7+Math.random()*5;this.events.stalks=(this.events.stalks||0)+1;
          this.onSound?.('branch',{x:player.x+Math.sin(a)*d,y:W.height(player.x,player.z)+.3,z:player.z+Math.cos(a)*d});}
        this.stalk=0;
      }
      if(lit){this.litTime+=dt;this.attention=Math.min(1,this.attention+dt/150);}
      else this.attention=Math.max(0,this.attention-dt/400);
      const cam=this.forest.camera,dir=cam.getWorldDirection(this.view.clone());
      if(lit&&(this.nextEye-=dt)<=0){
        const free=this.eyes.find(e=>e.state==='idle');
        if(free&&this.spawn(free,player,camera))this.nextEye=Math.max(9,32-this.attention*20)+Math.random()*18;
        else this.nextEye=2;
      }
      for(const eye of this.eyes){
        if(eye.state==='idle')continue;
        eye.age+=dt;
        const d=Math.hypot(eye.base.x-player.x,eye.base.z-player.z);
        // Eyeshine is reflected light: without the lantern there is nothing to see.
        if(d<9||(!lit&&eye.state!=='out'))this.retreat(eye,d<9);
        // Holding one's gaze on them is enough to make them withdraw.
        this.temp.copy(eye.base).sub(cam.position).normalize();
        if(dir.dot(this.temp)>.993)eye.watched+=dt;
        if(eye.watched>1.4)this.retreat(eye,false);
        if(eye.state==='in'&&eye.age>1.6){eye.state='hold';eye.age=0;}
        if(eye.state==='hold'&&eye.age>eye.life)this.retreat(eye,Math.random()<.4);
        let level=eye.state==='in'?smooth(0,1.6,eye.age):eye.state==='hold'?1:1-smooth(0,eye.state==='out'&&!lit?.05:.35,eye.age);
        if(eye.state==='out'&&eye.age>.4){eye.state='idle';eye.group.visible=false;continue;}
        eye.blink-=dt;if(eye.blink<-.13)eye.blink=1.2+Math.random()*3;if(eye.blink<0)level=0;
        const sway=Math.sin(t*.7+eye.phase)*.04,bob=Math.sin(t*1.3+eye.phase)*.015;
        const facing=eye.facing,cx=Math.cos(facing),sz=-Math.sin(facing);
        eye.pair.forEach((s,i)=>{
          const o=(i?.5:-.5)*eye.spacing;
          s.position.set(eye.base.x+cx*o+sway*cx,eye.base.y+bob,eye.base.z+sz*o+sway*sz);
          s.scale.setScalar(eye.size);
          // Retroreflection carries further through the haze than diffuse light.
          const glow=level*lanternLevel*14*Math.exp(-d*.045);
          s.material.color.copy(eye.tint).multiplyScalar(glow);
        });
      }
      // Moths gather while the lantern burns and scatter once it goes out.
      const flame=lantern.position;let shown=0;
      for(let i=0;i<this.mothData.length;i++){
        const m=this.mothData[i],wanted=lit&&this.attention*1.8+this.litTime/90>m.threshold;
        m.arrival=W.clamp(m.arrival+(wanted?dt/5:-dt/1.5),0,1);
        if(m.arrival<=0){this.dummy.scale.setScalar(0);this.dummy.updateMatrix();this.moths.setMatrixAt(i,this.dummy.matrix);continue;}
        shown++;
        const a=t*m.speed*2.1+m.phase,dart=Math.sin(t*3.7+m.phase*2)*Math.sin(t*1.9+m.phase)*.12;
        const r=m.radius+dart+(1-m.arrival)*3.5;
        m.position.set(flame.x+Math.cos(a)*r,flame.y+.12+Math.sin(a*1.7+m.phase)*.22+(1-m.arrival)*1.2,flame.z+Math.sin(a)*r);
        this.dummy.position.copy(m.position);
        this.dummy.rotation.set(Math.sin(t*5+m.phase)*.4,-a,Math.sin(t*4.1+m.phase)*.5);
        const flap=Math.abs(Math.cos(t*m.flap*TAU*.25+m.phase));
        this.dummy.scale.set(.25+flap*.75,1,1);this.dummy.updateMatrix();this.moths.setMatrixAt(i,this.dummy.matrix);
      }
      this.moths.instanceMatrix.needsUpdate=true;this.moths.visible=shown>0;
      const pos=this.dustPoints.geometry.attributes.position,col=this.dustPoints.geometry.attributes.color;
      for(let i=0;i<this.dust.length;i++){
        const p=this.dust[i];
        let x=p.x+Math.sin(t*p.speed+p.phase)*.6,z=p.z+Math.cos(t*p.speed*.8+p.phase)*.6;
        x=((x-player.x+4.5)%9+9)%9-4.5+player.x;z=((z-player.z+4.5)%9+9)%9-4.5+player.z;
        const y=W.height(x,z)+.2+((p.y+t*p.speed*.15)%2.6);
        pos.setXYZ(i,x,y,z);
        const d=Math.hypot(x-flame.x,y-flame.y,z-flame.z),b=lanternLevel*Math.max(0,1-d/3.8)**2*(.6+.4*Math.sin(t*2+p.phase));
        col.setXYZ(i,b*1.4,b*1.05,b*.6);
      }
      pos.needsUpdate=col.needsUpdate=true;
    }
  }
  root.SkogPresence=Presence;
})(globalThis);
