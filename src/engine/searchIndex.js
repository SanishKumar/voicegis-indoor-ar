/**
 * searchIndex.js
 *
 * Fuzzy search over POI names for the search panel.
 * Uses trigram similarity for typo tolerance.
 *
 * @module engine/searchIndex
 */

import { getPOIs } from '../data/compiledBuilding';

/**
 * Generate trigrams from a string.
 */
function trigrams(str) {
  const s = `  ${str.toLowerCase()}  `;
  const result = new Set();
  for (let i = 0; i < s.length - 2; i++) {
    result.add(s.substring(i, i + 3));
  }
  return result;
}

/**
 * Calculate trigram similarity between two strings (0 to 1).
 */
function trigramSimilarity(a, b) {
  const tA = trigrams(a);
  const tB = trigrams(b);
  let intersection = 0;
  for (const t of tA) {
    if (tB.has(t)) intersection++;
  }
  const union = tA.size + tB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Search POIs by query string with fuzzy matching.
 *
 * @param {string} query - Search query
 * @param {object} [options]
 * @param {string} [options.category] - Filter by category ID
 * @param {number} [options.limit=10] - Maximum results
 * @param {number} [options.threshold=0.15] - Minimum similarity threshold
 * @returns {Array<{ node: object, score: number }>}
 */
export function searchPOIs(query, options = {}) {
  const { category, limit = 10, threshold = 0.15 } = options;

  let pois = getPOIs();

  // Category filter
  if (category) {
    pois = pois.filter((p) => p.poi.category === category);
  }

  if (!query || query.trim().length === 0) {
    // Return all POIs sorted by category importance when no query
    return pois
      .sort((a, b) => categoryPriority(a.poi.category) - categoryPriority(b.poi.category))
      .slice(0, limit)
      .map((node) => ({ node, score: 1 }));
  }

  const q = query.toLowerCase().trim();

  const results = pois
    .map((node) => {
      const name = node.poi.name.toLowerCase();
      const desc = (node.poi.description || '').toLowerCase();
      const cat = node.poi.category.toLowerCase();
      const aliases = (node.poi.aliases || []).map((alias) => alias.toLowerCase());

      // Exact prefix match gets highest score
      if (name.startsWith(q)) {
        return { node, score: 1.0 };
      }

      // Contains match
      if (name.includes(q)) {
        return { node, score: 0.85 };
      }

      if (aliases.some((alias) => alias === q)) {
        return { node, score: 0.95 };
      }

      if (aliases.some((alias) => alias.includes(q))) {
        return { node, score: 0.8 };
      }

      // Description match
      if (desc.includes(q)) {
        return { node, score: 0.6 };
      }

      // Category match
      if (cat.includes(q)) {
        return { node, score: 0.5 };
      }

      // Fuzzy trigram match on name
      const similarity = trigramSimilarity(q, name);
      if (similarity >= threshold) {
        return { node, score: similarity * 0.8 };
      }

      return null;
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return results;
}

/**
 * Get all available categories from the current POI set.
 */
export function getAvailableCategories() {
  const pois = getPOIs();
  const catSet = new Set(pois.map((p) => p.poi.category));
  return Array.from(catSet).sort((a, b) => categoryPriority(a) - categoryPriority(b));
}

/**
 * Category display priority (lower = shown first).
 */
function categoryPriority(cat) {
  const order = {
    emergency: 0,
    medical: 1,
    diagnostic: 2,
    pharmacy: 3,
    service: 4,
    entrance: 5,
    restroom: 6,
    admin: 7,
  };
  return order[cat] ?? 99;
}
