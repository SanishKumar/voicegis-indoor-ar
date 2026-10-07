import { describe, expect, it } from 'vitest';
import { StudioDraftMemory, type StudioDraftSession } from './studioDraftMemory';

const draft = (text: string): StudioDraftSession => ({
  draftText: text,
  draftName: 'campus.json',
  editorMode: 'json',
  visualHistory: ['previous'],
  fileMessage: 'Imported source',
  dxfImportReport: null,
  dxfMappingSession: null,
  compilePreview: null,
});

describe('operator Studio draft memory', () => {
  it('keeps venue revisions separate and returns independent snapshots', () => {
    const memory = new StudioDraftMemory();
    const session = draft('first package draft');
    memory.remember('hash-a', session);
    memory.remember('hash-b', draft('second package draft'));
    session.visualHistory.push('mutated by the caller');
    const restored = memory.read('hash-a')!;
    expect(restored).toEqual(draft('first package draft'));
    restored.visualHistory.push('mutated after restoration');
    expect(memory.read('hash-a')!.visualHistory).toEqual(['previous']);
    expect(memory.read('hash-b')!.draftText).toBe('second package draft');
    expect(memory.read('a new compiled hash')).toBeNull();
  });

  it('does not preserve activation or publish authorization', () => {
    const memory = new StudioDraftMemory();
    memory.remember('hash', {
      ...draft('source'),
      activationArmed: true,
      publishPending: true,
    } as StudioDraftSession);
    expect(memory.read('hash')).not.toHaveProperty('activationArmed');
    expect(memory.read('hash')).not.toHaveProperty('publishPending');
  });

  it('bounds memory by evicting the least recently used package revision', () => {
    const memory = new StudioDraftMemory(2);
    memory.remember('a', draft('a'));
    memory.remember('b', draft('b'));
    memory.read('a');
    memory.remember('c', draft('c'));
    expect(memory.read('b')).toBeNull();
    expect(memory.read('a')?.draftText).toBe('a');
    expect(memory.read('c')?.draftText).toBe('c');
    memory.clear();
    expect(memory.read('a')).toBeNull();
  });
});
