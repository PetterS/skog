# /// script
# requires-python = ">=3.11, <3.14"
# dependencies = ["playwright==1.63.0"]
# ///
"""Render and validate Skog's real sample/foley mix, without a preview server."""
import base64
from pathlib import Path
import time
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]


def open_audio(browser):
    context = browser.contexts[0]
    control = browser.new_browser_cdp_session()
    target = control.send("Target.createTarget", {"url": "about:blank", "background": True, "newWindow": False})["targetId"]
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
        assert page, "Could not attach to our audio test tab"
        cdp.send("Emulation.setFocusEmulationEnabled", {"enabled": True})
        cdp.send("Network.enable")
        cdp.send("Network.emulateNetworkConditions", {"offline": True, "latency": 0, "downloadThroughput": -1, "uploadThroughput": -1})
        errors, requests = [], []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.on("request", lambda req: requests.append(req.url) if req.url.startswith("http") else None)
        page.goto((ROOT / "tests/audio_harness.html").as_uri())
        page.wait_for_function("window.testSound")
        return page, cdp, errors, requests
    except BaseException:
        control.send("Target.closeTarget", {"targetId": target})
        raise
    finally:
        control.detach()


RENDER = """async () => {
  const rate=32000, duration=20, c=new OfflineAudioContext(2,rate*duration,rate);
  const sound=new SkogSound(c,7331);await sound.ready;
  if(Object.keys(sound.samples).length!==15)throw Error('Not all local samples decoded');
  sound.update(0,{x:0,z:7},{yaw:0});
  for(let t=2;t<7.2;t+=.49)sound.scheduleFootstep(t,1.85,{x:0,z:7});
  for(let t=8;t<11.5;t+=.26)sound.scheduleFootstep(t,3.5,{x:8,z:7});
  sound.event('owl',4,{x:-11,z:-9,y:6});
  sound.event('creak',10.5,{x:9,z:1,y:4});
  sound.event('branch',14,{x:-6,z:1,y:.5});
  sound.event('water',16,{x:3,z:4,y:-1});
  const b=await c.startRendering(), left=b.getChannelData(0),right=b.getChannelData(1);
  let peak=0,sum=0,difference=0,finite=true,maxJump=0;
  for(let i=0;i<b.length;i++){
    peak=Math.max(peak,Math.abs(left[i]),Math.abs(right[i]));sum+=left[i]**2+right[i]**2;
    difference+=(left[i]-right[i])**2;finite=finite&&Number.isFinite(left[i])&&Number.isFinite(right[i]);
    if(i)maxJump=Math.max(maxJump,Math.abs(left[i]-left[i-1]),Math.abs(right[i]-right[i-1]));
  }
  const bytes=new Uint8Array(44+b.length*4),view=new DataView(bytes.buffer);
  const str=(o,s)=>{for(let i=0;i<s.length;i++)view.setUint8(o+i,s.charCodeAt(i));};
  str(0,'RIFF');view.setUint32(4,36+b.length*4,true);str(8,'WAVE');str(12,'fmt ');view.setUint32(16,16,true);
  view.setUint16(20,1,true);view.setUint16(22,2,true);view.setUint32(24,rate,true);view.setUint32(28,rate*4,true);
  view.setUint16(32,4,true);view.setUint16(34,16,true);str(36,'data');view.setUint32(40,b.length*4,true);
  for(let i=0;i<b.length;i++){view.setInt16(44+i*4,Math.max(-32768,Math.min(32767,left[i]*32767)),true);view.setInt16(46+i*4,Math.max(-32768,Math.min(32767,right[i]*32767)),true);}
  let binary='';for(let i=0;i<bytes.length;i+=16384)binary+=String.fromCharCode(...bytes.subarray(i,i+16384));
  const counts={...sound.eventCounts};sound.release();
  return {peak,rms:Math.sqrt(sum/(2*b.length)),stereoRms:Math.sqrt(difference/b.length),finite,maxJump,counts,wav:btoa(binary),released:sound.nodes.size===0&&sound.sources.size===0&&sound.voices.size===0};
}"""


def checks(page, errors, requests):
    assert page.evaluate("testSound.context===null"), "Audio must not start before a gesture"
    page.locator("#start").click()
    page.wait_for_function("testSound.context?.state==='running' && Object.keys(testSound.samples).length===15", timeout=30000)
    assert page.evaluate("Object.keys(testSound.layers).length") == 4
    page.evaluate("window.firstContext=testSound.context;testSound.setEnabled(false)")
    assert page.evaluate("testSound.context===null&&testSound.nodes.size===0&&testSound.sources.size===0")
    page.locator("#start").evaluate("e=>e.onclick=()=>testSound.setEnabled(true)")
    page.locator("#start").click()
    page.wait_for_function("testSound.context?.state==='running' && Object.keys(testSound.samples).length===15")
    assert page.evaluate("testSound.context!==firstContext && firstContext.state==='closed'")
    # Repeated pause/recovery must not retain obsolete nodes or decode callbacks.
    race = page.evaluate("""async()=>{
      testSound.release();const s=new SkogSound();s.unlock();const pending=s.ready;s.release();await pending;
      return s.context===null&&s.nodes.size===0&&s.sources.size===0&&s.voices.size===0;
    }""")
    assert race
    print("PASS gesture-only startup, 15 local decodes, mute/recovery and release-during-decode", flush=True)
    result = page.evaluate(RENDER)
    Path('/tmp/skog-audio-upgrade.wav').write_bytes(base64.b64decode(result.pop('wav')))
    assert result["finite"] and result["released"], result
    assert .003 < result["rms"] < .15, result
    assert result["stereoRms"] > .001 and result["peak"] < .85, result
    assert result["maxJump"] < .4, result
    print(f"PASS offline render: {result}", flush=True)
    spatial = page.evaluate("""async()=>{
      const levels=[];
      for(const x of [-4,4]){
        const c=new OfflineAudioContext(2,32000*2,32000),s=new SkogSound(c,101);await s.ready;
        s.ambient.gain.value=0;s.wet.gain.value=0;
        s.update(0,{x:0,z:0},{yaw:0});s.wet.gain.cancelScheduledValues(0);s.wet.gain.value=0;
        s.event('branch',.1,{x,z:0,y:1.35});const b=await c.startRendering();
        levels.push([0,1].map(ch=>{let energy=0;for(const v of b.getChannelData(ch))energy+=v*v;return Math.sqrt(energy/b.length);}));s.release();
      }
      return levels;
    }""")
    assert spatial[0][0] > spatial[0][1] * 1.2 and spatial[1][1] > spatial[1][0] * 1.2, spatial
    print(f"PASS HRTF world-space left/right positioning: {spatial}", flush=True)
    muted = page.evaluate("""async()=>{
      const c=new OfflineAudioContext(2,32000,32000),s=new SkogSound(c);await s.ready;s.setEnabled(false);
      const b=await c.startRendering();return b.getChannelData(0).every(v=>v===0)&&b.getChannelData(1).every(v=>v===0);
    }""")
    assert muted
    assert not errors and not requests, (errors, requests)
    print("PASS exact mute silence, offline/no HTTP requests; preview /tmp/skog-audio-upgrade.wav", flush=True)


if __name__ == '__main__':
    with sync_playwright() as p:
        browser = p.chromium.connect_over_cdp('http://127.0.0.1:9222')
        page, cdp, errors, requests = open_audio(browser)
        try:
            checks(page, errors, requests)
        finally:
            page.evaluate("testSound?.release()")
            page.close()
