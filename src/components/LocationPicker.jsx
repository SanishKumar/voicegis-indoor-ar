/**
 * LocationPicker.jsx
 * 
 * Modal overlay to let users choose their starting location.
 * Features search, category filtering, and a beautiful list.
 */

import { useState, useMemo } from 'react';
import { Search, MapPin, X, ChevronRight } from 'lucide-react';
import { useNavigation } from '../context/NavigationContext.jsx';
import { getPOIs, CATEGORIES } from '../data/buildingGraph.js';

export default function LocationPicker({ isOpen, onClose }) {
  const { actions } = useNavigation();
  const [query, setQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState(null);
  const allPOIs = useMemo(() => getPOIs(), []);

  const filteredPOIs = useMemo(() => {
    let results = allPOIs;
    if (activeCategory) {
      results = results.filter(n => n.poi.category === activeCategory);
    }
    if (query.trim()) {
      const q = query.toLowerCase();
      results = results.filter(n =>
        n.poi.name.toLowerCase().includes(q) ||
        n.poi.description?.toLowerCase().includes(q)
      );
    }
    return results;
  }, [allPOIs, query, activeCategory]);

  const handleSelect = (node) => {
    actions.setStart(node.id);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="location-picker-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="location-picker animate-slide-up">
        {/* Header */}
        <div className="lp-header">
          <div>
            <h2 className="lp-title">Set Your Location</h2>
            <p className="lp-subtitle">Where are you right now?</p>
          </div>
          <button className="lp-close" onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </div>

        {/* Search */}
        <div className="lp-search">
          <Search size={18} className="lp-search-icon" />
          <input
            type="text"
            placeholder="Search rooms, departments..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="lp-search-input"
            autoFocus
          />
        </div>

        {/* Category Chips */}
        <div className="lp-categories">
          {Object.values(CATEGORIES).map(cat => (
            <button
              key={cat.id}
              className={`lp-chip ${activeCategory === cat.id ? 'active' : ''}`}
              onClick={() => setActiveCategory(activeCategory === cat.id ? null : cat.id)}
              style={activeCategory === cat.id ? { background: cat.bgColor, color: cat.color, borderColor: cat.color } : {}}
            >
              {cat.icon} {cat.label}
            </button>
          ))}
        </div>

        {/* Results List */}
        <div className="lp-results">
          {filteredPOIs.length === 0 && (
            <div className="lp-empty">
              <MapPin size={32} />
              <p>No locations found</p>
            </div>
          )}
          {filteredPOIs.map(node => {
            const cat = CATEGORIES[node.poi.category];
            return (
              <button
                key={node.id}
                className="lp-result-item"
                onClick={() => handleSelect(node)}
              >
                <div className="lp-result-icon" style={{ background: cat?.bgColor, color: cat?.color }}>
                  {node.poi.icon}
                </div>
                <div className="lp-result-info">
                  <div className="lp-result-name">{node.poi.name}</div>
                  <div className="lp-result-desc">{node.poi.description}</div>
                </div>
                <ChevronRight size={16} className="lp-result-arrow" />
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
