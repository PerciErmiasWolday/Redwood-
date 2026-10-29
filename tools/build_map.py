"""Build data/us_states.json (lower-48 state outlines as SVG paths) from a county GeoJSON.

Usage: python3 tools/build_map.py path/to/counties.json data/us_states.json

The projection (Albers equal-area, standard parallels 29.5 and 45.5) is written into the
output so the browser places cities with exactly the same math (see js/engine.js, project()).
"""
import json
import math
import sys

from shapely.geometry import shape, mapping
from shapely.ops import unary_union, transform

FIPS_TO_ABBR = {
    "01": "AL", "04": "AZ", "05": "AR", "06": "CA", "08": "CO", "09": "CT", "10": "DE", "11": "DC",
    "12": "FL", "13": "GA", "16": "ID", "17": "IL", "18": "IN", "19": "IA", "20": "KS", "21": "KY",
    "22": "LA", "23": "ME", "24": "MD", "25": "MA", "26": "MI", "27": "MN", "28": "MS", "29": "MO",
    "30": "MT", "31": "NE", "32": "NV", "33": "NH", "34": "NJ", "35": "NM", "36": "NY", "37": "NC",
    "38": "ND", "39": "OH", "40": "OK", "41": "OR", "42": "PA", "44": "RI", "45": "SC", "46": "SD",
    "47": "TN", "48": "TX", "49": "UT", "50": "VT", "51": "VA", "53": "WA", "54": "WV", "55": "WI",
    "56": "WY",
}

LAT0, LON0, P1, P2 = 37.5, -96.0, 29.5, 45.5


def albers(lon, lat):
    phi1, phi2, phi0 = (math.radians(v) for v in (P1, P2, LAT0))
    n = (math.sin(phi1) + math.sin(phi2)) / 2
    c = math.cos(phi1) ** 2 + 2 * n * math.sin(phi1)
    rho0 = math.sqrt(c - 2 * n * math.sin(phi0)) / n
    phi, lam = math.radians(lat), math.radians(lon - LON0)
    rho = math.sqrt(c - 2 * n * math.sin(phi)) / n
    theta = n * lam
    return rho * math.sin(theta), rho0 - rho * math.cos(theta)


def main(src, out):
    data = json.load(open(src))
    by_state = {}
    for feat in data["features"]:
        st = feat["properties"]["STATE"]
        if st in FIPS_TO_ABBR:
            by_state.setdefault(st, []).append(shape(feat["geometry"]).buffer(0))

    projected = {}
    for st, geoms in by_state.items():
        merged = unary_union(geoms)
        projected[st] = transform(lambda x, y, z=None: albers(x, y), merged)

    minx = min(g.bounds[0] for g in projected.values())
    miny = min(g.bounds[1] for g in projected.values())
    maxx = max(g.bounds[2] for g in projected.values())
    maxy = max(g.bounds[3] for g in projected.values())
    width = 960.0
    scale = width / (maxx - minx)
    height = (maxy - miny) * scale

    def to_svg(x, y, z=None):
        return (x - minx) * scale, (maxy - y) * scale

    states = []
    for st, geom in sorted(projected.items()):
        g = transform(to_svg, geom).simplify(0.6, preserve_topology=True)
        polys = [g] if g.geom_type == "Polygon" else list(g.geoms)
        parts = []
        for p in polys:
            if p.area < 2:  # drop specks (tiny islands)
                continue
            for ring in [p.exterior, *p.interiors]:
                pts = list(ring.coords)
                parts.append("M" + "L".join(f"{x:.1f},{y:.1f}" for x, y in pts) + "Z")
        states.append({"fips": st, "abbr": FIPS_TO_ABBR[st], "d": "".join(parts)})

    json.dump({
        "viewBox": [0, 0, round(width, 1), round(height, 1)],
        "projection": {"lat0": LAT0, "lon0": LON0, "p1": P1, "p2": P2,
                       "minx": minx, "maxy": maxy, "scale": scale},
        "states": states,
    }, open(out, "w"), separators=(",", ":"))
    print(f"wrote {out}: {len(states)} states, viewBox 960x{height:.0f}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
