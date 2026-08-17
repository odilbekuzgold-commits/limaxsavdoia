/**
 * Deterministic text chunker for RAG Knowledge Indexing
 */
export interface ChunkOptions {
  maxChunkSize?: number; // Characters per chunk
  overlap?: number;      // Overlapping characters between consecutive chunks
}

export interface TextChunk {
  chunkIndex: number;
  content: string;
}

export function chunkKnowledgeContent(content: string, options?: ChunkOptions): TextChunk[] {
  if (!content || !content.trim()) return [];

  const maxChunkSize = options?.maxChunkSize || 500;
  const overlap = Math.min(options?.overlap || 50, Math.floor(maxChunkSize / 2));

  const text = content.trim().replace(/\r\n/g, '\n');

  if (text.length <= maxChunkSize) {
    return [{ chunkIndex: 0, content: text }];
  }

  const chunks: TextChunk[] = [];
  let startIndex = 0;
  let chunkIndex = 0;

  while (startIndex < text.length) {
    let endIndex = startIndex + maxChunkSize;

    if (endIndex < text.length) {
      // Try to break at paragraph or newline or sentence or space
      const slice = text.slice(startIndex, endIndex);
      const lastParagraph = slice.lastIndexOf('\n\n');
      const lastNewline = slice.lastIndexOf('\n');
      const lastPeriod = slice.lastIndexOf('. ');
      const lastSpace = slice.lastIndexOf(' ');

      if (lastParagraph > maxChunkSize * 0.6) {
        endIndex = startIndex + lastParagraph;
      } else if (lastNewline > maxChunkSize * 0.6) {
        endIndex = startIndex + lastNewline;
      } else if (lastPeriod > maxChunkSize * 0.6) {
        endIndex = startIndex + lastPeriod + 1;
      } else if (lastSpace > maxChunkSize * 0.5) {
        endIndex = startIndex + lastSpace;
      }
    } else {
      endIndex = text.length;
    }

    const chunkContent = text.slice(startIndex, endIndex).trim();
    if (chunkContent.length > 0) {
      chunks.push({
        chunkIndex,
        content: chunkContent,
      });
      chunkIndex++;
    }

    startIndex = endIndex >= text.length ? text.length : endIndex - overlap;
    if (startIndex >= text.length) break;
  }

  return chunks;
}
