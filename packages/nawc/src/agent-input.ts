import type { NawcAgentAttachment } from "@nawc/config";

const MAX_ATTACHMENTS = 8;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_DATA_URL_CHARACTERS = 14_000_000;

export function validateAgentAttachments(value: unknown): readonly NawcAgentAttachment[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_ATTACHMENTS)
    throw new Error("Invalid agent attachments");
  const attachments: NawcAgentAttachment[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null)
      throw new Error("Invalid agent image attachment");
    if (
      !("type" in item) ||
      !("id" in item) ||
      !("name" in item) ||
      !("mimeType" in item) ||
      !("sizeBytes" in item) ||
      !("dataUrl" in item)
    )
      throw new Error("Invalid agent image attachment");
    if (
      item.type !== "image" ||
      typeof item.id !== "string" ||
      !item.id ||
      typeof item.name !== "string" ||
      !item.name ||
      typeof item.mimeType !== "string" ||
      !item.mimeType.startsWith("image/") ||
      typeof item.sizeBytes !== "number" ||
      !Number.isInteger(item.sizeBytes) ||
      item.sizeBytes < 0 ||
      item.sizeBytes > MAX_IMAGE_BYTES ||
      typeof item.dataUrl !== "string" ||
      item.dataUrl.length > MAX_DATA_URL_CHARACTERS ||
      !item.dataUrl.startsWith(`data:${item.mimeType};base64,`) ||
      Buffer.byteLength(item.dataUrl.slice(item.dataUrl.indexOf(",") + 1), "base64") !==
        item.sizeBytes
    )
      throw new Error("Invalid agent image attachment");
    attachments.push({
      type: item.type,
      id: item.id,
      name: item.name,
      mimeType: item.mimeType,
      sizeBytes: item.sizeBytes,
      dataUrl: item.dataUrl,
    });
  }
  return attachments;
}
