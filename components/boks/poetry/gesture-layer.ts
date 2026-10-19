import {
  approach,
  coverTransform,
  screenToImage,
  turnAmount,
  turnDone,
  wipeStamps,
  type ShadowAmbience,
  type WarpGesture,
} from "@/lib/boks/poetry/gesture";

/**
 * The picture of a gesture scene, redrawn by the GPU as the hand moves it.
 *
 * One quad and one fragment shader: the picture is sampled through a warp,
 * per pixel, so ripples, two reflections sliding together and a camera
 * leaning into half a landscape all cost the same single draw. Nothing here
 * touches layout or style; the frame loop calls `paint` and the canvas sits
 * inside the scene's own layer, so it dissolves with the picture.
 *
 * Without WebGL the canvas stays transparent and the `<img>` beneath it is
 * the scene, exactly as in every other poem. The gesture is lost; the poem
 * is not.
 */

export type GestureFrame = {
  /** Seconds, for the ripples. Frozen under reduced motion. */
  time: number;
  /** The frame's own clock, milliseconds, for things that travel. */
  now: number;
  /** Reduced motion: nothing moves on its own; the hand still works. */
  still: boolean;
  /** 0 at rest, 1 fully held. */
  hold: number;
  /** -1 full left, 0 the ambiguous middle, 1 full right. */
  lean: number;
  /** Where the recording is, milliseconds - for what a picture does in its own time. */
  ms?: number;
};

/**
 * What the hand is doing, shared by every gesture layer of a poem: a drag in
 * progress, drags let go and not yet taken by their scene, and what the reader
 * has already done that a later picture answers - songs sent away, threads
 * that held. Pixels are relative to the poem's frame.
 */
export type GestureInput = {
  drag: null | { scene: number; x0: number; y0: number; x: number; y: number };
  releases: { scene: number; x0: number; y0: number; x: number; y: number }[];
  flown: number;
  connections: number;
};

export type GestureLayer = {
  paint: (frame: GestureFrame, input?: GestureInput) => void;
  dispose: () => void;
};

const vertexSource = `
attribute vec2 a_position;
varying vec2 v_screen;
void main() {
  v_screen = vec2(a_position.x * 0.5 + 0.5, 0.5 - a_position.y * 0.5);
  gl_Position = vec4(a_position, 0.0, 1.0);
}`;

/*
 * Every effect in one program, picked by `u_kind`, so a poem never compiles
 * anything at the moment its gesture scene arrives.
 *
 * Water (kind 0): below the waterline the picture is a reflection. At rest it
 * ripples - two sines across the rows, larger nearer the viewer. Held, the
 * ripples die away and the reflected halves slide towards the middle, more the
 * further from the waterline, so the feet stay on their own reflections.
 *
 * Lean (kind 1): the camera pushes in towards one side's focus and the light
 * follows it - the side leaned into is lifted, the other falls into shade.
 * Leaning left warms the picture; leaning right drains it towards smoke.
 *
 * Glory (kind 2): inside a soft ellipse of sky the picture is a memory. At
 * rest it is drained to a cold storm grey and dimmed, breathing faintly as
 * cloud does; held, its own colour returns, warmer than painted, it draws a
 * little nearer, and everything outside it falls into shade.
 */
const fragmentSource = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 v_screen;
uniform sampler2D u_image;
uniform vec4 u_cover;
uniform int u_kind;
uniform float u_time;
uniform float u_hold;
uniform float u_lean;
uniform vec4 u_water;
uniform vec4 u_focus;
uniform float u_zoom;
uniform vec4 u_glory;
uniform vec4 u_point;
uniform vec4 u_glass;
uniform sampler2D u_mask;
uniform float u_cleared;
uniform vec2 u_aspect;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + 1.0), f.x), f.y);
}

float fbm(vec2 p) {
  float value = 0.0;
  float amplitude = 0.5;
  for (int i = 0; i < 4; i++) {
    value += amplitude * noise(p);
    p *= 2.03;
    amplitude *= 0.5;
  }
  return value;
}

float ellipse(vec2 uv, vec4 shape) {
  return 1.0 - smoothstep(0.55, 1.0, length((uv - shape.xy) / shape.zw));
}

// The picture without the figure, roughly: a wide ring of samples around the
// point, reaching past the figure's edge, so what is left is what she stood in.
vec3 around(vec2 uv, vec4 shape) {
  vec3 sum = vec3(0.0);
  for (int i = 0; i < 12; i++) {
    float a = float(i) * 0.5236;
    sum += texture2D(u_image, clamp(uv + vec2(cos(a) * shape.z * 1.05, sin(a) * shape.w * 0.45), 0.0, 1.0)).rgb;
  }
  return sum / 12.0;
}

// How bright the picture is just here, and on the ring around a shape.
float lumaNear(vec2 uv, vec2 reach) {
  vec3 sum = vec3(0.0);
  for (int i = 0; i < 8; i++) {
    float a = float(i) * 0.785398;
    sum += texture2D(u_image, clamp(uv + vec2(cos(a), sin(a)) * reach, 0.0, 1.0)).rgb;
  }
  return dot(sum / 8.0, vec3(0.299, 0.587, 0.114));
}

void main() {
  vec2 uv = v_screen * u_cover.xy + u_cover.zw;
  vec3 tint = vec3(1.0);
  float light = 1.0;
  float drain = 0.0;
  float memory = 0.0;

  vec3 glow = vec3(0.0);
  vec3 veil = vec3(0.0);
  float veiled = 0.0;

  if (u_kind == 3) {
    // Spirits: a fog drifting over the dead, pushed aside as the candle steadies.
    vec2 candle = u_point.xy;
    vec2 away = (uv - candle) * u_aspect;
    vec2 drift = vec2(u_time * 0.035, u_time * 0.012) + normalize(away + 0.0001) * u_hold * 0.4;
    float fog = smoothstep(0.3, 0.85, fbm(uv * vec2(3.0, 5.2) + drift));
    float figure = ellipse(uv, u_glory);
    veiled = (0.55 + 0.45 * fog) * (1.0 - 0.9 * u_hold) * (1.0 - 0.9 * figure);
    float flicker = (1.0 - u_hold) * (0.5 * sin(u_time * 11.0) + 0.3 * sin(u_time * 23.0 + 1.3) + 0.2 * sin(u_time * 5.1));
    float d = length(away);
    float pool = exp(-d * d / 0.018);
    light = (1.0 + 0.05 * flicker) * mix(0.72, 1.0, max(u_hold, figure));
    glow = vec3(1.0, 0.68, 0.32) * pool * (0.16 + 0.1 * u_hold + 0.08 * flicker);
    veil = vec3(0.3, 0.33, 0.38) * (0.7 + 0.6 * fog) + vec3(0.25, 0.17, 0.08) * pool;
  } else if (u_kind == 4) {
    // Condensation on a glass, cleared where the finger has been.
    vec2 g = (uv - u_glass.xy) / u_glass.zw;
    float inside = smoothstep(0.0, 0.22, g.x) * smoothstep(1.0, 0.94, g.x) * smoothstep(0.0, 0.08, g.y) * smoothstep(1.0, 0.92, g.y);
    if (inside > 0.0) {
      float wiped = texture2D(u_mask, clamp(g, 0.0, 1.0)).r;
      // The more of the glass is seen, the further back the one in it stands.
      float centre = 1.0 - smoothstep(0.25, 0.5, max(abs(g.x - 0.5), abs(g.y - 0.5)));
      vec2 back = (g - vec2(0.5, 0.85)) * (1.0 + 0.05 * u_cleared * centre) + vec2(0.5, 0.85);
      vec2 seen = u_glass.xy + back * u_glass.zw;
      vec3 clear = texture2D(u_image, clamp(seen, 0.0, 1.0)).rgb;
      vec3 blur = vec3(0.0);
      for (int i = 0; i < 8; i++) {
        float a = float(i) * 0.785398;
        blur += texture2D(u_image, clamp(seen + vec2(cos(a), sin(a)) * vec2(0.014, 0.008), 0.0, 1.0)).rgb;
      }
      blur /= 8.0;
      float beads = noise(g * vec2(70.0, 120.0)) * 0.6 + noise(g * vec2(23.0, 40.0)) * 0.4;
      vec3 misted = mix(blur, vec3(0.27, 0.3, 0.35) + 0.45 * blur, 0.6 + 0.1 * beads) + (beads - 0.5) * 0.05;
      vec3 glass = mix(misted, clear, wiped);
      vec3 original = texture2D(u_image, clamp(uv, 0.0, 1.0)).rgb;
      gl_FragColor = vec4(mix(original, glass, inside), 1.0);
      return;
    }
  } else if (u_kind == 5) {
    // Turning round: the view swings towards her, and she goes into the light.
    float amount = u_hold;
    vec2 towards = u_glory.xy;
    uv = (uv - towards) / (1.0 + 0.07 * amount) + towards;
    float figure = ellipse(uv, u_glory);
    float gone = figure * smoothstep(0.0, 1.0, amount) * 0.96;
    vec3 colour = texture2D(u_image, clamp(uv, 0.0, 1.0)).rgb;
    colour = mix(colour, around(uv, u_glory), gone);
    colour += vec3(1.0, 0.82, 0.55) * 0.14 * gone + vec3(0.05, 0.03, 0.0) * amount;
    gl_FragColor = vec4(colour, 1.0);
    return;
  } else if (u_kind == 6) {
    // A shadow found among moving branches, and a low sun that shifts.
    float sway = sin(u_time * 0.6) * 0.06 + sin(u_time * 1.3 + 0.7) * 0.02;
    float branches = smoothstep(0.48, 0.72, fbm(uv * vec2(6.0, 3.6) + vec2(sway, sway * 0.4)));
    float figure = ellipse(uv, u_glory);
    float filled = figure * (1.0 - u_hold);
    float upper = smoothstep(0.85, 0.35, uv.y);
    light = (1.0 - 0.2 * branches * upper * (1.0 + filled)) * (1.0 + 0.05 * sin(u_time * 0.23));
    tint = vec3(1.0 + 0.03 * sin(u_time * 0.23), 1.0, 1.0 - 0.03 * sin(u_time * 0.23));
    vec3 colour = texture2D(u_image, clamp(uv, 0.0, 1.0)).rgb;
    // The sun fills the shape in: the same stone, lit as the stone around it
    // is, so its lichen and grain stay where they are.
    if (filled > 0.0) {
      float here = lumaNear(uv, vec2(0.02, 0.012));
      float lit = lumaNear(u_glory.xy, u_glory.zw * 1.35);
      colour *= mix(1.0, clamp(lit / max(here, 0.03), 1.0, 3.0), filled * 0.9);
    }
    gl_FragColor = vec4(colour * tint * light, 1.0);
    return;
  } else if (u_kind == 2) {
    memory = 1.0 - smoothstep(0.55, 1.0, length((uv - u_glory.xy) / u_glory.zw));
    uv = mix(uv, u_glory.xy, 0.025 * u_hold * memory);
    float faded = memory * (1.0 - u_hold);
    drain = 0.85 * faded;
    light = mix(1.0, 0.68 + 0.04 * sin(u_time * 0.7), faded) * mix(1.0, 0.82, u_hold * (1.0 - memory));
    tint = mix(mix(vec3(1.0), vec3(0.86, 0.9, 1.0), faded), vec3(1.14, 1.02, 0.8), u_hold * memory);
  } else if (u_kind == 0) {
    float waterline = u_water.x;
    float depth = smoothstep(waterline, waterline + 0.12, uv.y);
    float x = uv.x;
    float pull = u_hold * u_water.y * depth;
    x -= pull * sin(6.2831853 * x);
    float calm = 1.0 - u_hold;
    float near = depth * (0.35 + 0.65 * clamp((uv.y - waterline) / (1.0 - waterline), 0.0, 1.0));
    float wave = sin(uv.y * 230.0 - u_time * 2.1) * 0.6 + sin(uv.y * 97.0 + u_time * 1.3 + x * 9.0) * 0.4;
    x += calm * near * u_water.z * wave;
    float y = uv.y + calm * near * u_water.z * 0.35 * sin(uv.y * 150.0 - u_time * 1.7);
    uv = vec2(x, y);
  } else {
    float amount = abs(u_lean);
    vec2 focus = mix(vec2(0.5, 0.5), u_lean < 0.0 ? u_focus.xy : u_focus.zw, amount);
    float zoom = 1.0 + u_zoom * amount;
    uv = (uv - focus) / zoom + focus;
    float side = smoothstep(0.3, 0.7, uv.x);
    if (u_lean < 0.0) {
      light = mix(1.0, mix(1.1, 0.5, side), amount);
      tint = mix(vec3(1.0), vec3(1.06, 1.03, 0.9), amount);
    } else {
      light = mix(1.0, mix(0.5, 1.0, side), amount);
      tint = mix(vec3(1.0), vec3(1.04, 0.94, 0.86), amount);
      drain = 0.5 * amount;
    }
  }

  vec3 colour = texture2D(u_image, clamp(uv, 0.0, 1.0)).rgb;
  float grey = dot(colour, vec3(0.299, 0.587, 0.114));
  colour = mix(colour, vec3(grey), drain);
  colour = mix(colour, veil, veiled * 0.9);
  colour = colour * tint * light + glow;
  // The remembered gold glows a little past its own paint.
  colour += u_hold * memory * vec3(0.09, 0.05, 0.0) * smoothstep(0.35, 0.9, grey);
  gl_FragColor = vec4(colour, 1.0);
}`;

function compile(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

export function createGestureLayer(
  canvas: HTMLCanvasElement,
  image: HTMLImageElement,
  scene: {
    gesture?: WarpGesture;
    ambience?: ShadowAmbience;
    focalPoint: { x: number; y: number };
    startMs: number;
  },
  sceneIndex: number
): GestureLayer | null {
  const gesture = scene.gesture ?? scene.ambience;
  const focal = scene.focalPoint;
  if (!gesture) return null;
  const gl = canvas.getContext("webgl", { alpha: true, antialias: false, premultipliedAlpha: true });
  if (!gl) return null;
  const vertex = compile(gl, gl.VERTEX_SHADER, vertexSource);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();
  if (!vertex || !fragment || !program) return null;
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
  gl.useProgram(program);

  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, "a_position");
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

  // Not a power of two: no mipmaps, clamped edges - WebGL 1 allows nothing else.
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, image);

  const at = (name: string) => gl.getUniformLocation(program, name);
  const cover = at("u_cover");
  const time = at("u_time");
  const hold = at("u_hold");
  const lean = at("u_lean");
  gl.uniform1i(at("u_image"), 0);
  gl.uniform1i(at("u_mask"), 1);
  gl.uniform2f(at("u_aspect"), 1, image.naturalHeight / Math.max(1, image.naturalWidth));
  const cleared = at("u_cleared");
  const wipe = gesture.effect === "clear-condensation" ? createMask(gl, gesture.glass, gesture.brush, image) : null;
  if (gesture.effect === "converge-reflections") {
    gl.uniform1i(at("u_kind"), 0);
    gl.uniform4f(at("u_water"), gesture.waterline, gesture.pull, gesture.ripple, 0);
  } else if (gesture.effect === "recall-glory") {
    gl.uniform1i(at("u_kind"), 2);
    gl.uniform4f(at("u_glory"), gesture.vision.x, gesture.vision.y, gesture.radius.x, gesture.radius.y);
  } else if (gesture.effect === "summon-spirits") {
    gl.uniform1i(at("u_kind"), 3);
    gl.uniform4f(at("u_point"), gesture.candle.x, gesture.candle.y, 0, 0);
    gl.uniform4f(at("u_glory"), gesture.figure.x, gesture.figure.y, gesture.radius.x, gesture.radius.y);
  } else if (gesture.effect === "clear-condensation") {
    gl.uniform1i(at("u_kind"), 4);
    gl.uniform4f(at("u_glass"), gesture.glass.x, gesture.glass.y, gesture.glass.width, gesture.glass.height);
  } else if (gesture.effect === "turn-away") {
    gl.uniform1i(at("u_kind"), 5);
    gl.uniform4f(at("u_glory"), gesture.apparition.x, gesture.apparition.y, gesture.radius.x, gesture.radius.y);
  } else if (gesture.effect === "emerge-shadow") {
    gl.uniform1i(at("u_kind"), 6);
    gl.uniform4f(at("u_glory"), gesture.shadow.x, gesture.shadow.y, gesture.radius.x, gesture.radius.y);
  } else {
    gl.uniform1i(at("u_kind"), 1);
    gl.uniform4f(
      at("u_focus"),
      gesture.leftFocus.x,
      gesture.leftFocus.y,
      gesture.rightFocus.x,
      gesture.rightFocus.y
    );
    gl.uniform1f(at("u_zoom"), gesture.zoom);
  }

  let size = { width: 0, height: 0 };
  let transform = coverTransform({ width: 1, height: 1 }, { width: 1, height: 1 }, focal);
  /*
   * What this picture has made of the hand, kept between frames: the spirits
   * come forward more slowly than a finger goes down, and a turn carried all
   * the way round stays done.
   */
  let reveal = 0;
  let turned = false;
  let lastFrame = 0;
  const paint = (frame: GestureFrame, input?: GestureInput) => {
    // Sized here rather than on resize events: one comparison a frame, and
    // a rotated phone is right on the next frame instead of after a debounce.
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.round(canvas.clientWidth * ratio);
    const height = Math.round(canvas.clientHeight * ratio);
    if (width === 0 || height === 0) return;
    if (width !== size.width || height !== size.height) {
      size = { width, height };
      canvas.width = width;
      canvas.height = height;
      gl.viewport(0, 0, width, height);
      const t = coverTransform(
        { width, height },
        { width: image.naturalWidth, height: image.naturalHeight },
        focal
      );
      gl.uniform4f(cover, t.scaleX, t.scaleY, t.offsetX, t.offsetY);
      transform = t;
    }
    const elapsed = lastFrame ? Math.min(100, frame.now - lastFrame) : 0;
    lastFrame = frame.now;
    let amount = frame.hold;
    if (gesture.effect === "summon-spirits") {
      reveal = approach(reveal, frame.hold, elapsed, frame.hold > reveal ? 1400 : 1900);
      amount = reveal;
    } else if (gesture.effect === "turn-away") {
      if (turnAmount(frame.lean) >= turnDone) turned = true;
      amount = turned ? 1 : turnAmount(frame.lean);
    } else if (gesture.effect === "emerge-shadow") {
      const into = (frame.ms ?? 0) - scene.startMs - gesture.afterMs;
      const u = Math.max(0, Math.min(1, into / 5000));
      amount = u * u * (3 - 2 * u);
    } else if (wipe && input) {
      wipe.follow(input, sceneIndex, canvas, transform);
      gl.uniform1f(cleared, wipe.cleared());
    }
    gl.uniform1f(time, frame.time);
    gl.uniform1f(hold, amount);
    gl.uniform1f(lean, frame.lean);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  };

  return {
    paint,
    dispose: () => {
      wipe?.dispose();
      gl.deleteTexture(texture);
      gl.deleteBuffer(quad);
      gl.deleteProgram(program);
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
    },
  };
}

/**
 * Where the glass has been wiped: a small grey canvas the size of the glass,
 * white where a finger went, uploaded to texture unit 1 whenever it changes.
 * Nothing fades back - what has been cleared stays clear.
 */
function createMask(
  gl: WebGLRenderingContext,
  glass: { x: number; y: number; width: number; height: number },
  brush: number,
  image: HTMLImageElement
) {
  const width = 128;
  const height = Math.max(
    16,
    Math.round((width * glass.height * image.naturalHeight) / Math.max(1, glass.width * image.naturalWidth))
  );
  const mask = document.createElement("canvas");
  mask.width = width;
  mask.height = height;
  const ctx = mask.getContext("2d");
  const texture = gl.createTexture();
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  const upload = () => {
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, mask);
    gl.activeTexture(gl.TEXTURE0);
  };
  if (ctx) {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, width, height);
  }
  upload();

  const radius = Math.max(4, brush * width);
  let last: { x: number; y: number } | null = null;
  let stamps = 0;
  let coverage = 0;
  const stamp = (x: number, y: number) => {
    if (!ctx) return;
    const g = ctx.createRadialGradient(x, y, 0, x, y, radius);
    g.addColorStop(0, "rgba(255,255,255,0.9)");
    g.addColorStop(0.55, "rgba(255,255,255,0.55)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  };
  const measure = () => {
    if (!ctx) return;
    const data = ctx.getImageData(0, 0, width, height).data;
    let sum = 0;
    for (let i = 0; i < data.length; i += 16) sum += data[i];
    coverage = sum / ((data.length / 16) * 255);
  };

  return {
    /** Lays down the finger's path since the last frame, if it is on this picture. */
    follow(
      input: GestureInput,
      sceneIndex: number,
      canvas: HTMLCanvasElement,
      transform: ReturnType<typeof coverTransform>
    ) {
      // The glass keeps no list of strokes; a finger let go is simply over.
      for (let i = input.releases.length - 1; i >= 0; i -= 1) {
        if (input.releases[i].scene === sceneIndex) input.releases.splice(i, 1);
      }
      const drag = input.drag;
      if (!drag || drag.scene !== sceneIndex || !canvas.clientWidth || !canvas.clientHeight) {
        if (last) measure();
        last = null;
        return;
      }
      const onImage = screenToImage(
        { x: drag.x / canvas.clientWidth, y: drag.y / canvas.clientHeight },
        transform
      );
      const point = {
        x: ((onImage.x - glass.x) / glass.width) * width,
        y: ((onImage.y - glass.y) / glass.height) * height,
      };
      if (last && last.x === point.x && last.y === point.y) return;
      for (const at of wipeStamps(last, point, radius * 0.35)) stamp(at.x, at.y);
      last = point;
      stamps += 1;
      if (stamps % 12 === 0) measure();
      upload();
    },
    /** How much of the glass is clear, 0 to 1. */
    cleared: () => coverage,
    dispose: () => gl.deleteTexture(texture),
  };
}
