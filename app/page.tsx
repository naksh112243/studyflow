"use client";

import { useEngineStore } from "@/store/engine-store";
import { HomeScreen } from "@/components/screens/home-screen";
import { SetupScreen } from "@/components/screens/setup-screen";

export default function Home() {
  const appState = useEngineStore(state => state.appState);
  const setupTimetableId = useEngineStore(state => state.setupTimetableId);
  const refreshView = useEngineStore(state => state.refreshView);
  
  if (appState === "setup") {
    return (
      <SetupScreen
        timetableId={setupTimetableId || undefined}
        onCancel={() => {
          void refreshView();
        }}
      />
    );
  }

  return <HomeScreen />;
}
