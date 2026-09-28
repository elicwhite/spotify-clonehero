"""Geometry of the mark, and the camera framing of its resting pose.

Logo-local axes: X right, Y up, Z toward the viewer. The slab is centered on
the origin; its front face is the plane Z = THICK / 2. The resting pose is
exactly frontal and sized so a flat 2D mark lines up with it: the silhouette
side is REST_SIZE_FRAC of the frame, centered, and the glyph is scaled for
perspective so it projects at 16/28 of that side, as in the app's nav mark
(components/BrandLink.tsx).
"""

import math

import bpy
import numpy as np
from mathutils import Vector

SIDE = 2.0  # silhouette side of the rounded square
HALF = SIDE / 2
CORNER = SIDE * 6 / 28  # `rounded-md` (6 px) on the 28 px nav mark
ICON_FRAC = 16 / 28  # the 16 px icon inside the 28 px nav mark
THICK = 0.34
BEVEL = 0.11

# The lucide "music" icon (lucide-react 0.546.0, 24-unit viewBox, y down):
#   path "M9 18V5l12-2v13"; circle (6, 18) r 3; circle (18, 16) r 3
#   stroke-width 2, round caps and joins, no fill.
GLYPH_POLYLINE = [(9, 18), (9, 5), (21, 3), (21, 16)]
GLYPH_RINGS = [((6, 18), 3), ((18, 16), 3)]
GLYPH_STROKE = 2
GLYPH_LIFT = 0.30  # tube centerline above the face, in stroke radii
GLYPH_DEPTH = 0.85  # cross-section depth over width: a slightly flattened round

FOCAL_MM = 100
SENSOR_MM = 36
REST_SIZE_FRAC = 0.42037  # silhouette side at rest over the frame side (454 px of 1080)


def outline_samples(n_corner=40, n_edge=6):
    """(core point, outward normal) pairs around the rounded square, CCW.

    Every outline in the slab is core + radius * normal, where the core point
    lies on the rectangle through the four corner centers, so all bevel rings
    share one parametrization and line up vertex for vertex."""
    c = HALF - CORNER
    edges = [((c, -c), (c, c), (1, 0)), ((c, c), (-c, c), (0, 1)),
             ((-c, c), (-c, -c), (-1, 0)), ((-c, -c), (c, -c), (0, -1))]
    corners = [((c, c), 0.0), ((-c, c), 90.0), ((-c, -c), 180.0), ((c, -c), 270.0)]
    out = []
    for (a, b, n), (center, a0) in zip(edges, corners):
        for i in range(n_edge):
            t = i / n_edge
            out.append(((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t), n))
        for i in range(n_corner):
            ang = math.radians(a0 + 90.0 * i / n_corner)
            out.append((center, (math.cos(ang), math.sin(ang))))
    return out


def bevel_profile(n_bevel=20):
    """(inset, z, radial normal, z normal) from the back rim to the front rim."""
    zc = THICK / 2 - BEVEL
    prof = []
    for j in range(n_bevel, -1, -1):
        th = math.radians(90.0 * j / n_bevel)
        prof.append((BEVEL * (1 - math.cos(th)), -(zc + BEVEL * math.sin(th)),
                     math.cos(th), -math.sin(th)))
    for j in range(n_bevel + 1):
        th = math.radians(90.0 * j / n_bevel)
        prof.append((BEVEL * (1 - math.cos(th)), zc + BEVEL * math.sin(th),
                     math.cos(th), math.sin(th)))
    return prof


def mesh_object(name, verts, faces, normals, material):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], [], [tuple(f) for f in faces])
    me.update()
    me.polygons.foreach_set('use_smooth', [True] * len(me.polygons))
    me.normals_split_custom_set_from_vertices([Vector(n).normalized() for n in normals])
    me.materials.append(material)
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def slab_geometry():
    samples = outline_samples()
    prof = bevel_profile()
    n = len(samples)
    verts, normals, faces = [], [], []
    for inset, z, nr, nz in prof:
        rad = CORNER - inset
        for (cx, cy), (nx, ny) in samples:
            verts.append((cx + rad * nx, cy + rad * ny, z))
            normals.append((nr * nx, nr * ny, nz))
    rings = len(prof)
    for k in range(rings - 1):
        for i in range(n):
            i2 = (i + 1) % n
            faces.append((k * n + i, k * n + i2, (k + 1) * n + i2, (k + 1) * n + i))
    faces.append(tuple((rings - 1) * n + i for i in range(n)))  # front cap
    faces.append(tuple(reversed(range(n))))  # back cap
    return verts, faces, normals


def cylinder(p0, p1, r, n=72):
    d = (p1 - p0) / np.linalg.norm(p1 - p0)
    side = np.array([-d[1], d[0]])
    verts, normals, faces = [], [], []
    for p in (p0, p1):
        for i in range(n):
            a = 2 * math.pi * i / n
            nrm = (side[0] * math.cos(a), side[1] * math.cos(a), math.sin(a))
            verts.append((p[0] + r * nrm[0], p[1] + r * nrm[1], r * nrm[2]))
            normals.append(nrm)
    for i in range(n):
        i2 = (i + 1) % n
        faces.append((i, i2, n + i2, n + i))
    return verts, normals, faces


def sphere(c, r, n_lon=72, n_lat=36):
    verts, normals, faces = [], [], []
    for j in range(1, n_lat):
        th = math.pi * j / n_lat
        for i in range(n_lon):
            ph = 2 * math.pi * i / n_lon
            nrm = (math.sin(th) * math.cos(ph), math.sin(th) * math.sin(ph), math.cos(th))
            verts.append((c[0] + r * nrm[0], c[1] + r * nrm[1], r * nrm[2]))
            normals.append(nrm)
    top, bot = len(verts), len(verts) + 1
    verts += [(c[0], c[1], r), (c[0], c[1], -r)]
    normals += [(0, 0, 1), (0, 0, -1)]
    for j in range(n_lat - 2):
        for i in range(n_lon):
            i2 = (i + 1) % n_lon
            a, b = j * n_lon + i, j * n_lon + i2
            faces.append((a, a + n_lon, b + n_lon, b))
    last = (n_lat - 2) * n_lon
    for i in range(n_lon):
        i2 = (i + 1) % n_lon
        faces.append((top, i, i2))
        faces.append((bot, last + i2, last + i))
    return verts, normals, faces


def torus(c, big_r, r, n_major=240, n_minor=48):
    verts, normals, faces = [], [], []
    for i in range(n_major):
        u = 2 * math.pi * i / n_major
        for j in range(n_minor):
            v = 2 * math.pi * j / n_minor
            nrm = (math.cos(v) * math.cos(u), math.cos(v) * math.sin(u), math.sin(v))
            ring = big_r + r * math.cos(v)
            verts.append((c[0] + ring * math.cos(u), c[1] + ring * math.sin(u), r * math.sin(v)))
            normals.append(nrm)
    for i in range(n_major):
        i2 = (i + 1) % n_major
        for j in range(n_minor):
            j2 = (j + 1) % n_minor
            faces.append((i * n_minor + j, i2 * n_minor + j, i2 * n_minor + j2, i * n_minor + j2))
    return verts, normals, faces


def glyph_geometry(unit, z_center):
    """Round-capped, round-joined tubes along the icon's strokes.

    Capsules sharing endpoints union into a stroke with round caps and joins,
    so each straight run is an open cylinder with a sphere at every vertex."""
    r = GLYPH_STROKE / 2 * unit

    def at(x, y):
        return np.array([(x - 12) * unit, (12 - y) * unit])

    verts, normals, faces = [], [], []

    def add(part):
        v, n, f = part
        base = len(verts)
        verts.extend(v)
        normals.extend(n)
        faces.extend(tuple(base + i for i in face) for face in f)

    for a, b in zip(GLYPH_POLYLINE, GLYPH_POLYLINE[1:]):
        add(cylinder(at(*a), at(*b), r))
    for p in GLYPH_POLYLINE:
        add(sphere(at(*p), r))
    for (cx, cy), ring_r in GLYPH_RINGS:
        add(torus(at(cx, cy), ring_r * unit, r))

    v = np.array(verts, dtype=np.float64)
    n = np.array(normals, dtype=np.float64)
    v[:, 2] = z_center + GLYPH_DEPTH * v[:, 2]
    n[:, 2] /= GLYPH_DEPTH
    n /= np.linalg.norm(n, axis=1, keepdims=True)
    return v, faces, n



def calibrate(res):
    """Camera distance that puts the rest silhouette at REST_SIZE_FRAC of the
    frame, and the glyph unit that projects like the 2D mark's icon. Both
    depend only on the fractions, not on the frame size `res`."""
    focal_px = FOCAL_MM / SENSOR_MM * res
    target = REST_SIZE_FRAC * res / 2
    th = np.linspace(0, math.pi / 2, 4001)
    zc = THICK / 2 - BEVEL
    edge_x = np.concatenate([[HALF, HALF], HALF - BEVEL * (1 - np.cos(th))])
    edge_z = np.concatenate([[-zc, zc], zc + BEVEL * np.sin(th)])

    def half_px(dist):
        return float(np.max(edge_x * focal_px / (dist - edge_z)))

    lo, hi = 2.0, 200.0
    for _ in range(80):
        mid = 0.5 * (lo + hi)
        if half_px(mid) > target:
            lo = mid
        else:
            hi = mid
    dist = 0.5 * (lo + hi)
    # One viewBox unit at the glyph's own depth projects to 16/28 of the
    # silhouette over 24 units, matching the flat mark despite perspective.
    unit = ICON_FRAC * SIDE / 24
    for _ in range(4):
        z_center = THICK / 2 + GLYPH_LIFT * unit
        unit = (ICON_FRAC * 2 * target / 24) * (dist - z_center) / focal_px
    return dist, unit, THICK / 2 + GLYPH_LIFT * unit
