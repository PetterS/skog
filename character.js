/* Skog's child explorer: an adapted CC0 head on original procedural clothing.
   No network or asset loader; every shape and texture is generated here. */
(function (root) {
  'use strict';
  const T = THREE, TAU = Math.PI * 2, LANTERN_POWER = 7.5;
  const V = (x=0,y=0,z=0) => new T.Vector3(x,y,z);
  const clamp = (x,a,b) => Math.max(a,Math.min(b,x));
  const smooth = (a,b,x) => {const t=clamp((x-a)/(b-a),0,1);return t*t*(3-2*t);};
  const lerp = (a,b,t) => a+(b-a)*t;
  const sq = x => x*x;

  // Rig dimensions in metres, shared by construction and the leg IK. The child
  // is about 1.38 m tall with a head of roughly one sixth of that height.
  const HIP_Y=.60, HIP_X=.07, THIGH=.24, SHIN=.235, ANKLE=.13;
  const SHOULDER_X=.132, SHOULDER_Y=.985, UPPER=.21, FORE=.19;

  // ---------------------------------------------------------------- textures
  function hash(x,y){const h=Math.sin(x*127.1+y*311.7)*43758.5453;return h-Math.floor(h);}
  function noise(x,y,px,py=px){
    const xi=Math.floor(x),yi=Math.floor(y),u=x-xi,v=y-yi,su=u*u*(3-2*u),sv=v*v*(3-2*v);
    const h=(i,j)=>hash(((i%px)+px)%px,((j%py)+py)%py);
    return lerp(lerp(h(xi,yi),h(xi+1,yi),su),lerp(h(xi,yi+1),h(xi+1,yi+1),su),sv);
  }
  function normalTexture(height,size,repeat,strength){
    const canvas=document.createElement('canvas');canvas.width=canvas.height=size;
    const ctx=canvas.getContext('2d'),image=ctx.createImageData(size,size),field=new Float32Array(size*size);
    for(let y=0;y<size;y++)for(let x=0;x<size;x++)field[y*size+x]=height(x,y);
    const at=(x,y)=>field[((y+size)%size)*size+((x+size)%size)];
    for(let y=0;y<size;y++)for(let x=0;x<size;x++){
      const nx=-(at(x+1,y)-at(x-1,y))*strength,ny=-(at(x,y+1)-at(x,y-1))*strength,l=Math.hypot(nx,ny,1),i=(y*size+x)*4;
      image.data[i]=128+127*nx/l;image.data[i+1]=128+127*ny/l;image.data[i+2]=128+127/l;image.data[i+3]=255;
    }
    ctx.putImageData(image,0,0);const tex=new T.CanvasTexture(canvas);tex.wrapS=tex.wrapT=T.RepeatWrapping;tex.repeat.set(...repeat);return tex;
  }
  const textures={
    // Rubberised raincoat cloth: soft creases over a faint woven base.
    coat:()=>normalTexture((x,y)=>{
      const ridge=1-Math.abs(noise(x/9,y/13,14,10)*2-1),fine=noise(x/3,y/3,43,43);
      return ridge*ridge*.7+fine*.25+Math.sin(x*TAU/4)*Math.sin(y*TAU/4)*.06;
    },128,[3,4],1.4),
    knit:()=>normalTexture((x,y)=>{const c=x%8,v=Math.abs(c-3.5)/3.5;return (1-v*v)*.8+Math.sin((y+Math.abs(c-3.5)*1.2)*TAU/6)*.35*(1-v);},64,[10,7],1.3),
    canvas:()=>normalTexture((x,y)=>Math.sin(x*TAU/4)*Math.sin(y*TAU/4)*.3+noise(x/9,y/9,7)*.3,64,[6,6],1.4),
    hair:()=>normalTexture((x,y)=>noise(x/1.6,y/18,40,4)*.9+noise(x/4,y/40,16,2)*.5,64,[3,1],2.4),
    skin:()=>normalTexture((x,y)=>noise(x/2,y/2,32)*.5+noise(x/6,y/6,11)*.5,64,[6,6],.9),
  };

  // ---------------------------------------------------------------- geometry
  function mat(color,extra={}) {return new T.MeshStandardMaterial({color,roughness:.78,...extra});}
  function add(parent,geo,material,x=0,y=0,z=0,scale=null) {
    const mesh=new T.Mesh(geo,material);mesh.position.set(x,y,z);if(scale)mesh.scale.set(...scale);
    mesh.castShadow=false;mesh.receiveShadow=true;parent.add(mesh);return mesh;
  }
  // Smooth normals across UV seams by averaging every vertex at one position.
  function smoothNormals(geo){
    geo.computeVertexNormals();
    const p=geo.attributes.position,n=geo.attributes.normal,groups=new Map();
    for(let i=0;i<p.count;i++){const k=Math.round(p.getX(i)*1e4)+','+Math.round(p.getY(i)*1e4)+','+Math.round(p.getZ(i)*1e4);let g=groups.get(k);if(!g)groups.set(k,g=[]);g.push(i);}
    const s=V();
    for(const g of groups.values()){if(g.length<2)continue;s.set(0,0,0);for(const i of g)s.x+=n.getX(i),s.y+=n.getY(i),s.z+=n.getZ(i);s.normalize();for(const i of g)n.setXYZ(i,s.x,s.y,s.z);}
    return geo;
  }
  function makeGeometry(pos,uv,index,colors){
    const geo=new T.BufferGeometry();geo.setAttribute('position',new T.Float32BufferAttribute(pos,3));
    if(uv)geo.setAttribute('uv',new T.Float32BufferAttribute(uv,2));
    if(colors)geo.setAttribute('color',new T.Float32BufferAttribute(colors,3));
    geo.setIndex(index);return smoothNormals(geo);
  }
  // Loft superelliptic cross-sections. Each section has a centre c, in-plane
  // axes u/v and radii (ru, ru2 on the negative u side; rv, rv2 likewise).
  // Winding is chosen automatically so normals always face outward.
  function loft(sections,sides,{n=2,disp=null,color=null,uScale=1}={}){
    const pos=[],uv=[],colors=color?[]:null,index=[],last=sections.length-1;
    sections.forEach((s,j)=>{
      const c=s.c,u=s.u||[1,0,0],v=s.v||[0,0,1],e=2/(s.n||n);
      for(let i=0;i<=sides;i++){
        const a=i/sides*TAU,su=Math.sin(a),cv=Math.cos(a),k=disp?disp(a,j,s):1;
        const pu=Math.sign(su)*Math.abs(su)**e*(su>0?s.ru:(s.ru2??s.ru))*k,pv=Math.sign(cv)*Math.abs(cv)**e*(cv>0?s.rv:(s.rv2??s.rv))*k;
        const x=c[0]+u[0]*pu+v[0]*pv,y=c[1]+u[1]*pu+v[1]*pv,z=c[2]+u[2]*pu+v[2]*pv;
        pos.push(x,y,z);uv.push(i/sides*uScale,s.t??j/last);
        if(colors){const col=color(x,y,z,a,j);colors.push(col,col,col);}
        if(j&&i){const b=j*(sides+1)+i;index.push(b,b-1,b-sides-1,b-1,b-sides-2,b-sides-1);}
      }
    });
    let geo=makeGeometry(pos,uv,index,colors);
    // Orientation test on a mid-length section.
    const j=Math.floor(sections.length/2),c=sections[j].c,i=j*(sides+1)+Math.floor(sides/8),p=geo.attributes.position,nn=geo.attributes.normal;
    if((p.getX(i)-c[0])*nn.getX(i)+(p.getY(i)-c[1])*nn.getY(i)+(p.getZ(i)-c[2])*nn.getZ(i)<0){
      for(let k=0;k<index.length;k+=3){const t=index[k];index[k]=index[k+1];index[k+1]=t;}
      geo.dispose();geo=makeGeometry(pos,uv,index,colors);
    }
    return geo;
  }
  // Catmull-Rom resampling of a numeric profile table.
  function resample(table,count){
    const out=[];
    for(let k=0;k<count;k++){
      const f=k/(count-1)*(table.length-1),i=Math.min(Math.floor(f),table.length-2),t=f-i;
      const p0=table[Math.max(0,i-1)],p1=table[i],p2=table[i+1],p3=table[Math.min(table.length-1,i+2)];
      out.push(p1.map((_,m)=>{const a=p0[m],b=p1[m],c=p2[m],d=p3[m];return .5*((2*b)+(-a+c)*t+(2*a-5*b+4*c-d)*t*t+(-a+3*b-3*c+d)*t*t*t);}));
    }
    return out;
  }
  // A vertical tube from a [y, rx, rzFront, rzBack, zc] table.
  function verticalShell(table,count,sides,opts={}){
    return loft(resample(table.map(r=>[...r,0,0,0].slice(0,5).map((v,k)=>k===3&&r[3]===undefined?r[2]:v)),count).map(([y,rx,rf,rb,zc=0,xc=0])=>({c:[xc,y,zc],ru:rx,rv:rf,rv2:rb??rf})),sides,opts);
  }
  // A flat strap or ribbon along points, its broad face pointing away from 'centre'.
  function strap(points,width,thick,segments,centre=p=>V(0,p.y,0)){
    const curve=new T.CatmullRomCurve3(points.map(p=>V(...p))),sections=[];
    for(let i=0;i<=segments;i++){
      const t=i/segments,p=curve.getPointAt(t),tan=curve.getTangentAt(t),out=p.clone().sub(centre(p)).normalize();
      const side=V().crossVectors(tan,out).normalize(),normal=V().crossVectors(side,tan).normalize();
      sections.push({c:p.toArray(),u:side.toArray(),v:normal.toArray(),ru:width/2,rv:thick/2,n:4});
    }
    return loft(sections,8);
  }
  function tube(points,radius,segments=16,sides=6){return new T.TubeGeometry(new T.CatmullRomCurve3(points.map(p=>V(...p))),segments,radius,sides,false);}
  function roundedBox(w,h,d,r=.025,segments=4) {
    r=Math.min(r,w/2,h/2,d/2);
    const geo=new T.BoxGeometry(w,h,d,segments,segments,segments),p=geo.attributes.position,normals=geo.attributes.normal,q=V(),n=V();
    for(let i=0;i<p.count;i++){
      q.set(clamp(p.getX(i),-w/2+r,w/2-r),clamp(p.getY(i),-h/2+r,h/2-r),clamp(p.getZ(i),-d/2+r,d/2-r));
      n.set(p.getX(i)-q.x,p.getY(i)-q.y,p.getZ(i)-q.z).normalize();q.addScaledVector(n,r);p.setXYZ(i,q.x,q.y,q.z);normals.setXYZ(i,n.x,n.y,n.z);
    }
    return geo;
  }
  function skinnedLimb(parent,material,geo,jointY,blend=.075) {
    const pos=geo.attributes.position,indices=[],weights=[];
    for(let i=0;i<pos.count;i++){const w=smooth(jointY+blend,jointY-blend,pos.getY(i));indices.push(0,1,0,0);weights.push(1-w,w,0,0);}
    geo.setAttribute('skinIndex',new T.Uint16BufferAttribute(indices,4));geo.setAttribute('skinWeight',new T.Float32BufferAttribute(weights,4));
    const mesh=new T.SkinnedMesh(geo,material),base=new T.Bone(),joint=new T.Bone();joint.position.y=jointY;base.add(joint);mesh.add(base);parent.add(mesh);parent.updateWorldMatrix(true,true);
    mesh.bind(new T.Skeleton([base,joint]));mesh.castShadow=false;mesh.receiveShadow=true;return {mesh,joint};
  }
  // Collapse decorations into one draw call per material and animated joint.
  function consolidate(group) {
    for(const child of [...group.children])if(child.isGroup)consolidate(child);
    const sets=new Map();
    for(const child of [...group.children])if(child.isMesh&&!child.isSkinnedMesh&&!child.userData.dynamic&&!Array.isArray(child.material)&&!child.material.transparent){
      child.updateMatrix();const g=(child.geometry.index?child.geometry.toNonIndexed():child.geometry.clone()).applyMatrix4(child.matrix);
      const key=child.material.uuid;if(!sets.has(key))sets.set(key,{material:child.material,parts:[]});sets.get(key).parts.push(g);group.remove(child);
    }
    for(const {material,parts} of sets.values()){
      const count=parts.reduce((n,g)=>n+g.attributes.position.count,0),geo=new T.BufferGeometry();
      for(const name of ['position','normal','uv','color']){
        if(name==='color'&&!material.vertexColors)continue;
        const size=name==='uv'?2:3,data=new Float32Array(count*size);let offset=0;
        for(const g of parts){const attr=g.getAttribute(name);if(attr)data.set(attr.array,offset);else if(name==='color')data.fill(1,offset,offset+g.attributes.position.count*size);offset+=g.attributes.position.count*size;}
        geo.setAttribute(name,new T.BufferAttribute(data,size));
      }
      add(group,geo,material);parts.forEach(g=>g.dispose());
    }
  }
  // Cheap smooth 3D variation for weathering in vertex colours.
  const mottle=(x,y,z)=>Math.sin(x*23.1+y*7.3)*Math.sin(y*19.7+z*11.3)*Math.sin(z*17.9+x*13.1);

  // ------------------------------------------------------------- head shape
  // Reshape the adult CC0 head into a nine-year-old's: rounder cranium, lower
  // and smaller face, larger eyes, small upturned nose, softer jaw and cheeks.
  const EYES=[V(.034,.018,.085),V(-.034,.018,.085)];
  function childHead(p,isEye){
    let {x,y,z}=p;
    for(const c of EYES){
      const d=Math.hypot(x-c.x,y-c.y,z-c.z),w=isEye?(Math.sign(x)===Math.sign(c.x)?1:0):smooth(.036,.012,d);
      if(w){const k=1+.2*w;x=c.x+(x-c.x)*k;y=c.y+(y-c.y)*k;z=c.z+(z-c.z)*(1+.08*w);}
    }
    if(!isEye){
      const nose=Math.exp(-sq(x/.024)-((y+.022)/.032)**2)*smooth(.088,.118,z);
      z-=nose*(z-.088)*.55;x*=1-.25*nose;y+=nose*.007;
      const bridge=Math.exp(-sq(x/.022)-((y-.016)/.024)**2)*smooth(.088,.108,z);z-=bridge*.006;
      const brow=Math.exp(-sq((y-.052)/.02))*smooth(.07,.1,z);z-=brow*.006;
      const mouth=Math.exp(-sq(x/.03)-((y+.058)/.016)**2)*smooth(.07,.1,z);x*=1-.2*mouth;
      for(const s of [-1,1]){
        const cheek=Math.exp(-(((x-s*.054)/.032)**2+((y+.032)/.034)**2+((z-.075)/.04)**2)),r=Math.hypot(x,z)||1;
        x+=x/r*.012*cheek;z+=z/r*.01*cheek;
      }
      const jaw=smooth(-.035,-.11,y);x*=1-.16*jaw*smooth(-.06,.02,z);
      z-=.011*smooth(-.07,-.115,y)*smooth(.02,.08,z);
      x*=1-.3*smooth(-.09,-.135,y);if(z<0)z*=1-.25*smooth(-.09,-.135,y);
    }
    y*=1-.15*smooth(.015,-.04,y);
    const top=smooth(0,.12,y);x*=1+.045*top;if(z<0)z*=1+.07*top;y+=.01*top;
    p.set(x*.97,y*.97,z*.97);return p;
  }
  // Ray-casting gives fitted hair, hat and fringe shells around the new skull.
  function headCaster(geo){
    const p=geo.attributes.position,idx=geo.index.array,tris=[];
    for(let i=0;i<idx.length;i+=3)tris.push([V().fromBufferAttribute(p,idx[i]),V().fromBufferAttribute(p,idx[i+1]),V().fromBufferAttribute(p,idx[i+2])]);
    const centre=V(0,.02,-.004),e1=V(),e2=V(),h=V(),s=V(),q=V();
    return {centre,dir:(az,el)=>V(Math.sin(az)*Math.cos(el),Math.sin(el),Math.cos(az)*Math.cos(el)),
      radius(d){
        let best=0;
        for(const [a,b,c] of tris){
          e1.subVectors(b,a);e2.subVectors(c,a);h.crossVectors(d,e2);const det=e1.dot(h);if(Math.abs(det)<1e-9)continue;
          const f=1/det;s.subVectors(centre,a);const u=f*s.dot(h);if(u<0||u>1)continue;q.crossVectors(s,e1);const v=f*d.dot(q);if(v<0||u+v>1)continue;
          const t=f*e2.dot(q);if(t>best)best=t;
        }
        return best||.09;
      }};
  }
  // A grid over the skull in azimuth/elevation, offset outward from it.
  function skullShell(caster,cols,rows,azRange,elOf,offsetOf,azOf=null){
    const pos=[],uv=[],index=[];const cache=new Map();
    for(let j=0;j<=rows;j++)for(let i=0;i<=cols;i++){
      const u=i/cols,v=j/rows,az=azOf?azOf(u,v):lerp(azRange[0],azRange[1],u),el=elOf(az,v,u),d=caster.dir(az,el);
      const key=az.toFixed(4)+','+el.toFixed(4);let r=cache.get(key);if(r===undefined){r=caster.radius(d);cache.set(key,r);}
      const p=caster.centre.clone().addScaledVector(d,r+offsetOf(az,v,u));pos.push(p.x,p.y,p.z);uv.push(u,v);
      if(i&&j){const b=j*(cols+1)+i;index.push(b,b-1,b-cols-1,b-1,b-cols-2,b-cols-1);}
    }
    let geo=makeGeometry(pos,uv,index);
    const nn=geo.attributes.normal,k=Math.floor(rows/2)*(cols+1)+Math.floor(cols/2);
    if((pos[k*3]-caster.centre.x)*nn.getX(k)+(pos[k*3+1]-caster.centre.y)*nn.getY(k)+(pos[k*3+2]-caster.centre.z)*nn.getZ(k)<0){
      for(let m=0;m<index.length;m+=3){const t=index[m];index[m]=index[m+1];index[m+1]=t;}geo.dispose();geo=makeGeometry(pos,uv,index);
    }
    return geo;
  }

  // ----------------------------------------------------------------- coat
  // [y, rx, rzFront, rzBack, zCentre]: flared hem, soft tummy, sloped shoulders.
  const COAT=[[.462,.198,.182,.17,.004],[.50,.186,.17,.158,.004],[.58,.165,.149,.14,.004],[.68,.146,.134,.128,.006],[.78,.142,.132,.124,.01],
    [.87,.148,.128,.122,.006],[.94,.15,.12,.122,0],[.985,.144,.108,.114,-.006],[1.02,.125,.092,.1,-.01],[1.048,.095,.074,.084,-.012],[1.068,.068,.062,.07,-.012],[1.08,.058,.056,.06,-.01]];
  const coatRows=resample(COAT,48);
  function coatAt(y){
    if(y<=coatRows[0][0])return coatRows[0];if(y>=coatRows.at(-1)[0])return coatRows.at(-1);
    let i=0;while(coatRows[i+1][0]<y)i++;const a=coatRows[i],b=coatRows[i+1],t=(y-a[0])/(b[0]-a[0]);return a.map((v,k)=>lerp(v,b[k],t));
  }
  const coatFold=(a,y)=>1+.03*smooth(.76,.47,y)*(Math.sin(a*6+1.3)*.6+Math.sin(a*11+.4+y*9)*.4)+.006*Math.sin(a*9+y*31)*smooth(1.0,.8,y);
  const COAT_N=2.3;
  function coatPoint(a,y,off=0){
    const [,rx,rf,rb,zc]=coatAt(y),su=Math.sin(a),cv=Math.cos(a),e=2/COAT_N,k=coatFold(a,y);
    const p=V(Math.sign(su)*Math.abs(su)**e*rx*k,y,zc+Math.sign(cv)*Math.abs(cv)**e*(cv>0?rf:rb)*k);
    if(off){const da=.002,dy=.002;const pa=coatPoint(a+da,y),pb=coatPoint(a-da,y),py=coatPoint(a,y+dy),pz=coatPoint(a,y-dy);const n=V().crossVectors(pa.sub(pb),py.sub(pz)).normalize();if(n.x*p.x+n.z*(p.z-zc)<0)n.negate();p.addScaledVector(n,off);}
    return p;
  }
  // A patch lying on the coat surface between angles and heights.
  function coatPatch(a0,a1,y0,y1,off,cols=10,rows=8,edge=.25){
    const pos=[],uv=[],index=[];
    for(let j=0;j<=rows;j++)for(let i=0;i<=cols;i++){
      const u=i/cols,v=j/rows,ramp=Math.min(1,Math.min(u,1-u,v,1-v)/edge*.5+.5);
      const p=coatPoint(lerp(a0,a1,u),lerp(y0,y1,v),off*ramp);pos.push(p.x,p.y,p.z);uv.push(u,v);
      if(i&&j){const b=j*(cols+1)+i;index.push(b,b-1,b-cols-1,b-1,b-cols-2,b-cols-1);}
    }
    let geo=makeGeometry(pos,uv,index);const nn=geo.attributes.normal,k=Math.floor(rows/2)*(cols+1)+Math.floor(cols/2);
    if(nn.getX(k)*pos[k*3]+nn.getZ(k)*pos[k*3+2]<0){for(let m=0;m<index.length;m+=3){const t=index[m];index[m]=index[m+1];index[m+1]=t;}geo.dispose();geo=makeGeometry(pos,uv,index);}
    return geo;
  }

  class SkogCharacter {
    constructor({scene,glowTexture}) {
      this.scene=scene;this.group=new T.Group();this.group.name='Barnet';scene.add(this.group);
      this.body=new T.Group();this.group.add(this.body);
      const tex=this.textures=Object.fromEntries(Object.entries(textures).map(([k,f])=>[k,f()]));
      const N=(t,s)=>({normalMap:tex[t],normalScale:new T.Vector2(s,s)});
      this.materials={
        coat:mat('#a8792e',{roughness:.5,vertexColors:true,side:T.DoubleSide,...N('coat',.14)}),
        sleeve:mat('#a8792e',{roughness:.5,...N('coat',.14)}),
        coatTrim:mat('#946a29',{roughness:.56,...N('coat',.4)}),
        lining:mat('#3a3a33',{roughness:.9}),
        reflector:mat('#8e918b',{roughness:.32,metalness:.15}),
        skin:new T.MeshPhysicalMaterial({color:'#cf9f87',roughness:.6,vertexColors:true,sheen:.2,sheenRoughness:.6,sheenColor:new T.Color('#ff9c86')}),
        hair:mat('#4a3424',{roughness:.62,...N('hair',.55)}),
        brows:mat('#6a5240',{roughness:.85}),
        wool:mat('#7a3833',{roughness:.97,...N('knit',.75)}),
        woolCuff:mat('#6c312d',{roughness:.97,...N('knit',.8)}),
        pants:mat('#1b1f22',{roughness:.9,...N('canvas',.35)}),
        rubber:mat('#1e2a24',{roughness:.45}),sole:mat('#1b1916',{roughness:.88}),
        bag:mat('#4c5444',{roughness:.9,...N('canvas',.45)}),bagDark:mat('#3a4035',{roughness:.88,...N('canvas',.45)}),
        leather:mat('#5c3f2a',{roughness:.62}),webbing:mat('#2e302b',{roughness:.9,...N('canvas',.3)}),
        metal:mat('#76664a',{metalness:.8,roughness:.32}),iron:mat('#343b36',{metalness:.75,roughness:.36}),
      };
      this.buildTorso();this.buildHead();this.buildPack();this.buildLegs();this.buildArms();this.buildLantern(glowTexture);
      consolidate(this.body);
      // A flatter falloff keeps the reach without searing the child up close.
      this.lanternLight=new T.PointLight('#ffcc8c',LANTERN_POWER,26,.8);scene.add(this.lanternLight);
      this.lanternLight.castShadow=true;
      const shadow=this.lanternLight.shadow;
      shadow.mapSize.set(512,512);shadow.camera.near=.03;shadow.camera.far=26;
      shadow.bias=-.00002;shadow.normalBias=.0015;shadow.radius=1.5;
      // The moon's forest shadow is cached. Character occlusion belongs to the
      // moving lantern's distance map, not to that static directional map.
      const noMoonShadow=new T.ShaderMaterial({
        vertexShader:'void main(){gl_Position=vec4(2.0,2.0,2.0,1.0);}',
        fragmentShader:'void main(){gl_FragColor=vec4(1.0);}',toneMapped:false,
      });
      this.group.traverse(o=>{
        if(!o.isMesh||o.material.transparent)return;
        o.castShadow=true;o.material.shadowSide=T.DoubleSide;o.customDepthMaterial=noMoonShadow;
      });
      // Tiny cage bars around the emitter would create unstable shadow stripes.
      // The child, backpack and surrounding forest still occlude its light.
      this.lantern.traverse(o=>{o.castShadow=false;});
      // The closed head surface self-shadows cleanly from its back faces only.
      this.materials.skin.shadowSide=T.BackSide;
      this.lanternOn=true;this.lanternLevel=1;this.lightPosition=V();this.footA=V();this.footB=V();this.footRotation=new T.Quaternion();this.motion=0;this.runBlend=0;this.pose=new Float32Array(15);this.idlePose=new Float32Array(15);this.walkPose=new Float32Array(15);this.runPose=new Float32Array(15);this.turn=0;this.lastHeading=0;this.visible=true;
      this.group.updateMatrixWorld(true);
    }
    buildTorso(){
      const m=this.materials,b=this.body;
      // Weathering: darker damp hem, soft occlusion under the arms and collar.
      const grime=(x,y,z)=>{
        let c=1-.2*smooth(.56,.465,y)-.05*mottle(x*1.3,y*1.1,z*1.3);
        c*=1-.18*smooth(.12,.15,Math.abs(x))*smooth(.8,.92,y)*smooth(1.0,.95,y);
        c*=1-.2*smooth(1.04,1.08,y);
        return c;
      };
      add(b,loft(coatRows.map(([y,rx,rf,rb,zc])=>({c:[0,y,zc],ru:rx,rv:rf,rv2:rb,y})),48,{n:COAT_N,disp:(a,j,s)=>coatFold(a,s.y),color:grime}),m.coat);
      // Inner lining shows only in the flared hem.
      add(b,verticalShell([[.47,.19,.172,.162,.004],[.52,.18,.162,.152,.004],[.56,.17,.154,.144,.004]],4,40),m.lining);
      // Front placket with press studs, patch pockets, hem reflector band.
      add(b,coatPatch(-.075,.075,.47,1.06,.0045,4,40,.3),m.coatTrim);
      for(let y=.56;y<1.04;y+=.095){const p=coatPoint(0,y,.009);add(b,new T.CylinderGeometry(.0065,.0065,.004,12),m.metal,p.x,p.y,p.z).rotation.x=Math.PI/2;}
      for(const s of [-1,1]){
        add(b,coatPatch(s*.42,s*1.02,.55,.665,.004,10,8),m.coat);
        add(b,coatPatch(s*.4,s*1.04,.655,.69,.0085,10,4,.35),m.coatTrim);
        const stud=coatPoint(s*.71,.67,.012);add(b,new T.SphereGeometry(.005,8,6),m.metal,stud.x,stud.y,stud.z);
      }
      add(b,coatPatch(-Math.PI,Math.PI,.49,.515,.003,64,2,.2),m.reflector);
      // Stand collar around the neck, drawcord with toggles.
      add(b,verticalShell([[1.06,.074,.068,.076,-.012],[1.09,.072,.066,.074,-.012],[1.12,.077,.072,.08,-.016],[1.128,.079,.074,.083,-.017]],6,32,{n:2.2}),m.coatTrim);
      for(const s of [-1,1]){
        add(b,tube([[s*.03,1.115,.06],[s*.04,1.07,.075],[s*.045,1.02,.09]],.0025,10,5),m.webbing);
        add(b,new T.CylinderGeometry(.006,.007,.016,8),m.webbing,s*.045,1.012,.092);
      }
      // Folded hood rests on the collar and upper back.
      const hood=[];for(let i=0;i<=16;i++){const t=i/16,az=lerp(-1.75,1.75,t),r=.092+.012*Math.cos(az*.5);hood.push({c:[Math.sin(az)*r*1.08,1.078+.022*Math.cos(az*.5)**2,-Math.cos(az)*r-.004],u:[0,1,0],v:[Math.sin(az),0,-Math.cos(az)],ru:.008+.03*Math.cos(az*.55)**3,rv:.006+.018*Math.cos(az*.55)**3,n:2.4});}
      add(b,loft(hood,14),m.coat);
      add(b,verticalShell([[.95,.0,.0,.0,-.118],[.97,.07,.012,.014,-.122],[1.01,.095,.02,.02,-.122],[1.05,.088,.02,.018,-.115],[1.075,.065,.014,.014,-.108]],10,24),m.coat);
      // Shoulder seams.
      for(const s of [-1,1])add(b,tube([[s*.06,1.075,0],[s*.1,1.045,-.005],[s*.13,1.01,-.006]],.0025,10,5),m.coatTrim);
    }
    buildHead(){
      const m=this.materials;this.neck=new T.Group();this.neck.position.set(0,1.075,-.008);this.body.add(this.neck);
      this.head=new T.Group();this.head.position.set(0,.14,.014);this.neck.add(this.head);const h=this.head;
      const eyeMap=new T.TextureLoader().load(SkogCharacterAssets.eyes);eyeMap.colorSpace=T.SRGBColorSpace;eyeMap.flipY=false;this.eyeMap=eyeMap;
      const eyeMaterial=mat('#ffffff',{map:eyeMap,roughness:.18});
      const geos=SkogCharacterAssets.meshes.map((data,i)=>{
        const pos=data.position.slice(),q=V();
        for(let j=0;j<pos.length;j+=3){childHead(q.set(pos[j],pos[j+1],pos[j+2]),i===1);pos[j]=q.x;pos[j+1]=q.y;pos[j+2]=q.z;}
        if(i===0)for(let j=0;j<pos.length;j+=3){const base=.044+.012*smooth(.015,.07,Math.abs(pos[j]));pos[j+1]=base+(pos[j+1]-base)*.55+.004;pos[j+2]+=.002;}
        let colors=null;
        if(i===2){colors=[];const c=new T.Color(),warm=new T.Color('#e48c78'),lip=new T.Color('#b9675d'),shade=new T.Color('#a07a6c');
          for(let j=0;j<pos.length;j+=3){
            const x=pos[j],y=pos[j+1],z=pos[j+2];c.setRGB(1,1,1);
            const cheek=Math.exp(-((Math.abs(x)-.055)**2+(y+.03)**2)/.0009)*smooth(.03,.08,z);
            const noseTip=Math.exp(-(x*x+(y+.02)**2)/.0003)*smooth(.09,.11,z);
            const ear=smooth(.07,.085,Math.abs(x))*smooth(.03,-.01,z)*smooth(-.05,-.02,y)*smooth(.06,.03,y);
            const lips=Math.exp(-sq(x/.022)-((y+.056)/.009)**2)*smooth(.08,.098,z);
            const socket=Math.min(1,EYES.reduce((s,e)=>s+Math.exp(-((x-e.x)**2+((y-e.y)*1.3)**2)/.0005),0))*smooth(.06,.09,z);
            const underChin=smooth(-.07,-.11,y)*smooth(.07,.0,z);
            c.lerp(warm,cheek*.2+noseTip*.12+ear*.18).lerp(lip,lips*.35).lerp(shade,socket*.1+underChin*.12);
            colors.push(c.r,c.g,c.b);
          }}
        return makeGeometry(pos,data.uv,data.index,colors);
      });
      add(h,geos[0],m.brows);add(h,geos[1],eyeMaterial);add(h,geos[2],m.skin);
      const cast=headCaster(geos[2]);
      // Hair: fitted shell, nape and side tufts beneath the beanie, and a fringe.
      const hairline=az=>{const back=Math.sin(az/2)**2,ear=Math.exp(-sq((Math.abs(az)-1.5)/.32));return lerp(.5,-.9,back)+ear*.45;};
      const tuft=(az)=>.07*Math.max(0,Math.sin(az*13+.6))**.7+.03*Math.sin(az*29);
      add(h,skullShell(cast,48,10,[-Math.PI,Math.PI],(az,v)=>lerp(Math.PI/2-.05,hairline(az)-tuft(az)*smooth(.3,.8,Math.sin(az/2)**2),v),(az,v)=>.007*(1-v*v)+.0015),m.hair);
      const fringe=[[-.42,.05],[-.3,.075],[-.18,.06],[-.06,.085],[.06,.07],[.18,.08],[.3,.06],[.42,.05],[-.5,.03],[.5,.035]];
      // Tapered, slightly swept locks rather than flat cut strips.
      fringe.forEach(([az,len],k)=>{
        const sweep=.06+.03*Math.sin(k*2.3),w=.09+.02*Math.cos(k*1.7);
        add(h,skullShell(cast,4,8,[0,1],(a,v)=>lerp(.66,.62-len*4.4,v),(a,v,u)=>(.0035+.0045*(1-v))*(1-sq(2*u-1)*.7),(u,v)=>az+sweep*v*v+(u-.5)*w*2*(1-v*.85)),m.hair);
      });
      // Knit beanie fitted to the skull, with a folded cuff and a pompom.
      const capLine=az=>lerp(.52,-.12,Math.sin(az/2)**2);
      add(h,skullShell(cast,48,14,[-Math.PI,Math.PI],(az,v)=>lerp(Math.PI/2,capLine(az)+.08,v),(az,v)=>.014+.012*(1-v)*smooth(-.3,1,-Math.cos(az))),m.wool);
      add(h,skullShell(cast,48,6,[-Math.PI,Math.PI],(az,v)=>lerp(capLine(az)+.2,capLine(az)-.005,v),(az,v)=>.021+.006*Math.sin(v*Math.PI)**.5),m.woolCuff);
      const top=cast.centre.clone().addScaledVector(cast.dir(Math.PI,1.32),cast.radius(cast.dir(Math.PI,1.32))+.045);
      const pom=new T.IcosahedronGeometry(.036,3),pp=pom.attributes.position;
      for(let i=0;i<pp.count;i++){const q=V().fromBufferAttribute(pp,i),k=1+.12*mottle(q.x*9,q.y*9,q.z*9)+.05*Math.sin(q.x*170)*Math.sin(q.y*190);pp.setXYZ(i,q.x*k,q.y*k,q.z*k);}
      add(h,smoothNormals(pom),m.wool,top.x,top.y,top.z);
      this.headCaster=cast;
    }
    buildPack(){
      const m=this.materials;this.pack=new T.Group();this.pack.position.set(0,.81,-.178);this.pack.rotation.x=.05;this.body.add(this.pack);const p=this.pack;
      const body=roundedBox(.235,.265,.1,.045,6),bp=body.attributes.position;
      for(let i=0;i<bp.count;i++){const x=bp.getX(i),y=bp.getY(i),z=bp.getZ(i);if(z<0)bp.setZ(i,z-.016*(1-sq(x/.12))*(1-sq(y/.135)));bp.setX(i,x*(1+.05*(y<0?-y/.13:0)));}
      add(p,smoothNormals(body),m.bag,0,0,0);
      // Lid drapes over the top; front pocket; compression straps and buckles.
      const lid=roundedBox(.225,.06,.118,.03,5),lp=lid.attributes.position;for(let i=0;i<lp.count;i++){const z=lp.getZ(i);if(z<0)lp.setY(i,lp.getY(i)-(-z)*.6);}
      add(p,smoothNormals(lid),m.bagDark,0,.118,-.008);
      add(p,roundedBox(.17,.11,.036,.016,4),m.bagDark,0,-.065,-.062);
      for(const s of [-1,1]){
        add(p,roundedBox(.022,.15,.008,.003),m.webbing,s*.06,.03,-.064);
        add(p,roundedBox(.03,.026,.01,.004),m.metal,s*.06,-.04,-.07);
        add(p,roundedBox(.024,.06,.08,.012,3),m.bagDark,s*.122,-.055,0);
      }
      add(p,tube([[-.035,.13,.04],[-.03,.165,.04],[0,.172,.04],[.03,.165,.04],[.035,.13,.04]],.008,16,6),m.webbing);
      // Shoulder straps hug the coat: over the shoulder, down the chest, under the arm.
      for(const s of [-1,1]){
        const x=s*.092,front=[.74,.82,.9,.97,1.015].map(y=>coatPoint(s*Math.asin(clamp(Math.abs(x)/coatAt(y)[1],0,1))**1,y,.006));
        const back=[1.02,.985,.94].map(y=>coatPoint(s*(Math.PI-Math.asin(clamp(Math.abs(x)/coatAt(y)[1],0,1))),y,.006));
        const pts=[...front.map(v=>v.toArray()),[x,1.052,-.012],...back.map(v=>v.toArray())].reverse();
        const g=strap(pts,.034,.007,28);g.translate(0,0,0);add(this.body,g,m.webbing);
        const low=[coatPoint(s*.6,.745,.006),coatPoint(s*1.2,.71,.008),coatPoint(s*1.9,.70,.008),V(s*.1,.70,-.17)];
        add(this.body,strap(low.map(v=>v.toArray()),.022,.006,14),m.webbing);
      }
    }
    buildLegs(){
      const m=this.materials;this.legs=[];
      for(const s of [-1,1]){
        const hip=new T.Group();hip.position.set(s*HIP_X,HIP_Y,0);this.body.add(hip);
        const trouser=verticalShell([[-.37,.044,.046,.046],[-.335,.05,.05,.05],[-.3,.053,.052,.051],[-.26,.055,.056,.052],[-.2,.058,.058,.055],[-.12,.063,.062,.06],[-.04,.068,.066,.066],[.035,.072,.07,.07]],18,24,{disp:(a,j)=>1+.03*Math.sin(a*5+j*1.7)*smooth(4,0,Math.abs(j-3))+.01*Math.sin(a*7+j)});
        const skin=skinnedLimb(hip,m.pants,trouser,-THIGH);
        const knee=new T.Group();knee.position.y=-THIGH;hip.add(knee);
        // Rubber boot shaft rides with the shin; the foot with the ankle.
        const shaft=verticalShell([[-SHIN-.02,.043,.05,.048,.004],[-SHIN+.03,.044,.047,.047,.002],[-.15,.048,.05,.05],[-.105,.054,.056,.056],[-.084,.058,.06,.06]],10,24);
        add(knee,shaft,m.rubber);
        add(knee,verticalShell([[-.09,.057,.059,.059],[-.083,.061,.063,.063],[-.077,.058,.06,.06],[-.08,.053,.055,.055]],4,24),m.rubber);
        add(knee,roundedBox(.016,.026,.006,.003),m.rubber,0,-.088,-.062);
        const foot=new T.Group();foot.position.y=-SHIN;knee.add(foot);
        const bootTable=[[-.064,.022,-.112,-.04],[-.056,.035,-.122,.0],[-.03,.041,-.1225,.012],[0,.042,-.1225,.006],[.03,.043,-.1225,-.022],[.06,.044,-.1225,-.046],[.09,.043,-.1225,-.06],[.115,.041,-.1225,-.068],[.135,.036,-.1225,-.073],[.15,.026,-.118,-.082],[.158,.01,-.108,-.096]];
        const sections=(table,grow,lift)=>resample(table,18).map(([z,w,b,t])=>({c:[0,(b+t)/2+lift,z],u:[1,0,0],v:[0,1,0],ru:w+grow,rv:(t-b)/2+grow,n:2.7}));
        add(foot,loft(sections(bootTable,0,0),24),m.rubber);
        const soleTable=bootTable.map(([z,w,b])=>[z,w,b-.005,b+.012]);soleTable[0][0]-=.004;soleTable.at(-1)[0]+=.004;
        add(foot,loft(sections(soleTable,.003,0),24),m.sole);
        this.legs.push({hip,knee,foot,skin,side:s});
      }
    }
    buildArms(){
      const m=this.materials;this.arms=[];
      for(const s of [-1,1]){
        const shoulder=new T.Group();shoulder.position.set(s*SHOULDER_X,SHOULDER_Y,-.006);shoulder.rotation.z=s*.15;this.body.add(shoulder);
        const sleeve=verticalShell([[-UPPER-FORE-.012,.03,.03,.03],[-UPPER-FORE-.004,.05,.048,.048],[-UPPER-FORE+.012,.051,.05,.05],[-UPPER-FORE+.04,.047,.046,.046],[-UPPER-.08,.046,.046,.046],[-UPPER-.02,.05,.05,.05],[-UPPER+.04,.052,.052,.052],[-.08,.055,.055,.055],[-.02,.058,.058,.058],[.025,.053,.055,.055],[.045,.035,.04,.04],[.052,.01,.012,.012]],28,24,{disp:(a,j)=>1+.022*Math.sin(a*4+j*1.3)*smooth(9,4,Math.abs(j-12))});
        const skin=skinnedLimb(shoulder,m.sleeve,sleeve,-UPPER);
        const elbow=new T.Group();elbow.position.y=-UPPER;shoulder.add(elbow);
        add(elbow,verticalShell([[-FORE+.024,.0485,.0475,.0475],[-FORE+.03,.049,.048,.048],[-FORE+.044,.048,.047,.047]],3,24),m.reflector);
        const hand=new T.Group();hand.position.set(0,-FORE,.004);elbow.add(hand);
        // Knitted mittens: ribbed cuff, rounded mitt and a separate thumb.
        add(hand,verticalShell([[.012,.031,.032,.031],[-.006,.033,.034,.033],[-.022,.031,.032,.031]],4,20),m.woolCuff);
        add(hand,verticalShell([[-.018,.03,.026,.026],[-.04,.036,.03,.028],[-.07,.037,.029,.026],[-.095,.031,.025,.022],[-.108,.021,.018,.016],[-.115,.008,.007,.006]],10,20,{n:2.3}),m.wool);
        add(hand,loft([{c:[-s*.025,-.04,.016],ru:.012,rv:.012},{c:[-s*.033,-.062,.024],ru:.013,rv:.012},{c:[-s*.033,-.082,.026],ru:.01,rv:.01},{c:[-s*.032,-.088,.025],ru:.005,rv:.005}].map(x=>({...x,u:[1,0,0],v:[0,0,1]})),12),m.wool).rotation.z=0;
        this.arms.push({shoulder,elbow,hand,skin,side:s});
      }
    }
    buildLantern(glowTexture){
      const m=this.materials;this.lantern=new T.Group();this.arms[0].hand.add(this.lantern);this.lantern.position.set(0,-.2,.012);this.lantern.scale.setScalar(.86);const l=this.lantern;
      // Bail handle passes through the mitten; a real glass chamber
      // surrounds an emissive wick instead of an opaque glowing cylinder.
      add(l,tube([[-.092,.079,0],[-.10,.14,0],[-.071,.215,0],[0,.243,0],[.071,.215,0],[.10,.14,0],[.092,.079,0]],.007,28,7),m.iron);
      add(l,verticalShell([[-.112,.071,.071],[-.104,.095,.095],[-.085,.098,.098],[-.072,.077,.077]],4,28),m.iron);
      add(l,verticalShell([[.065,.077,.077],[.086,.103,.103],[.101,.096,.096],[.122,.055,.055],[.137,.048,.048],[.145,.008,.008]],6,28),m.iron);
      add(l,new T.TorusGeometry(.09,.005,6,28),m.metal,0,-.09,0).rotation.x=Math.PI/2;
      add(l,new T.TorusGeometry(.093,.004,6,28),m.metal,0,.088,0).rotation.x=Math.PI/2;
      const glass=new T.MeshPhysicalMaterial({color:'#e8d8ac',roughness:.15,metalness:.02,transparent:true,opacity:.15,depthWrite:false,side:T.DoubleSide});
      add(l,verticalShell([[-.074,.067,.067],[-.05,.075,.075],[.028,.075,.075],[.064,.065,.065]],4,28),glass);
      for(let i=0;i<4;i++){
        const a=i*TAU/4+Math.PI/4,x=Math.sin(a),z=Math.cos(a);
        add(l,tube([[x*.08,-.086,z*.08],[x*.087,-.025,z*.087],[x*.087,.035,z*.087],[x*.08,.085,z*.08]],.006,14,6),m.iron);
      }
      add(l,new T.CylinderGeometry(.038,.05,.032,16),m.metal,0,-.056,0);
      add(l,new T.CylinderGeometry(.011,.014,.035,12),m.iron,0,-.025,0);
      this.flame=add(l,new T.SphereGeometry(1,12,10),new T.MeshBasicMaterial({color:'#ffe6ad'}),0,.012,0,[.013,.04,.013]);
      this.flame.userData.dynamic=true;
      this.flameHalo=add(l,new T.SphereGeometry(1,12,10),new T.MeshBasicMaterial({color:'#ffac49',transparent:true,opacity:.2,depthWrite:false}),0,.012,0,[.022,.049,.022]);
      if(glowTexture){this.glow=new T.Sprite(new T.SpriteMaterial({map:glowTexture,color:'#ffd39a',transparent:true,opacity:.32,depthWrite:false,blending:T.AdditiveBlending}));this.glow.scale.set(.65,.65,1);l.add(this.glow);}
      for(let i=0;i<8;i++){const a=i*TAU/8;add(l,new T.SphereGeometry(1,8,6),m.metal,Math.sin(a)*.06,.113,Math.cos(a)*.06,[.005,.002,.005]);}
      const wheel=add(l,new T.CylinderGeometry(.014,.014,.008,12),m.metal,.094,-.06,0);wheel.rotation.z=Math.PI/2;
    }
    sampleMotion(name,phase,out){
      const frames=SkogCharacterAssets.clips[name].frames,u=((phase/TAU%1)+1)%1*frames.length,index=Math.floor(u),a=frames[index],b=frames[(index+1)%frames.length],mix=u-index;
      for(let i=0;i<out.length;i++)out[i]=a[i]+(b[i]-a[i])*mix;
    }
    setLantern(on){this.lanternOn=!!on;}
    setVisible(value){this.visible=value;this.group.visible=value;}
    update(t,dt,player){
      const height=SkogWorld.height(player.x,player.z);this.group.position.set(player.x,height+.006,player.z);this.group.rotation.y=player.heading;
      const speed=player.motionSpeed??player.speed;
      const target=clamp(speed/1.8,0,1),blend=1-Math.exp(-dt*10);this.motion+=(target-this.motion)*blend;
      this.runBlend+=(clamp((speed-2.1)/1.4,0,1)-this.runBlend)*blend;
      const running=this.runBlend,phase=player.walk;
      this.sampleMotion('Idle_Loop',t/SkogCharacterAssets.clips.Idle_Loop.duration*TAU,this.idlePose);
      this.sampleMotion('Walk_Loop',phase,this.walkPose);this.sampleMotion('Jog_Fwd_Loop',phase,this.runPose);
      for(let i=0;i<15;i++)this.pose[i]=T.MathUtils.lerp(this.idlePose[i],T.MathUtils.lerp(this.walkPose[i],this.runPose[i],running),this.motion);
      const pose=this.pose,bob=pose[0]*(.45-.25*running);
      this.body.position.y=bob-.01-.03*this.motion-.02*running;
      this.body.rotation.set((pose[1]-.29)*.22+.035*this.motion,pose[2]*.12,pose[3]*.20);
      const turnDelta=Math.atan2(Math.sin(player.heading-this.lastHeading),Math.cos(player.heading-this.lastHeading));this.lastHeading=player.heading;
      this.turn+=(clamp(turnDelta/Math.max(dt,.001),-3,3)-this.turn)*(1-Math.exp(-dt*4));
      this.head.rotation.y=pose[5]*.65-this.turn*.035;this.head.rotation.x=-.025+(pose[4]-.24)*.3;
      this.neck.rotation.y=Math.sin(phase)*.024*this.motion;
      this.pack.rotation.x=.05+Math.sin(phase*2+.7)*.022*this.motion;this.pack.rotation.z=-Math.sin(phase)*.016*this.motion;
      const l1=THIGH,l2=SHIN;
      for(let i=0;i<2;i++){
        const leg=this.legs[i],a=phase+i*Math.PI,offset=7+i*4,lift=pose[offset+1]*(.5-.15*running)*this.motion,swing=clamp(lift/.1,0,1);
        const z=pose[offset]*(.54-.12*running)*this.motion;
        const localX=leg.side*HIP_X,worldX=player.x+Math.cos(player.heading)*localX+Math.sin(player.heading)*z,worldZ=player.z-Math.sin(player.heading)*localX+Math.cos(player.heading)*z;
        const rise=clamp(SkogWorld.height(worldX,worldZ)-height,-.13,.13);
        const ankleY=ANKLE+rise+lift;
        const dy=HIP_Y+this.body.position.y-ankleY,d=clamp(Math.hypot(dy,z),.17,l1+l2-.004);
        const upper=Math.atan2(z,dy)+Math.acos(clamp((l1*l1+d*d-l2*l2)/(2*l1*d),-1,1));
        const bend=Math.PI-Math.acos(clamp((l1*l1+l2*l2-d*d)/(2*l1*l2),-1,1));
        leg.hip.rotation.x=-upper;leg.knee.rotation.x=bend;
        leg.skin.joint.rotation.x=bend;
        leg.foot.position.set(0,-SHIN,0);leg.swing=swing*this.motion;
        leg.foot.rotation.x=upper-bend-this.body.rotation.x+Math.max(0,Math.sin(a))*.08*this.motion;
        leg.foot.rotation.z=-this.body.rotation.z;
        const arm=this.arms[i];
        // The lantern arm is held slightly out and forward, clear of the coat.
        arm.shoulder.rotation.x=i===0?-.16+pose[offset+2]*.16:pose[offset+2]*.6;
        arm.shoulder.rotation.z=arm.side*(i===0?.3:.15+.04*this.motion);
        arm.elbow.rotation.x=i===0?-.34+(pose[offset+3]-pose[offset+2])*.08:(pose[offset+3]-pose[offset+2])*.7;
        arm.skin.joint.rotation.x=arm.elbow.rotation.x;
        arm.hand.rotation.x=-(arm.shoulder.rotation.x+arm.elbow.rotation.x)*.35;
      }
      const carrying=this.arms[0];
      this.lantern.rotation.x=-(carrying.shoulder.rotation.x+carrying.elbow.rotation.x+carrying.hand.rotation.x)+Math.sin(phase+.6)*.09*this.motion;
      this.lantern.rotation.z=-carrying.shoulder.rotation.z-this.body.rotation.z+Math.sin(t*1.4)*.018;
      this.flame.scale.y=.04*(1+Math.sin(t*11.7)*.08+Math.sin(t*19.3)*.035);
      this.flameHalo.scale.y=.049*(1+Math.sin(t*9.3)*.06);
      this.group.updateMatrixWorld(true);
      // Place the supporting sole on the sloped ground. The centimetre-scale
      // ankle correction lives inside the boot shaft and prevents foot hover
      // when torso sway or a steep little ridge changes the analytic IK plane.
      for(const leg of this.legs){
        let correction=-Infinity;
        for(const [x,z] of [[0,.037],[-.04,-.04],[.04,-.04],[-.04,.12],[.04,.12]]){
          this.footA.set(x,-.1275,z).applyMatrix4(leg.foot.matrixWorld);
          correction=Math.max(correction,SkogWorld.height(this.footA.x,this.footA.z)+.002-this.footA.y);
        }
        leg.knee.getWorldQuaternion(this.footRotation).invert();this.footB.set(0,clamp(correction,leg.swing<.04?-.035:0,.045),0).applyQuaternion(this.footRotation);leg.foot.position.add(this.footB);
      }
      this.group.updateMatrixWorld(true);this.flame.getWorldPosition(this.lightPosition);this.lanternLight.position.copy(this.lightPosition);
      this.lanternLevel+=(Number(this.lanternOn)-this.lanternLevel)*(1-Math.exp(-dt*7));
      const level=this.lanternLevel;
      this.lanternLight.intensity=level*LANTERN_POWER*(1+Math.sin(t*7.7)*.024+Math.sin(t*13.1)*.013+Math.sin(t*2.3)*Math.sin(t*5.9)*.02);
      this.lanternLight.shadow.autoUpdate=level>.015;
      this.flame.visible=level>.015;this.flameHalo.visible=level>.015;
      this.flame.material.color.setRGB(4.2*level,2.5*level,.9*level);
      this.flameHalo.material.opacity=.2*level;
      if(this.glow)this.glow.material.opacity=.32*level;
    }
    get stats(){let triangles=0,draws=0;this.group.traverse(o=>{if(o.isMesh){triangles+=(o.geometry.index?o.geometry.index.count:o.geometry.attributes.position.count)/3;draws++;}});return {triangles,draws};}
  }
  root.SkogCharacter=SkogCharacter;
})(globalThis);
