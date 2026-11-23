import { useEffect, useId, useRef, useState } from 'react';
import { ExternalLink, X } from 'lucide-react';
import { useOnline } from '../offline/useOnline';
import HospitalFloorModel from './HospitalFloorModel';
import './hospitalModelViewer.css';

const models = [
  {
    local: true,
    name: 'Hospital interior',
    author: 'neutralize',
    id: '9e77947654e24a73b6221ef2a878f766',
    slug: 'hospital',
  },
  {
    local: false,
    name: 'Flower-shaped Hospital',
    author: 'Gerpho 3D',
    id: '76c92f1057bc44bb9eb96488cae51ca7',
    slug: 'flower-shaped-hospital',
  },
] as const;

/** Only an explicit selection contacts the external viewer. Closing unloads its renderer. */
export default function HospitalModelViewer() {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const online = useOnline();
  const [model, setModel] = useState<(typeof models)[number] | null>(null);
  useEffect(() => {
    if (model && dialog.current && !dialog.current.open) dialog.current.showModal();
  }, [model]);

  return (
    <div className="map-model-library">
      <button type="button" aria-haspopup="dialog" onClick={() => setModel(models[0])}>
        Explore hospital models
      </button>
      <dialog
        ref={dialog}
        aria-labelledby={titleId}
        className="map-model-viewer"
        onClose={() => setModel(null)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') event.stopPropagation();
        }}
      >
        {model && (
          <>
            <div className="map-model-heading">
              <div>
                <h2 id={titleId}>{model.name}</h2>
                <p>Architectural reference by {model.author}</p>
              </div>
              <button
                type="button"
                aria-label="Close model"
                onClick={() => dialog.current?.close()}
              >
                <X size={20} aria-hidden="true" />
              </button>
            </div>
            <div role="group" aria-label="Choose model" className="map-model-choices">
              {models.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  aria-pressed={model.id === entry.id}
                  onClick={() => setModel(entry)}
                >
                  {entry.name}
                </button>
              ))}
            </div>
            {model.local ? (
              <HospitalFloorModel />
            ) : online ? (
              <iframe
                title={model.name}
                src={`https://sketchfab.com/models/${model.id}/embed?autostart=1`}
                allow="autoplay; fullscreen"
                allowFullScreen
                referrerPolicy="strict-origin-when-cross-origin"
              />
            ) : (
              <p role="status" className="map-model-offline">
                Connect to the internet to view this model on Sketchfab.
              </p>
            )}
            <footer>
              <span>This model shows a different hospital. Return to the map for directions.</span>
              <a
                href={`https://sketchfab.com/3d-models/${model.slug}-${model.id}`}
                target="_blank"
                rel="noreferrer"
              >
                Open on Sketchfab <ExternalLink size={14} aria-hidden="true" />
              </a>
            </footer>
          </>
        )}
      </dialog>
    </div>
  );
}
