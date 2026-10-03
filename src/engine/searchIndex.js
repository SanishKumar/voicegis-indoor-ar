/**
 * searchIndex.js
 *
 * Fuzzy search over POI names for the search panel.
 * Uses trigram similarity for typo tolerance.
 *
 * @module engine/searchIndex
 */

/**
 * Text as it is compared: lower case, and without its accents, so that
 * "cafe" finds the Café and "creche" the Crèche. Nobody types the accent on a
 * phone keyboard, and a name that only matches with it is a name not found.
 */
function folded(text) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/**
 * Generate trigrams from a string.
 */
function trigrams(str) {
  const s = `  ${folded(str)}  `;
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
export function searchPOIs(pois, query, options = {}) {
  const { category, limit = 10, threshold = 0.15 } = options;

  let candidates = [...pois];

  // Category filter
  if (category) {
    candidates = candidates.filter((p) => p.poi.category === category);
  }

  if (!query || query.trim().length === 0) {
    // Return all POIs sorted by category importance when no query
    return candidates
      .sort((a, b) => categoryPriority(a.poi.category) - categoryPriority(b.poi.category))
      .slice(0, limit)
      .map((node) => ({ node, score: 1 }));
  }

  const q = folded(query).trim();

  const matched = candidates
    .map((node) => {
      const name = folded(node.poi.name);
      const desc = folded(node.poi.description || '');
      const cat = folded(node.poi.category);
      const aliases = (node.poi.aliases || []).map(folded);

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

      // Fuzzy trigram match on name: a guess at what a misspelling meant.
      const similarity = trigramSimilarity(q, name);
      if (similarity >= threshold) {
        return { node, score: similarity * 0.8, guess: true };
      }

      return null;
    })
    .filter(Boolean);

  // A guess is for when nothing was found. Beside a place that was actually
  // asked for it is noise: "Maternity" found the Maternity Unit and, three
  // letters in common, the Main Gate.
  const found = matched.some((result) => !result.guess);
  return matched
    .filter((result) => !found || !result.guess)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ node, score }) => ({ node, score }));
}

/**
 * Get all available categories from the current POI set.
 */
export function getAvailableCategories(pois) {
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
