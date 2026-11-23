import { BufferAttribute, BufferGeometry } from 'three';
import library from './clinicalFurniture.json';

export type ClinicalShape = keyof typeof library;
export const clinicalShapes = Object.keys(library) as ClinicalShape[];
const bytes = (data: string) => Uint8Array.from(atob(data), (char) => char.charCodeAt(0));

/** Each source assembly has been simplified, coloured and centred in a unit box. */
export function clinicalGeometry(shape: ClinicalShape): BufferGeometry {
  const part = library[shape];
  const xyz = new Int16Array(bytes(part.xyz).buffer);
  const mesh = new BufferGeometry();
  mesh.setAttribute(
    'position',
    new BufferAttribute(
      Float32Array.from(xyz, (v) => v / 32766),
      3,
    ),
  );
  mesh.setAttribute('color', new BufferAttribute(bytes(part.rgb), 3, true));
  mesh.setIndex(new BufferAttribute(new Uint16Array(bytes(part.faces).buffer), 1));
  mesh.computeVertexNormals();
  return mesh;
}
