# Hospital model and furnishings

The meshes in `clinicalFurniture.json` are adapted from **Hospital** by **neutralize**, used under the [Creative Commons Attribution 4.0 International license](https://creativecommons.org/licenses/by/4.0/). [Original model and author credit](https://sketchfab.com/3d-models/hospital-9e77947654e24a73b6221ef2a878f766).

The hospital beds, waiting seats, wheelchairs, task chairs, instrument carts, IV stands, desks, monitors, canteen tables with fixed seating, and waste bins were extracted from the source scene. Their transforms were baked, geometry simplified, colours sampled from the materials and JPEG textures, and coordinates quantised for rendering repeated instances. Run `node scripts/prepareClinicalFurniture.mjs <path-to-original-hospital.glb>` to rebuild the asset.

The complete architectural reference in `assets/hospital-interior.glb` is also adapted from **Hospital** by **neutralize** under the same license. It keeps the source floor arrangement and material assignments, shares repeated geometry across positioned instances, simplifies triangulation and reduces the embedded texture resolution for mobile viewing. Rebuild it with `node scripts/prepareHospitalModel.mjs <path-to-original-hospital.glb>`. The included model is an illustrative reference and supplies no venue routes.
