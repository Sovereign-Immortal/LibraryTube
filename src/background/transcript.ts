import { TranscriptSegment } from '../shared/types';

export async function fetchTranscript(videoId: string, _passedPlayerResponse?: any): Promise<TranscriptSegment[]> {
  try {
    console.log(`[LibroTube] Fetching transcript for video: ${videoId}`);
    
    // Extract INNERTUBE_API_KEY
    let apiKey = '';
    
    // 1. Try to find the API key from the page DOM first (if we are in a content script context)
    if (typeof document !== 'undefined') {
      try {
        const scripts = document.querySelectorAll('script');
        for (const script of Array.from(scripts)) {
          const text = script.textContent || '';
          const match = text.match(/"INNERTUBE_API_KEY":\s*"([a-zA-Z0-9_-]+)"/);
          if (match && match[1]) {
            apiKey = match[1];
            break;
          }
        }
        
        if (!apiKey) {
          const bodyMatch = document.documentElement.innerHTML.match(/"INNERTUBE_API_KEY":\s*"([a-zA-Z0-9_-]+)"/);
          if (bodyMatch && bodyMatch[1]) {
            apiKey = bodyMatch[1];
          }
        }
      } catch (e) {
        console.warn('Error extracting API key from page DOM:', e);
      }
    }

    // 2. Fetch the watch page HTML to extract the key (if not in browser DOM or key not found)
    if (!apiKey) {
      const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
      const response = await fetch(watchUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch YouTube watch page: ${response.statusText}`);
      }

      const html = await response.text();
      const apiKeyMatch = html.match(/"INNERTUBE_API_KEY":\s*"([a-zA-Z0-9_-]+)"/);
      if (!apiKeyMatch || !apiKeyMatch[1]) {
        throw new Error('Could not find INNERTUBE_API_KEY from watch page HTML.');
      }
      apiKey = apiKeyMatch[1];
    }

    // 3. Request player response using the ANDROID client context to avoid PO token restrictions
    const playerUrl = `https://www.youtube.com/youtubei/v1/player?key=${apiKey}`;
    const playerResponse = await fetch(playerUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'
      },
      body: JSON.stringify({
        context: {
          client: {
            clientName: 'ANDROID',
            clientVersion: '20.10.38'
          }
        },
        videoId: videoId
      })
    }).then(res => {
      if (!res.ok) {
        throw new Error(`InnerTube v1/player API call failed: ${res.statusText}`);
      }
      return res.json();
    });

    // Check playabilityStatus
    const playability = playerResponse.playabilityStatus;
    if (playability && playability.status !== 'OK') {
      throw new Error(`Video playability status is ${playability.status}: ${playability.reason || 'Unknown reason'}`);
    }

    const captionTracks = playerResponse.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    if (!captionTracks || captionTracks.length === 0) {
      throw new Error('No transcript tracks found for this video.');
    }

    // Select best track: prioritize manual English, then manual other, then auto English, then any auto
    const bestTrack = selectBestTrack(captionTracks);
    if (!bestTrack) {
      throw new Error('No suitable transcript track could be selected.');
    }

    // Replace fmt=srv3 with fmt=json3 to retrieve JSON captions, or append it if fmt is not specified
    let captionUrl = bestTrack.baseUrl;
    if (captionUrl.includes('fmt=srv3')) {
      captionUrl = captionUrl.replace('fmt=srv3', 'fmt=json3');
    } else if (!captionUrl.includes('fmt=')) {
      captionUrl = `${captionUrl}&fmt=json3`;
    }
    
    // Auto-translate foreign tracks to English on-the-fly!
    if (!bestTrack.languageCode.startsWith('en')) {
      captionUrl += '&tlang=en';
    }

    const captionResponse = await fetch(captionUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'
      }
    });
    if (!captionResponse.ok) {
      throw new Error(`Failed to fetch caption data: ${captionResponse.statusText}`);
    }

    const captionText = await captionResponse.text();
    if (!captionText.trim()) {
      throw new Error('Caption response was empty (YouTube returned no data).');
    }
    try {
      const captionData = JSON.parse(captionText);
      return parseJson3Captions(captionData);
    } catch (e: any) {
      throw new Error(`Failed to parse caption JSON: ${e.message}. Content preview: ${captionText.slice(0, 100)}`);
    }
  } catch (error) {
    console.error('Error in fetchTranscript:', error);
    throw error;
  }
}

interface CaptionTrack {
  baseUrl: string;
  name: { simpleText: string };
  vssId: string; // e.g. "a.en" (auto-generated) or "en" (manual)
  languageCode: string;
  kind?: string;
}

function selectBestTrack(tracks: CaptionTrack[]): CaptionTrack | null {
  // 1. Manual English (e.g. "en", "en-US", "en-GB")
  const manualEn = tracks.find(t => t.languageCode.startsWith('en') && !t.vssId.startsWith('a.'));
  if (manualEn) return manualEn;

  // 2. Any Manual
  const manualAny = tracks.find(t => !t.vssId.startsWith('a.'));
  if (manualAny) return manualAny;

  // 3. Auto English
  const autoEn = tracks.find(t => t.languageCode.startsWith('en'));
  if (autoEn) return autoEn;

  // 4. First available (e.g. auto-generated Spanish/Japanese/etc., which we will auto-translate to English)
  return tracks[0] || null;
}



interface Json3CaptionEvent {
  tStartMs: number;
  dDurationMs?: number;
  segs?: Array<{ utf8: string }>;
}

function parseJson3Captions(data: { events?: Json3CaptionEvent[] }): TranscriptSegment[] {
  if (!data.events) return [];

  const segments: TranscriptSegment[] = [];

  for (const event of data.events) {
    // Skip events with no segments or empty text
    if (!event.segs || event.segs.length === 0) continue;

    const text = event.segs
      .map(s => s.utf8)
      .join('')
      .trim();

    if (!text) continue;

    const start = event.tStartMs / 1000;
    const duration = (event.dDurationMs || 0) / 1000;

    segments.push({
      text,
      start,
      duration
    });
  }

  return segments;
}
