# Planet Octahedral Impostor Atlases

Offline-baked **8 × 8 hemi-octahedral impostor atlases** for Emperor's Reign's hosted planet GLB models (`C:\tmp\er-assets\planets\manifest.json`). Each species is baked from its normalized LOD0 GLB (exact `preparePlanetAsset` / Rule-7 scale and bottom-center pivot).

---

## 1. Files in this directory

| File | Contents |
| --- | --- |
| `impostors.json` | Master layout JSON: atlas dimensions, VRAM estimates, per-species pixel & UV rects, normalized bounds, pivot, bounding sphere (`sphereCenter`, `sphereRadius`), and `fitScale`. |
| `<Group>_albedo.png` | **sRGB** unlit base-color albedo (`RGB`) + crisp silhouette mask (`A`). Transparent pixels are dilated 6 px outward from opaque edges to prevent dark bilinear halos. |
| `<Group>_normal.png` | **Linear** object-space (model-space) unit normals (`RGB = n * 0.5 + 0.5`) perturbed by each GLB's tangent-space `normalMap`, plus matching alpha mask (`A`). Background pixels carry neutral `+Y` (`128, 255, 128, 0`) after 6 px edge dilation. |

Biome groups:
- `Earth_like_world` (`1024 × 1024`, 5 species, 10.67 MB GPU VRAM incl. mipmaps for albedo + normal)
- `Forest_world` (`1024 × 1024`, 5 species, 10.67 MB GPU VRAM)
- `Desert_world` (`1024 × 1024`, 5 species, 10.67 MB GPU VRAM)
- `Frozen_coast_world` (`1024 × 1024`, 5 species, 10.67 MB GPU VRAM)
- `Shared_Reusable_Assets` (`1024 × 1024`, 12 species, 10.67 MB GPU VRAM)

> **VRAM Budget**: Any single planet loads at most **2 biome atlas pairs** (its biome group + `Shared_Reusable_Assets`) = **21.33 MB** RGBA8 with full mipmaps (or **18.67 MB** with mipmaps disabled on the normal atlas as recommended below) — comfortably inside the **32 MB** impostor VRAM budget.
>
> **Un-premultiplied PNGs**: Both `<Group>_albedo.png` and `<Group>_normal.png` are encoded directly from un-premultiplied RGBA8 buffers (bypassing HTML5 2D Canvas premultiplication) so all 6 px of RGB & normal edge dilation into `alpha = 0` pixels stay intact and prevent dark silhouette rims under bilinear filtering. Keep `texture.premultiplyAlpha = false` when loading in Three.js.

---

## 2. Coordinate System, Pivot & Bounds

- Models are normalized identically to `preparePlanetAsset()` in `src/game/flora/assetRegistry.ts`:
  - Right-handed Y-up.
  - Bottom-center pivot at `(0, 0, 0)` (`min.y = 0`, `center.x = 0`, `center.z = 0`).
  - Uniformly scaled by `fitScale` to match `plannedAssetSize(id)` (in metres).
- **`sphereCenter`** lies strictly on the Y-axis: `[0, midY, 0]`, where `midY = 0.5 * (boundsMin.y + boundsMax.y)`. Because `x = 0, z = 0`, rotating an instance around Y (`instanceYaw`) leaves `sphereCenter` invariant!
- **`sphereRadius`** is the tight vertex bounding-sphere radius around `sphereCenter` multiplied by **`1.03`** (3% padding so silhouettes never clip cell borders).
- Each cell is baked with an **orthographic camera** of frustum `[-sphereRadius, +sphereRadius]` on both X and Y, positioned along the cell's unit view direction `d` with `up = (0, 1, 0)`.
- At runtime, place one camera-facing quad of world width & height **`2.0 * sphereRadius * instanceScale`** centered at:
  `instanceWorldPos + vec3(0.0, sphereCenter.y * instanceScale, 0.0)`.

---

## 3. Hemi-Octahedral Grid Mapping (`8 × 8`)

Each species occupies a square tile `uvRect = { u0, v0, u1, v1 }` (Three.js standard `flipY = true`, UV `(0, 0)` = bottom-left of PNG) subdivided into `grid = [8, 8]` cells (`ix, iy ∈ 0..7`):

- Hero species (trees & major outcrops/arches): `512 × 512 px` block -> **`64 × 64 px`** per view cell.
- Smaller plants / boulders: `256 × 256 px` block -> **`32 × 32 px`** per view cell.
- Cell `(ix, iy)` has `ix = 0..7` left-to-right and `iy = 0..7` **bottom-to-top in UV space**, matching Three.js's default `flipY = true` texture upload with **zero Y-inversion** in the shader!

### Exact Direction <-> Grid Formulas

```glsl
// Encode model-local unit view direction (from sphereCenter toward camera) -> [0, 1]^2
vec2 hemiOctaEncode(vec3 d) {
  d.y = max(0.0, d.y);
  float l1 = abs(d.x) + abs(d.y) + abs(d.z);
  vec2 p = vec2(d.x, d.z) / max(l1, 1e-6);
  vec2 e = vec2(p.x + p.y, p.x - p.y);
  return clamp(e * 0.5 + 0.5, 0.0, 1.0);
}

// Decode [0, 1]^2 -> upper-hemisphere unit view direction (used by baker)
vec3 hemiOctaDecode(vec2 uv) {
  vec2 e = uv * 2.0 - 1.0;
  vec2 t = vec2(e.x + e.y, e.x - e.y) * 0.5;
  float y = max(0.0, 1.0 - abs(t.x) - abs(t.y));
  return normalize(vec3(t.x, y, t.y));
}
```

---

## 4. Reference Instanced Shader (3-Frame Blend + Object-Space Relighting)

1. **Vertex shader (per instance)**:
   - Compute world billboard center `centerW = instancePos + vec3(0.0, sphereCenter.y * instanceScale, 0.0)`.
   - Compute world view vector `toCamW = normalize(cameraPosition - centerW)`.
   - Rotate `toCamW` by `-instanceYaw` into model-local space `toCamL` (`cos(-yaw)`, `sin(-yaw)` around Y).
   - Map `oct = hemiOctaEncode(toCamL) * (GRID - 1.0)`.
   - Split the quad `(floor(oct), floor(oct) + 1)` along the diagonal `f.x > f.y` into **3 cells** `(cellA, cellB, cellC)` with barycentric weights `vWeights` summing to `1.0`.
   - Expand quad vertices along world billboard basis:
     ```glsl
     vec3 upRef = abs(toCamW.y) > 0.995 ? vec3(0.0, 0.0, 1.0) : vec3(0.0, 1.0, 0.0);
     vec3 rightW = normalize(cross(upRef, toCamW));
     vec3 upW = normalize(cross(toCamW, rightW));
     vec3 worldPos = centerW + (rightW * local.x + upW * local.y) * (sphereRadius * instanceScale);
     ```

2. **Fragment shader**:
   - Clamp `quadUv` inside each cell by half a texel (`0.5 / cellPx`) so bilinear taps never bleed across adjacent octahedral views:
     ```glsl
     vec2 cellSampleUv(vec2 cellIdx, vec2 qUv, vec4 uvRect, float grid, float cellPx) {
       float pad = 0.5 / cellPx;
       vec2 safeUv = clamp(qUv, vec2(pad), vec2(1.0 - pad));
       vec2 cellSize = uvRect.zw / grid;
       return uvRect.xy + (cellIdx + safeUv) * cellSize;
     }
     ```
   - Blend alpha across the 3 cells (`alpha = aA*w.x + aB*w.y + aC*w.z`) and alpha-test (`if (alpha < 0.42) discard;`, or combine with screen-door dither cross-fade!).
   - Re-weight RGB & object-space normal samples smoothly by `wEff = vWeights * vec3(aA.a, aB.a, aC.a)` (normalized), normalize `nObj`, and relight against model-local `vSunDirL` & `vUpL` (rotated by `-instanceYaw` in the vertex shader — equivalent to rotating `nObj` by `+instanceYaw` into world space with zero fragment matrix cost!).
   - Relight with `lit = albedo * (hemi + uSunColor * max(dot(N, vSunDirL), 0.0)) / PI` (matching Three.js r170 `MeshStandardMaterial` diffuse under `DirectionalLight` + `HemisphereLight`), plus exponential + height fog (matching `surfaceSky.ts` and `terrain/material.ts`), followed by `#include <tonemapping_fragment>` and `#include <colorspace_fragment>`.
   - **Recommended texture settings**:
     - Albedo atlas: `SRGBColorSpace`, `premultiplyAlpha = false`, `LinearMipmapLinearFilter`, `generateMipmaps = true`, `anisotropy = 4`.
     - Normal atlas: `NoColorSpace`, `premultiplyAlpha = false`, `LinearFilter`, `generateMipmaps = false` (prevents normal-vector washout and cell bleed across coarse mips).

---

## 5. Visual Verification Viewer

Inspect any baked species next to its real LOD0 model from 8 angles + 600 m / 1,000 m distance using:
- `C:\tmp\er-wt\farprep\.er-sync\tools\impostor-viewer.html` (served via Vite or `impostor-viewer-shots.mjs`).
