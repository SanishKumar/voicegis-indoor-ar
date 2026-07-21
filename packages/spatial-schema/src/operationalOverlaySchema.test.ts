import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import liftClosure from '../../../buildings/reference-medical-centre/operations/lift-closed.overlay.json';
import operationalOverlaySchema from '../schema/operational-overlay.schema.json';

const validate = new Ajv2020({ allErrors: true, strict: true }).compile(operationalOverlaySchema);

describe('operational overlay JSON Schema', () => {
  it('accepts the reference lift-maintenance overlay', () => {
    expect(validate(liftClosure)).toBe(true);
    expect(validate.errors).toBeNull();
  });

  it('rejects unknown properties and incomplete closure targets', () => {
    const invalid = structuredClone(liftClosure) as Record<string, unknown>;
    invalid.untrusted = true;
    const closures = invalid.closures as Array<Record<string, unknown>>;
    closures[0].target = { type: 'source' };

    expect(validate(invalid)).toBe(false);
    expect(validate.errors?.map((error) => error.keyword)).toEqual(
      expect.arrayContaining(['additionalProperties', 'required']),
    );
  });
});
