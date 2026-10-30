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

  // A small, self-contained HDR pipeline. All effects reuse the scene's depth;
  // no second geometry pass or external shaders are needed on mobile devices.
  class RenderPipeline {
    constructor(renderer, scene, camera) {
      this.renderer = renderer; this.scene = scene; this.camera = camera;
      this.enabled = renderer.capabilities.isWebGL2 && renderer.extensions.has('EXT_color_buffer_float');
      this.stats = {calls: 0, triangles: 0, points: 0};
      if (!this.enabled) return;
      this.sceneTarget = new T.WebGLRenderTarget(1, 1, {
        type: T.HalfFloatType, minFilter: T.LinearFilter, magFilter: T.LinearFilter,
        depthBuffer: true, stencilBuffer: false,
      });
      this.sceneTarget.texture.generateMipmaps = false;
      this.sceneTarget.depthTexture = new T.DepthTexture(1, 1, T.UnsignedIntType);
      this.sceneTarget.samples = Math.min(2, renderer.capabilities.maxSamples);
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
        uniform vec2 aoTexel;
        uniform float clock;
        varying vec2 vUv;
        float random(vec2 p) { return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453); }
        void main() {
          vec3 color=texture2D(colorMap,vUv).rgb;
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
          color*=shade/weight;
          color+=texture2D(bloomMap,vUv).rgb*0.22;
          // Restrained split toning: cool forest, warm practical lantern light.
          float light=dot(color,vec3(0.2126,0.7152,0.0722));
          color*=mix(vec3(0.97,1.0,1.025),vec3(1.015,1.005,0.985),smoothstep(0.03,0.6,light));
          gl_FragColor=vec4(color,1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          gl_FragColor.rgb+=(random(gl_FragCoord.xy+fract(clock)*37.0)-0.5)/510.0;
        }`, {
        colorMap: {value: this.sceneTarget.texture}, aoMap: {value: this.aoTarget.texture},
        bloomMap: {value: this.bloomB.texture}, depthMap: {value: this.sceneTarget.depthTexture},
        aoTexel: {value: new T.Vector2()}, clock: {value: 0},
      });
      this.composite.toneMapped = true;
      renderer.info.autoReset = false;
      this.resize();
    }
    resize() {
      if (!this.enabled) return;
      const size=this.renderer.getDrawingBufferSize(new T.Vector2());
      const width=Math.max(1,size.x), height=Math.max(1,size.y);
      this.sceneTarget.setSize(width,height);
      this.aoTarget.setSize(Math.ceil(width/2),Math.ceil(height/2));
      this.bloomA.setSize(Math.ceil(width/4),Math.ceil(height/4));
      this.bloomB.setSize(Math.ceil(width/4),Math.ceil(height/4));
      this.ao.uniforms.texel.value.set(1/width,1/height);
      this.composite.uniforms.aoTexel.value.set(2/width,2/height);
    }
    draw(material, target) {
      this.quad.material=material; this.renderer.setRenderTarget(target);
      this.renderer.render(this.screen,this.screenCamera);
    }
    render(time) {
      const r=this.renderer;
      if(!this.enabled){r.info.reset();r.render(this.scene,this.camera);Object.assign(this.stats,r.info.render);return;}
      r.info.reset();
      r.setRenderTarget(this.sceneTarget); r.render(this.scene,this.camera);
      this.ao.uniforms.focalLength.value=this.camera.projectionMatrix.elements[5]*0.5;
      this.draw(this.ao,this.aoTarget);
      this.bloom.uniforms.source.value=this.sceneTarget.texture;
      this.bloom.uniforms.direction.value.set(1/this.bloomA.width,0);
      this.bloom.uniforms.threshold.value=1.05;
      this.draw(this.bloom,this.bloomA);
      this.bloom.uniforms.source.value=this.bloomA.texture;
      this.bloom.uniforms.direction.value.set(0,1/this.bloomB.height);
      this.bloom.uniforms.threshold.value=0;
      this.draw(this.bloom,this.bloomB);
      this.composite.uniforms.clock.value=time;
      this.draw(this.composite,null);
      Object.assign(this.stats,r.info.render);
    }
  }
  root.SkogRenderPipeline=RenderPipeline;
})(globalThis);
