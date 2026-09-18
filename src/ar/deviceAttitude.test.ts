import { describe, expect, it } from 'vitest';
import { attitudeFrom, attitudeFromEvent } from './deviceAttitude';

const close = (actual: number, expected: number) => expect(actual).toBeCloseTo(expected, 5);

/*
 * A phone held upright in portrait, looking at the horizon, is beta = 90 with
 * alpha and gamma at zero. Everything below moves from there.
 */
const UPRIGHT = { alpha: 0, beta: 90, gamma: 0 };

describe('which way the rear camera points', () => {
  it('reads a phone held upright as level, upright and looking at alpha’s zero', () => {
    const attitude = attitudeFrom(UPRIGHT.alpha, UPRIGHT.beta, UPRIGHT.gamma);
    close(attitude.pitchDegrees, 0);
    close(attitude.rollDegrees, 0);
    close(attitude.yawDegrees, 0);
  });

  it('reads tilting the phone forward as looking down', () => {
    close(attitudeFrom(0, 70, 0).pitchDegrees, -20);
    close(attitudeFrom(0, 45, 0).pitchDegrees, -45);
    // Flat on its back on a table, the camera looks straight down.
    close(attitudeFrom(0, 0, 0).pitchDegrees, -90);
    // Tipped back past upright, it looks above the horizon.
    close(attitudeFrom(0, 110, 0).pitchDegrees, 20);
  });

  it('turns the yaw the opposite way from alpha, as the platform defines it', () => {
    close(attitudeFrom(90, 90, 0).yawDegrees, 270);
    close(attitudeFrom(270, 90, 0).yawDegrees, 90);
    close(attitudeFrom(30, 90, 0).yawDegrees, 330);
  });

  it('measures the same turn whatever the tilt, which is all the yaw is used for', () => {
    const turn = (from: number, to: number) =>
      ((attitudeFrom(to, 60, 0).yawDegrees - attitudeFrom(from, 60, 0).yawDegrees + 540) % 360) -
      180;
    close(turn(0, 40), -40);
    close(turn(40, 0), 40);
  });

  it('reads the screen’s top as the way ahead when the phone points at the floor', () => {
    // Held flat, the camera axis says nothing about which way the person faces.
    close(attitudeFrom(0, 0, 0).yawDegrees, 0);
    close(attitudeFrom(90, 0, 0).yawDegrees, 270);
    // And the answer does not jump as the phone is lifted through that point.
    const steep = attitudeFrom(90, 8, 0).yawDegrees;
    expect(Math.abs(((steep - 270 + 540) % 360) - 180)).toBeLessThan(2);
  });

  it('reads the roll as the horizon tipping, positive swinging the floor right', () => {
    // Rolled clockwise as the viewer sees it: beta and gamma together, because
    // a phone near upright cannot express roll through gamma alone.
    const clockwise = attitudeFrom(0, 80, 0);
    expect(clockwise.rollDegrees).toBeCloseTo(0, 5);
    // Laid on its left edge, the screen's top points east: a quarter turn.
    close(attitudeFrom(0, 0, -90).rollDegrees, -90);
    close(attitudeFrom(0, 0, 90).rollDegrees, 90);
  });

  it('takes the interface’s own rotation out of the roll', () => {
    close(attitudeFrom(0, 0, 90, 90).rollDegrees, 0);
    close(attitudeFrom(0, 0, 0, 90).rollDegrees, -90);
  });

  it('keeps every angle in the range the projection expects', () => {
    for (let alpha = 0; alpha < 360; alpha += 17) {
      for (let beta = -180; beta <= 180; beta += 23) {
        for (let gamma = -90; gamma <= 90; gamma += 13) {
          const attitude = attitudeFrom(alpha, beta, gamma);
          expect(attitude.pitchDegrees).toBeGreaterThanOrEqual(-90.0001);
          expect(attitude.pitchDegrees).toBeLessThanOrEqual(90.0001);
          expect(attitude.rollDegrees).toBeGreaterThanOrEqual(-180.0001);
          expect(attitude.rollDegrees).toBeLessThanOrEqual(180.0001);
          expect(attitude.yawDegrees).toBeGreaterThanOrEqual(0);
          expect(attitude.yawDegrees).toBeLessThan(360);
        }
      }
    }
  });

  it('refuses an event that does not carry all three angles', () => {
    expect(attitudeFromEvent({ alpha: 0, beta: 90, gamma: 0 })).not.toBeNull();
    expect(attitudeFromEvent({ alpha: null, beta: 90, gamma: 0 })).toBeNull();
    expect(attitudeFromEvent({ alpha: 0, beta: undefined, gamma: 0 })).toBeNull();
    expect(attitudeFromEvent({ alpha: 0, beta: 90, gamma: Number.NaN })).toBeNull();
  });
});
