import assert from "node:assert/strict";
import test from "node:test";
import type { Vault } from "obsidian";
import {
  createDraftImageAttachment,
  createPersistedImagePath,
  getDefaultImageExtension,
  getConversationAttachmentFolder,
  getImageMediaType,
  getImageMediaTypeFromMime,
  isSupportedImagePath,
  persistImageAttachment,
  readPersistedImageAttachmentData
} from "../src/image-attachments";
import { modelSupportsImages, modelSupportsVoice } from "../src/model-options";

test("image attachment helpers map supported media types", () => {
  assert.equal(getImageMediaType("Sketch.png"), "image/png");
  assert.equal(getImageMediaType("photo.JPG"), "image/jpeg");
  assert.equal(getImageMediaType("photo.jpeg"), "image/jpeg");
  assert.equal(getImageMediaType("diagram.webp"), "image/webp");
  assert.equal(getImageMediaType("animation.gif"), "image/gif");
  assert.equal(getImageMediaTypeFromMime("image/png"), "image/png");
  assert.equal(getImageMediaTypeFromMime("image/heic"), null);
  assert.equal(getDefaultImageExtension("image/jpeg"), "jpg");
});

test("image attachment helpers reject unsupported extensions", () => {
  assert.equal(getImageMediaType("Notes/Alpha.md"), null);
  assert.equal(isSupportedImagePath("Archive/file.txt"), false);
  assert.equal(isSupportedImagePath("Images/Sketch.png"), true);
});

test("conversation image folder stays under dot attachment storage", () => {
  assert.equal(
    getConversationAttachmentFolder("conversation-1"),
    ".vault-ai-assistant/attachments/conversation-1"
  );
});

test("persisted image paths keep readable names and collision suffixes", () => {
  const first = createPersistedImagePath("conversation-1", "Folder/Sketch.png");
  const second = createPersistedImagePath("conversation-1", "Folder/Sketch.png", new Set([first]));

  assert.equal(first, ".vault-ai-assistant/attachments/conversation-1/Sketch.png");
  assert.equal(second, ".vault-ai-assistant/attachments/conversation-1/Sketch-2.png");
});

test("draft image attachments use draft status", () => {
  const attachment = createDraftImageAttachment({
    id: "image-1",
    label: "Sketch.png",
    originalPath: "Images/Sketch.png",
    mediaType: "image/png",
    size: 3,
    now: "2026-05-02T00:00:00.000Z"
  });

  assert.equal(attachment.status, "draft");
  assert.equal(attachment.mediaType, "image/png");
  assert.equal(attachment.originalPath, "Images/Sketch.png");
});

test("persistImageAttachment creates folders and writes binary data", async () => {
  const createdFolders: string[] = [];
  const createdFiles: Array<{ path: string; size: number }> = [];
  const existing = new Set<string>();
  const vault = {
    adapter: {
      exists: async (path: string) => existing.has(path)
    },
    getAbstractFileByPath(path: string) {
      return existing.has(path) ? { path } : null;
    },
    async createFolder(path: string) {
      existing.add(path);
      createdFolders.push(path);
    },
    async createBinary(path: string, data: ArrayBuffer) {
      existing.add(path);
      createdFiles.push({ path, size: data.byteLength });
    }
  } as unknown as Vault;

  const persisted = await persistImageAttachment(
    vault,
    "conversation-1",
    createDraftImageAttachment({
      id: "image-1",
      label: "Sketch.png",
      mediaType: "image/png",
      now: "2026-05-02T00:00:00.000Z"
    }),
    new Uint8Array([1, 2, 3]).buffer
  );

  assert.deepEqual(createdFolders, [
    ".vault-ai-assistant",
    ".vault-ai-assistant/attachments",
    ".vault-ai-assistant/attachments/conversation-1"
  ]);
  assert.deepEqual(createdFiles, [
    {
      path: ".vault-ai-assistant/attachments/conversation-1/Sketch.png",
      size: 3
    }
  ]);
  assert.equal(persisted.status, "persisted");
  assert.equal(persisted.persistedPath, ".vault-ai-assistant/attachments/conversation-1/Sketch.png");
});

test("readPersistedImageAttachmentData falls back to adapter path reads before TFile indexing", async () => {
  const vault = {
    getFileByPath() {
      return null;
    },
    async readBinary() {
      throw new Error("TFile read should not be used.");
    },
    adapter: {
      async readBinary(path: string) {
        assert.equal(path, ".vault-ai-assistant/attachments/conversation-1/Sketch.png");
        return new Uint8Array([4, 5, 6]).buffer;
      }
    }
  } as unknown as Vault;

  const data = await readPersistedImageAttachmentData(vault, {
    kind: "image",
    id: "image-1",
    label: "Sketch.png",
    mediaType: "image/png",
    persistedPath: ".vault-ai-assistant/attachments/conversation-1/Sketch.png",
    status: "persisted"
  });

  assert.equal(data?.byteLength, 3);
});

test("modelSupportsImages returns true for configured defaults", () => {
  assert.equal(modelSupportsImages("openai", "gpt-5.4-mini"), true);
  assert.equal(modelSupportsImages("anthropic", "claude-sonnet-4-6"), true);
});

test("modelSupportsImages returns false for unknown models", () => {
  assert.equal(modelSupportsImages("openai", "unknown-model"), false);
  assert.equal(modelSupportsImages("anthropic", "unknown-model"), false);
});

test("modelSupportsVoice reflects provider voice support", () => {
  assert.equal(modelSupportsVoice("openai", "gpt-5.4-mini"), true);
  assert.equal(modelSupportsVoice("anthropic", "claude-sonnet-4-6"), false);
  assert.equal(modelSupportsVoice("openai", "unknown-model"), false);
});
