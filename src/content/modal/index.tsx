import React from 'react';
import { createRoot } from 'react-dom/client';
import ReaderModal from './ReaderModal';
// @ts-ignore
import modalStyles from './ReaderModal.css?inline';

export function mountReaderModal(
  shadowRoot: ShadowRoot,
  videoId: string,
  onUnlock: () => void,
  onClose: () => void
): () => void {
  // 1. Inject styling into shadow root
  const styleEl = document.createElement('style');
  styleEl.textContent = modalStyles;
  shadowRoot.appendChild(styleEl);

  // 2. Create app root container inside shadow root
  const appContainer = document.createElement('div');
  appContainer.className = 'librotube-modal-wrapper';
  shadowRoot.appendChild(appContainer);

  const root = createRoot(appContainer);
  root.render(
    <React.StrictMode>
      <ReaderModal
        videoId={videoId}
        onUnlock={onUnlock}
        onClose={onClose}
      />
    </React.StrictMode>
  );

  // Return cleanup/unmount callback
  return () => {
    root.unmount();
    appContainer.remove();
    styleEl.remove();
  };
}
