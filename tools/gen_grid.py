#!/usr/bin/env python3
"""Generate viewer/scenes/grid.x3d: PROTO ChessBoard (64 squares + eval bar) instanced N times in a grid.

usage: gen_grid.py [out] [cols] [rows]   (default 5 x 4 = 20 boards, the original spectator layout)
Contract (docs/X3D-MAPPING.md): board_<i> ProtoInstance with fields tintDark, tintLight, evalScale.
Pieces are created at runtime by viewer/js/pieces.js.
"""
import sys
from pathlib import Path

out = Path(sys.argv[1] if len(sys.argv) > 1 else "viewer/scenes/grid.x3d")
cols = int(sys.argv[2]) if len(sys.argv) > 2 else 5
rows = int(sys.argv[3]) if len(sys.argv) > 3 else 4
PITCH = 10.0

sq = []
for r in range(8):
    for f in range(8):
        light = (f + r) % 2 == 1
        x, z = f - 3.5, 3.5 - r
        app = "<Appearance USE='appL'/>" if light else "<Appearance USE='appD'/>"
        sq.append(f"        <Transform translation='{x} 0 {z}'><Shape>{app}<Box size='1 0.1 1'/></Shape></Transform>")
squares = "\n".join(sq)

proto = f"""    <ProtoDeclare name='ChessBoard'>
      <ProtoInterface>
        <field accessType='initializeOnly' type='SFVec3f' name='translation' value='0 0 0'/>
        <field accessType='inputOutput' type='SFColor' name='tintDark' value='0.02 0.03 0.07'/>
        <field accessType='inputOutput' type='SFColor' name='tintLight' value='0.07 0.08 0.1'/>
        <field accessType='inputOutput' type='SFVec3f' name='evalScale' value='1 1 1'/>
        <field accessType='inputOutput' type='SFColor' name='darkColor' value='0.18 0.2 0.3'/>
        <field accessType='inputOutput' type='SFColor' name='lightColor' value='0.55 0.6 0.72'/>
        <field accessType='outputOnly' type='SFTime' name='touchTime'/>
        <field accessType='outputOnly' type='SFVec3f' name='hitPoint'/>
      </ProtoInterface>
      <ProtoBody>
        <Transform>
          <IS><connect nodeField='translation' protoField='translation'/></IS>
          <TouchSensor DEF='touch'><IS><connect nodeField='touchTime' protoField='touchTime'/><connect nodeField='hitPoint_changed' protoField='hitPoint'/></IS></TouchSensor>
          <!-- Six static Shapes give every board a grounded plinth and a fine
               double inlay; relation colours remain reserved for analysis. -->
          <Transform translation='0 -0.18 0'><Shape><Appearance><Material diffuseColor='0.045 0.07 0.06' specularColor='0.22 0.3 0.26' shininess='0.28'/></Appearance><Box size='8.72 0.25 8.72'/></Shape></Transform>
          <Transform translation='0 -0.008 4.18'><Shape><Appearance DEF='frameApp'><Material diffuseColor='0.12 0.17 0.145' specularColor='0.36 0.42 0.37' shininess='0.4'/></Appearance><Box size='8.72 0.075 0.36'/></Shape></Transform>
          <Transform translation='0 -0.008 -4.18'><Shape><Appearance USE='frameApp'/><Box size='8.72 0.075 0.36'/></Shape></Transform>
          <Transform translation='4.18 -0.008 0'><Shape><Appearance USE='frameApp'/><Box size='0.36 0.075 8'/></Shape></Transform>
          <Transform translation='-4.18 -0.008 0'><Shape><Appearance USE='frameApp'/><Box size='0.36 0.075 8'/></Shape></Transform>
          <Shape><Appearance><Material emissiveColor='0.3 0.4 0.34' diffuseColor='0 0 0'/></Appearance><IndexedLineSet coordIndex='0 1 2 3 0 -1 4 5 6 7 4 -1'><Coordinate point='-4.29 0.033 -4.29,4.29 0.033 -4.29,4.29 0.033 4.29,-4.29 0.033 4.29,-4.065 0.033 -4.065,4.065 0.033 -4.065,4.065 0.033 4.065,-4.065 0.033 4.065'/></IndexedLineSet></Shape>
          <Shape><Appearance DEF='appD'><Material diffuseColor='0.18 0.2 0.3'><IS><connect nodeField='diffuseColor' protoField='darkColor'/><connect nodeField='emissiveColor' protoField='tintDark'/></IS></Material></Appearance><Box size='0.001 0.001 0.001'/></Shape>
          <Shape><Appearance DEF='appL'><Material diffuseColor='0.55 0.6 0.72'><IS><connect nodeField='diffuseColor' protoField='lightColor'/><connect nodeField='emissiveColor' protoField='tintLight'/></IS></Material></Appearance><Box size='0.001 0.001 0.001'/></Shape>
{squares}
          <Transform translation='-4.6 0.5 0'>
            <IS><connect nodeField='scale' protoField='evalScale'/></IS>
            <Shape><Appearance><Material diffuseColor='0.9 0.9 0.9' emissiveColor='0.25 0.25 0.25'/></Appearance><Box size='0.3 1 8'/></Shape>
          </Transform>
        </Transform>
      </ProtoBody>
    </ProtoDeclare>"""

inst = []
for i in range(cols * rows):
    c, r = i % cols, i // cols
    x, z = (c - (cols - 1) / 2) * PITCH, (r - (rows - 1) / 2) * PITCH
    inst.append(f"    <ProtoInstance name='ChessBoard' DEF='board_{i}'><fieldValue name='translation' value='{x} 0 {z}'/></ProtoInstance>")

W, H = cols * PITCH, rows * PITCH
doc = f"""<?xml version="1.0" encoding="UTF-8"?>
<X3D profile='Interchange' version='4.0' xmlns:xsd='http://www.w3.org/2001/XMLSchema-instance' xsd:noNamespaceSchemaLocation='https://www.web3d.org/specifications/x3d-4.0.xsd'>
  <head>
    <component name='PointingDeviceSensor' level='1'/>
    <meta name='title' content='x3d.chess grid ({cols}x{rows} boards)'/>
    <meta name='description' content='PROTO ChessBoard instanced in a grid. Generated by tools/gen_grid.py.'/>
    <meta name='license' content='GPL-3.0-or-later'/>
  </head>
  <Scene>
    <NavigationInfo DEF='nav' type='"EXAMINE" "ANY"' headlight='false' transitionType='"TELEPORT"'/>
    <Background DEF='bg' skyColor='0.02 0.03 0.06'/>
    <Viewpoint DEF='vp_overview' position='0 {max(W, H) * 0.75:.1f} {H * 0.62:.1f}' orientation='1 0 0 -1.05' description='Overview'/>
    <Viewpoint DEF='vp_focus' position='0 {max(W, H) * 0.75:.1f} {H * 0.62:.1f}' orientation='1 0 0 -1.05' description='Focus'/>
    <Viewpoint DEF='vp_phase' position='{W / 2 + 7:.1f} 5.5 13' orientation='1 0 0 -0.12' description='Phase space'/>
    <DirectionalLight direction='-0.3 -1 -0.5' intensity='0.85'/>
    <DirectionalLight direction='0.4 -0.6 0.7' intensity='0.35' color='0.6 0.7 1'/>
{proto}
{chr(10).join(inst)}
  </Scene>
</X3D>
"""
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(doc)
print(f"wrote {out}: {cols * rows} boards, {len(doc) // 1024} KiB")
