import React from 'react';
import ReactDOM from 'react-dom/client';
import { AppRuntime } from '@/components/shared/app-runtime';
import { useEngineStore } from '@/store/engine-store';
import { HomeScreen } from '@/components/screens/home-screen';
import { SetupScreen } from '@/components/screens/setup-screen';
import './globals.css';

function App() {
  const [mounted, setMounted] = React.useState(false);
  const appState = useEngineStore(state => state.appState);
  const setupTimetableId = useEngineStore(state => state.setupTimetableId);
  const cancelSetup = useEngineStore(state => state.cancelSetup);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <>
      <AppRuntime />
      {appState === 'setup' ? (
        <SetupScreen
          timetableId={setupTimetableId || undefined}
          onCancel={() => {
            cancelSetup();
          }}
        />
      ) : (
        <HomeScreen />
      )}
    </>
  );
}

const rootElement = document.getElementById('root');
if (rootElement) {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}
