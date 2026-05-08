import assert from "node:assert/strict";
import test from "node:test";
import type { RequestUrlParam, RequestUrlResponse } from "obsidian";
import {
  OPENAI_TTS_MODEL,
  OPENAI_TRANSCRIPTION_LANGUAGE,
  OPENAI_TRANSCRIPTION_MODEL,
  VoiceModeError,
  createOpenAISpeechAudioWithRequestUrl,
  mergeVoiceTranscriptDraft,
  transcribeEnglishAudioWithRequestUrl
} from "../src/voice-mode";

test("voice transcription request sends only English audio fields", async () => {
  let captured: RequestUrlParam | null = null;
  const result = await transcribeEnglishAudioWithRequestUrl(
    {
      apiKey: "test-openai-secret",
      audioData: new TextEncoder().encode("audio bytes").buffer,
      mediaType: "audio/webm",
      fileName: "voice-input.webm"
    },
    async (request) => {
      captured = request;
      return createJsonResponse(200, { text: "hello vault" });
    }
  );

  assert.deepEqual(result, { text: "hello vault" });
  assert.equal(captured?.url, "https://api.openai.com/v1/audio/transcriptions");
  assert.equal(captured?.method, "POST");
  assert.equal(captured?.headers?.Authorization, "Bearer test-openai-secret");
  assert.match(captured?.contentType ?? "", /multipart\/form-data; boundary=/);

  const body = decodeBody(captured?.body);
  assert.match(body, /name="model"[\s\S]*gpt-4o-transcribe/);
  assert.match(body, /name="language"[\s\S]*en/);
  assert.match(body, /name="response_format"[\s\S]*json/);
  assert.match(body, /name="file"; filename="voice-input\.webm"/);
  assert.doesNotMatch(body, /Alpha context/);
  assert.doesNotMatch(body, /Available edit target hints/);
  assert.doesNotMatch(body, /proposal/);
  assert.doesNotMatch(body, /data:image/);
});

test("voice transcription maps provider failures to sanitized errors", async () => {
  await assert.rejects(
    transcribeEnglishAudioWithRequestUrl(
      {
        apiKey: "test-openai-secret",
        audioData: new ArrayBuffer(0),
        mediaType: "audio/webm",
        fileName: "voice-input.webm"
      },
      async () => createJsonResponse(401, { error: { message: "bad key test-openai-secret" } })
    ),
    (error: unknown) => {
      assert.ok(error instanceof VoiceModeError);
      assert.equal(error.code, "transcription_failed");
      assert.equal(error.status, 401);
      assert.doesNotMatch(error.message, /test-openai-secret/);
      return true;
    }
  );
});

test("voice transcript insertion keeps existing draft text editable", () => {
  assert.equal(mergeVoiceTranscriptDraft("", "hello vault"), "hello vault");
  assert.equal(mergeVoiceTranscriptDraft("Existing", "hello vault"), "Existing\n\nhello vault");
});

test("spoken response request uses OpenAI speech endpoint and mp3 format", async () => {
  let captured: RequestUrlParam | null = null;
  const audioBytes = new Uint8Array([1, 2, 3]).buffer;
  const result = await createOpenAISpeechAudioWithRequestUrl(
    {
      apiKey: "test-openai-secret",
      input: "Assistant answer",
      voice: "coral"
    },
    async (request) => {
      captured = request;
      return {
        status: 200,
        headers: {},
        arrayBuffer: audioBytes,
        json: {},
        text: ""
      };
    }
  );

  assert.equal(captured?.url, "https://api.openai.com/v1/audio/speech");
  assert.equal(captured?.contentType, "application/json");
  assert.deepEqual(JSON.parse(String(captured?.body)), {
    model: OPENAI_TTS_MODEL,
    voice: "coral",
    input: "Assistant answer",
    response_format: "mp3"
  });
  assert.equal(result.mediaType, "audio/mpeg");
  assert.equal(result.audioData, audioBytes);
});

test("voice model constants stay pinned", () => {
  assert.equal(OPENAI_TRANSCRIPTION_MODEL, "gpt-4o-transcribe");
  assert.equal(OPENAI_TRANSCRIPTION_LANGUAGE, "en");
  assert.equal(OPENAI_TTS_MODEL, "gpt-4o-mini-tts");
});

function createJsonResponse(status: number, json: unknown): RequestUrlResponse {
  return {
    status,
    headers: {},
    arrayBuffer: new ArrayBuffer(0),
    json,
    text: JSON.stringify(json)
  };
}

function decodeBody(body: string | ArrayBuffer | undefined): string {
  if (typeof body === "string") {
    return body;
  }

  assert.ok(body instanceof ArrayBuffer);
  return new TextDecoder().decode(body);
}
