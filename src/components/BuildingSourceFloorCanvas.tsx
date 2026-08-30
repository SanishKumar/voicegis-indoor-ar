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
            <Rect width={dimensions.width} height={dimensions.height} fill="#fff9f0" />

            {gridX.map((x) => {
              const [canvasX] = toCanvas([x, bounds.minY]);
              return (
                <Line
                  key={`grid-x-${x}`}
                  points={[canvasX, offsetY, canvasX, offsetY + drawnHeight]}
                  stroke="rgba(0, 6, 9, 0.10)"
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
                  stroke="rgba(0, 6, 9, 0.10)"
                  strokeWidth={1}
                  listening={false}
                />
              );
            })}

            <Line
              points={flatPoints(activeFloor.outline)}
              closed
              fill="#fff9f0"
              stroke="#000609"
              strokeWidth={3}
              lineJoin="round"
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
                  stroke={selected ? '#0a65db' : space.public ? 'rgba(0, 6, 9, 0.28)' : '#000609'}
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
                  perfectDrawEnabled={false}
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
                  fill="#fff9f0"
                  stroke="#000609"
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
                  fill="#0a65db"
                  stroke="#fff9f0"
                  strokeWidth={1.5}
                  listening={false}
                />
              );
            })}

            {/*
             * Room names are drawn last and clear of the centre.
             *
             * They used to be a fixed 124px box centred on the space, over a
             * POI marker painted afterwards. Both faults showed at once: the
             * marker punched a hole through the middle of the name, so
             * "Emergency Reception" read as "Emergenc●Reception"; and a 124px
             * box around a 70px room ran the name straight into its
             * neighbours, so the lower corridor read as one unbroken string.
             *
             * A name is now confined to the width of the room it belongs to
             * and sits above the marker. Rooms too narrow to show a useful
             * amount are left unlabelled rather than given a stub - the space
             * picker above the canvas names them exactly, and a fragment reads
             * as a different room.
             */}
            {floorSpaces.map((space) => {
              const canvasPoints = space.polygon.map(toCanvas);
              const left = Math.min(...canvasPoints.map((point) => point[0]));
              const right = Math.max(...canvasPoints.map((point) => point[0]));
              const width = right - left - 8;
              const selected = selectedSpace?.id === space.id;
              if (width < 40 && !selected) return null;

              const fontSize = Math.max(9, Math.min(12, scale * 0.38));
              // Two lines, because a room is taller than it is wide and most of
              // these names are two words. Truncating "Emergency Reception" to
              // "Emergency…" to fit one line throws away the half that
              // distinguishes it from the next room along. Bottom-aligned in a
              // fixed block so one-line and two-line names share a baseline
              // just above the marker.
              const block = fontSize * 2.5;
              const centre = toCanvas(polygonCentre(space.polygon));
              return (
                <Text
                  key={`label-${space.id}`}
                  x={left + 4}
                  y={centre[1] - block - 5}
                  width={Math.max(width, 40)}
                  height={block}
                  text={space.name}
                  align="center"
                  verticalAlign="bottom"
                  fontFamily="Inter, Segoe UI, sans-serif"
                  fontSize={fontSize}
                  lineHeight={1.15}
                  fontStyle={selected ? 'bold' : 'normal'}
                  fill="#000609"
                  ellipsis
                  wrap="word"
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
                  fill="#fff9f0"
                  stroke="#0a65db"
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
