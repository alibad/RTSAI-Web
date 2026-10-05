"""Render small chain thumbnails of generated GLB models with Blender's Cycles on the CPU (never the GPU).

    blender -b --factory-startup -P scripts/glb-thumb.py -- <out-dir> <job.json>

job.json: [{"glb": "<abs path>", "out": "<file name>.png"}, ...]. One Blender process renders every job from
the same three-quarter view the Studio's 3D model step opens with, on a dark neutral background,
448x256, few samples. Thumbnails only identify the model; they are not game art or a quality check.
"""
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
out_dir, jobs = Path(argv[0]), json.loads(Path(argv[1]).read_text(encoding="utf-8"))
out_dir.mkdir(parents=True, exist_ok=True)

scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.device = "CPU"
prefs = bpy.context.preferences.addons.get("cycles")
if prefs:
    prefs.preferences.compute_device_type = "NONE"
scene.cycles.samples = 12
scene.cycles.use_denoising = False
scene.cycles.max_bounces = 2
scene.render.resolution_x, scene.render.resolution_y, scene.render.resolution_percentage = 448, 256, 100
scene.render.film_transparent = False
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGB"
scene.view_settings.view_transform = "Standard"
world = bpy.data.worlds.new("thumb") if not scene.world else scene.world
scene.world = world
world.use_nodes = True
bg = world.node_tree.nodes.get("Background")
bg.inputs[0].default_value = (0.045, 0.06, 0.045, 1.0)
bg.inputs[1].default_value = 0.6


def clear():
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for block in (bpy.data.meshes, bpy.data.materials, bpy.data.images, bpy.data.cameras, bpy.data.lights):
        for item in list(block):
            if item.users == 0:
                block.remove(item)


for job in jobs:
    clear()
    bpy.ops.import_scene.gltf(filepath=job["glb"])
    meshes = [o for o in scene.objects if o.type == "MESH"]
    if not meshes:
        print("NO-MESH", job["glb"], flush=True)
        continue
    corners = [o.matrix_world @ Vector(c) for o in meshes for c in o.bound_box]
    lo = Vector((min(c.x for c in corners), min(c.y for c in corners), min(c.z for c in corners)))
    hi = Vector((max(c.x for c in corners), max(c.y for c in corners), max(c.z for c in corners)))
    centre, size = (lo + hi) / 2, max(hi - lo)
    cam_data = bpy.data.cameras.new("cam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = size * 1.9
    cam = bpy.data.objects.new("cam", cam_data)
    scene.collection.objects.link(cam)
    # The Studio's GLB view direction (three.js camera offset 3, 2.1, 4.2 in glTF axes; glTF +Y is Blender +Z).
    direction = Vector((3.0, -4.2, 2.1)).normalized()
    cam.location = centre + direction * size * 4
    cam.rotation_euler = (centre - cam.location).to_track_quat("-Z", "Y").to_euler()
    scene.camera = cam
    for name, energy, rot in (("key", 3.2, (math.radians(50), 0, math.radians(-40))), ("fill", 0.8, (math.radians(70), 0, math.radians(140)))):
        light = bpy.data.objects.new(name, bpy.data.lights.new(name, "SUN"))
        light.data.energy = energy
        light.rotation_euler = rot
        scene.collection.objects.link(light)
    scene.render.filepath = str(out_dir / job["out"])
    bpy.ops.render.render(write_still=True)
    print("RENDERED", job["out"], flush=True)
