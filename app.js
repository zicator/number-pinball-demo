const canvas = document.querySelector("#game");
const ctx = canvas.getContext("2d");

const ui = {
  round: document.querySelector("#round"),
  balls: document.querySelector("#balls"),
  combo: document.querySelector("#combo"),
  multiplier: document.querySelector("#multiplier"),
  mode: document.querySelector("#mode"),
  skillLine: document.querySelector("#skillLine"),
  toast: document.querySelector("#toast"),
  launchBtn: document.querySelector("#launchBtn"),
  recallBtn: document.querySelector("#recallBtn"),
  resetBtn: document.querySelector("#resetBtn"),
  upgradeModal: document.querySelector("#upgradeModal"),
  upgradeChoices: document.querySelector("#upgradeChoices"),
  endModal: document.querySelector("#endModal"),
  endKicker: document.querySelector("#endKicker"),
  endTitle: document.querySelector("#endTitle"),
  endCopy: document.querySelector("#endCopy"),
  restartBtn: document.querySelector("#restartBtn"),
};

const TAU = Math.PI * 2;
const COLS = 7;
const TARGET_ROWS = 36;
let width = 420;
let height = 620;
let cell = 60;
let topOffset = 14;
let deathLine = 540;
let launcher = { x: 210, y: 570 };
let lastTime = performance.now();
let rafId = 0;
let nextId = 1;

const upgrades = [
  {
    id: "split",
    name: "裂变弹芯",
    desc: "每 6 次命中分裂出一颗小球，封闭结构里会越弹越多。",
    apply: (s) => {
      s.splitEvery = Math.max(3, s.splitEvery - 1);
      s.splitCount += 1;
    },
  },
  {
    id: "pierce",
    name: "穿透弹头",
    desc: "每颗球额外穿透 1 个数字块，不会立刻反弹。",
    apply: (s) => {
      s.pierce += 1;
    },
  },
  {
    id: "explode",
    name: "爆裂震荡",
    desc: "命中时对附近数字造成溅射伤害，适合清密集下压区。",
    apply: (s) => {
      s.explode += 1;
    },
  },
  {
    id: "charge",
    name: "循环充能",
    desc: "每次碰撞提高本颗球伤害，越困在结构里越强。",
    apply: (s) => {
      s.charge += 0.25;
    },
  },
  {
    id: "magnet",
    name: "磁吸修正",
    desc: "球会轻微偏向附近数字块，减少空弹。",
    apply: (s) => {
      s.magnet += 0.09;
    },
  },
  {
    id: "multiball",
    name: "多球协议",
    desc: "基础球数 +3，让每一波更容易打出连锁。",
    apply: (s) => {
      s.baseBalls += 3;
    },
  },
  {
    id: "crit",
    name: "暴击电荷",
    desc: "暴击率 +15%，暴击命中会打出双倍伤害。",
    apply: (s) => {
      s.crit += 0.15;
    },
  },
  {
    id: "save",
    name: "回旋保险",
    desc: "每颗球第一次漏底会被弹回场内一次。",
    apply: (s) => {
      s.saves += 1;
    },
  },
];

let state;

function makeState() {
  return {
    status: "aim",
    round: 1,
    rows: 0,
    combo: 0,
    bestCombo: 0,
    multiplier: 1,
    score: 0,
    activeBalls: [],
    queueTimer: 0,
    launched: 0,
    returned: 0,
    upgradeQueue: 0,
    tiles: [],
    segments: [],
    portals: [],
    particles: [],
    floating: [],
    aimAngle: -Math.PI / 2,
    aimPower: 1,
    shake: 0,
    bossSpawned: false,
    bossDefeated: false,
    skills: {
      baseBalls: 8,
      damage: 4,
      splitEvery: 7,
      splitCount: 0,
      splitLimit: 18,
      pierce: 0,
      explode: 0,
      charge: 0,
      magnet: 0,
      crit: 0,
      saves: 0,
    },
  };
}

function resize() {
  const rect = canvas.parentElement.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  width = Math.max(320, rect.width);
  height = Math.max(440, rect.height);
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  cell = width / COLS;
  deathLine = height - 72;
  launcher = { x: width / 2, y: height - 34 };
}

function tileRect(col, row) {
  const pad = Math.max(4, cell * 0.08);
  return {
    x: col * cell + pad,
    y: topOffset + row * cell + pad,
    w: cell - pad * 2,
    h: cell - pad * 2,
  };
}

function addTile(col, row, hp, type = "block", label = "") {
  const rect = tileRect(col, row);
  state.tiles.push({
    id: nextId++,
    col,
    row,
    hp,
    maxHp: hp,
    type,
    label,
    ...rect,
  });
}

function addSegment(x1, y1, x2, y2, kind = "rail") {
  state.segments.push({
    id: nextId++,
    x1,
    y1,
    x2,
    y2,
    kind,
    ttl: kind === "gate" ? 5 : 999,
  });
}

function addPortal(x, y, pairId) {
  state.portals.push({
    id: nextId++,
    pairId,
    x,
    y,
    r: Math.max(13, cell * 0.23),
    pulse: Math.random() * TAU,
  });
}

function rand(min, max) {
  return min + Math.random() * (max - min);
}

function pick(array) {
  return array[Math.floor(Math.random() * array.length)];
}

function shuffle(array) {
  const copy = [...array];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function baseHp() {
  return Math.round(14 + state.round * 4.4 + state.rows * 1.8);
}

function spawnNormalRow() {
  const blocked = new Set(shuffle([0, 1, 2, 3, 4, 5, 6]).slice(0, Math.min(5, 3 + Math.floor(state.round / 5))));
  for (const col of blocked) {
    addTile(col, 0, Math.round(baseHp() * rand(0.75, 1.25)));
  }
  if (Math.random() < 0.32) addTile(Math.floor(rand(0, COLS)), 0, 1, "skill", "技能");
  if (Math.random() < 0.24) addTile(Math.floor(rand(0, COLS)), 0, 1, "bonus", "+球");
}

function spawnUChamber() {
  const left = pick([0, 1]);
  const right = left + 5;
  const mid = left + 2;
  addTile(left, 0, baseHp(), "block");
  addTile(right, 0, baseHp(), "block");
  addTile(left, 1, Math.round(baseHp() * 1.2), "block");
  addTile(right, 1, Math.round(baseHp() * 1.2), "block");
  addTile(mid, 1, 1, "skill", "技能");
  addTile(mid + 1, 1, Math.round(baseHp() * 0.9), "bomb", "爆");
  const y = topOffset + cell * 2.08;
  addSegment((left + 0.4) * cell, y, (right + 0.6) * cell, y, "gate");
  flash("U 型循环房刷新");
}

function spawnFunnel() {
  const y0 = topOffset + cell * 0.2;
  const y1 = topOffset + cell * 1.8;
  addSegment(cell * 0.75, y0, cell * 2.8, y1, "rail");
  addSegment(width - cell * 0.75, y0, width - cell * 2.8, y1, "rail");
  addTile(3, 1, 1, "skill", "技能");
  addTile(2, 0, Math.round(baseHp() * 0.9), "block");
  addTile(4, 0, Math.round(baseHp() * 0.9), "block");
  flash("斜面漏斗刷新");
}

function spawnPortalLoop() {
  const pairId = nextId++;
  addPortal(cell * 1.15, topOffset + cell * 0.88, pairId);
  addPortal(width - cell * 1.15, topOffset + cell * 0.88, pairId);
  addSegment(cell * 1.8, topOffset + cell * 0.28, width - cell * 1.8, topOffset + cell * 0.28, "rail");
  addSegment(cell * 1.8, topOffset + cell * 1.5, width - cell * 1.8, topOffset + cell * 1.5, "rail");
  addTile(3, 0, Math.round(baseHp() * 1.35), "block");
  addTile(3, 1, 1, "bonus", "+球");
  flash("传送循环刷新");
}

function spawnBoss() {
  state.bossSpawned = true;
  for (let col = 1; col <= 5; col += 1) {
    addTile(col, 0, Math.round(baseHp() * 1.8), "block");
  }
  addTile(2, 1, Math.round(baseHp() * 3.2), "boss", "核心");
  addTile(3, 1, Math.round(baseHp() * 3.6), "boss", "核心");
  addTile(4, 1, Math.round(baseHp() * 3.2), "boss", "核心");
  addSegment(cell * 1.3, topOffset + cell * 2.15, cell * 5.7, topOffset + cell * 2.15, "gate");
  flash("终局核心出现");
}

function spawnTopChunk() {
  if (state.rows >= TARGET_ROWS && !state.bossSpawned) {
    spawnBoss();
    return;
  }
  const pattern = state.round < 3 ? "normal" : pick(["normal", "normal", "u", "funnel", "portal"]);
  if (pattern === "u") spawnUChamber();
  else if (pattern === "funnel") spawnFunnel();
  else if (pattern === "portal") spawnPortalLoop();
  else spawnNormalRow();
}

function shiftBoard() {
  state.tiles.forEach((tile) => {
    tile.row += 1;
    tile.y += cell;
  });
  state.segments.forEach((segment) => {
    segment.y1 += cell;
    segment.y2 += cell;
    if (segment.kind === "gate") segment.ttl -= 1;
  });
  state.portals.forEach((portal) => {
    portal.y += cell;
  });
  state.segments = state.segments.filter((segment) => segment.ttl > 0 && Math.min(segment.y1, segment.y2) < height + 80);
  state.portals = state.portals.filter((portal) => portal.y < height + 80);
  state.tiles = state.tiles.filter((tile) => tile.y < height + 120);
  state.rows += 1;
  spawnTopChunk();
  if (state.tiles.some((tile) => tile.type !== "bonus" && tile.type !== "skill" && tile.y + tile.h > deathLine)) {
    endGame(false);
  }
}

function resetGame() {
  cancelAnimationFrame(rafId);
  nextId = 1;
  state = makeState();
  ui.endModal.classList.add("hidden");
  ui.upgradeModal.classList.add("hidden");
  spawnNormalRow();
  spawnFunnel();
  for (let i = 0; i < 2; i += 1) {
    shiftBoard();
  }
  state.status = "aim";
  lastTime = performance.now();
  updateHud();
  loop(lastTime);
}

function updateHud() {
  ui.round.textContent = String(state.round);
  ui.balls.textContent = String(state.skills.baseBalls);
  ui.combo.textContent = String(state.combo);
  ui.multiplier.textContent = `x${state.multiplier.toFixed(1)}`;
  ui.launchBtn.disabled = state.status !== "aim";
  ui.recallBtn.disabled = state.status !== "running";
  ui.mode.textContent = state.status === "aim" ? "瞄准中" : state.status === "running" ? "弹射中" : "选择技能";
  const tags = [];
  if (state.skills.splitCount) tags.push(`裂变${state.skills.splitCount}`);
  if (state.skills.pierce) tags.push(`穿透${state.skills.pierce}`);
  if (state.skills.explode) tags.push(`爆裂${state.skills.explode}`);
  if (state.skills.charge) tags.push(`充能${state.skills.charge.toFixed(2)}`);
  if (state.skills.magnet) tags.push("磁吸");
  if (state.skills.crit) tags.push(`暴击${Math.round(state.skills.crit * 100)}%`);
  if (state.skills.saves) tags.push(`回旋${state.skills.saves}`);
  ui.skillLine.textContent = tags.length ? tags.join(" · ") : "无技能";
}

function flash(text) {
  ui.toast.textContent = text;
  ui.toast.style.opacity = "1";
  window.clearTimeout(flash.timer);
  flash.timer = window.setTimeout(() => {
    ui.toast.style.opacity = "0.62";
  }, 1300);
}

function launchVolley() {
  if (state.status !== "aim") return;
  state.status = "running";
  state.combo = 0;
  state.multiplier = 1;
  state.activeBalls = [];
  state.launched = 0;
  state.returned = 0;
  state.queueTimer = 0;
  flash("弹射开始");
  updateHud();
}

function recallBalls() {
  if (state.status !== "running") return;
  for (const ball of state.activeBalls) {
    addBurst(ball.x, ball.y, "#74f4a7", ball.mini ? 6 : 10);
  }
  state.activeBalls = [];
  state.launched = state.skills.baseBalls;
  state.returned = state.skills.baseBalls;
  flash("弹球归位，结算本波");
  finishVolley();
}

function spawnBall(isMini = false, source) {
  const speed = isMini ? Math.max(390, height * 0.68) : Math.max(430, height * 0.75);
  const spread = isMini ? rand(-0.52, 0.52) : rand(-0.035, 0.035);
  const angle = isMini ? Math.atan2(source.vy, source.vx) + spread : state.aimAngle + spread;
  state.activeBalls.push({
    id: nextId++,
    x: source?.x ?? launcher.x,
    y: source?.y ?? launcher.y,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    r: isMini ? Math.max(4, cell * 0.08) : Math.max(5, cell * 0.1),
    damage: state.skills.damage,
    chargeDamage: 0,
    hitCount: 0,
    splits: 0,
    pierceLeft: state.skills.pierce,
    savesLeft: state.skills.saves,
    cooldown: 0,
    mini: isMini,
  });
}

function step(dt) {
  if (state.status === "running") {
    state.queueTimer -= dt;
    while (state.launched < state.skills.baseBalls && state.queueTimer <= 0) {
      spawnBall(false);
      state.launched += 1;
      state.queueTimer += 0.075;
    }
  }

  for (const ball of state.activeBalls) {
    if (ball.cooldown > 0) ball.cooldown -= 1;
    applyMagnet(ball, dt);
    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;
    collideWalls(ball);
    collideSegments(ball);
    collidePortals(ball);
    collideTiles(ball);
    if (ball.y - ball.r > height + 24) {
      if (ball.savesLeft > 0) {
        ball.savesLeft -= 1;
        ball.y = launcher.y - 8;
        ball.vy = -Math.abs(ball.vy);
        ball.vx += rand(-80, 80);
        addBurst(ball.x, launcher.y, "#74f4a7", 12);
      } else {
        ball.dead = true;
        state.returned += 1;
      }
    }
  }
  state.activeBalls = state.activeBalls.filter((ball) => !ball.dead);

  for (const particle of state.particles) {
    particle.life -= dt;
    particle.x += particle.vx * dt;
    particle.y += particle.vy * dt;
    particle.vy += 120 * dt;
  }
  state.particles = state.particles.filter((particle) => particle.life > 0);

  for (const item of state.floating) {
    item.life -= dt;
    item.y -= 34 * dt;
  }
  state.floating = state.floating.filter((item) => item.life > 0);
  state.shake = Math.max(0, state.shake - dt * 18);

  if (
    state.status === "running" &&
    state.launched >= state.skills.baseBalls &&
    state.activeBalls.length === 0
  ) {
    finishVolley();
  }
}

function collideWalls(ball) {
  if (ball.x - ball.r < 0) {
    ball.x = ball.r;
    ball.vx = Math.abs(ball.vx);
    bump(ball);
  }
  if (ball.x + ball.r > width) {
    ball.x = width - ball.r;
    ball.vx = -Math.abs(ball.vx);
    bump(ball);
  }
  if (ball.y - ball.r < 0) {
    ball.y = ball.r;
    ball.vy = Math.abs(ball.vy);
    bump(ball);
  }
}

function collideSegments(ball) {
  for (const segment of state.segments) {
    const hit = circleLine(ball, segment);
    if (!hit) continue;
    const dot = ball.vx * hit.nx + ball.vy * hit.ny;
    if (dot >= 0) continue;
    ball.x += hit.nx * hit.depth;
    ball.y += hit.ny * hit.depth;
    ball.vx -= 2 * dot * hit.nx;
    ball.vy -= 2 * dot * hit.ny;
    const boost = segment.kind === "gate" ? 1.05 : 1.015;
    ball.vx *= boost;
    ball.vy *= boost;
    bump(ball);
    addBurst(hit.x, hit.y, segment.kind === "gate" ? "#ffd166" : "#46e6ff", 5);
  }
}

function circleLine(ball, segment) {
  const ax = segment.x1;
  const ay = segment.y1;
  const bx = segment.x2;
  const by = segment.y2;
  const abx = bx - ax;
  const aby = by - ay;
  const len2 = abx * abx + aby * aby || 1;
  const t = Math.max(0, Math.min(1, ((ball.x - ax) * abx + (ball.y - ay) * aby) / len2));
  const px = ax + abx * t;
  const py = ay + aby * t;
  let dx = ball.x - px;
  let dy = ball.y - py;
  const dist = Math.hypot(dx, dy);
  if (dist >= ball.r + 4) return null;
  if (dist < 0.001) {
    dx = -aby;
    dy = abx;
  }
  const norm = Math.hypot(dx, dy) || 1;
  return {
    x: px,
    y: py,
    nx: dx / norm,
    ny: dy / norm,
    depth: ball.r + 4 - dist,
  };
}

function collidePortals(ball) {
  if (ball.cooldown > 0) return;
  for (const portal of state.portals) {
    const dist = Math.hypot(ball.x - portal.x, ball.y - portal.y);
    if (dist > portal.r + ball.r) continue;
    const target = state.portals.find((item) => item.pairId === portal.pairId && item.id !== portal.id);
    if (!target) return;
    ball.x = target.x + Math.sign(ball.vx || 1) * (target.r + ball.r + 4);
    ball.y = target.y;
    ball.cooldown = 24;
    addBurst(portal.x, portal.y, "#b77dff", 14);
    addBurst(target.x, target.y, "#46e6ff", 14);
    bump(ball);
    return;
  }
}

function collideTiles(ball) {
  for (const tile of state.tiles) {
    if (tile.dead) continue;
    const nx = Math.max(tile.x, Math.min(ball.x, tile.x + tile.w));
    const ny = Math.max(tile.y, Math.min(ball.y, tile.y + tile.h));
    const dx = ball.x - nx;
    const dy = ball.y - ny;
    const dist = Math.hypot(dx, dy);
    if (dist > ball.r) continue;

    const damage = calcDamage(ball);
    hitTile(tile, damage, ball);

    if (ball.pierceLeft > 0 && tile.type !== "skill" && tile.type !== "bonus") {
      ball.pierceLeft -= 1;
    } else {
      let rx = dx;
      let ry = dy;
      if (dist < 0.001) {
        const cx = tile.x + tile.w / 2;
        const cy = tile.y + tile.h / 2;
        rx = ball.x - cx;
        ry = ball.y - cy;
      }
      const norm = Math.hypot(rx, ry) || 1;
      const ux = rx / norm;
      const uy = ry / norm;
      const dot = ball.vx * ux + ball.vy * uy;
      if (dot < 0) {
        ball.vx -= 2 * dot * ux;
        ball.vy -= 2 * dot * uy;
        ball.x += ux * (ball.r - dist + 1);
        ball.y += uy * (ball.r - dist + 1);
      }
    }
    bump(ball);
  }
  state.tiles = state.tiles.filter((tile) => !tile.dead);
  if (state.bossSpawned && !state.tiles.some((tile) => tile.type === "boss")) {
    endGame(true);
  }
}

function calcDamage(ball) {
  let amount = ball.damage + ball.chargeDamage;
  if (Math.random() < state.skills.crit) {
    amount *= 2;
    addFloat(ball.x, ball.y, "暴击", "#ffd166");
  }
  return Math.max(1, Math.round(amount * state.multiplier));
}

function hitTile(tile, damage, ball) {
  state.combo += 1;
  state.bestCombo = Math.max(state.bestCombo, state.combo);
  state.multiplier = Math.min(9.9, 1 + Math.floor(state.combo / 10) * 0.35);
  ball.hitCount += 1;
  ball.chargeDamage += state.skills.charge;

  if (tile.type === "skill") {
    tile.dead = true;
    state.upgradeQueue += 1;
    addFloat(tile.x + tile.w / 2, tile.y, "技能", "#46e6ff");
    addBurst(tile.x + tile.w / 2, tile.y + tile.h / 2, "#46e6ff", 18);
    return;
  }

  if (tile.type === "bonus") {
    tile.dead = true;
    state.skills.baseBalls += 1;
    addFloat(tile.x + tile.w / 2, tile.y, "+1 球", "#74f4a7");
    addBurst(tile.x + tile.w / 2, tile.y + tile.h / 2, "#74f4a7", 18);
    return;
  }

  tile.hp -= damage;
  addFloat(tile.x + tile.w / 2, tile.y + tile.h / 2, `-${damage}`, "#f7fbff");
  if (state.skills.explode > 0) {
    splashDamage(tile, Math.round(damage * 0.24 * state.skills.explode), ball);
  }
  if (tile.type === "bomb" || tile.hp <= 0) {
    if (tile.type === "bomb") {
      splashDamage(tile, Math.round(baseHp() * 0.65), ball, true);
    }
    tile.dead = true;
    state.score += tile.maxHp;
    state.shake = Math.min(8, state.shake + 2.2);
    addBurst(tile.x + tile.w / 2, tile.y + tile.h / 2, tile.type === "boss" ? "#ff5d73" : "#ffd166", 24);
  }

  if (
    state.skills.splitCount > 0 &&
    ball.hitCount % state.skills.splitEvery === 0 &&
    ball.splits < state.skills.splitLimit
  ) {
    ball.splits += 1;
    for (let i = 0; i < state.skills.splitCount; i += 1) {
      spawnBall(true, ball);
    }
    addFloat(ball.x, ball.y, "裂变", "#b77dff");
  }
}

function splashDamage(origin, amount, sourceBall, force = false) {
  if (amount <= 0) return;
  const radius = force ? cell * 1.65 : cell * (0.75 + state.skills.explode * 0.25);
  for (const tile of state.tiles) {
    if (tile.dead || tile.id === origin.id || tile.type === "skill" || tile.type === "bonus") continue;
    const cx = tile.x + tile.w / 2;
    const cy = tile.y + tile.h / 2;
    const ox = origin.x + origin.w / 2;
    const oy = origin.y + origin.h / 2;
    if (Math.hypot(cx - ox, cy - oy) > radius) continue;
    tile.hp -= amount;
    addFloat(cx, cy, `-${amount}`, force ? "#ff5d73" : "#ffd166");
    if (tile.hp <= 0) {
      tile.dead = true;
      addBurst(cx, cy, force ? "#ff5d73" : "#ffd166", 16);
    }
  }
  addBurst(origin.x + origin.w / 2, origin.y + origin.h / 2, force ? "#ff5d73" : "#ffd166", force ? 34 : 14);
  sourceBall.vx *= force ? 1.03 : 1.01;
  sourceBall.vy *= force ? 1.03 : 1.01;
}

function applyMagnet(ball, dt) {
  if (state.skills.magnet <= 0) return;
  let target = null;
  let best = cell * 2.15;
  for (const tile of state.tiles) {
    if (tile.type === "skill" || tile.type === "bonus") continue;
    const cx = tile.x + tile.w / 2;
    const cy = tile.y + tile.h / 2;
    const dist = Math.hypot(cx - ball.x, cy - ball.y);
    if (dist < best) {
      best = dist;
      target = { x: cx, y: cy };
    }
  }
  if (!target) return;
  const dx = target.x - ball.x;
  const dy = target.y - ball.y;
  const norm = Math.hypot(dx, dy) || 1;
  ball.vx += (dx / norm) * state.skills.magnet * 620 * dt;
  ball.vy += (dy / norm) * state.skills.magnet * 620 * dt;
  capSpeed(ball);
}

function capSpeed(ball) {
  const speed = Math.hypot(ball.vx, ball.vy);
  const max = Math.max(640, height * 1.08);
  const min = Math.max(330, height * 0.52);
  if (speed > max) {
    ball.vx = (ball.vx / speed) * max;
    ball.vy = (ball.vy / speed) * max;
  } else if (speed < min) {
    ball.vx = (ball.vx / (speed || 1)) * min;
    ball.vy = (ball.vy / (speed || 1)) * min;
  }
}

function bump(ball) {
  ball.vx *= 1.002;
  ball.vy *= 1.002;
  capSpeed(ball);
}

function finishVolley() {
  state.round += 1;
  if (state.upgradeQueue > 0) {
    state.status = "upgrade";
    showUpgrade();
  } else {
    state.status = "aim";
    shiftBoard();
    flash("棋盘下压，顶部刷新");
  }
  updateHud();
}

function showUpgrade() {
  ui.upgradeChoices.innerHTML = "";
  const choices = shuffle(upgrades).slice(0, 3);
  for (const upgrade of choices) {
    const button = document.createElement("button");
    button.className = "upgrade-card";
    button.innerHTML = `<strong>${upgrade.name}</strong><span>${upgrade.desc}</span>`;
    button.addEventListener("click", () => {
      upgrade.apply(state.skills);
      state.upgradeQueue -= 1;
      ui.upgradeModal.classList.add("hidden");
      flash(`获得：${upgrade.name}`);
      if (state.upgradeQueue > 0) {
        showUpgrade();
      } else {
        state.status = "aim";
        shiftBoard();
      }
      updateHud();
    });
    ui.upgradeChoices.appendChild(button);
  }
  ui.upgradeModal.classList.remove("hidden");
  updateHud();
}

function endGame(win) {
  state.status = "ended";
  state.bossDefeated = win;
  ui.endKicker.textContent = win ? "终局核心击破" : "本局结束";
  ui.endTitle.textContent = win ? "你打穿了下压结构" : "数字压到底线了";
  ui.endCopy.textContent = `最高连击 ${state.bestCombo}，推进 ${state.rows} 行，最终球数 ${state.skills.baseBalls}。`;
  ui.endModal.classList.remove("hidden");
  updateHud();
}

function addBurst(x, y, color, count) {
  for (let i = 0; i < count; i += 1) {
    const angle = Math.random() * TAU;
    const speed = rand(40, 210);
    state.particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      r: rand(1.5, 4),
      color,
      life: rand(0.25, 0.7),
    });
  }
}

function addFloat(x, y, text, color) {
  state.floating.push({ x, y, text, color, life: 0.72 });
}

function draw() {
  ctx.clearRect(0, 0, width, height);
  const sx = state.shake ? rand(-state.shake, state.shake) : 0;
  const sy = state.shake ? rand(-state.shake, state.shake) : 0;
  ctx.save();
  ctx.translate(sx, sy);

  drawDeathLine();
  drawAim();
  state.segments.forEach(drawSegment);
  state.portals.forEach(drawPortal);
  state.tiles.forEach(drawTile);
  state.activeBalls.forEach(drawBall);
  state.particles.forEach(drawParticle);
  state.floating.forEach(drawFloat);
  drawLauncher();

  ctx.restore();
}

function drawDeathLine() {
  ctx.save();
  ctx.strokeStyle = "rgba(255, 93, 115, 0.58)";
  ctx.setLineDash([8, 8]);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, deathLine);
  ctx.lineTo(width, deathLine);
  ctx.stroke();
  ctx.restore();
}

function drawAim() {
  if (state.status !== "aim") return;
  const len = Math.min(height * 0.38, 210) * state.aimPower;
  const x = launcher.x + Math.cos(state.aimAngle) * len;
  const y = launcher.y + Math.sin(state.aimAngle) * len;
  ctx.save();
  ctx.strokeStyle = "rgba(116, 244, 167, 0.72)";
  ctx.lineWidth = 3;
  ctx.setLineDash([10, 8]);
  ctx.beginPath();
  ctx.moveTo(launcher.x, launcher.y);
  ctx.lineTo(x, y);
  ctx.stroke();
  ctx.restore();
}

function drawLauncher() {
  ctx.save();
  const gradient = ctx.createRadialGradient(launcher.x, launcher.y, 4, launcher.x, launcher.y, 22);
  gradient.addColorStop(0, "#f7fbff");
  gradient.addColorStop(0.45, "#46e6ff");
  gradient.addColorStop(1, "rgba(70, 230, 255, 0)");
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(launcher.x, launcher.y, 22, 0, TAU);
  ctx.fill();
  ctx.fillStyle = "#071018";
  ctx.beginPath();
  ctx.arc(launcher.x, launcher.y, 7, 0, TAU);
  ctx.fill();
  ctx.restore();
}

function drawTile(tile) {
  const hpRatio = Math.max(0, tile.hp / tile.maxHp);
  const colors = {
    block: ["#273653", "#46e6ff"],
    boss: ["#4c1f37", "#ff5d73"],
    skill: ["#173c4a", "#46e6ff"],
    bonus: ["#173d2c", "#74f4a7"],
    bomb: ["#4a2f15", "#ffd166"],
  };
  const [base, accent] = colors[tile.type] || colors.block;
  ctx.save();
  ctx.fillStyle = base;
  roundRect(tile.x, tile.y, tile.w, tile.h, 8);
  ctx.fill();
  ctx.strokeStyle = accent;
  ctx.globalAlpha = 0.75;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.fillStyle = accent;
  ctx.fillRect(tile.x, tile.y + tile.h - 4, tile.w * hpRatio, 4);
  ctx.fillStyle = "#f7fbff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `800 ${Math.max(14, cell * 0.28)}px system-ui, sans-serif`;
  ctx.fillText(tile.type === "block" ? String(Math.max(0, tile.hp)) : tile.label, tile.x + tile.w / 2, tile.y + tile.h / 2);
  ctx.restore();
}

function drawSegment(segment) {
  ctx.save();
  ctx.strokeStyle = segment.kind === "gate" ? "#ffd166" : "#7fe9ff";
  ctx.lineWidth = segment.kind === "gate" ? 8 : 6;
  ctx.lineCap = "round";
  ctx.shadowColor = ctx.strokeStyle;
  ctx.shadowBlur = 12;
  ctx.beginPath();
  ctx.moveTo(segment.x1, segment.y1);
  ctx.lineTo(segment.x2, segment.y2);
  ctx.stroke();
  ctx.restore();
}

function drawPortal(portal) {
  portal.pulse += 0.05;
  ctx.save();
  ctx.translate(portal.x, portal.y);
  ctx.strokeStyle = portal.id % 2 ? "#b77dff" : "#46e6ff";
  ctx.lineWidth = 4;
  ctx.shadowColor = ctx.strokeStyle;
  ctx.shadowBlur = 18;
  ctx.beginPath();
  ctx.arc(0, 0, portal.r + Math.sin(portal.pulse) * 3, 0, TAU);
  ctx.stroke();
  ctx.rotate(portal.pulse);
  ctx.beginPath();
  ctx.arc(0, 0, portal.r * 0.55, 0.2, Math.PI * 1.35);
  ctx.stroke();
  ctx.restore();
}

function drawBall(ball) {
  ctx.save();
  const gradient = ctx.createRadialGradient(ball.x - ball.r * 0.35, ball.y - ball.r * 0.35, 1, ball.x, ball.y, ball.r * 2.4);
  gradient.addColorStop(0, "#ffffff");
  gradient.addColorStop(0.35, ball.mini ? "#b77dff" : "#74f4a7");
  gradient.addColorStop(1, "rgba(70, 230, 255, 0)");
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(ball.x, ball.y, ball.r * 2.2, 0, TAU);
  ctx.fill();
  ctx.fillStyle = ball.mini ? "#d8b7ff" : "#f7fbff";
  ctx.beginPath();
  ctx.arc(ball.x, ball.y, ball.r, 0, TAU);
  ctx.fill();
  ctx.restore();
}

function drawParticle(particle) {
  ctx.save();
  ctx.globalAlpha = Math.max(0, particle.life * 1.6);
  ctx.fillStyle = particle.color;
  ctx.beginPath();
  ctx.arc(particle.x, particle.y, particle.r, 0, TAU);
  ctx.fill();
  ctx.restore();
}

function drawFloat(item) {
  ctx.save();
  ctx.globalAlpha = Math.min(1, item.life * 1.8);
  ctx.fillStyle = item.color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "800 13px system-ui, sans-serif";
  ctx.fillText(item.text, item.x, item.y);
  ctx.restore();
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
}

function loop(time) {
  const dt = Math.min(0.028, (time - lastTime) / 1000 || 0);
  lastTime = time;
  if (state.status !== "ended") step(dt);
  draw();
  updateHud();
  rafId = requestAnimationFrame(loop);
}

function setAimFromPoint(clientX, clientY) {
  if (state.status !== "aim") return;
  const rect = canvas.getBoundingClientRect();
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  const dx = x - launcher.x;
  const dy = y - launcher.y;
  let angle = Math.atan2(dy, dx);
  angle = Math.max(-Math.PI + 0.18, Math.min(-0.18, angle));
  state.aimAngle = angle;
  state.aimPower = Math.max(0.55, Math.min(1.12, Math.hypot(dx, dy) / (height * 0.34)));
}

canvas.addEventListener("pointerdown", (event) => {
  canvas.setPointerCapture(event.pointerId);
  setAimFromPoint(event.clientX, event.clientY);
});

canvas.addEventListener("pointermove", (event) => {
  if (event.buttons || event.pointerType === "touch") {
    setAimFromPoint(event.clientX, event.clientY);
  }
});

canvas.addEventListener("pointerup", (event) => {
  setAimFromPoint(event.clientX, event.clientY);
  if (state.status === "aim") launchVolley();
});

ui.launchBtn.addEventListener("click", launchVolley);
ui.recallBtn.addEventListener("click", recallBalls);
ui.resetBtn.addEventListener("click", resetGame);
ui.restartBtn.addEventListener("click", resetGame);
window.addEventListener("resize", () => {
  resize();
  if (state) {
    state.tiles.forEach((tile) => Object.assign(tile, tileRect(tile.col, tile.row)));
  }
});

resize();
resetGame();
