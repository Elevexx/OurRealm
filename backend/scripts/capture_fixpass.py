"""Fix-pass captures: climb (no baked ladder), landing (single hero), mobile controls."""
import asyncio, json, time
from playwright.async_api import async_playwright

URL = "https://realm-deploy.preview.emergentagent.com"
GID = "9b9b9b9b9b9b9b9b9b9b9b9b9b9b9b01"
OUT = "/app/memory/phase18_shots"

async def main():
    async with async_playwright() as pw:
        b = await pw.chromium.launch()
        # mobile viewport
        page = await b.new_page(viewport={"width": 390, "height": 844}, has_touch=True,
                                user_agent="Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15")
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
        await page.wait_for_timeout(3000)
        btns = await fr.evaluate("""() => ['left','right','jump','attack','dash','cast'].map(k=>{
            const b=document.querySelector('[data-testid="xy-btn-'+k+'"]');
            if(!b) return k+':MISSING';
            const r=b.getBoundingClientRect();
            return k+':'+Math.round(r.x)+','+Math.round(r.y)+' '+Math.round(r.width)+'px'})""")
        print("mobile buttons:", btns)
        # press right via pointer to prove touch works
        await fr.evaluate("""() => {
            const b=document.querySelector('[data-testid="xy-btn-right"]');
            b.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:9}));}""")
        await page.wait_for_timeout(900)
        await fr.evaluate("""() => {
            const b=document.querySelector('[data-testid="xy-btn-right"]');
            b.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:9}));}""")
        s = json.loads(await fr.evaluate("() => JSON.stringify(window.__GB__)"))
        print("after touch-right x:", s['x'])
        await page.screenshot(path=f"{OUT}/20_mobile_controls.jpeg", quality=40, type="jpeg")

        # desktop page for climb + land captures
        page2 = page
        await page2.set_viewport_size({"width": 1500, "height": 760})
        await page2.goto(f"{URL}/games?play={GID}", wait_until="domcontentloaded")
        await page2.wait_for_timeout(3500)
        el2 = await page2.query_selector('[data-testid="game-runtime-iframe"]')
        fr2 = await el2.content_frame()
        await fr2.click("body")
        await page2.wait_for_timeout(3000)
        async def kd(k): await fr2.evaluate(f"() => document.dispatchEvent(new KeyboardEvent('keydown',{{key:'{k}'}}))")
        async def ku(k): await fr2.evaluate(f"() => document.dispatchEvent(new KeyboardEvent('keyup',{{key:'{k}'}}))")
        async def gb2():
            return json.loads(await fr2.evaluate("() => JSON.stringify(window.__GB__)"))
        # jump + land capture
        await kd('w'); await page2.wait_for_timeout(60); await ku('w')
        await page2.wait_for_timeout(760)
        await page2.screenshot(path=f"{OUT}/21_land_single_hero.jpeg", quality=40, type="jpeg")
        # walk to ladder x=318 area: fall into shaft? spawn x=90 → ladder at 318 right
        await kd('ArrowRight')
        t0=time.time()
        while time.time()-t0<8:
            s=await gb2()
            if s['x']>=300: break
            await asyncio.sleep(0.08)
        await ku('ArrowRight')
        # drop through plank -> hangs on ladder -> climb down to mid-shaft for the shot
        await kd('s'); await kd('w'); await page2.wait_for_timeout(120); await ku('w'); await ku('s')
        await page2.wait_for_timeout(400)
        await kd('s'); await page2.wait_for_timeout(1400); await ku('s')
        await page2.screenshot(path=f"{OUT}/22_climb_no_ladder.jpeg", quality=40, type="jpeg")
        s=await gb2(); print("climb state:", s['climb'], s['x'], s['y'], s['st'])
        await b.close()

asyncio.run(main())
