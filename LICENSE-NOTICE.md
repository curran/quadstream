# License scope and historical notices

The modern TypeScript implementation in `src/`, the modern CLI in `bin/`,
and the associated new documentation, tests, build configuration and examples
are licensed under the MIT License (see [LICENSE](LICENSE)), except for
third-party material subject to its own terms.

The historical Java and browser implementations are **not relicensed**.
The original [Quadstream00 README](https://github.com/curran/quadstream/blob/master/Quadstream00/README)
declares the GNU Lesser General Public License without specifying a version.
Preserve that notice and all other historical third-party notices. The root
MIT license is scoped to the modern implementation, not a blanket grant over
the legacy directories or bundled dependencies.

The modern globe interaction is adapted from the MIT-licensed
[Submarine cable globe](https://vizhub.com/viz/rPa9vFJ0kEvpjaJn-280C).
See [globe documentation](https://github.com/curran/quadstream/blob/master/docs/GLOBE.md)
for provenance. D3, MapLibre, topojson-client and World Atlas/Natural Earth
are demo/development inputs, not bundled runtime dependencies of the npm core.
Their applicable upstream licenses and notices remain in force.

## Release gate

The maintainer has selected MIT for the modern implementation. Before public
distribution, confirm rights/provenance for included material, inspect the
packed artifact, verify npm scope access and version availability, and record
the remaining release sign-off in the roadmap. The manifest remains private
until a separate release decision. This notice does not change rights already
granted for historical files.
