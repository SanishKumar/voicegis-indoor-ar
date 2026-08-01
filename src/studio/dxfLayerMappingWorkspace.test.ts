import { describe, expect, it } from 'vitest';
import type { DxfLayerSummary } from '@voicegis/dxf-importer';
import {
  buildDxfLayerMappingProfile,
  createDxfLayerMappingDraft,
} from './dxfLayerMappingWorkspace';

const floorLayer: DxfLayerSummary = {
  name: 'A-FLOOR-OUTLINE',
  entityCount: 1,
  entityTypes: ['LWPOLYLINE'],
  closedLightweightPolylines: 1,
  selectableEntities: [],
};
const levelOneFloorLayer: DxfLayerSummary = {
  ...floorLayer,
  name: 'A-FLOOR-L1',
};
const spaceLayer: DxfLayerSummary = {
  name: 'A-SPACE-ENTRY',
  entityCount: 1,
  entityTypes: ['LWPOLYLINE'],
  closedLightweightPolylines: 1,
  selectableEntities: [],
};
const gallerySpaceLayer: DxfLayerSummary = {
  ...spaceLayer,
  name: 'A-SPACE-GALLERY',
};
const portalLayer: DxfLayerSummary = {
  name: 'A-DOOR-ENTRY-GALLERY',
  entityCount: 1,
  entityTypes: ['LINE'],
  closedLightweightPolylines: 0,
  selectableEntities: [],
};
const sharedRoomLayer: DxfLayerSummary = {
  name: 'A-ROOMS',
  entityCount: 2,
  entityTypes: ['LWPOLYLINE'],
  closedLightweightPolylines: 2,
  selectableEntities: [
    {
      key: 'lwpolyline:0,0;4,0;4,8;0,8',
      type: 'LWPOLYLINE',
      polygon: [
        [0, 0],
        [4, 0],
        [4, 8],
        [0, 8],
      ],
      area: 32,
      occurrenceCount: 1,
    },
    {
      key: 'lwpolyline:4,0;12,0;12,8;4,8',
      type: 'LWPOLYLINE',
      polygon: [
        [4, 0],
        [12, 0],
        [12, 8],
        [4, 8],
      ],
      area: 64,
      occurrenceCount: 1,
    },
  ],
};
const sharedDoorLayer: DxfLayerSummary = {
  name: 'A-DOORS',
  entityCount: 2,
  entityTypes: ['LINE'],
  closedLightweightPolylines: 0,
  selectableEntities: [
    {
      key: 'line:4,3.5;4,4.5',
      type: 'LINE',
      line: [
        [4, 3.5],
        [4, 4.5],
      ],
      length: 1,
      occurrenceCount: 1,
    },
    {
      key: 'line:8,3.5;8,4.5',
      type: 'LINE',
      line: [
        [8, 3.5],
        [8, 4.5],
      ],
      length: 1,
      occurrenceCount: 1,
    },
  ],
};
const sharedPoiLayer: DxfLayerSummary = {
  name: 'A-POIS',
  entityCount: 2,
  entityTypes: ['POINT'],
  closedLightweightPolylines: 0,
  selectableEntities: [
    {
      key: 'point:1.5,4',
      type: 'POINT',
      point: [1.5, 4],
      occurrenceCount: 1,
    },
    {
      key: 'point:6,4',
      type: 'POINT',
      point: [6, 4],
      occurrenceCount: 1,
    },
  ],
};
const sharedConnectorStopLayer: DxfLayerSummary = {
  name: 'A-RAMP-STOPS',
  entityCount: 2,
  entityTypes: ['POINT'],
  closedLightweightPolylines: 0,
  selectableEntities: [
    {
      key: 'point:4,4',
      type: 'POINT',
      point: [4, 4],
      occurrenceCount: 1,
    },
    {
      key: 'point:4.2,4',
      type: 'POINT',
      point: [4.2, 4],
      occurrenceCount: 1,
    },
  ],
};

describe('Studio CAD layer mapping profile', () => {
  it('builds an explicit deterministic floor and space profile', () => {
    const floor = {
      ...createDxfLayerMappingDraft(floorLayer),
      role: 'floor' as const,
      id: 'g',
      name: 'Ground Floor',
      level: '0',
      elevation: '0',
      clearHeight: '3.2',
    };
    const space = {
      ...createDxfLayerMappingDraft(spaceLayer),
      role: 'space' as const,
      id: 'entry',
      name: 'Entry Lobby',
      floorId: 'g',
      spaceType: 'entrance' as const,
      publicPolicy: 'true' as const,
      accessiblePolicy: 'true' as const,
    };

    const result = buildDxfLayerMappingProfile([space, floor]);

    expect(result.valid).toBe(true);
    expect(result.profile?.mappings).toEqual([
      {
        sourceLayer: 'A-FLOOR-OUTLINE',
        targetLayer: 'VG$FLOOR$g$0$0$3.2$Ground%20Floor',
      },
      {
        sourceLayer: 'A-SPACE-ENTRY',
        targetLayer: 'VG$SPACE$g$entry$entrance$true$true$Entry%20Lobby',
      },
    ]);
  });

  it('does not create a profile until public and accessibility policy are reviewed', () => {
    const floor = {
      ...createDxfLayerMappingDraft(floorLayer),
      role: 'floor' as const,
      id: 'g',
    };
    const space = {
      ...createDxfLayerMappingDraft(spaceLayer),
      role: 'space' as const,
      id: 'entry',
      floorId: 'g',
      spaceType: 'entrance' as const,
    };

    const result = buildDxfLayerMappingProfile([floor, space]);

    expect(result.valid).toBe(false);
    expect(result.profile).toBeNull();
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'missing-public-policy' }),
        expect.objectContaining({ code: 'missing-accessibility-policy' }),
      ]),
    );
  });

  it('builds an explicit portal target without inventing safety policy', () => {
    const floor = {
      ...createDxfLayerMappingDraft(floorLayer),
      role: 'floor' as const,
      id: 'g',
    };
    const space = {
      ...createDxfLayerMappingDraft(spaceLayer),
      role: 'space' as const,
      id: 'entry',
      floorId: 'g',
      spaceType: 'entrance' as const,
      publicPolicy: 'true' as const,
      accessiblePolicy: 'true' as const,
    };
    const portal = {
      ...createDxfLayerMappingDraft(portalLayer),
      role: 'portal' as const,
      id: 'entry-gallery-door',
      floorId: 'g',
      portalKind: 'door' as const,
      spaceA: 'entry',
      spaceB: 'gallery',
      accessiblePolicy: 'true' as const,
      restrictedPolicy: 'false' as const,
    };

    const result = buildDxfLayerMappingProfile([floor, space, portal]);

    expect(result.valid).toBe(true);
    expect(result.profile?.mappings).toContainEqual({
      sourceLayer: 'A-DOOR-ENTRY-GALLERY',
      targetLayer: 'VG$PORTAL$g$entry-gallery-door$door$entry$gallery$true$false',
    });
  });

  it('fails closed when portal policy or endpoints are unresolved', () => {
    const floor = {
      ...createDxfLayerMappingDraft(floorLayer),
      role: 'floor' as const,
      id: 'g',
    };
    const space = {
      ...createDxfLayerMappingDraft(spaceLayer),
      role: 'space' as const,
      id: 'entry',
      floorId: 'g',
      spaceType: 'entrance' as const,
      publicPolicy: 'true' as const,
      accessiblePolicy: 'true' as const,
    };
    const portal = {
      ...createDxfLayerMappingDraft(portalLayer),
      role: 'portal' as const,
      id: 'entry-door',
      floorId: 'g',
      portalKind: 'door' as const,
      spaceA: 'entry',
      spaceB: 'entry',
    };

    const result = buildDxfLayerMappingProfile([floor, space, portal]);

    expect(result.valid).toBe(false);
    expect(result.profile).toBeNull();
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'duplicate-portal-spaces' }),
        expect.objectContaining({ code: 'missing-accessibility-policy' }),
        expect.objectContaining({ code: 'missing-restricted-policy' }),
      ]),
    );
  });

  it('preserves stable entity selectors for multiple spaces on one CAD layer', () => {
    const floor = {
      ...createDxfLayerMappingDraft(floorLayer),
      role: 'floor' as const,
      id: 'g',
    };
    const entry = {
      ...createDxfLayerMappingDraft(sharedRoomLayer, sharedRoomLayer.selectableEntities[0], 0),
      role: 'space' as const,
      id: 'entry',
      name: 'Entry',
      floorId: 'g',
      spaceType: 'entrance' as const,
      publicPolicy: 'true' as const,
      accessiblePolicy: 'true' as const,
    };
    const gallery = {
      ...createDxfLayerMappingDraft(sharedRoomLayer, sharedRoomLayer.selectableEntities[1], 1),
      role: 'space' as const,
      id: 'gallery',
      name: 'Gallery',
      floorId: 'g',
      spaceType: 'room' as const,
      publicPolicy: 'true' as const,
      accessiblePolicy: 'true' as const,
    };

    const result = buildDxfLayerMappingProfile([gallery, floor, entry]);

    expect(result.valid).toBe(true);
    expect(result.profile?.mappings.filter((mapping) => mapping.sourceLayer === 'A-ROOMS')).toEqual(
      [
        {
          sourceLayer: 'A-ROOMS',
          sourceEntityKey: 'lwpolyline:0,0;4,0;4,8;0,8',
          targetLayer: 'VG$SPACE$g$entry$entrance$true$true$Entry',
        },
        {
          sourceLayer: 'A-ROOMS',
          sourceEntityKey: 'lwpolyline:4,0;12,0;12,8;4,8',
          targetLayer: 'VG$SPACE$g$gallery$room$true$true$Gallery',
        },
      ],
    );
  });

  it('preserves stable entity selectors for multiple portals on one CAD layer', () => {
    const floor = {
      ...createDxfLayerMappingDraft(floorLayer),
      role: 'floor' as const,
      id: 'g',
    };
    const space = {
      ...createDxfLayerMappingDraft(spaceLayer),
      role: 'space' as const,
      id: 'entry',
      floorId: 'g',
      spaceType: 'entrance' as const,
      publicPolicy: 'true' as const,
      accessiblePolicy: 'true' as const,
    };
    const firstDoor = {
      ...createDxfLayerMappingDraft(sharedDoorLayer, sharedDoorLayer.selectableEntities[0], 0),
      role: 'portal' as const,
      id: 'entry-gallery-door',
      floorId: 'g',
      portalKind: 'door' as const,
      spaceA: 'entry',
      spaceB: 'gallery',
      accessiblePolicy: 'true' as const,
      restrictedPolicy: 'false' as const,
    };
    const secondDoor = {
      ...createDxfLayerMappingDraft(sharedDoorLayer, sharedDoorLayer.selectableEntities[1], 1),
      role: 'portal' as const,
      id: 'gallery-archive-door',
      floorId: 'g',
      portalKind: 'door' as const,
      spaceA: 'gallery',
      spaceB: 'archive',
      accessiblePolicy: 'true' as const,
      restrictedPolicy: 'false' as const,
    };

    const result = buildDxfLayerMappingProfile([secondDoor, space, floor, firstDoor]);

    expect(result.valid).toBe(true);
    expect(result.profile?.mappings.filter((mapping) => mapping.sourceLayer === 'A-DOORS')).toEqual(
      [
        {
          sourceLayer: 'A-DOORS',
          sourceEntityKey: 'line:4,3.5;4,4.5',
          targetLayer: 'VG$PORTAL$g$entry-gallery-door$door$entry$gallery$true$false',
        },
        {
          sourceLayer: 'A-DOORS',
          sourceEntityKey: 'line:8,3.5;8,4.5',
          targetLayer: 'VG$PORTAL$g$gallery-archive-door$door$gallery$archive$true$false',
        },
      ],
    );
  });

  it('preserves stable entity selectors and explicit policy for shared-layer POIs', () => {
    const floor = {
      ...createDxfLayerMappingDraft(floorLayer),
      role: 'floor' as const,
      id: 'g',
    };
    const space = {
      ...createDxfLayerMappingDraft(spaceLayer),
      role: 'space' as const,
      id: 'entry',
      floorId: 'g',
      spaceType: 'entrance' as const,
      publicPolicy: 'true' as const,
      accessiblePolicy: 'true' as const,
    };
    const reception = {
      ...createDxfLayerMappingDraft(sharedPoiLayer, sharedPoiLayer.selectableEntities[0], 0),
      role: 'poi' as const,
      id: 'reception',
      name: 'Reception',
      floorId: 'g',
      spaceId: 'entry',
      poiCategory: 'visitor service',
      publicPolicy: 'true' as const,
      accessiblePolicy: 'true' as const,
    };
    const exhibit = {
      ...createDxfLayerMappingDraft(sharedPoiLayer, sharedPoiLayer.selectableEntities[1], 1),
      role: 'poi' as const,
      id: 'featured-exhibit',
      name: 'Featured Exhibit',
      floorId: 'g',
      spaceId: 'entry',
      poiCategory: 'exhibit',
      publicPolicy: 'true' as const,
      accessiblePolicy: 'false' as const,
    };

    const result = buildDxfLayerMappingProfile([exhibit, space, floor, reception]);

    expect(result.valid).toBe(true);
    expect(result.profile?.mappings.filter((mapping) => mapping.sourceLayer === 'A-POIS')).toEqual([
      {
        sourceLayer: 'A-POIS',
        sourceEntityKey: 'point:1.5,4',
        targetLayer: 'VG$POI$g$entry$reception$visitor%20service$true$true$Reception',
      },
      {
        sourceLayer: 'A-POIS',
        sourceEntityKey: 'point:6,4',
        targetLayer: 'VG$POI$g$entry$featured-exhibit$exhibit$true$false$Featured%20Exhibit',
      },
    ]);
  });

  it('does not create a POI mapping until category and policies are reviewed', () => {
    const floor = {
      ...createDxfLayerMappingDraft(floorLayer),
      role: 'floor' as const,
      id: 'g',
    };
    const space = {
      ...createDxfLayerMappingDraft(spaceLayer),
      role: 'space' as const,
      id: 'entry',
      floorId: 'g',
      spaceType: 'entrance' as const,
      publicPolicy: 'true' as const,
      accessiblePolicy: 'true' as const,
    };
    const poi = {
      ...createDxfLayerMappingDraft(sharedPoiLayer, sharedPoiLayer.selectableEntities[0], 0),
      role: 'poi' as const,
      id: 'reception',
      floorId: 'g',
      spaceId: 'entry',
    };

    const result = buildDxfLayerMappingProfile([floor, space, poi]);

    expect(result.valid).toBe(false);
    expect(result.profile).toBeNull();
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'missing-poi-category' }),
        expect.objectContaining({ code: 'missing-public-policy' }),
        expect.objectContaining({ code: 'missing-accessibility-policy' }),
      ]),
    );
  });

  it('groups deterministic connector-stop selectors under consistent connector metadata', () => {
    const groundFloor = {
      ...createDxfLayerMappingDraft(floorLayer),
      role: 'floor' as const,
      id: 'g',
      name: 'Ground',
    };
    const levelOneFloor = {
      ...createDxfLayerMappingDraft(levelOneFloorLayer),
      role: 'floor' as const,
      id: 'l1',
      name: 'Level 1',
      level: '1',
      elevation: '3.2',
    };
    const entry = {
      ...createDxfLayerMappingDraft(spaceLayer),
      role: 'space' as const,
      id: 'entry',
      name: 'Entry',
      floorId: 'g',
      spaceType: 'entrance' as const,
      publicPolicy: 'true' as const,
      accessiblePolicy: 'true' as const,
    };
    const gallery = {
      ...createDxfLayerMappingDraft(gallerySpaceLayer),
      role: 'space' as const,
      id: 'gallery',
      name: 'Gallery',
      floorId: 'l1',
      spaceType: 'room' as const,
      publicPolicy: 'true' as const,
      accessiblePolicy: 'true' as const,
    };
    const groundStop = {
      ...createDxfLayerMappingDraft(
        sharedConnectorStopLayer,
        sharedConnectorStopLayer.selectableEntities[0],
        0,
      ),
      role: 'connector' as const,
      id: 'east-ramp',
      name: 'East Ramp',
      floorId: 'g',
      spaceId: 'entry',
      connectorKind: 'ramp' as const,
      accessiblePolicy: 'true' as const,
      restrictedPolicy: 'false' as const,
    };
    const levelOneStop = {
      ...createDxfLayerMappingDraft(
        sharedConnectorStopLayer,
        sharedConnectorStopLayer.selectableEntities[1],
        1,
      ),
      role: 'connector' as const,
      id: 'east-ramp',
      name: 'East Ramp',
      floorId: 'l1',
      spaceId: 'gallery',
      connectorKind: 'ramp' as const,
      accessiblePolicy: 'true' as const,
      restrictedPolicy: 'false' as const,
    };

    const result = buildDxfLayerMappingProfile([
      levelOneStop,
      gallery,
      groundFloor,
      groundStop,
      entry,
      levelOneFloor,
    ]);

    expect(result.valid).toBe(true);
    expect(
      result.profile?.mappings.filter((mapping) => mapping.sourceLayer === 'A-RAMP-STOPS'),
    ).toEqual([
      {
        sourceLayer: 'A-RAMP-STOPS',
        sourceEntityKey: 'point:4,4',
        targetLayer: 'VG$CONNECTOR$east-ramp$ramp$true$false$g$entry$East%20Ramp',
      },
      {
        sourceLayer: 'A-RAMP-STOPS',
        sourceEntityKey: 'point:4.2,4',
        targetLayer: 'VG$CONNECTOR$east-ramp$ramp$true$false$l1$gallery$East%20Ramp',
      },
    ]);
  });

  it('fails closed for incomplete or inconsistent connector groups', () => {
    const floor = {
      ...createDxfLayerMappingDraft(floorLayer),
      role: 'floor' as const,
      id: 'g',
    };
    const space = {
      ...createDxfLayerMappingDraft(spaceLayer),
      role: 'space' as const,
      id: 'entry',
      floorId: 'g',
      spaceType: 'entrance' as const,
      publicPolicy: 'true' as const,
      accessiblePolicy: 'true' as const,
    };
    const first = {
      ...createDxfLayerMappingDraft(
        sharedConnectorStopLayer,
        sharedConnectorStopLayer.selectableEntities[0],
        0,
      ),
      role: 'connector' as const,
      id: 'east-ramp',
      name: 'East Ramp',
      floorId: 'g',
      spaceId: 'entry',
      connectorKind: 'ramp' as const,
      accessiblePolicy: 'true' as const,
      restrictedPolicy: 'false' as const,
    };
    const inconsistent = {
      ...createDxfLayerMappingDraft(
        sharedConnectorStopLayer,
        sharedConnectorStopLayer.selectableEntities[1],
        1,
      ),
      role: 'connector' as const,
      id: 'east-ramp',
      name: 'Different Ramp',
      floorId: 'g',
      spaceId: 'entry',
      connectorKind: 'stairs' as const,
      accessiblePolicy: 'false' as const,
      restrictedPolicy: 'false' as const,
    };

    const inconsistentResult = buildDxfLayerMappingProfile([floor, space, first, inconsistent]);
    const singletonResult = buildDxfLayerMappingProfile([floor, space, first]);

    expect(inconsistentResult.valid).toBe(false);
    expect(inconsistentResult.profile).toBeNull();
    expect(inconsistentResult.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'duplicate-connector-floor-stop' }),
        expect.objectContaining({ code: 'inconsistent-connector-metadata' }),
      ]),
    );
    expect(singletonResult.valid).toBe(false);
    expect(singletonResult.profile).toBeNull();
    expect(singletonResult.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'connector-requires-two-stops' })]),
    );
  });
});
