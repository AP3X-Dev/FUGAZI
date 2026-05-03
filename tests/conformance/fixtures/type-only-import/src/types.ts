export type UsedShape = {
  readonly id: number;
  readonly label: string;
};

export type UnusedShapeA = {
  readonly mode: 'open' | 'closed';
};

export interface UnusedShapeB {
  readonly nested: UnusedShapeA;
}
