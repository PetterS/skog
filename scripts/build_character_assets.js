// bun scripts/build_character_assets.js BASE_GLTF ANIMATIONS_GLB
// Extracts the artist-authored head and samples locomotion in world space.
import {readFileSync,writeFileSync,copyFileSync,mkdirSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {gzipSync,gunzipSync} from 'node:zlib';
const T=require('../vendor/three.min.js');
const [basePath='assets/character/source-base.gltf',motionPath='assets/character/UAL1_Standard.glb.gz']=process.argv.slice(2);
if(!basePath||!motionPath)throw Error('Pass the Quaternius male glTF and UAL1 Standard GLB paths.');
const dir='assets/character';mkdirSync(dir,{recursive:true});
const base=JSON.parse(readFileSync(basePath)),baseBin=readFileSync(resolve(dirname(basePath),base.buffers[0].uri));
const inputMotion=readFileSync(motionPath),glb=motionPath.endsWith('.gz')?gunzipSync(inputMotion):inputMotion,jsonLength=glb.readUInt32LE(12),anim=JSON.parse(glb.subarray(20,20+jsonLength)),bin=glb.subarray(28+jsonLength);
function accessor(doc,buffer,id){
  const a=doc.accessors[id],v=doc.bufferViews[a.bufferView],sizes={SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT4:16},types={5126:Float32Array,5123:Uint16Array,5125:Uint32Array,5121:Uint8Array};
  const Type=types[a.componentType],size=sizes[a.type],step=v.byteStride||size*Type.BYTES_PER_ELEMENT,out=[];
  for(let i=0;i<a.count;i++)for(let k=0;k<size;k++){
    const offset=(v.byteOffset||0)+(a.byteOffset||0)+i*step+k*Type.BYTES_PER_ELEMENT;
    out.push(a.componentType===5126?buffer.readFloatLE(offset):a.componentType===5123?buffer.readUInt16LE(offset):a.componentType===5125?buffer.readUInt32LE(offset):buffer[offset]);
  }return out;
}
const round=x=>Number(x.toFixed(6));
const meshes=base.meshes.map((mesh,mi)=>{
  const p=mesh.primitives[0],pos=accessor(base,baseBin,p.attributes.POSITION),uv=accessor(base,baseBin,p.attributes.TEXCOORD_0),indices=accessor(base,baseBin,p.indices),out=[],tex=[],idx=[],remap=new Map();
  for(let i=0;i<indices.length;i+=3){const tri=indices.slice(i,i+3);if(mi===2&&tri.some(v=>pos[v*3+1]<1.545))continue;
    for(const v of tri){if(!remap.has(v)){
      remap.set(v,out.length/3);const x=pos[v*3],y=pos[v*3+1],z=pos[v*3+2];
      // Shorter lower face, rounder cheeks, enlarged cranium; no beard.
      const lower=Math.max(0,Math.min(1,(1.69-y)/.13));
      out.push(round(x*1.78*(1-.15*lower)),round((y-1.68)*1.52+.025*lower),round((z+.015)*1.65*(1-.12*lower)));
      tex.push(uv[v*2],uv[v*2+1]);
    }idx.push(remap.get(v));}
  }return {name:mesh.name,position:out,uv:tex.map(round),index:idx};
});
const nodes=anim.nodes.map(n=>{const o=new T.Object3D();o.name=n.name;if(n.translation)o.position.fromArray(n.translation);if(n.rotation)o.quaternion.fromArray(n.rotation);if(n.scale)o.scale.fromArray(n.scale);return o;});
anim.nodes.forEach((n,i)=>(n.children||[]).forEach(c=>nodes[i].add(nodes[c])));
const root=nodes.find(n=>n.name==='Armature'),byName=Object.fromEntries(nodes.map(n=>[n.name,n]));root.updateMatrixWorld(true);
const restQ={};for(const n of ['spine_03','Head'])restQ[n]=byName[n].getWorldQuaternion(new T.Quaternion()).invert();
const point=n=>byName[n].getWorldPosition(new T.Vector3());
const angle=(a,b)=>{const d=point(b).sub(point(a));return Math.atan2(-d.z,-d.y);};
const clips={};
for(const name of ['Idle_Loop','Walk_Loop','Jog_Fwd_Loop']){
  const a=anim.animations.find(a=>a.name===name),tracks=a.channels.map(c=>{const s=a.samplers[c.sampler];return {node:nodes[c.target.node],path:c.target.path,times:accessor(anim,bin,s.input),values:accessor(anim,bin,s.output)};});
  const duration=Math.max(...tracks.map(t=>t.times.at(-1))),frames=[];
  for(let i=0;i<64;i++){
    const time=i/64*duration;
    for(const tr of tracks){const {times,values,node,path}=tr,size=path==='rotation'?4:3;let k=0;while(k<times.length-2&&times[k+1]<time)k++;
      const u=Math.max(0,Math.min(1,(time-times[k])/(times[k+1]-times[k]||1)));
      if(path==='rotation')node.quaternion.fromArray(values,k*4).slerp(new T.Quaternion().fromArray(values,(k+1)*4),u);
      else {const v=path==='translation'?node.position:node.scale;v.fromArray(values,k*size).lerp(new T.Vector3().fromArray(values,(k+1)*size),u);}
    }root.updateMatrixWorld(true);
    const pelvis=point('pelvis'),chest=new T.Euler().setFromQuaternion(byName.spine_03.getWorldQuaternion(new T.Quaternion()).multiply(restQ.spine_03));
    const head=new T.Euler().setFromQuaternion(byName.Head.getWorldQuaternion(new T.Quaternion()).multiply(restQ.Head));
    const f=[pelvis.y,chest.x,chest.y,chest.z,head.x,head.y,head.z];
    for(const side of ['r','l']){const foot=point('foot_'+side),hip=point('thigh_'+side);f.push(foot.z-hip.z,foot.y,angle('upperarm_'+side,'lowerarm_'+side),angle('lowerarm_'+side,'hand_'+side));}
    frames.push(f.map(round));
  }
  // Align heel strikes to phase zero / PI, the same distance clock as footsteps.
  const contact=frames.reduce((best,f,i)=>f[7]>frames[best][7]?i:best,0);
  const ordered=name==='Idle_Loop'?frames:[...frames.slice(contact),...frames.slice(0,contact)];
  const floor=Math.min(...frames.flatMap(f=>[f[8],f[12]])),pelvisMean=frames.reduce((a,f)=>a+f[0],0)/64;
  for(const f of ordered){f[0]=round(f[0]-pelvisMean);f[8]=round(Math.max(0,f[8]-floor));f[12]=round(Math.max(0,f[12]-floor));}
  clips[name]={duration,frames:ordered};
}
const eyes=readFileSync(resolve(dirname(basePath),'T_Eye_Brown.png')).toString('base64');
writeFileSync(dir+'/quaternius-character.js','/* Adapted Quaternius CC0 geometry and animation. See SOURCES.txt. */\nglobalThis.SkogCharacterAssets='+JSON.stringify({meshes,clips,eyes:'data:image/png;base64,'+eyes})+';\n');
writeFileSync(dir+'/source-base.gltf',JSON.stringify(base));if(resolve(dirname(basePath),base.buffers[0].uri)!==resolve(dir,base.buffers[0].uri))copyFileSync(resolve(dirname(basePath),base.buffers[0].uri),dir+'/'+base.buffers[0].uri);
writeFileSync(dir+'/UAL1_Standard.glb.gz',gzipSync(glb));
console.log('Head triangles',meshes.map(m=>m.index.length/3),'animation frames',Object.keys(clips));
