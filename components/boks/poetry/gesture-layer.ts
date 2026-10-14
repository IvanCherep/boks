import { coverTransform, type WaterHold, type DragGesture } from "@/lib/boks/poetry/gesture";

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
 * Both effects in one program, picked by `u_kind`, so a poem never compiles
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
 */
const fragmentSource = `
precision mediump float;
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

void main() {
  vec2 uv = v_screen * u_cover.xy + u_cover.zw;
  vec3 tint = vec3(1.0);
  float light = 1.0;
  float drain = 0.0;

  if (u_kind == 0) {
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
  gl_FragColor = vec4(colour * tint * light, 1.0);
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
  gesture: WaterHold | DragGesture,
  focal: { x: number; y: number }
): GestureLayer | null {
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
  if (gesture.effect === "converge-reflections") {
    gl.uniform1i(at("u_kind"), 0);
    gl.uniform4f(at("u_water"), gesture.waterline, gesture.pull, gesture.ripple, 0);
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
  const paint = (frame: GestureFrame) => {
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
    }
    gl.uniform1f(time, frame.time);
    gl.uniform1f(hold, frame.hold);
    gl.uniform1f(lean, frame.lean);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  };

  return {
    paint,
    dispose: () => {
      gl.deleteTexture(texture);
      gl.deleteBuffer(quad);
      gl.deleteProgram(program);
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
    },
  };
}
