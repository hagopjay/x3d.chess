#!/usr/bin/env bash
# XSD gate for every scene, against the official Web3D X3D 4.0 XSD.
# The project-wide gate is the x3d_mcp validator (hagopjay/x3d_mcp); this is the minimal
# offline stand-in. The W3C xmldsig import is swapped for tools/xmldsig-stub.xsd.
set -euo pipefail
cd "$(dirname "$0")/.."
W="$(mktemp -d)"; trap 'rm -rf "$W"' EXIT
B=https://www.web3d.org/specifications
for f in x3d-4.0.xsd x3d-4.0-Web3dExtensionsPrivate.xsd x3d-4.0-Web3dExtensionsPublic.xsd; do
  if [ -n "${X3D_XSD_DIR:-}" ] && [ -f "$X3D_XSD_DIR/$f" ]; then cp "$X3D_XSD_DIR/$f" "$W/$f"
  else curl -fsS -o "$W/$f" "$B/$f"; fi
done
cp tools/xmldsig-stub.xsd "$W/"
sed -i -E 's#schemaLocation="http://www.w3.org/TR[^"]*xmldsig[^"]*"#schemaLocation="xmldsig-stub.xsd"#g' "$W/x3d-4.0.xsd"
rc=0
for f in viewer/scenes/*.x3d; do
  xmllint --noout --schema "$W/x3d-4.0.xsd" "$f" || rc=1
done
exit $rc
