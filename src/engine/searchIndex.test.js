import { describe, expect, it } from 'vitest';
import { searchPOIs } from './searchIndex.js';

describe('POI search', () => {
  it('ranks an exact destination ahead of fuzzy matches', () => {
    const results = searchPOIs('pharmacy');
    expect(results[0].node.id).toBe('poi:pharmacy');
    expect(results[0].score).toBe(1);
  });

  it('tolerates a common spelling error', () => {
    const results = searchPOIs('farmacy');
    expect(results.some(({ node }) => node.id === 'poi:pharmacy')).toBe(true);
  });

  it('applies category filters before ranking', () => {
    const results = searchPOIs('', { category: 'medical' });
    expect(results.length).toBeGreaterThan(0);
    expect(results.every(({ node }) => node.poi.category === 'medical')).toBe(true);
  });

  it('indexes declared destination aliases', () => {
    const results = searchPOIs('heart clinic');
    expect(results[0].node.id).toBe('poi:cardiology');
  });

  it('never returns staff-only POIs to visitor search', () => {
    expect(searchPOIs('records store')).toHaveLength(0);
  });
});
