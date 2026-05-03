export function mergeObjects<A extends object, B extends object>(a: A, b: B): A & B {
  return { ...a, ...b };
}

export function unusedObjectsHelper(): {} {
  return {};
}
