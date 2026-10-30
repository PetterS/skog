(function (root) {
  'use strict';
  const T = THREE, W = SkogWorld, TAU = Math.PI * 2, CELL = 24;
  // Chunk ranges are measured to the nearest edge of a 24 m chunk. Trees fill
  // the fog; ground flora is only submitted for the chunks around the child.
  const coarse = !!root.matchMedia?.('(pointer: coarse)').matches;
  const TREE_RANGE = 40, FLORA_RANGE = coarse ? 14 : 20;
  const v3 = (x=0,y=0,z=0) => new T.Vector3(x,y,z);
  const smooth = (a,b,x) => { const t=W.clamp((x-a)/(b-a),0,1);return t*t*(3-2*t); };
  const noise = (x,y,z) => Math.sin(x*2.31+z*.91)*Math.cos(y*1.73-z*1.13)*.55 + Math.sin(y*3.73+x*1.17)*Math.cos(z*3.11+x*.53)*.28 + Math.sin(x*8.17+y*4.37+z*6.31)*.12;
  const field = (x,z,s=1) => noise(x*.11*s,z*.07*s,x*.05*s-z*.09*s) + noise(z*.31*s+3,x*.23*s,1.7)*.35;
  function canvasTexture(size,paint) {
    const c=document.createElement('canvas');c.width=c.height=size;paint(c.getContext('2d'),size);
    const texture=new T.CanvasTexture(c);texture.colorSpace=T.SRGBColorSpace;texture.anisotropy=4;return texture;
  }
  function material(color,extra={}) { return new T.MeshStandardMaterial({color,roughness:.92,...extra}); }
  function softenNormals(geometry) {
    geometry.computeVertexNormals();
    const p=geometry.attributes.position,n=geometry.attributes.normal,shared=new Map();
    for(let i=0;i<p.count;i++) {
      const key=Math.round(p.getX(i)*1e5)+','+Math.round(p.getY(i)*1e5)+','+Math.round(p.getZ(i)*1e5);
      if(!shared.has(key))shared.set(key,{normal:v3(),indices:[]});
      const entry=shared.get(key);entry.normal.x+=n.getX(i);entry.normal.y+=n.getY(i);entry.normal.z+=n.getZ(i);entry.indices.push(i);
    }
    for(const entry of shared.values()){entry.normal.normalize();for(const i of entry.indices)n.setXYZ(i,entry.normal.x,entry.normal.y,entry.normal.z);}
    return geometry;
  }
  // Moss settles on upward faces, lichen in pale crusts on the flanks.
  const MOSS=new T.Color('#3e4a22'),LICHEN=new T.Color('#b4b9a2'),DEEP_MOSS=new T.Color('#2c3818');
  function boulder(seed=1,segments=28,rings=20) {
    const geo=new T.SphereGeometry(1,segments,rings),p=geo.attributes.position,colors=[],phase=seed*1.97;
    const color=new T.Color();
    for(let i=0;i<p.count;i++) {
      const x=p.getX(i),y=p.getY(i),z=p.getZ(i);
      const n=noise(x+phase,y,z),radius=1+n*.19+Math.sin(x*4+phase)*Math.sin(z*3-y)*.055;
      p.setXYZ(i,x*radius,y*radius*.9,z*radius);
      const moss=smooth(.05,.62,y+noise(x*2.3+phase,y*2,z*2.3)*.38);
      const lichen=smooth(.25,.55,noise(x*5.1+phase,y*4.3,z*5.7))*(1-moss)*smooth(-.6,.1,y);
      color.setRGB(.7,.71,.66).lerp(LICHEN,lichen*.75).lerp(MOSS,moss*.9).lerp(DEEP_MOSS,smooth(.6,1,moss)*smooth(.1,.5,noise(x*6,y*6,z*6+phase))*.6)
        .multiplyScalar((.86+noise(x+4,y,z)*.08)*(1-smooth(-.2,-.8,y)*.35));
      colors.push(color.r,color.g,color.b);
    }
    geo.setAttribute('color',new T.Float32BufferAttribute(colors,3));return softenNormals(geo);
  }
  function roundedStone(seed=1) {
    const geo=new T.BoxGeometry(1,1,1,6,6,6),p=geo.attributes.position,colors=[],color=new T.Color();
    for(let i=0;i<p.count;i++) {
      const x=p.getX(i),y=p.getY(i),z=p.getZ(i),inside=v3(W.clamp(x,-.41,.41),W.clamp(y,-.41,.41),W.clamp(z,-.41,.41));
      const d=v3(x,y,z).sub(inside).normalize().multiplyScalar(.09);
      const s=1+noise(x*2+seed,y*2,z*2)*.045;
      p.setXYZ(i,(inside.x+d.x)*s,(inside.y+d.y)*s,(inside.z+d.z)*s);
      const shade=.74+noise(x+seed,y,z)*.07,moss=smooth(.3,.52,y+noise(x*3+seed,y,z*3)*.12);
      const lichen=smooth(.3,.6,noise(x*6+seed,y*5,z*6))*(1-moss);
      color.setRGB(shade,shade,shade*.94).lerp(LICHEN,lichen*.5).lerp(MOSS,moss*.75);colors.push(color.r,color.g,color.b);
    }
    const uv=geo.attributes.uv;
    for(let i=0;i<uv.count;i++)uv.setXY(i,uv.getX(i)*.48+(seed*.173)%1,uv.getY(i)*.48+(seed*.317)%1);
    geo.setAttribute('color',new T.Float32BufferAttribute(colors,3));return softenNormals(geo);
  }
  // colour(t, up) may tint a tube along its length and by facing (moss on top).
  function tube(points,startRadius,endRadius,segments=10,sides=8,ridges=.025,colour=null) {
    const curve=new T.CatmullRomCurve3(points),frames=curve.computeFrenetFrames(segments,false),positions=[],uvs=[],indices=[],colors=[];
    const length=curve.getLength();
    for(let i=0;i<=segments;i++) {
      const t=i/segments,p=curve.getPointAt(t),radius=T.MathUtils.lerp(startRadius,endRadius,t)*(1+Math.sin(t*Math.PI)*.06);
      for(let j=0;j<=sides;j++) {
        const a=j/sides*TAU,r=radius*(1+Math.sin(a*5+t*2)*ridges),n=frames.normals[i],b=frames.binormals[i];
        const ox=Math.cos(a)*n.x+Math.sin(a)*b.x,oy=Math.cos(a)*n.y+Math.sin(a)*b.y,oz=Math.cos(a)*n.z+Math.sin(a)*b.z;
        positions.push(p.x+r*ox,p.y+r*oy,p.z+r*oz);
        uvs.push(j/sides*1.1,t*length/2);
        if(colour){const c=colour(t,oy);colors.push(c[0],c[1],c[2]);}
        if(i<segments&&j<sides){const k=i*(sides+1)+j;indices.push(k,k+1,k+sides+1,k+1,k+sides+2,k+sides+1);}
      }
    }
    const geo=new T.BufferGeometry();geo.setAttribute('position',new T.Float32BufferAttribute(positions,3));geo.setAttribute('uv',new T.Float32BufferAttribute(uvs,2));
    if(colour)geo.setAttribute('color',new T.Float32BufferAttribute(colors,3));
    geo.setIndex(indices);return softenNormals(geo);
  }
  // A branch spray running along +x. Its cross-section is a shallow tent, so
  // the needle texture keeps volume from the side as well as from below.
  function branchCard(v0,v1,{segments=3,droop=.22,lift=0,fold=.12,width=.9,u0=0,u1=1,tilt=.3}={}) {
    const pos=[],nor=[],uv=[],idx=[];
    for(let i=0;i<=segments;i++) {
      const t=i/segments,y=-droop*t*t+lift*t;
      for(let j=0;j<3;j++) {
        const s=j-1,n=v3(tilt,1,-s*.4).normalize();
        pos.push(t,y-Math.abs(s)*fold*(.35+t*.65),s*width/2);nor.push(n.x,n.y,n.z);uv.push(u0+(u1-u0)*t,v0+(v1-v0)*j/2);
      }
    }
    for(let i=0;i<segments;i++)for(let j=0;j<2;j++){const k=i*3+j;idx.push(k,k+3,k+1,k+1,k+3,k+4);}
    const geo=new T.BufferGeometry();geo.setAttribute('position',new T.Float32BufferAttribute(pos,3));geo.setAttribute('normal',new T.Float32BufferAttribute(nor,3));
    geo.setAttribute('uv',new T.Float32BufferAttribute(uv,2));geo.setIndex(idx);return geo;
  }
  // Crossed upright cards for low shrubs; normals lean up for soft lighting.
  function crossCards(region,count,width,height,{lean=0,base=-.02}={}) {
    const pos=[],nor=[],uv=[],idx=[];const [u0,v0,u1,v1]=region;
    for(let c=0;c<count;c++) {
      const a=c*Math.PI/count,dx=Math.cos(a)*width/2,dz=Math.sin(a)*width/2,k=pos.length/3;
      for(const [x,y,z,u,v] of [[-dx,base,-dz,u0,v0],[dx,base,dz,u1,v0],[-dx+lean*dz,height,-dz-lean*dx,u0,v1],[dx+lean*dz,height,dz-lean*dx,u1,v1]]){pos.push(x,y,z);uv.push(u,v);nor.push(0,1,0);}
      idx.push(k,k+1,k+2,k+1,k+3,k+2);
    }
    const geo=new T.BufferGeometry();geo.setAttribute('position',new T.Float32BufferAttribute(pos,3));geo.setAttribute('normal',new T.Float32BufferAttribute(nor,3));
    geo.setAttribute('uv',new T.Float32BufferAttribute(uv,2));geo.setIndex(idx);return geo;
  }
  // Batched strokes: one Path2D per colour/width keeps procedural painting fast.
  function strokes(c) {
    const paths=new Map();
    return {
      line(style,width,x0,y0,x1,y1){const k=style+'|'+width;let p=paths.get(k);if(!p){p=new Path2D();paths.set(k,p);}p.moveTo(x0,y0);p.lineTo(x1,y1);},
      flush(){c.lineCap='round';for(const [k,p] of paths){const [s,w]=k.split('|');c.strokeStyle=s;c.lineWidth=+w;c.stroke(p);}paths.clear();},
    };
  }
  const pick=(rng,list)=>list[Math.floor(rng()*list.length)];
  function clipped(c,s,x,y,w,h,paint){s.flush();c.save();c.beginPath();c.rect(x,y,w,h);c.clip();paint();s.flush();c.restore();}
  // Walks a curved twig, painting a dark core and needles splayed to both sides.
  function needleTwig(s,rng,x,y,a,len,{curve=0,needle=10,palette,tips,core,stem='#2f261d',stemWidth=2,spread=1.05,step=2.3}) {
    const path=[];
    for(let d=0;d<len;d+=step){
      const nx=x+Math.cos(a)*step,ny=y+Math.sin(a)*step,k=d/len;
      if(core)s.line(core,needle*.38*(1-k*.5),x,y,nx,ny);
      s.line(stem,stemWidth*(1-k*.6)+.4,x,y,nx,ny);
      const n=needle*(1-k*.3);
      for(const side of [-1,1])for(let r=0;r<2;r++){
        const na=a+side*(spread*(.45+rng()*.7)),l=n*(.65+rng()*.5);
        s.line(k>.8&&tips&&rng()<.6?pick(rng,tips):pick(rng,palette),1.5,x,y,x+Math.cos(na)*l,y+Math.sin(na)*l);
      }
      path.push([x,y,a]);a+=curve*step+(rng()-.5)*.03;x=nx;y=ny;
    }
    return path;
  }
  // Static geometry and instances are partitioned spatially. Objects behind the
  // fog are not submitted to the GPU, and each chunk has its own frustum bounds.
  class Batches {
    constructor(scene){this.scene=scene;this.instances=new Map();this.geometry=new Map();this.meshes=[];this.dummy=new T.Object3D();}
    cell(x,z){return `${Math.floor(x/CELL)},${Math.floor(z/CELL)}`;}
    add(geo,mat,p,scale=v3(1,1,1),rotation=null,color=null,range=TREE_RANGE) {
      const cell=this.cell(p.x,p.z),key=cell+':'+geo.uuid+':'+mat.uuid+':'+range;
      if(!this.instances.has(key))this.instances.set(key,{cell,geo,mat,range,items:[]});
      const d=this.dummy;d.position.copy(p);d.scale.copy(scale);d.quaternion.identity();
      if(rotation?.isQuaternion)d.quaternion.copy(rotation);else if(rotation)d.rotation.set(rotation.x,rotation.y,rotation.z,rotation.order||'XYZ');
      d.updateMatrix();this.instances.get(key).items.push({matrix:d.matrix.clone(),color});
    }
    merge(geo,mat,x,z,range=TREE_RANGE) {
      const cell=this.cell(x,z),key=cell+':'+mat.uuid+':'+range;
      if(!this.geometry.has(key))this.geometry.set(key,{cell,mat,range,position:[],normal:[],uv:[],color:[],index:[]});
      const bucket=this.geometry.get(key),offset=bucket.position.length/3,count=geo.attributes.position.count;
      for(const name of ['position','normal','uv']){const a=geo.attributes[name].array;for(let i=0;i<a.length;i++)bucket[name].push(a[i]);}
      const color=geo.attributes.color?.array;
      for(let i=0;i<count*3;i++)bucket.color.push(color?color[i]:1);
      if(geo.index)for(const index of geo.index.array)bucket.index.push(offset+index);
      else for(let i=0;i<count;i++)bucket.index.push(offset+i);
      geo.dispose();
    }
    register(mesh,cell,range) {
      const [x,z]=cell.split(',').map(Number);mesh.userData.chunk=v3((x+.5)*CELL,0,(z+.5)*CELL);mesh.userData.range=range;
      mesh.castShadow=mesh.material.userData.shadow!==false;mesh.receiveShadow=true;
      mesh.frustumCulled=true;this.meshes.push(mesh);this.scene.add(mesh);
    }
    finish() {
      for(const b of this.instances.values()) {
        const m=new T.InstancedMesh(b.geo,b.mat,b.items.length);
        b.items.forEach((item,i)=>{m.setMatrixAt(i,item.matrix);if(item.color)m.setColorAt(i,item.color);});m.computeBoundingSphere();this.register(m,b.cell,b.range);
      }
      for(const b of this.geometry.values()) {
        const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(b.position,3));g.setAttribute('normal',new T.Float32BufferAttribute(b.normal,3));g.setAttribute('uv',new T.Float32BufferAttribute(b.uv,2));
        if(b.mat.vertexColors)g.setAttribute('color',new T.Float32BufferAttribute(b.color,3));
        g.setIndex(b.position.length/3>65535?new T.Uint32BufferAttribute(b.index,1):new T.Uint16BufferAttribute(b.index,1));g.computeBoundingSphere();this.register(new T.Mesh(g,b.mat),b.cell,b.range);
      }
      this.instances.clear();this.geometry.clear();
    }
    update(player) {
      const half=CELL/2;
      for(const m of this.meshes){const p=m.userData.chunk,dx=Math.max(Math.abs(player.x-p.x)-half,0),dz=Math.max(Math.abs(player.z-p.z)-half,0);m.visible=dx*dx+dz*dz<m.userData.range*m.userData.range;}
    }
  }
  class Environment {
    constructor(forest) {
      this.forest=forest;this.scene=forest.scene;this.world=forest.world;this.renderer=forest.renderer;
      this.batches=new Batches(this.scene);this.time={value:0};this.promises=[];this.textureCache=new Map();
      const stones=[roundedStone(4),roundedStone(7),roundedStone(12)];
      this.geo={rocks:[boulder(1),boulder(5),boulder(11)],pebbles:[boulder(3,9,6),boulder(8,8,6)],stones,stone:stones[0],box:new T.BoxGeometry(1,1,1),sphere:new T.SphereGeometry(1,20,14)};
      const barkColor=this.texture('bark-color'),barkNormal=this.texture('bark-normal',false);
      // Bark is tinted per species through vertex colours: one draw per chunk.
      this.bark=material('#ffffff',{map:barkColor,normalMap:barkNormal,normalScale:new T.Vector2(1,1),roughness:.96,vertexColors:true});
      this.deadwood=material('#ffffff',{map:barkColor,normalMap:barkNormal,normalScale:new T.Vector2(.7,.7),roughness:.97,vertexColors:true});this.deadwood.userData.shadow=false;
      this.birchBark=material('#ffffff',{map:this.birchTexture(),normalMap:barkNormal,normalScale:new T.Vector2(.35,.35),roughness:.82,vertexColors:true});
      this.stone=material('#a9ab9f',{map:this.texture('rock-color'),normalMap:this.texture('rock-normal',false),normalScale:new T.Vector2(.85,.85),vertexColors:true,roughness:.93});
      this.pebble=this.stone.clone();this.pebble.userData.shadow=false;
      this.wood=material('#7a6650',{map:barkColor,normalMap:barkNormal,normalScale:new T.Vector2(.4,.4)});
      const foliage=this.foliageTexture();
      // Foliage cards are Lambertian: PBR Fresnel on flat, grazing cards turns
      // lantern-lit fronds into pale sheets (and costs more on phones).
      this.needles=new T.MeshLambertMaterial({color:'#ffffff',map:foliage,alphaTest:.42,side:T.DoubleSide});this.needles.shadowSide=T.DoubleSide;this.wind(this.needles,.05,'x');
      this.flora=new T.MeshLambertMaterial({color:'#a4a294',map:this.floraTexture(),alphaTest:.4,side:T.DoubleSide});this.flora.userData.shadow=false;this.wind(this.flora,.035,'y');
      // Dwarf shrubs shade their own interiors: darken toward the ground so lit
      // clumps keep depth instead of reading as pale, evenly lit caps.
      {const windCompile=this.flora.onBeforeCompile;this.flora.onBeforeCompile=shader=>{windCompile(shader);
        shader.vertexShader='varying float skogClumpHeight;\n'+shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nskogClumpHeight=position.y;');
        shader.fragmentShader='varying float skogClumpHeight;\n'+shader.fragmentShader.replace('#include <map_fragment>','#include <map_fragment>\ndiffuseColor.rgb*=mix(.28,1.0,smoothstep(.0,.32,skogClumpHeight));');};
      this.flora.customProgramCacheKey=()=>'skog-flora-shrub';}
      const R=(x0,y0,x1,y1)=>[x0/1024,1-y1/1024,x1/1024,1-y0/1024];
      this.region={blueberry:R(0,0,512,512),lingon:R(512,0,1024,256),grass:R(512,256,1024,512),fern:R(0,512,512,1024),litter:R(512,512,1024,1024)};
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
    // Sway grows with height ('y', shrubs) or with distance from the trunk ('x').
    wind(mat,amount,axis='y') {
      mat.onBeforeCompile=shader=>{shader.uniforms.skogWindTime=this.time;shader.vertexShader='uniform float skogWindTime;\n'+shader.vertexShader;
        shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
          vec3 swayPosition = position;
          #ifdef USE_INSTANCING
            swayPosition = (instanceMatrix * vec4(0.0,0.0,0.0,1.0)).xyz;
          #endif
          float windPhase = skogWindTime*.7 + swayPosition.x*.31 + swayPosition.z*.19;
          float windWeight = clamp(position.${axis},0.0,1.5);
          transformed.y += sin(windPhase*1.3+position.x*2.0)*${(amount*.5).toFixed(3)}*windWeight;
          transformed.z += (sin(windPhase)+sin(windPhase*1.77)*.28)*${amount.toFixed(3)}*windWeight;
          transformed.x += cos(windPhase*.83)*${(amount*.42).toFixed(3)}*windWeight;`);
        // Dither away foliage right in front of the lens, rather than letting
        // magnified, lantern-lit cards fill the frame. Temporal AA smooths it.
        shader.fragmentShader=shader.fragmentShader.replace('#include <clipping_planes_fragment>',`#include <clipping_planes_fragment>
          float lensDistance=length(vViewPosition);
          if(lensDistance<1.7&&fract(52.9829189*fract(dot(gl_FragCoord.xy,vec2(.06711056,.00583715))))>smoothstep(.55,1.7,lensDistance))discard;`);
      };mat.customProgramCacheKey=()=>`skog-wind-${axis}-${amount}`;
    }
    // Needle atlas: spruce spray (top half), pine tufts, autumn birch twigs.
    foliageTexture() {
      return canvasTexture(1024,(c)=>{
        const rng=W.random(2003),s=strokes(c);
        const spruce=['#1f2c1d','#263623','#2c3d27','#31452b','#283a25','#3a4f31'],tips=['#46603a','#4f6a3e','#3f5636'];
        // Spruce: secondary shoots longest near the base, drooping fringes.
        const cy=256;
        for(let x=24;x<960;x+=25+rng()*12) {
          const k=x/1024;
          for(const side of [-1,1]) {
            const L=(45+245*Math.pow(1-k,.75))*(.75+rng()*.4),a=side*(.62+rng()*.35);
            const path=needleTwig(s,rng,x,cy+(rng()-.5)*6,a,L,{curve:-side*.0018,needle:12,palette:spruce,tips,core:'#1a2418',stem:'#33291f',stemWidth:2.2});
            for(const at of [.3,.55,.78])if(rng()<.85){const [px,py,pa]=path[Math.floor(path.length*at)]||path[0];needleTwig(s,rng,px,py,pa+(rng()<.5?-1:1)*(.55+rng()*.3),L*(1-at)*.6,{needle:10,palette:spruce,tips,core:'#1a2418',stemWidth:1.3});}
          }
        }
        needleTwig(s,rng,0,cy,0,1010,{needle:14,palette:spruce,tips,core:'#1a2418',stem:'#3b2f23',stemWidth:5});
        s.flush();
        // Pine: bare grey-brown shoots ending in long, pale bottlebrush tufts.
        clipped(c,s,0,512,1024,256,()=>{
        const py=640,pine=['#3d4c33','#475a3a','#53653f','#344229','#5c6c45'];
        const shoot=(x0,y0,a,len)=>{let x=x0,y=y0;for(let d=0;d<len;d+=3){const nx=x+Math.cos(a)*3,ny=y+Math.sin(a)*3;s.line('#4a3c2e',4*(1-d/len*.5),x,y,nx,ny);x=nx;y=ny;}return [x,y];};
        const tuft=(x0,y0,a,len,n)=>{for(let i=0;i<n;i++){const t=rng(),x=x0+Math.cos(a)*t*len,y=y0+Math.sin(a)*t*len,na=a+(rng()-.5)*2.6,l=34+rng()*42;s.line('#1e2618',3.2,x,y,x+Math.cos(na)*l*.6,y+Math.sin(na)*l*.6);s.line(pick(rng,pine),1.8,x,y,x+Math.cos(na)*l,y+Math.sin(na)*l);}};
        const [ex,ey]=shoot(0,py,0,860);tuft(ex-120,ey,0,150,230);
        for(const [x,side] of [[300,-1],[420,1],[560,-1],[650,1],[760,-1]]){const a=side*(.7+rng()*.3),[tx,ty]=shoot(x,py,a,60+rng()*30);tuft(tx-Math.cos(a)*20,ty-Math.sin(a)*20,a*.6,60,90);}
        });
        // Birch: fine purple-brown twigs with a sparse scatter of late leaves.
        clipped(c,s,0,768,1024,256,()=>{
        const by=896;
        const twig=(x0,y0,a,len,w,depth)=>{let x=x0,y=y0;const pts=[];for(let d=0;d<len;d+=4){const nx=x+Math.cos(a)*4,ny=y+Math.sin(a)*4;s.line('#3a2f2b',Math.max(.8,w*(1-d/len)),x,y,nx,ny);pts.push([x,y]);x=nx;y=ny;a+=(rng()-.5)*.08;}
          if(depth>0)for(let i=2;i<pts.length;i+=3+Math.floor(rng()*4)){const [px,pyy]=pts[i];twig(px,pyy,a+(rng()<.5?-1:1)*(.4+rng()*.5),len*(.18+rng()*.18)*(1-i/pts.length),w*.5,depth-1);}
          for(const [px,pyy] of pts)if(rng()<.1)leaf(px+(rng()-.5)*8,pyy+(rng()-.5)*8);};
        const leaves=['#a68a33','#8c7429','#b59c45','#6e6230','#7d5a24','#93803a'];
        const leaf=(x,y)=>{c.save();c.translate(x,y);c.rotate(rng()*TAU);c.fillStyle=pick(rng,leaves);c.beginPath();c.ellipse(0,0,7+rng()*3,4.5+rng()*2,0,0,TAU);c.fill();c.restore();};
        twig(0,by,0,1000,3.5,2);
        });
      });
    }
    // Ground flora atlas: blueberry sprigs, lingon, dry grass, fern, litter.
    floraTexture() {
      return canvasTexture(1024,(c)=>{
        const rng=W.random(4111),s=strokes(c);
        const blob=(x,y,rx,ry,a,color)=>{c.fillStyle=color;c.beginPath();c.ellipse(x,y,rx,ry,a,0,TAU);c.fill();};
        // Blåbärsris: green angular stems, small leaves, some turned red.
        const bLeaves=['#2c4422','#36502a','#2f4a25','#425c2e','#6e2b22','#83361f','#4b2a30','#8a6a2a'];
        const stems=[];
        clipped(c,s,0,0,512,512,()=>{
        const stem=(x,y,a,len,w,depth)=>{for(let d=0;d<len;d+=7){const nx=x+Math.cos(a)*7,ny=y+Math.sin(a)*7;s.line(rng()<.5?'#3f5a2c':'#4b6633',w,x,y,nx,ny);stems.push([x,y]);x=nx;y=ny;if(rng()<.18)a+=(rng()-.5)*.9;
          if(depth>0&&rng()<.1)stem(x,y,a+(rng()<.5?-1:1)*(.5+rng()*.4),len*(.3+rng()*.3),w*.7,depth-1);}};
        for(let i=0;i<22;i++)stem(50+rng()*412,512,-Math.PI/2+(rng()-.5)*.8,140+rng()*300,3,2);
        s.flush();
        for(const [x,y] of stems)if(y<480&&rng()<.3){const red=y<330&&rng()<.35;blob(x+(rng()-.5)*14,y+(rng()-.5)*10,7+rng()*3,3.5+rng()*2,rng()*TAU,red?pick(rng,bLeaves.slice(4)):pick(rng,bLeaves.slice(0,4)));}
        for(let i=0;i<10;i++){const [x,y]=pick(rng,stems);if(y<440)blob(x,y,4.5,4.5,0,'#1b2034');}
        });
        // Lingon: dense, low cluster of rounded glossy leaves and red berries.
        clipped(c,s,512,0,512,256,()=>{
        for(let i=0;i<20;i++){let x=540+rng()*460,y=254,a=-Math.PI/2+(rng()-.5)*1.1;for(let d=0;d<90+rng()*110;d+=6){const nx=x+Math.cos(a)*6,ny=y+Math.sin(a)*6;s.line('#3b3324',2,x,y,nx,ny);x=nx;y=ny;}}
        s.flush();
        for(let i=0;i<480;i++){const x=545+rng()*450,y=254-Math.pow(rng(),.7)*200*(1-Math.pow(Math.abs(x-770)/230,2)*.6);if(y<20)continue;blob(x,y,6+rng()*3,4+rng()*2,rng()*TAU,pick(rng,['#1f3219','#26391d','#2c4222','#33492a','#3f5530']));}
        for(let i=0;i<14;i++)blob(600+rng()*340,90+rng()*140,5.5,5.5,0,'#7c1b1a');
        });
        // Dry grass tuft: pale straw and olive blades.
        clipped(c,s,512,256,512,256,()=>{
        for(let i=0;i<105;i++){const x0=700+(rng()-.5)*170,a=-Math.PI/2+(rng()-.5)*1.4,len=120+rng()*130;let x=x0,y=510,ang=a;for(let d=0;d<len;d+=8){const nx=x+Math.cos(ang)*8,ny=y+Math.sin(ang)*8;s.line(pick(rng,['#8a8459','#6f6c45','#a39a68','#5b5a3a','#7d7650']),2.6*(1-d/len)+.6,x,y,nx,ny);x=nx;y=ny;ang+=(ang<-Math.PI/2?-1:1)*.012;}}
        s.flush();
        });
        // Fern frond along +x: tapering pinnae of small lobed pinnules.
        // Open spacing lets the forest floor show between pinnae, so ferns seen
        // from above read as fronds rather than solid pale fans.
        const fern=['#4c5e2c','#56682f','#435426','#5f7034','#4a5a2a'];
        for(let x=14;x<495;x+=27){const k=x/500,len=200*Math.sin(Math.PI*Math.min(1,k*.9+.1))**.8*(1-k*.45);
          for(const side of [-1,1]){const a=side*(.95-k*.3);let px=x,py=768;for(let d=0;d<len;d+=8.5){const nx=px+Math.cos(a)*8.5,ny=py+Math.sin(a)*8.5;const w=(1-d/len)*6.5+3.2;
            blob(px+Math.cos(a+1.25)*w*.75,py+Math.sin(a+1.25)*w*.75,w,1.9,a+1.25,pick(rng,fern));blob(px+Math.cos(a-1.25)*w*.75,py+Math.sin(a-1.25)*w*.75,w,1.9,a-1.25,pick(rng,fern));s.line('#3c4a22',1.3,px,py,nx,ny);px=nx;py=ny;}}}
        s.line('#3a4520',3.2,0,768,500,768);s.flush();
        // Forest litter decal: needles, twigs, cone scales and small birch leaves.
        const litter=['#4f3a26','#5d4329','#3f2f20','#6b4f31','#2f2418'];
        for(let i=0;i<2600;i++){const x=528+rng()*480,y=528+rng()*480,r=Math.hypot(x-768,y-768);if(r>235*(.8+rng()*.2))continue;const a=rng()*TAU,l=7+rng()*9;s.line(pick(rng,litter),1.6,x,y,x+Math.cos(a)*l,y+Math.sin(a)*l);}
        for(let i=0;i<9;i++){const x=600+rng()*330,y=600+rng()*330,a=rng()*TAU,l=40+rng()*90;s.line('#3a2d22',3+rng()*2,x,y,x+Math.cos(a)*l,y+Math.sin(a)*l);}
        s.flush();
        for(let i=0;i<5;i++){const x=620+rng()*300,y=620+rng()*300,a=rng()*TAU;blob(x,y,17,8,a,'#3d2c1d');for(let k=0;k<9;k++)blob(x+Math.cos(a)*(k-4)*3.5,y+Math.sin(a)*(k-4)*3.5,4,7,a+1.57,k%2?'#56402a':'#4a3523');}
        for(let i=0;i<26;i++){const x=560+rng()*410,y=560+rng()*410;if(Math.hypot(x-768,y-768)>220)continue;blob(x,y,7+rng()*3,5+rng()*2,rng()*TAU,pick(rng,['#8c7429','#6e5a26','#7d5a24','#5a4a22']));}
      });
    }
    birchTexture() {
      const t=canvasTexture(512,(c,s)=>{
        const rng=W.random(77);c.fillStyle='#d6d3c8';c.fillRect(0,0,s,s);
        for(let i=0;i<900;i++){c.fillStyle=pick(rng,['#c8c4b6','#e2dfd5','#bdb8aa','#cfcabd']);c.fillRect(rng()*s,rng()*s,4+rng()*30,1+rng()*3);}
        for(let i=0;i<260;i++){const x=rng()*s,y=rng()*s;c.fillStyle=rng()<.7?'#3a3530':'#59524a';c.fillRect(x,y,6+rng()*28,1+rng()*2.5);if(x>s-40)c.fillRect(x-s,y,40,2);}
        for(let i=0;i<34;i++){const x=rng()*s,y=rng()*s,w=12+rng()*60,h=4+rng()*16;c.fillStyle='#1d1b18';c.beginPath();c.ellipse(x,y,w/2,h/2,(rng()-.5)*.3,0,TAU);c.fill();}
      });return t;
    }
    mossTexture() {
      const t=canvasTexture(512,(c,s)=>{
        const rng=W.random(919);c.fillStyle='#34431f';c.fillRect(0,0,s,s);
        const dot=(x,y,r,color)=>{c.fillStyle=color;for(const ox of [-s,0,s])for(const oy of [-s,0,s])if(x+ox>-r&&x+ox<s+r&&y+oy>-r&&y+oy<s+r){c.beginPath();c.arc(x+ox,y+oy,r,0,TAU);c.fill();}};
        for(let i=0;i<220;i++)dot(rng()*s,rng()*s,10+rng()*30,pick(rng,['#2b381a55','#3d4f2455','#26321755','#45582a44']));
        for(let i=0;i<16000;i++)dot(rng()*s,rng()*s,1+rng()*2.4,pick(rng,['#3b4d25','#4a5e2c','#56682f','#2a361b','#435527','#1f2a14','#62703a']));
        for(let i=0;i<500;i++)dot(rng()*s,rng()*s,1.2,pick(rng,['#7a8044','#6d7a3a']));
      });t.wrapS=t.wrapT=T.RepeatWrapping;return t;
    }
    build() {
      this.speciesOf=new Map();this.treeGrid=new Map();
      for(const tree of this.world.trees){const key=Math.floor(tree.x/4)+','+Math.floor(tree.z/4);if(!this.treeGrid.has(key))this.treeGrid.set(key,[]);this.treeGrid.get(key).push(tree);this.speciesOf.set(tree,this.species(tree));}
      this.buildGround();this.buildTrees();this.buildUndergrowth();this.buildLandmarks();this.batches.finish();this.assetsReady=Promise.all(this.promises);
    }
    species(tree) {
      const s=W.random(tree.seed^0x5bd1e995)();
      if(tree.bare)return s<.22?'snag':s<.5?'birch':'spruce';
      return s<.2?'pine':s<.27?'birch':'spruce';
    }
    nearestTree(x,z,radius=3) {
      let best=null,d=radius;
      for(let gx=Math.floor((x-radius)/4);gx<=Math.floor((x+radius)/4);gx++)for(let gz=Math.floor((z-radius)/4);gz<=Math.floor((z+radius)/4);gz++)
        for(const t of this.treeGrid.get(gx+','+gz)||[]){const e=Math.hypot(t.x-x,t.z-z);if(e<d){d=e;best=t;}}
      return best?{tree:best,distance:d}:null;
    }
    // Paths, the ruin, the well and the stone ring stay open at walking height.
    blocked(x,z) {return W.pathDistance(x,z)<1.9||(x>18.5&&x<29.5&&z>-29&&z<-19)||Math.hypot(x+27,z+39)<2.4||Math.hypot(x-46,z-32)<5;}
    // Wider clearings at walking and camera height around the landmarks.
    clearing(x,z) {return this.blocked(x,z)||Math.hypot(x+27,z+36)<5.5||Math.hypot(x-24,z+24)<7.5||Math.hypot(x-46,z-32)<6.5;}
    buildGround() {
      const geo=new T.PlaneGeometry(240,240,170,170);geo.rotateX(-Math.PI/2);const p=geo.attributes.position,colors=[],moss=[],color=new T.Color();
      const litter=new T.Color('#6e6052'),needles=new T.Color('#5c4434'),path=new T.Color('#75685a'),edge=new T.Color('#4e4a3c');
      for(let i=0;i<p.count;i++) {
        const x=p.getX(i),z=p.getZ(i),d=W.pathDistance(x,z);p.setY(i,W.height(x,z)-smooth(.3,1.3,1.4-d)*.035);
        const near=this.nearestTree(x,z,3.5),under=near&&this.speciesOf.get(near.tree)!=='birch'?1-smooth(.8,3.5,near.distance):0;
        const f=field(x,z),worn=1-smooth(.5,1.6,d+noise(x*.9,0,z*.9)*.3);
        color.copy(litter).lerp(edge,smooth(-.2,.6,field(z+11,x))*.6).lerp(needles,under*.85).lerp(path,worn).multiplyScalar(.9+noise(x*.4,0,z*.4)*.08);
        colors.push(color.r,color.g,color.b);
        moss.push(W.clamp(smooth(-.45,.35,f)*(1-under*.75)*smooth(1.1,2.4,d)+smooth(1.6,2.4,d)*.15,0,1));
      }
      geo.setAttribute('color',new T.Float32BufferAttribute(colors,3));geo.setAttribute('aMoss',new T.Float32BufferAttribute(moss,1));geo.computeVertexNormals();
      const map=this.texture('ground-color',true,94),normal=this.texture('ground-normal',false,94),mossMap=this.mossTexture();
      const mat=material('#ffffff',{map,normalMap:normal,normalScale:new T.Vector2(.7,.7),roughness:.96,vertexColors:true});
      mat.onBeforeCompile=shader=>{
        shader.uniforms.mossMap={value:mossMap};
        shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nattribute float aMoss;\nvarying float vMoss;').replace('#include <begin_vertex>','#include <begin_vertex>\nvMoss=aMoss;');
        shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nuniform sampler2D mossMap;\nvarying float vMoss;').replace('#include <color_fragment>',`#include <color_fragment>
          vec3 mossColor=texture2D(mossMap,vMapUv*.83).rgb;
          float mossMask=smoothstep(.15,.85,vMoss+(texture2D(mossMap,vMapUv*.21).g-.18)*1.6);
          diffuseColor.rgb=mix(diffuseColor.rgb,mossColor*vec3(.92,1.0,.85),mossMask);`);
      };mat.customProgramCacheKey=()=>'skog-ground-moss';
      const ground=new T.Mesh(geo,mat);ground.receiveShadow=true;this.scene.add(ground);
      // The shallow water follows the ground rather than floating over a bank.
      const g=new T.CircleGeometry(3,64);g.rotateX(-Math.PI/2);const wp=g.attributes.position;
      for(let i=0;i<wp.count;i++){const x=wp.getX(i),z=wp.getZ(i);wp.setY(i,W.height(x-32,z-35)+.028);}
      g.computeVertexNormals();this.water=new T.Mesh(g,material('#1d2b2a',{metalness:.3,roughness:.08,transparent:true,opacity:.82}));this.water.position.set(-32,0,-35);this.scene.add(this.water);
    }
    buildTrees() {
      const b=this.batches;
      this.cards={
        spruce:branchCard(1,.5,{segments:3,droop:.26,fold:.13,width:.95}),
        pine:branchCard(.25,.5,{segments:2,droop:.04,lift:.12,fold:.07,width:.5,tilt:.1}),
        birch:branchCard(0,.25,{segments:3,droop:.35,fold:.04,width:.42,tilt:.1}),
      };
      for(const tree of this.world.trees) {
        const kind=this.speciesOf.get(tree);
        this[kind](tree,W.random(tree.seed));
      }
      for(let i=0;i<this.world.rocks.length;i++) {
        const r=this.world.rocks[i];b.add(this.geo.rocks[i%3],this.stone,v3(r.x,r.y+r.r*.3,r.z),v3(r.r,r.r*.82,r.r*.9),new T.Euler(.12,r.a,.12));
      }
    }
    roots(tree,rng,count,radius,colour) {
      const {x,z}=tree;
      for(let j=0;j<count;j++) {
        const a=j*TAU/count+rng()*.7,reach=radius*(2.6+rng()*1.6),rx=x+Math.cos(a)*reach,rz=z+Math.sin(a)*reach;
        this.batches.merge(tube([v3(x,tree.y+.5,z),v3(x+Math.cos(a)*reach*.35,W.height(x+Math.cos(a)*reach*.35,z+Math.sin(a)*reach*.35)+.08,z+Math.sin(a)*reach*.35),v3(rx,W.height(rx,rz)-.06,rz)],radius*.5,.02,5,6,.04,colour),this.bark,x,z);
      }
    }
    trunk(tree,rng,H,r0,r1,lean,colour,mat=this.bark,segments=8,sides=8) {
      const {x,z}=tree,bx=(rng()-.5)*lean,bz=(rng()-.5)*lean,points=[];
      for(let i=0;i<=5;i++){const t=i/5;points.push(v3(x+bx*t*t+Math.sin(t*5+tree.seed)*lean*.04,tree.y+H*t-.15,z+bz*t*t));}
      this.batches.merge(tube(points,r0,r1,segments,sides,.05,colour),mat,x,z);
      return t=>{const k=t/H;return v3(x+bx*k*k,tree.y+t-.15,z+bz*k*k);};
    }
    // Low spruce sprays are shortened where they would close a path or landmark.
    reach(tree,at,yaw,len,y) {
      if(y>3.2||!tree.nearOpen)return len;
      for(let l=len;l>.35;l*=.78)if(!this.clearing(at.x+Math.cos(yaw)*l,at.z-Math.sin(yaw)*l))return l;
      return 0;
    }
    card(geo,at,yaw,pitch,roll,len,width,color) {
      this.batches.add(geo,this.needles,at,v3(len,len*.9,len*width),new T.Euler(roll,yaw,pitch,'YZX'),color);
    }
    spruce(tree,rng) {
      const H=tree.h*(1.15+rng()*.3),r=tree.r*1.05;tree.nearOpen=W.pathDistance(tree.x,tree.z)<7||Math.hypot(tree.x-24,tree.z+24)<11||Math.hypot(tree.x+27,tree.z+37)<11||Math.hypot(tree.x-46,tree.z-32)<10;
      const c=.78+rng()*.2,colour=(t)=>[c*.7,c*.62*(1-t*.1),c*.56];
      const at=this.trunk(tree,rng,H,r*1.15,.03,.35,colour,this.bark,7,8);this.roots(tree,rng,3,r,colour);
      const Rmax=H*(.17+rng()*.06),hue=.24+rng()*.06,light=.78+rng()*.2;
      // Some spruces have shed their shaded lower whorls; most keep skirts.
      const bareBase=rng()<.22?1.2+rng()*2.5:.12+rng()*.35;
      if(bareBase>1)for(let y=.6;y<bareBase;y+=.32+rng()*.2){const p=at(y),a=rng()*TAU,l=.3+rng()*.7;this.batches.merge(tube([p,p.clone().add(v3(Math.cos(a)*l,-.08-rng()*.15,Math.sin(a)*l))],.03,.006,1,4,0,()=>[.45,.42,.38]),this.bark,tree.x,tree.z);}
      let whorl=0;
      for(let y=bareBase;y<H-.5;y+=(y<H*.5?.42:.66)+rng()*.16,whorl++) {
        const t=y/H,R=Rmax*Math.pow(1-t,.9)*(.85+rng()*.3)+.25,n=t<.35?5:t<.7?4:3,phase=rng()*TAU,p=at(y);
        for(let k=0;k<n;k++) {
          const yaw=phase+k*TAU/n+(rng()-.5)*.55,len=this.reach(tree,p,yaw,R*(.8+rng()*.35),y);if(len<.3)continue;
          const pitch=t<.6?-.12-rng()*.22+(y<.8?.12:0):-.05+rng()*.3;
          const tint=()=>new T.Color().setHSL(hue,.12+rng()*.1,light*(.82+rng()*.25));
          if(len<2)this.card(this.cards.spruce,p,yaw,pitch,(rng()-.5)*.35,len,t<.4?.95:.85,tint());
          else {
            // Long limbs carry several sprays rather than one giant frond.
            const inner=len*.58,outer=len*.55,o=p.clone().add(v3(Math.cos(yaw)*len*.45,Math.sin(pitch)*len*.45-.06*len,-Math.sin(yaw)*len*.45));
            this.card(this.cards.spruce,p,yaw+(rng()-.5)*.3,pitch+.08,(rng()-.5)*.35,inner,1,tint());
            this.card(this.cards.spruce,o,yaw+(rng()-.5)*.35,pitch-.12,(rng()-.5)*.4,outer,.9,tint());
          }
        }
      }
      // Leader: a short upright spray.
      for(let k=0;k<3;k++)this.card(this.cards.spruce,at(H-.75),k*2.1+rng(),1.2+rng()*.25,0,.9+rng()*.3,.5,new T.Color().setHSL(hue,.15,light));
    }
    pine(tree,rng) {
      const H=tree.h*(1.25+rng()*.25),r=tree.r*.95;
      const colour=(t)=>{const fox=smooth(.45,.7,t);return [.62+fox*.25,.55+fox*.05,.5-fox*.12];};
      const at=this.trunk(tree,rng,H,r*1.1,.05,1.2,colour,this.bark,8,8);this.roots(tree,rng,3,r,colour);
      for(let i=0;i<4;i++){const y=H*(.3+rng()*.3),p=at(y),a=rng()*TAU,l=.4+rng()*.8;this.batches.merge(tube([p,p.clone().add(v3(Math.cos(a)*l,-.05,Math.sin(a)*l))],.04,.008,1,4,0,()=>[.5,.47,.42]),this.bark,tree.x,tree.z);}
      const crown=H*(.6+rng()*.1),Rmax=H*(.13+rng()*.05),hue=.2+rng()*.05;
      for(let y=crown;y<H-.3;y+=.55+rng()*.3) {
        const t=(y-crown)/(H-crown),R=Rmax*Math.sin(Math.PI*Math.min(1,.25+t*.8))+.4,n=3+Math.floor(rng()*2),phase=rng()*TAU,p=at(y);
        for(let k=0;k<n;k++){
          const yaw=phase+k*TAU/n+(rng()-.5)*.8,len=R*(.75+rng()*.4),pitch=.05+rng()*.35;
          // Visible limb out to the tuft.
          const end=p.clone().add(v3(Math.cos(yaw)*len*.55,Math.sin(pitch)*len*.55,-Math.sin(yaw)*len*.55));
          this.batches.merge(tube([p,end],.06+.04*(1-t),.025,1,5,0,()=>[.75,.55,.38]),this.bark,tree.x,tree.z);
          this.card(this.cards.pine,end,yaw,pitch*.6,(rng()-.5)*.6,len*.75+.5,1.2,new T.Color().setHSL(hue,.15,.85+rng()*.15));
          this.card(this.cards.pine,p,yaw+.4,pitch,(rng()-.5)*.6,len*.7,1.1,new T.Color().setHSL(hue,.15,.75+rng()*.15));
        }
      }
      for(let k=0;k<3;k++)this.card(this.cards.pine,at(H-.6),k*2.1,1+rng()*.3,0,1.1,1.2,new T.Color().setHSL(hue,.15,.9));
    }
    birch(tree,rng) {
      const H=tree.h*(.95+rng()*.2),r=Math.max(.14,tree.r*.6);
      const colour=(t)=>{const base=1-smooth(0,.12,t);const k=.72-base*.4;return [k,k*.99,k*.96];};
      const at=this.trunk(tree,rng,H,r*1.1,.04,1.6,colour,this.birchBark,9,8);
      const leafy=!tree.bare,hue=.11+rng()*.03;
      for(let i=0;i<9;i++) {
        const y=H*(.4+i*.058+rng()*.04),p=at(y),a=i*2.4+rng()*.6,l=(1.5+rng()*1.5)*(1-i*.06);
        const elbow=p.clone().add(v3(Math.cos(a)*l*.5,l*.45,-Math.sin(a)*l*.5)),tip=elbow.clone().add(v3(Math.cos(a)*l*.5,l*.35,-Math.sin(a)*l*.5));
        this.batches.merge(tube([p,elbow,tip],r*.28,.01,4,5,0,(t)=>{const k=.46-t*.22;return [k,k*.95,k*.92];}),this.birchBark,tree.x,tree.z);
        // Hanging twig sprays, sparse once most leaves have fallen.
        const sprays=leafy?4:3;
        for(let k=0;k<sprays;k++){const q=p.clone().lerp(tip,.4+k*.2+rng()*.1);this.card(this.cards.birch,q,a+(rng()-.5)*1.6,-.55-rng()*.5,(rng()-.5)*.8,1.3+rng()*.9,1,new T.Color().setHSL(hue,.25,leafy?.85+rng()*.15:.55));}
      }
    }
    snag(tree,rng) {
      const tall=rng()<.5,H=tree.h*(tall?.9+rng()*.3:.25+rng()*.3),r=tree.r*1.05;
      const g=.5+rng()*.1,colour=(t)=>[g*1.02,g,g*.95];
      const at=this.trunk(tree,rng,H,r*1.12,tall?.04:r*.75,.4,colour,this.bark,7,8);this.roots(tree,rng,3,r,colour);
      // Broken top: jagged splinters.
      if(!tall)for(let i=0;i<4;i++){const p=at(H-.05),a=i*1.6+rng(),l=.25+rng()*.5;this.batches.merge(tube([p.clone().add(v3(Math.cos(a)*r*.5,0,Math.sin(a)*r*.5)),p.clone().add(v3(Math.cos(a)*r*.35,l,Math.sin(a)*r*.35))],r*.3,.01,1,4,0,colour),this.bark,tree.x,tree.z);}
      // Dead whorl stubs, drooping, densest low down.
      for(let y=.8;y<H-.5;y+=.35+rng()*.35){const p=at(y),a=rng()*TAU,l=(.35+rng()*1.3)*(1-y/H*.6);
        this.batches.merge(tube([p,p.clone().add(v3(Math.cos(a)*l*.6,-.05,Math.sin(a)*l*.6)),p.clone().add(v3(Math.cos(a)*l,-.12-rng()*.3,Math.sin(a)*l))],.035,.005,2,4,0,()=>[g*.85,g*.83,g*.8]),this.bark,tree.x,tree.z);}
    }
    fernGeometry() {
      const pos=[],nor=[],uv=[],idx=[],rng=W.random(31);const [u0,v0,u1,v1]=this.region.fern;
      for(let f=0;f<6;f++) {
        const a=f*TAU/6+(rng()-.5)*.4,rise=.5+rng()*.25,len=.75+rng()*.3,cs=Math.cos(a),sn=Math.sin(a);
        for(let i=0;i<=4;i++){const t=i/4,x=t*len,y=Math.sin(t*Math.PI*.78)*rise*len-t*t*.08;
          for(let j=0;j<3;j++){const s=j-1,lz=s*.36*len,ly=y-Math.abs(s)*.08*t;pos.push(x*cs-lz*sn,ly,x*sn+lz*cs);nor.push(0,1,0);uv.push(u0+(u1-u0)*t,v0+(v1-v0)*j/2);}}
        const base=f*15;for(let i=0;i<4;i++)for(let j=0;j<2;j++){const k=base+i*3+j;idx.push(k,k+3,k+1,k+1,k+3,k+4);}
      }
      const geo=new T.BufferGeometry();geo.setAttribute('position',new T.Float32BufferAttribute(pos,3));geo.setAttribute('normal',new T.Float32BufferAttribute(nor,3));geo.setAttribute('uv',new T.Float32BufferAttribute(uv,2));geo.setIndex(idx);return geo;
    }
    litterGeometry() {
      const [u0,v0,u1,v1]=this.region.litter,geo=new T.PlaneGeometry(1,1);geo.rotateX(-Math.PI/2);
      const uv=geo.attributes.uv;for(let i=0;i<uv.count;i++)uv.setXY(i,u0+(u1-u0)*uv.getX(i),v0+(v1-v0)*uv.getY(i));return geo;
    }
    deadBranchGeometry() {
      const parts=[tube([v3(-.5,.03,0),v3(0,.06,.04),v3(.5,.03,-.02)],.035,.012,4,5,.05),tube([v3(-.1,.05,.03),v3(.05,.07,.2),v3(.12,.05,.33)],.014,.004,2,4,0),tube([v3(.2,.05,-.01),v3(.3,.06,-.15)],.012,.004,1,4,0)];
      const pos=[],nor=[],uv=[],idx=[];
      for(const g of parts){const o=pos.length/3;pos.push(...g.attributes.position.array);nor.push(...g.attributes.normal.array);uv.push(...g.attributes.uv.array);for(const i of g.index.array)idx.push(o+i);}
      const geo=new T.BufferGeometry();geo.setAttribute('position',new T.Float32BufferAttribute(pos,3));geo.setAttribute('normal',new T.Float32BufferAttribute(nor,3));geo.setAttribute('uv',new T.Float32BufferAttribute(uv,2));geo.setIndex(idx);return geo;
    }
    buildUndergrowth() {
      const b=this.batches,rng=W.random(83),R=this.region,F=FLORA_RANGE;
      const g={
        blueberry:crossCards(R.blueberry,3,.62,.36,{lean:.25}),lingon:crossCards(R.lingon,2,.5,.17),
        grass:crossCards(R.grass,3,.5,.42,{lean:.15}),fern:this.fernGeometry(),litter:this.litterGeometry(),branch:this.deadBranchGeometry(),
      };
      const yaw=()=>new T.Euler(0,rng()*TAU,0),tint=(h,s,l)=>new T.Color().setHSL(h,s,l);
      for(let gx=-84;gx<84;gx+=.72)for(let gz=-84;gz<84;gz+=.72) {
        const x=gx+(rng()-.5)*.7,z=gz+(rng()-.5)*.7;if(x*x+z*z>84*84)continue;
        const pd=W.pathDistance(x,z),y=W.height(x,z);if(pd<1.25){if(rng()<.1)b.add(g.litter,this.flora,v3(x,y+.025,z),v3(.5+rng()*.5,1,.5+rng()*.5),yaw(),tint(.07,.2,.2+rng()*.1),F);continue;}
        if(this.blocked(x,z)&&pd>1.7&&!(Math.hypot(x-46,z-32)<3.2&&rng()<.5))continue;
        const near=this.nearestTree(x,z,3.2),trunk=near?near.distance-near.tree.r:9,kind=near&&this.speciesOf.get(near.tree);
        if(trunk<.15)continue;
        const shade=kind==='spruce'?1-smooth(.4,2.6,trunk):0,berry=field(x,z),fernF=field(z+37,x-11,1.4),r=rng(),p=v3(x,y,z);
        if(pd<1.9) {
          if(r<.55)b.add(g.grass,this.flora,p,v3(.8+rng()*.6,.6+rng()*.7,.8+rng()*.6),yaw(),tint(.13+rng()*.04,.15,.5+rng()*.3),F);
          else if(r<.65)b.add(g.blueberry,this.flora,p,v3(.6+rng()*.4,.5+rng()*.4,.6+rng()*.4),yaw(),tint(.25,.2,.7+rng()*.2),F);
          continue;
        }
        if(shade>.45){if(r<.45)b.add(g.litter,this.flora,v3(x,y+.025,z),v3(1+rng()*.8,1,1+rng()*.8),yaw(),tint(.07,.25,.24+rng()*.1),F);continue;}
        if(fernF>.35&&r<.4){const s=.5+rng()*.45,autumn=rng();b.add(g.fern,this.flora,p,v3(s,s*(.8+rng()*.4),s),yaw(),autumn<.35?tint(.07+rng()*.03,.4,.22+rng()*.08):tint(.21+rng()*.05,.35,.2+rng()*.1),F);continue;}
        if(berry>-.15&&r<.9){
          for(let k=0;k<2;k++){const bx=x+(rng()-.5)*.6,bz=z+(rng()-.5)*.6;b.add(g.blueberry,this.flora,v3(bx,W.height(bx,bz),bz),v3(.75+rng()*.6,.6+rng()*.7,.75+rng()*.6),yaw(),tint(.22+rng()*.08,.22,.6+rng()*.3),F);}
          if(rng()<.15)b.add(g.lingon,this.flora,v3(x+.3,y,z-.2),v3(.8+rng()*.5,.8+rng()*.5,.8+rng()*.5),yaw(),tint(.3,.15,.75+rng()*.2),F);
          continue;
        }
        if(r<.25)b.add(g.lingon,this.flora,p,v3(.8+rng()*.5,.8+rng()*.5,.8+rng()*.5),yaw(),tint(.3,.15,.75+rng()*.2),F);
        else if(r<.4)b.add(g.grass,this.flora,p,v3(.7+rng()*.5,.5+rng()*.6,.7+rng()*.5),yaw(),tint(.13+rng()*.04,.15,.45+rng()*.25),F);
        else if(r<.55)b.add(g.litter,this.flora,v3(x,y+.025,z),v3(.8+rng()*.7,1,.8+rng()*.7),yaw(),tint(.07,.2,.22+rng()*.12),F);
      }
      // Fallen branches and small stones, sparse and scattered.
      for(let i=0;i<2600;i++) {
        const a=rng()*TAU,d=Math.sqrt(rng())*82,x=Math.cos(a)*d,z=Math.sin(a)*d,pd=W.pathDistance(x,z),y=W.height(x,z);
        if(this.blocked(x,z)&&pd>1.7)continue;
        if(i%2){const s=pd<1.3?.35+rng()*.4:.6+rng()*1.2;b.add(g.branch,this.deadwood,v3(x,y-.01,z),v3(s,s*(.8+rng()*.4),s),new T.Euler((rng()-.5)*.08,rng()*TAU,(rng()-.5)*.08),new T.Color().setRGB(.55,.52,.48).multiplyScalar(.8+rng()*.3),F);}
        else{const s=.05+rng()*rng()*.22;b.add(this.geo.pebbles[i%4?0:1],this.pebble,v3(x,y-s*.08,z),v3(s,s*.42,s*.85),new T.Euler(rng(),rng()*TAU,rng()),null,F);}
      }
      const mushroom=material('#c9b48c',{roughness:.8}),mushStem=material('#a49d83');mushroom.userData.shadow=mushStem.userData.shadow=false;
      const cap=new T.SphereGeometry(1,16,10,0,TAU,0,Math.PI*.58),stem=new T.CylinderGeometry(.4,.6,1,8);
      const cutTexture=canvasTexture(256,(c,s)=>{c.fillStyle='#968465';c.fillRect(0,0,s,s);const rng=W.random(65);for(let i=0;i<35;i++){c.strokeStyle=i%3?'#5a4a3550':'#c1ac8555';c.lineWidth=.5+rng()*2;c.beginPath();c.ellipse(s/2,s/2,4+i*3.7,3+i*3.4,.2,0,TAU);c.stroke();}for(let i=0;i<8;i++){const a=rng()*TAU;c.strokeStyle='#302d26';c.beginPath();c.moveTo(128+Math.sin(a)*80,128+Math.cos(a)*80);c.lineTo(128+Math.sin(a)*125,128+Math.cos(a)*125);c.stroke();}});
      const cut=material('#9c8a6c',{map:cutTexture,roughness:.98}),disk=new T.CircleGeometry(1,28);
      // Fallen logs: grey-brown, moss creeping over the top.
      const logColour=(t,up)=>{const m=smooth(.15,.75,up+noise(t*9,up*3,1)*.25);return [.62-m*.32,.56-m*.22,.5-m*.34];};
      for(const [x,z,a] of [[-6,4,1.1],[7,-18,.4],[-17,17,1.9],[35,8,.2],[-21,-31,2.4]]) {
        const y=W.height(x,z),start=v3(x,y+.24,z),end=v3(x+Math.cos(a)*4,y+.34,z+Math.sin(a)*4);
        b.merge(tube([start,start.clone().lerp(end,.5).add(v3(0,.06,0)),end],.38,.31,12,14,.05,logColour),this.bark,x,z);
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
