import { TranscriptSegment, KeyPoint, AIContent, UserSettings } from '../shared/types';

export async function generateContent(
  videoId: string,
  segments: TranscriptSegment[] | null | undefined,
  settings: UserSettings,
  metadata?: any
): Promise<AIContent> {
  if (!settings.apiKey) {
    throw new Error('Google AI Studio API Key is missing. Please configure it in extension options.');
  }

  // Fallback: If captions are not available, use the metadata-only summary pipeline
  if (!segments || segments.length === 0) {
    console.log(`[LibroTube] Captions not available for video ${videoId}. Using metadata-only summary fallback.`);
    const summaryData = await fetchSummaryAndKeyPointsFromMetadata(metadata, settings);
    const critique = await fetchCritiqueFromMetadata(metadata, summaryData.summary, settings);
    
    const formattedTranscript = `<p class="metadata-only-notice" style="font-style: italic; opacity: 0.8; margin-bottom: 1.5rem; padding: 0.75rem; border-left: 3px solid var(--accent); background: rgba(212, 175, 55, 0.05);">
      [No transcript or caption track was found for this video. The following summary and critique were generated based on the video's title, author, and description.]
    </p>
    <h3>Video Metadata</h3>
    <p><strong>Title:</strong> ${metadata?.title || 'Unknown'}</p>
    <p><strong>Channel:</strong> ${metadata?.author || 'Unknown'}</p>
    <p><strong>Description:</strong></p>
    <pre style="white-space: pre-wrap; font-family: var(--font-sans); font-size: 0.9em; opacity: 0.75; line-height: 1.5; padding: 1rem; background: rgba(0,0,0,0.2); border-radius: 4px; border: 1px solid rgba(255,255,255,0.05); max-height: 400px; overflow-y: auto;">${metadata?.description || 'No description provided.'}</pre>`;

    return {
      videoId,
      summary: summaryData.summary,
      strengths: summaryData.strengths,
      weaknesses: summaryData.weaknesses,
      critique,
      formattedTranscript,
      createdAt: Date.now()
    };
  }

  const formattedTranscript = formatTranscriptToProse(segments);

  try {
    const transcriptText = segments.map(s => `[${s.start.toFixed(1)}s] ${s.text}`).join('\n');
    
    // Step 1: Generate Summary and Key Points
    const summaryData = await fetchSummaryAndKeyPoints(transcriptText, settings, metadata);

    // Step 2: Generate Critique
    const critique = await fetchCritique(transcriptText, summaryData.summary, settings, metadata);

    return {
      videoId,
      summary: summaryData.summary,
      strengths: summaryData.strengths,
      weaknesses: summaryData.weaknesses,
      critique,
      formattedTranscript,
      createdAt: Date.now()
    };
  } catch (error: any) {
    console.error('Error in AI content generation:', error);
    throw error;
  }
}

function formatTranscriptToProse(segments: TranscriptSegment[]): string {
  if (segments.length === 0) return 'No transcript text available.';

  let result = '';
  let currentParagraph = '';
  let paragraphStartSec = segments[0].start;
  let lastEnd = 0;

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  for (const seg of segments) {
    const silenceGap = seg.start - lastEnd;
    
    if (silenceGap > 2.0 && currentParagraph.trim()) {
      result += `<p><span class="transcript-timestamp" data-time="${paragraphStartSec}">[${formatTime(paragraphStartSec)}]</span> ${currentParagraph.trim()}</p>\n`;
      currentParagraph = '';
      paragraphStartSec = seg.start;
    }

    currentParagraph += ' ' + seg.text;
    lastEnd = seg.start + seg.duration;
  }

  if (currentParagraph.trim()) {
    result += `<p><span class="transcript-timestamp" data-time="${paragraphStartSec}">[${formatTime(paragraphStartSec)}]</span> ${currentParagraph.trim()}</p>\n`;
  }

  return result;
}

interface SummaryResponse {
  summary: string;
  strengths: KeyPoint[];
  weaknesses: KeyPoint[];
}

async function callGemini(
  systemPrompt: string,
  userPrompt: string,
  settings: UserSettings,
  jsonMode: boolean = false
): Promise<string> {
  let attempts = 0;
  const maxAttempts = 3;
  let delay = 1500;

  while (attempts < maxAttempts) {
    try {
      const requestBody: any = {
        contents: [
          {
            parts: [
              {
                text: userPrompt
              }
            ]
          }
        ]
      };

      if (systemPrompt) {
        requestBody.systemInstruction = {
          parts: [
            {
              text: systemPrompt
            }
          ]
        };
      }

      if (jsonMode) {
        requestBody.generationConfig = {
          responseMimeType: 'application/json'
        };
      }

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-goog-api-key': settings.apiKey
          },
          body: JSON.stringify(requestBody)
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        let parsedErr;
        try {
          parsedErr = JSON.parse(errorText);
        } catch {
          // Ignored
        }
        const message = parsedErr?.error?.message || errorText;

        if (response.status === 503 && attempts < maxAttempts - 1) {
          console.warn(`[LibroTube] Gemini API returned 503 (High Demand). Retrying in ${delay}ms... (Attempt ${attempts + 1}/${maxAttempts})`);
          await new Promise(resolve => setTimeout(resolve, delay));
          attempts++;
          delay *= 2;
          continue;
        }

        throw new Error(`Gemini API returned status ${response.status}: ${message}`);
      }

      const data = await response.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) {
        throw new Error(`Gemini API returned an empty or invalid response structure.`);
      }

      return text;
    } catch (err: any) {
      if (attempts < maxAttempts - 1 && (err.message?.includes('503') || err.message?.includes('Failed to fetch'))) {
        console.warn(`[LibroTube] Retrying after error: ${err.message}. Retrying in ${delay}ms... (Attempt ${attempts + 1}/${maxAttempts})`);
        await new Promise(resolve => setTimeout(resolve, delay));
        attempts++;
        delay *= 2;
        continue;
      }
      throw err;
    }
  }
  throw new Error('Failed to contact Gemini API after multiple retries.');
}


async function fetchSummaryAndKeyPoints(transcriptText: string, settings: UserSettings, metadata?: any): Promise<SummaryResponse> {
  const systemPrompt = `You are a professional research editor.
Analyze the provided YouTube transcript (which includes timestamps in [seconds] like [12.5s]).
Generate:
1. A concise, 3-4 sentence summary of the video.
2. 5 positive key points (strengths/merits/claims) with exact quotes and timestamps.
3. 5 negative/critical key points (weaknesses/omissions/logical flaws) with exact quotes and timestamps.

You MUST respond ONLY with a JSON object of this structure:
{
  "summary": "3-4 sentence summary here",
  "strengths": [
    { "point": "Description of the strength", "quote": "Exact short quote", "timestamp": 12.5 }
  ],
  "weaknesses": [
    { "point": "Description of the weakness", "quote": "Exact short quote", "timestamp": 45.0 }
  ]
}
Ensure timestamps are numbers in seconds (e.g. 12.5) matching the closest stamp in the transcript.`;

  const metaText = metadata ? `Video Title: ${metadata.title || ''}\nChannel: ${metadata.author || ''}\nDescription: ${metadata.description || ''}\n\n` : '';
  const userPrompt = `${metaText}Here is the transcript:\n\n${transcriptText.slice(0, 32000)}`;

  const responseText = await callGemini(systemPrompt, userPrompt, settings, true);
  try {
    return JSON.parse(responseText);
  } catch (e: any) {
    throw new Error(`Failed to parse AI JSON response: ${e.message}. Content was: ${responseText}`);
  }
}

async function fetchCritique(transcriptText: string, summary: string, settings: UserSettings, metadata?: any): Promise<string> {
  const customPrompt = settings.customCritiquePrompt || '';
  const systemPrompt = `You are a mercilessly honest, sarcastic editor and book critic.
Analyze the provided video transcript and its summary.
Write a brutally honest, critical, and slightly sarcastic evaluation/critique of this video.
Point out logical fallacies, bias, factual errors, weak arguments, hand-waving, marketing fluff, or poor structure.
If the video is actually good, acknowledge it with begrudging respect, but still point out where it could be better.
Always ground your critique in the transcript.
Format your response in clean markdown paragraphs. Use bolding and lists if helpful.`;

  const metaText = metadata ? `Video Title: ${metadata.title || ''}\nChannel: ${metadata.author || ''}\n` : '';
  const userPrompt = `${metaText}Summary: ${summary}\n\nTranscript:\n\n${transcriptText.slice(0, 25000)}\n\n${customPrompt}`;

  return await callGemini(systemPrompt, userPrompt, settings, false);
}

async function fetchSummaryAndKeyPointsFromMetadata(metadata: any, settings: UserSettings): Promise<SummaryResponse> {
  const systemPrompt = `You are an elite research librarian, academic editor, and literary analyst.
Analyze the provided YouTube video metadata (Title, Channel, and Description).
Since no caption/transcript is available, you must generate a comprehensive summary and analysis based on this metadata:
1. A concise, 3-4 sentence analytical summary of the video's expected content, topic, and thesis.
2. 3 expected strengths/merits/claims (positive key points) of the video based on the metadata. Use a quote from the description if possible, and set the timestamp to 0.
3. 3 expected weaknesses/omissions/biases (negative key points) of the video based on the metadata. Use a quote or reference from the description if possible, and set the timestamp to 0.

You MUST respond ONLY with a JSON object of this structure:
{
  "summary": "3-4 sentence summary here",
  "strengths": [
    { "point": "Description of the strength", "quote": "Short quote or reference from description", "timestamp": 0 }
  ],
  "weaknesses": [
    { "point": "Description of the weakness/bias", "quote": "Short quote or reference from description", "timestamp": 0 }
  ]
}
Do not add any prose or markdown outside the JSON block. Ensure the JSON is valid and parsable.`;

  const userPrompt = `Video Title: ${metadata?.title || 'Unknown'}
Channel: ${metadata?.author || 'Unknown'}
Description: ${metadata?.description || 'No description provided.'}`;

  const responseText = await callGemini(systemPrompt, userPrompt, settings, true);
  try {
    return JSON.parse(responseText);
  } catch (e: any) {
    throw new Error(`Failed to parse metadata summary JSON: ${e.message}. Content was: ${responseText}`);
  }
}

async function fetchCritiqueFromMetadata(metadata: any, summary: string, settings: UserSettings): Promise<string> {
  const systemPrompt = `You are a cynical, highly intellectual academic reviewer and video analyst.
You are reviewing a video that does not have a transcript, based only on its title, channel, description, and summary.
Provide an extremely deep, rigorous, and intellectually sophisticated critique of the video's expected thesis, potential biases, and logical gaps based on its metadata and summary.
Your tone should be dry, sharp, slightly cynical, and highly scholarly (evoking an "old money, gothic vampire core library" vibe—like a critique written by a timeless scholar in a dusty archive).
Format your response in markdown. Do not include any JSON or other markers.`;

  const userPrompt = `Video Title: ${metadata?.title || 'Unknown'}
Channel: ${metadata?.author || 'Unknown'}
Description: ${metadata?.description || 'No description provided.'}

Summary: ${summary}`;

  return await callGemini(systemPrompt, userPrompt, settings, false);
}

// Generates highly realistic, customized mock content based on keywords in the transcript
export function generateMockContent(videoId: string, segments: TranscriptSegment[], formattedTranscript: string): AIContent {
  const allText = segments.map(s => s.text).join(' ');
  
  // Basic keyword matcher to make the mock content look real!
  let topic = 'this video';
  if (/react|javascript|typescript|vite|tailwind/i.test(allText)) {
    topic = 'Modern Web Development & Frameworks';
  } else if (/ai|llm|gpt|model|openai|claude|intelligence/i.test(allText)) {
    topic = 'Artificial Intelligence & Large Language Models';
  } else if (/bitcoin|crypto|blockchain|finance|money/i.test(allText)) {
    topic = 'Cryptocurrency, Finance, & Web3 Tech';
  } else if (/quantum|physics|science|space|nasa/i.test(allText)) {
    topic = 'Scientific Discovery & Space Exploration';
  } else if (/game|unity|godot|unreal|gaming/i.test(allText)) {
    topic = 'Game Development & Interactive Design';
  }

  const summary = `This video provides an overview of key concepts in ${topic}. The speaker begins by introducing core definitions and explaining the foundational architecture. Throughout the discussion, they walk through real-world applications, highlighting the main benefits and drawbacks of current approaches. Finally, the video outlines future directions and suggests next steps for developers and researchers looking to explore these ideas further.`;

  const strengths: KeyPoint[] = [
    {
      point: 'Clear explanation of fundamental concepts',
      quote: segments[Math.floor(segments.length * 0.1)]?.text || 'the fundamental architecture here',
      timestamp: segments[Math.floor(segments.length * 0.1)]?.start || 15.5
    },
    {
      point: 'Engaging real-world case studies',
      quote: segments[Math.floor(segments.length * 0.3)]?.text || 'look at how this runs in production',
      timestamp: segments[Math.floor(segments.length * 0.3)]?.start || 120.2
    },
    {
      point: 'Highly actionable advice for practitioners',
      quote: segments[Math.floor(segments.length * 0.5)]?.text || 'what you should actually do tomorrow',
      timestamp: segments[Math.floor(segments.length * 0.5)]?.start || 305.8
    },
    {
      point: 'Good visual demonstrations and diagrams',
      quote: segments[Math.floor(segments.length * 0.7)]?.text || 'as you can see on this screen',
      timestamp: segments[Math.floor(segments.length * 0.7)]?.start || 480.0
    },
    {
      point: 'Solid summary of limitations and future work',
      quote: segments[Math.floor(segments.length * 0.9)]?.text || 'where we go from here is key',
      timestamp: segments[Math.floor(segments.length * 0.9)]?.start || 620.4
    }
  ];

  const weaknesses: KeyPoint[] = [
    {
      point: 'Glossing over critical initial setup steps',
      quote: segments[Math.floor(segments.length * 0.15)]?.text || 'skipping the standard boilerplate code',
      timestamp: segments[Math.floor(segments.length * 0.15)]?.start || 45.0
    },
    {
      point: 'Over-simplifying complex security trade-offs',
      quote: segments[Math.floor(segments.length * 0.45)]?.text || 'don\'t worry too much about access keys',
      timestamp: segments[Math.floor(segments.length * 0.45)]?.start || 240.1
    },
    {
      point: 'Slightly biased towards a specific technology stack',
      quote: segments[Math.floor(segments.length * 0.65)]?.text || 'this tool is objectively superior to everything else',
      timestamp: segments[Math.floor(segments.length * 0.65)]?.start || 410.9
    },
    {
      point: 'Lack of performance benchmark data to support claims',
      quote: segments[Math.floor(segments.length * 0.75)]?.text || 'it runs extremely fast in our tests',
      timestamp: segments[Math.floor(segments.length * 0.75)]?.start || 512.3
    },
    {
      point: 'Unrealistic projection of developer effort',
      quote: segments[Math.floor(segments.length * 0.88)]?.text || 'you can build this in under five minutes',
      timestamp: segments[Math.floor(segments.length * 0.88)]?.start || 590.2
    }
  ];

  const critique = `### Sarcastic Analysis of the Presenter's Arguments

Let's be real: this video is a textbook example of **"Senior Developer Hand-waving."** The speaker starts off strong, discussing the absolute necessity of modular design in ${topic}, but immediately defaults to the classic *draw the rest of the owl* approach.

First, the setup instructions are breezed through in a matter of seconds, with a casual "just run the install script." No mention of system dependencies, permission issues, or package conflicts. If you're a beginner, congratulations, you're stuck at minute three.

Second, the critique of alternative technologies feels heavily biased. There is a clear preference for specific tooling that isn't backed by any objective benchmarks. We are simply told to "trust the process" and that "it's built for scale."

However, it's not all bad. The code examples in the middle section are quite readable, and the speaker actually addresses error handling—a rarity in YouTube tutorials. But the final claim that you can "push this to production in under five minutes" is borderline irresponsible. 

*Recommendation:* Read the documentation of the library directly instead of relying solely on the speaker's simplified abstractions.`;

  return {
    videoId,
    summary,
    strengths,
    weaknesses,
    critique,
    formattedTranscript,
    createdAt: Date.now()
  };
}
