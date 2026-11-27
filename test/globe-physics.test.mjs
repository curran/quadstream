import test from "node:test";
import assert from "node:assert/strict";
import {
  springStep,
  createCamera,
  omegaForResponse,
  stepThrust,
} from "../examples/globe/physics.mjs";
const omega = omegaForResponse(300);
const settle = {
  angle: 1e-4,
  angleVel: 1e-4,
  zoom: 1e-6,
  zoomVel: 1e-6,
};
test("critically damped step response is monotonic and hits 95% at the response time", () => {
  let last = 1;
  for (let t = 0.01; t < 2; t += 0.01) {
    const [e] = springStep(1, 0, omega, 1, t);
    assert.ok(e <= last && e >= 0);
    last = e;
  }
  assert.ok(Math.abs(springStep(1, 0, omega, 1, 0.3)[0] - 0.05) < 1e-3);
});
test("underdamped overshoots then converges; overdamped does not overshoot", () => {
  let min = 1;
  for (let t = 0; t < 3; t += 0.005)
    min = Math.min(min, springStep(1, 0, omega, 0.3, t)[0]);
  assert.ok(min < -0.05);
  assert.ok(Math.abs(springStep(1, 0, omega, 0.3, 10)[0]) < 1e-6);
  for (let t = 0; t < 3; t += 0.005)
    assert.ok(springStep(1, 0, omega, 2, t)[0] >= 0);
});
test("solution is continuous in zeta across regimes and consistent with composition", () => {
  for (const z of [0.5, 1, 1.5]) {
    const a = springStep(1, 2, omega, z, 0.5),
      [e, v] = springStep(1, 2, omega, z, 0.2),
      b = springStep(e, v, omega, z, 0.3);
    assert.ok(Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9);
  }
  const lo = springStep(1, 0, omega, 1 - 1e-4, 0.2)[0],
    hi = springStep(1, 0, omega, 1 + 1e-4, 0.2)[0];
  assert.ok(Math.abs(lo - hi) < 1e-3);
});
test("trajectory is frame-rate independent for a fixed goal", () => {
  const end = (hz) => {
    const c = createCamera();
    c.setGoal({ lon: 90, lat: 30, z: 1 });
    for (let i = 0; i < hz * 0.5; i++) c.advance(1 / hz);
    return [...c.pos];
  };
  const ref = end(30);
  for (const hz of [60, 144])
    end(hz).forEach((v, i) => assert.ok(Math.abs(v - ref[i]) < 1e-9));
});
test("goal reversal keeps position and velocity continuous", () => {
  const c = createCamera();
  c.setGoal({ lon: 100 });
  c.advance(0.1);
  const pos = c.pos[0],
    vel = c.vel[0];
  c.setGoal({ lon: -100 });
  assert.equal(c.pos[0], pos);
  assert.equal(c.vel[0], vel);
  for (let i = 0; i < 200; i++) c.advance(1 / 60);
  assert.ok(Math.abs(c.pos[0] + 100) < 1e-3);
});
test("longitude is unbounded and reset flights take the short way", () => {
  const c = createCamera();
  c.setGoal({ lon: 720 + 10 });
  c.snap();
  c.setGoalNear(0, 0, 0);
  assert.equal(c.goal[0], 720);
  c.setGoal({ lon: 179 });
  c.snap();
  c.setGoalNear(-179, 0, 0);
  assert.equal(c.goal[0], 181);
});
test("latitude and zoom goals clamp and walls remove outward velocity", () => {
  const c = createCamera({ limits: { zMin: -1, zMax: 2 } });
  c.setGoal({ lat: 120, z: 9 });
  assert.equal(c.goal[1], 90);
  assert.equal(c.goal[2], 2);
  c.pos[2] = 1.99;
  c.vel[2] = 50;
  c.advance(0.1);
  assert.ok(c.pos[2] <= 2);
  const d = createCamera({ limits: { zMin: -1, zMax: 2 } });
  d.pos[2] = 2;
  d.goal[2] = 2;
  d.vel[2] = 5;
  d.advance(0.01);
  assert.equal(d.pos[2], 2);
  assert.equal(d.vel[2] > 0 ? d.vel[2] : 0, 0);
});
test("settles within screen-space tolerance and snap stops motion", () => {
  const c = createCamera();
  c.setGoal({ lon: 45, z: 0.5 });
  assert.equal(c.isSettled(settle), false);
  for (let i = 0; i < 300; i++) c.advance(1 / 60);
  assert.equal(c.isSettled(settle), true);
  c.setGoal({ lon: 0 });
  c.snap();
  assert.deepEqual([c.pos[0], c.vel[0]], [0, 0]);
});

const run = (c, seconds, hz) => {
  for (let i = 0; i < Math.round(seconds * hz); i++) c.advance(1 / hz);
};
const flyer = (extra = {}) => {
  const c = createCamera({
    limits: { zMin: Math.log(0.6), zMax: Math.log(64) },
    initialScale: 280,
    ...extra,
  });
  c.setTuning({ pan: 600, zoom: Math.LN2, drag: 5 });
  return c;
};
test("stepThrust reaches terminal velocity, composes exactly and requires positive drag", () => {
  const a = stepThrust(0, 0, 10, 5, 1.0);
  assert.ok(Math.abs(a.velocity - 2) < 0.02);
  const half = stepThrust(0, 0, 10, 5, 0.3),
    both = stepThrust(half.position, half.velocity, 10, 5, 0.7),
    once = stepThrust(0, 0, 10, 5, 1);
  assert.ok(Math.abs(both.position - once.position) < 1e-12);
  assert.ok(Math.abs(both.velocity - once.velocity) < 1e-12);
  assert.throws(() => stepThrust(0, 0, 1, 0, 1), RangeError);
  const coast = stepThrust(0, 100, 0, 5, 5);
  assert.ok(Math.abs(coast.position - 20) < 1e-6);
});
test("holding zoom-in accelerates log zoom to terminal rate, release coasts and hands back", () => {
  const c = flyer();
  c.setThrust({ z: 1 });
  run(c, 0.1, 60);
  const early = c.vel[2];
  run(c, 2, 60);
  assert.ok(c.vel[2] > early);
  assert.ok(Math.abs(c.vel[2] - Math.LN2) < 0.01);
  c.setThrust({ z: 0 });
  const v = c.vel[2];
  run(c, 0.1, 60);
  assert.ok(c.vel[2] < v && c.vel[2] > 0);
  run(c, 10, 60);
  assert.equal(c.thrusting, false);
  assert.equal(
    c.isSettled({ angle: 1e-4, angleVel: 1e-4, zoom: 1e-6, zoomVel: 1e-6 }),
    true,
  );
});
test("zoom thrust stops at the limit with no velocity accumulation and reverses immediately", () => {
  const c = flyer();
  c.setThrust({ z: 1 });
  run(c, 20, 60);
  assert.equal(c.pos[2], Math.log(64));
  assert.equal(c.vel[2], 0);
  assert.equal(
    c.isSettled({ angle: 1e-4, angleVel: 1e-4, zoom: 1e-6, zoomVel: 1e-6 }),
    true,
  );
  c.setThrust({ z: -1 });
  run(c, 0.1, 60);
  assert.ok(c.vel[2] < 0 && c.pos[2] < Math.log(64));
});
test("lateral thrust has comparable screen-space speed at 1x and 64x", () => {
  const speed = (z) => {
    const c = flyer();
    c.pos[2] = c.goal[2] = z;
    c.setThrust({ x: 1 });
    run(c, 3, 60);
    return (-c.vel[0] * Math.PI * 280 * Math.exp(z)) / 180;
  };
  assert.ok(Math.abs(speed(0) - 600) < 1);
  assert.ok(Math.abs(speed(Math.log(64)) - 600) < 1);
  const c = flyer();
  c.setThrust({ x: 1 });
  run(c, 3, 60);
  const d = flyer();
  d.pos[2] = d.goal[2] = Math.log(64);
  d.setThrust({ x: 1 });
  run(d, 3, 60);
  assert.ok(Math.abs(d.pos[0]) < Math.abs(c.pos[0]) / 50);
  assert.ok(
    c.pos[0] < 0,
    "right thrust moves the camera east (rotation decreases)",
  );
});
test("diagonal thrust is normalized and opposing thrust cancels", () => {
  const c = flyer({ initialScale: 1e6 });
  c.setThrust({ x: 1, y: 1 });
  run(c, 3, 60);
  assert.ok(Math.abs(Math.hypot(c.pv[0], c.pv[1]) - 600) < 1);
  const d = flyer();
  d.setThrust({ x: 0, y: 0, z: 0 });
  run(d, 1, 60);
  assert.deepEqual([d.pos[0], d.pos[1], d.pos[2]], [0, 0, 0]);
});
test("keyboard trajectories are frame-rate independent", () => {
  const fly = (hz) => {
    const c = flyer();
    c.setThrust({ x: 1, z: 1 });
    run(c, 1, hz);
    c.setThrust({ x: 0, z: 0 });
    run(c, 1, hz);
    return [...c.pos];
  };
  const ref = fly(30);
  for (const hz of [60, 144])
    fly(hz).forEach((v, i) => assert.ok(Math.abs(v - ref[i]) < 0.01));
});
test("brake clears velocity and spring motion; pointer reclaim keeps position continuous", () => {
  const c = flyer();
  c.setGoal({ lon: 90 });
  run(c, 0.1, 60);
  c.setThrust({ z: 1 });
  run(c, 0.3, 60);
  c.brake();
  assert.deepEqual([...c.vel], [0, 0, 0]);
  assert.deepEqual([...c.goal], [...c.pos]);
  const d = flyer();
  d.setThrust({ x: 1 });
  run(d, 0.5, 60);
  const p = [...d.pos],
    before = d.vel[0];
  d.setGoal({ lon: d.goal[0] + 5, lat: d.goal[1] });
  assert.deepEqual([...d.pos], p);
  assert.equal(d.vel[0], before);
  assert.equal(d.thrusting, false);
  run(d, 6, 60);
  assert.ok(Math.abs(d.pos[0] - (p[0] + 5)) < 1);
});
test("instant tuning gives no ramp and no coasting", () => {
  const c = flyer();
  c.setTuning({ instant: true });
  c.setThrust({ z: 1 });
  c.advance(0.1);
  assert.ok(Math.abs(c.vel[2] - Math.LN2) < 1e-12);
  c.setThrust({ z: 0 });
  c.advance(0.016);
  assert.equal(c.vel[2], 0);
  assert.equal(c.thrusting, false);
});
