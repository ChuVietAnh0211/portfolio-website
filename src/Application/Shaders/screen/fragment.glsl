#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform float u_time;

// Sine-free hash (Dave Hoskins, "Hash without Sine"): stable across GPUs,
// gives uniform white noise in [0, 1).
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float noise(vec2 xy, float seed) {
  // Offset the pixel lattice by a seed-dependent amount so every frame/channel
  // samples an unrelated region of the hash.
  return hash12(xy + seed * vec2(13.71, 27.93));
}

void main() {
  float seed = fract(u_time) * 100.0;
  gl_FragColor = vec4(noise(gl_FragCoord.xy, seed + 1.0),
                      noise(gl_FragCoord.xy, seed + 2.0),
                      noise(gl_FragCoord.xy, seed + 3.0), 0.01);
}
