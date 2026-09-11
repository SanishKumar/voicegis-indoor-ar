import type { CompiledBuildingRuntime } from './compiledBuilding';
import type { VisitorJourneyState } from '../navigation/visitorJourney';

export interface VenueScopedState {
  navigation: VisitorJourneyState;
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
      locationFloorId: venue.config.defaultFloorId,
      locationBasis: 'default',
      selectedPOI: null,
      previewStepIndex: 0,
      navStatus: 'idle',
      arrivalSource: null,
    },
    operationalOverlay: null,
    localizationEstimate: null,
  };
}
