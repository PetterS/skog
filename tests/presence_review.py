# /// script
# requires-python = ">=3.11, <3.14"
# dependencies = ["playwright==1.63.0"]
# ///
"""Force an encounter and capture eyes/moths: uv run tests/presence_review.py TAG"""
import sys
from playwright.sync_api import sync_playwright
from browser_check import open_game

TAG = sys.argv[1] if len(sys.argv) > 1 else "now"
OUT = "/home/petter/source/skog/.shots"

with sync_playwright() as p:
    browser = p.chromium.connect_over_cdp("http://127.0.0.1:9222")
    page, cdp, errors, requests = open_game(browser, 1440, 900)
    try:
        page.locator("#enter").click()
        page.evaluate("""()=>{Object.assign(Skog.player,Skog.world.move(-4.6,-14,0,0),{heading:3});
          Object.assign(Skog.camera,{yaw:-.1,pitch:.12,distance:5.4,actualDistance:5.4});
          const pr=Skog.forest.presence;pr.attention=.7;pr.litTime=400;pr.nextEye=0;}""")
        page.wait_for_timeout(2600)
        info = page.evaluate("""()=>{const pr=Skog.forest.presence;return {events:pr.events,
          eyes:pr.eyes.map(e=>({state:e.state,d:Math.hypot(e.base.x-Skog.player.x,e.base.z-Skog.player.z).toFixed(1),y:e.base.y.toFixed(2)})),
          moths:pr.moths.visible}}""")
        print(info)
        print(page.evaluate("""()=>Skog.forest.presence.eyes.filter(e=>e.state!=='idle').map(e=>{const s=e.pair[0];const v=s.position.clone().project(Skog.forest.camera);
          return {sx:Math.round((v.x*.5+.5)*innerWidth),sy:Math.round((.5-v.y*.5)*innerHeight),c:s.material.color.toArray().map(x=>x.toFixed(2)),blink:e.blink.toFixed(2)}})"""))
        page.screenshot(path=f"{OUT}/{TAG}-eyes.png")
        page.evaluate("Skog.forest.camera.zoom=1")
        page.evaluate("Object.assign(Skog.camera,{distance:3.2,actualDistance:3.2,pitch:.05,yaw:1.4})")
        page.wait_for_timeout(700)
        page.screenshot(path=f"{OUT}/{TAG}-moths.png")
        page.evaluate("Skog.forest.character.setLantern(false)")
        page.wait_for_timeout(9000)
        print(page.evaluate("({exposure:Skog.forest.exposure,eyes:Skog.forest.presence.eyes.map(e=>e.state)})"))
        page.screenshot(path=f"{OUT}/{TAG}-adapted.png")
        assert not errors and not requests, (errors[:3], requests)
    finally:
        page.close()
