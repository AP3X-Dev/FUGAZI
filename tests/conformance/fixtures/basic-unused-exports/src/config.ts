export type UsedConfig = {
  readonly label: string;
};

export type UnusedConfigA = {
  readonly mode: 'debug' | 'release';
};

export interface UnusedConfigB {
  readonly enabled: boolean;
}
