export interface WordPair {
  german: string;
  bulgarian: string;
}

export interface TextSegment {
  text: string;
  translation: string | null;
  isWord: boolean;
  startTime?: number; // Calculated on client
  endTime?: number;   // Calculated on client
}

export enum AppPhase {
  READING = 'READING',
  VOCABULARY = 'VOCABULARY',
  FLASHCARDS = 'FLASHCARDS',
  SUGGESTOPEDIA = 'SUGGESTOPEDIA'
}

export interface LoadingState {
  isLoading: boolean;
  message: string;
}