import {
  ArrowUp,
  ArrowUpDown,
  ArrowUpLeft,
  ArrowUpRight,
  CircleDot,
  CornerUpLeft,
  CornerUpRight,
  Footprints,
  MapPin,
  TrendingUp,
  Undo2,
} from 'lucide-react';
import { STEP_TYPE } from '../../engine/routingCore';

const ICONS = {
  [STEP_TYPE.START]: CircleDot,
  [STEP_TYPE.STRAIGHT]: ArrowUp,
  [STEP_TYPE.TURN_LEFT]: CornerUpLeft,
  [STEP_TYPE.TURN_RIGHT]: CornerUpRight,
  [STEP_TYPE.SLIGHT_LEFT]: ArrowUpLeft,
  [STEP_TYPE.SLIGHT_RIGHT]: ArrowUpRight,
  [STEP_TYPE.U_TURN]: Undo2,
  [STEP_TYPE.ELEVATOR]: ArrowUpDown,
  [STEP_TYPE.STAIRS]: Footprints,
  [STEP_TYPE.RAMP]: TrendingUp,
  [STEP_TYPE.ESCALATOR]: TrendingUp,
  [STEP_TYPE.ARRIVE]: MapPin,
};

export default function ManeuverIcon({ type, size = 28 }) {
  const Icon = ICONS[type] ?? ArrowUp;
  return <Icon size={size} strokeWidth={2.25} aria-hidden="true" />;
}
