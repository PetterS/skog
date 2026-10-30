/* Skog's original, articulated child explorer. No network or asset loader. */
(function (root) {
  'use strict';
  const T = THREE, TAU = Math.PI * 2;
  const V = (x=0,y=0,z=0) => new T.Vector3(x,y,z);
  const clamp = (x,a,b) => Math.max(a,Math.min(b,x));

  function textile(kind) {
    const size=128, canvas=document.createElement('canvas');canvas.width=canvas.height=size;
    const ctx=canvas.getContext('2d'),data=ctx.createImageData(size,size);
    const height=(x,y)=>kind==='knit'
      ? Math.sin(x*TAU/12)*.65+Math.sin((y+Math.sin(x*TAU/12)*2)*TAU/8)*.25
      : Math.sin(x*TAU/4)*Math.sin(y*TAU/4)*.26+Math.sin(x*TAU/19+y*.47)*.09;
    for(let y=0;y<size;y++)for(let x=0;x<size;x++){
      const dx=height(x+1,y)-height(x-1,y),dy=height(x,y+1)-height(x,y-1),i=(y*size+x)*4;
      data.data[i]=128-dx*42;data.data[i+1]=128-dy*42;data.data[i+2]=250;data.data[i+3]=255;
    }
    ctx.putImageData(data,0,0);const tex=new T.CanvasTexture(canvas);tex.wrapS=tex.wrapT=T.RepeatWrapping;
    tex.repeat.set(kind==='knit'?4:5,kind==='knit'?3:5);return tex;
  }
  function mat(color,extra={}) {return new T.MeshStandardMaterial({color,roughness:.78,...extra});}
  function add(parent,geo,material,x=0,y=0,z=0,scale=null) {
    const mesh=new T.Mesh(geo,material);mesh.position.set(x,y,z);if(scale)mesh.scale.set(...scale);
    mesh.castShadow=false;mesh.receiveShadow=true;parent.add(mesh);return mesh;
  }
  const sphere=new T.SphereGeometry(1,18,12),smallSphere=new T.SphereGeometry(1,10,8);
  function ball(parent,material,x,y,z,sx,sy=sx,sz=sx){return add(parent,sx<.021?smallSphere:sphere,material,x,y,z,[sx,sy,sz]);}
  function line(parent,material,points,radius=.005,segments=20,sides=6){
    return add(parent,new T.TubeGeometry(new T.CatmullRomCurve3(points.map(p=>V(...p))),segments,radius,sides,false),material);
  }
  function rings(profile,sides=32,fold=0) {
    const positions=[],uv=[],index=[];
    for(let j=0;j<profile.length;j++){
      const [y,rx,rz,zc=0,xc=0]=profile[j];
      for(let i=0;i<=sides;i++){
        const a=i/sides*TAU, ripple=1+fold*(Math.sin(a*7+y*9)*.65+Math.cos(a*11-y*13)*.35);
        positions.push(xc+Math.sin(a)*rx*ripple,y,zc+Math.cos(a)*rz*ripple);uv.push(i/sides,j/(profile.length-1));
        if(j&&i){const b=j*(sides+1)+i;index.push(b,b-1,b-sides-1,b-1,b-sides-2,b-sides-1);}
      }
    }
    const geo=new T.BufferGeometry();geo.setAttribute('position',new T.Float32BufferAttribute(positions,3));geo.setAttribute('uv',new T.Float32BufferAttribute(uv,2));geo.setIndex(index);geo.computeVertexNormals();
    const normals=geo.attributes.normal;
    for(let j=0;j<profile.length;j++){const a=j*(sides+1),b=a+sides,n=V(normals.getX(a)+normals.getX(b),normals.getY(a)+normals.getY(b),normals.getZ(a)+normals.getZ(b)).normalize();normals.setXYZ(a,n.x,n.y,n.z);normals.setXYZ(b,n.x,n.y,n.z);}
    return geo;
  }
  // A genuinely rounded box, with continuous corner normals and planar faces.
  function roundedBox(w,h,d,r=.025,segments=4) {
    const geo=new T.BoxGeometry(w,h,d,segments,segments,segments),p=geo.attributes.position,normals=geo.attributes.normal;
    const q=V(),n=V();
    for(let i=0;i<p.count;i++){
      q.set(clamp(p.getX(i),-w/2+r,w/2-r),clamp(p.getY(i),-h/2+r,h/2-r),clamp(p.getZ(i),-d/2+r,d/2-r));
      n.set(p.getX(i)-q.x,p.getY(i)-q.y,p.getZ(i)-q.z).normalize();q.addScaledVector(n,r);p.setXYZ(i,q.x,q.y,q.z);normals.setXYZ(i,n.x,n.y,n.z);
    }
    return geo;
  }
  function cylinderBetween(parent,material,a,b,r1,r2=r1,sides=10){
    const d=V().subVectors(b,a),mesh=add(parent,new T.CylinderGeometry(r2,r1,d.length(),sides,1),material);
    mesh.position.copy(a).add(b).multiplyScalar(.5);mesh.quaternion.setFromUnitVectors(V(0,1,0),d.normalize());return mesh;
  }
  function skinnedLimb(parent,material,profile,jointY) {
    const geo=rings(profile,28,.012),pos=geo.attributes.position,indices=[],weights=[];
    for(let i=0;i<pos.count;i++){
      const u=clamp((jointY+.075-pos.getY(i))/.15,0,1),w=u*u*(3-2*u);
      indices.push(0,1,0,0);weights.push(1-w,w,0,0);
    }
    geo.setAttribute('skinIndex',new T.Uint16BufferAttribute(indices,4));geo.setAttribute('skinWeight',new T.Float32BufferAttribute(weights,4));
    const mesh=new T.SkinnedMesh(geo,material),base=new T.Bone(),joint=new T.Bone();joint.position.y=jointY;base.add(joint);mesh.add(base);parent.add(mesh);parent.updateWorldMatrix(true,true);
    const skeleton=new T.Skeleton([base,joint]);mesh.bind(skeleton);mesh.castShadow=false;mesh.receiveShadow=true;return {mesh,joint};
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

  class SkogCharacter {
    constructor({scene,glowTexture}) {
      this.scene=scene;this.group=new T.Group();this.group.name='Barnet';scene.add(this.group);
      this.body=new T.Group();this.group.add(this.body);
      this.knitNormal=textile('knit');this.fabricNormal=textile('canvas');
      this.materials={
        coat:mat('#c99442',{roughness:.58,normalMap:this.fabricNormal,normalScale:new T.Vector2(.1,.1)}),
        piping:mat('#d6ae60',{roughness:.62}), seam:mat('#9c7135'), lining:mat('#d5c6a4'),
        skin:mat('#cfad8c',{roughness:.83,vertexColors:true}), skinPlain:mat('#cfad8c',{roughness:.83}),
        blush:mat('#ab7967'), lips:mat('#a57365'), hair:mat('#352a23'),
        hat:mat('#763e39',{roughness:.95,normalMap:this.knitNormal,normalScale:new T.Vector2(.65,.65)}),
        hatEdge:mat('#90514b',{roughness:.96,normalMap:this.knitNormal,normalScale:new T.Vector2(.6,.6)}),
        knit:mat('#5a5a4d',{roughness:.96,normalMap:this.knitNormal,normalScale:new T.Vector2(.4,.4)}),
        pants:mat('#343e42',{normalMap:this.fabricNormal,normalScale:new T.Vector2(.28,.28)}),
        boot:mat('#493d32',{roughness:.6}), rubber:mat('#252b29',{roughness:.93}),sole:mat('#5d5141'),
        bag:mat('#5b6650',{roughness:.91,normalMap:this.fabricNormal,normalScale:new T.Vector2(.35,.35)}),
        leather:mat('#71523a',{roughness:.67}),stitch:mat('#c5b68b',{roughness:1}),
        metal:mat('#76664a',{metalness:.8,roughness:.32}),iron:mat('#343b36',{metalness:.75,roughness:.36}),
        eye:mat('#b9b7a2',{roughness:.42}),iris:mat('#494f3a',{roughness:.3}),pupil:mat('#141b19',{roughness:.2}),
        glint:new T.MeshBasicMaterial({color:'#e1e4d4'}),
      };
      this.buildTorso();this.buildHead();this.buildPack();this.buildLegs();this.buildArms();this.buildLantern(glowTexture);
      consolidate(this.body);
      this.lanternLight=new T.PointLight('#ffd39a',6.5,12,1.75);scene.add(this.lanternLight);
      this.lightPosition=V();this.footA=V();this.footB=V();this.footRotation=new T.Quaternion();this.motion=0;this.turn=0;this.lastHeading=0;this.visible=true;
      this.group.updateMatrixWorld(true);
    }
    buildTorso(){
      const m=this.materials,b=this.body;
      add(b,rings([[.57,.235,.143],[.585,.261,.158],[.62,.264,.162],[.69,.247,.155],[.78,.22,.146],[.87,.224,.152],[.96,.24,.158],[1.015,.255,.15],[1.055,.25,.135],[1.088,.204,.115],[1.105,.12,.103]],40,.022),m.coat);
      // Raised hem and seams follow the shaped cloth rather than crossing it.
      add(b,rings([[.579,.26,.158],[.594,.265,.163],[.608,.263,.162]],40,.014),m.piping);
      for(const x of [-1,1]){
        line(b,m.seam,[[x*.246,.62,0],[x*.224,.79,0],[x*.235,.94,.015],[x*.24,1.04,.015]],.003,20);
        const pocket=new T.Group();pocket.position.set(x*.155,.735,.144);pocket.rotation.y=x*.21;b.add(pocket);
        add(pocket,roundedBox(.135,.12,.019,.012),m.coat,0,0,0);
        add(pocket,roundedBox(.145,.042,.022,.012),m.piping,0,.049,.013);
        line(pocket,m.seam,[[-.059,.036,.024],[-.06,-.046,.015],[0,-.05,.018],[.06,-.046,.015],[.059,.036,.024]],.0017,24,4);
        ball(pocket,m.metal,0,.049,.028,.008,.008,.004);
      }
      add(b,rings([[1.07,.115,.103],[1.10,.13,.115],[1.135,.119,.11]],32),m.piping);
      add(b,roundedBox(.026,.46,.017,.006),m.piping,0,.833,.158);
      line(b,m.seam,[[.017,.61,.161],[.014,.82,.166],[.014,1.02,.162]],.002,20,4);
      for(const y of [.67,.77,.87,.97,1.06])ball(b,m.metal,0,y,.174,.0075,.0075,.003);
      // Hood is a folded, lined shell cupping the neck and shoulder blades.
      const hood=new T.Group();hood.position.set(0,1.035,-.12);hood.rotation.x=-.36;b.add(hood);
      const hoodGeo=rings([[-.095,.105,.055,-.02],[-.073,.18,.078,-.017],[-.035,.212,.11,-.015],[.012,.21,.13,0],[.052,.185,.112,.015],[.065,.145,.085,.02]],36,.025);
      add(hood,hoodGeo,m.coat);add(hood,rings([[.052,.177,.105,.014],[.065,.146,.085,.02],[.043,.114,.067,.025]],36),m.lining);
      line(hood,m.piping,[[-.15,.055,.064],[-.10,.069,.09],[0,.07,.105],[.10,.069,.09],[.15,.055,.064]],.008,28,6);
      // Small braided drawstrings and toggles at the collar.
      for(const s of [-1,1]){
        line(b,m.stitch,[[s*.10,1.10,.108],[s*.118,1.025,.17],[s*.11,.97,.178]],.003,12,5);
        add(b,roundedBox(.012,.028,.011,.004),m.leather,s*.11,.965,.178);
      }
    }
    buildHead(){
      const m=this.materials;this.neck=new T.Group();this.neck.position.set(0,1.10,0);this.body.add(this.neck);
      add(this.neck,new T.CylinderGeometry(.071,.078,.12,20),m.skinPlain,0,.027,0);
      this.head=new T.Group();this.head.position.set(0,.183,.005);this.neck.add(this.head);const h=this.head;
      const geo=new T.SphereGeometry(1,32,24),p=geo.attributes.position,colors=[];const base=new T.Color('#ffffff'),blush=new T.Color('#dbb9aa');
      for(let i=0;i<p.count;i++){
        const nx=p.getX(i),ny=p.getY(i),nz=p.getZ(i),jaw=ny<-.2?1-(Math.abs(ny)-.2)*.18:1;
        const cheek=Math.exp(-((Math.abs(nx)-.55)**2/.1+(ny+.17)**2/.2))*Math.max(0,nz);
        const eyeSocket=Math.exp(-((Math.abs(nx)-.38)**2/.03+(ny-.16)**2/.04))*Math.max(0,nz);
        p.setXYZ(i,nx*.165*jaw,ny*.195,nz*.152+cheek*.009-eyeSocket*.009);
        const c=base.clone().lerp(blush,cheek*.38);colors.push(c.r,c.g,c.b);
      }
      geo.setAttribute('color',new T.Float32BufferAttribute(colors,3));geo.computeVertexNormals();add(h,geo,m.skin);
      for(const s of [-1,1]){
        ball(h,m.skinPlain,s*.163,-.009,-.005,.035,.052,.022);
        ball(h,m.blush,s*.180,-.007,.007,.011,.027,.009);
        ball(h,m.skinPlain,s*.177,-.024,.014,.012,.018,.012);
        const eye=new T.Group();eye.position.set(s*.061,.03,.132);eye.rotation.y=s*.19;h.add(eye);
        ball(eye,m.eye,0,0,0,.025,.0105,.010);
        ball(eye,m.iris,0,.001,.009,.0098,.0088,.0035);
        ball(eye,m.pupil,0,.001,.012,.0048,.0065,.0025);
        ball(eye,m.glint,-.003,.004,.014,.0017,.0017,.001);
        line(eye,m.skinPlain,[[-.027,-.001,.001],[-.018,.007,.009],[0,.011,.012],[.019,.007,.008],[.027,-.001,.001]],.005,20,6);
        line(eye,m.skinPlain,[[-.025,-.003,.002],[-.012,-.009,.009],[.012,-.009,.008],[.025,-.003,.002]],.0035,16,6);
        line(h,m.hair,[[s*.031,.082,.134],[s*.056,.088,.142],[s*.083,.082,.131],[s*.095,.073,.119]],.0055,16,6);
        for(let i=0;i<4;i++)ball(h,m.blush,s*(.044+i*.012),-.022+(i%2)*.006,.150-i*.001,.0018,.0012,.001);
      }
      ball(h,m.skinPlain,0,-.005,.145,.019,.043,.022);
      ball(h,m.skinPlain,0,-.035,.169,.024,.019,.023);
      for(const s of [-1,1])ball(h,m.blush,s*.013,-.044,.181,.004,.002,.003);
      line(h,m.lips,[[-.032,-.092,.129],[-.016,-.087,.14],[0,-.09,.145],[.016,-.088,.14],[.032,-.091,.129]],.0034,24,6);
      line(h,m.skinPlain,[[-.023,-.098,.135],[0,-.102,.143],[.023,-.098,.135]],.0045,18,6);
      // The hair continues around the occiput and nape beneath the beanie.
      // It is a fitted shell, not a stack of spherical locks or a bald back.
      const hairPos=[],hairUV=[],hairIndex=[],hairProfile=[[-.132,.085,.083],[-.11,.125,.111],[-.06,.157,.146],[0,.17,.158],[.07,.165,.153],[.14,.127,.124]],hairSides=32;
      for(let j=0;j<hairProfile.length;j++)for(let i=0;i<=hairSides;i++){
        const [y,rx,rz]=hairProfile[j],a=Math.PI*.45+i/hairSides*Math.PI*1.1;
        hairPos.push(Math.sin(a)*rx,y+(j===0?Math.sin(a*9)*.009:0),Math.cos(a)*rz-.004);hairUV.push(i/hairSides,j/(hairProfile.length-1));
        if(j&&i){const n=j*(hairSides+1)+i;hairIndex.push(n,n-1,n-hairSides-1,n-1,n-hairSides-2,n-hairSides-1);}
      }
      const hairGeo=new T.BufferGeometry();hairGeo.setAttribute('position',new T.Float32BufferAttribute(hairPos,3));hairGeo.setAttribute('uv',new T.Float32BufferAttribute(hairUV,2));hairGeo.setIndex(hairIndex);hairGeo.computeVertexNormals();add(h,hairGeo,m.hair);
      // A fitted, swept fringe with a tapered irregular edge. Flattened curved
      // strands catch the light without becoming a row of spherical blobs.
      const fringePos=[],fringeUV=[],fringeIndex=[],cols=28,rows=6;
      for(let j=0;j<=rows;j++)for(let i=0;i<=cols;i++){
        const x=-.145+i/cols*.29,u=j/rows,edge=.066+.013*Math.sin(x*38+.7)+.008*Math.sin(x*83),y=edge+( .128-edge)*u;
        const z=.156*Math.sqrt(Math.max(.02,1-(x/.172)**2-(y/.23)**2))+.008;
        fringePos.push(x,y,z);fringeUV.push(i/cols,u);
        if(i&&j){const n=j*(cols+1)+i;fringeIndex.push(n,n-1,n-cols-1,n-1,n-cols-2,n-cols-1);}
      }
      const fringe=new T.BufferGeometry();fringe.setAttribute('position',new T.Float32BufferAttribute(fringePos,3));fringe.setAttribute('uv',new T.Float32BufferAttribute(fringeUV,2));fringe.setIndex(fringeIndex);fringe.computeVertexNormals();add(h,fringe,m.hair);
      for(let i=0;i<5;i++){
        const x=-.105+i*.049,z=.156*Math.sqrt(Math.max(.05,1-(x/.172)**2));
        const lock=add(h,rings([[.054+(i%2)*.012,.001,.001,z+.003,-.013],[.063+(i%2)*.01,.005,.003,z+.006,-.009],[.083,.016,.005,z+.001,-.004],[.107,.018,.005,z-.012,.002],[.13,.012,.003,z-.023,.007]],16),m.hair,x,0,0);lock.rotation.z=-.12;
      }
      for(const s of [-1,1])add(h,rings([[-.01,.003,.018],[.018,.012,.032],[.062,.019,.044],[.11,.019,.039]],18),m.hair,s*.149,0,-.022);
      add(h,rings([[.116,.169,.154,-.009],[.14,.176,.158,-.014],[.18,.174,.153,-.018],[.22,.15,.133,-.026],[.255,.108,.104,-.034],[.278,.058,.058,-.036],[.285,.006,.006,-.034]],40,.008),m.hat);
      add(h,rings([[.108,.168,.154,-.008],[.116,.179,.166,-.008],[.137,.181,.165,-.01],[.156,.176,.158,-.013],[.161,.17,.153,-.013]],40,.006),m.hatEdge);
      // A small woven label, never text-dependent at gameplay distance.
      const patch=add(h,roundedBox(.036,.025,.005,.004),m.leather,.127,.13,.106);patch.rotation.y=.79;
      const stripe=add(h,roundedBox(.015,.011,.006,.002),m.stitch,.128,.131,.11);stripe.rotation.y=.79;
    }
    buildPack(){
      const m=this.materials;this.pack=new T.Group();this.pack.position.set(0,.866,-.198);this.body.add(this.pack);const p=this.pack;
      add(p,roundedBox(.307,.365,.145,.055,6),m.bag,0,0,-.035);
      add(p,roundedBox(.28,.13,.172,.04,5),m.leather,0,.125,-.042);
      add(p,roundedBox(.217,.145,.048,.024,4),m.bag,0,-.058,-.126);
      add(p,roundedBox(.22,.046,.055,.016,4),m.leather,0,.005,-.13);
      for(const s of [-1,1]){
        add(p,roundedBox(.035,.28,.018,.006),m.leather,s*.088,-.008,-.122);
        add(p,roundedBox(.047,.044,.012,.008),m.metal,s*.088,-.023,-.138);
        add(p,roundedBox(.026,.026,.016,.004),m.leather,s*.088,-.023,-.145);
        ball(p,m.metal,s*.088,-.066,-.136,.0055,.0055,.003);
        line(p,m.stitch,[[s*.126,.102,-.121],[s*.139,.035,-.107],[s*.138,-.12,-.103],[s*.10,-.162,-.105]],.0018,24,4);
        line(this.body,m.leather,[[s*.123,1.03,-.225],[s*.171,1.095,-.06],[s*.19,1.032,.126],[s*.192,.91,.148],[s*.188,.78,.125],[s*.143,.712,-.19]],.021,32,8);
        line(this.body,m.stitch,[[s*.166,1.067,.072],[s*.182,1.01,.147],[s*.183,.85,.149]],.002,18,4);
      }
      line(p,m.leather,[[-.062,.18,-.025],[-.06,.224,-.027],[0,.236,-.028],[.06,.224,-.027],[.062,.18,-.025]],.013,24,8);
      // Rolled wool blanket and fastening cords.
      const roll=add(p,new T.CylinderGeometry(.044,.044,.268,16,1),m.knit,0,-.205,-.025);roll.rotation.z=Math.PI/2;
      for(const s of [-1,1]){const strap=add(p,new T.TorusGeometry(.047,.007,6,20),m.leather,s*.085,-.205,-.025);strap.rotation.y=Math.PI/2;}
    }
    buildLegs(){
      const m=this.materials;this.legs=[];
      for(const s of [-1,1]){
        const hip=new T.Group();hip.position.set(s*.105,.65,0);this.body.add(hip);
        const skin=skinnedLimb(hip,m.pants,[[-.53,.047,.047],[-.49,.05,.049],[-.43,.054,.054],[-.35,.059,.058],[-.30,.062,.061],[-.27,.063,.062],[-.23,.066,.064],[-.17,.07,.066],[-.08,.079,.074],[.018,.082,.075]],-.27);
        const knee=new T.Group();knee.position.y=-.27;hip.add(knee);
        const foot=new T.Group();foot.position.y=-.26;knee.add(foot);
        add(foot,roundedBox(.143,.085,.23,.029,5),m.rubber,0,-.085,.037);
        add(foot,roundedBox(.137,.045,.225,.022,5),m.sole,0,-.064,.037);
        add(foot,roundedBox(.137,.107,.21,.042,6),m.boot,0,-.025,.035);
        const ankle=add(foot,rings([[-.035,.066,.065],[.025,.064,.061],[.074,.058,.055],[.089,.059,.056]],24,.01),m.boot,0,0,-.018);
        add(foot,rings([[.065,.062,.059],[.083,.063,.059],[.095,.058,.055]],24),m.leather,0,0,-.018);
        const toe=ball(foot,m.rubber,0,-.041,.111,.063,.037,.039);
        line(foot,m.stitch,[[-.059,-.015,.063],[-.05,.009,.093],[0,.018,.104],[.05,.009,.093],[.059,-.015,.063]],.0017,20,4);
        for(let j=0;j<3;j++){
          const y=.02+j*.016,z=.042-j*.008;
          line(foot,m.leather,[[-.035,y,z],[0,y-.005,z+.006],[.035,y+.01,z]],.0025,8,5);
          for(const side of [-1,1])ball(foot,m.metal,side*.035,y,z,.0038,.0038,.002);
        }
        add(foot,roundedBox(.018,.044,.012,.004),m.leather,0,.072,-.079);
        this.legs.push({hip,knee,foot,skin,side:s});
      }
    }
    buildArms(){
      const m=this.materials;this.arms=[];
      for(const s of [-1,1]){
        const shoulder=new T.Group();shoulder.position.set(s*.239,1.041,.003);shoulder.rotation.z=s*.11;this.body.add(shoulder);
        const skin=skinnedLimb(shoulder,m.coat,[[-.449,.048,.05],[-.42,.055,.055],[-.36,.06,.06],[-.29,.064,.064],[-.25,.065,.065],[-.22,.066,.066],[-.18,.073,.071],[-.10,.081,.077],[-.035,.085,.08],[.02,.078,.071],[.054,.052,.05],[.06,.043,.041],[.066,.025,.024],[.069,.005,.005]],-.232);
        const elbow=new T.Group();elbow.position.y=-.232;shoulder.add(elbow);
        add(elbow,rings([[-.217,.053,.055],[-.195,.06,.06],[-.175,.06,.06]],24),m.piping);
        add(elbow,rings([[-.231,.043,.044],[-.218,.049,.049],[-.205,.049,.049]],24),m.knit);
        const hand=new T.Group();hand.position.set(0,-.252,.003);elbow.add(hand);
        ball(hand,m.skinPlain,0,-.016,0,.038,.051,.026);
        const thumb=ball(hand,m.skinPlain,-s*.029,-.008,.012,.018,.028,.018);thumb.rotation.z=s*.4;
        for(let j=0;j<4;j++){
          const finger=ball(hand,m.skinPlain,(j-1.5)*.015,-.049,.007,.009,.024-(j===3?.005:0),.012);finger.rotation.x=-.24;
          line(hand,m.blush,[[(j-1.5)*.015-.004,-.049,.018],[(j-1.5)*.015+.004,-.049,.018]],.0008,2,4);
        }
        this.arms.push({shoulder,elbow,hand,skin,side:s});
      }
    }
    buildLantern(glowTexture){
      const m=this.materials;this.lantern=new T.Group();this.arms[0].hand.add(this.lantern);this.lantern.position.set(0,-.235,.012);const l=this.lantern;
      // Bail handle passes through the curled fingers; a real glass chamber
      // surrounds an emissive wick instead of an opaque glowing cylinder.
      line(l,m.iron,[[-.092,.079,0],[-.10,.14,0],[-.071,.215,0],[0,.243,0],[.071,.215,0],[.10,.14,0],[.092,.079,0]],.007,28,7);
      add(l,rings([[-.112,.071,.071],[-.104,.095,.095],[-.085,.098,.098],[-.072,.077,.077]],28),m.iron);
      add(l,rings([[.065,.077,.077],[.086,.103,.103],[.101,.096,.096],[.122,.055,.055],[.137,.048,.048],[.145,.008,.008]],28),m.iron);
      add(l,new T.TorusGeometry(.09,.005,6,28),m.metal,0,-.09,0).rotation.x=Math.PI/2;
      add(l,new T.TorusGeometry(.093,.004,6,28),m.metal,0,.088,0).rotation.x=Math.PI/2;
      const glass=new T.MeshPhysicalMaterial({color:'#e8d8ac',roughness:.15,metalness:.02,transparent:true,opacity:.15,depthWrite:false,side:T.DoubleSide});
      add(l,rings([[-.074,.067,.067],[-.05,.075,.075],[.028,.075,.075],[.064,.065,.065]],28),glass);
      for(let i=0;i<4;i++){
        const a=i*TAU/4+Math.PI/4,x=Math.sin(a),z=Math.cos(a);
        line(l,m.iron,[[x*.08,-.086,z*.08],[x*.087,-.025,z*.087],[x*.087,.035,z*.087],[x*.08,.085,z*.08]],.006,14,6);
      }
      add(l,new T.CylinderGeometry(.038,.05,.032,16),m.metal,0,-.056,0);
      add(l,new T.CylinderGeometry(.011,.014,.035,12),m.iron,0,-.025,0);
      this.flame=ball(l,new T.MeshBasicMaterial({color:'#ffe6ad'}),0,.012,0,.013,.04,.013);
      this.flame.userData.dynamic=true;
      const aureole=ball(l,new T.MeshBasicMaterial({color:'#ffac49',transparent:true,opacity:.2,depthWrite:false}),0,.012,0,.022,.049,.022);
      this.flameHalo=aureole;
      if(glowTexture){this.glow=new T.Sprite(new T.SpriteMaterial({map:glowTexture,color:'#ffd39a',transparent:true,opacity:.32,depthWrite:false,blending:T.AdditiveBlending}));this.glow.scale.set(.65,.65,1);l.add(this.glow);}
      // Latch, ventilation holes and the adjustment wheel give the small prop
      // the same finish as the coat and rucksack.
      for(let i=0;i<8;i++){const a=i*TAU/8;ball(l,m.metal,Math.sin(a)*.06,.113,Math.cos(a)*.06,.005,.002,.005);}
      const wheel=add(l,new T.CylinderGeometry(.014,.014,.008,12),m.metal,.094,-.06,0);wheel.rotation.z=Math.PI/2;
    }
    setVisible(value){this.visible=value;this.group.visible=value;}
    update(t,dt,player){
      const height=SkogWorld.height(player.x,player.z);this.group.position.set(player.x,height+.006,player.z);this.group.rotation.y=player.heading;
      const speed=player.motionSpeed??player.speed;
      const target=clamp(speed/1.8,0,1),blend=1-Math.exp(-dt*10);this.motion+=(target-this.motion)*blend;
      const running=clamp((speed-2.1)/1.4,0,1),phase=player.walk;
      const bob=Math.cos(phase*2)*.012*this.motion;this.body.position.y=bob-.004-.045*this.motion-.025*running;
      this.body.rotation.z=Math.sin(phase)*.022*this.motion;this.body.rotation.x=.035*this.motion+.065*running;
      const turnDelta=Math.atan2(Math.sin(player.heading-this.lastHeading),Math.cos(player.heading-this.lastHeading));this.lastHeading=player.heading;
      this.turn+=(clamp(turnDelta/Math.max(dt,.001),-3,3)-this.turn)*(1-Math.exp(-dt*4));
      this.head.rotation.y=Math.sin(t*.38)*.045-this.turn*.035;this.head.rotation.x=-.025+Math.sin(t*.7)*.012;
      this.neck.rotation.y=Math.sin(phase)*.024*this.motion;
      this.pack.rotation.x=-.018+Math.sin(phase*2+.7)*.025*this.motion;this.pack.rotation.z=-Math.sin(phase)*.018*this.motion;
      for(let i=0;i<2;i++){
        const leg=this.legs[i],a=phase+i*Math.PI,swing=Math.max(0,-Math.sin(a));
        const stride=(.20+.085*running)*this.motion,z=Math.cos(a)*stride;
        const localX=leg.side*.105,worldX=player.x+Math.cos(player.heading)*localX+Math.sin(player.heading)*z,worldZ=player.z-Math.sin(player.heading)*localX+Math.cos(player.heading)*z;
        const rise=clamp(SkogWorld.height(worldX,worldZ)-height,-.13,.13);
        const ankleY=.13+rise+Math.pow(swing,.8)*(.09+.06*running)*this.motion;
        const dy=.65+this.body.position.y-ankleY,l1=.27,l2=.26,d=clamp(Math.hypot(dy,z),.17,l1+l2-.002);
        const upper=Math.atan2(z,dy)+Math.acos(clamp((l1*l1+d*d-l2*l2)/(2*l1*d),-1,1));
        const bend=Math.PI-Math.acos(clamp((l1*l1+l2*l2-d*d)/(2*l1*l2),-1,1));
        leg.hip.rotation.x=-upper;leg.knee.rotation.x=bend;
        leg.skin.joint.rotation.x=bend;
        leg.foot.position.set(0,-.26,0);leg.swing=swing*this.motion;
        leg.foot.rotation.x=upper-bend-this.body.rotation.x+Math.max(0,Math.sin(a))*.08*this.motion;
        leg.foot.rotation.z=-this.body.rotation.z;
        const arm=this.arms[i];
        arm.shoulder.rotation.x=(i===0?-.06:0)+Math.sin(a)*(.22+.18*running)*this.motion;
        arm.shoulder.rotation.z=arm.side*(.11+.04*this.motion);
        arm.elbow.rotation.x=i===0?-.24-Math.sin(a)*.045*this.motion:-.13-.24*running-Math.max(0,-Math.sin(a))*.13*this.motion;
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
      // ankle correction lives inside the boot collar and prevents foot hover
      // when torso sway or a steep little ridge changes the analytic IK plane.
      for(const leg of this.legs)if(leg.swing<.04){
        let correction=-Infinity;
        for(const [x,z] of [[0,.037],[-.05,-.04],[.05,-.04],[-.05,.12],[.05,.12]]){
          this.footA.set(x,-.1275,z).applyMatrix4(leg.foot.matrixWorld);
          correction=Math.max(correction,SkogWorld.height(this.footA.x,this.footA.z)+.002-this.footA.y);
        }
        leg.knee.getWorldQuaternion(this.footRotation).invert();this.footB.set(0,clamp(correction,-.035,.035),0).applyQuaternion(this.footRotation);leg.foot.position.add(this.footB);
      }
      this.group.updateMatrixWorld(true);this.lantern.getWorldPosition(this.lightPosition);this.lanternLight.position.copy(this.lightPosition);
      this.lanternLight.intensity=6.5+Math.sin(t*7.7)*.18+Math.sin(t*13.1)*.10;
    }
    get stats(){let triangles=0,draws=0;this.group.traverse(o=>{if(o.isMesh){triangles+=(o.geometry.index?o.geometry.index.count:o.geometry.attributes.position.count)/3;draws++;}});return {triangles,draws};}
  }
  root.SkogCharacter=SkogCharacter;
})(globalThis);
