import { useEffect, useRef } from 'react'
import { mountGlobe } from './globe/runtime.mjs'
import { mountControls } from './globe/controls.mjs'

export default function App() {
  const root = useRef<HTMLElement>(null)
  useEffect(() => {
    const element = root.current
    if (!element) return
    const disposeControls = mountControls(element)
    const disposeGlobe = mountGlobe(element)
    return () => {
      disposeGlobe()
      disposeControls()
    }
  }, [])
  return (
    <main ref={root} aria-label="Quadstream Globe">
      <canvas
            id="globe"
            tabIndex="0"
            aria-label="Interactive globe. Drag to rotate and pinch or scroll to zoom. Hold arrow keys to thrust, D to fly in, C to fly out, Space to brake and R to reset."
          ></canvas>
          <canvas
            id="minimap"
            width="160"
            height="160"
            aria-label="Globe culling minimap"
          ></canvas>
          <div id="controls">
            <div id="toolbar" role="group" aria-label="Globe viewer actions">
              <button
                id="settings-toggle"
                aria-expanded="false"
                aria-controls="panel"
              >
                ⚙ Settings
              </button>
              <button id="reset" title="Reset view">Reset view</button>
              <button id="minimap-toggle" aria-controls="minimap" aria-pressed="true">
                Minimap
              </button>
              <button
                id="status-indicator"
                aria-label="View rendering status"
                hidden
              ></button>
            </div>
            <section id="panel" aria-label="Globe settings" hidden>
              <details id="rendering" open>
                <summary>Rendering</summary>
              <label
                >Geometry
                <select id="mode">
                  <option value="quadstream">Quadstream</option>
                  <option value="original">Original</option>
                </select></label
              >
              <div id="lod-row" className="lod-row">
                <label htmlFor="level">LOD</label>
                <input
                  id="level"
                  type="range"
                  min="0"
                  max="19"
                  step="0.1"
                  defaultValue="4"
                /><output id="level-value">4</output>
              </div>
              <label><input id="show-quadtree" type="checkbox" /> Show quadtree</label>
              </details>
              <details id="data-source">
                <summary>Data source</summary>
                <label>Atlas
                  <select id="atlas" defaultValue="50m">
                    <option value="110m">110m</option>
                    <option value="50m">50m</option>
                    <option value="fixture">Test fixture</option>
                  </select>
                </label>
                <label htmlFor="file">Local file</label>
                <input id="file" type="file" accept=".json,.geojson,.topojson" />
              </details>
              <details id="navigation">
                <summary>Navigation</summary>
                <label
                  ><input id="smooth" type="checkbox" defaultChecked /> Smooth
                  navigation</label
                >
                <div className="lod-row">
                  <label htmlFor="nav-response">Response (ms)</label>
                  <input
                    id="nav-response"
                    type="range"
                    min="50"
                    max="1500"
                    step="10"
                    defaultValue="300"
                  /><output id="nav-response-value">300</output>
                </div>
                <div className="lod-row">
                  <label htmlFor="nav-damping">Damping</label>
                  <input
                    id="nav-damping"
                    type="range"
                    min="0.1"
                    max="2"
                    step="0.05"
                    defaultValue="1"
                  /><output id="nav-damping-value">1</output>
                </div>
                <div className="lod-row">
                  <label htmlFor="nav-zoom">Zoom speed</label>
                  <input
                    id="nav-zoom"
                    type="range"
                    min="0.25"
                    max="3"
                    step="0.05"
                    defaultValue="1"
                  /><output id="nav-zoom-value">1</output>
                </div>
                <div className="lod-row">
                  <label htmlFor="nav-fly-pan">Fly pan (px/s)</label>
                  <input
                    id="nav-fly-pan"
                    type="range"
                    min="50"
                    max="2000"
                    step="10"
                    defaultValue="600"
                  /><output id="nav-fly-pan-value">600</output>
                </div>
                <div className="lod-row">
                  <label htmlFor="nav-fly-zoom">Fly zoom (oct/s)</label>
                  <input
                    id="nav-fly-zoom"
                    type="range"
                    min="0.1"
                    max="4"
                    step="0.1"
                    defaultValue="1"
                  /><output id="nav-fly-zoom-value">1</output>
                </div>
                <div className="lod-row">
                  <label htmlFor="nav-drag">Drag (1/s)</label>
                  <input
                    id="nav-drag"
                    type="range"
                    min="0.5"
                    max="15"
                    step="0.1"
                    defaultValue="5"
                  /><output id="nav-drag-value">5</output>
                </div>
                <p className="hint">
                  Fly: arrows thrust, D in, C out, Space brake, R reset
                </p>
              </details>
              <details id="diagnostics-section">
                <summary>Diagnostics</summary>
                <p id="status" role="status" aria-live="polite">Loading geometry…</p>
                <button id="retry" hidden>Retry</button>
                <pre id="diagnostics"></pre>
              </details>
            </section>
          </div>
    </main>
  )
}
