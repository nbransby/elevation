import { Color, ShaderMaterial, type IUniform } from "three";

// Flat, paper-like shading. Box faces have constant normals, so each face gets one tone: tops
// lightest, then fronts, then sides. Committed rooms get world-space diagonal hatching.

const LIGHT_DIR = "normalize(vec3(0.35, 1.0, 0.55))";

const surfaceVertex = /* glsl */ `
  varying vec3 vWorld;
  varying vec3 vNormalW;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const surfaceFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uPaper;
  uniform float uOpacity;
  uniform float uHatch;
  uniform float uHatchScale;
  varying vec3 vWorld;
  varying vec3 vNormalW;
  void main() {
    float shade = 0.78 + 0.22 * clamp(dot(normalize(vNormalW), ${LIGHT_DIR}), 0.0, 1.0);
    vec3 color = uColor;
    if (uHatch > 0.001) {
      float s = (vWorld.x + vWorld.y + vWorld.z) * uHatchScale;
      float f = fract(s);
      float w = fwidth(s);
      float stripe = smoothstep(0.5 - w, 0.5 + w, f) * (1.0 - smoothstep(1.0 - w, 1.0, f));
      color = mix(color, mix(uColor, uPaper, 0.72), uHatch * stripe);
    }
    gl_FragColor = vec4(color * shade, uOpacity);
    #include <colorspace_fragment>
  }
`;

const pipeVertex = /* glsl */ `
  attribute float aDist;
  varying float vDist;
  varying vec3 vNormalW;
  void main() {
    vDist = aDist;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
  }
`;

const pipeFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uDash;
  uniform float uDashSize;
  varying float vDist;
  varying vec3 vNormalW;
  void main() {
    if (uDash > 0.5 && fract(vDist / uDashSize) > 0.55) discard;
    float shade = 0.72 + 0.28 * clamp(dot(normalize(vNormalW), ${LIGHT_DIR}), 0.0, 1.0);
    gl_FragColor = vec4(uColor * shade, uOpacity);
    #include <colorspace_fragment>
  }
`;

export interface SurfaceUniforms {
  [name: string]: IUniform;
  uColor: IUniform<Color>;
  uPaper: IUniform<Color>;
  uOpacity: IUniform<number>;
  uHatch: IUniform<number>;
  uHatchScale: IUniform<number>;
}

export interface PipeUniforms {
  [name: string]: IUniform;
  uColor: IUniform<Color>;
  uOpacity: IUniform<number>;
  uDash: IUniform<number>;
  uDashSize: IUniform<number>;
}

export type SurfaceMaterial = ShaderMaterial & { uniforms: SurfaceUniforms };
export type PipeMaterial = ShaderMaterial & { uniforms: PipeUniforms };

/** One material per room (each tweens its own colour); all share one compiled program. */
export function createSurfaceMaterial(): SurfaceMaterial {
  return new ShaderMaterial({
    vertexShader: surfaceVertex,
    fragmentShader: surfaceFragment,
    uniforms: {
      uColor: { value: new Color() },
      uPaper: { value: new Color() },
      uOpacity: { value: 1 },
      uHatch: { value: 0 },
      uHatchScale: { value: 1 / 0.32 },
    },
    transparent: true,
    // Pushes faces back a little so the outline edges win the depth test.
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  }) as SurfaceMaterial;
}

export function createPipeMaterial(): PipeMaterial {
  return new ShaderMaterial({
    vertexShader: pipeVertex,
    fragmentShader: pipeFragment,
    uniforms: {
      uColor: { value: new Color() },
      uOpacity: { value: 1 },
      uDash: { value: 0 },
      uDashSize: { value: 0.3 },
    },
    transparent: true,
  }) as PipeMaterial;
}
