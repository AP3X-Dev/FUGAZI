import { Button } from './components/Button.js';
import { useAuth } from './hooks/useAuth.js';

export function App(): JSX.Element {
  const auth = useAuth();
  return Button({ label: auth.userName });
}
