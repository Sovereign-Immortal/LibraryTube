import { extractVideoId } from '../shared/utils';
import { mountReaderModal } from './modal/index';
import './content.css';

let isLocked = true;
let currentVideoId: string | null = null;
let unmountCallback: (() => void) | null = null;
let videoPlayListener: (() => void) | null = null;

// Initial check at document_start
function init() {
  const videoId = extractVideoId(window.location.href);
  if (videoId) {
    // Hide player immediately to prevent flash
    document.documentElement.setAttribute('data-librotube-active', 'true');
    document.documentElement.setAttribute('data-librotube-locked', 'true');
  }

  // Listen for YouTube's single page navigation events
  window.addEventListener('yt-navigate-finish', handleUrlChange);
  
  // Backup polling to verify state
  setInterval(checkVideoState, 1000);
  
  // Initial page run
  handleUrlChange();
}

function handleUrlChange() {
  const videoId = extractVideoId(window.location.href);
  
  if (!videoId) {
    cleanup();
    return;
  }

  if (videoId === currentVideoId) {
    // URL updated but video ID is the same (e.g. query params, comment links)
    return;
  }

  cleanup();
  
  currentVideoId = videoId;
  isLocked = true;

  document.documentElement.setAttribute('data-librotube-active', 'true');
  document.documentElement.setAttribute('data-librotube-locked', 'true');

  setupLockAndModal(videoId);
}

function setupLockAndModal(videoId: string) {
  // 1. Create or get root container
  let container = document.getElementById('librotube-root-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'librotube-root-container';
    document.body.appendChild(container);
  }
  container.style.display = ''; // Reset display style in case it was hidden

  // 2. Attach Shadow Root if not already attached
  let shadowRoot = container.shadowRoot;
  if (!shadowRoot) {
    shadowRoot = container.attachShadow({ mode: 'open' });
  } else {
    // Clear shadow root content
    shadowRoot.innerHTML = '';
  }

  // 3. Setup video locking
  lockVideoElement();

  // 4. Mount React Application
  unmountCallback = mountReaderModal(
    shadowRoot,
    videoId,
    handleUnlock,
    handleClose
  );
}

function lockVideoElement() {
  const video = document.querySelector('video.html5-main-video') as HTMLVideoElement;
  if (!video) {
    // Try again in next cycle if not loaded yet
    setTimeout(lockVideoElement, 100);
    return;
  }

  // Pause immediately
  video.pause();

  // Remove old listener if exists
  if (videoPlayListener) {
    video.removeEventListener('play', videoPlayListener);
  }

  // Intercept play calls
  videoPlayListener = () => {
    if (isLocked) {
      video.pause();
    }
  };
  video.addEventListener('play', videoPlayListener);
}

function checkVideoState() {
  if (!currentVideoId || !isLocked) return;

  const video = document.querySelector('video.html5-main-video') as HTMLVideoElement;
  if (video && !video.paused) {
    video.pause();
  }
}

function handleUnlock() {
  isLocked = false;
  document.documentElement.setAttribute('data-librotube-locked', 'false');
  
  // Hide modal container
  const container = document.getElementById('librotube-root-container');
  if (container) {
    container.style.display = 'none';
  }
  
  // Play the video
  const video = document.querySelector('video.html5-main-video') as HTMLVideoElement;
  if (video) {
    if (videoPlayListener) {
      video.removeEventListener('play', videoPlayListener);
      videoPlayListener = null;
    }
    video.play().catch(err => console.warn('Could not auto-play video on unlock:', err));
  }
}

function handleClose() {
  // Closing the modal returns user to watch page but keeps video locked/paused
  const container = document.getElementById('librotube-root-container');
  if (container) {
    container.style.display = 'none';
  }
}

function cleanup() {
  currentVideoId = null;
  isLocked = false;
  
  document.documentElement.setAttribute('data-librotube-active', 'false');
  document.documentElement.setAttribute('data-librotube-locked', 'false');

  if (unmountCallback) {
    unmountCallback();
    unmountCallback = null;
  }

  const video = document.querySelector('video.html5-main-video') as HTMLVideoElement;
  if (video && videoPlayListener) {
    video.removeEventListener('play', videoPlayListener);
    videoPlayListener = null;
  }

  const container = document.getElementById('librotube-root-container');
  if (container) {
    container.remove();
  }
}

// Start extension execution
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
