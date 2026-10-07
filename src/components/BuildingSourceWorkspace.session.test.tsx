/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { BuildingSource } from '@voicegis/spatial-schema';
import referenceJson from '../../buildings/reference-medical-centre/compiled/building.package.json';
import BuildingSourceWorkspace from './BuildingSourceWorkspace';
import { studioDraftMemory } from '../studio/studioDraftMemory';

const context = vi.hoisted(() => ({ venue: null as unknown, compiled: null as unknown }));
vi.mock('@voicegis/map-compiler/browser', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@voicegis/map-compiler/browser')>()),
  compileBuildingInBrowser: async () => ({
    package: context.compiled,
    report: { summary: { errors: 0, warnings: 0 } },
  }),
}));
vi.mock('../studio/venuePackageArtifact', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../studio/venuePackageArtifact')>()),
  createVenuePackageArtifact: async () => ({
    text: '{}',
    fileName: 'candidate.json',
    byteLength: 2,
    artifactHash: 'candidate',
  }),
}));
vi.mock('../context/NavigationContext.jsx', () => ({
  useNavigation: () => ({ venue: context.venue }),
}));
vi.mock('../context/VenueContext.jsx', () => ({
  useVenue: () => ({
    status: { state: 'ready', detail: 'Verified package active', error: null },
    versionCatalog: null,
    rollbackCandidate: null,
    activateVerifiedPackage: vi.fn(),
    rollbackRuntimePackage: vi.fn(),
  }),
}));
vi.mock('./BuildingSourceFloorCanvas', () => ({
  default: ({
    source,
    canUndo,
    onBeginEdit,
    onSourceChange,
    onUndo,
  }: {
    source: BuildingSource;
    canUndo: boolean;
    onBeginEdit: () => void;
    onSourceChange: (source: BuildingSource) => void;
    onUndo: () => void;
  }) => (
    <div>
      <button
        onClick={() => {
          onBeginEdit();
          onSourceChange({
            ...source,
            building: { ...source.building, name: 'Visual edit retained' },
          });
        }}
      >
        Fixture visual edit
      </button>
      <button disabled={!canUndo} onClick={onUndo}>
        Fixture undo
      </button>
    </div>
  ),
}));
vi.mock('./DxfLayerMappingPanel', () => ({ default: () => <div>DXF fixture</div> }));
vi.mock('./VenuePublishDryRunPanel', () => ({ default: () => <div>Publish fixture</div> }));
vi.mock('./VenueVersionCatalogPanel', () => ({ default: () => <div>Catalog fixture</div> }));

afterEach(() => {
  cleanup();
  studioDraftMemory.clear();
});

describe('Studio surface round trips', () => {
  it('retains an edited source and editor mode after leaving and reopening Studio', () => {
    context.venue = { buildingPackage: referenceJson };
    const first = render(<BuildingSourceWorkspace />);
    fireEvent.click(screen.getByRole('tab', { name: 'Source JSON' }));
    const editor = screen.getByRole('textbox', { name: 'BuildingSource JSON draft' });
    const draft = JSON.parse((editor as HTMLTextAreaElement).value);
    draft.building.name = 'A campus draft that has not been activated';
    const text = JSON.stringify(draft, null, 2);
    fireEvent.change(editor, { target: { value: text } });
    first.unmount();

    render(<BuildingSourceWorkspace />);
    expect(
      (screen.getByRole('textbox', { name: 'BuildingSource JSON draft' }) as HTMLTextAreaElement)
        .value,
    ).toBe(text);
    expect(screen.getByRole('tab', { name: 'Source JSON' }).getAttribute('aria-selected')).toBe(
      'true',
    );
    expect(screen.getByText('Local changes · not published')).toBeDefined();
  });

  it('keeps visual undo history when moving between tools', () => {
    context.venue = { buildingPackage: referenceJson };
    const first = render(<BuildingSourceWorkspace />);
    fireEvent.click(screen.getByRole('button', { name: 'Fixture visual edit' }));
    first.unmount();
    render(<BuildingSourceWorkspace />);
    expect(
      (screen.getByRole('button', { name: 'Fixture undo' }) as HTMLButtonElement).disabled,
    ).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Fixture undo' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Source JSON' }));
    const source = JSON.parse(
      (screen.getByRole('textbox', { name: 'BuildingSource JSON draft' }) as HTMLTextAreaElement)
        .value,
    );
    expect(source.building.name).toBe(referenceJson.building.name);
    expect(screen.getByText('Derived from the active package')).toBeDefined();
  });

  it('restores an imported file name and draft, but never into a different active package revision', async () => {
    context.venue = { buildingPackage: referenceJson };
    const first = render(<BuildingSourceWorkspace />);
    const text = JSON.stringify({ schemaVersion: '0.1.0', draft: 'unfinished import' });
    fireEvent.change(screen.getByLabelText('Open BuildingSource JSON'), {
      target: { files: [{ name: 'hospital-survey.json', text: async () => text }] },
    });
    await waitFor(() => expect(screen.getByText('hospital-survey.json')).toBeDefined());
    first.unmount();
    const second = render(<BuildingSourceWorkspace />);
    expect(screen.getByText('hospital-survey.json')).toBeDefined();
    expect(
      (screen.getByRole('textbox', { name: 'BuildingSource JSON draft' }) as HTMLTextAreaElement)
        .value,
    ).toBe(text);
    second.unmount();
    context.venue = {
      buildingPackage: {
        ...referenceJson,
        manifest: { ...referenceJson.manifest, contentHash: 'different revision' },
      },
    };
    render(<BuildingSourceWorkspace />);
    expect(screen.queryByText('hospital-survey.json')).toBeNull();
    expect(screen.getByText('Derived from the active package')).toBeDefined();
  });

  it('preserves compilation freshness but requires activation to be reviewed again after returning', async () => {
    context.venue = { buildingPackage: referenceJson };
    context.compiled = {
      ...referenceJson,
      manifest: { ...referenceJson.manifest, contentHash: 'new candidate hash' },
    };
    const first = render(<BuildingSourceWorkspace />);
    fireEvent.click(screen.getByRole('tab', { name: 'Source JSON' }));
    const editor = screen.getByRole('textbox', {
      name: 'BuildingSource JSON draft',
    }) as HTMLTextAreaElement;
    const draft = JSON.parse(editor.value);
    draft.building.name = 'Changed candidate';
    fireEvent.change(editor, { target: { value: JSON.stringify(draft) } });
    fireEvent.click(screen.getByRole('button', { name: 'Compile preview' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Review activation' }));
    expect(screen.getByRole('button', { name: 'Activate verified package' })).toBeDefined();
    first.unmount();

    const second = render(<BuildingSourceWorkspace />);
    expect(screen.queryByRole('button', { name: 'Activate verified package' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Review activation' })).toBeDefined();
    fireEvent.change(screen.getByRole('textbox', { name: 'BuildingSource JSON draft' }), {
      target: { value: '{' },
    });
    second.unmount();
    render(<BuildingSourceWorkspace />);
    expect(screen.getByText('Preview out of date')).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Review activation' })).toBeNull();
    expect(
      (screen.getByRole('button', { name: 'Download verified package' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });
});
