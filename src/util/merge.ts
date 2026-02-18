function isPlainObject(val: unknown): val is Record<string, unknown> {
  return typeof val === "object" && val !== null && !Array.isArray(val);
}

function cloneValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => cloneValue(item));
  }

  if (isPlainObject(value)) {
    const cloned: Record<string, unknown> = {};

    for (const [key, nested] of Object.entries(value)) {
      cloned[key] = cloneValue(nested);
    }

    return cloned;
  }

  return value;
}

export function deepMerge(
  target: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const result = cloneValue(target) as Record<string, unknown>;

  for (const [key, patchValue] of Object.entries(patch)) {
    if (patchValue === null) {
      delete result[key];
      continue;
    }

    if (Array.isArray(patchValue)) {
      result[key] = cloneValue(patchValue);
      continue;
    }

    const currentValue = result[key];

    if (isPlainObject(patchValue) && isPlainObject(currentValue)) {
      result[key] = deepMerge(currentValue, patchValue);
      continue;
    }

    if (isPlainObject(patchValue)) {
      result[key] = cloneValue(patchValue);
      continue;
    }

    result[key] = patchValue;
  }

  return result;
}
