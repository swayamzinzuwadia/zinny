import re, sys
from playwright.sync_api import sync_playwright

BASE = "http://localhost:3000"
OUT = sys.argv[1]
errs = []

def login(page, email):
    page.goto(f"{BASE}/login")
    demo = page.locator("form", has=page.locator(f"input[value='{email}']"))
    if demo.count():
        demo.locator("button").click()
    else:
        page.fill("input[name=email]", email)
        page.fill("input[name=password]", "zinny123")
        page.click("button:has-text('Sign in')")
    page.wait_for_url(lambda u: "/login" not in u)
    page.wait_for_load_state("networkidle")

with sync_playwright() as p:
    b = p.chromium.launch()
    def pg(w=1440, h=960):
        c = b.new_context(viewport={"width": w, "height": h}, device_scale_factor=1)
        x = c.new_page()
        x.on("pageerror", lambda e: errs.append(str(e)))
        return x
    page = pg(); page.goto(f"{BASE}/login"); page.wait_for_load_state("networkidle"); page.screenshot(path=f"{OUT}/login.png")
    for email, name in [("hema@demo.edu", "hod"), ("asha@demo.edu", "admin"), ("arun@demo.edu", "accounts"), ("farah@demo.edu", "faculty")]:
        page = pg(); login(page, email); page.screenshot(path=f"{OUT}/dash-{name}.png", full_page=True)
    page = pg(); login(page, "hema@demo.edu")
    page.goto(f"{BASE}/demo/admin/products/courses"); page.wait_for_load_state("networkidle")
    page.click("table >> text=Data Analytics"); page.wait_for_url(re.compile(r".*/courses/[0-9a-f-]{36}.*")); page.wait_for_load_state("networkidle")
    page.screenshot(path=f"{OUT}/course.png", full_page=True)
    page = pg(); login(page, "riya@demo.edu"); page.screenshot(path=f"{OUT}/learn-home.png", full_page=True)
    page.goto(f"{BASE}/demo/learn/timetable"); page.wait_for_load_state("networkidle"); page.screenshot(path=f"{OUT}/learn-timetable.png", full_page=True)
    page = pg(390, 844); login(page, "riya@demo.edu"); page.screenshot(path=f"{OUT}/learn-home-mobile.png", full_page=True)
    page = pg(820, 1180); login(page, "hema@demo.edu"); page.screenshot(path=f"{OUT}/dash-hod-tablet.png", full_page=True)
    b.close()
print("page errors:", errs)
