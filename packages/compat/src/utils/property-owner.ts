/** Finds the actual prototype owner so Blob methods also apply to File and sliced blobs.
 * @param target - Prototype where lookup begins.
 * @param key - Existing property to locate.
 * @returns The object containing the property's own descriptor.
 * @example propertyOwner(window.Blob.prototype, 'text');
 */
export function propertyOwner(target: object, key: PropertyKey): object {
  let current: object | null = target;
  while (current) {
    if (Object.hasOwn(current, key)) return current;
    current = Object.getPrototypeOf(current);
  }
  throw new TypeError(`Missing property: ${String(key)}`);
}
