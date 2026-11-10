/**
 * The author stage's cloth: one WebGL fragment shader folds a single velvet
 * photograph into a curtain gathered at the yellow ribbon, along the geometry
 * of `curtain-shape.ts`. Drawn only when asked (`render`), never in a loop of
 * its own. Loaded after first paint; without WebGL the stage keeps the CSS
 * velvet.
 */
import { BEND_RADIUS, CURTAIN_TIE_Y, clamp, curtainShape, narrowStage } from "./curtain-shape";

export const velvetUrl = "/share/curtain/stage/velvet.webp";

const vertexSource = `
  attribute vec2 aPosition;
  varying vec2 vUv;

  void main() {
    vUv = aPosition * vec2(.5, -.5) + .5;
    gl_Position = vec4(aPosition, 0.0, 1.0);
  }
`;

const fragmentSource = `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uVelvet;
  uniform vec2 uStageSize;
  uniform vec3 uShape;
  uniform float uMobile;
  uniform float uOpen;
  uniform float uPull;

  const float tieY = ${CURTAIN_TIE_Y};
  const float bendRadius = ${BEND_RADIUS};

  float gaussian(float x) {
    return exp(-x * x);
  }

  void main() {
    float width = uStageSize.x;
    float height = uStageSize.y;
    float x = vUv.x * width;
    float dyUnit = vUv.y - tieY;
    float heightFraction = dyUnit / (dyUnit > 0.0 ? 1.0 - tieY : tieY);
    float bendSquared = bendRadius * bendRadius;
    float bend = (sqrt(heightFraction * heightFraction + bendSquared) - bendRadius)
      / (sqrt(1.0 + bendSquared) - bendRadius);
    float closure = .24 * (1.0 - uOpen);
    float flare = (dyUnit > 0.0 ? uShape.z : uShape.y) * bend
      * (1.0 + closure * bend) / (1.0 + closure);
    float edge = uShape.x + flare;
    float edgeDistance = x - edge;
    float sceneScale = clamp(max(width / 1920.0, height / 1008.0), .55, 1.25);
    float distanceOnPlate = edgeDistance / sceneScale;
    float shadow = .23 * uOpen * gaussian(max(distanceOnPlate - 3.0, 0.0) / 9.5);

    if (distanceOnPlate > 27.0) {
      gl_FragColor = vec4(0.0);
      return;
    }

    // Deep-quarter mapping. Invert x = base * u + flare * u² so the inside
    // pleats stay straighter while the outside fabric gathers into the tie.
    float overhang = width * (64.0 / 1920.0);
    float base = uShape.x + overhang;
    float localX = clamp(x, -overhang, edge) + overhang;
    float u = 2.0 * localX / (base + sqrt(base * base + 4.0 * flare * localX));
    float pinch = .85 + .15 * uPull;
    float dy = dyUnit * 1008.0;
    float tension = gaussian(dy / mix(185.0, 140.0, pinch));
    float compression = uOpen * (.10 + (.26 + .30 * pinch) * tension);
    float materialU = u - compression * u * (1.0 - u);

    // Reuse the source plate's crop on desktop and fewer pleats on narrow
    // screens. The fold shear uses the original plate's pixel coordinates.
    float materialX = mix(-64.0, 1996.8, materialU);
    materialX = mix(materialX, mix(235.0, 1700.0, materialU), uMobile);
    float y = vUv.y * 1008.0;
    float phase = .049 * materialX + .34 * sin(.011 * materialX) + .0021 * y;
    float wave = cos(phase);
    float shear = (.10 + .11 * pinch) * dy * u * u * tension;
    float wrinkles = (3.5 + 4.0 * pinch) * wave * tension * sin(u * 3.141593);
    float materialY = y + uOpen * (shear + wrinkles);
    vec2 materialUV = (vec2(materialX, materialY) + vec2(91.2, 171.52)) / vec2(2400.0, 1600.0);
    vec3 texel = texture2D(uVelvet, materialUV).rgb;

    float tuck = tension * gaussian((distanceOnPlate + 26.0) / 34.0) * (.11 + .09 * pinch);
    float roll = .15 * gaussian((distanceOnPlate + 4.8) / 5.7);
    float light = 1.0 + uOpen * (.07 * wave * tension * u - tuck + roll);
    vec3 velvet = min(texel * light, vec3(1.0));
    float coverage = 1.0 - smoothstep(-.65, .65, edgeDistance);
    gl_FragColor = vec4(velvet * coverage, coverage + (1.0 - coverage) * shadow);
  }
`;

function compile(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader) ?? "shader");
  }
  return shader;
}

function makeScene(gl: WebGLRenderingContext) {
  const program = gl.createProgram()!;
  const vertex = compile(gl, gl.VERTEX_SHADER, vertexSource);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, fragmentSource);
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program) ?? "program");
  }
  gl.useProgram(program);

  const triangle = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, triangle);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, 'aPosition');
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  const anisotropy = gl.getExtension('EXT_texture_filter_anisotropic');
  if (anisotropy) {
    const limit = gl.getParameter(anisotropy.MAX_TEXTURE_MAX_ANISOTROPY_EXT);
    gl.texParameterf(gl.TEXTURE_2D, anisotropy.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(4, limit));
  }
  gl.uniform1i(gl.getUniformLocation(program, 'uVelvet'), 0);
  return {
    size: gl.getUniformLocation(program, 'uStageSize'),
    shape: gl.getUniformLocation(program, 'uShape'),
    mobile: gl.getUniformLocation(program, 'uMobile'),
    open: gl.getUniformLocation(program, 'uOpen'),
    pull: gl.getUniformLocation(program, 'uPull'),
  };
}

export type Curtain = {
  /** Resolves true once the velvet is on the GPU, false if it never will be. */
  ready: Promise<boolean>;
  render(fraction: number, tension?: number): void;
  destroy(): void;
};

export function createCurtain(canvas: HTMLCanvasElement, stage: HTMLElement): Curtain | null {
  const gl = canvas.getContext("webgl", {
    alpha: true,
    antialias: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: true,
    powerPreference: "low-power",
  });
  if (!gl) return null;

  let scene: ReturnType<typeof makeScene>;
  try {
    scene = makeScene(gl);
  } catch {
    return null;
  }

  let image: HTMLCanvasElement | null = null;
  let usable = false;
  let destroyed = false;
  let open = 0;
  let pull = 0;
  let size: { width: number; height: number } | null = null;

  function draw() {
    if (!usable || !size || destroyed || gl!.isContextLost()) return;
    const { width, height } = size;
    const { edge, upperFlare, lowerFlare } = curtainShape(open, width, height);
    gl!.uniform2f(scene.size, width, height);
    gl!.uniform3f(scene.shape, edge, upperFlare, lowerFlare);
    gl!.uniform1f(scene.mobile, narrowStage(width, height));
    gl!.uniform1f(scene.open, open);
    gl!.uniform1f(scene.pull, pull);
    gl!.drawArrays(gl!.TRIANGLES, 0, 3);
    if (!canvas.hasAttribute("data-rendered")) canvas.setAttribute("data-rendered", "");
  }

  function resize() {
    const { width, height } = stage.getBoundingClientRect();
    if (!width || !height) return;
    size = { width, height };
    // Bound fill rate on dense phone screens and large desktop windows.
    const ratio = Math.min(devicePixelRatio || 1, 1.6, Math.sqrt(2_400_000 / (width * height)));
    canvas.width = Math.max(1, Math.round(width * ratio));
    canvas.height = Math.max(1, Math.round(height * ratio));
    gl!.viewport(0, 0, canvas.width, canvas.height);
    draw();
  }

  function upload() {
    if (!image) return;
    gl!.texImage2D(gl!.TEXTURE_2D, 0, gl!.RGB, gl!.RGB, gl!.UNSIGNED_BYTE, image);
    gl!.generateMipmap(gl!.TEXTURE_2D);
    usable = true;
    resize();
  }

  const onLost = (event: Event) => {
    event.preventDefault();
    usable = false;
    canvas.removeAttribute("data-rendered");
  };
  const onRestored = () => {
    try {
      scene = makeScene(gl);
      upload();
    } catch {
      canvas.removeAttribute("data-rendered");
    }
  };
  canvas.addEventListener("webglcontextlost", onLost);
  canvas.addEventListener("webglcontextrestored", onRestored);
  const observer = new ResizeObserver(resize);
  observer.observe(stage);

  const ready = new Promise<boolean>((resolve) => {
    const velvet = new Image();
    velvet.decoding = "async";
    velvet.onload = () => {
      if (destroyed) return resolve(false);
      // WebGL 1 needs powers of two for mipmaps, which keep the folds from
      // flickering as the material gathers into a narrow strip.
      const mipSource = document.createElement("canvas");
      mipSource.width = 2048;
      mipSource.height = 1024;
      const context = mipSource.getContext("2d");
      if (!context) return resolve(false);
      context.drawImage(velvet, 0, 0, mipSource.width, mipSource.height);
      image = mipSource;
      if (!gl.isContextLost()) upload();
      resolve(usable);
    };
    velvet.onerror = () => resolve(false);
    velvet.src = velvetUrl;
  });

  return {
    ready,
    render(fraction, tension = 0) {
      open = clamp(fraction);
      pull = clamp(tension);
      draw();
    },
    destroy() {
      destroyed = true;
      observer.disconnect();
      canvas.removeEventListener("webglcontextlost", onLost);
      canvas.removeEventListener("webglcontextrestored", onRestored);
      // Give the GPU memory back now rather than at garbage collection.
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}
