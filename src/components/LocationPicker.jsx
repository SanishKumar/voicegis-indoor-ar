/**
 * LocationPicker.jsx
 *
 * Modal overlay to let users choose their starting location.
 * Features search, category filtering, and a beautiful list.
 */

import { useEffect, useState, useMemo, useCallback } from 'react';
import { Search, MapPin, X, ChevronRight, QrCode } from 'lucide-react';
import { useNavigation } from '../context/NavigationContext.jsx';
import QrCheckIn from './QrCheckIn.tsx';
import { scanProblemText } from '../capture/scanProblemText.ts';

export default function LocationPicker({ isOpen, onClose }) {
  const { actions, venue } = useNavigation();
  const [query, setQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [scanProblem, setScanProblem] = useState(null);
  const allPOIs = useMemo(() => venue.getPOIs(), [venue]);
  const availableCategories = useMemo(
    () => new Set(allPOIs.map((node) => node.poi.category)),
    [allPOIs],
  );

  const filteredPOIs = useMemo(() => {
    let results = allPOIs;
    if (activeCategory) {
      results = results.filter((n) => n.poi.category === activeCategory);
    }
    if (query.trim()) {
      const q = query.toLowerCase();
      results = results.filter(
        (n) => n.poi.name.toLowerCase().includes(q) || n.poi.description?.toLowerCase().includes(q),
      );
    }
    return results;
  }, [allPOIs, query, activeCategory]);

  const handleSelect = (node) => {
    actions.setStart(node.id);
    onClose();
  };

  const handleScannedPayload = useCallback(
    (payload) => {
      const result = actions.checkInWithPayload(payload);
      if (!result.ok) {
        // Reported as refused so the scanner keeps its camera running and the
        // visitor can try another sign.
        setScanProblem(scanProblemText(result.reason));
        return false;
      }
      setScanProblem(null);
      setScanning(false);
      onClose();
      return true;
    },
    [actions, onClose],
  );

  useEffect(() => {
    if (!isOpen) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="location-picker-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="location-picker animate-slide-up"
        role="dialog"
        aria-modal="true"
        aria-labelledby="location-picker-title"
      >
        {/* Header */}
        <div className="lp-header">
          <div>
            <h2 className="lp-title" id="location-picker-title">
              Set Your Location
            </h2>
            <p className="lp-subtitle">Where are you right now?</p>
          </div>
          <button className="lp-close" onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </div>

        <button type="button" className="lp-scan-cta" onClick={() => { setScanProblem(null); setScanning(true); }}>
          <QrCode size={18} aria-hidden="true" />
          <span>Scan a check-in code</span>
        </button>

        {scanning && (
          <QrCheckIn
            onPayload={handleScannedPayload}
            onClose={() => setScanning(false)}
            hint={scanProblem}
          />
        )}

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
            aria-label="Search starting locations"
          />
        </div>

        {/* Category Chips */}
        <div className="lp-categories">
          {Object.values(venue.categories)
            .filter((cat) => availableCategories.has(cat.id))
            .map((cat) => (
              <button
                key={cat.id}
                className={`lp-chip ${activeCategory === cat.id ? 'active' : ''}`}
                onClick={() => setActiveCategory(activeCategory === cat.id ? null : cat.id)}
                aria-pressed={activeCategory === cat.id}
                style={
                  activeCategory === cat.id
                    ? { background: cat.bgColor, color: cat.color, borderColor: cat.color }
                    : {}
                }
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
          {filteredPOIs.map((node) => {
            const cat = venue.getCategory(node.poi.category);
            return (
              <button key={node.id} className="lp-result-item" onClick={() => handleSelect(node)}>
                <div
                  className="lp-result-icon"
                  style={{ background: cat?.bgColor, color: cat?.color }}
                >
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
