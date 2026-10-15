#!/usr/bin/env python3
"""Local-first RECLAIM & REPURPOSE MVP. Standard-library only; not production-authenticated."""
from __future__ import annotations

import csv
import html
from contextlib import contextmanager
import io
import math
import os
import sqlite3
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse
from wsgiref.simple_server import make_server

ROOT = Path(__file__).resolve().parent
DB_PATH = Path(os.environ.get("RECLAIM_DB_PATH", ROOT / "data" / "reclaim.db"))
COUNTRIES = {"Botswana": "BWP", "Eswatini": "SZL"}
MATERIALS = {"Aluminium cans", "PET plastic", "Glass", "Paper", "Cardboard", "Mixed recyclables", "Other non-hazardous"}
MEASUREMENT = {"ESTIMATE", "MEASURED", "VERIFIED"}
COLLECTION_STATUS = {"RECORDED", "SORTED", "HANDED_OVER", "RECOVERY_VERIFIED", "CANCELLED"}
HANDOVER_STATUS = {"PLANNED", "DELIVERED", "ACCEPTED", "PARTIALLY_REJECTED", "REJECTED", "UNRESOLVED"}
FINANCE_KIND = {"COST", "REVENUE"}
FINANCE_STATUS = {"PLANNED", "QUOTED", "INCURRED", "INVOICED", "PAID", "RECEIVED", "CANCELLED"}
COMPLIANCE_STATUS = {"NOT_ASSESSED", "REQUIRED", "REQUESTED", "APPROVED", "REFUSED", "NOT_APPLICABLE"}
UNITS = {"kg", "g", "item", "bag", "crate"}

SCHEMA = """
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS sites (
 id INTEGER PRIMARY KEY, country TEXT NOT NULL CHECK(country IN ('Botswana','Eswatini')),
 name TEXT NOT NULL, location TEXT NOT NULL DEFAULT '', contact_reference TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL DEFAULT 'PROSPECT' CHECK(status IN ('PROSPECT','ACTIVE','PAUSED','ARCHIVED')),
 created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS partners (
 id INTEGER PRIMARY KEY, country TEXT NOT NULL CHECK(country IN ('Botswana','Eswatini')),
 name TEXT NOT NULL, accepted_materials TEXT NOT NULL DEFAULT '', conditions TEXT NOT NULL DEFAULT '',
 verification_status TEXT NOT NULL DEFAULT 'UNVERIFIED' CHECK(verification_status IN ('UNVERIFIED','CONTACTED','CONDITIONS_VERIFIED','NOT_ACCEPTING')),
 created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS collections (
 id INTEGER PRIMARY KEY, site_id INTEGER NOT NULL REFERENCES sites(id), collected_on TEXT NOT NULL,
 material TEXT NOT NULL, quantity REAL NOT NULL CHECK(quantity >= 0), unit TEXT NOT NULL,
 measurement_status TEXT NOT NULL CHECK(measurement_status IN ('ESTIMATE','MEASURED','VERIFIED')),
 status TEXT NOT NULL CHECK(status IN ('RECORDED','SORTED','HANDED_OVER','RECOVERY_VERIFIED','CANCELLED')),
 evidence_ref TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS handovers (
 id INTEGER PRIMARY KEY, collection_id INTEGER NOT NULL REFERENCES collections(id), partner_id INTEGER NOT NULL REFERENCES partners(id),
 handed_over_on TEXT NOT NULL, offered_quantity REAL NOT NULL CHECK(offered_quantity >= 0),
 accepted_quantity REAL NOT NULL CHECK(accepted_quantity >= 0), rejected_quantity REAL NOT NULL CHECK(rejected_quantity >= 0),
 unit TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('PLANNED','DELIVERED','ACCEPTED','PARTIALLY_REJECTED','REJECTED','UNRESOLVED')),
 receipt_ref TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL,
 CHECK(accepted_quantity + rejected_quantity <= offered_quantity + 0.000001));
CREATE TABLE IF NOT EXISTS finance (
 id INTEGER PRIMARY KEY, country TEXT NOT NULL CHECK(country IN ('Botswana','Eswatini')),
 kind TEXT NOT NULL CHECK(kind IN ('COST','REVENUE')), description TEXT NOT NULL,
 amount REAL NOT NULL CHECK(amount >= 0), currency TEXT NOT NULL CHECK(currency IN ('BWP','SZL')),
 status TEXT NOT NULL CHECK(status IN ('PLANNED','QUOTED','INCURRED','INVOICED','PAID','RECEIVED','CANCELLED')),
 transaction_ref TEXT NOT NULL DEFAULT '', evidence_ref TEXT NOT NULL DEFAULT '', occurred_on TEXT NOT NULL, created_at TEXT NOT NULL,
 CHECK((country='Botswana' AND currency='BWP') OR (country='Eswatini' AND currency='SZL')));
CREATE TABLE IF NOT EXISTS compliance (
 id INTEGER PRIMARY KEY, country TEXT NOT NULL CHECK(country IN ('Botswana','Eswatini')),
 site_id INTEGER REFERENCES sites(id), activity TEXT NOT NULL, requirement TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('NOT_ASSESSED','REQUIRED','REQUESTED','APPROVED','REFUSED','NOT_APPLICABLE')),
 evidence_ref TEXT NOT NULL DEFAULT '', next_action TEXT NOT NULL DEFAULT '', review_date TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS audit_log (
 id INTEGER PRIMARY KEY, action TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id INTEGER NOT NULL,
 occurred_at TEXT NOT NULL, details TEXT NOT NULL DEFAULT '');
"""

def now():
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()

@contextmanager
def connect(path=None):
    target = str(path or DB_PATH)
    if target != ":memory:":
        Path(target).parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(target)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys=ON")
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()

def initialize_database(path=None):
    with connect(path) as db:
        db.executescript(SCHEMA)

def _required(value, label):
    value = str(value or "").strip()
    if not value:
        raise ValueError(label + " is required")
    return value

def _choice(value, choices, label):
    if value not in choices:
        raise ValueError("Invalid " + label)
    return value

def _quantity(value, label="quantity"):
    try:
        number = float(value)
    except (TypeError, ValueError):
        raise ValueError("Invalid " + label) from None
    if not math.isfinite(number) or number < 0:
        raise ValueError(label + " must be a finite, non-negative number")
    return number

def _audit(db, action, entity, entity_id, details=""):
    db.execute("INSERT INTO audit_log(action,entity_type,entity_id,occurred_at,details) VALUES(?,?,?,?,?)",
               (action, entity, entity_id, now(), details[:500]))

def add_site(data, path=None):
    country = _choice(data.get("country"), COUNTRIES, "country")
    name = _required(data.get("name"), "Site name")
    with connect(path) as db:
        cur = db.execute("INSERT INTO sites(country,name,location,contact_reference,status,created_at) VALUES(?,?,?,?,?,?)",
            (country, name, str(data.get("location","")).strip(), str(data.get("contact_reference","")).strip(),
             _choice(data.get("status","PROSPECT"), {"PROSPECT","ACTIVE","PAUSED","ARCHIVED"}, "site status"), now()))
        _audit(db,"CREATE","site",cur.lastrowid)
        return cur.lastrowid

def add_partner(data, path=None):
    country = _choice(data.get("country"), COUNTRIES, "country")
    name = _required(data.get("name"), "Partner name")
    with connect(path) as db:
        cur = db.execute("INSERT INTO partners(country,name,accepted_materials,conditions,verification_status,created_at) VALUES(?,?,?,?,?,?)",
            (country,name,str(data.get("accepted_materials","")).strip(),str(data.get("conditions","")).strip(),
             _choice(data.get("verification_status","UNVERIFIED"), {"UNVERIFIED","CONTACTED","CONDITIONS_VERIFIED","NOT_ACCEPTING"}, "partner status"),now()))
        _audit(db,"CREATE","partner",cur.lastrowid)
        return cur.lastrowid

def add_collection(data, path=None):
    site_id = int(_required(data.get("site_id"),"Site"))
    collected_on = _required(data.get("collected_on"),"Collection date")
    datetime.strptime(collected_on,"%Y-%m-%d")
    material = _choice(data.get("material"), MATERIALS, "material")
    unit = _choice(data.get("unit"), UNITS, "unit")
    quantity = _quantity(data.get("quantity"))
    measurement = _choice(data.get("measurement_status"), MEASUREMENT, "measurement status")
    status = _choice(data.get("status","RECORDED"), COLLECTION_STATUS, "collection status")
    with connect(path) as db:
        if not db.execute("SELECT 1 FROM sites WHERE id=? AND status!='ARCHIVED'",(site_id,)).fetchone():
            raise ValueError("Selected site does not exist or is archived")
        cur = db.execute("INSERT INTO collections(site_id,collected_on,material,quantity,unit,measurement_status,status,evidence_ref,notes,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
            (site_id,collected_on,material,quantity,unit,measurement,status,str(data.get("evidence_ref","")).strip(),str(data.get("notes","")).strip(),now()))
        _audit(db,"CREATE","collection",cur.lastrowid)
        return cur.lastrowid

def add_handover(data, path=None):
    collection_id = int(_required(data.get("collection_id"),"Collection"))
    partner_id = int(_required(data.get("partner_id"),"Recovery partner"))
    handed_on = _required(data.get("handed_over_on"),"Handover date")
    datetime.strptime(handed_on,"%Y-%m-%d")
    offered, accepted, rejected = (_quantity(data.get(k), k.replace("_"," ")) for k in ("offered_quantity","accepted_quantity","rejected_quantity"))
    unit = _choice(data.get("unit"),UNITS,"unit")
    status = _choice(data.get("status"),HANDOVER_STATUS,"handover status")
    if accepted + rejected > offered + 0.000001:
        raise ValueError("Accepted plus rejected quantity cannot exceed offered quantity")
    with connect(path) as db:
        collection = db.execute("SELECT * FROM collections WHERE id=?",(collection_id,)).fetchone()
        partner = db.execute("SELECT * FROM partners WHERE id=?",(partner_id,)).fetchone()
        if not collection: raise ValueError("Collection does not exist")
        if not partner: raise ValueError("Recovery partner does not exist")
        if collection["unit"] != unit: raise ValueError("Handover unit must match collection unit")
        if partner["country"] != db.execute("SELECT country FROM sites WHERE id=?",(collection["site_id"],)).fetchone()["country"]:
            raise ValueError("Partner and collection site must be in the same country")
        if offered > collection["quantity"] + 0.000001:
            raise ValueError("Offered quantity cannot exceed the recorded collection quantity")
        if status in {"ACCEPTED","PARTIALLY_REJECTED","REJECTED"} and not str(data.get("receipt_ref","")).strip():
            raise ValueError("A receipt/evidence reference is required for a final acceptance status")
        cur = db.execute("INSERT INTO handovers(collection_id,partner_id,handed_over_on,offered_quantity,accepted_quantity,rejected_quantity,unit,status,receipt_ref,notes,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
            (collection_id,partner_id,handed_on,offered,accepted,rejected,unit,status,str(data.get("receipt_ref","")).strip(),str(data.get("notes","")).strip(),now()))
        if status in {"DELIVERED","ACCEPTED","PARTIALLY_REJECTED","REJECTED"}:
            db.execute("UPDATE collections SET status='HANDED_OVER' WHERE id=? AND status NOT IN ('CANCELLED','RECOVERY_VERIFIED')",(collection_id,))
        _audit(db,"CREATE","handover",cur.lastrowid)
        return cur.lastrowid

def add_finance(data, path=None):
    country = _choice(data.get("country"), COUNTRIES, "country")
    kind = _choice(data.get("kind"), FINANCE_KIND, "finance kind")
    description = _required(data.get("description"),"Description")
    amount = _quantity(data.get("amount"),"amount")
    currency = _choice(data.get("currency"),{"BWP","SZL"},"currency")
    if currency != COUNTRIES[country]:
        raise ValueError("Currency must match the selected country")
    status = _choice(data.get("status"),FINANCE_STATUS,"finance status")
    occurred = _required(data.get("occurred_on"),"Date")
    datetime.strptime(occurred,"%Y-%m-%d")
    with connect(path) as db:
        cur = db.execute("INSERT INTO finance(country,kind,description,amount,currency,status,transaction_ref,evidence_ref,occurred_on,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
            (country,kind,description,amount,currency,status,str(data.get("transaction_ref","")).strip(),str(data.get("evidence_ref","")).strip(),occurred,now()))
        _audit(db,"CREATE","finance",cur.lastrowid)
        return cur.lastrowid

def add_compliance(data, path=None):
    country = _choice(data.get("country"), COUNTRIES, "country")
    activity = _required(data.get("activity"),"Activity")
    requirement = _required(data.get("requirement"),"Requirement")
    status = _choice(data.get("status"),COMPLIANCE_STATUS,"compliance status")
    evidence = str(data.get("evidence_ref","")).strip()
    if status == "APPROVED" and not evidence:
        raise ValueError("APPROVED requires an evidence reference")
    site_id = str(data.get("site_id","")).strip()
    site_id = int(site_id) if site_id else None
    review_date = str(data.get("review_date","")).strip()
    if review_date: datetime.strptime(review_date,"%Y-%m-%d")
    with connect(path) as db:
        if site_id:
            site = db.execute("SELECT country FROM sites WHERE id=?",(site_id,)).fetchone()
            if not site or site["country"] != country: raise ValueError("Site must exist in the selected country")
        cur = db.execute("INSERT INTO compliance(country,site_id,activity,requirement,status,evidence_ref,next_action,review_date,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
            (country,site_id,activity,requirement,status,evidence,str(data.get("next_action","")).strip(),review_date,now()))
        _audit(db,"CREATE","compliance",cur.lastrowid)
        return cur.lastrowid

TABLES = {
 "sites": ("Sites","SELECT id,country,name,location,status,created_at FROM sites ORDER BY id DESC"),
 "partners": ("Recovery partners","SELECT id,country,name,accepted_materials,verification_status FROM partners ORDER BY id DESC"),
 "collections": ("Collections","SELECT c.id,s.name AS site,c.collected_on,c.material,c.quantity,c.unit,c.measurement_status,c.status FROM collections c JOIN sites s ON s.id=c.site_id ORDER BY c.id DESC"),
 "handovers": ("Handovers","SELECT h.id,c.id AS collection_id,p.name AS partner,h.handed_over_on,h.offered_quantity,h.accepted_quantity,h.rejected_quantity,h.unit,h.status,h.receipt_ref FROM handovers h JOIN collections c ON c.id=h.collection_id JOIN partners p ON p.id=h.partner_id ORDER BY h.id DESC"),
 "finance": ("Finance","SELECT id,country,kind,description,amount,currency,status,occurred_on,evidence_ref FROM finance ORDER BY id DESC"),
 "compliance": ("Compliance actions","SELECT id,country,activity,requirement,status,evidence_ref,next_action,review_date FROM compliance ORDER BY id DESC"),
}
def query_rows(db, table):
    if table not in TABLES: raise ValueError("Unknown table")
    return db.execute(TABLES[table][1]).fetchall()

def esc(value):
    return html.escape("" if value is None else str(value), quote=True)

def options(values, selected=None):
    return "".join('<option value="%s"%s>%s</option>' % (esc(v)," selected" if v==selected else "",esc(v)) for v in values)

def field(label, name, kind="text", required=True, extra=""):
    return '<label>%s<input name="%s" type="%s"%s %s></label>' % (esc(label),esc(name),kind," required" if required else "",extra)

def select_field(label,name,values,required=True):
    return '<label>%s<select name="%s"%s>%s</select></label>' % (esc(label),esc(name)," required" if required else "",options(values))

def form(title, action, body):
    return '<section class="panel"><h2>%s</h2><form method="post"><input type="hidden" name="action" value="%s">%s<button type="submit">Save %s</button></form></section>' % (esc(title),esc(action),body,esc(title.lower()))

def render(db, notice="", error=""):
    counts = {key: db.execute("SELECT COUNT(*) FROM "+table).fetchone()[0] for key,table in
              (("sites","sites"),("partners","partners"),("collections","collections"),("handovers","handovers"),("finance","finance"),("compliance","compliance"))}
    rows = {key:query_rows(db,key) for key in TABLES}
    sites = db.execute("SELECT id,name FROM sites WHERE status!='ARCHIVED' ORDER BY name").fetchall()
    partners = db.execute("SELECT id,name FROM partners ORDER BY name").fetchall()
    def table_html(key):
        data = rows[key]
        if not data: return '<p class="empty">No records yet.</p>'
        headers = data[0].keys()
        return '<div class="table-wrap"><table><thead><tr>'+''.join('<th>'+esc(h.replace("_"," ").title())+'</th>' for h in headers)+'</tr></thead><tbody>'+''.join('<tr>'+''.join('<td>'+esc(row[h])+'</td>' for h in headers)+'</tr>' for row in data)+'</tbody></table></div>'
    cards = ''.join('<div class="metric"><strong>%s</strong><span>%s</span></div>'%(counts[k],esc(label)) for k,label in (("sites","Sites"),("partners","Recovery partners"),("collections","Collections"),("handovers","Handovers"),("finance","Finance entries"),("compliance","Compliance items")))
    site_opts = ''.join('<option value="%s">%s — %s</option>'%(s["id"],s["id"],esc(s["name"])) for s in sites)
    partner_opts = ''.join('<option value="%s">%s — %s</option>'%(p["id"],p["id"],esc(p["name"])) for p in partners)
    forms = []
    forms.append(form("Add site","site",field("Country","country","text",True,' list="countries"')+'<datalist id="countries"><option value="Botswana"><option value="Eswatini"></datalist>'+field("Site name","name")+field("Location","location","text",False)+field("Contact reference (avoid sensitive details)","contact_reference","text",False)+select_field("Status","status",["PROSPECT","ACTIVE","PAUSED","ARCHIVED"])))
    forms.append(form("Add recovery partner","partner",field("Country","country","text",True,' list="countries"')+field("Partner name","name")+field("Accepted materials","accepted_materials","text",False)+field("Acceptance conditions / quote notes","conditions","text",False)+select_field("Verification status","verification_status",["UNVERIFIED","CONTACTED","CONDITIONS_VERIFIED","NOT_ACCEPTING"])))
    forms.append(form("Record collection","collection",'<label>Site<select name="site_id" required>'+site_opts+'</select></label>'+field("Collection date","collected_on","date")+select_field("Material","material",sorted(MATERIALS))+field("Quantity","quantity","number",True,' min="0" step="any"')+select_field("Unit","unit",sorted(UNITS))+select_field("Measurement status","measurement_status",sorted(MEASUREMENT))+select_field("Collection status","status",sorted(COLLECTION_STATUS))+field("Evidence reference","evidence_ref","text",False)+field("Notes","notes","text",False)))
    forms.append(form("Record handover","handover",'<label>Collection<select name="collection_id" required>'+''.join('<option value="%s">%s — %s (%s %s)</option>'%(r["id"],r["id"],esc(r["material"]),r["quantity"],esc(r["unit"])) for r in db.execute("SELECT id,material,quantity,unit FROM collections WHERE status!='CANCELLED' ORDER BY id DESC"))+'</select></label><label>Recovery partner<select name="partner_id" required>'+partner_opts+'</select></label>'+field("Handover date","handed_over_on","date")+field("Offered quantity","offered_quantity","number",True,' min="0" step="any"')+field("Accepted quantity","accepted_quantity","number",True,' min="0" step="any"')+field("Rejected quantity","rejected_quantity","number",True,' min="0" step="any"')+select_field("Unit","unit",sorted(UNITS))+select_field("Status","status",sorted(HANDOVER_STATUS))+field("Receipt/evidence reference","receipt_ref","text",False)+field("Notes","notes","text",False)))
    forms.append(form("Record finance","finance",select_field("Country","country",COUNTRIES.keys())+select_field("Type","kind",sorted(FINANCE_KIND))+field("Description","description")+field("Amount","amount","number",True,' min="0" step="any"')+select_field("Currency","currency",["BWP","SZL"])+select_field("Status","status",sorted(FINANCE_STATUS))+field("Date","occurred_on","date")+field("Transaction reference","transaction_ref","text",False)+field("Evidence reference","evidence_ref","text",False)))
    forms.append(form("Add compliance action","compliance",select_field("Country","country",COUNTRIES.keys())+'<label>Site (optional)<select name="site_id"><option value="">No site linked</option>'+site_opts+'</select></label>'+field("Activity","activity")+field("Requirement / question to verify","requirement")+select_field("Status","status",sorted(COMPLIANCE_STATUS))+field("Evidence reference (required for APPROVED)","evidence_ref","text",False)+field("Next action","next_action","text",False)+field("Review date","review_date","date",False)))
    panels = ''.join('<section class="panel"><h2>%s</h2><p><a href="/export/%s">Export CSV</a></p>%s</section>'%(esc(TABLES[k][0]),k,table_html(k)) for k in TABLES)
    return """<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>RECLAIM & REPURPOSE — Operations</title><style>
:root{font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#18251f;background:#f3f6f3}body{margin:0}header{background:#183d2b;color:white;padding:1.5rem max(1rem,calc((100vw - 1180px)/2))}header p{margin:.4rem 0;color:#d9e7dc}.wrap{max-width:1180px;margin:auto;padding:1rem}.notice{padding:.8rem;border-radius:8px;background:#e2f3e7}.error{padding:.8rem;border-radius:8px;background:#ffe4e1;color:#782b22}.warning{border:1px solid #c6a55a;background:#fff9e9;padding:1rem;border-radius:8px}.metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:.7rem;margin:1rem 0}.metric,.panel{background:white;border:1px solid #dce5dd;border-radius:10px;padding:1rem}.metric strong{display:block;font-size:1.8rem}.metric span{color:#4c6255}.forms{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%%,340px),1fr));gap:1rem}.panel h2{margin-top:0;font-size:1.15rem}form{display:grid;gap:.7rem}label{display:grid;gap:.25rem;font-size:.9rem}input,select{width:100%;box-sizing:border-box;padding:.65rem;border:1px solid #b9c8bc;border-radius:6px;font:inherit;background:white}button{padding:.7rem 1rem;background:#246443;color:white;border:0;border-radius:6px;font:inherit;cursor:pointer}button:hover{background:#174b30}.table-wrap{overflow:auto}table{border-collapse:collapse;width:100%;font-size:.88rem}th,td{text-align:left;padding:.55rem;border-bottom:1px solid #e1e8e2;white-space:nowrap}th{background:#f5f8f5}.empty{color:#627168}a{color:#175e3b}footer{color:#59675e;padding:1rem 0;font-size:.9rem}@media(min-width:900px){.records{display:grid;grid-template-columns:1fr 1fr;gap:1rem}.records .panel{min-width:0}}</style></head><body><header><h1>RECLAIM & REPURPOSE</h1><p>Operational records · Botswana and Eswatini</p></header><main class="wrap">
<div class="warning"><strong>Development prototype — local use only.</strong> This application has no user authentication and must not be exposed to the public internet or used to store sensitive personal data. Records do not authorize physical operations. A recorded handover is not proof of recycling.</div>
%s%s<div class="metrics">%s</div><h2>Record operations</h2><div class="forms">%s</div><h2>Operational records</h2><div class="records">%s</div><footer>Currency remains country-specific: Botswana = BWP; Eswatini = SZL. Empty records are shown as empty; no demo activity is fabricated.</footer></main></body></html>""" % (
        '<p class="notice">'+esc(notice)+'</p>' if notice else '',
        '<p class="error">'+esc(error)+'</p>' if error else '',cards,''.join(forms),panels)

def application(environ, start_response):
    method = environ.get("REQUEST_METHOD","GET")
    path = environ.get("PATH_INFO","/")
    if method == "GET" and path.startswith("/export/"):
        table = path.rsplit("/",1)[-1]
        if table not in TABLES:
            start_response("404 Not Found",[("Content-Type","text/plain; charset=utf-8")]); return [b"Unknown export"]
        with connect() as db:
            cursor = db.execute(TABLES[table][1])
            rows = cursor.fetchall()
            columns = [column[0] for column in cursor.description]
            output = io.StringIO(newline="")
            writer = csv.writer(output)
            writer.writerow(columns)
            for row in rows: writer.writerow([row[k] for k in columns])
            body = output.getvalue().encode("utf-8")
        start_response("200 OK",[("Content-Type","text/csv; charset=utf-8"),("Content-Disposition",'attachment; filename="%s.csv"'%table),("Content-Length",str(len(body)))])
        return [body]
    notice = error = ""
    if method == "POST":
        try:
            size = int(environ.get("CONTENT_LENGTH") or "0")
            if size > 100_000: raise ValueError("Form submission too large")
            data = {k:v[0] for k,v in parse_qs(environ["wsgi.input"].read(size).decode("utf-8"),keep_blank_values=True).items()}
            action = data.pop("action","")
            functions = {"site":add_site,"partner":add_partner,"collection":add_collection,"handover":add_handover,"finance":add_finance,"compliance":add_compliance}
            if action not in functions: raise ValueError("Unknown action")
            record_id = functions[action](data)
            notice = "%s record #%s saved."%(action.title(),record_id)
        except (ValueError,KeyError,sqlite3.Error) as exc:
            error = str(exc)[:400]
    with connect() as db:
        body = render(db,notice,error).encode("utf-8")
    start_response("200 OK",[("Content-Type","text/html; charset=utf-8"),("Content-Length",str(len(body))),( "X-Content-Type-Options","nosniff"),("Content-Security-Policy","default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'")])
    return [body]

def main():
    initialize_database()
    host = os.environ.get("RECLAIM_HOST","127.0.0.1")
    if host not in {"127.0.0.1","::1","localhost"}:
        raise SystemExit("This unauthenticated prototype must bind to localhost only.")
    port = int(os.environ.get("PORT","8000"))
    print("RECLAIM & REPURPOSE MVP at http://127.0.0.1:%s (local-only prototype)"%port)
    with make_server(host,port,application) as server:
        server.serve_forever()

if __name__ == "__main__":
    main()
