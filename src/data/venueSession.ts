import type { CompiledBuildingRuntime } from './compiledBuilding';
import type { GraphNode } from '../engine/routingCore';

export interface VenueScopedState {
  navigation: {
    venueKey: string;
    startNodeId: string;
    destinationNodeId: string | null;
    route: unknown | null;
    activeView: string;
    activeFloorId: string;
    selectedPOI: GraphNode | null;
    currentStepIndex: number;
    navStatus: string;
  };
  operationalOverlay: unknown | null;
  localizationEstimate: unknown | null;
}

export function createVenueScopedState(venue: CompiledBuildingRuntime): VenueScopedState {
  return {
    navigation: {
      venueKey: venue.key,
      startNodeId: venue.config.defaultStartNode,
      destinationNodeId: null,
      route: null,
      activeView: 'map',
      activeFloorId: venue.config.defaultFloorId,
      selectedPOI: null,
      currentStepIndex: 0,
      navStatus: 'idle',
    },
    operationalOverlay: null,
    localizationEstimate: null,
  };
}
