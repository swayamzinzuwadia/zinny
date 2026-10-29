"""
Payments click-through in mock (test) mode, with screenshots.

  npm run db:seed && npm run dev        # port from .env.local (payments: 3106)
  python3 -I tests/payments/e2e/mock_flow.py http://localhost:3106 docs/handoff/payments [parts]

parts (comma separated, default all): A (Accounts dashboard, Sales, refund), B (staff views,
downloads, CSV, settings), B2 (tablet, HOD/faculty/Board access), C (student checkout and
test-mode payment), C3 (learner invoices), C2 (other students), E (failed payment).
A, C and E change data: run db:seed again before repeating them.
"""
import re, subprocess, sys
from playwright.sync_api import sync_playwright

BASE, OUT = sys.argv[1], sys.argv[2]
PARTS = sys.argv[3].split(",") if len(sys.argv) > 3 else ["A", "B", "B2", "C", "C2", "E"]
errs, fails = [], []


def check(cond, msg):
    print(("ok   " if cond else "FAIL ") + msg)
    if not cond:
        fails.append(msg)


def login(page, email):
    page.goto(f"{BASE}/login")
    demo = page.locator("form", has=page.locator(f"input[value='{email}']"))
    if demo.count():
        demo.locator("button").click()
    else:
        page.fill("input[name=email]", email)
        page.fill("input[name=password]", "zinny123")
        page.click("button:has-text('Sign in')")
    page.wait_for_url(lambda u: "/demo/" in u, timeout=240000)
    page.wait_for_load_state("networkidle")


with sync_playwright() as p:
    b = p.chromium.launch(args=["--disable-dev-shm-usage", "--disable-gpu", "--js-flags=--max-old-space-size=192", "--renderer-process-limit=1"])
    live = []

    def pg(w=1440, h=960):
        while len(live) > 1:
            live.pop(0).close()
        c = b.new_context(viewport={"width": w, "height": h}, device_scale_factor=1, accept_downloads=True)
        live.append(c)
        x = c.new_page()
        x.set_default_timeout(240000); x.set_default_navigation_timeout(240000)
        x.on("pageerror", lambda e: errs.append(str(e)))
        return x

    def shot(page, name, full=True):
        page.screenshot(path=f"{OUT}/{name}.png", full_page=full)

    if "A" in PARTS:
        # Accounts: dashboard card for the seeded refund_due order.
        page = pg()
        login(page, "arun@demo.edu")
        body = page.inner_text("body")
        check("Refunds to send" in body and "Neil Joshi" in body, "Accounts dashboard shows the refund_due order")
        shot(page, "admin-dashboard-refunds-card")

        # Accounts: Sales.
        page.goto(f"{BASE}/demo/admin/finance/sales")
        page.wait_for_load_state("networkidle")
        body = page.inner_text("body")
        check("Gross collected" in body and "DEMO/" in body, "Sales shows totals and GST invoice numbers")
        check("Partly refunded" in body and "Refund due" in body, "Sales shows partly refunded and refund due orders")
        shot(page, "sales-desktop")

        # Filters: status + search.
        page.select_option("select[name=status]", "refund_due")
        page.click("button:has-text('Apply filters')")
        page.wait_for_url(re.compile(r".*status=refund_due.*"))
        page.wait_for_load_state("networkidle")
        rows = page.locator("table tbody tr")
        check(rows.count() == 1 and "Neil Joshi" in rows.first.inner_text(), "status filter shows only the refund_due order")
        page.click("table >> text=Neil Joshi")
        page.wait_for_url(re.compile(r".*order=.*"))
        page.wait_for_load_state("networkidle")
        body = page.inner_text("body")
        check("Refund this order" in body and "wasn't enrolled" in body, "order panel offers a full refund for refund_due")
        shot(page, "sales-order-refund-due")

        # Send the refund.
        page.on("dialog", lambda d: d.accept())
        page.fill("textarea[name=reason]", "Paid twice for Digital Marketing")
        page.click("button:has-text('Send refund')")
        page.wait_for_selector("text=refunded. The student is notified", timeout=240000)
        page.reload()
        page.wait_for_load_state("networkidle")
        body = page.inner_text("body")
        check("Paid twice for Digital Marketing" in body and "Refunded" in body, "refund appears in the order's refund history")
        shot(page, "sales-order-refunded")

    if "B" in PARTS:
        # Riya's partly refunded order.
        page = pg()
        login(page, "arun@demo.edu")
        page.goto(f"{BASE}/demo/admin/finance/sales?q=riya")
        page.wait_for_load_state("networkidle")
        link = page.locator("tr", has_text="Python Basics").locator("a").first
        link.click()
        page.wait_for_url(re.compile(r".*order=.*"))
        page.wait_for_load_state("networkidle")
        body = page.inner_text("body")
        check("Merit scholarship" in body and "Up to ₹3,720 can be refunded" in body, "partial refund history and refundable amount")
        shot(page, "sales-order-partly-refunded")
        # Staff invoice download.
        href = page.locator("a:has-text('Download PDF')").first.get_attribute("href")
        r = page.request.get(f"{BASE}{href}", timeout=240000)
        check(r.status == 200 and r.headers["content-type"] == "application/pdf" and r.body()[:5] == b"%PDF-", "staff download the invoice PDF from Sales")
        open(f"{OUT}/invoice-sample.pdf", "wb").write(r.body())

        # CSV export.
        r = page.request.get(f"{BASE}/demo/admin/finance/sales/export", timeout=240000)
        text = r.text()
        check(r.status == 200 and "text/csv" in r.headers["content-type"] and "Gateway payment id" in text and text.count("\n") >= 30, "CSV export")

        # Settings.
        page.goto(f"{BASE}/demo/admin/finance/sales/settings")
        page.wait_for_load_state("networkidle")
        body = page.inner_text("body")
        check("Confirm the SAC code with your chartered accountant" in body and "27AABCD1234E1Z5" in body, "invoice settings with CA note and seller details")
        shot(page, "sales-invoice-settings")

    if "B2" in PARTS:
        # Tablet.
        page = pg(820, 1180)
        login(page, "arun@demo.edu")
        page.goto(f"{BASE}/demo/admin/finance/sales")
        page.wait_for_load_state("networkidle")
        shot(page, "sales-tablet")

        # HOD and faculty: no access.
        for email in ["hema@demo.edu", "farah@demo.edu"]:
            page = pg()
            login(page, email)
            page.goto(f"{BASE}/demo/admin/finance/sales")
            page.wait_for_load_state("networkidle")
            body = page.inner_text("body")
            check("You don't have access to Sales" in body and "Gross collected" not in body, f"{email} can't open Sales")
        shot(page, "sales-no-access-faculty")

        # Board: view only.
        page = pg()
        login(page, "bharat@demo.edu")
        page.goto(f"{BASE}/demo/admin/finance/sales?status=refunded")
        page.wait_for_load_state("networkidle")
        page.locator("table tbody tr a").first.click()
        page.wait_for_url(re.compile(r".*order=.*"))
        page.wait_for_load_state("networkidle")
        check("Send refund" not in page.inner_text("body"), "Board sees no refund form")

    if "C" in PARTS:
        # Student: Tara enrols into Data Analytics through the test-mode checkout.
        page = pg()
        login(page, "tara@demo.edu")
        page.goto(f"{BASE}/demo/learn/courses")
        page.click("text=Data Analytics")
        page.wait_for_selector("text=Pick your batch")
        page.locator("label", has_text="Weekday morning").click()
        page.click("text=/Continue/")
        page.wait_for_selector("text=Enrol anyway")
        page.click("text=Enrol anyway")
        page.wait_for_url(re.compile(r".*/checkout/.*"))
        page.wait_for_load_state("networkidle")
        checkout_url = page.url
        body = page.inner_text("body")
        check("₹14,160" in body and "CGST 9%" in body and "SGST 9%" in body and "₹1,080" in body, "checkout shows the GST split and total")
        check("Your seat is held for" in body, "checkout shows the seat-hold countdown")
        shot(page, "checkout-desktop")
        m = pg(390, 844)
        login(m, "tara@demo.edu")
        m.goto(checkout_url)
        m.wait_for_load_state("networkidle")
        shot(m, "checkout-mobile")
        w = m.evaluate("document.documentElement.scrollWidth")
        check(w <= 390, f"checkout fits 390 px (scrollWidth {w})")
        page.click("text=/Pay/")
        page.wait_for_url(re.compile(r".*/timetable.*"))
        check("You're enrolled" in page.inner_text("body") or "You’re enrolled" in page.inner_text("body"), "test-mode payment enrols the student")
        page.goto(checkout_url)
        page.wait_for_load_state("networkidle")
        check("Payment received" in page.inner_text("body"), "paid checkout shows the receipt state")

    if "C3" in PARTS:
        # Invoices page, desktop and mobile.
        page = pg()
        login(page, "tara@demo.edu")
        m = pg(390, 844)
        login(m, "tara@demo.edu")
        page.goto(f"{BASE}/demo/learn/invoices")
        page.wait_for_load_state("networkidle")
        body = page.inner_text("body")
        check("Data Analytics" in body and "DEMO/" in body and "₹14,160" in body, "learner invoices list the new invoice")
        shot(page, "learn-invoices-desktop")
        href = page.locator("a:has-text('Download PDF')").first.get_attribute("href")
        r = page.request.get(f"{BASE}{href}", timeout=240000)
        check(r.status == 200 and r.body()[:5] == b"%PDF-" and "attachment" in r.headers["content-disposition"], "student downloads the invoice PDF")
        open(f"{OUT}/invoice-tara.pdf", "wb").write(r.body())
        m.goto(f"{BASE}/demo/learn/invoices")
        m.wait_for_load_state("networkidle")
        shot(m, "learn-invoices-mobile")
        w = m.evaluate("document.documentElement.scrollWidth")
        check(w <= 390, f"invoices fit 390 px (scrollWidth {w})")

    if "C2" in PARTS:
        # Another student can't download Tara's invoice.
        tara = pg()
        login(tara, "tara@demo.edu")
        tara.goto(f"{BASE}/demo/learn/invoices")
        tara.wait_for_load_state("networkidle")
        href = tara.locator("a:has-text('Download PDF')").first.get_attribute("href")
        other = pg()
        login(other, "riya@demo.edu")
        r = other.request.get(f"{BASE}{href}", timeout=240000)
        check(r.status == 404, f"another student gets 404 for Tara's invoice ({r.status})")
        other.goto(f"{BASE}/demo/learn/my")
        other.wait_for_load_state("networkidle")
        body = other.inner_text("body")
        check("Invoices" in body and "All invoices" in body, "My learning shows the invoices section")
        other.goto(f"{BASE}/demo/learn/invoices")
        other.wait_for_load_state("networkidle")
        check("Partly refunded" in other.inner_text("body"), "Riya sees her partly refunded invoice")
        mm = pg(390, 844)
        login(mm, "riya@demo.edu")
        mm.goto(f"{BASE}/demo/learn/my")
        mm.wait_for_load_state("networkidle")
        shot(mm, "learn-my-invoices-section-mobile")

    if "E" in PARTS:
        # Failure path in test mode: Diya starts a checkout and simulates a failed payment.
        page = pg()
        login(page, "diya@demo.edu")
        page.goto(f"{BASE}/demo/learn/courses")
        page.click("text=Digital Marketing")
        page.wait_for_selector("text=Pick your batch")
        page.locator("label", has_text="Saturday intensive").click()
        page.click("text=/Continue/")
        for _ in range(240):
            if "/checkout/" in page.url:
                break
            if page.locator("text=Enrol anyway").count():
                page.click("text=Enrol anyway")
                page.wait_for_url(re.compile(r".*/checkout/.*"))
                break
            page.wait_for_timeout(1000)
        page.wait_for_load_state("networkidle")
        page.click("button:has-text('Simulate a failed payment')")
        page.wait_for_selector("text=didn't go through", timeout=240000)
        check("Pick a batch again" in page.inner_text("body"), "failed payment releases the seat and offers to pick again")
        shot(page, "checkout-failed")

    b.close()

for name in ["invoice-tara"] if "C3" in PARTS else []:
    subprocess.run(["pdftoppm", "-r", "90", "-png", "-singlefile", f"{OUT}/{name}.pdf", f"{OUT}/invoice-pdf"], check=False)

print("page errors:", errs)
print("FAILED:", len(fails))
for f in fails:
    print("  -", f)
