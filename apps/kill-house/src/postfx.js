import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { SSAOPass } from "three/addons/postprocessing/SSAOPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    time: { value: 0 },
    aberration: { value: 0.0006 },
    grainAmount: { value: 0.022 },
    vignetteStrength: { value: 0.28 },
    lowHealth: { value: 0.0 },
    enabled: { value: 1.0 },
    resolution: { value: new THREE.Vector2(1, 1) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float time;
    uniform float aberration;
    uniform float grainAmount;
    uniform float vignetteStrength;
    uniform float lowHealth;
    uniform float enabled;
    uniform vec2 resolution;
    varying vec2 vUv;

    float rand(vec2 co) { return fract(sin(dot(co, vec2(12.9898,78.233))) * 43758.5453); }

    void main() {
      vec2 uv = vUv;
      vec2 centered = uv - 0.5;
      float dist = length(centered);

      if (enabled > 0.5) {
        float ab = aberration * (0.4 + dist * 1.6);
        vec2 dir = normalize(centered + 0.0001);
        float r = texture2D(tDiffuse, uv - dir * ab).r;
        float g = texture2D(tDiffuse, uv).g;
        float b = texture2D(tDiffuse, uv + dir * ab).b;
        vec3 color = vec3(r, g, b);

        float vig = smoothstep(0.85, 0.25, dist * (1.0 + vignetteStrength));
        color *= mix(vig, 1.0, 1.0 - vignetteStrength);

        float grain = (rand(uv * resolution.xy + fract(time) * 100.0) - 0.5) * grainAmount;
        color += grain;

        float pulse = (sin(time * 6.0) * 0.5 + 0.5) * lowHealth;
        color = mix(color, vec3(0.55, 0.05, 0.05) + color * 0.6, pulse * 0.35);
        float redVig = smoothstep(0.75, 0.1, dist) ;
        color = mix(color, color * vec3(1.3,0.7,0.7), lowHealth * (1.0 - redVig) * 0.6);

        gl_FragColor = vec4(color, 1.0);
      } else {
        gl_FragColor = texture2D(tDiffuse, uv);
      }
    }
  `,
};

export function createPostFX(renderer, scene, camera, sizes) {
  const composer = new EffectComposer(renderer);
  composer.setSize(sizes.width, sizes.height);
  composer.setPixelRatio(renderer.getPixelRatio());

  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);

  const ssaoPass = new SSAOPass(scene, camera, sizes.width, sizes.height);
  ssaoPass.kernelRadius = 5;
  ssaoPass.minDistance = 0.0018;
  ssaoPass.maxDistance = 0.09;
  ssaoPass.output = SSAOPass.OUTPUT.Default;
  composer.addPass(ssaoPass);

  const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(sizes.width, sizes.height),
    0.55, 0.55, 0.72
  );
  composer.addPass(bloomPass);

  const gradePass = new ShaderPass(GradeShader);
  gradePass.uniforms.resolution.value.set(sizes.width, sizes.height);
  composer.addPass(gradePass);

  function setSize(w, h) {
    composer.setSize(w, h);
    ssaoPass.setSize(w, h);
    gradePass.uniforms.resolution.value.set(w, h);
  }

  function setQuality({ ssao, bloom, grain }) {
    ssaoPass.enabled = ssao;
    bloomPass.enabled = bloom;
    gradePass.uniforms.enabled.value = grain ? 1.0 : 0.0;
  }

  return { composer, ssaoPass, bloomPass, gradePass, setSize, setQuality };
}
