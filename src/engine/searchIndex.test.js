import { describe, expect, it } from 'vitest';
import { searchPOIs } from './searchIndex.js';

describe('POI search', () => {
  it('ranks an exact destination ahead of fuzzy matches', () => {
    const results = searchPOIs('pharmacy');
    expect(results[0].node.id).toBe('pharmacy');
    expect(results[0].score).toBe(1);
  });

  it('tolerates a common spelling error', () => {
    const results = searchPOIs('farmacy');
    expect(results.some(({ node }) => node.id === 'pharmacy')).toBe(true);
  });

  it('applies category filters before ranking', () => {
    const results = searchPOIs('', { category: 'emergency' });
    expect(results.length).toBeGreaterThan(0);
    expect(results.every(({ node }) => node.poi.category === 'emergency')).toBe(true);
  });
});
