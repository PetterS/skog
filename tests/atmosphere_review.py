# /// script
# requires-python = ">=3.11, <3.14"
# dependencies = ["playwright==1.63.0"]
# ///
"""Capture fixed atmosphere views: uv run tests/atmosphere_review.py TAG"""
import sys
from playwright.sync_api import sync_playwright
from browser_check import open_game

TAG = sys.argv[1] if len(sys.argv) > 1 else "now"
VIEWS = [
    # name, x, z, heading, yaw, pitch, distance, lantern
    ("start", 0, 7, 3.1416, .08, .27, 6.6, True),
    ("path", -4.6, -14, 3.0, -.1, .16, 5.4, True),
    ("deep", 12, 10, 2.2, 1.2, .12, 5.0, True),
    ("ruin", 17, -24, -1.5708, -1.5708, .23, 6.6, True),
    ("well", -27, -33, 0, 0, .23, 6.6, True),
    ("stones", 46, 31, .4488, .4488, .2, 6.6, True),
    ("face", 0, 7, 0, 0, .12, 3.2, True),
    ("side", 0, 7, 1.57, 0, .1, 3.4, True),
    ("dark", -4.6, -14, 3.0, -.1, .16, 5.4, False),
]


def capture(browser, width, height, suffix, views):
    page, cdp, errors, requests = open_game(browser, width, height, touch=width < height)
    try:
        page.screenshot(path=f"/home/petter/source/skog/.shots/{TAG}-title{suffix}.png")
        page.locator("#enter").click()
        page.wait_for_timeout(300)
        for name, x, z, heading, yaw, pitch, distance, lantern in views:
            page.evaluate("""([x,z,h,yaw,pitch,d,lantern])=>{
              Object.assign(Skog.player,Skog.world.move(x,z,0,0),{heading:h});
              Object.assign(Skog.camera,{yaw,pitch,distance:d,actualDistance:d});
              Skog.forest.character.setLantern(lantern);
              if(Skog.forest.debugSetTime)Skog.forest.debugSetTime();
            }""", [x, z, heading, yaw, pitch, distance, lantern])
            page.wait_for_timeout(900)
            page.screenshot(path=f"/home/petter/source/skog/.shots/{TAG}-{name}{suffix}.png")
        stats = page.evaluate("({...Skog.forest.pipeline.stats,shadow:Skog.forest.pipeline.shadowStats,q:Skog.state.quality})")
        print(width, height, stats, flush=True)
        assert not errors and not requests, (errors[:3], requests)
    finally:
        page.close()


if __name__ == "__main__":
    with sync_playwright() as p:
        browser = p.chromium.connect_over_cdp("http://127.0.0.1:9222")
        only = next((a[7:].split(",") for a in sys.argv if a.startswith("--only=")), None)
        capture(browser, 1440, 900, "", [v for v in VIEWS if not only or v[0] in only])
        if "--phone" in sys.argv:
            capture(browser, 390, 844, "-phone", VIEWS[:2] + VIEWS[-1:])
    print("Captured /home/petter/source/skog/.shots/%s-*.png" % TAG)
