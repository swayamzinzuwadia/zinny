"""
Razorpay-mode click-through: the dev server runs with Razorpay test keys pointed at fake_rzp.py,
and Playwright serves a fake checkout.js that behaves like Razorpay Checkout (handler, ondismiss,
payment.failed) using signatures from the fake API.

  npm run db:seed
  python3 -I tests/payments/e2e/fake_rzp.py 4106 rzp_test_E2eZinnyKey e2e_key_secret_77 &
  RAZORPAY_KEY_ID=rzp_test_E2eZinnyKey RAZORPAY_KEY_SECRET=e2e_key_secret_77 \
  RAZORPAY_WEBHOOK_SECRET=e2e_webhook_secret_99 RAZORPAY_API_BASE=http://127.0.0.1:4106/v1 npm run dev &
  python3 -I tests/payments/e2e/rzp_flow.py http://localhost:3106 http://127.0.0.1:4106 e2e_webhook_secret_99 docs/handoff/payments
"""
import hashlib, hmac, json, re, sys, time, urllib.request
from playwright.sync_api import sync_playwright

BASE, FAKE, WHSEC, OUT = sys.argv[1:5]
errs, fails = [], []

FAKE_CHECKOUT_JS = """
window.Razorpay = class {
  constructor(o) { this.o = o; this.failed = []; }
  on(ev, cb) { if (ev === 'payment.failed') this.failed.push(cb); }
  open() {
    const o = this.o, self = this;
    window.__rzpOptions = o;
    const box = document.createElement('div');
    box.id = 'fake-rzp';
    box.style = 'position:fixed;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;z-index:99';
    box.innerHTML = '<div style="background:#fff;padding:24px;border-radius:12px;font:14px sans-serif;width:300px">' +
      '<b>Fake Razorpay</b><p>' + o.name + '<br>' + o.description + '<br>INR ' + (o.amount/100) + '</p>' +
      '<button id="rzp-ok">Complete UPI payment</button> <button id="rzp-fail">Decline</button> <button id="rzp-close">Close</button></div>';
    document.body.appendChild(box);
    const call = (fail) => fetch('FAKE/test/pay', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({order_id:o.order_id, fail, notes:o.notes})}).then(r => r.json());
    box.querySelector('#rzp-ok').onclick = async () => { const r = await call(false); box.remove(); o.handler({razorpay_payment_id:r.razorpay_payment_id, razorpay_order_id:r.razorpay_order_id, razorpay_signature:r.razorpay_signature}); };
    box.querySelector('#rzp-fail').onclick = async () => { const r = await call(true); self.failed.forEach(cb => cb({error:{code:'BAD_REQUEST_ERROR', description:'Payment was declined by the bank.', reason:'payment_failed'}})); };
    box.querySelector('#rzp-close').onclick = () => { box.remove(); o.modal && o.modal.ondismiss && o.modal.ondismiss(); };
  }
};
""".replace("FAKE", FAKE)


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


def start_checkout(page, course, batch):
    page.goto(f"{BASE}/demo/learn/courses")
    page.click(f"text={course}")
    page.wait_for_selector("text=Pick your batch")
    page.locator("label", has_text=batch).click()
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
    page.wait_for_selector("button:has-text('Pay ₹')", timeout=240000)


def webhook(body):
    raw = json.dumps(body).encode()
    sig = hmac.new(WHSEC.encode(), raw, hashlib.sha256).hexdigest()
    req = urllib.request.Request(f"{BASE}/api/payments/razorpay", data=raw, method="POST", headers={"content-type": "application/json", "x-razorpay-signature": sig, "x-razorpay-event-id": f"evt_{time.time_ns()}"})
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")


with sync_playwright() as p:
    b = p.chromium.launch(args=["--disable-dev-shm-usage", "--disable-gpu", "--js-flags=--max-old-space-size=192", "--renderer-process-limit=1"])
    live = []

    def pg(w=1440, h=960):
        while len(live) > 1:
            live.pop(0).close()
        c = b.new_context(viewport={"width": w, "height": h})
        c.route("https://checkout.razorpay.com/v1/checkout.js", lambda route: route.fulfill(status=200, content_type="application/javascript", body=FAKE_CHECKOUT_JS))
        live.append(c)
        x = c.new_page()
        x.set_default_timeout(240000); x.set_default_navigation_timeout(240000)
        x.on("pageerror", lambda e: errs.append(str(e)))
        return x

    # 1. Success through Razorpay Checkout.
    page = pg()
    login(page, "tara@demo.edu")
    start_checkout(page, "Data Analytics", "Weekday morning")
    body = page.inner_text("body")
    check("UPI, cards or netbanking, through Razorpay" in body and "Razorpay test mode" in body, "Razorpay checkout shows methods and test mode")
    page.screenshot(path=f"{OUT}/checkout-razorpay-desktop.png", full_page=True)
    page.click("button:has-text('Pay ₹14,160')")
    page.wait_for_selector("#fake-rzp")
    opts = page.evaluate("window.__rzpOptions")
    check(opts["amount"] == 1416000 and opts["currency"] == "INR" and opts["order_id"].startswith("order_") and opts["key"].startswith("rzp_test_"), "Checkout gets the order, amount and public key")
    check("secret" not in json.dumps(opts).lower(), "no secret reaches the browser")
    check([i["method"] for i in opts["config"]["display"]["blocks"]["main"]["instruments"]] == ["upi", "card", "netbanking"], "UPI, cards and netbanking only")
    page.screenshot(path=f"{OUT}/checkout-razorpay-open.png")
    page.click("#rzp-ok")
    page.wait_for_url(re.compile(r".*/timetable.*"), timeout=240000)
    check("enrolled" in page.inner_text("body"), "verified payment enrols the student")

    # The webhook for the same payment arrives afterwards: no change.
    state = json.loads(urllib.request.urlopen(f"{FAKE}/test/state").read())
    pay = list(state["payments"].values())[-1]
    status, res = webhook({"entity": "event", "event": "payment.captured", "payload": {"payment": {"entity": pay}}, "created_at": int(time.time())})
    check(status == 200 and res.get("outcome") == "already_paid", f"late webhook is harmless ({status} {res})")
    raw = json.dumps({"x": 1}).encode()
    req = urllib.request.Request(f"{BASE}/api/payments/razorpay", data=raw, method="POST", headers={"content-type": "application/json", "x-razorpay-signature": "bad"})
    try:
        urllib.request.urlopen(req)
        check(False, "bad webhook signature is refused")
    except urllib.error.HTTPError as e:
        check(e.code == 400, f"bad webhook signature is refused ({e.code})")

    # 2. A declined payment, then closing the window: the seat is released.
    page = pg()
    login(page, "diya@demo.edu")
    start_checkout(page, "Digital Marketing", "Saturday intensive")
    page.click("button:has-text('Pay ₹')")
    page.wait_for_selector("#fake-rzp")
    page.click("#rzp-fail")
    page.wait_for_selector("text=declined by the bank", timeout=240000)
    page.screenshot(path=f"{OUT}/checkout-razorpay-failed.png", full_page=True)
    page.click("#rzp-close")
    page.wait_for_selector("text=didn't go through", timeout=240000)
    check("Pick a batch again" in page.inner_text("body"), "failed and closed checkout releases the seat")

    # 3. Closing the window without paying.
    page = pg()
    login(page, "neil@demo.edu")
    start_checkout(page, "Machine Learning Foundations", "Morning")
    page.click("button:has-text('Pay ₹')")
    page.wait_for_selector("#fake-rzp")
    page.click("#rzp-close")
    page.wait_for_selector("text=Pick a batch again", timeout=240000)
    check(True, "dismissed checkout releases the seat")

    # 4. Accounts refunds part of Tara's Razorpay payment.
    page = pg()
    login(page, "arun@demo.edu")
    page.goto(f"{BASE}/demo/admin/finance/sales?q=tara")
    page.wait_for_load_state("networkidle")
    page.locator("tr", has_text="Data Analytics").locator("a").first.click()
    page.wait_for_url(re.compile(r".*order=.*"))
    page.wait_for_load_state("networkidle")
    body = page.inner_text("body")
    check("Razorpay" in body and "pay_" in body and "order_" in body, "order panel shows the Razorpay ids")
    page.on("dialog", lambda d: d.accept())
    page.fill("input[name=amount]", "2000")
    page.fill("textarea[name=reason]", "Early-bird discount")
    page.click("button:has-text('Send refund')")
    page.wait_for_selector("text=₹2,000 refunded", timeout=240000)
    state = json.loads(urllib.request.urlopen(f"{FAKE}/test/state").read())
    check(any(r["amount"] == 200000 for r in state["refunds"].values()), "the refund went to the Razorpay API")
    page.reload()
    page.wait_for_load_state("networkidle")
    page.screenshot(path=f"{OUT}/sales-razorpay-refund.png", full_page=True)
    b.close()

print("page errors:", errs)
print("FAILED:", len(fails))
for f in fails:
    print("  -", f)
