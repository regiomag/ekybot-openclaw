'use client';

import React, { ReactNode } from 'react';

interface MessageContentProps {
  content: string;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * Lightweight inline-markdown renderer with @mention support.
 * Supports: **bold**, *italic*, `code`, ```code blocks```, [links](url)
 */
export default function MessageContent({ content, className = '', style }: MessageContentProps) {
  if (!content) {
    return <div className={className} style={style}>...</div>;
  }

  const rendered = renderBlocks(content);

  return (
    <div className={className} style={style}>
      {rendered}
    </div>
  );
}

/** Split into code blocks vs normal paragraphs */
function renderBlocks(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  // Match ```lang?\n...``` code blocks
  const codeBlockRegex = /```(\w*)\n?([\s\S]*?)```/g;
  let lastIndex = 0;
  let match;
  let key = 0;

  while ((match = codeBlockRegex.exec(text)) !== null) {
    // Text before code block
    if (match.index > lastIndex) {
      parts.push(...renderParagraphs(text.substring(lastIndex, match.index), key));
      key += 100;
    }
    // Code block
    parts.push(
      <pre
        key={`cb-${key++}`}
        className="bg-black/30 rounded-md px-3 py-2 my-1 overflow-x-auto text-sm font-mono text-gray-200"
      >
        <code>{match[2]}</code>
      </pre>
    );
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push(...renderParagraphs(text.substring(lastIndex), key));
  }

  return parts;
}

/** Split by double newlines into paragraphs, single newlines into <br /> */
function renderParagraphs(text: string, baseKey: number): ReactNode[] {
  return text.split(/\n/).map((line, i) => {
    if (i === 0) {
      return <React.Fragment key={`p-${baseKey}-${i}`}>{renderInline(line)}</React.Fragment>;
    }
    return (
      <React.Fragment key={`p-${baseKey}-${i}`}>
        <br />
        {renderInline(line)}
      </React.Fragment>
    );
  });
}

/** Parse inline markdown: bold, italic, code, mentions, links */
function renderInline(text: string): ReactNode[] {
  if (!text) return [];

  // Order matters: longer/more specific patterns first
  // Combined regex for all inline patterns
  const inlineRegex =
    /(\*\*(.+?)\*\*)|(\*(.+?)\*)|(`([^`]+?)`)|(\[([^\]]+)\]\(([^)]+)\))|(@(\w+(?:[-_]\w+)*))/g;

  const parts: ReactNode[] = [];
  let lastIndex = 0;
  let match;
  let key = 0;

  while ((match = inlineRegex.exec(text)) !== null) {
    // Plain text before this match
    if (match.index > lastIndex) {
      parts.push(text.substring(lastIndex, match.index));
    }

    if (match[1]) {
      // **bold**
      parts.push(<strong key={`b-${key++}`} className="font-semibold">{match[2]}</strong>);
    } else if (match[3]) {
      // *italic*
      parts.push(<em key={`i-${key++}`}>{match[4]}</em>);
    } else if (match[5]) {
      // `inline code`
      parts.push(
        <code
          key={`c-${key++}`}
          className="bg-black/30 px-1 py-0.5 rounded text-sm font-mono text-blue-200"
        >
          {match[6]}
        </code>
      );
    } else if (match[7]) {
      // [link](url)
      parts.push(
        <a
          key={`a-${key++}`}
          href={match[9]}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-400 underline hover:text-blue-300"
        >
          {match[8]}
        </a>
      );
    } else if (match[10]) {
      // @mention
      parts.push(
        <span
          key={`m-${key++}`}
          className="inline-flex items-center px-1 py-0.5 rounded bg-blue-500/20 text-blue-300 font-medium mx-0.5"
          style={{ fontSize: '0.95em' }}
        >
          {match[10]}
        </span>
      );
    }

    lastIndex = match.index + match[0].length;
  }

  // Remaining text
  if (lastIndex < text.length) {
    parts.push(text.substring(lastIndex));
  }

  return parts;
}
