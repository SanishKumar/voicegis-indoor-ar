import type { MeshStandardMaterial } from 'three';

/** Metre-scale surface finishes. Pixel derivatives fade the fine detail out
 * when it would alias at campus scale. No texture fetch or extra draw call. */
const finishes = {
  timber: `
    float row = floor(vFinishPlan.y / 0.19);
    vec2 cell = vec2(vFinishPlan.x / 1.85 + mod(row, 3.0) / 3.0, vFinishPlan.y / 0.19);
    vec2 dist = abs(fract(cell - 0.5) - 0.5);
    vec2 px = max(fwidth(cell), vec2(0.001));
    vec2 seam = 1.0 - smoothstep(vec2(0.008), vec2(0.008) + px, dist);
    float lod = 1.0 - smoothstep(0.12, 0.55, max(px.x, px.y));
    float grain = sin(vFinishPlan.y * 66.0 + sin(vFinishPlan.x * 1.8));
    diffuseColor.rgb *= 1.0 + lod * (0.034 * grain - 0.17 * max(seam.x, seam.y));
  `,
  sheet: `
    float speckle = sin(dot(vFinishPlan, vec2(23.1, 16.7))) * sin(dot(vFinishPlan, vec2(18.1, -27.1)));
    float lod = 1.0 - smoothstep(0.025, 0.12, length(fwidth(vFinishPlan)));
    diffuseColor.rgb *= 0.985 + 0.055 * speckle * lod;
  `,
  tile: `
    vec2 cell = vFinishPlan / 0.9;
    vec2 pixel = max(fwidth(cell), vec2(0.001));
    vec2 joint = abs(fract(cell - 0.5) - 0.5);
    vec2 line = 1.0 - smoothstep(vec2(0.006), vec2(0.006) + pixel, joint);
    float lod = 1.0 - smoothstep(0.15, 0.48, max(pixel.x,pixel.y));
    float variation = fract(sin(dot(floor(cell),vec2(41.7,15.9))) * 1173.52);
    diffuseColor.rgb *= 1.0 - lod * (0.23 * max(line.x,line.y) + 0.065 * variation);
  `,
  lawn: `
    float cut = sin(vFinishPlan.y * 0.85 + vFinishPlan.x * 0.11);
    float grass = sin(vFinishPlan.x * 1.27 + sin(vFinishPlan.y * 1.8)) * cos(vFinishPlan.y * 0.64);
    diffuseColor.rgb *= 0.92 + cut * 0.055 + grass * 0.055;
  `,
  foliage: `
    vec3 p = vec3(vFinishPlan.x, vFinishHeight, vFinishPlan.y);
    float clump = sin(dot(p, vec3(6.8, 5.1, 2.3)) + sin(dot(p, vec3(2.1, 7.2, 3.7))));
    float leaf = sin(dot(p, vec3(21.2, 11.0, 14.7))) * sin(dot(p, vec3(8.1, 16.2, 9.8)));
    float px = max(length(dFdx(p)), length(dFdy(p)));
    diffuseColor.rgb *= 0.93 + (1.0 - smoothstep(0.16, 0.7, px)) * 0.13 * clump
      + (1.0 - smoothstep(0.05, 0.22, px)) * leaf * 0.15;
  `,
  water: `
    vec2 p = vFinishPlan;
    float ripple = sin(p.x * 1.4 + p.y * 2.7 + sin(p.y * 0.5));
    diffuseColor.rgb *= 0.96 + 0.11 * ripple * (1.0 - smoothstep(0.2, 0.7, length(fwidth(p))));
  `,
  masonry: `
    float along = vFinishPlan.x + vFinishPlan.y;
    float row = floor(vFinishHeight / 0.34);
    vec2 cell = vec2(along / 1.15 + mod(row, 2.0) * 0.5, vFinishHeight / 0.34);
    vec2 d = abs(fract(cell - 0.5) - 0.5);
    vec2 px = max(fwidth(cell), vec2(0.001));
    vec2 mortar = 1.0 - smoothstep(vec2(0.012), vec2(0.012) + px, d);
    float lod = 1.0 - smoothstep(0.18, 0.6, max(px.x, px.y));
    diffuseColor.rgb *= 1.0 - 0.16 * max(mortar.x, mortar.y) * lod;
  `,
  glazing: `
    float sky = smoothstep(-0.42, 0.48, vFinishHeight);
    diffuseColor.rgb *= mix(vec3(0.68, 0.74, 0.76), vec3(1.1, 1.14, 1.15), sky);
  `,
  roof: `
    vec2 cell = vFinishPlan / vec2(1.15,6.8);
    vec2 joint = abs(fract(cell - 0.5) - 0.5);
    vec2 pixel = max(fwidth(cell), vec2(0.001));
    vec2 line = 1.0 - smoothstep(vec2(0.007),vec2(0.007)+pixel,joint);
    float lod = 1.0 - smoothstep(0.17,0.5,max(pixel.x,pixel.y));
    float weather = sin(vFinishPlan.x * 0.65 + sin(vFinishPlan.y)) * cos(vFinishPlan.y * 0.4);
    diffuseColor.rgb *= 0.95 + 0.035 * weather - 0.26 * max(line.x,line.y) * lod;
  `,
};

export function withFinish(material: MeshStandardMaterial, finish: keyof typeof finishes) {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec2 vFinishPlan;\nvarying float vFinishHeight;',
      )
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvFinishPlan = position.xz;\nvFinishHeight = position.y;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec2 vFinishPlan;\nvarying float vFinishHeight;',
      )
      .replace('#include <color_fragment>', '#include <color_fragment>\n' + finishes[finish]);
  };
  material.customProgramCacheKey = () => 'architectural-' + finish;
  return material;
}
