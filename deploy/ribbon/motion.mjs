// The ribbon's motion, "Обвивает · глубина" (boks-ribbon-backend-kit,
// 2026-11-11, renderer/src/depth-motion.mjs, itself a port of the Diffusion
// Studio source). Kept as handed over: the timing, the route around the
// measured title and the drawing of the tube are the approved design. Change
// it only with a new kit, and bump `ribbonTemplate` in lib/boks/ribbon.ts.
export const DEPTH_DURATION = 11.4;
const DOCK = [194, 99, 0];
const BODY = 320;
const COIL_RADIUS = 8;
const GIANT_IN = 4.50;
const GIANT_OUT = 7.35;
const RETURN_IN = 7.65;
const RETURN_END = 8.37;
const GIANT_ANGLE = 0;
const clamp = (t) => Math.max(0, Math.min(1, t));
const ease = (t) => { const q = clamp(t); return q * q * (3 - 2 * q); };
function motion(keys, time) {
    const i = keys.findIndex(([at]) => at > time);
    if (i === 0)
        return keys[0][1];
    if (i < 0)
        return keys[keys.length - 1][1];
    const [a, x, vx = 0] = keys[i - 1];
    const [b, y, vy = 0] = keys[i];
    const span = b - a;
    const t = (time - a) / span;
    return x + (y - x) * ease(t) + span * t * (1 - t) * (vx * (1 - t) - vy * t);
}
function curvePoint([a, b, c, d], t) {
    const u = 1 - t;
    const axis = (i) => a[i] * u ** 3 + 3 * b[i] * u * u * t + 3 * c[i] * u * t * t + d[i] * t ** 3;
    return [axis(0), axis(1), axis(2)];
}
function makeRoute(titleWidth, titleSize, titleX, titleY) {
    const points = [DOCK];
    const addCurve = (curve) => {
        for (let i = 1; i <= 96; i++)
            points.push(curvePoint(curve, i / 96));
    };
    const center = titleY + titleSize * .56;
    const amplitude = titleSize * .40;
    const left = -44;
    const right = titleX + titleWidth + 60;
    const turns = Math.max(4, Math.min(7, Math.round((right - left) / 107)));
    const waveNumber = Math.PI * 2 * turns / (right - left);
    const incline = amplitude * waveNumber;
    const first = [left, center, 27];
    addCurve([DOCK, [280, 99, 0], [300, 157, 0], [264, 225, 0]]);
    addCurve([[264, 225, 0], [210, 327, 0], [-105, 341, 0], [-175, 411, 0]]);
    addCurve([[-175, 411, 0], [-236, 472, 0], [-257, 584, 0], [-184, 607, 0]]);
    addCurve([[-184, 607, 0], [-117, 628, 0], [left - 45, center + 45 * incline, 27], first]);
    const startIndex = points.length - 1;
    for (let i = 1; i <= turns * 160; i++) {
        const q = i / (turns * 160);
        const angle = q * turns * Math.PI * 2;
        points.push([left + (right - left) * q, center - amplitude * Math.sin(angle), 27 * Math.cos(angle)]);
    }
    const finishIndex = points.length - 1;
    const last = points[finishIndex];
    // Very wide generic titles need a monotone exit beyond the right edge.
    // The three supplied native presets keep the original control points.
    const wide = right > 1040;
    const exitX = wide ? Math.max(1290, right + 240) : 1290;
    addCurve([last, [right + 90, center - 90 * incline, 27], [wide ? right + 140 : 1014, 346, 5], [exitX, 321, 0]]);
    addCurve([[exitX, 321, 0], [Math.max(1450, exitX + 160), 307, 0], [Math.max(1608, exitX + 318), 310, 0], [Math.max(1770, exitX + 480), 310, 0]]);
    const samples = [{ point: points[0], distance: 0 }];
    for (const point of points.slice(1)) {
        const previous = samples[samples.length - 1];
        const length = Math.hypot(point[0] - previous.point[0], point[1] - previous.point[1], point[2] - previous.point[2]);
        samples.push({ point, distance: previous.distance + length });
    }
    const coilStart = samples[startIndex].distance;
    const coilEnd = samples[finishIndex].distance;
    const end = samples[samples.length - 1].distance;
    const hidden = samples.filter(({ point, distance }) => distance < coilStart && point[0] < -42);
    return {
        samples, coilStart, coilEnd, end,
        titleSize,
        narrowStart: hidden[0].distance + BODY,
        narrowEnd: hidden[hidden.length - 1].distance,
        headKeys: [
            [0, 0], [.45, 0], [1.54, coilStart, 500], [3.10, coilEnd],
            [3.35, coilEnd], [4.25, end],
        ],
    };
}
const routes = new Map();
function sample(route, distance) {
    if (distance < 0)
        return [194 + distance, 99, 0];
    const d = Math.max(0, Math.min(route.end, distance));
    let low = 0;
    let high = route.samples.length - 1;
    while (high - low > 1) {
        const middle = (low + high) >> 1;
        if (route.samples[middle].distance < d)
            low = middle;
        else
            high = middle;
    }
    const a = route.samples[low];
    const b = route.samples[high];
    const q = (d - a.distance) / (b.distance - a.distance);
    return [
        a.point[0] + (b.point[0] - a.point[0]) * q,
        a.point[1] + (b.point[1] - a.point[1]) * q,
        a.point[2] + (b.point[2] - a.point[2]) * q,
    ];
}
export function depthAt(time, titleWidth, titleSize, titleX = 61, titleY = 452) {
    const key = Math.round(titleWidth) + ':' + titleSize + ':' + titleX + ':' + titleY;
    let route = routes.get(key);
    if (!route) {
        route = makeRoute(titleWidth, titleSize, titleX, titleY);
        routes.set(key, route);
    }
    const head = motion(route.headKeys, time);
    const follow = Math.min(route.coilStart, head - BODY);
    const tail = time < 3.35 ? follow
        : route.coilStart + (route.end - BODY - route.coilStart) * ease((time - 3.35) / .90);
    const thin = ease((head - route.narrowStart) / (route.narrowEnd - route.narrowStart));
    const radius = 29 - (29 - COIL_RADIUS) * thin;
    const returned = time >= RETURN_IN;
    const dockX = motion([[RETURN_IN, -126], [RETURN_END, 194]], time);
    const normal = time <= 4.25 || returned;
    const pointAt = (distance) => {
        if (returned)
            return [dockX - (BODY - distance), 99, 0];
        return sample(route, distance);
    };
    let logo = [999, -999, -999];
    if (returned)
        logo = [dockX - BODY, dockX, dockX];
    else if (tail <= 0)
        logo = [194 + tail, 194, -999];
    const giant = time >= GIANT_IN && time <= GIANT_OUT;
    const giantX = motion([
        [GIANT_IN, 1580, -700], [5.30, 680, -1450], [6.05, -420, -1900],
        [6.40, -1350, -3500], [6.75, -3300, -7000],
        [7.10, -6650, -8000], [GIANT_OUT, -7600],
    ], time);
    return {
        normal, head: returned ? BODY : head, tail: returned ? 0 : tail,
        pointAt, radius: returned ? 29 : radius, logo,
        coilStart: route.coilStart, coilEnd: route.coilEnd,
        titleSize: route.titleSize, titleX, titleY,
        giant, giantX, giantAngle: GIANT_ANGLE * 180 / Math.PI,
        giantLogoX: giantX + 400 * Math.cos(GIANT_ANGLE),
        giantLogoY: 315 + 400 * Math.sin(GIANT_ANGLE) - 790 * 386 / 847 / 2,
        giantLogoWidth: 790,
    };
}
function tubeSections(points, radius) {
    return points.map((point, i) => {
        const a = points[Math.max(0, i - 1)];
        const b = points[Math.min(points.length - 1, i + 1)];
        const dx = b[0] - a[0];
        const dy = b[1] - a[1];
        const length = Math.max(.001, Math.hypot(dx, dy));
        const size = radius * (1 + .22 * point[2] / 27);
        const nx = -dy / length * size;
        const ny = dx / length * size;
        return { point, left: [point[0] - nx, point[1] - ny], right: [point[0] + nx, point[1] + ny],
            radius: size, angle: Math.atan2(dy, dx) };
    });
}
function paintTube(ctx, points, radius, shadow) {
    if (points.length < 2)
        return;
    const sections = tubeSections(points, radius);
    const first = sections[0];
    const last = sections[sections.length - 1];
    const shape = new Path2D();
    shape.moveTo(...first.left);
    for (const section of sections.slice(1))
        shape.lineTo(...section.left);
    shape.arc(last.point[0], last.point[1], last.radius, last.angle - Math.PI / 2, last.angle + Math.PI / 2);
    for (const section of [...sections].reverse())
        shape.lineTo(...section.right);
    shape.arc(first.point[0], first.point[1], first.radius, first.angle + Math.PI / 2, first.angle + Math.PI * 1.5);
    shape.closePath();
    if (shadow) {
        ctx.save();
        ctx.fillStyle = 'rgba(34,20,3,.22)';
        ctx.filter = 'blur(3px)';
        ctx.translate(1.5, 2.5);
        ctx.fill(shape);
        ctx.restore();
    }
    ctx.save();
    ctx.clip(shape);
    ctx.fillStyle = '#ffda25';
    ctx.fill(shape);
    const surfaceColor = (section) => {
        const depth = Math.max(-1, Math.min(1, section.point[2] / 27));
        // The parked ribbon faces the viewer. Only receding coils lose light.
        const light = 1 - .14 * Math.max(0, -depth);
        const gradient = ctx.createLinearGradient(...section.left, ...section.right);
        gradient.addColorStop(0, `rgb(${Math.round(255 * light)},${Math.round(225 * light)},47)`);
        gradient.addColorStop(.40, `rgb(${Math.round(255 * light)},${Math.round(229 * light)},53)`);
        gradient.addColorStop(1, `rgb(${Math.round(255 * light)},${Math.round(219 * light)},35)`);
        return gradient;
    };
    // Caps share the body's lighting, so the red disc has no yellow seam behind it.
    for (const cap of [first, last]) {
        ctx.fillStyle = surfaceColor(cap);
        ctx.beginPath();
        ctx.arc(cap.point[0], cap.point[1], cap.radius, 0, Math.PI * 2);
        ctx.fill();
    }
    for (let i = 0; i < sections.length - 1; i++) {
        const a = sections[i];
        const b = sections[Math.min(sections.length - 1, i + 2)];
        const face = new Path2D();
        face.moveTo(...a.left);
        face.lineTo(...b.left);
        face.lineTo(...b.right);
        face.lineTo(...a.right);
        face.closePath();
        ctx.fillStyle = surfaceColor(a);
        ctx.fill(face);
    }
    ctx.restore();
}
function foregroundSpans(points, frame) {
    const spans = [];
    let from;
    for (let i = 1; i < points.length; i++) {
        const a = points[i - 1];
        const b = points[i];
        const inCoil = b.distance >= frame.coilStart && a.distance <= frame.coilEnd;
        if (!inCoil)
            continue;
        const frontA = a.point[2] >= 0;
        const frontB = b.point[2] >= 0;
        if (frontA && from === undefined)
            from = a.point[0];
        if (frontA !== frontB) {
            const q = Math.abs(a.point[2]) / (Math.abs(a.point[2]) + Math.abs(b.point[2]));
            const x = a.point[0] + (b.point[0] - a.point[0]) * q;
            if (frontB)
                from = x;
            else if (from !== undefined) {
                spans.push([from, x]);
                from = undefined;
            }
        }
    }
    if (from !== undefined)
        spans.push([from, points[points.length - 1].point[0]]);
    return spans;
}
function paintDisc(ctx, x, y, radius) {
    const r = radius * .728;
    const red = ctx.createRadialGradient(x - r * .32, y - r * .32, 0, x, y, r);
    red.addColorStop(0, '#ee4d33');
    red.addColorStop(.74, '#d43125');
    red.addColorStop(1, '#b8231e');
    ctx.fillStyle = red;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
}
export function drawDepth(ctx, frame, layer, width, height) {
    ctx.clearRect(0, 0, width, height);
    if (frame.normal) {
        const count = Math.max(2, Math.ceil((frame.head - frame.tail) / .65));
        const samples = Array.from({ length: count + 1 }, (_, i) => {
            const distance = frame.tail + (frame.head - frame.tail) * i / count;
            return { distance, point: frame.pointAt(distance) };
        });
        const points = samples.map(sample => sample.point);
        const tip = points[points.length - 1];
        if (layer === 'back') {
            paintTube(ctx, points, frame.radius, true);
            paintDisc(ctx, tip[0], tip[1], frame.radius * (1 + .22 * tip[2] / 27));
        }
        else {
            const spans = foregroundSpans(samples, frame);
            if (spans.length) {
                ctx.save();
                const mask = new Path2D();
                for (const [from, to] of spans) {
                    mask.rect(Math.min(from, to) - .3, frame.titleY - 5, Math.abs(to - from) + .6, frame.titleSize * 1.26 + 12);
                }
                ctx.clip(mask);
                paintTube(ctx, points, frame.radius, false);
                ctx.restore();
            }
            if (tip[2] > 0)
                paintDisc(ctx, tip[0], tip[1], frame.radius * (1 + .22 * tip[2] / 27));
        }
    }
    if (layer === 'front' && frame.giant) {
        const x = frame.giantX;
        const y = 315;
        const radius = 260;
        const path = new Path2D();
        path.moveTo(x, y);
        path.lineTo(x + 6200 * Math.cos(GIANT_ANGLE), y + 6200 * Math.sin(GIANT_ANGLE));
        ctx.save();
        ctx.lineCap = 'round';
        ctx.lineWidth = radius * 2;
        ctx.shadowColor = 'rgba(21,13,6,.32)';
        ctx.shadowBlur = 28;
        ctx.shadowOffsetY = 14;
        const yellow = ctx.createLinearGradient(0, y - radius, 0, y + radius);
        yellow.addColorStop(0, '#ffe93a');
        yellow.addColorStop(.50, '#ffe426');
        yellow.addColorStop(1, '#ffce19');
        ctx.strokeStyle = yellow;
        ctx.stroke(path);
        ctx.restore();
        paintDisc(ctx, x, y, radius);
    }
}
