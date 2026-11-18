#!/usr/bin/env python3
"""Render an offline Blender preview from an actual portable chess X3D file.

Run with Blender --background --factory-startup --threads 2 --python-exit-code 1
--python tools/render_preview.py -- --addon-root /path/to/x3d-blender-io
This is an authored CPU still, not a native X_ITE pixel or color-parity test.
"""
from __future__ import annotations
import argparse
from datetime import datetime, timezone
import hashlib
import importlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=Path, default=ROOT/'examples/x3d/en-passant-ray-rank-exposure.x3d')
    parser.add_argument('--addon-root', type=Path, required=True)
    parser.add_argument('--output', type=Path, default=ROOT/'docs/assets/chess-preview.png')
    parser.add_argument('--receipt', type=Path, default=ROOT/'evidence/blender-preview.json')
    args = parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
    import bpy
    from mathutils import Vector

    raw = args.input.read_bytes()
    xml = ET.fromstring(raw)
    metadata = json.loads(next(m.get('content') for m in xml.findall('./head/meta') if m.get('name')=='x3dchess.snapshot'))
    expected = {}
    for r, row in enumerate(metadata['fen'].split()[0].split('/')):
        f = 0
        for ch in row:
            if ch.isdigit(): f += int(ch)
            else:
                square = 'abcdefgh'[f]+str(8-r)
                # The import operator's -Z-forward/Y-up conversion is (x,-z,y).
                expected[square] = {'piece':ch, 'center_xy':[f-3.5, -(3.5-(7-r))], 'base_z':0.05}
                f += 1
    bpy.ops.wm.read_factory_settings(use_empty=True)
    with tempfile.TemporaryDirectory(prefix='x3dchess-addon-') as temp:
        package = Path(temp)/'io_scene_x3d';package.symlink_to(args.addon_root.resolve()/'source',target_is_directory=True)
        sys.path.insert(0,temp);addon=importlib.import_module('io_scene_x3d');addon.register()
        bpy.ops.import_scene.x3d(filepath=str(args.input.resolve()),axis_forward='-Z',axis_up='Y',circle_divisions=48,color_space='SRGB',light_units='BLENDER')
        imported = list(bpy.data.objects)
        groups = {sq:[] for sq in expected}
        for ob in imported:
            tag = str(ob.get('x3d_def',''))+' / '+str(ob.get('x3d_def_path',''))+' / '+ob.name
            for sq in expected:
                if 'piece_'+sq in tag and ob.type=='MESH':groups[sq].append(ob)
        comparison=[]
        for sq, target in expected.items():
            vertices=[ob.matrix_world@v.co for ob in groups[sq] for v in ob.data.vertices]
            if not vertices:raise RuntimeError('Imported piece geometry absent: '+sq)
            lo=[min(v[a] for v in vertices) for a in range(3)];hi=[max(v[a] for v in vertices) for a in range(3)]
            actual=[(lo[0]+hi[0])/2,(lo[1]+hi[1])/2,lo[2]]
            want=[*target['center_xy'],target['base_z']]
            error=max(abs(a-b) for a,b in zip(actual,want))
            if error>2e-5:raise RuntimeError('Imported piece occupancy differs: '+sq+' '+str((actual,want,error)))
            comparison.append({'square':sq,'piece':target['piece'],'mesh_parts':len(groups[sq]),'actual_bbox_center_xy_base_z':actual,'expected':want,'max_absolute_error':error})

        science=bpy.data.collections.new('Imported_X3D_Model');bpy.context.scene.collection.children.link(science)
        studio=bpy.data.collections.new('Authored_Studio');bpy.context.scene.collection.children.link(studio)
        for ob in imported:
            for c in list(ob.users_collection):c.objects.unlink(ob)
            science.objects.link(ob)
            if ob.type in ('LIGHT','CAMERA'):ob.hide_render=True
        # Keep imported edge coordinates as evidence; give actual edge segments
        # a thin tube projection so the relation is visible to Cycles.
        tube_count=0;curve_segments=0
        for ob in imported:
            if ob.type=='CURVE':
                # The legacy importer uses zero-bevel CURVE for an uncolored
                # IndexedLineSet. Preserve the imported spline coordinates.
                ob.data.bevel_depth=.025;ob.data.bevel_resolution=3
                curve_segments+=sum(max(0,len(s.points)-1) for s in ob.data.splines)
                continue
            if ob.type!='MESH' or len(ob.data.polygons) or not len(ob.data.edges):continue
            material=ob.data.materials[0] if ob.data.materials else None
            for edge in ob.data.edges:
                a,b=[ob.matrix_world@ob.data.vertices[i].co for i in edge.vertices]
                curve=bpy.data.curves.new('Relation_Tube','CURVE');curve.dimensions='3D';curve.bevel_depth=.025;curve.bevel_resolution=3
                spline=curve.splines.new('POLY');spline.points.add(1)
                spline.points[0].co=(*a,1);spline.points[1].co=(*b,1)
                tube=bpy.data.objects.new('Relation_Tube',curve);studio.objects.link(tube)
                if material:curve.materials.append(material)
                tube_count+=1
            ob.hide_render=True
        for mat in bpy.data.materials:
            if not mat.use_nodes:continue
            for n in mat.node_tree.nodes:
                if n.type=='BSDF_PRINCIPLED':
                    n.inputs['Roughness'].default_value=.29
                    n.inputs['Metallic'].default_value=.16
        def move_to_studio(ob):
            for c in list(ob.users_collection):c.objects.unlink(ob)
            studio.objects.link(ob)
        bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,-.315))
        floor=bpy.context.object;floor.name='Studio_Floor';move_to_studio(floor)
        mat=bpy.data.materials.new('Studio_Midnight_Green');mat.diffuse_color=(.012,.025,.026,1);mat.use_nodes=True
        bsdf=mat.node_tree.nodes.get('Principled BSDF');bsdf.inputs['Base Color'].default_value=(.012,.025,.026,1);bsdf.inputs['Roughness'].default_value=.33;bsdf.inputs['Metallic'].default_value=.28;floor.data.materials.append(mat)
        def area(name,position,power,color,size):
            d=bpy.data.lights.new(name,'AREA');d.energy=power;d.shape='DISK';d.size=size;d.color=color
            ob=bpy.data.objects.new(name,d);studio.objects.link(ob);ob.location=position;ob.rotation_euler=(Vector((0,0,.3))-ob.location).to_track_quat('-Z','Y').to_euler()
        area('Warm_Key',(2,-6,10),1800,(1,.82,.61),7)
        area('Cool_Fill',(-7,-2,5),1200,(.48,.76,1),6)
        area('Rim',(3,6,8),2100,(.55,1,.85),5)
        camera_data=bpy.data.cameras.new('Studio_Camera');camera=bpy.data.objects.new('Studio_Camera',camera_data);studio.objects.link(camera)
        target=Vector((0,0,.35));camera.location=(10,-13.5,12);camera.rotation_euler=(target-camera.location).to_track_quat('-Z','Y').to_euler();camera_data.type='ORTHO';camera_data.ortho_scale=12.2
        scene=bpy.context.scene;scene.camera=camera
        scene.world=bpy.data.worlds.new('Studio_World');scene.world.use_nodes=True;scene.world.node_tree.nodes['Background'].inputs['Color'].default_value=(.025,.045,.065,1);scene.world.node_tree.nodes['Background'].inputs['Strength'].default_value=.35
        scene.render.engine='CYCLES';scene.cycles.device='CPU';scene.cycles.samples=24;scene.cycles.use_denoising=True;scene.cycles.seed=1801
        scene.render.threads_mode='FIXED';scene.render.threads=2;scene.render.resolution_x=1280;scene.render.resolution_y=960;scene.render.resolution_percentage=100
        scene.view_settings.view_transform='Standard';scene.view_settings.look='Medium High Contrast';scene.view_settings.exposure=0;scene.view_settings.gamma=1
        args.output.parent.mkdir(parents=True,exist_ok=True);args.receipt.parent.mkdir(parents=True,exist_ok=True)
        scene.render.filepath=str(args.output.resolve());scene.render.image_settings.file_format='PNG'
        start=time.perf_counter();bpy.ops.render.render(write_still=True);elapsed=time.perf_counter()-start
        fork_commit=subprocess.check_output(['git','rev-parse','HEAD'],cwd=args.addon_root,text=True).strip()
        report={'schema':'x3dchess.blender-preview/1','status':'pass','created_utc':datetime.now(timezone.utc).isoformat(),
            'source':str(args.input.resolve().relative_to(ROOT)),'source_sha256':hashlib.sha256(raw).hexdigest(),
            'source_study':metadata,'blender_version':bpy.app.version_string,'blender_build':bpy.app.build_hash.decode(),
            'binary_sha256':sha(bpy.app.binary_path),'fork_repository':'https://github.com/hagopjay/x3d-blender-io','fork_commit':fork_commit,
            'tool_sha256':sha(__file__),'import_source_sha256':{name:sha(args.addon_root/'source'/name) for name in ('__init__.py','import_x3d.py')},
            'imported_objects':len(imported),'piece_occupancy':{'status':'pass','pieces':len(comparison),'comparisons':comparison,'tolerance':2e-5,
                'scope':'Actual imported mesh world bounding-box centers in the board plane and base height; not full topology/material or chess-rule recertification.'},
            'projection':{'edge_segments_as_studio_tubes':tube_count,'imported_curve_segments_given_bevel':curve_segments,'tube_radius':.025},
            'render':{'engine':'Cycles','device':'CPU','threads':2,'samples':24,'width':1280,'height':960,'seed':1801,'elapsed_seconds':elapsed,'view_transform':'Standard','look':scene.view_settings.look},
            'image_sha256':sha(args.output),'image_bytes':args.output.stat().st_size,
            'scope':'Authored offline Blender studio still from actual portable X3D import. Not native X_ITE browser pixels, color parity, a GPU benchmark or a new engine analysis.',
            'appearance_changes':['Imported lights/camera disabled for the studio view.','Principled roughness/metallic authored for presentation.','Imported edge-only relation geometry rendered as thin tubes from actual edge coordinates; existing relation curves receive the same radius.','Separate studio floor, camera and three area lights.'],
            'limitations':['The imported coordinate-label text appears as outline boxes in this studio still; typography fidelity has not passed.','The occupancy check covers the five actual imported pieces, not full topology/material/annotation equivalence.']}
        args.receipt.write_text(json.dumps(report,indent=2)+'\n')
        print(json.dumps({'status':'pass','image':str(args.output),'piece_count':len(comparison),'elapsed_seconds':elapsed}))


if __name__=='__main__':main()
