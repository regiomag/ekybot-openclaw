'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useSafeAuth } from '../../app/hooks/useSafeClerk';
import { useDebounce } from '@/hooks/useDebounce';

interface MentionableAgent {
  id: string;
  name: string;
  icon: string;
  description: string | null;
  channel: string;
}

interface MentionAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  onSelect?: (agent: MentionableAgent) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  initialAgents?: MentionableAgent[];
  className?: string;
  placeholder?: string;
}

export default function MentionAutocomplete({
  value,
  onChange,
  onSelect,
  onKeyDown,
  initialAgents = [],
  className = '',
  placeholder = 'Type @ to mention an agent...'
}: MentionAutocompleteProps) {
  const { getToken } = useSafeAuth();
  const [agents, setAgents] = useState<MentionableAgent[]>(initialAgents);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [mentionStart, setMentionStart] = useState(-1);
  const [mentionSearch, setMentionSearch] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);
  
  const debouncedSearch = useDebounce(mentionSearch, 100);

  const getAuthHeaders = useCallback(async () => {
    const token = await getToken();
    return token ? { Authorization: `Bearer ${token}` } : null;
  }, [getToken]);

  const loadAgents = useCallback(async () => {
    try {
      const headers = await getAuthHeaders();
      if (!headers) return;

      const response = await fetch('/api/mentions/agents', {
        headers,
        credentials: 'include',
        cache: 'no-store',
      });
      if (response.ok) {
        const data = await response.json();
        if (Array.isArray(data.agents) && data.agents.length > 0) {
          setAgents(data.agents);
          return;
        }
      }

      const fallback = await fetch('/api/agents?scope=adopted', {
        headers,
        credentials: 'include',
        cache: 'no-store',
      });
      if (fallback.ok) {
        const data = await fallback.json();
        const fallbackAgents = Array.isArray(data.agents)
          ? data.agents
              .filter((agent: any) => Array.isArray(agent.channels) && agent.channels.length > 0)
              .map((agent: any) => ({
                id: agent.id,
                name: agent.name,
                icon: agent.icon || '🤖',
                description: agent.description || null,
                channel: agent.channels[0].key,
              }))
          : [];
        if (fallbackAgents.length > 0) {
          setAgents(fallbackAgents);
        }
      }
    } catch (error) {
      console.error('Failed to load agents for mentions:', error);
    }
  }, [getAuthHeaders]);

  useEffect(() => {
    if (initialAgents.length > 0) {
      setAgents(initialAgents);
    }
  }, [initialAgents]);

  // Load agents for mentions
  useEffect(() => {
    loadAgents();
  }, [loadAgents]);

  useEffect(() => {
    if (showSuggestions && agents.length === 0) {
      loadAgents();
    }
  }, [showSuggestions, agents.length, loadAgents]);

  // Filter agents based on search
  const filteredAgents = agents.filter(agent => {
    if (!debouncedSearch) return true;
    const search = debouncedSearch.toLowerCase();
    return agent.name.toLowerCase().includes(search) ||
           agent.name.replace(/[-_]/g, '').toLowerCase().includes(search);
  });

  // Handle input changes
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    const cursorPos = e.target.selectionStart;
    
    onChange(newValue);
    
    // Auto-resize textarea
    const textarea = e.target;
    textarea.style.height = 'auto';
    const lineHeight = 24; // approx line height in px
    const maxHeight = lineHeight * 6; // 6 lines max
    textarea.style.height = Math.min(textarea.scrollHeight, maxHeight) + 'px';
    
    // Check if we're in a mention context
    const beforeCursor = newValue.slice(0, cursorPos);
    const lastAtIndex = beforeCursor.lastIndexOf('@');
    
    if (lastAtIndex !== -1) {
      const afterAt = beforeCursor.slice(lastAtIndex + 1);
      // Check if it's a valid mention context (no spaces after @)
      if (!afterAt.includes(' ') && !afterAt.includes('\n')) {
        setMentionStart(lastAtIndex);
        setMentionSearch(afterAt);
        setShowSuggestions(true);
        setSelectedIndex(0);
      } else {
        setShowSuggestions(false);
      }
    } else {
      setShowSuggestions(false);
    }
  };

  // Handle keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!showSuggestions) {
      // Pass through to parent handler if no suggestions shown
      if (onKeyDown) onKeyDown(e);
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex((prev) => 
          prev < filteredAgents.length - 1 ? prev + 1 : 0
        );
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex((prev) => 
          prev > 0 ? prev - 1 : filteredAgents.length - 1
        );
        break;
      case 'Enter':
      case 'Tab':
        if (filteredAgents.length > 0) {
          e.preventDefault();
          selectAgent(filteredAgents[selectedIndex]);
        } else if (e.key === 'Enter' && onKeyDown) {
          // Pass Enter to parent if no suggestions
          onKeyDown(e);
        }
        break;
      case 'Escape':
        setShowSuggestions(false);
        break;
      default:
        // Pass other keys to parent
        if (onKeyDown) onKeyDown(e);
        break;
    }
  };

  // Select an agent
  const selectAgent = (agent: MentionableAgent) => {
    if (mentionStart === -1) return;
    
    const beforeMention = value.slice(0, mentionStart);
    const afterMention = value.slice(mentionStart + mentionSearch.length + 1);
    const newValue = `${beforeMention}@${agent.name} ${afterMention}`;
    
    onChange(newValue);
    setShowSuggestions(false);
    setMentionStart(-1);
    setMentionSearch('');
    
    if (onSelect) {
      onSelect(agent);
    }
    
    // Refocus and set cursor position
    if (inputRef.current) {
      const newCursorPos = mentionStart + agent.name.length + 2;
      inputRef.current.focus();
      inputRef.current.setSelectionRange(newCursorPos, newCursorPos);
    }
  };

  // Click outside to close
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (suggestionsRef.current && !suggestionsRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="relative flex-1">
      <textarea
        ref={inputRef}
        value={value}
        onChange={handleInputChange}
        onKeyDown={handleKeyDown}
        onFocus={() => {
          if (agents.length === 0) {
            loadAgents();
          }
        }}
        className={`w-full ${className}`}
        placeholder={placeholder}
        style={{ minHeight: '36px', maxHeight: '144px' }}
        rows={1}
      />
      
      {showSuggestions && filteredAgents.length > 0 && (
        <div
          ref={suggestionsRef}
          className="absolute bottom-full mb-2 left-0 right-0 max-h-48 overflow-y-auto bg-gray-800 border border-gray-700 rounded-lg shadow-lg z-50"
        >
          {filteredAgents.map((agent, index) => (
            <button
              key={agent.id}
              type="button"
              onClick={() => selectAgent(agent)}
              className={`w-full px-4 py-2 flex items-center gap-3 hover:bg-gray-700 transition-colors ${
                index === selectedIndex ? 'bg-gray-700' : ''
              }`}
            >
              <span className="text-2xl">{agent.icon}</span>
              <div className="flex-1 text-left">
                <div className="font-medium text-white">@{agent.name}</div>
                {agent.description && (
                  <div className="text-xs text-gray-400 truncate">{agent.description}</div>
                )}
              </div>
              <span className="text-xs text-gray-500">#{agent.channel}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
