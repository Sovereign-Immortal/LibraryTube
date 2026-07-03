import { fetchTranscript } from './transcript';
import { generateContent } from './ai';
import { getCachedVideo, cacheVideo } from '../shared/db';
import { UserSettings, AIContent } from '../shared/types';

// Default settings
const DEFAULT_SETTINGS: UserSettings = {
  provider: 'gemini',
  apiKey: 'AQ.Ab8RN6J1bTyIMAnl8562LdYSyvadcicZiyXpU5_eZt6zzNhnfQ',
  theme: 'auto'
};

async function getSettings(): Promise<UserSettings> {
  return new Promise((resolve) => {
    chrome.storage.local.get(['settings'], (result) => {
      const settings = { ...DEFAULT_SETTINGS, ...result.settings };
      if (settings.provider !== 'gemini') {
        settings.provider = 'gemini';
        if (!settings.apiKey) {
          settings.apiKey = 'AQ.Ab8RN6J1bTyIMAnl8562LdYSyvadcicZiyXpU5_eZt6zzNhnfQ';
        }
      }
      resolve(settings);
    });
  });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === 'getVideoContent') {
    const { videoId, segments, metadata } = message;
    
    handleGetVideoContent(videoId, segments, metadata)
      .then(content => sendResponse({ success: true, content }))
      .catch(error => sendResponse({ success: false, error: error.message }));

    return true; // Keep message channel open for async response
  }

  if (message.action === 'preFetchVideo') {
    const { videoId } = message;
    handlePreFetch(videoId)
      .then(() => sendResponse({ success: true }))
      .catch(() => sendResponse({ success: false }));
    return true;
  }
});

async function handleGetVideoContent(videoId: string, segments: any[] | null, metadata?: any): Promise<AIContent> {
  // 1. Check Cache
  const cached = await getCachedVideo(videoId);
  if (cached) {
    console.log(`[LibroTube] Serving cached content for video: ${videoId}`);
    return cached;
  }

  console.log(`[LibroTube] Generating AI content from content-script-provided segments for video: ${videoId}`);

  // 2. Get User Settings
  const settings = await getSettings();

  // 3. Generate AI Content
  const aiContent = await generateContent(videoId, segments, settings, metadata);

  // 5. Cache Content
  await cacheVideo(aiContent);

  return aiContent;
}

async function handlePreFetch(videoId: string): Promise<void> {
  const cached = await getCachedVideo(videoId);
  if (cached) return;

  try {
    let segments: any = null;
    try {
      segments = await fetchTranscript(videoId);
    } catch (err) {
      console.warn(`[LibroTube] Pre-fetch transcript extraction failed for video ${videoId}. Will use LLM fallback:`, err);
    }
    const settings = await getSettings();
    const aiContent = await generateContent(videoId, segments, settings);
    await cacheVideo(aiContent);
    console.log(`[LibroTube] Successfully pre-fetched and cached video: ${videoId}`);
  } catch (error) {
    console.warn(`[LibroTube] Pre-fetch failed for video ${videoId}:`, error);
  }
}
