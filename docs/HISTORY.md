# Historical provenance and preservation

## Standalone repository (2010–2011)

- Repository: https://github.com/curran/quadstream
- Historical Java pipeline: `src/main/java/org/curransoft/quadstream/Quadstream.java`
- Browser BLG tree: `src/main/webapp/js/blgTree.js`
- Browser R-tree prototype: `src/main/webapp/js/rtree.js`
- Java shapefile input, adjacency/critical-vertex detection, SQL output and browser demos remain at their original paths. This PR adds modern sources, without replacing legacy files or modifying their original licenses.
- The historical `Quadstream00/README` declares the GNU Lesser General Public License but does not state a version.

## UDCVis continuation (2012)

- Repository: https://github.com/curran/udcvis
- Quadtree placement: `0.2/examples/worldMap/scripts/quadstream/buildTree.js`
- Partitioning: `0.2/examples/worldMap/scripts/quadstream/partitionFiles.js`
- BLG: `0.2/examples/worldMap/scripts/blgTree.js`
- Research report: `0.2/Quadstream/presentations/2012_12_6_Report/index.md`

The 2012 system combines spatially distributed vertex priorities with per-polygon ordered priority trees. Its report explicitly identifies remaining issues including non-simple output polygons, inconsistent shared boundaries, incomplete network partitioning, and lack of viewport intersection indexing. The 2012 implementation also includes a disabled conditional (`if(true)`) in the BLG insertion path; do not port it line-for-line.

## Revival decisions

- Reimplement the ideas, not the original dependencies, in self-contained strict TypeScript.
- Use canonical exact-coordinate topological arcs and deterministic quadtree insertion; no random noise.
- Replace incremental BLG mutation with an ordered min-Cartesian tree for the initial batch case.
- Treat output validity as an explicit gate; globally fall back to original geometry instead of returning malformed output.
- Keep the original Java/Dojo/Processing.js source in its existing locations for research and licensing audits.
- Keep the proposed npm package private until third-party provenance and license scope are established.
