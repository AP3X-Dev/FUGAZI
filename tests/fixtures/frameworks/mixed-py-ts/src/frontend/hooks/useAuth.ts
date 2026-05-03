export interface AuthState {
  readonly userName: string;
}

export function useAuth(): AuthState {
  return { userName: 'demo' };
}
