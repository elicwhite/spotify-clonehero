"""How the mark looks: its materials, the studio world, and the light rig.
The colours come from the brand JSON (src/brand/brandJson.ts): `primary` is
the logo square, `accent` the glow purple, `lanes` the Clone Hero lane
colours."""

import json
import math

import bpy
from mathutils import Vector

from sting_timing import LANE_ORDER

GRADIENT = 1.0  # 0 = flat primary, 1 = primary (lower right) to accent (upper left)


class Palette:
    """The brand colours the sting uses, as sRGB hex."""

    def __init__(self, primary, accent, lanes):
        self.primary = primary
        self.accent = accent
        self.lanes = lanes  # [(name, hex)] in LANE_ORDER

    @classmethod
    def from_brand_json(cls, path):
        with open(path) as fh:
            brand = json.load(fh)
        colors = brand.get('colors') if isinstance(brand, dict) else None
        if not isinstance(colors, dict):
            raise SystemExit(f'{path}: expected a brand JSON with a `colors` object')
        missing = [n for n in ('primary', 'accent') if n not in colors]
        missing += [n for n in LANE_ORDER if n not in colors.get('lanes', {})]
        if missing:
            raise SystemExit(f'{path}: no colours for {missing}')
        return cls(colors['primary'], colors['accent'],
                   [(n, colors['lanes'][n]) for n in LANE_ORDER])

# The sheen is a soft band of light in the environment (a Gaussian around a
# great circle), not a line, and the clear coat reflects it. The flat
# face mirrors about 7.8 degrees of it across its width, so a 1.9 degree band
# covers about a third of the face, and its tails fade out over as much again.
# The band is kept short, because the world also lights the mark diffusely.
SHEEN_FWHM_DEG = 1.9
SHEEN_TILT_DEG = 22.0  # the band leans from vertical: upper left to lower right
SHEEN_STRENGTH = 4.0  # radiance at the core; the coat reflects about 4% face-on
SHEEN_REACH_DEG = 14.0  # the band fades out this far from its center
# The face (and the glyph's tube tops) only mirror directions within about
# 5.5 degrees of the face's mirror direction. Two thin, specular-only strip
# lights ride the band's ends beyond that, so only the bevel ring catches
# them: a crisp highlight that rolls along the top, bottom, and side edges
# as the band passes, and never a line across the face.
CATCH_FROM_DEG = 10.0  # each strip spans this far out along the band ...
CATCH_TO_DEG = 34.0  # ... to this far
CATCH_WIDTH = 0.3
CATCH_ENERGY = 300.0
CATCH_RADIUS = 14.0


def hex_linear(h):
    """sRGB hex to linear RGB."""
    h = h.lstrip('#')
    out = []
    for i in (0, 2, 4):
        c = int(h[i:i + 2], 16) / 255
        out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return tuple(out)


def new_material(name):
    m = bpy.data.materials.new(name)
    if m.node_tree is None:
        m.use_nodes = True
    return m, m.node_tree


def slab_material(palette):
    m, nt = new_material('Slab')
    bsdf = nt.nodes['Principled BSDF']
    coord = nt.nodes.new('ShaderNodeTexCoord')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    nt.links.new(coord.outputs['Object'], sep.inputs[0])
    # g = -0.5 x + 0.866 y: the diagonal from lower right (0) to upper left (1)
    mx = nt.nodes.new('ShaderNodeMath')
    mx.operation = 'MULTIPLY'
    mx.inputs[1].default_value = -0.5
    nt.links.new(sep.outputs['X'], mx.inputs[0])
    my = nt.nodes.new('ShaderNodeMath')
    my.operation = 'MULTIPLY_ADD'
    my.inputs[1].default_value = 0.866
    nt.links.new(sep.outputs['Y'], my.inputs[0])
    nt.links.new(mx.outputs[0], my.inputs[2])
    rng = nt.nodes.new('ShaderNodeMapRange')
    rng.interpolation_type = 'SMOOTHSTEP'
    rng.inputs['From Min'].default_value = -1.25
    rng.inputs['From Max'].default_value = 1.25
    rng.inputs['To Min'].default_value = 0.0
    rng.inputs['To Max'].default_value = GRADIENT
    nt.links.new(my.outputs[0], rng.inputs['Value'])
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].color = (*hex_linear(palette.primary), 1)
    ramp.color_ramp.elements[1].color = (*hex_linear(palette.accent), 1)
    nt.links.new(rng.outputs['Result'], ramp.inputs['Fac'])
    nt.links.new(ramp.outputs['Color'], bsdf.inputs['Base Color'])
    # A candy finish: a satin base with almost no specular of its own under a
    # clear coat that carries every reflection, so the highlights stay crisp.
    bsdf.inputs['Roughness'].default_value = 0.42
    bsdf.inputs['Specular IOR Level'].default_value = 0.12
    bsdf.inputs['Coat Weight'].default_value = 1.0
    bsdf.inputs['Coat Roughness'].default_value = 0.035
    bsdf.inputs['Coat IOR'].default_value = 1.5
    return m


def glyph_material():
    m, nt = new_material('Glyph')
    bsdf = nt.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (0.85, 0.85, 0.86, 1)
    bsdf.inputs['Roughness'].default_value = 0.3
    bsdf.inputs['Specular IOR Level'].default_value = 0.3
    bsdf.inputs['Coat Weight'].default_value = 0.8
    bsdf.inputs['Coat Roughness'].default_value = 0.035
    bsdf.inputs['Emission Color'].default_value = (1, 1, 1, 1)
    bsdf.inputs['Emission Strength'].default_value = 0.08
    return m



def softbox_term(nt, direction, up_hint, half_w, half_h, soft):
    """World-shader mask of a rectangular softbox seen from the origin.

    The view direction is projected onto the softbox's plane (gnomonic), so a
    rectangle in that plane shows as a crisp rectangle in reflections."""
    a = Vector(direction).normalized()
    u = Vector(up_hint).cross(a).normalized()
    v = a.cross(u).normalized()
    coord = nt.nodes['__coord']

    def dot(vec):
        n = nt.nodes.new('ShaderNodeVectorMath')
        n.operation = 'DOT_PRODUCT'
        n.inputs[1].default_value = tuple(vec)
        nt.links.new(coord.outputs[0], n.inputs[0])
        return n.outputs['Value']

    def math_node(op, x, y=None, y_value=None):
        n = nt.nodes.new('ShaderNodeMath')
        n.operation = op
        nt.links.new(x, n.inputs[0])
        if y is not None:
            nt.links.new(y, n.inputs[1])
        elif y_value is not None:
            n.inputs[1].default_value = y_value
        return n.outputs[0]

    def edge(x, half):
        n = nt.nodes.new('ShaderNodeMapRange')
        n.interpolation_type = 'SMOOTHSTEP'
        n.inputs['From Min'].default_value = half - soft
        n.inputs['From Max'].default_value = half + soft
        n.inputs['To Min'].default_value = 1.0
        n.inputs['To Max'].default_value = 0.0
        nt.links.new(x, n.inputs['Value'])
        return n.outputs['Result']

    da = dot(a)
    front = math_node('GREATER_THAN', da, y_value=0.05)
    x = math_node('ABSOLUTE', math_node('DIVIDE', dot(u), da))
    y = math_node('ABSOLUTE', math_node('DIVIDE', dot(v), da))
    return math_node('MULTIPLY', math_node('MULTIPLY', edge(x, half_w), edge(y, half_h)), front)


def sheen_term(nt):
    """World-shader emission of the sheen: a soft band of light around
    a great circle, Gaussian in the angle off the circle's plane. The plane,
    the band's center, and the level are keyed per frame; at level 0 it adds
    exactly nothing."""
    coord = nt.nodes['__coord']
    plane = nt.nodes.new('ShaderNodeCombineXYZ')
    center = nt.nodes.new('ShaderNodeCombineXYZ')
    level = nt.nodes.new('ShaderNodeValue')
    level.outputs[0].default_value = 0.0

    def dot(vector):
        n = nt.nodes.new('ShaderNodeVectorMath')
        n.operation = 'DOT_PRODUCT'
        nt.links.new(coord.outputs[0], n.inputs[0])
        nt.links.new(vector, n.inputs[1])
        return n.outputs['Value']

    def math_node(op, x, y=None, y_value=None):
        n = nt.nodes.new('ShaderNodeMath')
        n.operation = op
        nt.links.new(x, n.inputs[0])
        if y is not None:
            nt.links.new(y, n.inputs[1])
        elif y_value is not None:
            n.inputs[1].default_value = y_value
        return n.outputs[0]

    width = math.radians(SHEEN_FWHM_DEG) / (2 * math.sqrt(math.log(2)))
    off = math_node('DIVIDE', dot(plane.outputs[0]), y_value=width)
    band = math_node('EXPONENT', math_node('MULTIPLY', math_node('MULTIPLY', off, off),
                                           y_value=-1.0))
    # fade out away from the center: a short band lights the mark very little
    reach = nt.nodes.new('ShaderNodeMapRange')
    reach.interpolation_type = 'SMOOTHSTEP'
    reach.inputs['From Min'].default_value = math.cos(math.radians(SHEEN_REACH_DEG * 1.3))
    reach.inputs['From Max'].default_value = math.cos(math.radians(SHEEN_REACH_DEG * 0.7))
    nt.links.new(dot(center.outputs[0]), reach.inputs['Value'])
    mask = math_node('MULTIPLY', math_node('MULTIPLY', band, reach.outputs['Result']),
                     level.outputs[0])
    return mask, {'plane': plane, 'center': center, 'level': level}


def build_world(scene):
    """A black studio whose few bright shapes exist to be reflected, plus the
    sheen. Returns the world and the sheen's keyable nodes."""
    w = bpy.data.worlds.new('Studio')
    scene.world = w
    if w.node_tree is None:
        w.use_nodes = True
    nt = w.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new('ShaderNodeOutputWorld')
    bg = nt.nodes.new('ShaderNodeBackground')
    nt.links.new(bg.outputs[0], out.inputs['Surface'])
    tex = nt.nodes.new('ShaderNodeTexCoord')
    norm = nt.nodes.new('ShaderNodeVectorMath')
    norm.operation = 'NORMALIZE'
    norm.name = '__coord'
    nt.links.new(tex.outputs['Generated'], norm.inputs[0])

    # World axes: Z up, the camera on -Y looking at the mark along +Y.
    # (direction, up hint, half width, half height, edge softness, color, strength)
    boxes = [
        # key softbox, upper left and in front: the upper-left corner highlight
        ((-0.6, -0.45, 0.66), (0, 0, 1), 0.30, 0.20, 0.05, (1.0, 0.97, 0.94), 6.0),
        # overhead bar: a bright line along the top bevel
        ((0.0, 0.15, 1.0), (0, 1, 0), 1.3, 0.08, 0.04, (1.0, 1.0, 1.0), 10.0),
        # thin strips left and right: crisp lines down the side bevels
        ((1.0, -0.15, 0.1), (0, 0, 1), 0.035, 0.9, 0.02, (0.92, 0.95, 1.0), 8.0),
        ((-1.0, -0.1, 0.1), (0, 0, 1), 0.04, 0.8, 0.02, (1.0, 0.95, 1.0), 5.0),
        # a wide soft band just above the camera: the long lens makes the front
        # face mirror only a few degrees around the camera, so this band's lower
        # edge becomes a soft top-to-bottom sheen across the face
        ((0.0, -1.0, 0.12), (0, 0, 1), 1.4, 0.10, 0.10, (1.0, 0.97, 1.0), 0.8),
    ]
    acc = None
    for direction, up, hw, hh, soft, color, strength in boxes:
        mask = softbox_term(nt, direction, up, hw, hh, soft)
        scale = nt.nodes.new('ShaderNodeVectorMath')
        scale.operation = 'SCALE'
        scale.inputs[0].default_value = tuple(c * strength for c in color)
        nt.links.new(mask, scale.inputs['Scale'])
        if acc is None:
            acc = scale.outputs[0]
        else:
            add = nt.nodes.new('ShaderNodeVectorMath')
            add.operation = 'ADD'
            nt.links.new(acc, add.inputs[0])
            nt.links.new(scale.outputs[0], add.inputs[1])
            acc = add.outputs[0]
    sheen, sheen_nodes = sheen_term(nt)
    tint = nt.nodes.new('ShaderNodeVectorMath')
    tint.operation = 'SCALE'
    tint.inputs[0].default_value = tuple(c * SHEEN_STRENGTH for c in (1.0, 0.98, 0.96))
    nt.links.new(sheen, tint.inputs['Scale'])
    with_sheen = nt.nodes.new('ShaderNodeVectorMath')
    with_sheen.operation = 'ADD'
    nt.links.new(acc, with_sheen.inputs[0])
    nt.links.new(tint.outputs[0], with_sheen.inputs[1])
    base = nt.nodes.new('ShaderNodeVectorMath')
    base.operation = 'ADD'
    base.inputs[1].default_value = (0.002, 0.0018, 0.0026)
    nt.links.new(with_sheen.outputs[0], base.inputs[0])
    nt.links.new(base.outputs[0], bg.inputs['Color'])
    bg.inputs['Strength'].default_value = 0.78
    w.probe_resolution = '2048'
    # never turn the bright band into a sun lamp; nothing else comes near this
    w.sun_threshold = 1000.0
    return w, sheen_nodes


def area_light(name, loc, energy, color, size, size_y=None, target=(0, 0, 0),
               specular=1.0, diffuse=1.0, shadow=True, parent=None):
    light = bpy.data.lights.new(name, 'AREA')
    light.shape = 'RECTANGLE'
    light.size = size
    light.size_y = size if size_y is None else size_y
    light.energy = energy
    light.color = color
    light.specular_factor = specular
    light.diffuse_factor = diffuse
    light.use_shadow = shadow
    if shadow:
        light.use_shadow_jitter = True
    ob = bpy.data.objects.new(name, light)
    bpy.context.scene.collection.objects.link(ob)
    if parent is not None:
        ob.parent = parent
    ob.location = loc
    ob.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    return ob


def build_lights(palette):
    """Studio rig around the mark. The rig follows the mark's position (not its
    rotation), so the far-away mark in the fly-in is lit like the resting one
    and its tumble turns it through fixed lights."""
    scene = bpy.context.scene
    rig = bpy.data.objects.new('LightRig', None)
    scene.collection.objects.link(rig)
    lights = {'rig': rig}
    # A high key: the top bevel and the tops of the glyph tubes catch it
    # harder than the face does, which gives the edges their definition.
    lights['key'] = area_light('Key', (-3.5, -5.5, 10.0), 1450, (1.0, 0.97, 0.93), 5.0,
                               specular=0.6, parent=rig)
    # A broad frontal fill with no specular sets the face to the brand value
    # without a visible reflection; from slightly above, so the lower bevel
    # falls off.
    lights['fill'] = area_light('Fill', (-1.5, -12.0, 2.5), 450, (0.95, 0.96, 1.0), 8.0,
                                specular=0.0, parent=rig)
    purple = hex_linear(palette.accent)
    lights['rim_right'] = area_light('RimPurpleR', (7.0, 2.0, 4.0), 1500, purple, 3.0, 1.0,
                                     diffuse=0.5, parent=rig)
    lights['rim_left'] = area_light('RimPurpleL', (-7.5, 2.5, 1.0), 900, purple, 3.0, 1.0,
                                    diffuse=0.5, parent=rig)
    # Lane colors below the mark, left to right as on the highway: a faint
    # spectrum on the lower bevel, colored glints in the tumble, and the
    # flashes after the impact.
    for i, (name, hexc) in enumerate(palette.lanes):
        x = -2.4 + 1.2 * i
        lights[f'lane_{i}'] = area_light(f'Rim_{name}', (x, 1.0, -7.5), 320, hex_linear(hexc),
                                         1.0, 1.6, diffuse=0.15, parent=rig)
    # The sheen's bevel catches: thin specular-only strips keyed per frame
    # along the two ends of the band (see keyframe_everything).
    span = 2 * CATCH_RADIUS * math.tan(math.radians(CATCH_TO_DEG - CATCH_FROM_DEG) / 2)
    for end in ('catch_up', 'catch_down'):
        catch = area_light(end, (0.0, -CATCH_RADIUS, 0.0), 0.0, (1.0, 0.98, 0.96), CATCH_WIDTH,
                           span, specular=1.0, diffuse=0.0, shadow=False, parent=rig)
        catch.rotation_mode = 'QUATERNION'
        lights[end] = catch
    return lights
