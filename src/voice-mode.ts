import { requestUrl, type RequestUrlParam, type RequestUrlResponse } from "obsidian";

export const OPENAI_TRANSCRIPTION_MODEL = "gpt-4o-transcribe";
export const OPENAI_TRANSCRIPTION_LANGUAGE = "en";
export const OPENAI_TTS_MODEL = "gpt-4o-mini-tts";
const DEFAULT_VOICE_AUDIO_MEDIA_TYPE = "audio/webm";
const DEFAULT_VOICE_AUDIO_FILE_NAME = "voice-input.webm";
const VOICE_AUDIO_FILE_NAME_BY_MEDIA_TYPE: Record<string, string> = {
  "audio/webm": "voice-input.webm",
  "video/webm": "voice-input.webm",
  "audio/mp4": "voice-input.m4a",
  "audio/x-m4a": "voice-input.m4a",
  "video/mp4": "voice-input.mp4",
  "audio/mpeg": "voice-input.mp3",
  "audio/mp3": "voice-input.mp3",
  "audio/ogg": "voice-input.ogg",
  "audio/wav": "voice-input.wav",
  "audio/wave": "voice-input.wav",
  "audio/x-wav": "voice-input.wav"
};

export const OPENAI_SPEECH_VOICES = [
  "alloy",
  "ash",
  "ballad",
  "coral",
  "echo",
  "fable",
  "onyx",
  "nova",
  "sage",
  "shimmer",
  "verse",
  "marin",
  "cedar"
] as const;

export type OpenAISpeechVoice = (typeof OPENAI_SPEECH_VOICES)[number];

export interface VoiceTranscriptionRequest {
  apiKey: string;
  audioData: ArrayBuffer;
  mediaType: string;
  fileName: string;
}

export interface VoiceTranscriptionResult {
  text: string;
}

export interface SpeechAudioRequest {
  apiKey: string;
  input: string;
  voice: OpenAISpeechVoice;
}

export interface SpeechAudioResult {
  audioData: ArrayBuffer;
  mediaType: "audio/mpeg";
}

export type VoiceModeErrorCode =
  | "missing_openai_key"
  | "microphone_unavailable"
  | "microphone_permission_denied"
  | "recording_failed"
  | "transcription_failed"
  | "speech_failed";

export class VoiceModeError extends Error {
  readonly code: VoiceModeErrorCode;
  readonly status?: number;

  constructor(code: VoiceModeErrorCode, message: string, status?: number) {
    super(message);
    this.name = "VoiceModeError";
    this.code = code;
    this.status = status;
  }
}

type VoiceRequestUrl = (request: RequestUrlParam) => Promise<RequestUrlResponse>;

interface MultipartBody {
  body: ArrayBuffer;
  boundary: string;
}

export async function transcribeEnglishAudio(
  request: VoiceTranscriptionRequest
): Promise<VoiceTranscriptionResult> {
  return transcribeEnglishAudioWithRequestUrl(request, requestUrl);
}

export async function transcribeEnglishAudioWithRequestUrl(
  request: VoiceTranscriptionRequest,
  requestUrlImpl: VoiceRequestUrl
): Promise<VoiceTranscriptionResult> {
  if (!request.apiKey.trim()) {
    throw createVoiceModeError("missing_openai_key", "OpenAI API key is required for voice input.");
  }

  const multipart = buildMultipartAudioBody({
    audioData: request.audioData,
    fileName: request.fileName,
    mediaType: request.mediaType,
    fields: {
      model: OPENAI_TRANSCRIPTION_MODEL,
      language: OPENAI_TRANSCRIPTION_LANGUAGE,
      response_format: "json"
    }
  });

  const response = await requestUrlImpl({
    url: "https://api.openai.com/v1/audio/transcriptions",
    method: "POST",
    headers: {
      Authorization: `Bearer ${request.apiKey}`
    },
    contentType: `multipart/form-data; boundary=${multipart.boundary}`,
    body: multipart.body,
    throw: false
  });

  if (response.status < 200 || response.status >= 300) {
    throw createVoiceModeError(
      "transcription_failed",
      `Voice transcription failed. OpenAI returned ${response.status}.`,
      response.status
    );
  }

  const text = extractTextField(response.json) ?? extractTextField(parseJson(response.text));
  if (!text) {
    throw createVoiceModeError("transcription_failed", "Voice transcription response was empty.");
  }

  return { text };
}

export async function createOpenAISpeechAudio(
  request: SpeechAudioRequest
): Promise<SpeechAudioResult> {
  return createOpenAISpeechAudioWithRequestUrl(request, requestUrl);
}

export async function createOpenAISpeechAudioWithRequestUrl(
  request: SpeechAudioRequest,
  requestUrlImpl: VoiceRequestUrl
): Promise<SpeechAudioResult> {
  if (!request.apiKey.trim()) {
    throw createVoiceModeError(
      "missing_openai_key",
      "OpenAI API key is required for spoken responses."
    );
  }

  const response = await requestUrlImpl({
    url: "https://api.openai.com/v1/audio/speech",
    method: "POST",
    headers: {
      Authorization: `Bearer ${request.apiKey}`
    },
    contentType: "application/json",
    body: JSON.stringify({
      model: OPENAI_TTS_MODEL,
      voice: request.voice,
      input: request.input,
      response_format: "mp3"
    }),
    throw: false
  });

  if (response.status < 200 || response.status >= 300) {
    throw createVoiceModeError(
      "speech_failed",
      `Spoken response generation failed. OpenAI returned ${response.status}.`,
      response.status
    );
  }

  return {
    audioData: response.arrayBuffer,
    mediaType: "audio/mpeg"
  };
}

export function mergeVoiceTranscriptDraft(draft: string, transcript: string): string {
  const cleanTranscript = transcript.trim();
  if (!draft.trim()) {
    return cleanTranscript;
  }

  return `${draft.trimEnd()}\n\n${cleanTranscript}`;
}

export function getVoiceAudioFileName(mediaType: string): string {
  return (
    VOICE_AUDIO_FILE_NAME_BY_MEDIA_TYPE[normalizeMediaType(mediaType)] ??
    DEFAULT_VOICE_AUDIO_FILE_NAME
  );
}

export function createVoiceModeError(
  code: VoiceModeErrorCode,
  message: string,
  status?: number
): VoiceModeError {
  return new VoiceModeError(code, message, status);
}

export function isVoiceModeError(error: unknown): error is VoiceModeError {
  return error instanceof VoiceModeError;
}

export function buildMultipartAudioBody(options: {
  audioData: ArrayBuffer;
  fileName: string;
  mediaType: string;
  fields: Record<string, string>;
}): MultipartBody {
  const boundary = `vault-ai-assistant-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2)}`;
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];

  for (const [name, value] of Object.entries(options.fields)) {
    chunks.push(
      encoder.encode(
        [
          `--${boundary}`,
          `Content-Disposition: form-data; name="${sanitizePartName(name)}"`,
          "",
          value,
          ""
        ].join("\r\n")
      )
    );
  }

  chunks.push(
    encoder.encode(
      [
        `--${boundary}`,
        `Content-Disposition: form-data; name="file"; filename="${sanitizeFileName(
          options.fileName
        )}"`,
        `Content-Type: ${normalizeMediaType(options.mediaType)}`,
        "",
        ""
      ].join("\r\n")
    )
  );
  chunks.push(new Uint8Array(options.audioData));
  chunks.push(encoder.encode(`\r\n--${boundary}--\r\n`));

  return {
    boundary,
    body: concatUint8Arrays(chunks)
  };
}

function concatUint8Arrays(chunks: Uint8Array[]): ArrayBuffer {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const output = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return output.buffer;
}

function sanitizePartName(value: string): string {
  return value.replace(/["\r\n]/g, "");
}

function sanitizeFileName(value: string): string {
  return value.trim().replace(/["\r\n/\\]/g, "-") || DEFAULT_VOICE_AUDIO_FILE_NAME;
}

function normalizeMediaType(value: string): string {
  return value.split(";")[0]?.trim().toLowerCase() || DEFAULT_VOICE_AUDIO_MEDIA_TYPE;
}

function extractTextField(value: unknown): string | null {
  if (!isRecord(value) || typeof value.text !== "string") {
    return null;
  }

  const text = value.text.trim();
  return text.length > 0 ? text : null;
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
