// One runtime layout supplies both board PROTO positions and piece/camera origins.
export function gridLayout({ boards = 20, cols = 5, pitch = 10 } = {}) {
  if (!Number.isInteger(boards) || boards < 1 || boards > 64) throw new RangeError("boards must be an integer from 1 to 64");
  if (!Number.isInteger(cols) || cols < 1 || cols > 8) throw new RangeError("cols must be an integer from 1 to 8");
  if (!Number.isFinite(pitch) || pitch < 9 || pitch > 30) throw new RangeError("pitch must be finite and between 9 and 30");
  cols = Math.min(cols, boards);
  const rows = Math.ceil(boards / cols), width = cols * pitch, height = rows * pitch;
  const origins = Array.from({ length: boards }, (_, i) => [
    ((i % cols) - (cols - 1) / 2) * pitch, 0,
    (Math.floor(i / cols) - (rows - 1) / 2) * pitch,
  ]);
  return { boards, cols, rows, pitch, width, height, origins, phaseOrigin: [width / 2 + 7, 3.5, 0] };
}

/** The checked-in generated scene supplies the trusted ChessBoard PROTO only.
 * Instances and viewpoint extents are rebuilt for the actual requested count.
 * This is a fixed-template builder, not an importer for arbitrary X3D documents.
 */
export function gridSceneXml(template, layout) {
  const proto = template.match(/<ProtoDeclare\s+name=['"]ChessBoard['"][\s\S]*?<\/ProtoDeclare>/)?.[0];
  if (!proto) throw new Error("The local board template has no ChessBoard PROTO");
  const { boards, width: w, height: h, origins } = layout;
  const instances = origins.map((o, i) => `<ProtoInstance name='ChessBoard' DEF='board_${i}'><fieldValue name='translation' value='${o.join(" ")}'/></ProtoInstance>`).join("\n");
  const y = Math.max(w, h) * 0.75, z = h * 0.62;
  return `<?xml version="1.0" encoding="UTF-8"?>
<X3D profile='Interchange' version='4.0'><head><component name='PointingDeviceSensor' level='1'/>
<meta name='title' content='x3d.chess ${boards}-board runtime grid'/><meta name='license' content='GPL-3.0-or-later'/></head><Scene>
<NavigationInfo DEF='nav' type='"EXAMINE" "ANY"' headlight='false' transitionType='"TELEPORT"'/>
<Background DEF='bg' skyColor='0.02 0.03 0.06'/>
<Viewpoint DEF='vp_overview' position='0 ${y} ${z}' orientation='1 0 0 -1.05' description='Overview'/>
<Viewpoint DEF='vp_focus' position='0 ${y} ${z}' orientation='1 0 0 -1.05' description='Focus'/>
<Viewpoint DEF='vp_phase' position='${w / 2 + 7} 5.5 13' orientation='1 0 0 -0.12' description='Phase space'/>
<DirectionalLight direction='-0.3 -1 -0.5' intensity='0.85'/><DirectionalLight direction='0.4 -0.6 0.7' intensity='0.35' color='0.6 0.7 1'/>
${proto}\n${instances}</Scene></X3D>`;
}
