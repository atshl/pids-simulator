"""
Build the static PIDS dataset from free, no-token public sources.

Sources (all public, no API key required)
  stops    : LTA  https://www.lta.gov.sg/map/busService/bus_stops.xml
  services : LTA  https://www.lta.gov.sg/map/busService/bus_services.xml  (+ route xml for gaps)
  routes   : cheeaun/sgbusdata  services.min.json
  stations : LTA DataMall *static* dataset
             "Train Station Codes and Chinese Names.zip"  -> stn_code, english name, line

Output (pids/data/)
  stops.json    { stopCode: [lng, lat, name, road, stnCodes, stnName, lines, abbrs] }
  services.json { svc: { n: "Term A <> Term B", r: [[stopCode, ...], ...] } }
  stations.json { stationCode: [englishName, lineEnglish, chineseName] }
  meta.json     build info + counts
"""
import io
import json
import math
import os
import re
import sys
import time
import urllib.parse
import urllib.request
import zipfile
from xml.etree import ElementTree as ET

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:  # noqa: BLE001
    pass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data")
UA = {"User-Agent": "Mozilla/5.0 (compatible; pids-sim/0.1)"}

ARROWS = {"\u2194": "<>", "\u21c4": "<>", "\u21c6": "<>", "\u2192": ">", "\u2190": "<", "\u2195": "|"}

LINE_ABBR = {
    "North-South Line": "NS",
    "East-West Line": "EW",
    "North East Line": "NE",
    "Circle Line": "CC",
    "Circle Line Extension": "CC",
    "Downtown Line": "DT",
    "Thomson-East Coast Line": "TE",
    "Punggol LRT": "PL",
    "Sengkang LRT": "SL",
    "Bukit Panjang LRT": "BP",
    "Changi Airport Branch Line": "CA",
}


def norm_arrows(s):
    for k, v in ARROWS.items():
        s = s.replace(k, v)
    return re.sub(r"\s+", " ", s).strip()


def get(url, tries=3):
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=120) as r:
                return r.read()
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(1.5 * (i + 1))
    raise RuntimeError(f"failed {url}: {last}")


def haversine_m(lat1, lon1, lat2, lon2):
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


# ---------------------------------------------------------------- stations
def build_stations():
    """code -> [english, line, chinese] from the official LTA static dataset."""
    import xlrd
    fname = "Train Station Codes and Chinese Names.zip"
    url = ("https://datamall.lta.gov.sg/content/dam/datamall/datasets/Geospatial/"
           + urllib.parse.quote(fname))
    z = zipfile.ZipFile(io.BytesIO(get(url)))
    member = [n for n in z.namelist() if n.lower().endswith(".xls")][0]
    sh = xlrd.open_workbook(file_contents=z.read(member)).sheet_by_index(0)
    out = {}
    for r in range(1, sh.nrows):
        code = str(sh.cell_value(r, 0)).strip()
        en = str(sh.cell_value(r, 1)).strip()
        zh = str(sh.cell_value(r, 2)).strip()
        line = norm_arrows(str(sh.cell_value(r, 3)).strip())
        if code and en:
            out[code] = [en, line, zh]
    return out


# ---------------------------------------------------------------- stops
def build_stops():
    root = ET.fromstring(get("https://www.lta.gov.sg/map/busService/bus_stops.xml"))
    stops = {}
    for bs in root.findall("busstop"):
        code = bs.get("name")
        if not code:
            continue
        details = [d.text.strip() for d in bs.findall("details") if d.text and d.text.strip()]
        coords = bs.find("coordinates")
        lat = lon = None
        if coords is not None:
            la, lo = coords.findtext("lat"), coords.findtext("long")
            if la and lo:
                lat, lon = float(la), float(lo)
        stops[code] = {
            "name": details[0] if details else "",
            "road": details[1] if len(details) > 1 else "",
            "lat": lat, "lon": lon,
            "wab": bs.get("wab") == "true",
        }
    return stops


# ---------------------------------------------------------------- services
def build_services():
    lta = ET.fromstring(get("https://www.lta.gov.sg/map/busService/bus_services.xml"))
    lta_numbers, route_files = [], {}
    for bs in lta.findall(".//bus_service"):
        n = bs.findtext("number")
        if not n:
            continue
        n = n.strip()
        lta_numbers.append(n)
        for f in bs.findall("./routeFile/file"):
            if f.text:
                route_files.setdefault(n, []).append(f.text.strip())

    mirror = json.loads(get(
        "https://raw.githubusercontent.com/cheeaun/sgbusdata/main/data/v1/services.min.json"))
    out = {}
    for svc, v in mirror.items():
        routes = [r for r in v.get("routes", []) if r]
        if routes:
            out[svc] = {"n": norm_arrows(v.get("name") or ""), "r": routes}

    missing = [n for n in sorted(set(lta_numbers)) if n not in out]
    filled = 0
    for n in missing:
        routes, names = [], []
        for rf in route_files.get(n, []):
            try:
                x = ET.fromstring(get(
                    f"https://www.lta.gov.sg/map/busService/bus_route_xml/{rf}"))
            except Exception:  # noqa: BLE001
                continue
            for d in x.findall("direction"):
                codes = [b.get("name") for b in d.findall("busstop") if b.get("name")]
                if codes:
                    routes.append(codes)
                    names.append(d.get("name") or "")
        if routes:
            labels = [nm.replace("From ", "").replace(" to ", " <> ") for nm in names]
            out[n] = {"n": norm_arrows(" / ".join(labels)), "r": routes}
            filled += 1
    print(f"  filled {filled} services from LTA route xml")
    return out, sorted(set(lta_numbers))


# ---------------------------------------------------------------- interchange
PREFIX_RE = re.compile(
    r"^(Opp|Opposite|Aft|After|Bef|Before|Near|Int|Interchange|Blk|Outside|In Front of)\s+", re.I)
EXIT_RE = re.compile(r"\s*\(?Exit\s+[A-Z0-9]{1,2}\)?\s*$", re.I)
NORM_RE = re.compile(r"[^a-z0-9 ]+")


def norm(s):
    return NORM_RE.sub(" ", s.lower()).strip()


def clean_stop_name(s):
    s = PREFIX_RE.sub("", s)
    s = EXIT_RE.sub("", s)
    return s.strip(" .,-")


def build_interchange(stops, stations):
    """Match bus stops to train stations by name (longest match wins)."""
    by_name = {}
    for code, (en, line, _zh) in stations.items():
        by_name.setdefault(norm(en), []).append((code, line))
    # longest station names first so "Bishan North" style collisions resolve to the longer name
    names = sorted(by_name.keys(), key=len, reverse=True)

    # anchor coordinates: bus stops whose cleaned name is exactly the station name
    anchors = {}
    for st in stops.values():
        if st["lat"] is None:
            continue
        for cand in (norm(clean_stop_name(st["name"])), norm(st["name"])):
            cand = re.sub(r"\bstn\b$", "", cand).strip()
            if cand in by_name and cand not in anchors:
                anchors[cand] = (st["lat"], st["lon"])
                break

    out = {}
    for code, st in stops.items():
        n = norm(st["name"])
        hit = None
        for sn in names:
            if len(sn) < 4:
                continue
            if re.search(rf"(?<![a-z0-9]){re.escape(sn)}(?![a-z0-9])", n):
                hit = sn
                break
        if not hit:
            continue
        if hit in anchors and st["lat"] is not None:
            alat, alon = anchors[hit]
            if haversine_m(st["lat"], st["lon"], alat, alon) > 700:
                continue  # same name but a different place
        codes_lines = by_name[hit]
        st_codes = "/".join(c for c, _ in codes_lines)
        lines = []
        for _c, ln in codes_lines:
            if ln and ln not in lines:
                lines.append(ln)
        abbrs = "/".join(LINE_ABBR.get(l, l.split()[0][:2].upper()) for l in lines)
        out[code] = {
            "codes": st_codes,
            "name": stations[codes_lines[0][0]][0],
            "lines": "|".join(lines),
            "abbrs": abbrs,
        }
    return out, len(anchors)


# ---------------------------------------------------------------- main
def main():
    os.makedirs(OUT, exist_ok=True)

    print("stations...")
    stations = build_stations()
    print(f"  {len(stations)} codes")

    print("stops...")
    stops = build_stops()
    print(f"  {len(stops)} stops")

    print("services...")
    services, lta_numbers = build_services()
    print(f"  {len(services)} services (LTA lists {len(lta_numbers)})")

    print("interchanges...")
    inter, n_anchor = build_interchange(stops, stations)
    print(f"  {len(inter)} stops matched a station ({n_anchor} station anchors)")

    st_out = {}
    for code, st in stops.items():
        it = inter.get(code, {})
        st_out[code] = [
            round(st["lon"], 6) if st["lon"] is not None else None,
            round(st["lat"], 6) if st["lat"] is not None else None,
            st["name"], st["road"],
            it.get("codes"), it.get("name"), it.get("lines"), it.get("abbrs"),
        ]

    unknown = {c for v in services.values() for r in v["r"] for c in r if c not in st_out}
    if unknown:
        print(f"  !! {len(unknown)} stop codes missing; filling from mirror")
        mirror_stops = json.loads(get(
            "https://raw.githubusercontent.com/cheeaun/sgbusdata/main/data/v1/stops.min.json"))
        for c in unknown:
            v = mirror_stops.get(c)
            if v:
                st_out[c] = [v[0], v[1], v[2], v[3], None, None, None, None]

    for name, obj in (("stops.json", st_out), ("services.json", services),
                      ("stations.json", stations)):
        with open(os.path.join(OUT, name), "w", encoding="utf-8") as f:
            json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))

    meta = {
        "built": time.strftime("%Y-%m-%d"),
        "stops": len(st_out),
        "services": len(services),
        "stations": len(stations),
        "interchangeStops": len(inter),
        "sources": {
            "stops": "LTA bus_stops.xml",
            "services": "cheeaun/sgbusdata services.min.json + LTA route xml",
            "stations": "LTA DataMall static: Train Station Codes and Chinese Names",
        },
        "stopFields": ["lng", "lat", "name", "road", "stationCodes", "stationName",
                       "stationLines", "lineAbbrs"],
    }
    with open(os.path.join(OUT, "meta.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2)

    for p in ("stops.json", "services.json", "stations.json"):
        print(f"  {p}: {os.path.getsize(os.path.join(OUT, p)):,} bytes")

    print("\nservice 50:", services["50"]["n"], f"{len(services['50']['r'])} route(s)")
    for route in services["50"]["r"]:
        for c in route:
            s = st_out[c]
            chip = f"  [{s[7]} {s[5]}]" if s[4] else ""
            print(f"    {c:8} {s[2]}{chip}")


if __name__ == "__main__":
    main()
