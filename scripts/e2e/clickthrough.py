"""Click through Zinny as each role, check key content, and save screenshots."""
import re, sys, time
from playwright.sync_api import sync_playwright, expect

BASE = "http://localhost:3000"
OUT = sys.argv[1]
errors = []

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

def shot(page, name):
    page.screenshot(path=f"{OUT}/{name}.png", full_page=True)

def check(cond, msg):
    if not cond:
        errors.append(msg)
        print("FAIL:", msg)
    else:
        print("ok:", msg)

with sync_playwright() as p:
    b = p.chromium.launch()
    console_errors = []

    def new_page(w=1360, h=900):
        ctx = b.new_context(viewport={"width": w, "height": h})
        pg = ctx.new_page()
        pg.on("pageerror", lambda e: console_errors.append(str(e)))
        return pg

    # HOD: dashboard with pending switch + expiry alert, course batches
    page = new_page()
    login(page, "hema@demo.edu")
    check("/demo/admin" in page.url, f"HOD lands on admin ({page.url})")
    body = page.inner_text("body")
    check("Kabir Mehta" in body, "HOD sees Kabir's switch request")
    check("needs a new faculty member" in body, "HOD sees visiting-faculty expiry alert")
    check("Finance" not in page.inner_text("aside"), "HOD has no Finance menu")
    shot(page, "01-hod-dashboard")
    page.click("aside >> text=Courses")
    page.wait_for_url(re.compile(r".*/products/courses$"))
    page.wait_for_load_state("networkidle")
    shot(page, "02-hod-courses")
    page.click("table >> text=Data Analytics")
    page.wait_for_url(re.compile(r".*/courses/[0-9a-f-]{36}.*"))
    page.wait_for_selector("text=Weekday morning")
    body = page.inner_text("body")
    check("12 seats left" in body and "5 seats left" in body and "Full" in body, "batch cards show 12 left / 5 left / Full")
    shot(page, "03-hod-course-batches")
    # approve Kabir's switch from the course page
    page.locator("button[value^='approve|']").first.click()
    page.wait_for_selector("text=The student's timetable is updated", timeout=10000)
    check("Approved" in page.inner_text("body"), "HOD approves the switch")
    page.reload()
    body = page.inner_text("body")
    check("4 seats left" in body, "evening batch now shows 4 seats left")
    check("13 seats left" in body, "morning batch now shows 13 seats left")
    page.click("a:has-text('Weekday evening')")
    page.wait_for_url(re.compile(r".*/batches/.*"))
    page.wait_for_selector("text=Students")
    check("Kabir Mehta" in page.inner_text("body"), "Kabir is on the evening roster")
    shot(page, "04-hod-batch-detail")

    # Student Riya: PRD page 6 week, then enrol into a clashing batch
    page = new_page(390, 844)
    login(page, "riya@demo.edu")
    check("/demo/learn" in page.url, "student lands on learner app")
    shot(page, "05-student-home-mobile")
    page.goto(f"{BASE}/demo/learn/timetable")
    page.click("text=Next →")
    page.wait_for_url(re.compile(r".*week=.*"))
    page.wait_for_load_state("networkidle")
    body = page.inner_text("body")
    check(body.count("Data Analytics") >= 5 and "Digital Marketing" in body and "Python Basics" in body, "Riya's next week has DA Mon–Fri, DM, Python")
    shot(page, "06-student-timetable-mobile")

    page = new_page()
    login(page, "riya@demo.edu")
    page.goto(f"{BASE}/demo/learn/timetable")
    page.click("text=Next →")
    page.wait_for_url(re.compile(r".*week=.*"))
    page.wait_for_load_state("networkidle")
    shot(page, "07-student-timetable-desktop")

    # Tara: enrol into DA Weekend? (full) -> pick Weekday morning, she has Python weekend + DM evening; no clash for morning.
    page = new_page()
    login(page, "tara@demo.edu")
    page.goto(f"{BASE}/demo/learn/courses")
    page.click("text=Data Analytics")
    page.wait_for_url(re.compile(r".*/learn/courses/.+"))
    page.wait_for_selector("text=Pick your batch")
    shot(page, "08-student-batch-picker")
    full = page.locator("label", has_text="Weekend").locator("input")
    check(full.is_disabled(), "full Weekend batch can't be picked")
    page.locator("label", has_text="Weekday evening").click()
    page.click("text=/Continue/")
    page.wait_for_selector("text=clashes with your timetable", timeout=10000)
    body = page.inner_text("body")
    check("clashes with your timetable" in body, "clash warning for evening batch vs Digital Marketing")
    shot(page, "09-student-clash-warning")
    page.click("text=Pick another batch")
    page.locator("label", has_text="Weekday morning").click()
    page.click("text=/Continue/")
    # Tara's Machine Learning batch (10–12) overlaps the morning batch too: acknowledge and go on.
    page.wait_for_selector("text=Enrol anyway", timeout=10000)
    check("Machine Learning" in page.inner_text("body"), "clash warning names the overlapping ML batch")
    page.click("text=Enrol anyway")
    page.wait_for_url(re.compile(r".*/checkout/.*"))
    body = page.inner_text("body")
    check("₹14,160" in body, "checkout total is ₹12,000 + 18% GST = ₹14,160")
    shot(page, "10-student-checkout")
    page.click("text=/Pay/")
    page.wait_for_url(re.compile(r".*/timetable.*"))
    check("You’re enrolled" in page.inner_text("body") or "You're enrolled" in page.inner_text("body"), "payment enrols the student")

    # Faculty Vikram: sees only weekend batch
    page = new_page()
    login(page, "vikram@demo.edu")
    aside = page.inner_text("aside")
    check("Finance" not in aside and "Website" not in aside, "visiting faculty only sees Products and Users")
    page.goto(f"{BASE}/demo/admin/users/students")
    body = page.inner_text("body")
    check("Sneha Patil" in body and "Riya Sharma" not in body, "visiting faculty sees only own students")
    shot(page, "11-visiting-faculty-students")

    # Accounts: sales with GST invoices
    page = new_page()
    login(page, "arun@demo.edu")
    page.goto(f"{BASE}/demo/admin/finance/sales")
    body = page.inner_text("body")
    check("DEMO/" in body, "sales list shows GST invoice numbers")
    shot(page, "12-accounts-sales")

    # Admin: roles matrix + import page + people
    page = new_page()
    login(page, "asha@demo.edu")
    page.goto(f"{BASE}/demo/admin/users/roles")
    shot(page, "13-admin-roles-matrix")
    page.goto(f"{BASE}/demo/admin/users/teaching")
    shot(page, "14-admin-teaching")
    page.goto(f"{BASE}/demo/admin/users/import")
    page.click("text=Check file")
    page.wait_for_selector("text=look good", timeout=10000)
    check("look good" in page.inner_text("body"), "CSV check passes on the sample")
    shot(page, "15-admin-import")

    # Board: read-only
    page = new_page()
    login(page, "bharat@demo.edu")
    page.goto(f"{BASE}/demo/admin/products/courses")
    check("New course" not in page.inner_text("body"), "Board can't create courses")

    # Support agent: enter support mode
    page = new_page()
    login(page, "sid@zinny.demo")
    check("/platform" in page.url, "support agent lands on Zinny team panel")
    page.fill("input[name=reason]", "Ticket 4512: help with batches")
    page.click("text=Enter support mode")
    page.wait_for_url(re.compile(r".*/demo/admin"))
    check("Support mode" in page.inner_text("body"), "support-mode banner shows")
    shot(page, "16-support-mode")
    page.click("text=Leave support mode")
    page.wait_for_url(re.compile(r".*/platform"))
    check("support.enter" in page.inner_text("body"), "support log lists the session")
    shot(page, "17-platform")

    # Parent: read-only child week
    page = new_page(390, 844)
    login(page, "pallavi@demo.edu")
    check("Riya Sharma" in page.inner_text("body"), "parent sees Riya's week")
    shot(page, "18-parent-mobile")

    # Login page
    page = new_page()
    page.goto(f"{BASE}/login")
    shot(page, "00-login")

    b.close()

print("\nPAGE ERRORS:", console_errors)
print("FAILED:", len(errors))
for e in errors:
    print(" -", e)
