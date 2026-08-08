"""Phase-18 visual capture: hero anim states + portal state machine in the REAL game."""
import asyncio, json, os, sys, time
from playwright.async_api import async_playwright

URL = "https://realm-deploy.preview.emergentagent.com"
GID = "9b9b9b9b9b9b9b9b9b9b9b9b9b9b9b01"
OUT = "/app/memory/phase18_shots"
os.makedirs(OUT, exist_ok=True)
MODE = sys.argv[1] if len(sys.argv) > 1 else "hero"

async def main():
    async with async_playwright() as pw:
        b = await pw.chromium.launch()
        page = await b.new_page(viewport={"width": 1500, "height": 760})
        await page.goto(f"{URL}/login", wait_until="domcontentloaded")
        await page.wait_for_timeout(1500)
        await page.fill('input[placeholder="Email or username"]', "stealth")
        await page.fill('input[type="password"]', "Password1$")
        await page.click('button:has-text("SIGN IN")')
        await page.wait_for_timeout(3000)
        await page.goto(f"{URL}/games?play={GID}", wait_until="domcontentloaded")
        await page.wait_for_timeout(3500)
        el = await page.query_selector('[data-testid="game-runtime-iframe"]')
        fr = await el.content_frame()
        await fr.click("body")
        await page.wait_for_timeout(3500)

        async def kd(k): await fr.evaluate(f"() => document.dispatchEvent(new KeyboardEvent('keydown',{{key:'{k}'}}))")
        async def ku(k): await fr.evaluate(f"() => document.dispatchEvent(new KeyboardEvent('keyup',{{key:'{k}'}}))")
        async def shot(name): await page.screenshot(path=f"{OUT}/{name}.jpeg", quality=40, type="jpeg")
        async def gb():
            s = await fr.evaluate("() => JSON.stringify(window.__GB__||null)")
            return json.loads(s) if s and s != "null" else None

        if MODE == "hero":
            await shot("01_idle")
            await kd('ArrowRight'); await page.wait_for_timeout(900)
            await shot("02_run")
            await page.wait_for_timeout(300)
            await kd('w'); await page.wait_for_timeout(80); await ku('w')
            await page.wait_for_timeout(240); await shot("03_jump_rise")
            await page.wait_for_timeout(330); await shot("04_jump_fall")
            await ku('ArrowRight'); await page.wait_for_timeout(800)
            await kd('j'); await page.wait_for_timeout(60); await ku('j')
            await page.wait_for_timeout(120); await shot("05_attack")
            await page.wait_for_timeout(600)
            await kd('k'); await page.wait_for_timeout(60); await ku('k')
            await page.wait_for_timeout(160); await shot("06_cast")
            await page.wait_for_timeout(600)
            await kd('l'); await page.wait_for_timeout(60); await ku('l')
            await page.wait_for_timeout(110); await shot("07_dash")
            s = await gb(); print("hero captures done at", s['x'], s['y'], s['st'])
        else:
            # portal states (spawn pre-moved near portal by DB)
            await shot("10_portal_locked")
            await fr.evaluate("() => { window.__INV2__ = window.__INV2__||{}; window.__INV2__.ancient_key = 1 }")
            await kd('ArrowRight'); await page.wait_for_timeout(700); await ku('ArrowRight')
            for i in range(20):
                s = await gb()
                if s['portals'][0]['state'] == 'unlocking': break
                await kd('ArrowRight'); await page.wait_for_timeout(150); await ku('ArrowRight')
            await page.wait_for_timeout(500); await shot("11_portal_unlocking")
            for i in range(20):
                s = await gb()
                if s['portals'][0]['state'] == 'active': break
                await page.wait_for_timeout(200)
            await page.wait_for_timeout(600); await shot("12_portal_active")
            s = await gb(); print("portal captures done:", s['portals'], "pos", s['x'])
        await b.close()

asyncio.run(main())
