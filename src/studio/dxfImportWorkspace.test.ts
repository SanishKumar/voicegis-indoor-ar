import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { stageDxfImport } from './dxfImportWorkspace';

const fixture = readFileSync(
  new URL('../../buildings/import-fixtures/atrium-dxf-v0.dxf', import.meta.url),
  'utf8',
);

describe('Studio DXF staging boundary', () => {
  it('replaces the draft only after importer and semantic validation pass', () => {
    const outcome = stageDxfImport(fixture, 'atrium-dxf-v0.dxf', 'current draft');

    expect(outcome.report.accepted).toBe(true);
    expect(outcome.draftName).toBe('atrium-dxf-v0.json');
    expect(JSON.parse(outcome.draftText)).toMatchObject({
      building: { id: 'atrium-dxf-v0', entrySpaceId: 'g-lobby' },
    });
  });

  it('preserves the exact current draft when DXF parsing fails', () => {
    const currentDraft = '{"current":true}\n';
    const outcome = stageDxfImport('not a DXF', 'broken.dxf', currentDraft);

    expect(outcome.report.accepted).toBe(false);
    expect(outcome.draftText).toBe(currentDraft);
    expect(outcome.draftName).toBeNull();
    expect(outcome.report.issues.some((entry) => entry.severity === 'error')).toBe(true);
  });

  it('preserves the exact current draft when compiler semantics fail', () => {
    const currentDraft = '{"current":true}\n';
    const disconnected = fixture.replace(
      'VG$PORTAL$g$lobby-opening$opening$g-lobby$g-concourse$true$false',
      'UNANNOTATED',
    );
    const outcome = stageDxfImport(disconnected, 'disconnected.dxf', currentDraft);

    expect(outcome.report.accepted).toBe(false);
    expect(outcome.draftText).toBe(currentDraft);
    expect(outcome.report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ stage: 'semantic', code: 'unreachable-public-space' }),
      ]),
    );
  });
});
