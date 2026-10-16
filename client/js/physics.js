// Movement + ray math. MUST stay numerically identical to server/internal/game/physics.go
// (checked by testdata/golden_move.json, see server/internal/game/golden_test.go).

export function prepareMap(json) {
  return {
    name: json.name,
    bounds: json.bounds,
    spawns: json.spawns,
    raw: json.boxes,
    boxes: json.boxes.map((b) => [b.min[0], b.min[1], b.min[2], b.max[0], b.max[1], b.max[2]]),
  };
}

export function createKin(x = 0, y = 0, z = 0) {
  return { x, y, z, vy: 0, onGround: false };
}

// Advance one fixed tick. cmd: {f, s, yaw, jump, walk}. dt = 1/tickRate.
export function stepMove(spec, map, k, cmd) {
  const p = spec.player;
  const dt = 1 / spec.tickRate;
  const hw = p.halfWidth;
  const speed = cmd.walk ? p.walkSpeed : p.runSpeed;
  const sy = Math.sin(cmd.yaw);
  const cy = Math.cos(cmd.yaw);
  let wx = -sy * cmd.f + cy * cmd.s;
  let wz = -cy * cmd.f - sy * cmd.s;
  const len = Math.hypot(wx, wz);
  if (len > 1) {
    wx /= len;
    wz /= len;
  }
  const vx = wx * speed;
  const vz = wz * speed;

  if (cmd.jump && k.onGround) {
    k.vy = p.jumpSpeed;
    k.onGround = false;
  }
  k.vy -= p.gravity * dt;

  const b = map.boxes;
  // X
  k.x += vx * dt;
  for (let i = 0; i < b.length; i++) {
    const o = b[i];
    if (k.x + hw > o[0] && k.x - hw < o[3] && k.y + p.height > o[1] && k.y < o[4] && k.z + hw > o[2] && k.z - hw < o[5]) {
      k.x = vx > 0 ? o[0] - hw : o[3] + hw;
    }
  }
  // Z
  k.z += vz * dt;
  for (let i = 0; i < b.length; i++) {
    const o = b[i];
    if (k.x + hw > o[0] && k.x - hw < o[3] && k.y + p.height > o[1] && k.y < o[4] && k.z + hw > o[2] && k.z - hw < o[5]) {
      k.z = vz > 0 ? o[2] - hw : o[5] + hw;
    }
  }
  // Y
  k.y += k.vy * dt;
  k.onGround = false;
  if (k.y <= 0) {
    k.y = 0;
    if (k.vy < 0) k.vy = 0;
    k.onGround = true;
  }
  for (let i = 0; i < b.length; i++) {
    const o = b[i];
    if (k.x + hw > o[0] && k.x - hw < o[3] && k.y + p.height > o[1] && k.y < o[4] && k.z + hw > o[2] && k.z - hw < o[5]) {
      if (k.vy > 0) {
        k.y = o[1] - p.height;
        k.vy = 0;
      } else {
        k.y = o[4];
        k.vy = 0;
        k.onGround = true;
      }
    }
  }
  const bd = map.bounds;
  k.x = Math.min(Math.max(k.x, bd.minX + hw), bd.maxX - hw);
  k.z = Math.min(Math.max(k.z, bd.minZ + hw), bd.maxZ - hw);
}

export function aimDir(yaw, pitch) {
  const cp = Math.cos(pitch);
  return [-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp];
}

// Slab test. Returns entry distance t>=0 or -1 on miss. Box: [x0,y0,z0,x1,y1,z1].
export function rayBox(o, d, box, maxT) {
  let tmin = 0;
  let tmax = maxT;
  for (let a = 0; a < 3; a++) {
    const lo = box[a];
    const hi = box[a + 3];
    if (Math.abs(d[a]) < 1e-12) {
      if (o[a] < lo || o[a] > hi) return -1;
      continue;
    }
    const inv = 1 / d[a];
    let t1 = (lo - o[a]) * inv;
    let t2 = (hi - o[a]) * inv;
    if (t1 > t2) [t1, t2] = [t2, t1];
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }
  return tmin;
}

// Nearest world hit (map boxes + floor plane). Returns distance or maxT if nothing.
export function rayWorld(map, o, d, maxT) {
  let best = maxT;
  if (d[1] < 0 && o[1] > 0) {
    const t = -o[1] / d[1];
    if (t < best) best = t;
  }
  for (let i = 0; i < map.boxes.length; i++) {
    const t = rayBox(o, d, map.boxes[i], best);
    if (t >= 0 && t < best) best = t;
  }
  return best;
}

// Hitboxes for a player standing at feet position (x,y,z).
export function bodyBox(spec, x, y, z) {
  const b = spec.player.body;
  return [x - b.halfWidth, y + b.y0, z - b.halfWidth, x + b.halfWidth, y + b.y1, z + b.halfWidth];
}
export function headBox(spec, x, y, z) {
  const h = spec.player.head;
  return [x - h.halfWidth, y + h.y0, z - h.halfWidth, x + h.halfWidth, y + h.y1, z + h.halfWidth];
}

// Returns {t, head} for the closer of head/body hit, or null.
export function rayPlayer(spec, o, d, maxT, x, y, z) {
  const th = rayBox(o, d, headBox(spec, x, y, z), maxT);
  const tb = rayBox(o, d, bodyBox(spec, x, y, z), maxT);
  if (th < 0 && tb < 0) return null;
  if (th >= 0 && (tb < 0 || th <= tb)) return { t: th, head: true };
  return { t: tb, head: false };
}
