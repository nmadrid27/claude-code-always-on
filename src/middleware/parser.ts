/**
 * Message Parser for Multi-Modal Input
 *
 * Parses incoming Telegram messages of various types (text, photo, voice, document, video)
 * and extracts relevant metadata for further processing.
 */

import { Context } from "grammy";

/**
 * Supported message types for parsing
 */
export enum MessageType {
  TEXT = "text",
  PHOTO = "photo",
  VOICE = "voice",
  DOCUMENT = "document",
  VIDEO = "video",
}

/**
 * Parsed message interface containing type, content, and optional metadata
 */
export interface ParsedMessage {
  /** The type of message */
  type: MessageType;

  /** The primary content of the message (text for text messages, caption for media) */
  content: string;

  /** The file ID for media messages (photo, voice, document, video) */
  fileId?: string;

  /** Additional metadata about the message */
  metadata?: MessageMetadata;
}

/**
 * Metadata associated with different message types
 */
export interface MessageMetadata {
  /** When the message was sent (Unix timestamp) */
  date: number;

  /** Optional duration for voice/video messages in seconds */
  duration?: number;

  /** Optional filename for document messages */
  fileName?: string;

  /** Optional MIME type for document/video messages */
  mimeType?: string;

  /** Optional file size in bytes */
  fileSize?: number;

  /** Optional width for photos/videos */
  width?: number;

  /** Optional height for photos/videos */
  height?: number;
}

/**
 * Parses a Grammy Context to extract message type, content, and metadata.
 *
 * @param ctx - The Grammy Context object from the incoming update
 * @returns ParsedMessage object or null if message type is not supported
 *
 * @example
 * ```ts
 * const parsed = parseMessage(ctx);
 * if (parsed) {
 *   console.log(`Received ${parsed.type}: ${parsed.content}`);
 * }
 * ```
 */
export function parseMessage(ctx: Context): ParsedMessage | null {
  const message = ctx.message;

  if (!message) {
    return null;
  }

  // TEXT message
  if (message.text) {
    return {
      type: MessageType.TEXT,
      content: message.text,
      metadata: {
        date: message.date,
      },
    };
  }

  // PHOTO message
  if (message.photo && message.photo.length > 0) {
    // Get the largest photo (last element in array)
    const largestPhoto = message.photo[message.photo.length - 1]!;

    return {
      type: MessageType.PHOTO,
      content: message.caption || "",
      fileId: largestPhoto.file_id,
      metadata: {
        date: message.date,
        width: largestPhoto.width,
        height: largestPhoto.height,
        fileSize: largestPhoto.file_size,
      },
    };
  }

  // VOICE message
  if (message.voice) {
    return {
      type: MessageType.VOICE,
      content: message.caption || "",
      fileId: message.voice.file_id,
      metadata: {
        date: message.date,
        duration: message.voice.duration,
        mimeType: message.voice.mime_type,
        fileSize: message.voice.file_size,
      },
    };
  }

  // DOCUMENT message
  if (message.document) {
    return {
      type: MessageType.DOCUMENT,
      content: message.caption || "",
      fileId: message.document.file_id,
      metadata: {
        date: message.date,
        fileName: message.document.file_name,
        mimeType: message.document.mime_type,
        fileSize: message.document.file_size,
      },
    };
  }

  // VIDEO message
  if (message.video) {
    return {
      type: MessageType.VIDEO,
      content: message.caption || "",
      fileId: message.video.file_id,
      metadata: {
        date: message.date,
        duration: message.video.duration,
        width: message.video.width,
        height: message.video.height,
        mimeType: message.video.mime_type,
        fileSize: message.video.file_size,
      },
    };
  }

  // Unsupported message type
  return null;
}

/**
 * Type guard to check if a parsed message has a file attachment
 */
export function hasFileAttachment(parsed: ParsedMessage): parsed is ParsedMessage & { fileId: string } {
  return parsed.fileId !== undefined;
}

/**
 * Type guard to check if a parsed message is a text message
 */
export function isTextMessage(parsed: ParsedMessage): boolean {
  return parsed.type === MessageType.TEXT;
}

/**
 * Type guard to check if a parsed message is a media message (photo, video, voice, document)
 */
export function isMediaMessage(parsed: ParsedMessage): boolean {
  return [MessageType.PHOTO, MessageType.VIDEO, MessageType.VOICE, MessageType.DOCUMENT].includes(
    parsed.type
  );
}
