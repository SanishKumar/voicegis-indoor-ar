import {
  Armchair,
  Baby,
  Briefcase,
  DoorOpen,
  FlaskConical,
  GraduationCap,
  Cross,
  Info,
  MapPin,
  Microscope,
  Pill,
  Stethoscope,
  Bath,
  Trees,
  Utensils,
} from 'lucide-react';

const icons = {
  medical: Stethoscope,
  diagnostic: Microscope,
  pharmacy: Pill,
  service: Info,
  entrance: DoorOpen,
  restroom: Bath,
  staff: Briefcase,
  emergency: Cross,
  landmark: Trees,
  food: Utensils,
  family: Baby,
  research: FlaskConical,
  education: GraduationCap,
  waiting: Armchair,
};

/** Text next to the symbol supplies the accessible place or category name. */
export default function PlaceIcon({ category, size = 18 }) {
  const Icon = icons[category] ?? MapPin;
  return <Icon size={size} strokeWidth={1.75} aria-hidden="true" />;
}
