import { useStore } from './state/store';
import { Viewport } from './ui/Viewport';
import { Panel } from './ui/Panel';
import { BookmarkBar, FpsGate, HideHint, StatusBar, TopBar } from './ui/Chrome';
import { Framing, PhotoToolbar } from './ui/Photo';
import { CaptureModal, FirstRunHelp, HelpOverlay, LoadingScreen } from './ui/Overlays';
import { useShortcuts } from './ui/useShortcuts';

export default function App() {
  useShortcuts();
  const hidden = useStore((s) => s.uiHidden);
  const photo = useStore((s) => s.photoMode);
  const panelOpen = useStore((s) => s.panelOpen);

  return (
    <>
      <Viewport />
      <div className={'ui-root' + (panelOpen && !photo ? ' panel-open' : '')}>
        {hidden ? (
          <HideHint key="hint" />
        ) : (
          <>
            <Framing />
            {photo ? (
              <PhotoToolbar />
            ) : (
              <>
                <TopBar />
                <Panel />
                <BookmarkBar />
                <StatusBar />
              </>
            )}
            <FpsGate />
            <HelpOverlay />
          </>
        )}
        <CaptureModal />
        <FirstRunHelp />
        <LoadingScreen />
      </div>
    </>
  );
}
