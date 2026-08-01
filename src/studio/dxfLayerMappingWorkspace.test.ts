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
const spaceLayer: DxfLayerSummary = {
  name: 'A-SPACE-ENTRY',
  entityCount: 1,
  entityTypes: ['LWPOLYLINE'],
  closedLightweightPolylines: 1,
  selectableEntities: [],
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
});
