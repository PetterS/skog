(function(root){
  'use strict';
  const T=THREE, W=SkogWorld, TAU=Math.PI*2;
  function canvasTexture(size,paint){const c=document.createElement('canvas');c.width=c.height=size;paint(c.getContext('2d'),size);const t=new T.CanvasTexture(c);t.colorSpace=T.SRGBColorSpace;return t;}
  function glowTexture(){return canvasTexture(128,(c,s)=>{const g=c.createRadialGradient(s/2,s/2,0,s/2,s/2,s/2);g.addColorStop(0,'rgba(255,247,206,1)');g.addColorStop(.12,'rgba(255,233,180,.65)');g.addColorStop(.4,'rgba(255,233,180,.12)');g.addColorStop(1,'rgba(255,233,180,0)');c.fillStyle=g;c.fillRect(0,0,s,s);});}
  function mesh(geometry,mat,parent,x=0,y=0,z=0){const m=new T.Mesh(geometry,mat);m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;parent.add(m);return m;}
  class Forest {
    constructor(canvas,world){
      this.world=world;this.scene=new T.Scene();this.scene.background=new T.Color('#06090b');this.scene.fog=new T.FogExp2('#111b20',.046);
      this.renderer=new T.WebGLRenderer({canvas,antialias:true,alpha:false,powerPreference:'high-performance'});
      this.renderer.setPixelRatio(Math.min(devicePixelRatio,1.6));this.renderer.setSize(innerWidth,innerHeight);
      this.renderer.outputColorSpace=T.SRGBColorSpace;this.renderer.toneMapping=T.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.15;this.exposure=1.15;
      this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=T.PCFSoftShadowMap;
      this.camera=new T.PerspectiveCamera(56,innerWidth/innerHeight,.1,180);
      this.hemisphere=new T.HemisphereLight('#6b8592','#16150f',.16);this.scene.add(this.hemisphere);
      this.moonlight=new T.DirectionalLight('#9db7d1',.42);this.moonlight.position.set(-24,38,-36);this.moonlight.castShadow=true;
      const shadow=this.moonlight.shadow;shadow.mapSize.set(1024,1024);shadow.camera.left=-22;shadow.camera.right=22;shadow.camera.top=22;shadow.camera.bottom=-22;shadow.camera.near=1;shadow.camera.far=100;shadow.normalBias=.045;shadow.bias=-.0003;
      shadow.autoUpdate=false;shadow.needsUpdate=true;
      this.scene.add(this.moonlight,this.moonlight.target);
      this.glow=glowTexture();
      this.environment=new SkogEnvironment(this);this.environment.build();
      this.buildSky();this.buildAtmosphere();this.buildChild();
      this.pipeline=new SkogRenderPipeline(this.renderer,this.scene,this.camera,this.child);
      // Scattering strengths are tuned for the HDR haze; the direct fallback
      // keeps exponential fog, mist cards and a soft halo around the flame.
      this.pipeline.atmosphere={moon:this.moonlight,lantern:this.lanternLight,ambient:new T.Color(.0024,.0036,.0048),moonScatter:.035,lanternScatter:.09,mist:.08};
      const volumetric=this.pipeline.enabled;
      for(const m of this.mist)m.sprite.visible=!volumetric;
      this.fallbackHalo=new T.Sprite(new T.SpriteMaterial({map:this.glow,color:'#ffb066',transparent:true,opacity:.16,depthWrite:false,blending:T.AdditiveBlending}));
      this.fallbackHalo.scale.setScalar(5);this.fallbackHalo.visible=!volumetric;this.scene.add(this.fallbackHalo);
      this.presence=new SkogPresence(this);
      this.scene.updateMatrixWorld(true);this.lastShadow=new T.Vector3(999,999,999);this.frames=0;
    }
    buildSky(){
      const moon=mesh(new T.SphereGeometry(4.2,24,16),new T.MeshBasicMaterial({color:'#9fa49a',fog:false}),this.scene,-35,61,-100);moon.castShadow=false;
      const halo=new T.Sprite(new T.SpriteMaterial({map:this.glow,color:'#7f94a0',transparent:true,opacity:.12,depthWrite:false,fog:false,blending:T.AdditiveBlending}));halo.position.copy(moon.position);halo.scale.set(32,32,1);this.scene.add(halo);
      const starPos=[],rng=W.random(17);for(let i=0;i<230;i++){const x=(rng()-.5)*260,z=(rng()-.5)*260,y=75+rng()*45;starPos.push(x,y,z);}
      const stars=new T.BufferGeometry();stars.setAttribute('position',new T.Float32BufferAttribute(starPos,3));this.scene.add(new T.Points(stars,new T.PointsMaterial({color:'#8fa0a6',size:.12,transparent:true,opacity:.22,fog:false,depthWrite:false})));
    }
    buildAtmosphere(){
      const fogMap=canvasTexture(128,(c,s)=>{const g=c.createRadialGradient(64,64,0,64,64,64);g.addColorStop(0,'rgba(208,225,220,.24)');g.addColorStop(.4,'rgba(208,225,220,.14)');g.addColorStop(1,'rgba(208,225,220,0)');c.fillStyle=g;c.fillRect(0,0,s,s);});
      this.mist=[];const rng=W.random(222);
      for(let i=0;i<36;i++){const x=(rng()-.5)*105,z=(rng()-.5)*105;const sprite=new T.Sprite(new T.SpriteMaterial({map:fogMap,color:'#3c4d52',opacity:.2,transparent:true,depthWrite:false}));sprite.position.set(x,W.height(x,z)+.6+rng()*1.1,z);sprite.scale.set(13+rng()*15,2+rng()*2,1);this.scene.add(sprite);this.mist.push({sprite,x,z,phase:rng()*TAU});}
    }
    buildChild(){
      this.character=new SkogCharacter({scene:this.scene,glowTexture:this.glow});
      this.child=this.character.group;this.lanternLight=this.character.lanternLight;
      this.character.flame.material.color.setRGB(4.2,2.5,.9);
      // Restrained cool sky fill keeps the face readable. Warm light comes
      // from the occluded lantern, rather than an unshadowed second source.
      this.characterFill=new T.PointLight('#8ea3b0',.3,4.5,1.7);
      this.scene.add(this.characterFill);
      const contact=canvasTexture(64,(c)=>{const g=c.createRadialGradient(32,32,0,32,32,32);g.addColorStop(0,"rgba(0,0,0,.68)");g.addColorStop(1,"rgba(0,0,0,0)");c.fillStyle=g;c.fillRect(0,0,64,64);});
      this.contact=mesh(new T.PlaneGeometry(1.2,1.2),new T.MeshBasicMaterial({map:contact,transparent:true,depthWrite:false}),this.scene);this.contact.rotation.x=-Math.PI/2;this.contact.castShadow=false;
      this.contact.material.opacity=.38;
      this.footContacts=this.character.legs.map(()=>{
        const shadow=mesh(new T.PlaneGeometry(.33,.46),new T.MeshBasicMaterial({map:contact,transparent:true,depthWrite:false,opacity:.8}),this.scene);
        shadow.rotation.x=-Math.PI/2;shadow.castShadow=false;return shadow;
      });
      this.footPosition=new T.Vector3();
    }
    update(t,dt,player,camera){
      this.character.update(t,dt,player);
      this.characterFill.position.set(player.x+Math.sin(player.heading)*1.1,W.height(player.x,player.z)+2.2,player.z+Math.cos(player.heading)*1.1);
      this.environment.update(t,player);
      this.contact.position.set(player.x,W.height(player.x,player.z)+.035,player.z);
      for(let i=0;i<2;i++){
        const foot=this.character.legs[i].foot,shadow=this.footContacts[i];
        this.footPosition.set(0,-.125,.037).applyMatrix4(foot.matrixWorld);
        const y=W.height(this.footPosition.x,this.footPosition.z);
        shadow.position.set(this.footPosition.x,y+.04,this.footPosition.z);
        shadow.rotation.z=-player.heading;
        shadow.material.opacity=.8*W.clamp(1-(this.footPosition.y-y)/.12,0,1);
      }
      const target=new T.Vector3(player.x,W.height(player.x,player.z)+1.075,player.z);
      const distance=camera.distance,desired=new T.Vector3(player.x+Math.sin(camera.yaw)*distance*Math.cos(camera.pitch),target.y+Math.sin(camera.pitch)*distance,player.z+Math.cos(camera.yaw)*distance*Math.cos(camera.pitch));
      const allowed=this.world.cameraDistance(target,desired),desiredLength=desired.distanceTo(target);
      const arm=desired.clone().sub(target).normalize().multiplyScalar(Math.min(allowed,desiredLength));
      camera.actualDistance=camera.actualDistance===undefined?allowed:T.MathUtils.lerp(camera.actualDistance,allowed,allowed<camera.actualDistance?1:1-Math.exp(-dt*4));
      arm.setLength(Math.min(camera.actualDistance,desiredLength));desired.copy(target).add(arm);
      this.camera.position.copy(desired);this.camera.lookAt(target);
      // Avoid an opaque head filling the view when backing up against a tree.
      this.character.setVisible(allowed>1);
      if(this.lastShadow.distanceToSquared(this.child.position)>9){this.moonlight.position.copy(this.child.position).add(new T.Vector3(-24,38,-36));this.moonlight.target.position.copy(this.child.position);this.lastShadow.copy(this.child.position);this.moonlight.shadow.needsUpdate=true;}
      for(const m of this.mist){m.sprite.position.x=m.x+Math.sin(t*.035+m.phase)*4;m.sprite.position.z=m.z+Math.cos(t*.027+m.phase)*2;}
      const level=this.character.lanternLevel;
      this.presence.update(t,dt,player,camera,level,this.lanternLight);
      this.fallbackHalo.position.copy(this.lanternLight.position);this.fallbackHalo.material.opacity=.16*level;
      // Eyes adapt: losing the flame plunges everything into black, then the
      // night slowly resolves. Relighting is briefly dazzling.
      const adapted=1.15+(1-level)*1.25,rate=adapted>this.exposure?.22:2.5;
      this.exposure+=(adapted-this.exposure)*(1-Math.exp(-dt*rate));this.renderer.toneMappingExposure=this.exposure;
      this.pumpkins.forEach((p,i)=>p.material.opacity=.13+Math.sin(t*3+i)*.025);
      this.pipeline.render(t,player.motionSpeed||0);this.frames++;
    }
    resize(){this.camera.aspect=innerWidth/innerHeight;this.camera.fov=innerWidth<innerHeight?64:56;this.camera.updateProjectionMatrix();this.renderer.setSize(innerWidth,innerHeight);this.pipeline?.resize();}
    setQuality(ratio){this.renderer.setPixelRatio(ratio);this.renderer.setSize(innerWidth,innerHeight);this.pipeline?.resize();}
  }
  root.SkogForest=Forest;
})(globalThis);
