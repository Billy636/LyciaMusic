export interface FlowFieldRenderer {
  resize(width: number, height: number): void;
  render(timeSeconds: number, colors: Float32Array, dark: boolean): void;
  dispose(): void;
}

const MAX_RENDER_SIDE = 640;
const MOTION_PERIOD_SECONDS = 600;
const TAU = Math.PI * 2;

const VERTEX_SOURCE = `
attribute vec2 aPosition;
varying mediump vec2 vUv;

void main() {
  vUv = aPosition * 0.5 + 0.5;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

const FRAGMENT_SOURCE = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

varying mediump vec2 vUv;
uniform vec2 uResolution;
uniform float uPhase;
uniform float uDark;
uniform vec3 uColors[4];

void main() {
  float y = 1.0 - vUv.y;
  float aspect = uResolution.x / uResolution.y;

  // This is a full color field, not a luminous line on an empty background.
  // Three ordered S boundaries divide four broad, continuously colored regions.
  float bend = 0.34 * sin(uPhase * 5.0) + 0.12 * sin(uPhase * 3.0);
  float amplitude = mix(0.21, 0.29, smoothstep(0.8, 1.8, aspect))
    + 0.035 * sin(uPhase * 4.0);
  float wave = amplitude * sin((y - 0.10) * 5.6 + bend)
    + 0.032 * sin(y * 10.0 - uPhase * 6.0);
  float field = vUv.x - wave + 0.045 * sin(uPhase * 2.0);

  // Spacing always exceeds the boundary offsets. Equal softness preserves
  // a >= b >= c, so all four weights are nonnegative and sum to exactly one.
  float softness = 0.135 + 0.018 * sin(y * 4.0 - uPhase * 7.0);
  float edgeA = 0.18 + 0.025 * sin(y * 5.0 + uPhase * 4.0);
  float edgeB = 0.51 + 0.035 * sin(y * 4.0 - uPhase * 5.0);
  float edgeC = 0.84 + 0.025 * sin(y * 6.0 + uPhase * 3.0);
  float a = smoothstep(edgeA - softness, edgeA + softness, field);
  float b = smoothstep(edgeB - softness, edgeB + softness, field);
  float c = smoothstep(edgeC - softness, edgeC + softness, field);
  vec4 weights = vec4(1.0 - a, a - b, b - c, c);

  // A second, slow motion moves subtle color and light along the boundaries;
  // the S deformation above remains independent of that longitudinal flow.
  float travel = 0.5 + 0.5 * sin(y * 4.6 - uPhase * 10.0 + field * 1.4);
  float undertone = 0.06 + 0.10 * travel;
  vec3 regionA = mix(uColors[0], uColors[3], undertone);
  vec3 regionB = mix(uColors[1], uColors[0], undertone);
  vec3 regionC = mix(uColors[2], uColors[1], undertone);
  vec3 regionD = mix(uColors[3], uColors[2], undertone);
  vec3 source = regionA * weights.x + regionB * weights.y
    + regionC * weights.z + regionD * weights.w;

  // Restrained folds add depth, not extra particles, glow layers or blur passes.
  float folds = (a * (1.0 - a) + b * (1.0 - b) + c * (1.0 - c)) * 4.0;
  float illumination = (travel - 0.5) * 0.045 + folds * 0.025 * travel;
  vec3 lightColor = mix(vec3(0.965), source, 0.38) + illumination;
  vec3 darkColor = source * (0.40 + illumination) + vec3(0.022);
  // Neutral theme mapping also keeps genuinely monochrome covers monochrome.
  gl_FragColor = vec4(clamp(mix(lightColor, darkColor, uDark), 0.0, 1.0), 1.0);
}
`;

/** One bounded, opaque surface; no DPR scaling, textures, blur, or extra passes. */
export function createFlowFieldRenderer(canvas: HTMLCanvasElement): FlowFieldRenderer | null {
  let gl: WebGLRenderingContext | null;
  try {
    gl = canvas.getContext('webgl', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: false,
      powerPreference: 'low-power',
      failIfMajorPerformanceCaveat: true,
    });
  } catch {
    return null;
  }
  if (!gl) return null;

  const context = gl;
  const shaders: WebGLShader[] = [];
  let program: WebGLProgram | null = null;
  let buffer: WebGLBuffer | null = null;
  let disposed = false;

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    shaders.forEach(shader => context.deleteShader(shader));
    shaders.length = 0;
    if (buffer) context.deleteBuffer(buffer);
    if (program) context.deleteProgram(program);
    buffer = null;
    program = null;
    if (!context.isContextLost()) {
      context.getExtension('WEBGL_lose_context')?.loseContext();
    }
  };

  const compileShader = (type: number, source: string): WebGLShader | null => {
    const shader = context.createShader(type);
    if (!shader) return null;
    shaders.push(shader);
    context.shaderSource(shader, source);
    context.compileShader(shader);
    return context.getShaderParameter(shader, context.COMPILE_STATUS) ? shader : null;
  };

  const vertex = compileShader(context.VERTEX_SHADER, VERTEX_SOURCE);
  const fragment = compileShader(context.FRAGMENT_SHADER, FRAGMENT_SOURCE);
  program = context.createProgram();
  if (!vertex || !fragment || !program) {
    dispose();
    return null;
  }

  context.attachShader(program, vertex);
  context.attachShader(program, fragment);
  context.linkProgram(program);
  if (!context.getProgramParameter(program, context.LINK_STATUS)) {
    dispose();
    return null;
  }

  const position = context.getAttribLocation(program, 'aPosition');
  const resolution = context.getUniformLocation(program, 'uResolution');
  const phase = context.getUniformLocation(program, 'uPhase');
  const paletteColors = context.getUniformLocation(program, 'uColors[0]');
  const darkMode = context.getUniformLocation(program, 'uDark');
  buffer = context.createBuffer();
  if (position < 0 || !resolution || !phase || !paletteColors || !darkMode || !buffer) {
    dispose();
    return null;
  }

  context.useProgram(program);
  context.bindBuffer(context.ARRAY_BUFFER, buffer);
  context.bufferData(context.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), context.STATIC_DRAW);
  context.enableVertexAttribArray(position);
  context.vertexAttribPointer(position, 2, context.FLOAT, false, 0, 0);
  context.disable(context.BLEND);
  context.disable(context.DEPTH_TEST);
  context.disable(context.STENCIL_TEST);
  // Linked programs retain their compiled code; shader handles need not linger.
  shaders.forEach(shader => {
    context.detachShader(program!, shader);
    context.deleteShader(shader);
  });
  shaders.length = 0;

  const resize = (width: number, height: number) => {
    if (disposed) return;
    const safeWidth = Number.isFinite(width) ? Math.max(1, width) : 1;
    const safeHeight = Number.isFinite(height) ? Math.max(1, height) : 1;
    const scale = Math.min(1, MAX_RENDER_SIDE / Math.max(safeWidth, safeHeight));
    const renderWidth = Math.max(1, Math.round(safeWidth * scale));
    const renderHeight = Math.max(1, Math.round(safeHeight * scale));
    if (canvas.width !== renderWidth) canvas.width = renderWidth;
    if (canvas.height !== renderHeight) canvas.height = renderHeight;
    context.viewport(0, 0, renderWidth, renderHeight);
    context.uniform2f(resolution, renderWidth, renderHeight);
  };

  resize(canvas.width, canvas.height);

  return {
    resize,
    render(timeSeconds, colors, dark) {
      if (disposed || context.isContextLost() || colors.length < 12) return;
      // Every temporal frequency is an integer harmonic of this phase. Wrapping
      // is seamless, and even mediump devices never receive a growing timestamp.
      const seconds = Number.isFinite(timeSeconds) ? timeSeconds : 0;
      const wrappedSeconds = ((seconds % MOTION_PERIOD_SECONDS) + MOTION_PERIOD_SECONDS) % MOTION_PERIOD_SECONDS;
      context.uniform1f(phase, wrappedSeconds / MOTION_PERIOD_SECONDS * TAU);
      context.uniform3fv(paletteColors, colors.length === 12 ? colors : colors.subarray(0, 12));
      context.uniform1f(darkMode, dark ? 1 : 0);
      context.drawArrays(context.TRIANGLES, 0, 3);
    },
    dispose,
  };
}
