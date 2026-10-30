# /// script
# requires-python = ">=3.11, <3.14"
# dependencies = ["playwright==1.63.0"]
# ///
"""Offline, native-input QA in background tabs of the existing headed Chrome."""
from pathlib import Path
import sys
import time
from playwright.sync_api import sync_playwright

URL = (Path(__file__).resolve().parents[1] / "index.html").as_uri()


def open_game(browser, width, height, touch=False):
    context = browser.contexts[0]
    control = browser.new_browser_cdp_session()
    target = control.send("Target.createTarget", {
        "url": "about:blank", "background": True, "newWindow": False,
    })["targetId"]
    page = cdp = None
    try:
        deadline = time.monotonic() + 5
        while page is None and time.monotonic() < deadline:
            for candidate in context.pages:
                session = context.new_cdp_session(candidate)
                if session.send("Target.getTargetInfo")["targetInfo"]["targetId"] == target:
                    page, cdp = candidate, session
                    break
                session.detach()
            if page is None:
                time.sleep(.02)
        assert page, "Could not attach to our background tab"
        page.set_viewport_size({"width": width, "height": height})
        cdp.send("Emulation.setFocusEmulationEnabled", {"enabled": True})
        cdp.send("Emulation.setDeviceMetricsOverride", {
            "width": width, "height": height, "deviceScaleFactor": 1, "mobile": touch,
        })
        cdp.send("Emulation.setTouchEmulationEnabled", {"enabled": touch, "maxTouchPoints": 5})
        cdp.send("Network.enable")
        cdp.send("Network.emulateNetworkConditions", {
            "offline": True, "latency": 0, "downloadThroughput": -1, "uploadThroughput": -1,
        })
        # Isolate preference writes. The test also exercises unavailable storage.
        # Covered windows can suspend RAF; only this tab uses a timer clock.
        page.add_init_script("""(() => {
          Object.defineProperty(window,'localStorage',{get(){throw Error('Test: storage disabled')}});
          window.requestAnimationFrame=fn=>setTimeout(()=>fn(performance.now()),16);
          window.cancelAnimationFrame=id=>clearTimeout(id);
        })()""")
        errors, requests = [], []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.on("console", lambda message: errors.append(message.text) if (message.type == "error" or "GL_INVALID_" in message.text or "WebGL: INVALID_" in message.text) and message.text not in errors else None)
        page.on("request", lambda req: requests.append(req.url) if req.url.startswith("http") else None)
        page.goto(URL, wait_until="domcontentloaded")
        page.wait_for_function("window.Skog && Skog.state.frames>3")
        page.evaluate("async()=>{if(Skog.forest.environment)await Skog.forest.environment.assetsReady;}")
        return page, cdp, errors, requests
    except BaseException:
        if "errors" in locals() and errors: print("Browser errors:",[e[:2500] for e in errors[:3]],flush=True)
        control.send("Target.closeTarget", {"targetId": target})
        raise
    finally:
        control.detach()


def point(x, y, ident=1):
    return {"x": x, "y": y, "id": ident, "radiusX": 5, "radiusY": 5}


def touch(cdp, kind, points):
    cdp.send("Input.dispatchTouchEvent", {"type": kind, "touchPoints": points})


def tap(page, cdp, selector):
    r = page.locator(selector).bounding_box()
    touch(cdp, "touchStart", [point(r["x"] + r["width"] / 2, r["y"] + r["height"] / 2)])
    touch(cdp, "touchEnd", [])


def layout(browser, width, height, is_touch):
    page, cdp, errors, requests = open_game(browser, width, height, is_touch)
    try:
        assert page.locator("#error").is_hidden()
        if width == 1440:
            page.screenshot(path="/tmp/skog-title-desktop.png")
        if is_touch:
            tap(page, cdp, "#enter")
        else:
            page.locator("#enter").click()
        page.wait_for_function("Skog.state.started && !Skog.state.paused")
        assert page.locator("#title-screen").is_hidden()
        measures = page.evaluate("""() => ({
          lang:document.documentElement.lang, width:document.documentElement.scrollWidth,
          height:document.documentElement.scrollHeight, selection:getComputedStyle(document.body).userSelect,
          buttons:[...document.querySelectorAll('#hud button')].filter(e=>e.getClientRects().length).map(e=>{
            const r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,right:r.right,bottom:r.bottom};})
        })""")
        assert measures["lang"] == "sv" and measures["selection"] == "none", measures
        assert measures["width"] <= width and measures["height"] <= height, measures
        for r in measures["buttons"]:
            assert r["w"] >= 44 and r["h"] >= 44, r
            assert r["x"] >= 0 and r["y"] >= 0 and r["right"] <= width and r["bottom"] <= height, r
        # Both input modes must control the actual light and the visible flame.
        if is_touch:
            tap(page, cdp, "#lantern")
        else:
            page.keyboard.press("l")
        page.wait_for_function("Skog.forest.character.lanternLevel < .01", timeout=10000)
        assert page.locator("#lantern").get_attribute("aria-pressed") == "false"
        assert page.evaluate("Skog.forest.lanternLight.intensity < 1 && !Skog.forest.character.flame.visible")
        if is_touch:
            tap(page, cdp, "#lantern")
        else:
            page.keyboard.press("l")
        page.wait_for_function("Skog.forest.character.lanternLevel > .98", timeout=10000)
        assert page.locator("#lantern").get_attribute("aria-pressed") == "true"
        assert page.evaluate("Skog.forest.lanternLight.intensity > 7 && Skog.forest.character.flame.visible")
        initial = page.evaluate("({...Skog.player,yaw:Skog.camera.yaw})")
        if is_touch:
            x, y = width * .23, height * .7
            look_x, look_y = width * .73, height * .55
            touch(cdp, "touchStart", [point(x, y)])
            touch(cdp, "touchMove", [point(x, y - 45)])
            touch(cdp, "touchStart", [point(x, y - 45), point(look_x, look_y, 2)])
            touch(cdp, "touchMove", [point(x, y - 45), point(look_x + 35, look_y + 8, 2)])
            page.wait_for_function("Skog.player.z < 6.3", timeout=10000)
            assert page.evaluate("Skog.input.pointers") == 2
            touch(cdp, "touchEnd", [])
            assert page.evaluate("Skog.input.x===0&&Skog.input.y===0&&Skog.input.pointers===0")
            after = page.evaluate("({...Skog.player,yaw:Skog.camera.yaw})")
            assert after["z"] < initial["z"] - .5, (initial, after)
            assert abs(after["yaw"] - initial["yaw"]) > .1
            # Cancellation, three simultaneous contacts and rotation reset.
            touch(cdp, "touchStart", [point(x, y)])
            touch(cdp, "touchMove", [point(x, y - 45)])
            r = page.locator("#run").bounding_box()
            run = point(r["x"] + 32, r["y"] + 32, 3)
            touch(cdp, "touchStart", [point(x, y - 45), point(look_x, look_y, 2), run])
            page.wait_for_function("Skog.input.running && Skog.player.speed>3", timeout=10000)
            touch(cdp, "touchCancel", [])
            assert page.evaluate("!Skog.input.running && Skog.input.pointers===0 && Skog.input.y===0")
            tap(page, cdp, "#pause")
        else:
            page.keyboard.down("w")
            try:
                page.wait_for_function("Skog.player.z<5.9", timeout=10000)
            finally:
                page.keyboard.up("w")
            assert page.evaluate("Skog.player.z") < initial["z"] - 1
            yaw = page.evaluate("Skog.camera.yaw")
            page.mouse.move(width * .65, height * .5)
            page.mouse.down()
            page.mouse.move(width * .65 + 90, height * .5 + 20, steps=5)
            page.mouse.up()
            assert abs(page.evaluate("Skog.camera.yaw") - yaw) > .3
            page.keyboard.down("q")
            page.wait_for_timeout(200)
            page.keyboard.up("q")
            page.mouse.wheel(0, 200)
            assert page.evaluate("Skog.camera.distance") > 6.6
            page.keyboard.press("Escape")
        assert page.locator("#pause-dialog").is_visible()
        position = page.evaluate("JSON.stringify(Skog.player)")
        page.wait_for_timeout(150)
        assert page.evaluate("JSON.stringify(Skog.player)") == position
        assert page.evaluate("Skog.sound.context===null")
        if is_touch:
            tap(page, cdp, "#resume")
        else:
            page.keyboard.press("Escape")
        assert page.locator("#pause-dialog").is_hidden()
        page.wait_for_function("Skog.sound.context?.state==='running'")
        page.locator("#sound").click()
        assert page.evaluate("!Skog.sound.enabled && Skog.sound.context===null")
        page.locator("#sound").click()
        page.wait_for_function("Skog.sound.enabled && Skog.sound.context?.state==='running'")
        # Return to the same view for visual comparison.
        page.locator("#pause").click()
        page.locator("#restart").click()
        page.wait_for_timeout(100)
        assert page.evaluate("""(() => {
          const c=Skog.forest.camera.position,p=Skog.player;
          const target=new THREE.Vector3(p.x,SkogWorld.height(p.x,p.z)+1.075,p.z);
          const delta=c.clone().sub(target);
          return delta.length()<=Skog.camera.distance+.01 &&
            Math.abs(Math.atan2(delta.x,delta.z)-Skog.camera.yaw)<.01;
        })()"""), "Camera must orbit the player at the requested yaw and distance"
        if (width, height) in [(1440, 900), (390, 844), (844, 390), (768, 1024)]:
            page.screenshot(path=f"/tmp/skog-{width}x{height}.png")
        assert not errors, errors
        assert not requests, requests
        stats = page.evaluate("Skog.forest.renderer.info.render")
        detail=page.evaluate("Skog.forest.pipeline.detailStats")
        shadow=page.evaluate("Skog.forest.pipeline.shadowStats")
        # Preserve the main-view budget; the cropped supersampling pass reuses
        # geometry and has separate draw, triangle and framebuffer limits.
        assert stats["triangles"]-detail["triangles"]-shadow["triangles"] < 850000, (stats,detail,shadow)
        assert stats["calls"]-detail["calls"]-shadow["calls"] < 320, (stats,detail,shadow)
        assert detail["triangles"] < 500000 and detail["calls"] < 180, detail
        assert detail["pixels"] <= 1350000, detail
        assert shadow["triangles"]<1800000 and shadow["calls"]<400,shadow
        gl_error=page.evaluate("Skog.forest.renderer.getContext().getError()")
        assert gl_error == 0,gl_error
        print(f"PASS {width}×{height}: offline, layout, {'native multitouch' if is_touch else 'keyboard/mouse'}, pause, audio; {stats['calls']} draws / {stats['triangles']} triangles", flush=True)
    finally:
        page.close()


def tour(browser):
    page, cdp, errors, requests = open_game(browser, 1440, 900)
    try:
        page.locator("#enter").click()
        # Ordinary controls explore the first fork and collide with the forest.
        for key, seconds in [("w", 3), ("a", 1.5), ("w", 3), ("d", 2), ("w", 4)]:
            page.keyboard.down(key)
            page.wait_for_timeout(seconds * 1000)
            page.keyboard.up(key)
            p = page.evaluate("({...Skog.player,clear:[...Skog.world.nearby(Skog.player.x,Skog.player.z)].every(c=>Math.hypot(c.x-Skog.player.x,c.z-Skog.player.z)>=c.r+.275)})")
            assert p["clear"], p
        page.screenshot(path="/tmp/skog-walk.png")
        # Inspect every landmark and camera clipping from several angles.
        for name, x, z, yaw in [("ruin", 17, -24, -1.5708), ("well", -27, -33, 0), ("stones", 46, 31, .4488)]:
            page.evaluate("([x,z,yaw])=>{const p=Skog.world.move(x,z,0,0);Object.assign(Skog.player,p);Skog.camera.yaw=yaw;Skog.camera.pitch=.23;Skog.camera.actualDistance=6.6;}", [x, z, yaw])
            page.wait_for_timeout(200)
            page.screenshot(path=f"/tmp/skog-{name}.png")
            assert page.evaluate("""(() => {
              const c=Skog.forest.camera.position,p=Skog.player;
              return c.distanceTo(new THREE.Vector3(p.x,SkogWorld.height(p.x,p.z)+1.075,p.z))<=6.61;
            })()"""), "Camera follows the child anywhere in the world"
        assert not errors and not requests, (errors, requests)
        print("PASS walking tour, obstacle clearance, three landmarks", flush=True)
    finally:
        page.close()


def polish(browser):
    page, cdp, errors, requests = open_game(browser, 1440, 900)
    try:
        assets = page.evaluate("async()=>await Skog.forest.environment.assetsReady")
        assert assets and all(assets), "All colour and normal textures must decode offline"
        page.locator("#enter").click()
        page.evaluate("async()=>await Skog.sound.ready")
        details = page.evaluate("""() => {
          const f=Skog.forest,c=f.character, meshes=[];
          c.group.traverse(o=>{if(o.isSkinnedMesh)meshes.push(o)});
          return {character:c.stats,skins:meshes.length,
            samples:Object.keys(Skog.sound.samples).length,pipeline:f.pipeline.enabled,
            textures:[...f.environment.textureCache.values()].every(t=>t.image&&t.image.width>=1024)};
        }""")
        assert details["skins"] >= 4 and details["textures"], details
        assert details["samples"] >= 15, details
        assert details["character"]["draws"] < 100, details
        assert page.evaluate("Skog.forest.environment.stats.geometryBytes") < 60 * 1024 * 1024
        steps = page.evaluate("Skog.sound.eventCounts.steps")
        page.keyboard.down("w")
        try:
            page.wait_for_function("Skog.player.z<4.8", timeout=10000)
        finally:
            page.keyboard.up("w")
        assert page.evaluate("Skog.sound.eventCounts.steps") > steps
        # Stop motion and inspect the hero model from both sides in actual light.
        page.locator("#pause").click()
        page.locator("#restart").click()
        page.evaluate("Skog.camera.distance=3.3;Skog.camera.pitch=.13;Skog.camera.yaw=Math.PI;")
        page.wait_for_timeout(300)
        page.screenshot(path="/tmp/skog-polished-character-front.png")
        page.evaluate("Skog.camera.yaw=-.35")
        page.wait_for_timeout(200)
        page.screenshot(path="/tmp/skog-polished-character-back.png")
        rock = page.evaluate("""() => {
          const r=Skog.world.rocks.filter(r=>r.r>1).sort((a,b)=>Math.hypot(a.x,a.z)-Math.hypot(b.x,b.z))[0];
          const p=Skog.world.move(r.x-1.1,r.z+3.5,0,0);Object.assign(Skog.player,p);
          Skog.camera.yaw=0;Skog.camera.pitch=.20;Skog.camera.distance=4.6;
          return r;
        }""")
        page.wait_for_timeout(200)
        page.screenshot(path="/tmp/skog-polished-stone.png")
        # The render fallback must remain usable without HDR extensions.
        page.evaluate("Skog.forest.pipeline.enabled=false")
        page.wait_for_timeout(100)
        assert page.evaluate("Skog.forest.renderer.getContext().getError()") == 0
        assert not errors and not requests, (errors, requests)
        print(f"PASS polish: {details}; recorded gait footsteps, detailed views, HDR fallback", flush=True)
    finally:
        page.close()


def character_review(browser):
    page, cdp, errors, requests = open_game(browser, 1440, 900)
    try:
        page.locator("#enter").click()
        page.wait_for_function("Skog.forest.character.eyeMap.image?.width>0")
        page.evaluate("Skog.state.paused=true;document.querySelector('#hint').classList.add('faded')")
        for name, speed, phase in [("idle",0,0),("walk",1.85,1.0),("run",3.5,2.0)]:
            page.evaluate("""([speed,phase])=>{
              const s=Skog,c=s.forest.character;
              Object.assign(s.player,{speed,motionSpeed:speed,walk:phase});
              Object.assign(s.camera,{distance:3.3,pitch:.13,yaw:Math.PI,actualDistance:3.3});
              for(let i=0;i<100;i++)s.forest.update(4,1/60,s.player,s.camera);
            }""", [speed,phase])
            page.screenshot(path=f"/tmp/skog-quaternius-{name}.png")
        page.evaluate("""()=>{const s=Skog;Object.assign(s.player,{speed:0,motionSpeed:0});
          Object.assign(s.camera,{distance:6.6,yaw:.08,actualDistance:6.6});
          for(let i=0;i<100;i++)s.forest.update(4,1/60,s.player,s.camera);
        }""")
        page.screenshot(path="/tmp/skog-lantern-on.png")
        page.locator("#lantern").click()
        page.evaluate("for(let i=0;i<120;i++)Skog.forest.update(4,1/60,Skog.player,Skog.camera)")
        assert page.evaluate("!Skog.forest.character.flame.visible && Skog.forest.lanternLight.intensity<.01")
        page.screenshot(path="/tmp/skog-lantern-off.png")
        assert not errors and not requests, (errors,requests)
        print("PASS Quaternius eye texture, idle/walk/run snapshots, lantern on/off, offline",flush=True)
    finally:
        page.close()


def aliasing_review(browser):
    for width,height,touch_mode in [(1440,900,False),(390,844,True)]:
        page, cdp, errors, requests = open_game(browser,width,height,touch_mode)
        try:
            page.locator("#enter").click()
            page.evaluate("""()=>{const s=Skog;s.state.paused=true;
              document.querySelector('#hint').hidden=true;
              s.forest.setQuality(1);
              Object.assign(s.camera,{distance:3.3,pitch:.13,yaw:0,actualDistance:3.3});
              for(let i=0;i<100;i++)s.forest.update(4,1/60,s.player,s.camera);
            }""")
            metrics={}
            for enabled in [False,True]:
                metrics[enabled]=page.evaluate("""enabled=>{
                  const f=Skog.forest,p=f.pipeline,r=f.renderer,gl=r.getContext();
                  p.antialiasEnabled=enabled;p.sceneTarget.samples=Math.min(enabled?4:2,r.capabilities.maxSamples);
                  p.sceneTarget.dispose();
                  const timings=[];
                  for(let i=0;i<40;i++){const begin=performance.now();p.render(4);gl.finish();if(i>=10)timings.push(performance.now()-begin);}
                  p.render(4);
                  const w=gl.drawingBufferWidth,h=gl.drawingBufferHeight,size=120,pack=f.character.pack.getWorldPosition(new THREE.Vector3()).project(f.camera),x=Math.floor((pack.x*.5+.5)*w-size/2),y=Math.floor((pack.y*.5+.5)*h-size/2);
                  const rgba=new Uint8Array(size*size*4);gl.readPixels(x,y,size,size,gl.RGBA,gl.UNSIGNED_BYTE,rgba);
                  let energy=0,mean=0;const luma=i=>rgba[i*4]*.2126+rgba[i*4+1]*.7152+rgba[i*4+2]*.0722;
                  for(let yy=1;yy<size-1;yy++)for(let xx=1;xx<size-1;xx++){
                    const i=yy*size+xx,l=luma(i);mean+=l;
                    energy+=Math.abs(4*l-luma(i-1)-luma(i+1)-luma(i-size)-luma(i+size));
                  }
                  timings.sort((a,b)=>a-b);
                  return {energy,mean,medianMs:timings[15],samples:p.sceneTarget.samples,calls:p.stats.calls,error:gl.getError()};
                }""",enabled)
                page.evaluate("window.aaReviewTimer=setInterval(()=>Skog.forest.pipeline.render(4),30)")
                page.screenshot(path=f"/tmp/skog-aa-{width}-{'after' if enabled else 'before'}.png")
                page.evaluate("clearInterval(window.aaReviewTimer)")
            assert metrics[True]["energy"] < metrics[False]["energy"],metrics
            assert abs(metrics[True]["mean"]/metrics[False]["mean"]-1)<.08,metrics
            assert metrics[True]["error"] == 0 and not errors and not requests,(metrics,errors,requests)
            print(f"PASS antialias {width}x{height}: {metrics}",flush=True)
        finally:
            page.close()


def temporal_review(browser):
    import base64
    for width,height in [(1440,900),(390,844)]:
        page,cdp,errors,requests=open_game(browser,width,height,width<600)
        try:
            page.evaluate("Skog.state.paused=true;Skog.forest.setQuality(1)")
            result={}
            for enabled in [False,True]:
                trial=page.evaluate("""enabled=>{
                  const s=Skog,f=s.forest,p=f.pipeline,gl=f.renderer.getContext();
                  p.temporalEnabled=enabled;p.historyValid=false;
                  const projection=f.camera.projectionMatrix.clone(),frames=[],images=[],timings=[];
                  const size=80,data=new Uint8Array(size*size*4);
                  for(let i=0;i<180;i++){
                    const begin=performance.now();f.update(i/60,1/60,s.player,s.camera);gl.finish();
                    if(i>=60){
                      timings.push(performance.now()-begin);
                      const pack=f.character.pack.getWorldPosition(new THREE.Vector3()).project(f.camera);
                      const x=Math.floor((pack.x*.5+.5)*gl.drawingBufferWidth-size/2),y=Math.floor((pack.y*.5+.5)*gl.drawingBufferHeight-size/2);
                      gl.readPixels(x,y,size,size,gl.RGBA,gl.UNSIGNED_BYTE,data);
                      frames.push(Float32Array.from({length:size*size},(_,j)=>data[j*4]*.2126+data[j*4+1]*.7152+data[j*4+2]*.0722));
                    }
                    if([60,90,120,150].includes(i))images.push(f.renderer.domElement.toDataURL('image/png').split(',')[1]);
                  }
                  let flicker=0,mean=0;
                  for(let i=2;i<frames.length;i++)for(let j=0;j<frames[i].length;j++){
                    flicker+=Math.abs(frames[i][j]-2*frames[i-1][j]+frames[i-2][j]);mean+=frames[i][j];
                  }
                  const count=(frames.length-2)*size*size;timings.sort((a,b)=>a-b);
                  return {flicker:flicker/count,mean:mean/count,medianMs:timings[Math.floor(timings.length/2)],
                    projectionStable:projection.equals(f.camera.projectionMatrix),error:gl.getError(),images};
                }""",enabled)
                for i,data in enumerate(trial.pop("images")):
                    Path(f"/tmp/skog-temporal-{width}-{'after' if enabled else 'before'}-{i}.png").write_bytes(base64.b64decode(data))
                result[enabled]=trial
            print(f"Temporal title {width}x{height}: {result}",flush=True)
            assert result[True]["flicker"]<result[False]["flicker"]*.7,result
            assert abs(result[True]["mean"]/result[False]["mean"]-1)<.05,result
            assert result[True]["projectionStable"] and result[True]["error"]==0,result
            # Camera cuts and pixel-ratio changes discard history immediately.
            page.evaluate("Skog.forest.setQuality(.8)")
            assert page.evaluate("!Skog.forest.pipeline.historyValid")
            page.evaluate("Skog.camera.yaw+=1;Skog.forest.update(4,1/60,Skog.player,Skog.camera)")
            assert page.evaluate("Skog.forest.pipeline.temporal.uniforms.historyWeight.value===0")
            page.evaluate("Skog.forest.update(4+1/60,1/60,Skog.player,Skog.camera)")
            assert page.evaluate("Skog.forest.pipeline.temporal.uniforms.historyWeight.value>0")
            page.evaluate("Skog.camera.yaw-=1;Skog.forest.update(4+2/60,1/60,Skog.player,Skog.camera)")
            assert page.evaluate("Skog.forest.pipeline.temporal.uniforms.historyWeight.value===0")
            motion=page.evaluate("""()=>{
              const s=Skog,f=s.forest,p=f.pipeline,images={},coverage=[];
              f.setQuality(1);s.camera.distance=3.3;s.camera.actualDistance=3.3;
              for(let i=0;i<180;i++){
                const speed=i<60?1.85:3.5;
                s.player.speed=s.player.motionSpeed=speed;s.player.walk+=speed/60*3.5;
                s.player.z-=speed/60;
                if(i>=120)s.camera.yaw+=.012;
                f.update(5+i/60,1/60,s.player,s.camera);
                if([30,90,145,146,147].includes(i)){
                  images[i]=f.renderer.domElement.toDataURL('image/png').split(',')[1];
                  let clipped=0;const q=new THREE.Vector3(),rect=p.detailRect;
                  f.character.group.traverse(o=>{
                    if(!o.isMesh||o.material.transparent)return;
                    for(let v=0;v<o.geometry.attributes.position.count;v++){
                      o.getVertexPosition(v,q).applyMatrix4(o.matrixWorld).project(f.camera);
                      const x=q.x*.5+.5,y=q.y*.5+.5;
                      if(x<rect.x||x>rect.x+rect.z||y<rect.y||y>rect.y+rect.w)clipped++;
                    }
                  });
                  coverage.push({frame:i,clipped,pixels:p.detailStats.pixels});
                }
              }
              return {images,coverage,weight:p.temporal.uniforms.historyWeight.value,error:f.renderer.getContext().getError()};
            }""")
            for frame,data in motion.pop("images").items():
                Path(f"/tmp/skog-temporal-{width}-motion-{frame}.png").write_bytes(base64.b64decode(data))
            assert 0<motion["weight"]<.7 and motion["error"]==0,motion
            assert all(c["clipped"]==0 and 0<c["pixels"]<=1350000 for c in motion["coverage"]),motion
            assert page.evaluate("Skog.forest.renderer.getContext().getError()===0")
            assert not errors and not requests,(errors,requests)
        finally:page.close()


def backpack_review(browser):
    page,cdp,errors,requests=open_game(browser,1440,900)
    try:
        # Native screenshot crops: inspect actual title animation, without rescaling.
        for i in range(4):
            page.wait_for_timeout(170)
            page.screenshot(path=f"/tmp/skog-backpack-live-{i}.png",clip={"x":650,"y":380,"width":150,"height":220})
        page.evaluate("Skog.state.paused=true;Skog.camera.distance=3.3;Skog.camera.actualDistance=3.3")
        modes=["baseline","ss2","ss3"] if "--supersample" in sys.argv else ["baseline","no-shadow","no-ao","direct","matte","flat","lantern-only","fill-only","sky-only"]
        for mode in modes:
            page.evaluate("""mode=>{
              const f=Skog.forest,c=f.character,p=f.pipeline;
              if(window.restoreBackpack)window.restoreBackpack();
              f.setQuality(1);
              const items=[];c.group.traverse(o=>{if(o.isMesh)items.push([o,o.material,o.receiveShadow]);});
              const hemi=f.scene.children.find(o=>o.isHemisphereLight);
              const lights=[c.lanternLight,f.characterFill,f.moonlight,hemi].map(o=>[o,o.intensity]);
              const ao=p.ao.fragmentShader;
              window.restoreBackpack=()=>{
                for(const [o,material,receiveShadow] of items){o.material=material;o.receiveShadow=receiveShadow;}
                for(const [o,intensity] of lights)o.intensity=intensity;
                p.enabled=true;p.ao.fragmentShader=ao;p.ao.needsUpdate=true;
              };
              for(let i=0;i<60;i++)f.update(4,1/60,Skog.player,Skog.camera);
              if(mode==='no-shadow')for(const [o] of items)o.receiveShadow=false;
              if(mode==='no-ao'){p.ao.fragmentShader=ao.replace('gl_FragColor=vec4(vec3(shade),1.0);','gl_FragColor=vec4(1.0);');p.ao.needsUpdate=true;}
              if(mode==='direct')p.enabled=false;
              if(mode==='matte')for(const [o,m] of items){const mat=m.clone();mat.normalMap=null;mat.metalness=0;mat.roughness=1;o.material=mat;}
              if(mode==='flat')for(const [o,m] of items)o.material=new THREE.MeshBasicMaterial({color:m.color});
              if(mode==='lantern-only')for(const [o] of lights)if(o!==c.lanternLight)o.intensity=0;
              if(mode==='fill-only')for(const [o] of lights)if(o!==f.characterFill)o.intensity=0;
              if(mode==='sky-only'){c.lanternLight.intensity=0;f.characterFill.intensity=0;}
              if(mode==='ss2')f.setQuality(2);
              if(mode==='ss3')f.setQuality(3);
              p.historyValid=false;
              window.backpackTimer=setInterval(()=>p.render(4),30);
            }""",mode)
            page.wait_for_timeout(350)
            page.screenshot(path=f"/tmp/skog-backpack-{mode}.png",clip={"x":600,"y":300,"width":250,"height":440})
            page.evaluate("clearInterval(window.backpackTimer)")
        assert not errors and not requests,(errors,requests)
        print("Backpack title frames and diagnostic lighting/material captures saved",flush=True)
    finally:page.close()


def detail_review(browser):
    for width,height,quality in [(1440,900,1),(1440,900,1.6),(390,844,1)]:
        page,cdp,errors,requests=open_game(browser,width,height,width<600)
        try:
            page.evaluate("quality=>Skog.forest.setQuality(quality)",quality)
            clip={"x":width/2-75,"y":height/2-70,"width":150,"height":220}
            for enabled in [False,True]:
                page.evaluate("""enabled=>{Skog.state.time=0;Skog.forest.pipeline.detailEnabled=enabled;
                  Skog.forest.pipeline.historyValid=false;}""",enabled)
                page.wait_for_timeout(450)
                for i in range(4):
                    page.wait_for_timeout(170)
                    page.screenshot(path=f"/tmp/skog-detail-{width}-{quality}-{'on' if enabled else 'off'}-{i}.png",clip=clip)
                info=page.evaluate("""()=>{const p=Skog.forest.pipeline;return {rect:p.detailRect.toArray(),
                  samplePixels:p.detailTarget.width*p.detailTarget.height,samples:p.composite.uniforms.detailSamples.value,
                  draws:p.stats.calls,triangles:p.stats.triangles,viewRestored:Skog.forest.camera.view===null,
                  error:Skog.forest.renderer.getContext().getError()};}""")
                assert info["viewRestored"] and info["error"]==0,info
                if enabled:assert info["rect"][2]>0 and info["samplePixels"]<=1350000,info
                print(f"Detail {width} @ {quality}, enabled={enabled}: {info}",flush=True)
            assert not errors and not requests,(errors,requests)
        finally:page.close()


def benchmark(browser):
    page, cdp, errors, requests = open_game(browser, 1440, 900)
    try:
        result=page.evaluate("""() => {
          Skog.state.paused=true;
          const f=Skog.forest,gl=f.renderer.getContext(),result={};
          for(const enabled of [true,false]){
            f.pipeline.enabled=enabled;
            const times=[];
            for(let i=0;i<18;i++){
              const begin=performance.now();f.update(i/60,1/60,Skog.player,Skog.camera);gl.finish();
              if(i>=4)times.push(performance.now()-begin);
            }
            times.sort((a,b)=>a-b);
            result[enabled?'hdr':'direct']={medianMs:times[7],p90Ms:times[12],draws:f.renderer.info.render.calls,triangles:f.renderer.info.render.triangles};
          }
          f.pipeline.enabled=true;result.geometryMiB=f.environment.stats.geometryBytes/1048576;
          result.pixels=f.renderer.domElement.width*f.renderer.domElement.height;
          return result;
        }""")
        assert not errors and not requests, (errors,requests)
        print(f"Render benchmark with GPU completion at1440×900: {result}",flush=True)
    finally:
        page.close()


def occlusion_review(browser):
    import base64
    for width,height in [(1440,900),(390,844)]:
        page,cdp,errors,requests=open_game(browser,width,height,width<600)
        try:
            page.evaluate("""()=>{const s=Skog;s.state.paused=true;s.forest.setQuality(1);
              Object.assign(s.camera,{distance:3.3,actualDistance:3.3,pitch:.13});
              for(let i=0;i<90;i++)s.forest.update(4,1/60,s.player,s.camera);
            }""")
            result=page.evaluate("""()=>{
              const s=Skog,f=s.forest,p=f.pipeline,light=f.lanternLight,gl=f.renderer.getContext();
              const original=light.position.clone(),power=light.intensity,result={};
              const pack=f.character.pack.getWorldPosition(new THREE.Vector3()).project(f.camera);
              const ground=new THREE.Vector3(original.x+.45,SkogWorld.height(original.x+.45,original.z)+.02,original.z).project(f.camera);
              function pixels(point,w,h){
                const x=Math.floor((point.x*.5+.5)*gl.drawingBufferWidth-w/2),y=Math.floor((point.y*.5+.5)*gl.drawingBufferHeight-h/2);
                const data=new Uint8Array(w*h*4);gl.readPixels(x,y,w,h,gl.RGBA,gl.UNSIGNED_BYTE,data);
                return Array.from({length:w*h},(_,i)=>data[i*4]*.2126+data[i*4+1]*.7152+data[i*4+2]*.0722);
              }
              for(const mode of ['leak','shadow','off','rear']){
                light.position.copy(original);light.intensity=mode==='off'?0:power;
                light.castShadow=mode!=='leak';
                if(mode==='rear')light.position.set(0,.9,-1.2).applyMatrix4(f.child.matrixWorld);
                p.historyValid=false;const timing=[];
                for(let i=0;i<24;i++){const start=performance.now();p.render(4);gl.finish();if(i>=8)timing.push(performance.now()-start);}
                timing.sort((a,b)=>a-b);
                result[mode]={pack:pixels(pack,80,100),ground:pixels(ground,16,16),medianMs:timing[8],
                  calls:p.stats.calls,triangles:p.stats.triangles,shadow:{...p.shadowStats},
                  image:f.renderer.domElement.toDataURL('image/png').split(',')[1]};
              }
              light.position.copy(original);light.intensity=power;light.castShadow=true;
              return result;
            }""")
            for mode,trial in result.items():
                Path(f"/tmp/skog-occlusion-{width}-{mode}.png").write_bytes(base64.b64decode(trial.pop("image")))
            def contribution(mode):
                return sum(max(0,a-b) for a,b in zip(result[mode]["pack"],result["off"]["pack"]))/len(result[mode]["pack"])
            light_leak,blocked,rear=map(contribution,["leak","shadow","rear"])
            ground_on=sum(result["shadow"]["ground"])/256
            ground_off=sum(result["off"]["ground"])/256
            for trial in result.values():
                trial.pop("pack");trial.pop("ground")
            print(f"Occlusion {width}: pack contribution unshadowed={light_leak:.2f}, shadowed={blocked:.2f}, rear source={rear:.2f}; ground on/off={ground_on:.2f}/{ground_off:.2f}; {result}",flush=True)
            assert blocked<light_leak*.4,(light_leak,blocked)
            assert rear>blocked+10,(rear,blocked)
            assert ground_on>ground_off+20,(ground_on,ground_off)
            page.evaluate("Skog.forest.character.setLantern(false);for(let i=0;i<120;i++)Skog.forest.update(4,1/60,Skog.player,Skog.camera)")
            assert page.evaluate("!Skog.forest.lanternLight.shadow.autoUpdate && Skog.forest.pipeline.shadowStats.calls===0")
            page.evaluate("Skog.forest.character.setLantern(true);for(let i=0;i<60;i++)Skog.forest.update(4,1/60,Skog.player,Skog.camera)")
            assert page.evaluate("Skog.forest.lanternLight.shadow.autoUpdate && Skog.forest.pipeline.shadowStats.calls>0")
            assert page.evaluate("Skog.forest.renderer.getContext().getError()===0")
            assert not errors and not requests,(errors,requests)
        finally:page.close()


if __name__ == "__main__":
    with sync_playwright() as p:
        browser = p.chromium.connect_over_cdp("http://127.0.0.1:9222")
        if "--audio" in sys.argv:
            from audio_check import open_audio, checks
            page, cdp, errors, requests = open_audio(browser)
            try:
                checks(page, errors, requests)
            finally:
                page.evaluate("testSound?.release()")
                page.close()
            sys.exit(0)
        if "--temporal" in sys.argv:
            temporal_review(browser)
            sys.exit(0)
        if "--backpack" in sys.argv:
            backpack_review(browser)
            sys.exit(0)
        if "--detail" in sys.argv:
            detail_review(browser)
            sys.exit(0)
        if "--occlusion" in sys.argv:
            occlusion_review(browser)
            sys.exit(0)
        if "--layout" in sys.argv:
            layout(browser,1440,900,False)
            sys.exit(0)
        if "--aliasing" in sys.argv:
            aliasing_review(browser)
            sys.exit(0)
        if "--character" in sys.argv:
            character_review(browser)
            sys.exit(0)
        if "--polish" in sys.argv:
            polish(browser)
            sys.exit(0)
        if "--benchmark" in sys.argv:
            benchmark(browser)
            sys.exit(0)
        for dimensions in [(1440, 900, False), (1024, 768, True), (768, 1024, True),
                           (390, 844, True), (320, 480, True), (844, 390, True), (568, 320, True)]:
            layout(browser, *dimensions)
        tour(browser)
        polish(browser)
    print("All browser checks passed. All test tabs closed.")
