// D3 orthographic rotation with roll fixed to zero.
const RAD = Math.PI / 180;
const HALF = Math.PI / 2;
const TAU = 2 * Math.PI;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const near = (v, ref) => v + TAU * Math.round((ref - v) / TAU);
const center = (view) => view.translation ?? [view.width / 2, view.height / 2];

// Invert only the visible hemisphere. Anchor coordinates are radians.
export function globeAnchor(view, x, y) {
  const [cx, cy] = center(view);
  const u = (x - cx) / view.scale;
  const v = (cy - y) / view.scale;
  const d = u * u + v * v;
  if (!Number.isFinite(d) || d > 1 + 1e-12 || !(view.scale > 0))
    return null;
  const z = Math.sqrt(Math.max(0, 1 - d));
  const pitch = view.rotation[1] * RAD;
  const a = z * Math.cos(pitch) + v * Math.sin(pitch);
  const b = v * Math.cos(pitch) - z * Math.sin(pitch);
  return [
    Math.atan2(u, a) - view.rotation[0] * RAD,
    Math.atan2(b, Math.hypot(a, u)),
  ];
}

// x = cos(phi) sin(lambda + yaw); y = sin(phi) cos(pitch)
// + cos(phi) cos(lambda + yaw) sin(pitch).
export function anchorRotation(view, anchor, x, y, scale = view.scale) {
  const [cx, cy] = center(view);
  const u = (x - cx) / scale;
  const v = (cy - y) / scale;
  const [oldYaw, oldPitch] = view.rotation.map((a) => a * RAD);
  if (!anchor || !Number.isFinite(u) || !Number.isFinite(v) || !(scale > 0))
    return [view.rotation[0], view.rotation[1], 0];
  const [lambda, phi] = anchor;
  const c = Math.cos(phi);
  const b = Math.sin(phi);
  const oldL = oldYaw + lambda;
  let best = null;

  // For fixed longitude, y is monotonic on each feasible front-facing
  // pitch interval; its closest value can be solved analytically.
  function evaluate(l) {
    const a = c * Math.cos(l);
    const px = c * Math.sin(l);
    const radius = Math.hypot(a, b);
    const alpha = Math.atan2(b, a);
    const yaw = near(l - lambda, oldYaw);
    const want = Math.asin(clamp(v / (radius || 1), -1, 1));
    for (let k = -1; k <= 1; k++) {
      const offset = alpha - k * TAU;
      const lo = Math.max(-HALF, -HALF - offset);
      const hi = Math.min(HALF, HALF - offset);
      if (lo > hi) continue;
      const pitch =
        radius < 1e-14
          ? clamp(oldPitch, lo, hi)
          : clamp(want - offset, lo, hi);
      const py = radius * Math.sin(pitch + offset);
      const error = (px - u) ** 2 + (py - v) ** 2;
      const motion = (yaw - oldYaw) ** 2 + (pitch - oldPitch) ** 2;
      if (
        !best ||
        error < best.error - 1e-15 ||
        (Math.abs(error - best.error) <= 1e-15 && motion < best.motion)
      ) {
        best = { yaw, pitch, error, motion, l };
      }
    }
  }

  evaluate(oldL);
  if (c > 1e-14) {
    const root = Math.asin(clamp(u / c, -1, 1));
    evaluate(root);
    evaluate(Math.PI - root);
  }
  // Exact roots cover reachable anchors. For constrained targets, search
  // longitude and refine the best basin without allowing roll or back faces.
  if (!best || best.error > 1e-14) {
    const steps = 64;
    let step = TAU / steps;
    for (let i = 0; i < steps; i++) evaluate(oldL - Math.PI + i * step);
    for (let i = 0; i < 24 && best; i++) {
      const l = best.l;
      evaluate(l - step);
      evaluate(l + step);
      step /= 2;
    }
  }
  return best
    ? [best.yaw / RAD, clamp(best.pitch / RAD, -90, 90), 0]
    : [view.rotation[0], view.rotation[1], 0];
}
