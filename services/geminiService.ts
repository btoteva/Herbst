import { GoogleGenAI, Modality, Type } from "@google/genai";
import { WordPair, TextSegment } from '../types';

// Helper for Base64 Decoding
const decode = (base64: string) => {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
};

// Helper to create a WAV header for the raw PCM data
// Gemini returns raw PCM (Linear16). Browsers play WAV/MP3 naturally with <audio>, allowing pitch preservation.
const createWavUrl = (samples: Uint8Array, sampleRate: number = 24000): string => {
    const buffer = new ArrayBuffer(44 + samples.length);
    const view = new DataView(buffer);

    // RIFF identifier
    writeString(view, 0, 'RIFF');
    // file length
    view.setUint32(4, 36 + samples.length, true);
    // RIFF type
    writeString(view, 8, 'WAVE');
    // format chunk identifier
    writeString(view, 12, 'fmt ');
    // format chunk length
    view.setUint32(16, 16, true);
    // sample format (raw)
    view.setUint16(20, 1, true);
    // channel count
    view.setUint16(22, 1, true);
    // sample rate
    view.setUint32(24, sampleRate, true);
    // byte rate (sampleRate * blockAlign)
    view.setUint32(28, sampleRate * 2, true);
    // block align (channel count * bytes per sample)
    view.setUint16(32, 2, true);
    // bits per sample
    view.setUint16(34, 16, true);
    // data chunk identifier
    writeString(view, 36, 'data');
    // data chunk length
    view.setUint32(40, samples.length, true);

    // Write the PCM samples
    const dataView = new Uint8Array(buffer, 44);
    dataView.set(samples);

    const blob = new Blob([buffer], { type: 'audio/wav' });
    return URL.createObjectURL(blob);
};

const writeString = (view: DataView, offset: number, string: string) => {
    for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
    }
};

export const generateSpeech = async (text: string): Promise<{ url: string, duration: number }> => {
  const apiKey = process.env.API_KEY;
  if (!apiKey) throw new Error("API Key not found");

  const ai = new GoogleGenAI({ apiKey });
  
  // Using the requested model for TTS
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash-preview-tts",
    contents: [{ parts: [{ text }] }],
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: 'Kore' },
        },
      },
    },
  });

  const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  if (!base64Audio) {
    throw new Error("No audio data returned from Gemini");
  }

  const audioBytes = decode(base64Audio);
  
  // FIXED: Calculate duration manually for Raw PCM 16-bit 24kHz Mono
  // AudioContext.decodeAudioData fails on raw PCM without headers.
  // 1 sample = 2 bytes (16-bit)
  const sampleRate = 24000;
  const numChannels = 1;
  const bytesPerSample = 2; // 16-bit
  
  const totalSamples = audioBytes.length / (numChannels * bytesPerSample);
  const duration = totalSamples / sampleRate;

  // Create WAV URL for the actual player (adds the necessary headers)
  const url = createWavUrl(audioBytes, sampleRate);
  
  return { url, duration };
};

export const extractVocabulary = async (text: string): Promise<WordPair[]> => {
  const apiKey = process.env.API_KEY;
  if (!apiKey) throw new Error("API Key not found");

  const ai = new GoogleGenAI({ apiKey });

  // Requested: More words (30) and A1 level friendly
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash", 
    contents: `Analyze the following German text. Extract 30 vocabulary words or short phrases.
    Focus on words suitable for an A1/A2 learner, including important nouns, verbs, and adjectives used in the story.
    Translate them into Bulgarian.
    
    Text: "${text.substring(0, 4000)}"
    `,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            german: { type: Type.STRING, description: "The German word or phrase from the text" },
            bulgarian: { type: Type.STRING, description: "The Bulgarian translation" }
          },
          required: ["german", "bulgarian"]
        }
      }
    }
  });

  const rawText = response.text;
  if (!rawText) return [];

  try {
    return JSON.parse(rawText) as WordPair[];
  } catch (e) {
    console.error("Failed to parse vocab JSON", e);
    return [];
  }
};

export const analyzeTextSegments = async (text: string): Promise<TextSegment[]> => {
  const apiKey = process.env.API_KEY;
  if (!apiKey) throw new Error("API Key not found");

  const ai = new GoogleGenAI({ apiKey });

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: `Break down the following German text into a flat JSON array of segments in their exact original order.
    Include every word and punctuation mark as a separate item.
    For each item, determine if it is a 'word' or not.
    If it is a word, provide the Bulgarian translation in context. If it is punctuation, translation should be null.
    Do NOT include whitespace items (spaces/newlines) in the JSON array, I will handle layout myself, but DO include punctuation like ., " ! ? » «.
    
    Text: "${text.substring(0, 4000)}"`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            text: { type: Type.STRING, description: "The word or punctuation mark" },
            translation: { type: Type.STRING, description: "Bulgarian translation if it is a word, otherwise null", nullable: true },
            isWord: { type: Type.BOOLEAN, description: "True if it is a word, false if punctuation" }
          },
          required: ["text", "isWord"]
        }
      }
    }
  });

  const rawText = response.text;
  if (!rawText) return [];

  try {
    return JSON.parse(rawText) as TextSegment[];
  } catch (e) {
    console.error("Failed to parse segments JSON", e);
    return [];
  }
};