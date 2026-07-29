import { useEffect, useMemo, useRef, useState } from 'react';
import { Circle, Layer, Line, Rect, Stage, Text } from 'react-konva';
import type Konva from 'konva';
import { Grid3X3, LockKeyhole, RotateCcw, Undo2 } from 'lucide-react';
import type { BuildingSource, Coordinate2D, SpaceType } from '@voicegis/spatial-schema';
import {
  FLOOR_CANVAS_SNAP_METERS,
  getFloorCanvasBounds,
  getSpacesForFloor,
  snapPoint,
  updateSpacePolygonVertex,
} from '../studio/floorCanvasModel';

interface BuildingSourceFloorCanvasProps {
  source: BuildingSource;
  canUndo: boolean;
  dirty: boolean;
  onBeginEdit: () => void;
  onSourceChange: (source: BuildingSource) => void;
  onUndo: () => void;
  onReset: () => void;
}

const CANVAS_PADDING = 54;
const GRID_METERS = 1;

const SPACE_COLORS: Record<SpaceType, string> = {
  entrance: '#dceff0',
  room: '#f3efe7',
  corridor: '#ffffff',
  lobby: '#eaf1eb',
  service: '#e5edf1',
  restricted: '#f3e1e3',
  'vertical-circulation': '#e0e9e5',
};

function polygonCentre(polygon: Coordinate2D[]): Coordinate2D {
  const total = polygon.reduce(
    (result, point) => [result[0] + point[0], result[1] + point[1]] as Coordinate2D,
    [0, 0],
  );
  return [total[0] / polygon.length, total[1] / polygon.length];
}

function range(start: number, end: number, step: number) {
  const values: number[] = [];
  const first = Math.ceil(start / step) * step;
  for (let value = first; value <= end; value += step) values.push(value);
  return values;
}

export default function BuildingSourceFloorCanvas({
  source,
  canUndo,
  dirty,
  onBeginEdit,
  onSourceChange,
  onUndo,
  onReset,
}: BuildingSourceFloorCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sourceRef = useRef(source);
  const editStartedRef = useRef(false);
  const [dimensions, setDimensions] = useState({ width: 820, height: 620 });
  const [selectedFloorId, setSelectedFloorId] = useState(source.floors[0]?.id ?? '');
  const [selectedSpaceId, setSelectedSpaceId] = useState<string | null>(null);
  const [snapEnabled, setSnapEnabled] = useState(true);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return undefined;
    const observer = new ResizeObserver(([entry]) => {
      setDimensions({
        width: Math.max(1, entry.contentRect.width),
        height: Math.max(1, entry.contentRect.height),
      });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    sourceRef.current = source;
  }, [source]);

  const activeFloor =
    source.floors.find((floor) => floor.id === selectedFloorId) ?? source.floors[0];
  const floorSpaces = useMemo(
    () => (activeFloor ? getSpacesForFloor(source, activeFloor.id) : []),
    [activeFloor, source],
  );
  const selectedSpace = floorSpaces.find((space) => space.id === selectedSpaceId) ?? null;

  if (!activeFloor) {
    return <div className="studio-canvas-empty">Add a floor before using the visual editor.</div>;
  }

  const bounds = getFloorCanvasBounds(activeFloor);
  const availableWidth = Math.max(1, dimensions.width - CANVAS_PADDING * 2);
  const availableHeight = Math.max(1, dimensions.height - CANVAS_PADDING * 2);
  const scale = Math.max(
    0.1,
    Math.min(availableWidth / bounds.width, availableHeight / bounds.height),
  );
  const drawnWidth = bounds.width * scale;
  const drawnHeight = bounds.height * scale;
  const offsetX = (dimensions.width - drawnWidth) / 2;
  const offsetY = (dimensions.height - drawnHeight) / 2;

  const toCanvas = ([x, y]: Coordinate2D): Coordinate2D => [
    offsetX + (x - bounds.minX) * scale,
    offsetY + (y - bounds.minY) * scale,
  ];
  const toWorld = ([x, y]: Coordinate2D): Coordinate2D => [
    bounds.minX + (x - offsetX) / scale,
    bounds.minY + (y - offsetY) / scale,
  ];
  const flatPoints = (points: Coordinate2D[]) => points.flatMap(toCanvas);
  const gridX = range(bounds.minX, bounds.maxX, GRID_METERS);
  const gridY = range(bounds.minY, bounds.maxY, GRID_METERS);
  const floorPortals = source.portals.filter((portal) => portal.floorId === activeFloor.id);
  const floorPois = source.pois.filter((poi) => poi.floorId === activeFloor.id);

  const moveVertex = (
    spaceId: string,
    vertexIndex: number,
    event: Konva.KonvaEventObject<DragEvent>,
  ) => {
    event.cancelBubble = true;
    const rawPoint = toWorld([event.target.x(), event.target.y()]);
    const point = snapEnabled
      ? snapPoint(rawPoint, FLOOR_CANVAS_SNAP_METERS)
      : ([Number(rawPoint[0].toFixed(2)), Number(rawPoint[1].toFixed(2))] as Coordinate2D);
    const canvasPoint = toCanvas(point);
    event.target.position({ x: canvasPoint[0], y: canvasPoint[1] });
    const currentSource = sourceRef.current;
    const currentPoint = currentSource.spaces.find((space) => space.id === spaceId)?.polygon[
      vertexIndex
    ];
    if (currentPoint?.[0] === point[0] && currentPoint[1] === point[1]) return;
    if (!editStartedRef.current) {
      onBeginEdit();
      editStartedRef.current = true;
    }
    const nextSource = updateSpacePolygonVertex(currentSource, spaceId, vertexIndex, point);
    sourceRef.current = nextSource;
    onSourceChange(nextSource);
  };

  return (
    <div className="studio-floor-canvas-shell">
      <div className="studio-canvas-toolbar">
        <label>
          <span>Floor</span>
          <select
            value={activeFloor.id}
            onChange={(event) => {
              setSelectedFloorId(event.target.value);
              setSelectedSpaceId(null);
            }}
          >
            {source.floors.map((floor) => (
              <option key={floor.id} value={floor.id}>
                {floor.level === 0 ? 'G' : `L${floor.level}`} · {floor.name}
              </option>
            ))}
          </select>
        </label>

        <label className="studio-space-select">
          <span>Space</span>
          <select
            value={selectedSpace?.id ?? ''}
            onChange={(event) => setSelectedSpaceId(event.target.value || null)}
          >
            <option value="">Select on canvas</option>
            {floorSpaces.map((space) => (
              <option key={space.id} value={space.id}>
                {space.name}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          className={snapEnabled ? 'active' : ''}
          aria-pressed={snapEnabled}
          onClick={() => setSnapEnabled((value) => !value)}
        >
          <Grid3X3 size={14} />
          Snap {FLOOR_CANVAS_SNAP_METERS} m
        </button>
        <button type="button" onClick={onUndo} disabled={!canUndo}>
          <Undo2 size={14} />
          Undo
        </button>
        <button type="button" onClick={onReset} disabled={!dirty}>
          <RotateCcw size={14} />
          Reset
        </button>
      </div>

      <div className="studio-floor-canvas" ref={containerRef}>
        <Stage
          width={dimensions.width}
          height={dimensions.height}
          onMouseDown={(event) => {
            if (event.target === event.target.getStage()) setSelectedSpaceId(null);
          }}
          onTouchStart={(event) => {
            if (event.target === event.target.getStage()) setSelectedSpaceId(null);
          }}
        >
          <Layer>
            <Rect width={dimensions.width} height={dimensions.height} fill="#f4f6f3" />

            {gridX.map((x) => {
              const [canvasX] = toCanvas([x, bounds.minY]);
              return (
                <Line
                  key={`grid-x-${x}`}
                  points={[canvasX, offsetY, canvasX, offsetY + drawnHeight]}
                  stroke="#dfe5e0"
                  strokeWidth={1}
                  listening={false}
                />
              );
            })}
            {gridY.map((y) => {
              const [, canvasY] = toCanvas([bounds.minX, y]);
              return (
                <Line
                  key={`grid-y-${y}`}
                  points={[offsetX, canvasY, offsetX + drawnWidth, canvasY]}
                  stroke="#dfe5e0"
                  strokeWidth={1}
                  listening={false}
                />
              );
            })}

            <Line
              points={flatPoints(activeFloor.outline)}
              closed
              fill="#fafbf8"
              stroke="#53615b"
              strokeWidth={3}
              lineJoin="round"
              shadowColor="rgba(23, 33, 31, 0.12)"
              shadowBlur={12}
              shadowOffsetY={4}
              listening={false}
            />

            {floorSpaces.map((space) => {
              const selected = selectedSpace?.id === space.id;
              return (
                <Line
                  key={space.id}
                  points={flatPoints(space.polygon)}
                  closed
                  fill={SPACE_COLORS[space.type]}
                  stroke={selected ? '#176b5b' : space.public ? '#aeb9b3' : '#bf727b'}
                  strokeWidth={selected ? 3 : 1.35}
                  lineJoin="round"
                  onClick={() => setSelectedSpaceId(space.id)}
                  onTap={() => setSelectedSpaceId(space.id)}
                  onMouseEnter={(event) => {
                    event.target.getStage()!.container().style.cursor = 'pointer';
                  }}
                  onMouseLeave={(event) => {
                    event.target.getStage()!.container().style.cursor = 'default';
                  }}
                  shadowColor={selected ? 'rgba(23, 107, 91, 0.24)' : undefined}
                  shadowBlur={selected ? 10 : 0}
                  shadowEnabled={selected}
                  perfectDrawEnabled={false}
                />
              );
            })}

            {floorSpaces.map((space) => {
              const centre = toCanvas(polygonCentre(space.polygon));
              return (
                <Text
                  key={`label-${space.id}`}
                  x={centre[0] - 62}
                  y={centre[1] - 6}
                  width={124}
                  text={space.name}
                  align="center"
                  fontFamily="Inter, Segoe UI, sans-serif"
                  fontSize={Math.max(9, Math.min(12, scale * 0.38))}
                  fontStyle={selectedSpace?.id === space.id ? 'bold' : 'normal'}
                  fill="#34413c"
                  ellipsis
                  listening={false}
                />
              );
            })}

            {floorPortals.map((portal) => {
              const point = toCanvas(portal.position);
              return (
                <Circle
                  key={portal.id}
                  x={point[0]}
                  y={point[1]}
                  radius={4}
                  fill="#ffffff"
                  stroke="#65736d"
                  strokeWidth={2}
                  listening={false}
                />
              );
            })}
            {floorPois.map((poi) => {
              const point = toCanvas(poi.position);
              return (
                <Circle
                  key={poi.id}
                  x={point[0]}
                  y={point[1]}
                  radius={3.5}
                  fill="#df5b3f"
                  stroke="#ffffff"
                  strokeWidth={1.5}
                  listening={false}
                />
              );
            })}

            {selectedSpace?.polygon.map((point, vertexIndex) => {
              const canvasPoint = toCanvas(point);
              return (
                <Circle
                  key={`${selectedSpace.id}-vertex-${vertexIndex}`}
                  x={canvasPoint[0]}
                  y={canvasPoint[1]}
                  radius={7}
                  fill="#ffffff"
                  stroke="#176b5b"
                  strokeWidth={3}
                  draggable
                  hitStrokeWidth={12}
                  onDragStart={(event) => {
                    event.cancelBubble = true;
                    editStartedRef.current = false;
                  }}
                  onDragMove={(event) => moveVertex(selectedSpace.id, vertexIndex, event)}
                  onDragEnd={(event) => moveVertex(selectedSpace.id, vertexIndex, event)}
                  onMouseEnter={(event) => {
                    event.target.getStage()!.container().style.cursor = 'move';
                  }}
                  onMouseLeave={(event) => {
                    event.target.getStage()!.container().style.cursor = 'default';
                  }}
                />
              );
            })}
          </Layer>
        </Stage>

        <div className="studio-canvas-instructions">
          {selectedSpace ? (
            <>
              <strong>{selectedSpace.name}</strong>
              <span>{selectedSpace.polygon.length} vertices · drag a green handle to reshape</span>
            </>
          ) : (
            <>
              <strong>Select a space</strong>
              <span>Space geometry is editable; reference markers remain locked</span>
            </>
          )}
        </div>
        <div className="studio-canvas-legend">
          <span>
            <i className="studio-legend-space" /> Space
          </span>
          <span>
            <i className="studio-legend-poi" /> POI
          </span>
          <span>
            <i className="studio-legend-portal" /> Portal
          </span>
          <span>
            <LockKeyhole size={11} /> context locked
          </span>
        </div>
      </div>
    </div>
  );
}
