// A gentle wind on instanced grass and wildflowers: a vertex offset that grows with height. Shared uniforms; the
// world sets uTime each frame and uSway to 0 in calm mode / reduced motion.
import * as THREE from 'three';

export const SWAY = { uTime: { value: 0 }, uSway: { value: 1 } };

export function addSway(m: THREE.Material) {
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = SWAY.uTime; sh.uniforms.uSway = SWAY.uSway;
    sh.vertexShader = 'uniform float uTime;\nuniform float uSway;\n' + sh.vertexShader.replace('#include <project_vertex>', `
      vec4 mvPosition = vec4( transformed, 1.0 );
      #ifdef USE_INSTANCING
        mvPosition = instanceMatrix * mvPosition;
      #endif
      float hgt = max( 0.0, mvPosition.y );
      mvPosition.x += sin( uTime * 1.6 + mvPosition.x * 0.35 + mvPosition.z * 0.25 ) * 0.09 * hgt * uSway;
      mvPosition.z += cos( uTime * 1.2 + mvPosition.x * 0.3 ) * 0.05 * hgt * uSway;
      mvPosition = modelViewMatrix * mvPosition;
      gl_Position = projectionMatrix * mvPosition;`);
  };
  m.customProgramCacheKey = () => 'sway';
}
