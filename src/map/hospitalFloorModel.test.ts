import { BoxGeometry, InstancedMesh, Matrix4, MeshBasicMaterial } from 'three';
import { expect, it } from 'vitest';
import { orientFloorInstances } from './hospitalFloorModel';

it('keeps mirrored equipment in place with a consistent front face for the whole draw', () => {
  const mesh = new InstancedMesh(new BoxGeometry(), new MeshBasicMaterial(), 2);
  mesh.position.set(4, 1, 6);
  mesh.rotation.y = Math.PI / 4;
  mesh.updateMatrixWorld();
  const instances = [
    new Matrix4().makeScale(-1, 1, 1).setPosition(3, 2, 5),
    new Matrix4().makeRotationY(0.7).multiply(new Matrix4().makeScale(1, 1, -2)),
  ];
  const expected = instances.map((instance, index) => {
    mesh.setMatrixAt(index, instance);
    return mesh.matrixWorld.clone().multiply(instance);
  });
  orientFloorInstances(mesh);
  mesh.updateMatrixWorld();
  expect(mesh.matrixWorld.determinant()).toBeLessThan(0);
  expected.forEach((world, index) => {
    const instance = new Matrix4();
    mesh.getMatrixAt(index, instance);
    expect(instance.determinant()).toBeGreaterThan(0);
    const actual = mesh.matrixWorld.clone().multiply(instance);
    actual.elements.forEach((value, i) => expect(value).toBeCloseTo(world.elements[i], 6));
  });
});
