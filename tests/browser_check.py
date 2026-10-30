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
        page.on("console", lambda message: errors.append(message.text) if message.type == "error" else None)
        page.on("request", lambda req: requests.append(req.url) if req.url.startswith("http") else None)
        page.goto(URL)
        page.wait_for_function("window.Skog && Skog.state.frames>3")
        page.evaluate("async()=>{if(Skog.forest.environment)await Skog.forest.environment.assetsReady;}")
        return page, cdp, errors, requests
    except BaseException:
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
        assert page.evaluate("Skog.forest.lanternLight.intensity > 18 && Skog.forest.character.flame.visible")
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
        # Smooth nearby geometry costs more triangles; spatial batches keep the
        # view bounded, while indexed buffers bound memory independently.
        assert stats["triangles"] < 850000, stats
        assert stats["calls"] < 320, stats
        assert page.evaluate("Skog.forest.renderer.getContext().getError()") == 0
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
