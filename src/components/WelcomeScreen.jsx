import { useState, useMemo } from 'react';
import { Navigation, MapPin, ArrowRight, QrCode, Search, ChevronRight } from 'lucide-react';
import { useNavigation } from '../context/NavigationContext.jsx';
import { searchPOIs } from '../engine/searchIndex.js';

export default function WelcomeScreen({ onComplete }) {
  const { actions, venue } = useNavigation();
  const buildingPackage = venue.buildingPackage;
  const [step, setStep] = useState(0); // 0 = welcome, 1 = location, 2 = destination
  const [query, setQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState(null);

  const handleStart = () => setStep(1);

  const handleLocationSelect = (nodeId) => {
    actions.setStart(nodeId);
    setStep(2);
  };

  const handleDestinationSelect = (nodeId) => {
    actions.navigateTo(nodeId);
    onComplete();
  };

  const skipToMap = () => {
    onComplete();
  };

  const pois = useMemo(() => venue.getPOIs(), [venue]);
  const landmarks = useMemo(() => {
    const preferred = pois
      .filter((n) => n.poi.category === 'entrance' || n.poi.category === 'service')
      .sort(
        (a, b) => Number(b.poi.category === 'entrance') - Number(a.poi.category === 'entrance'),
      );
    return (preferred.length > 0 ? preferred : pois).slice(0, 4);
  }, [pois]);

  const searchResults = useMemo(() => {
    if (!query && !activeCategory) return [];
    return searchPOIs(pois, query, { category: activeCategory }).slice(0, 5);
  }, [activeCategory, pois, query]);

  const quickCategories = useMemo(
    () => [...new Set(pois.map((node) => node.poi.category))].slice(0, 3),
    [pois],
  );

  return (
    <div className="welcome-screen">
      <div className="welcome-bg" />

      <div className="welcome-content">
        {step === 0 && (
          <div className="welcome-hero animate-fade-in">
            <div className="welcome-eyebrow">VenuePackage runtime / bootstrap v0</div>
            <div className="welcome-logo-container">
              <div className="welcome-logo">
                <MapPin size={30} strokeWidth={1.8} />
              </div>
            </div>

            <h1 className="welcome-title">
              Find your destination without learning the venue first.
            </h1>
            <p className="welcome-subtitle">
              Deterministic routing over the active verified package, with accessible paths and
              venue-independent spatial views.
            </p>

            <div className="welcome-cta-group">
              <button className="welcome-cta" onClick={handleStart} id="btn-welcome-start">
                Plan a route
                <ArrowRight size={18} />
              </button>
            </div>

            <div className="welcome-proof-grid" aria-label="Benchmark facts">
              <div>
                <strong>{String(buildingPackage.floors.length).padStart(2, '0')}</strong>
                <span>connected levels</span>
              </div>
              <div>
                <strong>{buildingPackage.routing.edges.length}</strong>
                <span>routing edges</span>
              </div>
              <div>
                <strong>
                  {String(buildingPackage.localizationAnchors.length).padStart(2, '0')}
                </strong>
                <span>localization anchors</span>
              </div>
            </div>

            <button className="welcome-text-action" onClick={skipToMap}>
              Open the plan directly
            </button>
          </div>
        )}

        {step === 1 && (
          <div
            className="welcome-features animate-fade-in"
            style={{ width: '100%', maxWidth: '400px' }}
          >
            <h2 className="welcome-features-title">Where are you right now?</h2>
            <p className="welcome-features-subtitle">Set your starting point to get directions.</p>

            <button
              className="welcome-feature-card"
              style={{ marginBottom: '16px', justifyContent: 'center' }}
              disabled
            >
              <QrCode size={24} style={{ marginRight: '8px' }} />
              <span style={{ fontSize: '16px', fontWeight: 'bold' }}>QR check-in · planned</span>
            </button>

            <div
              style={{
                textAlign: 'left',
                width: '100%',
                marginBottom: '8px',
                color: 'var(--color-text-muted)',
                fontSize: '14px',
              }}
            >
              Or select a landmark:
            </div>

            <div
              className="lp-results"
              style={{
                background: 'var(--color-bg-glass)',
                borderRadius: '16px',
                border: '1px solid var(--color-border)',
                padding: '8px',
                marginBottom: '24px',
              }}
            >
              {landmarks.map((node) => {
                const cat = venue.getCategory(node.poi.category);
                return (
                  <button
                    key={node.id}
                    className="lp-result-item"
                    onClick={() => handleLocationSelect(node.id)}
                  >
                    <div
                      className="lp-result-icon"
                      style={{ background: cat?.bgColor, color: cat?.color }}
                    >
                      {node.poi.icon}
                    </div>
                    <div className="lp-result-info">
                      <div className="lp-result-name">{node.poi.name}</div>
                    </div>
                    <ChevronRight size={16} className="lp-result-arrow" />
                  </button>
                );
              })}
            </div>

            <div className="welcome-cta-group">
              <button className="welcome-cta-secondary" onClick={() => setStep(0)}>
                Back
              </button>
              <button className="welcome-cta-secondary" onClick={skipToMap}>
                Skip
              </button>
            </div>

            <div className="welcome-dots">
              <span className="welcome-dot" />
              <span className="welcome-dot active" />
              <span className="welcome-dot" />
            </div>
          </div>
        )}

        {step === 2 && (
          <div
            className="welcome-features animate-fade-in"
            style={{ width: '100%', maxWidth: '400px' }}
          >
            <h2 className="welcome-features-title">Where do you need to go?</h2>
            <p className="welcome-features-subtitle">Search or pick a quick category.</p>

            <div className="lp-search" style={{ marginBottom: '16px', width: '100%' }}>
              <Search size={18} className="lp-search-icon" />
              <input
                type="text"
                placeholder="Search rooms..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="lp-search-input"
                aria-label="Search destination rooms"
              />
            </div>

            <div
              className="lp-categories"
              style={{ flexWrap: 'wrap', justifyContent: 'center', marginBottom: '16px' }}
            >
              {quickCategories.map((catId) => {
                const cat = venue.getCategory(catId);
                return (
                  <button
                    key={catId}
                    className={`lp-chip ${activeCategory === catId ? 'active' : ''}`}
                    style={{
                      background: cat.bgColor,
                      color: cat.color,
                      border: `1px solid ${cat.color}`,
                    }}
                    onClick={() =>
                      setActiveCategory((current) => (current === catId ? null : catId))
                    }
                    aria-pressed={activeCategory === catId}
                  >
                    {cat.icon} {cat.label}
                  </button>
                );
              })}
            </div>

            {(query || activeCategory) && (
              <div
                className="lp-results"
                style={{
                  background: 'var(--color-bg-glass)',
                  borderRadius: '16px',
                  border: '1px solid var(--color-border)',
                  padding: '8px',
                  marginBottom: '24px',
                  minHeight: '200px',
                }}
              >
                {searchResults.length > 0 ? (
                  searchResults.map(({ node }) => {
                    const cat = venue.getCategory(node.poi.category);
                    return (
                      <button
                        key={node.id}
                        className="lp-result-item"
                        onClick={() => handleDestinationSelect(node.id)}
                      >
                        <div
                          className="lp-result-icon"
                          style={{ background: cat?.bgColor, color: cat?.color }}
                        >
                          {node.poi.icon}
                        </div>
                        <div className="lp-result-info">
                          <div className="lp-result-name">{node.poi.name}</div>
                        </div>
                        <Navigation size={14} style={{ color: 'var(--color-accent-blue)' }} />
                      </button>
                    );
                  })
                ) : (
                  <div style={{ padding: '16px', color: 'var(--color-text-muted)' }}>
                    No results found.
                  </div>
                )}
              </div>
            )}

            <div className="welcome-cta-group">
              <button className="welcome-cta-secondary" onClick={() => setStep(1)}>
                Back
              </button>
              <button className="welcome-cta" onClick={skipToMap}>
                Just show map
              </button>
            </div>

            <div className="welcome-dots">
              <span className="welcome-dot" />
              <span className="welcome-dot" />
              <span className="welcome-dot active" />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
