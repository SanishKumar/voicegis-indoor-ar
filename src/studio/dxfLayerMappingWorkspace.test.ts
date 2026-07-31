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
};
const spaceLayer: DxfLayerSummary = {
  name: 'A-SPACE-ENTRY',
  entityCount: 1,
  entityTypes: ['LWPOLYLINE'],
  closedLightweightPolylines: 1,
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
});
