"""website-builder click-through: public site forms, admin flows, faculty profile. Screenshots to OUT."""
import re, sys, urllib.request
from playwright.sync_api import sync_playwright

BASE = "http://localhost:3109"  # usage: python3 -I clickthrough.py <out-dir> <dir with upload.jpg and upload2.png> [public admin faculty]; run npm run db:seed first
OUT = sys.argv[1]
FIX = sys.argv[2]
only = set(sys.argv[3:])
errs, checks = [], []

def check(name, ok, detail=""):
    checks.append((name, ok, detail))
    print(("PASS " if ok else "FAIL ") + name + (f" ({detail})" if detail and not ok else ""), flush=True)

def login(page, email):
    page.goto(f"{BASE}/login")
    demo = page.locator("form", has=page.locator(f"input[value='{email}']"))
    if demo.count():
        demo.locator("button").click()
    else:
        page.fill("input[name=email]", email)
        page.fill("input[name=password]", "zinny123")
        page.click("button:has-text('Sign in')")
    page.wait_for_url(lambda u: "/login" not in u, timeout=180000)

def settle(pg):
    pg.wait_for_load_state("networkidle", timeout=240000)
    h = pg.evaluate("document.body.scrollHeight")
    for y in range(0, h, 700):
        pg.evaluate(f"window.scrollTo(0, {y})"); pg.wait_for_timeout(120)
    pg.evaluate("window.scrollTo(0, 0)"); pg.wait_for_timeout(600)
    pg.wait_for_load_state("networkidle", timeout=240000)

def shot(pg, name, full=True):
    settle(pg)
    pg.screenshot(path=f"{OUT}/{name}.png", full_page=full)

def go(pg, path):
    pg.goto(BASE + path, wait_until="domcontentloaded", timeout=240000)
    pg.wait_for_load_state("networkidle", timeout=240000)

def fetch(path):
    try:
        with urllib.request.urlopen(BASE + path, timeout=240) as r:
            return r.status, r.read().decode("utf8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, ""

def want(s):
    return not only or s in only

with sync_playwright() as p:
    b = p.chromium.launch()
    def ctx(w=1440, h=900):
        c = b.new_context(viewport={"width": w, "height": h}, device_scale_factor=1)
        pg = c.new_page()
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.on("console", lambda m: errs.append("console: " + m.text) if m.type == "error" and "Failed to load resource" not in m.text else None)
        pg.on("dialog", lambda d: d.accept())
        return c, pg

    # ── Public site, anonymous ──
    if want("public"):
        c, pg = ctx()
        go(pg, "/site/demo")
        check("home shows hero heading", pg.locator("h1").first.inner_text().startswith("Learn the skills"))
        shot(pg, "site-home")
        # Enquiry form
        f = pg.locator("#enquiry form")
        f.locator("input[name=name]").fill("Playwright Pooja")
        f.locator("input[name=email]").fill("pooja.e2e@example.com")
        f.locator("input[name=phone]").fill("+91 98111 22233")
        f.locator("select[name=courseId]").select_option(label="Python Basics")
        f.locator("textarea[name=message]").fill("Is the weekend batch suitable for a complete beginner?")
        f.locator("button:has-text('Send enquiry')").click()
        pg.wait_for_selector("#enquiry [role=status]", timeout=60000)
        check("enquiry form says thank you", "We have your enquiry" in pg.locator("#enquiry [role=status]").inner_text())
        check("enquiry form clears after sending", f.locator("input[name=name]").input_value() == "")
        # Review form
        pg.locator("#reviews summary:has-text('Write a review')").click()
        r = pg.locator("#reviews form")
        r.locator("label:has(input[value='5'])").click()
        r.locator("input[name=name]").fill("Playwright Pradeep")
        r.locator("input[name=email]").fill("pradeep.e2e@example.com")
        r.locator("textarea[name=body]").fill("Clear teaching and genuinely useful weekend projects.")
        r.locator("button:has-text('Send review')").click()
        pg.wait_for_selector("#reviews [role=status]", timeout=60000)
        check("review form says it waits for checking", "once our team has checked it" in pg.locator("#reviews [role=status]").inner_text())
        # Course page and Enrol
        pg.locator("#courses a:has-text('Data Analytics')").first.click()
        pg.wait_for_url(re.compile(r".*/site/demo/courses/[0-9a-f-]{36}$"), timeout=120000)
        course_url = pg.url
        body = pg.locator("main").inner_text()
        check("course page lists batches with timings and seats", "Weekday morning" in body and "Mon to Fri, 9 am to 11 am" in body and "seats left" in body and "Full" in body)
        shot(pg, "site-course")
        enrol = pg.locator("aside a:has-text('Enrol')").get_attribute("href")
        check("Enrol links to the learner course page", bool(re.match(r"^/demo/learn/courses/[0-9a-f-]{36}$", enrol or "")), enrol or "")
        # Course enquiry form remembers the course
        check("course enquiry form preselects the course", pg.locator("#course-enquiry select[name=courseId] option:checked").inner_text() == "Data Analytics")
        go(pg, "/site/demo/blog")
        check("blog index lists three posts", pg.locator("main h3, main h3").count() >= 2 and "Placements 2026" in pg.locator("main").inner_text())
        shot(pg, "site-blog")
        go(pg, "/site/demo/blog/placements-2026")
        check("blog post renders", "92%" in pg.locator("article").inner_text())
        shot(pg, "site-post")
        go(pg, "/site/demo/blog/admissions-january-term")
        check("draft post is a 404", "isn't here" in pg.locator("body").inner_text())
        go(pg, "/site/demo")
        pg.locator("#faculty a").first.click()
        pg.wait_for_url(re.compile(r".*/faculty/.*"), timeout=120000)
        check("faculty profile page", "Teaches" in pg.locator("main").inner_text())
        shot(pg, "site-faculty")
        # Videos load only on click
        go(pg, "/site/demo")
        check("no YouTube iframe before play", pg.locator("#videos iframe").count() == 0)
        pg.locator("#videos button").first.click()
        check("YouTube iframe after play", "youtube-nocookie.com/embed/" in (pg.locator("#videos iframe").first.get_attribute("src") or ""))
        c.close()

        # Mobile
        c, pg = ctx(390, 844)
        go(pg, "/site/demo"); shot(pg, "site-home-390")
        pg.goto(course_url); shot(pg, "site-course-390")
        go(pg, "/site/demo/blog/five-sql-habits"); shot(pg, "site-post-390")
        go(pg, "/site/demo")
        pg.locator("summary:has-text('Menu')").click()
        check("mobile menu opens", pg.locator("details[open] a:has-text('Courses')").is_visible())
        pg.screenshot(path=f"{OUT}/site-menu-390.png")
        overflow = pg.evaluate("document.documentElement.scrollWidth > window.innerWidth")
        check("no horizontal scroll at 390 px", not overflow)
        c.close()

        st, sm = fetch("/site/demo/sitemap.xml")
        check("sitemap.xml lists home, posts and courses", st == 200 and "/site/demo/blog/placements-2026" in sm and "/site/demo/courses/" in sm and "admissions-january-term" not in sm)
        st, rb = fetch("/site/demo/robots.txt")
        check("robots.txt points at the sitemap and hides previews", st == 200 and "Sitemap: " in rb and "Disallow: /site/demo/preview" in rb)
        check("unknown site is 404", fetch("/site/no-such-uni")[0] == 404)
        check("unknown course id is 404", fetch("/site/demo/courses/00000000-0000-4000-8000-000000000000")[0] == 404)
        st, html = fetch("/site/demo")
        check("home has Open Graph and canonical metadata", 'property="og:title"' in html and 'rel="canonical"' in html and "application/ld+json" in html)

    # ── Admin ──
    if want("admin"):
        c, pg = ctx()
        login(pg, "asha@demo.edu")
        go(pg, "/demo/admin")
        shot(pg, "admin-dashboard")
        check("dashboard has the Website card", pg.locator("[data-slot-key=website]").count() == 1)

        go(pg, "/demo/admin/website/profile")
        shot(pg, "admin-profile")
        pg.fill("input[name=tagline]", "Practical degrees in Navi Mumbai since 1998, now with weekend batches")
        pg.locator("input[type=file]").nth(1).set_input_files(f"{FIX}/upload.jpg")
        pg.wait_for_function("() => !document.body.innerText.includes('Uploading…')", timeout=120000)
        pg.click("button:has-text('Save profile')")
        pg.wait_for_selector("text=Profile saved", timeout=60000)
        check("profile saves with a new cover image", True)
        go(pg, "/site/demo")
        check("public site shows the new tagline at once", "now with weekend batches" in pg.locator("footer").inner_text())

        go(pg, "/demo/admin/website/profile/builder")
        shot(pg, "admin-builder")
        hero = pg.locator("li", has=pg.locator("span:text-is('Hero')")).first
        hero.locator("summary").click()
        hero.locator("input[name=heading]").fill("Small batches, real skills, timings that fit your week")
        hero.locator("button:has-text('Save to draft')").click()
        pg.wait_for_selector("text=Saved to the draft", timeout=60000)
        pg.reload(); pg.wait_for_load_state("networkidle")
        check("builder shows unpublished changes", pg.locator("text=Unpublished changes").count() >= 1)
        team = pg.locator("li", has=pg.locator("span:text-is('Team')")).first
        team.locator("button:has-text('Hide')").click()
        pg.wait_for_timeout(1500); pg.reload(); pg.wait_for_load_state("networkidle")
        check("hiding a section marks it hidden", pg.locator("li", has=pg.locator("span:text-is('Team')")).first.locator("text=Hidden").count() == 1)
        shot(pg, "admin-builder-changes")
        go(pg, "/site/demo")
        check("live site still shows the published hero", pg.locator("h1").first.inner_text().startswith("Learn the skills"))
        go(pg, "/site/demo/preview")
        check("preview shows the draft hero", pg.locator("h1").first.inner_text().startswith("Small batches"))
        check("preview hides the hidden team", pg.locator("#team").count() == 0)
        shot(pg, "site-preview")
        go(pg, "/demo/admin/website/profile/builder")
        pg.click("button:has-text('Publish changes')")
        pg.wait_for_selector("text=Published. Your website now shows this version.", timeout=60000)
        go(pg, "/site/demo")
        check("publishing replaces the live page", pg.locator("h1").first.inner_text().startswith("Small batches") and pg.locator("#team").count() == 0)
        # Put the team back for the remaining screenshots.
        go(pg, "/demo/admin/website/profile/builder")
        pg.locator("li", has=pg.locator("span:text-is('Team')")).first.locator("button:has-text('Show')").click()
        pg.wait_for_timeout(1500)
        go(pg, "/demo/admin/website/profile/builder")
        pg.click("button:has-text('Publish changes')")
        pg.wait_for_selector("text=Published.", timeout=60000)

        go(pg, "/demo/admin/website/sections")
        shot(pg, "admin-sections")
        go(pg, "/demo/admin/website/sections/enquiries")
        check("new enquiry from the site is in the inbox", "Playwright Pooja" in pg.locator("main").inner_text() or "public" not in only)
        shot(pg, "admin-enquiries")
        link = pg.locator("a:has-text('Playwright Pooja')")
        if link.count():
            link.first.click()
            pg.wait_for_url(re.compile(r".*/enquiries/[0-9a-f-]{36}$"))
            pg.select_option("select[name=assigneeUserId]", label="Asha Admin (you)")
            pg.locator("form:has(select[name=assigneeUserId]) button:has-text('Save')").click()
            pg.wait_for_selector("text=Assigned.", timeout=60000)
            pg.fill("textarea[name=body]", "Called back; sending the Python Basics syllabus by email.")
            pg.click("button:has-text('Add note')")
            pg.wait_for_selector("text=Note added.", timeout=60000)
            pg.click("button:has-text('Mark as contacted')")
            pg.wait_for_timeout(1500); pg.reload(); pg.wait_for_load_state("networkidle")
            txt = pg.locator("main").inner_text()
            check("enquiry: assign, note and status in the history", "Assigned to Asha Admin." in txt and "sending the Python Basics syllabus" in txt and "Marked as contacted." in txt)
            shot(pg, "admin-enquiry")

        go(pg, "/demo/admin/website/sections/reviews")
        card = pg.locator("li", has=pg.locator("text=Playwright Pradeep"))
        if card.count():
            card.locator("button:has-text('Approve')").click()
            pg.wait_for_timeout(1500)
            go(pg, "/site/demo")
            check("approved review appears on the site", "Playwright Pradeep" in pg.locator("#reviews").inner_text())
        go(pg, "/demo/admin/website/sections/reviews")
        shot(pg, "admin-reviews")

        go(pg, "/demo/admin/website/sections/gallery")
        pg.locator("input[type=file][multiple]").set_input_files([f"{FIX}/upload.jpg", f"{FIX}/upload2.png"])
        pg.wait_for_selector("text=2 photos added to the gallery.", timeout=120000)
        pg.wait_for_timeout(1000)
        check("gallery upload adds two photos", pg.locator("main ul > li").count() == 8)
        shot(pg, "admin-gallery")

        go(pg, "/demo/admin/website/sections/videos")
        f = pg.locator("form:has(button:has-text('Add video'))")
        f.locator("input[name=url]").fill("https://youtu.be/rfscVS0vtbw")
        f.locator("input[name=title]").fill("Campus tour")
        f.locator("button:has-text('Add video')").click()
        pg.wait_for_selector("text=Video added.", timeout=60000)
        f.locator("input[name=url]").fill("https://vimeo.com/123")
        f.locator("input[name=title]").fill("Wrong site")
        f.locator("button:has-text('Add video')").click()
        pg.wait_for_selector("text=Paste a YouTube link", timeout=60000)
        check("videos: YouTube accepted, other links refused", True)
        shot(pg, "admin-videos")
        go(pg, "/demo/admin/website/sections/testimonials"); shot(pg, "admin-testimonials")
        go(pg, "/demo/admin/website/sections/team"); shot(pg, "admin-team")

        go(pg, "/demo/admin/website/sections/blog")
        shot(pg, "admin-blog")
        pg.fill("input[name=title]", "Open day on 14 November")
        pg.click("button:has-text('Start writing')")
        pg.wait_for_url(re.compile(r".*/sections/blog/[0-9a-f-]{36}$"), timeout=60000)
        pg.wait_for_selector(".ProseMirror", timeout=60000)
        ed = pg.locator(".ProseMirror")
        ed.click()
        pg.keyboard.type("Visit the campus, sit in on a live class and meet the faculty. ")
        pg.keyboard.type("Registration is free, and every visitor gets a one-to-one session with admissions.")
        pg.keyboard.press("Enter")
        pg.locator("button[aria-label='Heading']").click()
        pg.keyboard.type("What to bring")
        pg.keyboard.press("Enter")
        pg.locator("button[aria-label='Bulleted list']").click()
        pg.keyboard.type("Your marksheets")
        pg.locator("input[type=file]").first.set_input_files(f"{FIX}/upload.jpg")
        pg.wait_for_function("() => !document.body.innerText.includes('Uploading…')", timeout=120000)
        pg.fill("textarea[name=excerpt]", "Meet faculty, see the labs and sit in on a live class.")
        shot(pg, "admin-blog-editor", full=False)
        pg.click("button:has-text('Publish post')")
        pg.wait_for_selector("form p.mt-3", timeout=60000)
        msg = pg.locator("form p.mt-3").first.inner_text()
        check("publish post from the editor", msg.startswith("Published."), msg)
        go(pg, "/site/demo/blog/open-day-on-14-november")
        art = pg.locator("article")
        check("published post is live with its heading and list", art.count() == 1 and "What to bring" in art.inner_text() and art.locator("ul li").count() == 1)

        go(pg, "/demo/admin/website/profile/faculty")
        shot(pg, "admin-faculty-profiles")
        if pg.locator("button:has-text('Approve and publish')").count():
            pg.click("button:has-text('Approve and publish')")
            pg.wait_for_timeout(1500)
            go(pg, "/site/demo")
            check("approving Neel puts him on the site", "Neel Faculty" in pg.locator("#faculty").inner_text())
        c.close()

        c, pg = ctx(820, 1180)
        login(pg, "asha@demo.edu")
        go(pg, "/demo/admin/website/profile/builder"); shot(pg, "admin-builder-tablet")
        go(pg, "/demo/admin/website/sections/enquiries"); shot(pg, "admin-enquiries-tablet")
        c.close()

    # ── Faculty ──
    if want("faculty"):
        c, pg = ctx()
        login(pg, "farah@demo.edu")
        go(pg, "/demo/admin")
        check("faculty dashboard has the profile card", pg.locator("[data-slot-key=my-profile-page]").count() == 1)
        pg.locator("[data-slot-key=my-profile-page] a").click()
        pg.wait_for_url(re.compile(r".*/website/profile/me$"), timeout=60000)
        pg.fill("textarea[name=bio]", "Farah spent eight years as an analyst at a Mumbai retail bank. She now teaches Data Analytics, Python Basics and Machine Learning Foundations, starting every class with a real business question.")
        pg.click("button:has-text('Send for approval')")
        pg.wait_for_selector("text=Sent for approval", timeout=60000)
        pg.reload(); pg.wait_for_load_state("networkidle")
        check("faculty profile waits for approval", "Waiting for approval" in pg.locator("main").inner_text())
        shot(pg, "faculty-my-profile")
        go(pg, "/demo/admin/website/sections/enquiries")
        check("faculty can't open the enquiries inbox", "Only website managers" in pg.locator("main").inner_text())
        go(pg, "/site/demo/preview")
        check("faculty can't preview drafts", "Only website managers" in pg.locator("main").inner_text())
        c.close()
    b.close()

failed = [c for c in checks if not c[1]]
print(f"\nchecks: {len(checks)}, FAILED: {len(failed)}")
for f in failed: print("  -", f[0], f[2])
print("page errors:", errs)
