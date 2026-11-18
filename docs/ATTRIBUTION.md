# Attribution

| Component | Licence | Use |
|---|---|---|
| Stockfish / stockfish.js | GPL-3.0 | actual vendored Stockfish 19 Lite WASM engine; optional native UCI engine |
| python-chess | GPL-3.0+ | move generation, UCI driver |
| X_ITE 16.6.1 | MIT | locally pinned renderer subset, with package/font/third-party license files and origin inventory |
| chess.js 1.4.0 | BSD-2-Clause | browser chess rules and independent study witnesses; retained vendor license |
| x3d_mcp | retained upstream license | unmodified pinned public validation subset; see vendor origin inventory and licenses |
| aiohttp | Apache-2.0 | server |
| chess-spectator (owner's prior code) | owner | source of the ported concepts and analysis modules |

This repo is GPL-3.0-or-later.

Runtime origins and byte inventories are in `viewer/vendor/DEPENDENCIES.json`
and `viewer/vendor/x_ite/ORIGIN.json`. Existing engine/rules vendor bytes are
unchanged from the named baseline. Source/build information shipped with the
Stockfish distribution is retained; upstream projects are
[Stockfish](https://github.com/official-stockfish/Stockfish) and
[stockfish.js](https://github.com/nmrugg/stockfish.js).

Study explanations and new integration code were authored for this extension;
the field guide links primary rule, engine, library and X3D documentation.
The optional preview uses Blender and the public `blender_io_x3d` importer.
Their exact external revisions and presentation changes are recorded in
`evidence/blender-preview.json`; neither binary is redistributed here.
