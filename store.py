"""Booking storage and rules shared by the public site and the admin panel.

Data lives in Supabase (Postgres). The server talks to it over the REST API with
the service_role key, which must stay on the server (never in the browser).
Run supabase/schema.sql once in the Supabase SQL Editor to create the tables.
"""
import hashlib
import hmac
import json
import os
import re
import secrets
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from urllib.parse import quote, urlencode

ROOT = os.path.dirname(os.path.abspath(__file__))
# The public website lives in public/ so that, on Vercel, only those files are
# published to the CDN and the Python next to them stays server-side.
STATIC_ROOT = os.path.join(ROOT, "public")


def _load_env_file():
    """Read KEY=value lines from .env next to this file (without overriding real env vars)."""
    path = os.path.join(ROOT, ".env")
    if not os.path.exists(path):
        return
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


_load_env_file()
SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")

IST = timezone(timedelta(hours=5, minutes=30))  # India has no daylight saving
DEFAULT_CAPACITY = 2
# Signing in lasts only while the admin is actually working: admin.py sends the
# session cookie without an expiry (so it dies when the browser closes) and the
# session itself lapses after this many minutes of inactivity. Every admin
# request slides the window forward, at most once every SESSION_TOUCH_MINUTES.
SESSION_IDLE_MINUTES = 20
SESSION_TOUCH_MINUTES = 3
FULL_MESSAGE = "This time is fully booked. Please select another time."

STATUSES = {
    "confirmed": "Confirmed",
    "completed": "Completed",
    "no_show": "No-show",
    "cancelled": "Cancelled",
}
# Cancelled bookings free their place; every other status keeps it.
ACTIVE = ("confirmed", "completed", "no_show")

SERVICES = [
    "Women's Cut & Style", "Men's Cut", "Kids' Cut (12 & under)", "Signature Blowout",
    "Single-Process Color", "Partial Highlights", "Full Highlights",
    "Keratin Smoothing Treatment", "Brazilian Blowout",
    "Bridal Hair (includes trial)", "Bridal Party Styling", "Event Updo", "Bridal Consultation",
    "Express Cut", "Beard Trim & Shape", "Signature Hot Towel Shave", "Cut + Beard Package",
    "Extensions / Color Consultation",
]

DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


class StoreError(Exception):
    """Supabase could not be reached or returned an unexpected error."""


# ---------- Supabase REST client ----------

def _request(method, path, params=None, body=None, prefer=None):
    url = f"{SUPABASE_URL}/rest/v1/{path}"
    if params:
        url += "?" + urlencode(params, safe="(),.*:")
    headers = {
        "apikey": SERVICE_KEY,
        "Authorization": f"Bearer {SERVICE_KEY}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    if prefer:
        headers["Prefer"] = prefer
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            raw = resp.read()
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")
        try:
            detail = json.loads(detail).get("message", detail)
        except ValueError:
            pass
        raise StoreError(detail) from None
    except (urllib.error.URLError, TimeoutError) as e:
        raise StoreError(f"Could not reach Supabase: {e}") from None
    return json.loads(raw) if raw else None


def _select(table, **params):
    return _request("GET", table, params) or []


def _in(values):
    return "in.(" + ",".join(values) + ")"


def init_db():
    """Check configuration and that schema.sql has been run."""
    if not SUPABASE_URL or not SERVICE_KEY:
        raise SystemExit(
            "Missing Supabase settings. Create a .env file next to server.py with:\n"
            "  SUPABASE_URL=https://<project>.supabase.co\n"
            "  SUPABASE_SERVICE_ROLE_KEY=<service_role key from Project Settings -> API>"
        )
    try:
        _select("settings", select="key", limit="1")
    except StoreError as e:
        if "schema cache" in str(e) or "does not exist" in str(e):
            raise SystemExit("Supabase tables not found. Run supabase/schema.sql in the Supabase SQL Editor first.")
        raise SystemExit(f"Supabase error: {e}")


# ---------- Dates ----------

def today():
    """The salon's current date (India time), whatever timezone the server runs in."""
    return datetime.now(IST).date()


def now_ist():
    return datetime.now(IST)


def parse_date(iso):
    if not iso or not DATE_RE.match(iso):
        return None
    try:
        return datetime.strptime(iso, "%Y-%m-%d").date()
    except ValueError:
        return None


def slots_for(iso):
    """Start times offered on a day. Mirrors slotsFor() in js/main.js:
    Mon–Sat 9:00 AM–6:00 PM, Sun 10:00 AM–3:00 PM, every 30 minutes."""
    d = parse_date(iso)
    if not d:
        return []
    sunday = d.weekday() == 6
    open_h, close_h = (10, 15) if sunday else (9, 18)
    out = []
    for h in range(open_h, close_h + 1):
        for m in (0, 30):
            if h == close_h and m == 30:
                continue
            hour12 = h - 12 if h > 12 else h
            out.append(f"{hour12}:{m:02d} {'PM' if h >= 12 else 'AM'}")
    return out


def time_key(t):
    m = re.match(r"^(\d+):(\d+) (AM|PM)$", t or "")
    if not m:
        return 9999
    h = int(m.group(1)) % 12 + (12 if m.group(3) == "PM" else 0)
    return h * 60 + int(m.group(2))


# ---------- Settings ----------

def get_setting(key, default=None):
    rows = _select("settings", select="value", key=f"eq.{key}")
    return rows[0]["value"] if rows else default


def set_setting(key, value):
    _request("POST", "settings", {"on_conflict": "key"}, {"key": key, "value": str(value)},
             prefer="resolution=merge-duplicates,return=minimal")


def capacity():
    try:
        return max(1, int(get_setting("capacity", DEFAULT_CAPACITY)))
    except ValueError:
        return DEFAULT_CAPACITY


# ---------- Availability ----------

def blocks_for(iso):
    return _select("blocks", select="*", date=f"eq.{iso}", order="id")


def day_block(iso):
    return next((b for b in blocks_for(iso) if b["time"] is None), None)


def blocked_times(iso):
    return {b["time"] for b in blocks_for(iso) if b["time"]}


def slot_counts(iso):
    counts = {}
    for r in _select("bookings", select="time", date=f"eq.{iso}", status=_in(ACTIVE)):
        counts[r["time"]] = counts.get(r["time"], 0) + 1
    return counts


def public_availability(iso):
    """What the booking page needs: blocked slots are reported as full."""
    cap = capacity()
    blocks = blocks_for(iso)
    if any(b["time"] is None for b in blocks):
        return {"max": cap, "counts": {t: cap for t in slots_for(iso)}}
    counts = slot_counts(iso)
    for b in blocks:
        counts[b["time"]] = cap
    return {"max": cap, "counts": counts}


# ---------- Bookings ----------

def create_booking(data, source="website"):
    """Validate and save a booking. Returns (booking_id, None) or (None, (status, message))."""
    b = {k: str(data.get(k) or "").strip() for k in
         ("date", "time", "service", "stylist", "first_name", "last_name", "email", "phone", "notes")}
    b["notes"] = b["notes"][:2000]
    for k in ("service", "stylist", "first_name", "last_name", "email"):
        b[k] = b[k][:200]
    b["phone"] = b["phone"][:40]

    if not parse_date(b["date"]) or b["time"] not in slots_for(b["date"]):
        return None, (400, "Please choose a valid date and time.")
    if b["date"] < today().isoformat():
        return None, (400, "Please choose a date in the future.")
    required = ["service", "first_name", "phone"] + (["last_name", "email"] if source == "website" else [])
    if any(not b[k] for k in required):
        return None, (400, "Please fill in all required details.")

    b["stylist"] = b["stylist"] or "First available stylist"
    b["source"] = source
    try:
        # book_appointment (schema.sql) checks blocks and capacity under a per-slot lock.
        new_id = _request("POST", "rpc/book_appointment", body={"p": b})
    except StoreError as e:
        if "SLOT_FULL" in str(e):
            return None, (409, FULL_MESSAGE)
        raise
    return new_id, None


def get_booking(booking_id):
    rows = _select("bookings", select="*", id=f"eq.{int(booking_id)}")
    return rows[0] if rows else None


def set_status(booking_id, status):
    """Change a booking's status. Restoring a cancelled booking re-checks capacity."""
    if status not in STATUSES:
        return "Unknown status."
    result = _request("POST", "rpc/set_booking_status", body={"p_id": int(booking_id), "p_status": status})
    if result == "SLOT_FULL":
        return "That time is already full, so this booking can't be restored."
    if result == "NOT_FOUND":
        return "Booking not found."
    return None


def sort_rows(rows, reverse=False):
    return sorted(rows, key=lambda r: (r["date"], time_key(r["time"]), r["id"]), reverse=reverse)


def find_bookings(status="", date_from="", date_to="", q="", order="asc"):
    params = {"select": "*"}
    if status in STATUSES:
        params["status"] = f"eq.{status}"
    ranges = []
    if parse_date(date_from):
        ranges.append(f"date.gte.{date_from}")
    if parse_date(date_to):
        ranges.append(f"date.lte.{date_to}")
    if ranges:
        params["and"] = "(" + ",".join(ranges) + ")"
    rows = _select("bookings", **params)
    if q:
        needle = q.lower()
        rows = [r for r in rows if needle in " ".join(
            (f"{r['first_name']} {r['last_name']}", r["phone"], r["email"], r["service"])).lower()]
    return sort_rows(rows, reverse=(order == "desc"))


def bookings_on(iso):
    return sort_rows(_select("bookings", select="*", date=f"eq.{iso}"))


def stats():
    t = today()
    week_end = t + timedelta(days=6)
    month_start = t.replace(day=1)
    rows = _select("bookings", select="date,status,created_at", date=f"gte.{month_start.isoformat()}")
    since = now_ist() - timedelta(hours=24)
    recent = _select("bookings", select="id", created_at=f"gte.{since.isoformat()}")
    active = [r for r in rows if r["status"] in ACTIVE]
    return {
        "today": sum(1 for r in active if r["date"] == t.isoformat()),
        "week": sum(1 for r in active if t.isoformat() <= r["date"] <= week_end.isoformat()),
        "month": sum(1 for r in active if r["date"][:7] == t.isoformat()[:7]),
        "cancelled": sum(1 for r in rows if r["status"] == "cancelled" and r["date"][:7] == t.isoformat()[:7]),
        "new_24h": len(recent),
    }


def upcoming(limit=8):
    rows = _select("bookings", select="*", date=f"gt.{today().isoformat()}", status="eq.confirmed")
    return sort_rows(rows)[:limit]


# ---------- Blocking times ----------

def add_block(iso, time_str=None, reason=""):
    if not parse_date(iso):
        return "Invalid date."
    if time_str and time_str not in slots_for(iso):
        return "Invalid time."
    existing = blocks_for(iso)
    if any(b["time"] == time_str for b in existing):
        return None
    _request("POST", "blocks", body={"date": iso, "time": time_str, "reason": reason[:200]}, prefer="return=minimal")
    return None


def remove_block(block_id):
    _request("DELETE", "blocks", {"id": f"eq.{int(block_id)}"}, prefer="return=minimal")


def upcoming_closures():
    return _select("blocks", select="*", time="is.null", date=f"gte.{today().isoformat()}", order="date")


# ---------- Admin password and sessions ----------

def _hash(password, salt):
    return hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 240_000).hex()


def has_password():
    return bool(os.environ.get("ICONIQ_ADMIN_PASSWORD") or get_setting("admin_password"))


def set_password(password):
    salt = secrets.token_bytes(16)
    set_setting("admin_password", salt.hex() + "$" + _hash(password, salt))


def check_password(password):
    env = os.environ.get("ICONIQ_ADMIN_PASSWORD")
    if env:
        return hmac.compare_digest(password.encode("utf-8"), env.encode("utf-8"))
    stored = get_setting("admin_password")
    if not stored or "$" not in stored:
        return False
    salt_hex, digest = stored.split("$", 1)
    return hmac.compare_digest(_hash(password, bytes.fromhex(salt_hex)), digest)


def _utc_now():
    return datetime.now(timezone.utc)


def create_session():
    token, csrf = secrets.token_urlsafe(32), secrets.token_urlsafe(24)
    _request("DELETE", "admin_sessions", {"expires": f"lt.{_utc_now().isoformat()}"}, prefer="return=minimal")
    _request("POST", "admin_sessions", body={
        "token": token, "csrf": csrf,
        "expires": (_utc_now() + timedelta(minutes=SESSION_IDLE_MINUTES)).isoformat(),
    }, prefer="return=minimal")
    return token


def touch_session(row):
    """Push an active session's idle deadline back. Skipped when it was just moved."""
    try:
        expires = datetime.fromisoformat(row["expires"])
    except (KeyError, TypeError, ValueError):
        return
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    now = _utc_now()
    if expires - now > timedelta(minutes=SESSION_IDLE_MINUTES - SESSION_TOUCH_MINUTES):
        return
    _request("PATCH", "admin_sessions", {"token": f"eq.{row['token']}"},
             body={"expires": (now + timedelta(minutes=SESSION_IDLE_MINUTES)).isoformat()},
             prefer="return=minimal")


def get_session(token):
    if not token or not re.match(r"^[A-Za-z0-9_-]{20,100}$", token):
        return None
    rows = _select("admin_sessions", select="*", token=f"eq.{token}", expires=f"gt.{_utc_now().isoformat()}")
    return rows[0] if rows else None


def end_session(token, everywhere=False):
    if everywhere:
        _request("DELETE", "admin_sessions", {"token": "not.is.null"}, prefer="return=minimal")
    elif token and re.match(r"^[A-Za-z0-9_-]{20,100}$", token):
        _request("DELETE", "admin_sessions", {"token": f"eq.{token}"}, prefer="return=minimal")
