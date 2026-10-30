(function (root) {
  'use strict';
  const T = THREE;
  const vertex = `varying vec2 vUv;
    void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
  function pass(fragmentShader, uniforms = {}) {
    return new T.ShaderMaterial({
      vertexShader: vertex, fragmentShader, uniforms,
      depthTest: false, depthWrite: false, toneMapped: false,
    });
  }
  function target(width, height, type = T.UnsignedByteType) {
    const result = new T.WebGLRenderTarget(width, height, {
      type, minFilter: T.LinearFilter, magFilter: T.LinearFilter,
      depthBuffer: false, stencilBuffer: false,
    });
    result.texture.generateMipmaps = false;
    return result;
  }

  // HDR postprocessing with a bounded supersampled region around the character.
  class RenderPipeline {
    constructor(renderer, scene, camera, subject = null) {
      this.renderer = renderer; this.scene = scene; this.camera = camera;
      this.subject = subject;
      this.enabled = renderer.capabilities.isWebGL2 && renderer.extensions.has('EXT_color_buffer_float');
      this.stats = {calls: 0, triangles: 0, points: 0};
      this.detailStats = {calls:0,triangles:0,pixels:0};
      this.shadowStats = {calls:0,triangles:0};
      const shadowMap=renderer.shadowMap,renderShadows=shadowMap.render;
      shadowMap.render=(...args)=>{
        const calls=renderer.info.render.calls,triangles=renderer.info.render.triangles;
        renderShadows.apply(shadowMap,args);
        this.shadowStats.calls+=renderer.info.render.calls-calls;
        this.shadowStats.triangles+=renderer.info.render.triangles-triangles;
      };
      if (!this.enabled) return;
      this.sceneTarget = new T.WebGLRenderTarget(1, 1, {
        type: T.HalfFloatType, minFilter: T.LinearFilter, magFilter: T.LinearFilter,
        depthBuffer: true, stencilBuffer: false,
      });
      this.sceneTarget.texture.generateMipmaps = false;
      this.sceneTarget.depthTexture = new T.DepthTexture(1, 1, T.UnsignedIntType);
      this.sceneTarget.samples = Math.min(4, renderer.capabilities.maxSamples);
      // Bright, narrow bevels alias within triangles, where MSAA cannot help.
      // Supersample a cropped view of the character and its surroundings. The
      // whole scene is present in that crop, preserving foliage occlusion/fog.
      this.detailEnabled = true;
      this.detailTarget = new T.WebGLRenderTarget(1,1,{
        type:T.HalfFloatType,minFilter:T.NearestFilter,magFilter:T.NearestFilter,
        depthBuffer:true,stencilBuffer:false,
      });
      this.detailTarget.texture.generateMipmaps=false;
      this.detailRect = new T.Vector4();this.detailStep = new T.Vector2();
      this.detailUvScale = new T.Vector2();
      this.detailPoint = new T.Vector3();
      this.fullProjection = new T.Matrix4();this.fullInverseProjection = new T.Matrix4();
      // Resolve geometric edges before lighting bloom, then filter remaining
      // subpixel edges in display colour space. Canvas MSAA alone does not
      // antialias the offscreen HDR render target.
      this.antialiasEnabled = true;
      this.displayTarget = target(1, 1);
      this.antialiasTarget = target(1, 1);
      this.antialias = pass(SkogFXAAShader.fragmentShader, {
        tDiffuse: {value: this.displayTarget.texture}, resolution: {value: new T.Vector2()},
      });
      // Stabilize the resolved MSAA/FXAA colour across frames. Filtering before
      // accumulation also catches bright seams that change FXAA's edge direction.
      // Depth rejection and neighbourhood clipping keep moving silhouettes fresh.
      this.temporalEnabled = true;this.historyValid = false;
      this.history = [target(1,1,T.HalfFloatType),target(1,1,T.HalfFloatType)];
      this.historyIndex = 0;this.previousViewProjection = new T.Matrix4();
      this.viewProjection = new T.Matrix4();this.inverseViewProjection = new T.Matrix4();
      this.previousProjection = new T.Matrix4();
      this.previousPosition = new T.Vector3();this.previousRotation = new T.Quaternion();
      this.present = pass(`uniform sampler2D source; varying vec2 vUv;
        void main(){gl_FragColor=vec4(texture2D(source,vUv).rgb,1.0);}`,{source:{value:null}});
      this.temporal = pass(`
        precision highp float;
        uniform sampler2D currentMap, historyMap, depthMap;
        uniform mat4 inverseViewProjection, previousViewProjection, inverseProjection;
        uniform vec2 texel;
        uniform float historyWeight;
        varying vec2 vUv;
        void main(){
          vec2 uv=vUv;
          vec3 current=texture2D(currentMap,uv).rgb;
          float depth=texture2D(depthMap,uv).r;
          vec4 clip=vec4(uv*2.0-1.0,depth*2.0-1.0,1.0);
          vec4 view=inverseProjection*clip;
          float viewDepth=-view.z/view.w;
          if(historyWeight<=0.0){gl_FragColor=vec4(current,viewDepth);return;}
          vec4 world=inverseViewProjection*clip;world/=world.w;
          vec4 previous=previousViewProjection*world;
          if(previous.w<=0.0001){gl_FragColor=vec4(current,viewDepth);return;}
          vec2 oldUV=previous.xy/previous.w*.5+.5;
          vec4 history=texture2D(historyMap,clamp(oldUV,texel*.5,vec2(1.0)-texel*.5));
          float weight=historyWeight;
          // Reject exposed background and camera cuts, instead of dragging
          // old silhouettes through new frames. Alpha stores linear depth.
          if(any(lessThan(oldUV,vec2(0.0))) || any(greaterThan(oldUV,vec2(1.0))) ||
             abs(history.a-previous.w)>max(.035,previous.w*.015))weight=0.0;
          vec3 lo=current,hi=current,mean=vec3(0.0),square=vec3(0.0);
          for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){
            vec3 c=texture2D(currentMap,clamp(uv+vec2(float(x),float(y))*texel,texel*.5,vec2(1.0)-texel*.5)).rgb;
            lo=min(lo,c);hi=max(hi,c);mean+=c;square+=c*c;
          }
          mean/=9.0;vec3 sigma=sqrt(max(square/9.0-mean*mean,vec3(0.0)));
          history.rgb=clamp(history.rgb,max(lo,mean-sigma*1.25),min(hi,mean+sigma*1.25));
          float motion=length((oldUV-vUv)/texel);
          weight*=mix(1.0,.68,smoothstep(.5,12.0,motion));
          gl_FragColor=vec4(mix(current,history.rgb,weight),viewDepth);
        }`,{
        currentMap:{value:this.antialiasTarget.texture},historyMap:{value:null},depthMap:{value:this.sceneTarget.depthTexture},
        inverseViewProjection:{value:this.inverseViewProjection},previousViewProjection:{value:this.previousViewProjection},
        inverseProjection:{value:camera.projectionMatrixInverse},texel:{value:new T.Vector2()},historyWeight:{value:0},
      });
      // Participating media: low rolling mist and thin air, lit by the moon and
      // the lantern. Both lights' shadow maps carve shafts out of the haze, so
      // trunks between the child and the dark throw visible volumes.
      this.volumeEnabled = true;this.atmosphere = null;
      this.volumeHistory = [target(1,1,T.HalfFloatType),target(1,1,T.HalfFloatType)];this.volumeIndex=0;
      this.volume = pass(`
        precision highp float;
        #include <packing>
        uniform sampler2D depthMap, moonShadow, lanternShadow, volumeHistory;
        uniform mat4 inverseViewProjection, moonMatrix, previousViewProjection;
        uniform vec3 eye, lanternPosition, lanternColor, moonDirection, moonColor, ambientColor;
        uniform vec2 lanternShadowRange, lanternShadowTexel;
        uniform float time, frame, hasMoonShadow, hasLanternShadow, lanternRange, historyWeight, mistAmount;
        varying vec2 vUv;
        float ground(vec2 p){return sin(p.x*.059)*1.5+cos(p.y*.071)*1.1+sin(p.x*.17+p.y*.093)*.42+cos(p.x*.31-p.y*.21)*.12;}
        float hash(vec3 p){p=fract(p*.3183099+.1);p*=17.0;return fract(p.x*p.y*p.z*(p.x+p.y+p.z));}
        float noise(vec3 x){
          vec3 i=floor(x),f=fract(x);f=f*f*(3.0-2.0*f);
          return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
                     mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);
        }
        float density(vec3 p){
          float h=p.y-ground(p.xz);
          vec3 q=p*vec3(.13,.42,.13)+vec3(time*.045,-time*.01,time*.028);
          float n=noise(q)*.62+noise(q*2.7+vec3(3.1,1.7,.4))*.38;
          float mist=exp(-max(h,0.0)/1.15)*smoothstep(.32,.78,n);
          float drift=smoothstep(.45,.8,noise(p*.045+vec3(time*.012,0.0,0.0)));
          return .006+.008*drift+mist*mistAmount;
        }
        vec2 cubeToUV(vec3 v,float texelSizeY){
          vec3 absV=abs(v);float scaleToCube=1.0/max(absV.x,max(absV.y,absV.z));
          absV*=scaleToCube;v*=scaleToCube*(1.0-2.0*texelSizeY);vec2 planar=v.xy;
          float almostOne=1.0-1.5*texelSizeY;
          if(absV.z>=almostOne){if(v.z>0.0)planar.x=4.0-v.x;}
          else if(absV.x>=almostOne){float s=sign(v.x);planar.x=v.z*s+2.0*s;}
          else if(absV.y>=almostOne){float s=sign(v.y);planar.x=v.x+2.0*s+2.0;planar.y=v.z*s-2.0;}
          return vec2(.125,.25)*planar+vec2(.375,.75);
        }
        float phase(float c,float g){float g2=g*g;return (1.0-g2)/(12.566*pow(1.0+g2-2.0*g*c,1.5));}
        void main(){
          float depth=texture2D(depthMap,vUv).r;
          vec4 world=inverseViewProjection*vec4(vUv*2.0-1.0,depth*2.0-1.0,1.0);world/=world.w;
          vec3 ray=world.xyz-eye;float sceneDistance=length(ray);ray/=sceneDistance;
          float far=min(sceneDistance,42.0);
          const int STEPS=14;float stepLength=far/float(STEPS);
          float jitter=fract(52.9829189*fract(dot(gl_FragCoord.xy+frame*vec2(5.588,3.123),vec2(.06711056,.00583715))));
          vec3 scatter=vec3(0.0);float transmittance=1.0;
          float moonPhase=phase(dot(ray,-moonDirection),.55)*6.0+.35;
          for(int i=0;i<STEPS;i++){
            float t=(float(i)+jitter)*stepLength;vec3 p=eye+ray*t;
            float sigma=density(p);
            float moonLit=.18;
            if(hasMoonShadow>.5){
              vec4 c=moonMatrix*vec4(p,1.0);c.xyz/=c.w;
              if(all(greaterThan(c.xy,vec2(0.0)))&&all(lessThan(c.xy,vec2(1.0))))moonLit=step(c.z,unpackRGBAToDepth(texture2D(moonShadow,c.xy))+.0005);
            }
            vec3 toLight=p-lanternPosition;float d=length(toLight);
            float window=clamp(1.0-pow(d/lanternRange,4.0),0.0,1.0);
            float lantern=window*window/max(pow(d,1.25),.09);
            if(hasLanternShadow>.5&&lantern>.0005){
              float dp=(d-lanternShadowRange.x)/(lanternShadowRange.y-lanternShadowRange.x)-.003;
              lantern*=step(dp,unpackRGBAToDepth(texture2D(lanternShadow,cubeToUV(toLight/d,lanternShadowTexel.y))));
            }
            vec3 light=ambientColor+moonColor*moonLit*moonPhase+lanternColor*lantern*phase(dot(toLight/max(d,.001),-ray),.28)*12.566;
            float absorb=exp(-sigma*stepLength);
            scatter+=transmittance*light*(1.0-absorb);transmittance*=absorb;
          }
          // Temporal reprojection hides the per-pixel ray jitter.
          vec4 current=vec4(scatter,transmittance);
          if(historyWeight>0.0){
            vec4 previous=previousViewProjection*vec4(world.xyz,1.0);
            vec2 oldUV=previous.xy/previous.w*.5+.5;
            if(previous.w>0.0&&all(greaterThan(oldUV,vec2(0.0)))&&all(lessThan(oldUV,vec2(1.0)))){
              vec4 history=texture2D(volumeHistory,oldUV);
              current=mix(current,history,historyWeight*step(abs(history.a-current.a),.25));
            }
          }
          gl_FragColor=current;
        }`,{
        depthMap:{value:this.sceneTarget.depthTexture},moonShadow:{value:null},lanternShadow:{value:null},volumeHistory:{value:null},
        inverseViewProjection:{value:new T.Matrix4()},previousViewProjection:{value:new T.Matrix4()},moonMatrix:{value:new T.Matrix4()},
        eye:{value:new T.Vector3()},lanternPosition:{value:new T.Vector3()},lanternColor:{value:new T.Color()},
        moonDirection:{value:new T.Vector3(0,1,0)},moonColor:{value:new T.Color()},ambientColor:{value:new T.Color()},
        lanternShadowRange:{value:new T.Vector2(.03,26)},lanternShadowTexel:{value:new T.Vector2()},
        time:{value:0},frame:{value:0},hasMoonShadow:{value:0},hasLanternShadow:{value:0},lanternRange:{value:26},historyWeight:{value:0},mistAmount:{value:.085},
      });
      this.volumeViewProjection=new T.Matrix4();this.volumePrevious=new T.Matrix4();this.volumeValid=false;this.volumeFrame=0;
      this.aoTarget = target(1, 1);
      this.bloomA = target(1, 1, T.HalfFloatType);
      this.bloomB = target(1, 1, T.HalfFloatType);
      this.screen = new T.Scene(); this.screenCamera = new T.Camera();
      this.quad = new T.Mesh(new T.PlaneGeometry(2, 2));
      this.quad.frustumCulled = false; this.screen.add(this.quad);

      this.ao = pass(`
        precision highp float;
        uniform sampler2D depthMap;
        uniform mat4 inverseProjection;
        uniform vec2 texel;
        uniform float focalLength;
        varying vec2 vUv;
        vec3 positionAt(vec2 uv) {
          float depth = texture2D(depthMap, uv).r;
          vec4 p = inverseProjection * vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
          return p.xyz / p.w;
        }
        void main() {
          float depth = texture2D(depthMap, vUv).r;
          if (depth > 0.99998) { gl_FragColor = vec4(1.0); return; }
          vec3 p = positionAt(vUv);
          vec3 left = positionAt(vUv - vec2(texel.x, 0.0));
          vec3 right = positionAt(vUv + vec2(texel.x, 0.0));
          vec3 down = positionAt(vUv - vec2(0.0, texel.y));
          vec3 top = positionAt(vUv + vec2(0.0, texel.y));
          vec3 dx = abs(left.z-p.z) < abs(right.z-p.z) ? p-left : right-p;
          vec3 dy = abs(down.z-p.z) < abs(top.z-p.z) ? p-down : top-p;
          vec3 normal = normalize(cross(dx, dy));
          float radius = clamp(0.62 * focalLength / max(-p.z, 0.1), 0.001, 0.12);
          float occlusion = 0.0;
          for (int i=0; i<12; i++) {
            float index = float(i) + 0.5;
            float angle = index * 2.399963;
            float r = sqrt(index/12.0);
            vec2 offset = vec2(cos(angle)*texel.x/texel.y, sin(angle))*radius*r;
            vec3 delta = positionAt(clamp(vUv+offset, vec2(0.001), vec2(0.999)))-p;
            float distance = length(delta);
            float angular = max(dot(normal,delta)/max(distance,0.001)-0.12, 0.0);
            occlusion += angular * (1.0-smoothstep(0.05,1.25,distance));
          }
          float fade = 1.0-smoothstep(15.0,42.0,-p.z);
          float shade = 1.0-clamp(occlusion/12.0*1.7,0.0,0.38)*fade;
          gl_FragColor=vec4(vec3(shade),1.0);
        }`, {
        depthMap: {value: this.sceneTarget.depthTexture},
        inverseProjection: {value: camera.projectionMatrixInverse},
        texel: {value: new T.Vector2()}, focalLength: {value: 1},
      });
      this.bloom = pass(`
        precision highp float;
        uniform sampler2D source;
        uniform vec2 direction;
        uniform float threshold;
        varying vec2 vUv;
        vec3 bright(vec2 uv) {
          vec3 c=texture2D(source,uv).rgb;
          float luminance=max(c.r,max(c.g,c.b));
          return c*max(luminance-threshold,0.0)/max(luminance,0.0001);
        }
        void main() {
          vec3 c=bright(vUv)*0.227027;
          c+=(bright(vUv+direction*1.384615)+bright(vUv-direction*1.384615))*0.316216;
          c+=(bright(vUv+direction*3.230769)+bright(vUv-direction*3.230769))*0.070270;
          gl_FragColor=vec4(c,1.0);
        }`, {source: {value: null}, direction: {value: new T.Vector2()}, threshold: {value: 1.05}});
      this.composite = pass(`
        precision highp float;
        uniform sampler2D colorMap;
        uniform sampler2D aoMap;
        uniform sampler2D bloomMap;
        uniform sampler2D depthMap;
        uniform sampler2D detailMap;
        uniform sampler2D volumeMap;
        uniform float volumeOn;
        uniform vec2 volumeTexel, clipRange;
        uniform vec2 aspect;
        uniform vec4 detailRect;
        uniform vec2 detailStep;
        uniform vec2 detailUvScale;
        uniform float detailSamples;
        uniform vec2 aoTexel;
        uniform float clock;
        #include <tonemapping_pars_fragment>
        varying vec2 vUv;
        float random(vec2 p) { return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453); }
        vec4 fog;
        float linearDepth(vec2 uv){float z=texture2D(depthMap,uv).r*2.0-1.0;return 2.0*clipRange.x*clipRange.y/(clipRange.y+clipRange.x-z*(clipRange.y-clipRange.x));}
        // Joint bilateral upsampling: half-resolution haze must not bleed
        // across the child's silhouette or along trunk edges.
        vec4 sampleVolume(vec2 uv){
          vec2 base=floor(uv/volumeTexel-.5);vec2 f=uv/volumeTexel-.5-base;
          float center=linearDepth(uv);vec4 sum=vec4(0.0);float total=0.0;
          for(int y=0;y<2;y++)for(int x=0;x<2;x++){
            vec2 tuv=(base+vec2(float(x),float(y))+.5)*volumeTexel;
            float w=(x==0?1.0-f.x:f.x)*(y==0?1.0-f.y:f.y);
            w*=1.0/(.0001+abs(linearDepth(tuv)-center)/max(center,.1)*40.0);
            sum+=texture2D(volumeMap,tuv)*w;total+=w;
          }
          return sum/max(total,1e-5);
        }
        vec3 grade(vec3 color,float shade,vec3 bloom){
          color=(color*shade)*fog.a+fog.rgb+bloom*.3;
          // Night grade: cold, desaturated shadows; firelight keeps its warmth.
          float light=dot(color,vec3(0.2126,0.7152,0.0722));
          float warmth=clamp((color.r-color.b)/max(light,.0005)*.5,0.0,1.0);
          float night=1.0-smoothstep(.002,.09,light);
          color=mix(color,vec3(light)*vec3(.82,.98,1.18),night*(1.0-warmth)*.55);
          color=max(color-vec3(.0007,.0005,.0002),0.0);
          return sRGBTransferOETF(vec4(ACESFilmicToneMapping(color),1.0)).rgb;
        }
        void main() {
          vec2 centered=(vUv-.5)*aspect;float radial=dot(centered,centered);
          // Faint lens fringing toward the edges of an otherwise clean frame.
          vec2 fringe=(vUv-.5)*radial*.0035;
          vec3 color=vec3(texture2D(colorMap,vUv+fringe).r,texture2D(colorMap,vUv).g,texture2D(colorMap,vUv-fringe).b);
          fog=volumeOn>.5?sampleVolume(vUv):vec4(0.0,0.0,0.0,1.0);
          // Small bilateral AO resolve prevents silhouettes acquiring dark rims.
          float depth=texture2D(depthMap,vUv).r;
          float weight=1.0;
          float shade=texture2D(aoMap,vUv).r;
          for(int i=0;i<4;i++) {
            float angle=float(i)*1.570796;
            vec2 uv=vUv+vec2(cos(angle),sin(angle))*aoTexel;
            float d=texture2D(depthMap,uv).r;
            float w=exp(-abs(d-depth)*18000.0);
            shade+=texture2D(aoMap,uv).r*w; weight+=w;
          }
          vec3 bloom=texture2D(bloomMap,vUv).rgb;
          color=grade(color,shade/weight,bloom);
          if(detailRect.z>0.0 && all(greaterThan(vUv,detailRect.xy)) && all(lessThan(vUv,detailRect.xy+detailRect.zw))){
            vec2 uv=(vUv-detailRect.xy)/detailRect.zw;
            vec3 detail=vec3(0.0);
            // Resolve after tone mapping: a tiny, very bright lantern-lit
            // bevel must not saturate an entire pixel before averaging.
            for(int y=0;y<4;y++)for(int x=0;x<4;x++){
              if(float(x)>=detailSamples||float(y)>=detailSamples)continue;
              vec2 offset=((vec2(float(x),float(y))+.5)/detailSamples-.5)*detailStep;
              detail+=grade(texture2D(detailMap,(uv+offset)*detailUvScale).rgb,shade/weight,bloom);
            }
            vec2 edge=min(uv,1.0-uv)/detailStep;
            color=mix(color,detail/(detailSamples*detailSamples),smoothstep(0.0,8.0,min(edge.x,edge.y)));
          }
          color*=mix(1.0,.2,smoothstep(.12,.95,radial));
          // Luminance-weighted film grain, strongest in the deep shadows.
          float grain=random(gl_FragCoord.xy+fract(clock)*37.0)-0.5;
          color+=grain*mix(.032,.012,smoothstep(0.0,.35,dot(color,vec3(.333))));
          gl_FragColor=vec4(max(color,0.0),1.0);
        }`, {
        colorMap: {value: this.sceneTarget.texture}, aoMap: {value: this.aoTarget.texture},
        bloomMap: {value: this.bloomB.texture}, depthMap: {value: this.sceneTarget.depthTexture},
        detailMap:{value:this.detailTarget.texture},detailRect:{value:this.detailRect},detailStep:{value:this.detailStep},
        detailUvScale:{value:this.detailUvScale},detailSamples:{value:3},
        volumeMap:{value:null},volumeOn:{value:0},volumeTexel:{value:new T.Vector2()},clipRange:{value:new T.Vector2(.1,180)},aspect:{value:new T.Vector2(1,1)},
        aoTexel: {value: new T.Vector2()}, clock: {value: 0}, toneMappingExposure: {value: renderer.toneMappingExposure},
      });

      renderer.info.autoReset = false;
      this.resize();
    }
    resize() {
      if (!this.enabled) return;
      const size=this.renderer.getDrawingBufferSize(new T.Vector2());
      const width=Math.max(1,size.x), height=Math.max(1,size.y);
      this.sceneTarget.setSize(width,height);
      this.displayTarget.setSize(width,height);
      this.antialiasTarget.setSize(width,height);
      this.history.forEach(t=>t.setSize(width,height));this.historyValid=false;
      this.temporal.uniforms.texel.value.set(1/width,1/height);
      this.antialias.uniforms.resolution.value.set(1/width,1/height);
      this.aoTarget.setSize(Math.ceil(width/2),Math.ceil(height/2));
      // Mist is low frequency; half resolution keeps phones affordable.
      const vw=Math.ceil(width/2),vh=Math.ceil(height/2);
      this.volumeHistory.forEach(t=>t.setSize(vw,vh));this.volumeValid=false;
      this.composite.uniforms.volumeTexel.value.set(1/vw,1/vh);
      this.composite.uniforms.aspect.value.set(width>height?width/height:1,width>height?1:height/width);
      this.bloomA.setSize(Math.ceil(width/4),Math.ceil(height/4));
      this.bloomB.setSize(Math.ceil(width/4),Math.ceil(height/4));
      this.ao.uniforms.texel.value.set(1/width,1/height);
      this.composite.uniforms.aoTexel.value.set(2/width,2/height);
    }
    draw(material, target) {
      this.quad.material=material; this.renderer.setRenderTarget(target);
      this.renderer.render(this.screen,this.screenCamera);
    }
    renderDetail() {
      const r=this.renderer,c=this.camera,s=this.subject;
      this.detailRect.set(0,0,0,0);
      if(!this.detailEnabled||!s?.visible)return;
      const w=this.sceneTarget.width,h=this.sceneTarget.height;
      let left=w,top=h,right=0,bottom=0;
      // Round bounds cover the animated limbs, hat and carried lamp without
      // inflating the close-camera crop with empty bounding-box corners.
      for(const y of [-.15,1.65])for(let i=0;i<16;i++){
        const angle=i*Math.PI/8;
        const p=this.detailPoint.set(Math.sin(angle)*.7,y,Math.cos(angle)*.7).applyMatrix4(s.matrixWorld).project(c);
        if(p.z<=-1)return;
        const px=(p.x*.5+.5)*w,py=(.5-p.y*.5)*h;
        left=Math.min(left,px);right=Math.max(right,px);top=Math.min(top,py);bottom=Math.max(bottom,py);
      }
      left=Math.max(0,Math.floor(left)-12);top=Math.max(0,Math.floor(top)-12);
      right=Math.min(w,Math.ceil(right)+12);bottom=Math.min(h,Math.ceil(bottom)+12);
      const width=right-left,height=bottom-top;
      if(width<=0||height<=0)return;
      // Bound memory/fill cost on phones and during close camera collisions.
      const scale=Math.min(4,Math.floor(Math.sqrt(1250000/(width*height))));
      if(scale<2)return;
      if(width*height*scale*scale>1250000)return;
      const sampleWidth=width*scale,sampleHeight=height*scale;
      const neededWidth=Math.ceil(sampleWidth/32)*32,neededHeight=Math.ceil(sampleHeight/32)*32;
      const allocatedWidth=Math.max(neededWidth,this.detailTarget.width),allocatedHeight=Math.max(neededHeight,this.detailTarget.height);
      // Retain usable allocation while orbiting, rather than reallocating as
      // the crop grows and shrinks by a few pixels. Keep the combined cap too.
      if(allocatedWidth*allocatedHeight<=1350000)this.detailTarget.setSize(allocatedWidth,allocatedHeight);
      else this.detailTarget.setSize(neededWidth,neededHeight);
      this.detailTarget.viewport.set(0,0,sampleWidth,sampleHeight);
      this.detailTarget.scissor.set(0,0,sampleWidth,sampleHeight);this.detailTarget.scissorTest=true;
      const view=c.view?{...c.view}:null,aspect=c.aspect,shadowAuto=r.shadowMap.autoUpdate;
      const calls=r.info.render.calls,triangles=r.info.render.triangles;
      this.fullProjection.copy(c.projectionMatrix);this.fullInverseProjection.copy(c.projectionMatrixInverse);
      try{
        c.setViewOffset(w,h,left,top,width,height);
        r.shadowMap.autoUpdate=false;
        r.setRenderTarget(this.detailTarget);r.render(this.scene,c);
      }finally{
        c.view=view;c.aspect=aspect;
        c.projectionMatrix.copy(this.fullProjection);c.projectionMatrixInverse.copy(this.fullInverseProjection);
        r.shadowMap.autoUpdate=shadowAuto;
      }
      this.detailRect.set(left/w,(h-bottom)/h,width/w,height/h);
      this.detailStep.set(1/width,1/height);
      this.detailUvScale.set(sampleWidth/this.detailTarget.width,sampleHeight/this.detailTarget.height);
      this.composite.uniforms.detailSamples.value=scale;
      this.detailStats.calls=r.info.render.calls-calls;
      this.detailStats.triangles=r.info.render.triangles-triangles;
      this.detailStats.pixels=this.detailTarget.width*this.detailTarget.height;
    }
    // Lights are supplied by the forest: {moon, lantern, ambient, mist}.
    renderVolume(time) {
      const a=this.atmosphere,u=this.volume.uniforms,c=this.camera;
      this.composite.uniforms.volumeOn.value=0;
      if(!this.volumeEnabled||!a)return;
      c.updateMatrixWorld();
      this.volumeViewProjection.multiplyMatrices(c.projectionMatrix,c.matrixWorldInverse);
      u.inverseViewProjection.value.multiplyMatrices(c.matrixWorld,c.projectionMatrixInverse);
      u.eye.value.setFromMatrixPosition(c.matrixWorld);
      const moon=a.moon,lantern=a.lantern;
      u.moonDirection.value.subVectors(moon.position,moon.target.position).normalize();
      u.moonColor.value.copy(moon.color).multiplyScalar(moon.intensity*a.moonScatter);
      u.ambientColor.value.copy(a.ambient);
      u.hasMoonShadow.value=moon.shadow.map?1:0;
      if(moon.shadow.map){u.moonShadow.value=moon.shadow.map.texture;u.moonMatrix.value.copy(moon.shadow.matrix);}
      u.lanternPosition.value.copy(lantern.position);
      u.lanternColor.value.copy(lantern.color).multiplyScalar(lantern.intensity*a.lanternScatter);
      u.lanternRange.value=lantern.distance||26;
      const ls=lantern.shadow,usable=ls.map&&lantern.intensity>.01;
      u.hasLanternShadow.value=usable?1:0;
      if(usable){u.lanternShadow.value=ls.map.texture;u.lanternShadowRange.value.set(ls.camera.near,ls.camera.far);u.lanternShadowTexel.value.set(1/(ls.mapSize.x*4),1/(ls.mapSize.y*2));}
      u.mistAmount.value=a.mist;u.time.value=time;u.frame.value=this.volumeFrame=(this.volumeFrame+1)%64;
      const moved=!this.volumeValid||this.previousVolumeCamera?.distanceToSquared(u.eye.value)>1;
      u.historyWeight.value=moved?0:.82;
      u.previousViewProjection.value.copy(this.volumePrevious);
      u.volumeHistory.value=this.volumeHistory[this.volumeIndex].texture;
      const output=this.volumeHistory[1-this.volumeIndex];
      this.draw(this.volume,output);
      this.volumeIndex=1-this.volumeIndex;this.volumeValid=true;
      this.previousVolumeCamera=(this.previousVolumeCamera||new T.Vector3()).copy(u.eye.value);
      this.volumePrevious.copy(this.volumeViewProjection);
      this.composite.uniforms.volumeMap.value=output.texture;this.composite.uniforms.clipRange.value.set(c.near,c.far);this.composite.uniforms.volumeOn.value=1;
    }
    render(time,motionSpeed=0) {
      const r=this.renderer,c=this.camera;
      this.shadowStats.calls=0;this.shadowStats.triangles=0;
      this.detailStats.calls=0;this.detailStats.triangles=0;this.detailStats.pixels=0;
      const temporal=this.enabled&&this.antialiasEnabled&&this.temporalEnabled;
      if(temporal){
        c.updateMatrixWorld();
        // Never reuse history across camera cuts, zoom changes or a resize.
        if(this.previousPosition.distanceToSquared(c.position)>1 ||
           this.previousRotation.angleTo(c.quaternion)>.35 ||
           !this.previousProjection.equals(c.projectionMatrix))this.historyValid=false;
        this.viewProjection.multiplyMatrices(c.projectionMatrix,c.matrixWorldInverse);
        this.inverseViewProjection.multiplyMatrices(c.matrixWorld,c.projectionMatrixInverse);
      }else this.historyValid=false;
      if(!this.enabled){r.info.reset();r.render(this.scene,this.camera);Object.assign(this.stats,r.info.render);return;}
      r.info.reset();
      r.setRenderTarget(this.sceneTarget); r.render(this.scene,this.camera);
      this.renderDetail();
      this.ao.uniforms.focalLength.value=this.camera.projectionMatrix.elements[5]*0.5;
      this.draw(this.ao,this.aoTarget);
      this.renderVolume(time);
      this.bloom.uniforms.source.value=this.sceneTarget.texture;
      this.bloom.uniforms.direction.value.set(1/this.bloomA.width,0);
      this.bloom.uniforms.threshold.value=1.05;
      this.draw(this.bloom,this.bloomA);
      this.bloom.uniforms.source.value=this.bloomA.texture;
      this.bloom.uniforms.direction.value.set(0,1/this.bloomB.height);
      this.bloom.uniforms.threshold.value=0;
      this.draw(this.bloom,this.bloomB);
      this.composite.uniforms.clock.value=time;
      this.composite.uniforms.toneMappingExposure.value=r.toneMappingExposure;
      this.draw(this.composite,this.antialiasEnabled?this.displayTarget:null);
      this.antialias.uniforms.tDiffuse.value=this.displayTarget.texture;
      if(temporal){
        this.draw(this.antialias,this.antialiasTarget);
        const output=this.history[1-this.historyIndex];
        this.temporal.uniforms.historyMap.value=this.history[this.historyIndex].texture;
        this.temporal.uniforms.historyWeight.value=this.historyValid?(motionSpeed>.15?.65:.88):0;
        this.draw(this.temporal,output);
        this.present.uniforms.source.value=output.texture;this.draw(this.present,null);
        this.historyIndex=1-this.historyIndex;this.historyValid=true;
        this.previousViewProjection.copy(this.viewProjection);
        this.previousProjection.copy(c.projectionMatrix);
        this.previousPosition.copy(c.position);this.previousRotation.copy(c.quaternion);
      }else if(this.antialiasEnabled)this.draw(this.antialias,null);
      Object.assign(this.stats,r.info.render);
    }
  }
  root.SkogRenderPipeline=RenderPipeline;
})(globalThis);
