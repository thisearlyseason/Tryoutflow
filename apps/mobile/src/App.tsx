import { SafeAreaProvider } from 'react-native-safe-area-context';
import Workspace from './Workspace';

export default function App() {
  return (
    <SafeAreaProvider>
      <Workspace />
    </SafeAreaProvider>
  );
}
