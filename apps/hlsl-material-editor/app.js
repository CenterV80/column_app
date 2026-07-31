// Default HLSL template
const DEFAULT_SHADER = `// HLSL Material Shader Template
// Output: float4 color

float4 main(in float2 uv : TEXCOORD0) : SV_TARGET
{
    // Pre-built uniforms available:
    // uLightDir, uViewDir, uNormal, uTime, uMousePos

    // Example: Simple color based on UV
    float3 color = float3(uv, 0.5);

    // Example: Use time for animation
    color += float3(0.1 * sin(uTime), 0.1 * cos(uTime), 0.0);

    return float4(color, 1.0);
}`;

class HLSLEditor {
  constructor() {
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.mesh = null;
    this.material = null;
    this.startTime = Date.now();
    this.uniforms = {
      uLightDir: { value: new THREE.Vector3(0.577, 0.577, 0.577) },
      uViewDir: { value: new THREE.Vector3(0, 0, 1) },
      uNormal: { value: new THREE.Vector3(0, 0, 1) },
      uTime: { value: 0 },
      uMousePos: { value: new THREE.Vector2(0, 0) }
    };

    this.init();
  }

  init() {
    this.setupThreeJS();
    this.setupEditorEvents();
    this.setupControlsEvents();
    this.loadFromLocalStorage();
    this.compileAndRender();
    this.animate();
  }

  setupThreeJS() {
    const container = document.getElementById('canvas-container');
    const width = container.clientWidth;
    const height = container.clientHeight;

    // Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0.1, 0.1, 0.1);

    // Camera
    this.camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 1000);
    this.camera.position.z = 3;

    // Renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(this.renderer.domElement);

    // Lighting for scene context
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.3);
    this.scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.7);
    directionalLight.position.set(5, 5, 5);
    this.scene.add(directionalLight);

    // Default sphere mesh
    this.createMesh();

    // Handle window resize
    window.addEventListener('resize', () => this.onWindowResize());

    // Mouse interaction for mesh rotation
    let isDragging = false;
    let previousMousePosition = { x: 0, y: 0 };

    container.addEventListener('mousedown', (e) => {
      isDragging = true;
      previousMousePosition = { x: e.clientX, y: e.clientY };
    });

    container.addEventListener('mousemove', (e) => {
      if (isDragging && this.mesh) {
        const deltaX = e.clientX - previousMousePosition.x;
        const deltaY = e.clientY - previousMousePosition.y;
        this.mesh.rotation.y += deltaX * 0.01;
        this.mesh.rotation.x += deltaY * 0.01;
        previousMousePosition = { x: e.clientX, y: e.clientY };
      }
    });

    container.addEventListener('mouseup', () => {
      isDragging = false;
    });
  }

  createMesh() {
    if (this.mesh) {
      this.scene.remove(this.mesh);
    }

    const geometry = new THREE.SphereGeometry(1, 64, 64);
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: this.getVertexShader(),
      fragmentShader: this.getFragmentShader(),
      side: THREE.DoubleSide
    });

    this.mesh = new THREE.Mesh(geometry, this.material);
    this.scene.add(this.mesh);
  }

  getVertexShader() {
    return `
      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vPosition;

      void main() {
        vUv = uv;
        vNormal = normalize(normalMatrix * normal);
        vPosition = (modelMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `;
  }

  getFragmentShader() {
    const userCode = document.getElementById('codeEditor').value;
    const glslCode = this.hlslToGlsl(userCode);

    return `
      uniform vec3 uLightDir;
      uniform vec3 uViewDir;
      uniform vec3 uNormal;
      uniform float uTime;
      uniform vec2 uMousePos;

      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vPosition;

      // GLSL version of user code
      ${glslCode}

      void main() {
        vec4 result = main(vUv);
        gl_FragColor = result;
      }
    `;
  }

  hlslToGlsl(hlslCode) {
    // Basic HLSL to GLSL conversion for custom expressions
    let glslCode = hlslCode;

    // Replace HLSL keywords/types with GLSL
    glslCode = glslCode.replace(/float4/g, 'vec4');
    glslCode = glslCode.replace(/float3/g, 'vec3');
    glslCode = glslCode.replace(/float2/g, 'vec2');
    glslCode = glslCode.replace(/int4/g, 'ivec4');
    glslCode = glslCode.replace(/int3/g, 'ivec3');
    glslCode = glslCode.replace(/int2/g, 'ivec2');
    glslCode = glslCode.replace(/int\s/g, 'int ');

    // Replace HLSL syntax
    glslCode = glslCode.replace(/: TEXCOORD0/g, '');
    glslCode = glslCode.replace(/: TEXCOORD/g, '');
    glslCode = glslCode.replace(/: SV_TARGET/g, '');
    glslCode = glslCode.replace(/in\s+/g, '');
    glslCode = glslCode.replace(/\sin\s+/g, ' ');

    // Function signatures
    glslCode = glslCode.replace(/float4\s+main\s*\(\s*in\s+float2\s+uv/g, 'vec4 main(vec2 uv');
    glslCode = glslCode.replace(/float4\s+main\s*\(\s*float2\s+uv/g, 'vec4 main(vec2 uv');

    return glslCode;
  }

  compileAndRender() {
    try {
      const codeEditor = document.getElementById('codeEditor');
      const errorDisplay = document.getElementById('errorDisplay');

      // Recreate shader material
      this.material = new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: this.getVertexShader(),
        fragmentShader: this.getFragmentShader(),
        side: THREE.DoubleSide
      });

      if (this.mesh) {
        this.mesh.material = this.material;
      }

      // Clear error display
      errorDisplay.classList.remove('show');
      errorDisplay.textContent = '';

      this.saveToLocalStorage();
    } catch (error) {
      const errorDisplay = document.getElementById('errorDisplay');
      errorDisplay.textContent = `Compilation Error: ${error.message}`;
      errorDisplay.classList.add('show');
    }
  }

  setupEditorEvents() {
    const codeEditor = document.getElementById('codeEditor');
    const compileBtn = document.getElementById('compileBtn');
    const resetBtn = document.getElementById('resetBtn');

    // Load saved code or use default
    const saved = localStorage.getItem('hlsl-editor-code');
    codeEditor.value = saved || DEFAULT_SHADER;

    // Auto-compile on code change (debounced)
    let compileTimeout;
    codeEditor.addEventListener('input', () => {
      clearTimeout(compileTimeout);
      compileTimeout = setTimeout(() => this.compileAndRender(), 500);
    });

    // Manual compile button
    compileBtn.addEventListener('click', () => this.compileAndRender());

    // Reset button
    resetBtn.addEventListener('click', () => {
      if (confirm('Reset to default template?')) {
        codeEditor.value = DEFAULT_SHADER;
        this.compileAndRender();
      }
    });
  }

  setupControlsEvents() {
    // Light controls
    const lightX = document.getElementById('lightX');
    const lightY = document.getElementById('lightY');
    const timeScale = document.getElementById('timeScale');
    const rotationX = document.getElementById('rotationX');
    const rotationY = document.getElementById('rotationY');

    const updateLightDir = () => {
      const xRad = (lightX.value * Math.PI) / 180;
      const yRad = (lightY.value * Math.PI) / 180;
      this.uniforms.uLightDir.value = new THREE.Vector3(
        Math.sin(xRad) * Math.cos(yRad),
        Math.cos(xRad),
        Math.sin(yRad)
      );
    };

    lightX.addEventListener('input', (e) => {
      updateLightDir();
      document.getElementById('lightXValue').textContent = e.target.value + '°';
    });

    lightY.addEventListener('input', (e) => {
      updateLightDir();
      document.getElementById('lightYValue').textContent = e.target.value + '°';
    });

    timeScale.addEventListener('input', (e) => {
      document.getElementById('timeScaleValue').textContent = parseFloat(e.target.value).toFixed(1) + 'x';
    });

    rotationX.addEventListener('input', (e) => {
      if (this.mesh) {
        this.mesh.rotation.x = (e.target.value * Math.PI) / 180;
      }
      document.getElementById('rotationXValue').textContent = e.target.value + '°';
    });

    rotationY.addEventListener('input', (e) => {
      if (this.mesh) {
        this.mesh.rotation.y = (e.target.value * Math.PI) / 180;
      }
      document.getElementById('rotationYValue').textContent = e.target.value + '°';
    });

    // Initialize light direction
    updateLightDir();
  }

  animate = () => {
    requestAnimationFrame(this.animate);

    // Update time uniform
    const elapsed = (Date.now() - this.startTime) / 1000;
    const timeScale = parseFloat(document.getElementById('timeScale').value);
    this.uniforms.uTime.value = elapsed * timeScale;

    this.renderer.render(this.scene, this.camera);
  };

  onWindowResize() {
    const container = document.getElementById('canvas-container');
    const width = container.clientWidth;
    const height = container.clientHeight;

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  saveToLocalStorage() {
    const code = document.getElementById('codeEditor').value;
    localStorage.setItem('hlsl-editor-code', code);

    const params = {
      lightX: document.getElementById('lightX').value,
      lightY: document.getElementById('lightY').value,
      timeScale: document.getElementById('timeScale').value,
      rotationX: document.getElementById('rotationX').value,
      rotationY: document.getElementById('rotationY').value
    };
    localStorage.setItem('hlsl-editor-params', JSON.stringify(params));
  }

  loadFromLocalStorage() {
    const params = JSON.parse(localStorage.getItem('hlsl-editor-params') || '{}');
    if (params.lightX) document.getElementById('lightX').value = params.lightX;
    if (params.lightY) document.getElementById('lightY').value = params.lightY;
    if (params.timeScale) document.getElementById('timeScale').value = params.timeScale;
    if (params.rotationX) document.getElementById('rotationX').value = params.rotationX;
    if (params.rotationY) document.getElementById('rotationY').value = params.rotationY;

    // Trigger change events to update UI
    document.getElementById('lightX').dispatchEvent(new Event('input'));
    document.getElementById('lightY').dispatchEvent(new Event('input'));
    document.getElementById('timeScale').dispatchEvent(new Event('input'));
    document.getElementById('rotationX').dispatchEvent(new Event('input'));
    document.getElementById('rotationY').dispatchEvent(new Event('input'));
  }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  new HLSLEditor();
});
