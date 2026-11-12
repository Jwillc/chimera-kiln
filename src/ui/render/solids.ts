/**
 * Lit surfaces in 3D: the solid twin of the beams kit (beams3d.ts), for a view that wants skin
 * and cloth over its wireframes. Each frame the renderer begins, adds shapes (the same centre
 * lines and rings the wire kit draws) in a colour, and ends; everything goes into one mesh.
 *
 * Lofts share their vertices, so limbs shade smoothly; quads and boxes do not, so furniture keeps
 * its edges. Both faces are lit, so a shape's winding does not matter (unless the kit is given
 * an inside). The surfaces sit a little
 * behind their true depth, so a wire drawn along one of their edges stays in front of it.
 */
import * as THREE from "three";

type V3 = [number, number, number];

const rgbCache = new Map<string, V3>();
function rgb(hex: string): V3 {
  let c = rgbCache.get(hex);
  if (!c) {
    const v = parseInt(hex.slice(1), 16);
    c = [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
    rgbCache.set(hex, c);
  }
  return c;
}

/** the material every lit surface of a wire scene uses */
export function solidMaterial(side: THREE.Side = THREE.DoubleSide): THREE.MeshLambertMaterial {
  const m = new THREE.MeshLambertMaterial({ vertexColors: true, side, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 2 });
  m.fog = false;
  return m;
}

/** skin, lips and hair, wherever a wire scene's people turn solid */
export const FLESH = "#c8906c", LIP = "#a4544e", HAIR = "#2b2320";

export class Solids {
  readonly group = new THREE.Group();
  private readonly meshes: THREE.Mesh[];
  private geo = new THREE.BufferGeometry();
  private pos = new Float32Array(0);
  private col = new Float32Array(0);
  private nor = new Float32Array(0);
  private idx = new Uint32Array(0);
  private nv = 0;
  private ni = 0;
  /** wire colours that stand for something else when solid (a wire kit's skin tone) */
  readonly paint = new Map<string, string>();

  /**
   * `inside`: a colour for the surfaces' backs, unlit (the dark of a mouth seen through parted
   * lips). Then only the fronts are lit, and every shape has to be wound facing out.
   */
  constructor(o: { inside?: string } = {}) {
    this.meshes = [new THREE.Mesh(this.geo, solidMaterial(o.inside ? THREE.FrontSide : THREE.DoubleSide))];
    if (o.inside) {
      const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(...rgb(o.inside)), side: THREE.BackSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 2 });
      m.fog = false;
      this.meshes.push(new THREE.Mesh(this.geo, m));
    }
    for (const mesh of this.meshes) {
      mesh.frustumCulled = false;
      this.group.add(mesh);
    }
    this.grow(4096, 16384);
  }

  private grow(verts: number, indices: number): void {
    const pos = new Float32Array(verts * 3), col = new Float32Array(verts * 3), idx = new Uint32Array(indices);
    pos.set(this.pos.subarray(0, this.nv * 3));
    col.set(this.col.subarray(0, this.nv * 3));
    idx.set(this.idx.subarray(0, this.ni));
    this.pos = pos;
    this.col = col;
    this.nor = new Float32Array(verts * 3);
    this.idx = idx;
    // a fresh geometry: three keeps a GPU buffer per attribute, and the old ones go with it
    this.geo.dispose();
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute("position", new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute("color", new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute("normal", new THREE.BufferAttribute(this.nor, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setIndex(new THREE.BufferAttribute(idx, 1).setUsage(THREE.DynamicDrawUsage));
    for (const mesh of this.meshes) mesh.geometry = this.geo;
  }

  begin(): void {
    this.nv = 0;
    this.ni = 0;
  }

  end(): void {
    const { pos, nor, idx } = this;
    nor.fill(0, 0, this.nv * 3);
    for (let i = 0; i < this.ni; i += 3) {
      const a = 3 * idx[i], b = 3 * idx[i + 1], c = 3 * idx[i + 2];
      const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
      const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      for (const j of [a, b, c]) {
        nor[j] += nx;
        nor[j + 1] += ny;
        nor[j + 2] += nz;
      }
    }
    for (let j = 0; j < this.nv * 3; j += 3) {
      const l = Math.hypot(nor[j], nor[j + 1], nor[j + 2]) || 1;
      nor[j] /= l;
      nor[j + 1] /= l;
      nor[j + 2] /= l;
    }
    for (const name of ["position", "color", "normal"]) (this.geo.getAttribute(name) as THREE.BufferAttribute).needsUpdate = true;
    this.geo.index!.needsUpdate = true;
    this.geo.setDrawRange(0, this.ni);
    for (const mesh of this.meshes) mesh.visible = this.ni > 0;
  }

  private room(verts: number, indices: number): void {
    let v = this.pos.length / 3, i = this.idx.length;
    while (this.nv + verts > v) v *= 2;
    while (this.ni + indices > i) i *= 2;
    if (v * 3 !== this.pos.length || i !== this.idx.length) this.grow(v, i);
  }

  private vert(p: V3, c: V3): number {
    const j = 3 * this.nv;
    this.pos[j] = p[0];
    this.pos[j + 1] = p[1];
    this.pos[j + 2] = p[2];
    this.col[j] = c[0];
    this.col[j + 1] = c[1];
    this.col[j + 2] = c[2];
    return this.nv++;
  }

  private tri(a: number, b: number, c: number): void {
    this.idx[this.ni++] = a;
    this.idx[this.ni++] = b;
    this.idx[this.ni++] = c;
  }

  private tone(color: string): V3 {
    return rgb(this.paint.get(color) ?? color);
  }

  /** a flat four-sided face */
  quad(a: V3, b: V3, c: V3, d: V3, color: string): void {
    this.room(4, 6);
    const t = this.tone(color);
    const i = this.vert(a, t);
    this.vert(b, t);
    this.vert(c, t);
    this.vert(d, t);
    this.tri(i, i + 1, i + 2);
    this.tri(i, i + 2, i + 3);
  }

  box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, color: string): void {
    this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], color);
    this.quad([x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1], color);
    this.quad([x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], color);
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], color);
    this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], color);
    this.quad([x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0], color);
  }

  /** a skin through closed rings of equal point counts, each in its own colour, with its ends closed or not */
  loft(rings: V3[][], color: (i: number) => string, caps: [boolean, boolean] = [true, true]): void {
    const n = rings[0]?.length ?? 0, m = rings.length;
    if (n < 3 || m < 2) return;
    this.room(n * m + 2, 6 * n * (m - 1) + 6 * n);
    const first = this.nv;
    rings.forEach((ring, i) => {
      const t = this.tone(color(i));
      for (const p of ring) this.vert(p, t);
    });
    for (let i = 0; i < m - 1; i++) {
      for (let j = 0; j < n; j++) {
        const a = first + i * n + j, b = first + i * n + ((j + 1) % n);
        this.tri(a, b, b + n);
        this.tri(a, b + n, a + n);
      }
    }
    for (const end of [0, 1]) {
      if (!caps[end]) continue;
      const ring = rings[end ? m - 1 : 0], at = first + (end ? (m - 1) * n : 0);
      const c: V3 = [0, 0, 0];
      for (const p of ring) for (let k = 0; k < 3; k++) c[k] += p[k] / n;
      const centre = this.vert(c, this.tone(color(end ? m - 1 : 0)));
      for (let j = 0; j < n; j++) this.tri(centre, at + j, at + ((j + 1) % n));
    }
  }

  /**
   * A surface through a grid of points, `rows` by `cols`, sharing its vertices (so it shades
   * smoothly). `wrap` joins each row's last point to its first; `keep` drops cells (holes);
   * `flip` turns its faces over. Unflipped, a face looks along (next column) × (next row).
   */
  sheet(rows: number, cols: number, at: (i: number, j: number) => V3, color: (i: number, j: number) => string, o: { wrap?: boolean; flip?: boolean; keep?: (i: number, j: number) => boolean } = {}): void {
    if (rows < 2 || cols < 2) return;
    this.room(rows * cols, 6 * rows * cols);
    const first = this.nv;
    for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) this.vert(at(i, j), this.tone(color(i, j)));
    const across = o.wrap ? cols : cols - 1;
    for (let i = 0; i < rows - 1; i++) {
      for (let j = 0; j < across; j++) {
        if (o.keep && !o.keep(i, j)) continue;
        const a = first + i * cols + j, b = first + i * cols + ((j + 1) % cols);
        if (o.flip) {
          this.tri(a, b + cols, b);
          this.tri(a, a + cols, b + cols);
        } else {
          this.tri(a, b, b + cols);
          this.tri(a, b + cols, a + cols);
        }
      }
    }
  }

  dispose(): void {
    this.geo.dispose();
    for (const mesh of this.meshes) (mesh.material as THREE.Material).dispose();
  }
}
