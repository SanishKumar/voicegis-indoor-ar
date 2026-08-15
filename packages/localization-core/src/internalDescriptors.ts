/**
 * Descriptor-safe reading for the artifact boundary.
 *
 * Nothing here invokes a getter, walks a prototype chain, or goes through an
 * iterator, and nothing here throws: reflection itself is wrapped, because a
 * Proxy trap or a revoked Proxy makes `Reflect.ownKeys` and
 * `Object.getOwnPropertyDescriptor` raise, and a decoder that promises never to
 * throw must fail closed rather than escape.
 *
 * The capture authoring boundary in `recorder.ts` applies the same rules
 * through its own throwing helpers and does not yet import these. Consolidating
 * the two is worth doing — two boundaries with two ideas of "a plain own value"
 * is how one of them ends up lenient — but it has not been done, and saying
 * otherwise would overstate what is shared.
 */

/** Membership by index. `includes` and `Set.has` are both replaceable methods. */
export function listContains(list: readonly (string | symbol)[], value: string | symbol) {
  for (let index = 0; index < list.length; index += 1) {
    if (list[index] === value) return true;
  }
  return false;
}

/**
 * The value of an own, enumerable data property — never an accessor.
 *
 * Returns a discriminated result rather than a bare value so an absent field
 * and a field holding `undefined` stay distinguishable, and so a caller can
 * tell "not there" from "there but unreadable" without a second lookup that
 * would invoke a getter it just refused to read.
 */
export type OwnRead =
  | { kind: 'value'; value: unknown }
  | { kind: 'absent' }
  | { kind: 'unreadable' };

export function readOwn(source: unknown, key: string): OwnRead {
  if (source === null || typeof source !== 'object') return { kind: 'absent' };
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = Object.getOwnPropertyDescriptor(source, key);
  } catch {
    // A Proxy trap or a revoked Proxy. Unreadable is the honest answer, and it
    // refuses; letting the exception out would break the never-throw contract
    // at exactly the boundary that promises it.
    return { kind: 'unreadable' };
  }
  if (descriptor === undefined) return { kind: 'absent' };
  if (!descriptor.enumerable || !('value' in descriptor)) return { kind: 'unreadable' };
  return { kind: 'value', value: descriptor.value };
}

/** `Reflect.ownKeys`, or nothing if the value will not answer. */
export function safeOwnKeys(value: object): (string | symbol)[] | null {
  try {
    return Reflect.ownKeys(value);
  } catch {
    return null;
  }
}

/**
 * Keys that change an object's shape rather than adding to it.
 *
 * A map decoded into `{}` swallows `__proto__` silently: the tampering
 * disappears from the snapshot, the snapshot hashes like the untampered
 * original, and verification reports valid while export writes the sanitised
 * version. Neither the input nor a legitimate floor id or survey method is ever
 * named one of these.
 */
export function isPrototypeSensitiveKey(key: string) {
  return key === '__proto__' || key === 'constructor' || key === 'prototype';
}

/** A 64-character lowercase hex digest, which is the only shape SHA-256 has. */
export function isSha256Hex(value: unknown): value is string {
  if (typeof value !== 'string' || value.length !== 64) return false;
  for (let index = 0; index < 64; index += 1) {
    const code = value.charCodeAt(index);
    const isDigit = code >= 48 && code <= 57;
    const isLower = code >= 97 && code <= 102;
    if (!isDigit && !isLower) return false;
  }
  return true;
}

/**
 * Collapses negative zero.
 *
 * `-0` and `0` are the same eight bytes of JSON, so a value flipped to `-0`
 * hashes identically and comes back out of the decoder still negative. Every
 * decoded number is normalised so what verifies is what is returned.
 */
export function normalizeZero(value: number) {
  return value === 0 ? 0 : value;
}

/** An object with no inherited shape: `Object.prototype` or nothing at all. */
export function isPlainObjectShape(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  try {
    // `Array.isArray` raises on a revoked Proxy, so even this is inside the
    // guard: every reflective step has to fail closed, not just the ones that
    // look reflective.
    if (Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

/**
 * A real array, dense, carrying nothing but its elements.
 *
 * The length is taken from its own descriptor rather than read as a property,
 * because a Proxy answers each property read however it likes and a collection
 * that reports one length while being checked and another while being copied is
 * a collection that changed size under the copy.
 */
export function denseArrayLength(value: unknown): number | null {
  try {
    if (!Array.isArray(value)) return null;
    if (Object.getPrototypeOf(value) !== Array.prototype) return null;
  } catch {
    return null;
  }
  const lengthRead = readOwnUnchecked(value, 'length');
  if (lengthRead === null) return null;
  const length = lengthRead;
  if (typeof length !== 'number' || !Number.isSafeInteger(length) || length < 0) return null;

  const keys = safeOwnKeys(value);
  if (keys === null || keys.length !== length + 1 || !listContains(keys, 'length')) return null;
  for (let index = 0; index < length; index += 1) {
    if (readOwn(value, String(index)).kind !== 'value') return null;
  }
  return length;
}

/** `length` is not enumerable, so it needs its own descriptor read. */
function readOwnUnchecked(value: object, key: string): unknown {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !('value' in descriptor)) return null;
    return descriptor.value;
  } catch {
    return null;
  }
}

/** Own keys that the caller did not declare, sorted for stable diagnostics. */
export function undeclaredKeys(value: object, allowed: readonly string[]) {
  const keys = safeOwnKeys(value);
  if (keys === null) return ['<unreadable>'];
  const extra: string[] = [];
  for (let index = 0; index < keys.length; index += 1) {
    if (!listContains(allowed, keys[index])) extra.push(String(keys[index]));
  }
  return extra.sort();
}

/** A number JSON can carry. `NaN` and both infinities all serialise as `null`. */
export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** A count: finite, integral, non-negative, and exactly representable. */
export function isSafeCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * Names a rejected value in a diagnostic without coercing it.
 *
 * `String(value)` runs `Symbol.toPrimitive`, `valueOf` or `toString`, so
 * formatting an invalid field invoked caller code — and a throwing
 * `Symbol.toPrimitive` escaped the validator that had just refused to trust the
 * value. A string is quoted because its content is the useful part; anything
 * else is described by type only.
 */
export function describeValue(value: unknown) {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean') {
    return Number.isNaN(value as number) ? 'NaN' : `${value as number | boolean}`;
  }
  if (typeof value === 'bigint') return 'a bigint';
  if (typeof value === 'symbol') return 'a symbol';
  if (typeof value === 'function') return 'a function';
  if (typeof value === 'undefined') return 'nothing';
  try {
    // Even this raises on a revoked Proxy. A diagnostic is the last place that
    // should be able to throw: it runs precisely when the value has already
    // been judged untrustworthy.
    return Array.isArray(value) ? 'an array' : 'an object';
  } catch {
    return 'an unreadable value';
  }
}
