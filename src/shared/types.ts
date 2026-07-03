export interface TranscriptSegment {
  text: string;
  start: number; // in seconds
  duration: number; // in seconds
}

export interface KeyPoint {
  point: string;
  quote: string;
  timestamp: number; // in seconds
}

export interface AIContent {
  videoId: string;
  summary: string;
  strengths: KeyPoint[];
  weaknesses: KeyPoint[];
  critique: string;
  formattedTranscript: string;
  createdAt: number;
}

export type LLMProvider = 'gemini';

export interface UserSettings {
  provider: LLMProvider;
  apiKey: string;
  customSummaryPrompt?: string;
  customCritiquePrompt?: string;
  theme: 'auto' | 'light' | 'dark';
}

