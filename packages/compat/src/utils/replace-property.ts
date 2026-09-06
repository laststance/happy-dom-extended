import type { DisposeCompatibility } from '../types.ts';

interface PropertyPatch {
  references: number;
  original: PropertyDescriptor | undefined;
}

const installedPatches = new WeakMap<object, Map<PropertyKey, PropertyPatch>>();

/** Temporarily replaces a property for an installer, retaining shared prototypes until their last environment closes.
 * @param target - Object that owns the property.
 * @param key - Property to replace.
 * @param descriptor - Replacement property attributes.
 * @returns An idempotent function that releases this replacement.
 * @example const restore = replaceProperty(window, 'example', { value: 1 }); restore();
 */
export function replaceProperty(
  target: object,
  key: PropertyKey,
  descriptor: PropertyDescriptor,
): DisposeCompatibility {
  const patches =
    installedPatches.get(target) ?? new Map<PropertyKey, PropertyPatch>();
  const existing = patches.get(key);
  const patch = existing ?? {
    references: 0,
    original: Object.getOwnPropertyDescriptor(target, key),
  };
  if (!existing) {
    Object.defineProperty(target, key, { configurable: true, ...descriptor });
    patches.set(key, patch);
    installedPatches.set(target, patches);
  }
  patch.references += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    patch.references -= 1;
    // Other environments may still use this shared Happy DOM prototype.
    if (patch.references > 0) return;
    if (patch.original) Object.defineProperty(target, key, patch.original);
    else Reflect.deleteProperty(target, key);
    patches.delete(key);
    if (patches.size === 0) installedPatches.delete(target);
  };
}
