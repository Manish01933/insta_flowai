/**
 * Response formatter service for WhatsApp message formatting and splitting
 * Handles message splitting for long responses, markdown formatting, and media attachments
 */

import logger from '../config/logger';
import { ValidationError } from '../utils/errors';

// WhatsApp message constraints
const WHATSAPP_MAX_MESSAGE_LENGTH = 4096;
const WHATSAPP_MAX_MEDIA_SIZE = 100 * 1024 * 1024; // 100MB

export interface MediaAttachment {
  type: 'image' | 'document' | 'video' | 'audio';
  url: string;
  caption?: string;
  filename?: string;
  mimeType?: string;
  size?: number;
}

export interface FormattedMessage {
  text: string;
  media?: MediaAttachment;
}

export interface SplitMessageResult {
  messages: FormattedMessage[];
  totalMessages: number;
  originalLength: number;
  splitPoints: number[];
}

/**
 * Validate media attachment
 */
export const validateMediaAttachment = (media: MediaAttachment): boolean => {
  if (!media || !media.type || !media.url) {
    return false;
  }

  const validTypes = ['image', 'document', 'video', 'audio'];
  if (!validTypes.includes(media.type)) {
    return false;
  }

  // Validate URL format
  try {
    new URL(media.url);
  } catch {
    return false;
  }

  // Validate size if provided
  if (media.size && media.size > WHATSAPP_MAX_MEDIA_SIZE) {
    return false;
  }

  return true;
};

/**
 * Convert markdown formatting to WhatsApp-compatible format
 * WhatsApp supports: *bold*, _italic_, ~strikethrough~, ```code```
 */
export const convertMarkdownToWhatsApp = (text: string): string => {
  try {
    if (!text || typeof text !== 'string') {
      return '';
    }

    let formatted = text;

    // Convert ~~strikethrough~~ to ~strikethrough~ (first, before other replacements)
    formatted = formatted.replace(/~~(.*?)~~/g, '~$1~');

    // Convert **bold** to *bold* (use a different marker first to avoid conflicts)
    // Replace with a placeholder, then update after other operations
    formatted = formatted.replace(/\*\*(.*?)\*\*/g, '<<<BOLD>>>$1<<<\/BOLD>>>');

    // Convert headings to bold (marked as BOLD for now)
    formatted = formatted.replace(/^#+\s+(.*?)$/gm, '<<<BOLD>>>$1<<<\/BOLD>>>');

    // Convert *italic* to _italic_ (but not the ** we just handled)
    formatted = formatted.replace(/(?<!\*)\*(?!\*)([^*]+?)\*(?!\*)/g, '_$1_');

    // Now replace our BOLD markers with actual bold format
    formatted = formatted.replace(/<<<BOLD>>>(.*?)<<<\/BOLD>>>/g, '*$1*');

    // Convert ```code``` to ```code``` (already compatible)
    // Keep code blocks as-is

    // Remove markdown links but keep the text and URL
    formatted = formatted.replace(/\[(.*?)\]\((.*?)\)/g, '$1 ($2)');

    // Convert lists to simple text with bullets
    formatted = formatted.replace(/^[\*\-\+]\s+(.*?)$/gm, '• $1');

    return formatted;
  } catch (error: any) {
    logger.error(`Error converting markdown to WhatsApp format: ${error.message}`);
    return text;
  }
};

/**
 * Check if text contains markdown formatting
 */
export const hasMarkdownFormatting = (text: string): boolean => {
  if (!text || typeof text !== 'string') {
    return false;
  }

  // Check for markdown patterns
  const hasMarkdown = 
    /\*\*.*?\*\*/.test(text) ||  // bold
    /(?<!\*)\*(?!\*).*?\*(?!\*)/.test(text) ||  // italic (single *)
    /~~.*?~~/.test(text) ||  // strikethrough
    /\[.*?\]\(.*?\)/.test(text) ||  // link
    /^#+\s+/m.test(text) ||  // heading
    /^[\*\-\+]\s+/m.test(text); // list

  return hasMarkdown;
};

/**
 * Find optimal split point in text (at word boundary)
 */
export const findOptimalSplitPoint = (
  text: string,
  maxLength: number
): number => {
  if (text.length <= maxLength) {
    return text.length;
  }

  // Try to find a split point at a sentence boundary (. ! ?)
  let sentenceEnd = Math.max(
    text.lastIndexOf('.', maxLength),
    text.lastIndexOf('!', maxLength),
    text.lastIndexOf('?', maxLength)
  );
  if (sentenceEnd > maxLength * 0.7) {
    return sentenceEnd + 1;
  }

  // Try to find a split point at a newline
  const newlineEnd = text.lastIndexOf('\n', maxLength);
  if (newlineEnd > maxLength * 0.7) {
    return newlineEnd + 1;
  }

  // Try to find a split point at a word boundary (space)
  const spaceEnd = text.lastIndexOf(' ', maxLength);
  if (spaceEnd > maxLength * 0.7) {
    return spaceEnd + 1;
  }

  // If no good split point found, split at maxLength
  return maxLength;
};

/**
 * Split long text into WhatsApp-compatible chunks
 */
export const splitMessage = (
  text: string,
  maxLength: number = WHATSAPP_MAX_MESSAGE_LENGTH
): SplitMessageResult => {
  try {
    if (!text || typeof text !== 'string') {
      throw new ValidationError('Text must be a non-empty string', 'INVALID_TEXT');
    }

    if (maxLength < 100 || maxLength > WHATSAPP_MAX_MESSAGE_LENGTH) {
      throw new ValidationError(
        `Max length must be between 100 and ${WHATSAPP_MAX_MESSAGE_LENGTH}`,
        'INVALID_MAX_LENGTH'
      );
    }

    const messages: FormattedMessage[] = [];
    const splitPoints: number[] = [];
    let remaining = text;
    let currentPosition = 0;

    while (remaining.length > 0) {
      const splitPoint = findOptimalSplitPoint(remaining, maxLength);
      const chunk = remaining.substring(0, splitPoint).trim();

      if (chunk.length > 0) {
        messages.push({ text: chunk });
        splitPoints.push(currentPosition + splitPoint);
        currentPosition += splitPoint;
      }

      remaining = remaining.substring(splitPoint).trim();
      
      // Prevent infinite loop if chunk is empty after trim
      if (chunk.length === 0 && remaining.length > 0) {
        // Force split if trim removed everything
        const forceSplitPoint = Math.min(maxLength, remaining.length);
        const forceChunk = remaining.substring(0, forceSplitPoint);
        messages.push({ text: forceChunk });
        splitPoints.push(currentPosition + forceSplitPoint);
        currentPosition += forceSplitPoint;
        remaining = remaining.substring(forceSplitPoint);
      }
    }

    // If no messages were created, create one with the original text
    if (messages.length === 0) {
      messages.push({ text: text });
    }

    return {
      messages,
      totalMessages: messages.length,
      originalLength: text.length,
      splitPoints,
    };
  } catch (error: any) {
    logger.error(`Error splitting message: ${error.message}`);
    throw error;
  }
};

/**
 * Format response with markdown support and message splitting
 */
export const formatResponse = (
  text: string,
  options?: {
    convertMarkdown?: boolean;
    maxLength?: number;
    media?: MediaAttachment;
  }
): SplitMessageResult => {
  try {
    if (!text || typeof text !== 'string') {
      throw new ValidationError('Text must be a non-empty string', 'INVALID_TEXT');
    }

    const {
      convertMarkdown = true,
      maxLength = WHATSAPP_MAX_MESSAGE_LENGTH,
      media,
    } = options || {};

    // Validate media if provided
    if (media && !validateMediaAttachment(media)) {
      throw new ValidationError('Invalid media attachment', 'INVALID_MEDIA');
    }

    // Convert markdown if requested
    let formattedText = convertMarkdown ? convertMarkdownToWhatsApp(text) : text;

    // Split message if needed
    const result = splitMessage(formattedText, maxLength);

    // Add media to the last message if provided
    if (media && result.messages.length > 0) {
      result.messages[result.messages.length - 1].media = media;
    }

    logger.info(
      `Formatted response: ${result.totalMessages} message(s), original length: ${result.originalLength}`
    );

    return result;
  } catch (error: any) {
    logger.error(`Error formatting response: ${error.message}`);
    throw error;
  }
};

/**
 * Format response with context preservation across splits
 * Adds context indicators when message is split
 */
export const formatResponseWithContext = (
  text: string,
  options?: {
    convertMarkdown?: boolean;
    maxLength?: number;
    media?: MediaAttachment;
    addContextIndicators?: boolean;
  }
): SplitMessageResult => {
  try {
    const {
      convertMarkdown = true,
      maxLength = WHATSAPP_MAX_MESSAGE_LENGTH,
      media,
      addContextIndicators = true,
    } = options || {};

    // Format the response
    const result = formatResponse(text, {
      convertMarkdown,
      maxLength,
      media,
    });

    // Add context indicators if message was split
    if (addContextIndicators && result.totalMessages > 1) {
      result.messages = result.messages.map((msg, index) => ({
        ...msg,
        text: `[${index + 1}/${result.totalMessages}] ${msg.text}`,
      }));
    }

    return result;
  } catch (error: any) {
    logger.error(`Error formatting response with context: ${error.message}`);
    throw error;
  }
};

/**
 * Estimate token count for a message (rough approximation)
 * Useful for tracking API usage
 */
export const estimateTokenCount = (text: string): number => {
  if (!text || typeof text !== 'string') {
    return 0;
  }

  // Rough approximation: 1 token ≈ 4 characters
  // This is a simplified estimate; actual token count depends on the tokenizer
  return Math.ceil(text.length / 4);
};

/**
 * Create a media message
 */
export const createMediaMessage = (
  media: MediaAttachment,
  caption?: string
): FormattedMessage => {
  try {
    if (!validateMediaAttachment(media)) {
      throw new ValidationError('Invalid media attachment', 'INVALID_MEDIA');
    }

    return {
      text: caption || '',
      media: {
        ...media,
      },
    };
  } catch (error: any) {
    logger.error(`Error creating media message: ${error.message}`);
    throw error;
  }
};

/**
 * Combine multiple formatted responses into a single result
 */
export const combineResponses = (
  responses: SplitMessageResult[]
): SplitMessageResult => {
  try {
    if (!responses || responses.length === 0) {
      throw new ValidationError('At least one response is required', 'EMPTY_RESPONSES');
    }

    const combinedMessages: FormattedMessage[] = [];
    const combinedSplitPoints: number[] = [];
    let totalOriginalLength = 0;

    responses.forEach((response) => {
      combinedMessages.push(...response.messages);
      totalOriginalLength += response.originalLength;

      // Adjust split points for combined result
      const offset = combinedMessages.length - response.messages.length;
      response.splitPoints.forEach((point) => {
        combinedSplitPoints.push(point + offset);
      });
    });

    return {
      messages: combinedMessages,
      totalMessages: combinedMessages.length,
      originalLength: totalOriginalLength,
      splitPoints: combinedSplitPoints,
    };
  } catch (error: any) {
    logger.error(`Error combining responses: ${error.message}`);
    throw error;
  }
};

export default {
  validateMediaAttachment,
  convertMarkdownToWhatsApp,
  hasMarkdownFormatting,
  findOptimalSplitPoint,
  splitMessage,
  formatResponse,
  formatResponseWithContext,
  estimateTokenCount,
  createMediaMessage,
  combineResponses,
};
