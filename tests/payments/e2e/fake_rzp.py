"""
A tiny fake Razorpay API for the browser click-through (Razorpay's servers aren't reachable here).
  python3 -I fake_rzp.py <port> <key_id> <key_secret>
Implements the calls Zinny makes, checks Basic auth, and signs payments with real HMAC.
Extra test endpoints (CORS open): POST /test/pay {order_id, fail?} -> {razorpay_payment_id, razorpay_order_id, razorpay_signature}
"""
import base64, hashlib, hmac, json, secrets, sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT, KEY_ID, SECRET = int(sys.argv[1]), sys.argv[2], sys.argv[3]
AUTH = "Basic " + base64.b64encode(f"{KEY_ID}:{SECRET}".encode()).decode()
orders, payments, refunds = {}, {}, {}


def rid(p):
    return f"{p}_{secrets.token_hex(7)}"


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def send(self, code, body):
        data = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("content-type", "application/json")
        self.send_header("access-control-allow-origin", "*")
        self.send_header("access-control-allow-headers", "content-type")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def body(self):
        n = int(self.headers.get("content-length") or 0)
        return json.loads(self.rfile.read(n) or b"{}")

    def do_OPTIONS(self):
        self.send(204, {})

    def do_GET(self):
        p = self.path.split("?")[0]
        if p.startswith("/test/"):
            return self.send(200, {"orders": orders, "payments": payments, "refunds": refunds})
        if self.headers.get("authorization") != AUTH:
            return self.send(401, {"error": {"code": "BAD_REQUEST_ERROR", "description": "Authentication failed"}})
        parts = p.strip("/").split("/")
        if len(parts) == 3 and parts[1] == "payments":
            pay = payments.get(parts[2])
            return self.send(200, pay) if pay else self.send(400, {"error": {"description": "The id provided does not exist"}})
        if len(parts) == 4 and parts[1] == "orders" and parts[3] == "payments":
            return self.send(200, {"items": [x for x in payments.values() if x["order_id"] == parts[2]]})
        if len(parts) == 4 and parts[1] == "payments" and parts[3] == "refunds":
            return self.send(200, {"items": [x for x in refunds.values() if x["payment_id"] == parts[2]]})
        self.send(404, {"error": {"description": "no route"}})

    def do_POST(self):
        p = self.path.split("?")[0]
        b = self.body()
        if p == "/test/pay":
            o = orders[b["order_id"]]
            pay = {"id": rid("pay"), "entity": "payment", "order_id": o["id"], "amount": o["amount"], "currency": "INR", "status": "failed" if b.get("fail") else "captured", "method": "upi", "captured": not b.get("fail"), "notes": b.get("notes", {})}
            if b.get("fail"):
                pay.update(error_code="BAD_REQUEST_ERROR", error_description="Payment was declined by the bank.")
            payments[pay["id"]] = pay
            sig = hmac.new(SECRET.encode(), f"{o['id']}|{pay['id']}".encode(), hashlib.sha256).hexdigest()
            return self.send(200, {"razorpay_payment_id": pay["id"], "razorpay_order_id": o["id"], "razorpay_signature": sig, "payment": pay})
        if self.headers.get("authorization") != AUTH:
            return self.send(401, {"error": {"code": "BAD_REQUEST_ERROR", "description": "Authentication failed"}})
        parts = p.strip("/").split("/")
        if p == "/v1/orders":
            o = {"id": rid("order"), "entity": "order", "amount": b["amount"], "currency": b["currency"], "receipt": b.get("receipt"), "notes": b.get("notes", {}), "status": "created"}
            orders[o["id"]] = o
            return self.send(200, o)
        if len(parts) == 4 and parts[1] == "payments" and parts[3] == "capture":
            pay = payments[parts[2]]
            pay["status"] = "captured"
            return self.send(200, pay)
        if len(parts) == 4 and parts[1] == "payments" and parts[3] == "refund":
            pay = payments[parts[2]]
            r = {"id": rid("rfnd"), "entity": "refund", "payment_id": pay["id"], "amount": b["amount"], "currency": "INR", "status": "processed", "notes": b.get("notes", {}), "receipt": b.get("receipt")}
            refunds[r["id"]] = r
            return self.send(200, r)
        self.send(404, {"error": {"description": "no route"}})


print(f"fake razorpay on {PORT}", flush=True)
ThreadingHTTPServer(("127.0.0.1", PORT), H).serve_forever()
