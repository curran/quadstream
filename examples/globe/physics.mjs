// Analytical damped-spring camera. The goal is user intent; `pos` is what is
// rendered. Longitude (deg, unbounded), latitude (deg) and log zoom
// z = ln(scale / initialScale) are independent channels sharing one spring.
export const RESPONSE_95 = 4.744; // omega * t at which a critically damped step reaches 95%
export const omegaForResponse = (ms) => RESPONSE_95 / (Math.max(1, ms) / 1000);

// Closed-form solution of e'' + 2*zeta*omega*e' + omega^2*e = 0.
export function springStep(e0, v0, omega, zeta, t) {
  if (t <= 0) return [e0, v0];
  if (Math.abs(zeta - 1) < 1e-6) {
    const decay = Math.exp(-omega * t),
      c = v0 + omega * e0;
    return [(e0 + c * t) * decay, (v0 - omega * c * t) * decay];
  }
  if (zeta < 1) {
    const wd = omega * Math.sqrt(1 - zeta * zeta),
      decay = Math.exp(-zeta * omega * t),
      b = (v0 + zeta * omega * e0) / wd,
      cos = Math.cos(wd * t),
      sin = Math.sin(wd * t);
    return [
      decay * (e0 * cos + b * sin),
      decay *
        (-zeta * omega * (e0 * cos + b * sin) + wd * (b * cos - e0 * sin)),
    ];
  }
  const root = Math.sqrt(zeta * zeta - 1),
    r1 = -omega * (zeta - root),
    r2 = -omega * (zeta + root),
    c2 = (v0 - r1 * e0) / (r2 - r1),
    c1 = e0 - c2,
    x1 = Math.exp(r1 * t),
    x2 = Math.exp(r2 * t);
  return [c1 * x1 + c2 * x2, c1 * r1 * x1 + c2 * r2 * x2];
}

// Exact solution of v' = a - drag * v over dt for constant thrust.
export function stepThrust(position, velocity, acceleration, drag, dt) {
  if (!(drag > 0)) throw new RangeError("Drag must be strictly positive");
  const terminal = acceleration / drag,
    decay = Math.exp(-drag * dt);
  return {
    position:
      position + terminal * dt + ((velocity - terminal) / drag) * (1 - decay),
    velocity: terminal + (velocity - terminal) * decay,
  };
}
const DEG = 180 / Math.PI;
const shortestLongitude = (from, to) =>
  from + ((((to - from + 180) % 360) + 360) % 360) - 180;

// Channels: longitude (deg), latitude (deg), log zoom. Pointer input drives
// them with a spring toward a goal; keyboard thrust takes over a channel group
// (lateral = lon+lat, radial = zoom) with Newtonian drag until it coasts to rest.
// Lateral thrust is held in screen px/s and converted using the rendered scale.
export function createCamera({
  limits = { zMin: -Infinity, zMax: Infinity },
  responseMs = 300,
  damping = 1,
  initialScale = 1,
} = {}) {
  const pos = [0, 0, 0],
    vel = [0, 0, 0],
    goal = [0, 0, 0],
    input = [0, 0, 0], // right, north, in
    pv = [0, 0]; // lateral px/s (right, north)
  const lo = [-Infinity, -90, limits.zMin],
    hi = [Infinity, 90, limits.zMax];
  let omega = omegaForResponse(responseMs),
    zeta = Math.max(0.01, damping),
    s0 = initialScale,
    latMode = false,
    zMode = false,
    tuning = { pan: 600, zoom: Math.LN2, drag: 5, instant: false };
  const scale = () => s0 * Math.exp(pos[2]);
  const clampGoal = () => {
    for (let i = 1; i < 3; i++)
      goal[i] = Math.max(lo[i], Math.min(hi[i], goal[i]));
  };
  const takeLateral = () => {
    latMode = true;
    pv[0] = (-vel[0] * scale()) / DEG;
    pv[1] = (-vel[1] * scale()) / DEG;
  };
  const releaseLateral = () => {
    latMode = false;
    const k = DEG / scale();
    vel[0] = -pv[0] * k;
    vel[1] = -pv[1] * k;
    pv[0] = pv[1] = 0;
    goal[0] = pos[0];
    goal[1] = pos[1];
  };
  const wall = (i) => {
    if (pos[i] <= lo[i]) {
      pos[i] = lo[i];
      if (vel[i] < 0) vel[i] = 0;
    } else if (pos[i] >= hi[i]) {
      pos[i] = hi[i];
      if (vel[i] > 0) vel[i] = 0;
    }
  };
  return {
    pos,
    vel,
    goal,
    pv,
    get thrusting() {
      return latMode || zMode;
    },
    setParams({ responseMs: r = responseMs, damping: d = damping }) {
      responseMs = r;
      damping = d;
      omega = omegaForResponse(r);
      zeta = Math.max(0.01, d);
    },
    setInitialScale(next) {
      s0 = next;
    },
    // pan: px/s terminal, zoom: log-zoom/s terminal, drag: 1/s (> 0).
    setTuning(next) {
      if (next.drag !== undefined && !(next.drag > 0))
        throw new RangeError("Drag must be strictly positive");
      tuning = { ...tuning, ...next };
    },
    // x right, y north, z in; each in [-1, 1]. Opposing keys arrive as 0.
    setThrust({ x = 0, y = 0, z = 0 }) {
      const len = Math.hypot(x, y);
      input[0] = len > 1 ? x / len : x;
      input[1] = len > 1 ? y / len : y;
      input[2] = z;
      if (len > 0 && !latMode) takeLateral();
      if (z !== 0) zMode = true;
    },
    brake() {
      input[0] = input[1] = input[2] = 0;
      latMode = zMode = false;
      pv[0] = pv[1] = 0;
      vel[0] = vel[1] = vel[2] = 0;
      for (let i = 0; i < 3; i++) goal[i] = pos[i];
    },
    // Position intent reclaims the channels it touches, keeping velocity.
    setGoal({ lon, lat, z }) {
      if ((lon !== undefined || lat !== undefined) && latMode) {
        input[0] = input[1] = 0;
        releaseLateral();
      }
      if (z !== undefined && zMode) {
        input[2] = 0;
        zMode = false;
        goal[2] = pos[2];
      }
      if (lon !== undefined) goal[0] = lon;
      if (lat !== undefined) goal[1] = lat;
      if (z !== undefined) goal[2] = z;
      clampGoal();
    },
    // Flight to a longitude takes the short way round instead of unwinding.
    setGoalNear(lon, lat, z) {
      this.setGoal({ lon: shortestLongitude(pos[0], lon), lat, z });
    },
    snap() {
      clampGoal();
      for (let i = 0; i < 3; i++) {
        pos[i] = goal[i];
        vel[i] = 0;
      }
      pv[0] = pv[1] = 0;
    },
    setLimits(next) {
      lo[2] = next.zMin;
      hi[2] = next.zMax;
      clampGoal();
    },
    advance(dt) {
      if ((input[0] || input[1]) && !latMode) takeLateral();
      if (input[2] && !zMode) zMode = true;
      for (let i = 0; i < 3; i++) {
        if ((i < 2 && latMode) || (i === 2 && zMode)) continue;
        const [e, v] = springStep(pos[i] - goal[i], vel[i], omega, zeta, dt);
        pos[i] = goal[i] + e;
        vel[i] = v;
        wall(i);
      }
      const z0 = pos[2];
      if (zMode) {
        const vz = tuning.zoom;
        if (tuning.instant) {
          vel[2] = input[2] * vz;
          pos[2] += vel[2] * dt;
        } else {
          const r = stepThrust(
            pos[2],
            vel[2],
            input[2] * tuning.drag * vz,
            tuning.drag,
            dt,
          );
          pos[2] = r.position;
          vel[2] = r.velocity;
        }
        wall(2);
        goal[2] = pos[2];
      }
      if (latMode) {
        const sMid = s0 * Math.exp((z0 + pos[2]) / 2),
          d = [0, 0];
        for (let a = 0; a < 2; a++) {
          if (tuning.instant) {
            pv[a] = input[a] * tuning.pan;
            d[a] = pv[a] * dt;
          } else {
            const r = stepThrust(
              0,
              pv[a],
              input[a] * tuning.drag * tuning.pan,
              tuning.drag,
              dt,
            );
            d[a] = r.position;
            pv[a] = r.velocity;
          }
        }
        pos[0] -= (d[0] * DEG) / sMid;
        pos[1] -= (d[1] * DEG) / sMid;
        const k = DEG / scale();
        vel[0] = -pv[0] * k;
        vel[1] = -pv[1] * k;
        // The wall zeroes angular velocity; mirror it back into pv.
        wall(1);
        if (vel[1] === 0) pv[1] = 0;
        goal[0] = pos[0];
        goal[1] = pos[1];
      }
      // Hand the channels back to the spring once thrust has coasted to rest.
      if (zMode && !input[2] && Math.abs(vel[2]) * scale() < 0.5) {
        zMode = false;
        vel[2] = 0;
        goal[2] = pos[2];
      }
      if (latMode && !input[0] && !input[1] && Math.hypot(pv[0], pv[1]) < 0.5) {
        releaseLateral();
        vel[0] = vel[1] = 0;
      }
    },
    // Tolerances are in screen space: angle/zoom positions in degrees and
    // log-zoom units, velocities per second.
    isSettled({ angle, angleVel, zoom, zoomVel }) {
      const zWall =
        input[2] !== 0 &&
        vel[2] === 0 &&
        (input[2] > 0 ? pos[2] >= hi[2] : pos[2] <= lo[2]);
      return (
        !latMode &&
        (!zMode || zWall) &&
        Math.abs(pos[0] - goal[0]) < angle &&
        Math.abs(pos[1] - goal[1]) < angle &&
        Math.abs(vel[0]) < angleVel &&
        Math.abs(vel[1]) < angleVel &&
        Math.abs(pos[2] - goal[2]) < zoom &&
        (zWall || Math.abs(vel[2]) < zoomVel)
      );
    },
  };
}
