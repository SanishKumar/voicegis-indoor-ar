import { describe, expect, it } from 'vitest';
import { searchPOIs } from './searchIndex.js';
import { ASTERION_RUNTIME } from '../test/venueFixtures';

const publicPois = ASTERION_RUNTIME.getPOIs();

describe('POI search', () => {
  it('ranks an exact destination ahead of fuzzy matches', () => {
    const results = searchPOIs(publicPois, 'Outpatient Pharmacy');
    expect(results[0].node.id).toBe('poi:poi-pharmacy');
    expect(results[0].score).toBe(1);
  });

  it('tolerates a common spelling error', () => {
    const results = searchPOIs(publicPois, 'farmacy');
    expect(results.some(({ node }) => node.id === 'poi:poi-pharmacy')).toBe(true);
  });

  it('applies category filters before ranking', () => {
    const results = searchPOIs(publicPois, '', { category: 'medical' });
    expect(results.length).toBeGreaterThan(0);
    expect(results.every(({ node }) => node.poi.category === 'medical')).toBe(true);
  });

  it('indexes declared destination aliases', () => {
    const results = searchPOIs(publicPois, 'heart clinic');
    expect(results[0].node.id).toBe('poi:poi-cardiology');
  });

  it('never returns staff-only POIs to visitor search', () => {
    expect(
      searchPOIs(publicPois, 'clinical data center').some(
        ({ node }) => node.id === 'poi:poi-data-center',
      ),
    ).toBe(false);
  });

  const place = (name, extra = {}) => ({
    id: `poi:${name}`,
    poi: { name, category: 'service', description: '', aliases: [], ...extra },
  });

  it('does not pad a place that was found with guesses at a misspelling', () => {
    const places = [place('Maternity Unit'), place('Main Gate'), place('Materials Store')];
    // "Main Gate" shares three letters in a row with "maternity" and no more.
    expect(searchPOIs(places, 'Maternity').map(({ node }) => node.poi.name)).toEqual([
      'Maternity Unit',
    ]);
    // With nothing found, the guesses are all there is, and they are offered.
    expect(searchPOIs(places, 'matternity').map(({ node }) => node.poi.name)).toContain(
      'Maternity Unit',
    );
  });

  it('finds a name with an accent from a query typed without one', () => {
    const places = [place('Courtyard Café'), place('Crèche'), place('Car Park')];
    expect(searchPOIs(places, 'cafe')[0].node.poi.name).toBe('Courtyard Café');
    expect(searchPOIs(places, 'creche')[0].node.poi.name).toBe('Crèche');
    expect(searchPOIs(places, 'Café')[0].node.poi.name).toBe('Courtyard Café');
  });
});
