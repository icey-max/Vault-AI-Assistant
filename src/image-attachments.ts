import type { Vault } from "obsidian";
import type { ChatImageAttachment } from "./chat-types";

export const SUPPORTED_IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "gif"] as const;

const IMAGE_MEDIA_TYPES: Record<(typeof SUPPORTED_IMAGE_EXTENSIONS)[number], string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif"
};

export function getImageMediaType(pathOrName: string): string | null {
  const extension = getExtension(pathOrName);
  if (!extension) {
    return null;
  }

  return IMAGE_MEDIA_TYPES[extension] ?? null;
}

export function getImageMediaTypeFromMime(type: string): string | null {
  const normalized = type.trim().toLowerCase();
  return Object.values(IMAGE_MEDIA_TYPES).includes(normalized) ? normalized : null;
}

export function getDefaultImageExtension(mediaType: string): string {
  if (mediaType === "image/jpeg") {
    return "jpg";
  }

  const match = Object.entries(IMAGE_MEDIA_TYPES).find(([, type]) => type === mediaType);
  return match?.[0] ?? "png";
}

export function isSupportedImagePath(path: string): boolean {
  return getImageMediaType(path) !== null;
}

export function createDraftImageAttachment(input: {
  id?: string;
  label: string;
  originalPath?: string;
  mediaType: string;
  size?: number;
  now?: string;
}): ChatImageAttachment {
  return {
    kind: "image",
    id: input.id ?? createAttachmentId(),
    label: input.label,
    mediaType: input.mediaType,
    originalPath: input.originalPath,
    status: "draft",
    size: input.size,
    createdAt: input.now ?? new Date().toISOString()
  };
}

export function getConversationAttachmentFolder(conversationId: string): string {
  return normalizePath(`.vault-ai-assistant/attachments/${sanitizePathSegment(conversationId)}`);
}

export function createPersistedImagePath(
  conversationId: string,
  label: string,
  existingPaths: Set<string> = new Set()
): string {
  const folder = getConversationAttachmentFolder(conversationId);
  const safeLabel = sanitizeFileName(label) || "image";
  const dotIndex = safeLabel.lastIndexOf(".");
  const hasExtension = dotIndex > 0 && dotIndex < safeLabel.length - 1;
  const basename = hasExtension ? safeLabel.slice(0, dotIndex) : safeLabel;
  const extension = hasExtension ? safeLabel.slice(dotIndex) : "";
  let candidate = normalizePath(`${folder}/${basename}${extension}`);
  let suffix = 2;

  while (existingPaths.has(candidate)) {
    candidate = normalizePath(`${folder}/${basename}-${suffix}${extension}`);
    suffix += 1;
  }

  return candidate;
}

export async function persistImageAttachment(
  vault: Vault,
  conversationId: string,
  attachment: ChatImageAttachment,
  data: ArrayBuffer
): Promise<ChatImageAttachment> {
  const folder = getConversationAttachmentFolder(conversationId);
  await ensureFolder(vault, folder);

  const existingPaths = new Set<string>();
  const adapter = vault.adapter;
  if (adapter.exists) {
    let candidate = createPersistedImagePath(conversationId, attachment.label, existingPaths);
    while (await adapter.exists(candidate)) {
      existingPaths.add(candidate);
      candidate = createPersistedImagePath(conversationId, attachment.label, existingPaths);
    }
  }

  const persistedPath = createPersistedImagePath(conversationId, attachment.label, existingPaths);
  await vault.createBinary(persistedPath, data);

  return {
    ...attachment,
    persistedPath,
    status: "persisted"
  };
}

export async function readPersistedImageAttachmentData(
  vault: Vault,
  attachment: ChatImageAttachment
): Promise<ArrayBuffer | null> {
  if (attachment.status !== "persisted" || !attachment.persistedPath) {
    return null;
  }

  const file = vault.getFileByPath(attachment.persistedPath);
  if (file) {
    return vault.readBinary(file);
  }

  try {
    return await vault.adapter.readBinary(attachment.persistedPath);
  } catch {
    return null;
  }
}

async function ensureFolder(vault: Vault, folder: string): Promise<void> {
  const parts = normalizePath(folder).split("/");
  let current = "";

  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    const exists = vault.getAbstractFileByPath(current) ?? null;
    if (exists) {
      continue;
    }

    try {
      await vault.createFolder(current);
    } catch (error) {
      if (!(await vault.adapter.exists(current))) {
        throw error;
      }
    }
  }
}

function getExtension(pathOrName: string): (typeof SUPPORTED_IMAGE_EXTENSIONS)[number] | null {
  const clean = pathOrName.split(/[\\/]/).pop() ?? pathOrName;
  const dotIndex = clean.lastIndexOf(".");
  if (dotIndex < 0 || dotIndex === clean.length - 1) {
    return null;
  }

  const extension = clean.slice(dotIndex + 1).toLowerCase();
  return isSupportedImageExtension(extension) ? extension : null;
}

function isSupportedImageExtension(value: string): value is (typeof SUPPORTED_IMAGE_EXTENSIONS)[number] {
  return SUPPORTED_IMAGE_EXTENSIONS.includes(
    value as (typeof SUPPORTED_IMAGE_EXTENSIONS)[number]
  );
}

function sanitizeFileName(label: string): string {
  const fileName = label.split(/[\\/]/).pop() ?? "";
  return Array.from(fileName)
    .map((character) => (isInvalidFileNameCharacter(character) ? "-" : character))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

function sanitizePathSegment(value: string): string {
  return value.replace(/[\\/]/g, "-").trim() || "conversation";
}

function isInvalidFileNameCharacter(character: string): boolean {
  return character.charCodeAt(0) < 32 || '<>:"|?*'.includes(character);
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/$/, "");
}

function createAttachmentId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `image-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
