"""Autonomous gray-box traversal E2E for XY Engine V2 (runs headless, no time cap)."""
import asyncio, json, time, sys
from playwright.async_api import async_playwright

URL = "https://realm-deploy.preview.emergentagent.com"
GID = "9b9b9b9b9b9b9b9b9b9b9b9b9b9b9b01"
RESULTS = []

def log(*a):
    print(*a, flush=True)
    RESULTS.append(" ".join(str(x) for x in a))

async def main():
    async with async_playwright() as pw:
        b = await pw.chromium.launch()
        page = await b.new_page(viewport={"width": 1920, "height": 800})
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
        await page.wait_for_timeout(2500)

        async def gb():
            s = await fr.evaluate("() => JSON.stringify(window.__GB__||null)")
            return json.loads(s) if s and s != "null" else None
        async def kd(k): await fr.evaluate(f"() => document.dispatchEvent(new KeyboardEvent('keydown',{{key:'{k}'}}))")
        async def ku(k): await fr.evaluate(f"() => document.dispatchEvent(new KeyboardEvent('keyup',{{key:'{k}'}}))")
        async def jump():
            await ku('w'); await kd('w'); await page.wait_for_timeout(50); await ku('w')

        async def goto_x(tx, timeout=40, fight=False, tol=20):
            s = await gb(); lastx = s['x']; stuck = 0
            d = 'ArrowRight' if tx > s['x'] else 'ArrowLeft'
            await kd(d); t0 = time.time()
            while time.time() - t0 < timeout:
                await page.wait_for_timeout(160)
                s = await gb()
                if s is None: break
                if abs(s['x'] - tx) <= tol: break
                nd = 'ArrowRight' if tx > s['x'] else 'ArrowLeft'
                if nd != d:
                    await ku(d); d = nd; await kd(d)
                if abs(s['x'] - lastx) < 4 and s['onG']:
                    stuck += 1
                    if stuck >= 2: await jump(); stuck = 0
                else:
                    stuck = 0
                if fight:
                    await ku('j'); await kd('j')
                lastx = s['x']
            await ku(d)
            if fight: await ku('j')
            return await gb()

        import os
        os.makedirs('/app/memory/phase19_shots', exist_ok=True)
        async def SHOT(name):
            try: await page.screenshot(path=f"/app/memory/phase19_shots/{name}.jpeg", quality=40, type="jpeg")
            except Exception: pass

        s = await gb()
        log("START:", s['x'], s['y'], "cam", s['cam'])
        cam0 = s['cam'][:]
        await SHOT("01_desktop_L1_start")

        s = await goto_x(1660, 25)
        log("P1 shaft entry:", s['x'], s['y'], "cam", s['cam'])
        s = await goto_x(1500, 12)
        log("P2 cave floor:", s['x'], s['y'], "camY moved:", s['cam'][1] != cam0[1])

        for attempt in range(3):
            s = await goto_x(755, 45)
            if s['y'] > 1000: break
            log("  derailed at", s['x'], s['y'], "lives", s['lives'], "keys", s['keys'], "- re-descending")
            s = await goto_x(1660, 30); s = await goto_x(1500, 12)
        log("P3 pedestal area:", s['x'], s['y'], "hp", s['hp'], "lives", s['lives'])
        await SHOT("03_underground")

        for i in range(10):
            s = await gb()
            if 'ancient_key' in s['keys']: break
            if s['onG']:
                if abs(s['x'] - 707) > 14: s = await goto_x(707, 8, tol=6)
                await jump()
            await page.wait_for_timeout(600)
        s = await gb()
        log("P4 KEY PICKUP:", s['keys'], "pos", s['x'], s['y'], "->", "PASS" if 'ancient_key' in s['keys'] else "FAIL")
        await SHOT("05_key_pickup")
        # purple ruins gate (underground, x=180) — approach within unlock range, don't enter
        s = await goto_x(300, 15, tol=10)
        await page.wait_for_timeout(2000)
        await SHOT("03b_purple_portal")
        s = await gb(); log("P4b ruins_gate:", [p for p in s['portals'] if p['id']=='ruins_gate'])

        s = await goto_x(320, 20, tol=8)
        log("P5 ladder base:", s['x'], s['y'])
        await kd('w'); climbed = False; t0 = time.time()
        while time.time() - t0 < 12:
            s = await gb()
            if s['climb']: climbed = True
            if s['y'] <= 705: break
            await page.wait_for_timeout(180)
        await ku('w')
        log("P6 LADDER CLIMB:", "climb_state_seen=" + str(climbed), "pos", s['x'], s['y'],
            "->", "PASS" if climbed and s['y'] <= 705 else "FAIL")

        async def cross_gap():
            # deterministic run-up: stop well before the gap, then poll fast
            s2 = await goto_x(1400, 30, tol=12)
            await kd('ArrowRight'); jumped = False; t0 = time.time()
            while time.time() - t0 < 25:
                s2 = await gb()
                if not jumped and s2['onG'] and s2['x'] >= 1512 and s2['y'] <= 710:
                    await jump(); jumped = True
                if s2['x'] >= 1750 and s2['y'] <= 710: break
                if s2['y'] > 800: break
                await page.wait_for_timeout(40)
            await ku('ArrowRight'); return await gb()
        s = await cross_gap()
        for retry in range(2):
            if s['y'] <= 710 and s['x'] >= 1740: break
            log("  fell in shaft during backtrack — ladder route retry")
            s = await goto_x(1500, 15)          # off the rest platform to cave floor
            s = await goto_x(320, 45, tol=8)     # west to ladder
            await kd('w'); t0 = time.time()
            while time.time() - t0 < 12:
                s = await gb()
                if s['y'] <= 705: break
                await page.wait_for_timeout(180)
            await ku('w')
            s = await cross_gap()
        log("P7 gap crossed:", s['x'], s['y'], "->", "PASS" if s['x'] >= 1740 and s['y'] <= 710 else "FAIL")

        s = await goto_x(2820, 30)
        log("P8 pyramid summit:", s['x'], s['y'], "->", "PASS" if s['y'] <= 530 else "FAIL")
        s = await goto_x(3860, 60, fight=True)
        log("P9 plateau:", s['x'], s['y'], "hp", s['hp'], "lives", s['lives'], "keys", s['keys'], s['portals'])

        t0 = time.time(); states = [s['portals'][0]['state']]
        while time.time() - t0 < 14:
            s = await gb()
            st2 = s['portals'][0]['state']
            if st2 != states[-1]: states.append(st2)
            if st2 == 'active': break
            await page.wait_for_timeout(200)
            if s['x'] < 3800: await goto_x(3880, 8, fight=True, tol=15)
        log("P10 PORTAL STATES:", states, "->", "PASS" if states[-1] == 'active' else "FAIL")

        s = await goto_x(3952, 15, tol=10)
        t0 = time.time()
        while time.time() - t0 < 14:
            s = await gb()
            if s and s['stage'] == 1: break
            await page.wait_for_timeout(250)
        log("P11 STAGE TRANSITION:", "stage", s['stage'], "pos", s['x'], s['y'], "keys carried:", s['keys'],
            "->", "PASS" if s['stage'] == 1 else "FAIL")

        if s['stage'] == 1:
            await page.wait_for_timeout(2500)
            await SHOT("10_L2_nexus")
            async def hop(jx, i2, land):
                s2 = await goto_x(jx - 40, 20, tol=8)
                await kd('ArrowRight'); jumped = False; t0 = time.time()
                while time.time() - t0 < 3.5:
                    s2 = await gb()
                    if not jumped and s2['x'] >= jx and s2['onG']:
                        await jump(); jumped = True
                        if i2 == 3: await SHOT("11_L2_jump")
                    if jumped and s2['onG'] and s2['x'] >= land + 10: break
                    if s2['x'] < jx - 200: break
                    await page.wait_for_timeout(40)
                await ku('ArrowRight'); return await gb()
            JP = [262, 562, 832, 1112, 1382, 1662]
            LAND = [400, 680, 950, 1230, 1490, 1780]
            done2 = False
            for attempt in range(4):
                s = await gb()
                todo = [i2 for i2 in range(len(JP)) if JP[i2] > s['x'] - 40]
                ok = True
                for i2 in todo:
                    s = await hop(JP[i2], i2, LAND[i2])
                    if s['x'] < JP[i2] - 100:
                        ok = False; break
                if ok and s['x'] >= 1780:
                    done2 = True; break
                log("  nexus retry", attempt + 1, "at", s['x'], s['y'], "hp", s['hp'])
            log("P12 nexus crossing:", "PASS" if done2 else "FAIL", s['x'], s['y'], s['portals'])
            s = await goto_x(1960, 15, fight=True, tol=16)
            await page.wait_for_timeout(1500)
            await SHOT("12_final_portal")
            await page.wait_for_timeout(4000)
            txt = await fr.evaluate("() => document.body.innerText.slice(0,300)")
            log("P13 END:", txt.replace("\n", " | ")[:220])
            await page.screenshot(path="/tmp/gb_end.jpeg", quality=25, type="jpeg")
        await b.close()

asyncio.run(main())
