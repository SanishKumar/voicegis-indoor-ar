import type { CompiledBuildingPackage } from '@voicegis/map-compiler';
import asterionPackageJson from '../../buildings/asterion-medical-center/compiled/building.package.json';
import harborPackageJson from '../../buildings/harbor-exchange/compiled/building.package.json';
import { createCompiledBuildingRuntime } from '../data/compiledBuilding';

export const ASTERION_PACKAGE = asterionPackageJson as unknown as CompiledBuildingPackage;
export const ASTERION_RUNTIME = createCompiledBuildingRuntime(ASTERION_PACKAGE);
export const HARBOR_PACKAGE = harborPackageJson as unknown as CompiledBuildingPackage;
export const HARBOR_RUNTIME = createCompiledBuildingRuntime(HARBOR_PACKAGE);
