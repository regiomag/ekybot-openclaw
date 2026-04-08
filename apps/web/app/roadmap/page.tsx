'use client';

// Roadmap page - task management for Ekybot development
import { useState, useEffect, useCallback, useRef } from 'react';
import { useSafeAuth, useIsNativeApp } from '../hooks/useSafeClerk';
import { useSearchParams } from 'next/navigation';
import { AppLayout } from '@/components/AppLayout';
import { useTranslation } from '@/i18n/context';
import { useNotifications } from '../hooks/useNotifications';
import { BottomNav } from '../v3/components/BottomNav';
import { getCachedData, setCachedData } from '../hooks/useLocalCache';
import { DemoBanner } from '@/components/DemoBanner';
import { RoutinesTab } from './RoutinesTab';

// Demo tasks for demo mode
const getDemoTasks = (locale: string): Task[] => {
  const now = Date.now();
  if (locale === 'en') {
    return [
      { id: 'demo-1', title: 'Add dark mode', description: 'Implement a dark theme for the app', status: 'done', priority: 100, source: 'user', createdAt: new Date(now - 86400000 * 7).toISOString(), completedAt: new Date(now - 86400000 * 2).toISOString() },
      { id: 'demo-2', title: 'Push notifications', description: 'Send notifications when the agent responds', status: 'testing', priority: 90, source: 'agent', createdAt: new Date(now - 86400000 * 5).toISOString() },
      { id: 'demo-3', title: 'Voice messages', description: 'Allow sending voice messages', status: 'in_progress', priority: 80, source: 'user', createdAt: new Date(now - 86400000 * 3).toISOString() },
      { id: 'demo-4', title: 'Multi-language support', status: 'todo', priority: 70, source: 'user', createdAt: new Date(now - 86400000 * 2).toISOString() },
      { id: 'demo-5', title: 'Calendar integration', status: 'pipeline', priority: 60, source: 'agent', createdAt: new Date(now - 86400000).toISOString() },
    ];
  } else if (locale === 'de') {
    return [
      { id: 'demo-1', title: 'Dunkelmodus hinzufügen', description: 'Ein dunkles Theme für die App implementieren', status: 'done', priority: 100, source: 'user', createdAt: new Date(now - 86400000 * 7).toISOString(), completedAt: new Date(now - 86400000 * 2).toISOString() },
      { id: 'demo-2', title: 'Push-Benachrichtigungen', description: 'Benachrichtigungen senden wenn der Agent antwortet', status: 'testing', priority: 90, source: 'agent', createdAt: new Date(now - 86400000 * 5).toISOString() },
      { id: 'demo-3', title: 'Sprachnachrichten', description: 'Sprachnachrichten senden ermöglichen', status: 'in_progress', priority: 80, source: 'user', createdAt: new Date(now - 86400000 * 3).toISOString() },
      { id: 'demo-4', title: 'Mehrsprachige Unterstützung', status: 'todo', priority: 70, source: 'user', createdAt: new Date(now - 86400000 * 2).toISOString() },
      { id: 'demo-5', title: 'Kalender-Integration', status: 'pipeline', priority: 60, source: 'agent', createdAt: new Date(now - 86400000).toISOString() },
    ];
  }
  // French
  return [
    { id: 'demo-1', title: 'Ajouter le mode sombre', description: 'Implémenter un thème sombre pour l\'app', status: 'done', priority: 100, source: 'user', createdAt: new Date(now - 86400000 * 7).toISOString(), completedAt: new Date(now - 86400000 * 2).toISOString() },
    { id: 'demo-2', title: 'Notifications push', description: 'Envoyer des notifications quand l\'agent répond', status: 'testing', priority: 90, source: 'agent', createdAt: new Date(now - 86400000 * 5).toISOString() },
    { id: 'demo-3', title: 'Messages vocaux', description: 'Permettre l\'envoi de messages vocaux', status: 'in_progress', priority: 80, source: 'user', createdAt: new Date(now - 86400000 * 3).toISOString() },
    { id: 'demo-4', title: 'Support multi-langues', status: 'todo', priority: 70, source: 'user', createdAt: new Date(now - 86400000 * 2).toISOString() },
    { id: 'demo-5', title: 'Intégration calendrier', status: 'pipeline', priority: 60, source: 'agent', createdAt: new Date(now - 86400000).toISOString() },
  ];
};
import {
  DndContext,
  closestCenter,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

interface Comment {
  id: string;
  content: string;
  images?: string[];
  author: 'user' | 'agent';
  createdAt: string;
}

interface Task {
  id: string;
  title: string;
  description?: string;
  images?: string[]; // Array of image URLs
  status: string; // Supports: todo, in_progress, testing, a_tester, done
  priority: number;
  source: 'user' | 'agent';
  eta?: string;
  createdAt: string;
  completedAt?: string;
  comments?: Comment[];
  _commentCount?: number; // Cached count to avoid fetching all comments
  channelKey?: string; // DEPRECATED — use projectId
  projectId?: string;
  agentId?: string;
  project?: { id: string; name: string; icon?: string };
  agent?: { id: string; name: string; icon?: string };
}

const STATUS_CONFIG: Record<string, { emoji: string; label: string; labelEn: string; labelDe: string; color: string }> = {
  pipeline: { emoji: '📥', label: 'Pipeline', labelEn: 'Pipeline', labelDe: 'Pipeline', color: 'bg-purple-500' },
  todo: { emoji: '📋', label: 'À faire', labelEn: 'Todo', labelDe: 'Zu erledigen', color: 'bg-gray-500' },
  in_progress: { emoji: '🔄', label: 'En cours', labelEn: 'In Progress', labelDe: 'In Arbeit', color: 'bg-blue-500' },
  testing: { emoji: '🧪', label: 'À tester', labelEn: 'Testing', labelDe: 'Zu testen', color: 'bg-yellow-500' },
  a_tester: { emoji: '🧪', label: 'À tester', labelEn: 'Testing', labelDe: 'Zu testen', color: 'bg-yellow-500' },
  done: { emoji: '✅', label: 'Terminé', labelEn: 'Done', labelDe: 'Erledigt', color: 'bg-green-500' },
};

// Helper to get config with fallback
const getStatusConfig = (status: string) => STATUS_CONFIG[status] || STATUS_CONFIG.todo;
const ROADMAP_AUTH_PROBE_INTERVAL_MS = 500;
const ROADMAP_AUTH_PROBE_TIMEOUT_MS = 10_000;

// Helper to get file icon based on extension
const getFileIcon = (url: string): string => {
  const ext = url.split('.').pop()?.toLowerCase() || '';
  if (/^(pdf)$/.test(ext)) return '📄';
  if (/^(doc|docx|rtf)$/.test(ext)) return '📝';
  if (/^(xls|xlsx|csv)$/.test(ext)) return '📊';
  if (/^(txt|md)$/.test(ext)) return '📃';
  if (/^(jpg|jpeg|png|gif|webp|heic|heif)$/.test(ext)) return '🖼️';
  return '📎';
};

// Sortable Task Item Component
function SortableTaskItem({ 
  task, 
  isSignedIn, 
  locale, 
  userId,
  getAuthHeaders,
  channels,
  onUpdateStatus,
  onEdit,
  onDelete,
  getStatusLabel, 
  formatDate,
  isSelected,
  onToggleSelect,
  onShowDetails,
}: {
  task: Task;
  isSignedIn: boolean;
  locale: string;
  userId: string | null;
  getAuthHeaders: (baseHeaders?: Record<string, string>) => Promise<Record<string, string>>;
  channels: { key: string; name: string }[];
  onUpdateStatus: (taskId: string, status: string) => void;
  onEdit: (task: Task) => void;
  onDelete: (taskId: string) => void;
  getStatusLabel: (status: keyof typeof STATUS_CONFIG) => string;
  formatDate: (date: string) => string;
  isSelected?: boolean;
  onToggleSelect?: (taskId: string) => void;
  onShowDetails?: (task: Task) => void;
}) {
  const [showComments, setShowComments] = useState(false);
  const [comments, setComments] = useState<Comment[]>([]);
  const [loadingComments, setLoadingComments] = useState(false);
  const [newComment, setNewComment] = useState('');
  const [submittingComment, setSubmittingComment] = useState(false);

  const loadComments = async () => {
    if (loadingComments) return;
    setLoadingComments(true);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`/api/roadmap/${task.id}/comments`, { headers });
      if (res.ok) {
        const data = await res.json();
        setComments(data.comments || []);
      }
    } catch (e) {
      console.error('Failed to load comments:', e);
    } finally {
      setLoadingComments(false);
    }
  };

  const handleToggleComments = () => {
    if (!showComments && comments.length === 0) {
      loadComments();
    }
    setShowComments(!showComments);
  };

  const handleAddComment = async () => {
    if (!newComment.trim() || submittingComment) return;
    setSubmittingComment(true);
    try {
      const headers = await getAuthHeaders({ 'Content-Type': 'application/json' });
      const res = await fetch(`/api/roadmap/${task.id}/comments`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ content: newComment }),
      });
      if (res.ok) {
        const data = await res.json();
        setComments(prev => [...prev, data.comment]);
        setNewComment('');
      } else {
        console.error('Failed to add comment:', await res.text());
      }
    } catch (e) {
      console.error('Failed to add comment:', e);
    } finally {
      setSubmittingComment(false);
    }
  };

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      className={`p-2 sm:p-4 rounded-lg bg-gray-800 border-l-4 ${
        task.status === 'done' 
          ? 'border-green-500 opacity-75' 
          : task.status === 'in_progress'
          ? 'border-blue-500'
          : (task.status === 'testing' || task.status === 'a_tester')
          ? 'border-yellow-500'
          : task.status === 'pipeline'
          ? 'border-purple-500'
          : 'border-gray-600'
      } ${isDragging ? 'ring-2 ring-blue-500 shadow-lg' : ''}`}
    >
      <div className="flex items-start justify-between gap-2 sm:gap-4">
        {/* Drag handle */}
        {isSignedIn && (
          <div
            {...listeners}
            className="flex items-center cursor-grab active:cursor-grabbing touch-none text-gray-500 hover:text-gray-300 px-1 py-1 -ml-1 select-none"
            title={locale === 'en' ? 'Drag to reorder' : locale === 'de' ? 'Ziehen zum Sortieren' : 'Glisser pour réordonner'}
          >
            <span className="text-lg">↕</span>
          </div>
        )}
        {/* Selection checkbox */}
        {isSignedIn && onToggleSelect && (
          <div onPointerDown={(e) => e.stopPropagation()}>
            <input
              type="checkbox"
              checked={isSelected || false}
              onChange={() => onToggleSelect(task.id)}
              className="w-5 h-5 rounded border-gray-600 bg-gray-700 text-blue-500 focus:ring-blue-500 focus:ring-offset-gray-800 cursor-pointer"
            />
          </div>
        )}
        
        {/* Drag indicator (visual only, whole card is draggable) - hidden on mobile */}
        <div
          className="hidden sm:block p-1 text-gray-500"
          title={locale === 'en' ? 'Drag to reorder' : locale === 'de' ? 'Ziehen zum Neuordnen' : 'Glisser pour réordonner'}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <circle cx="4" cy="3" r="1.5"/>
            <circle cx="12" cy="3" r="1.5"/>
            <circle cx="4" cy="8" r="1.5"/>
            <circle cx="12" cy="8" r="1.5"/>
            <circle cx="4" cy="13" r="1.5"/>
            <circle cx="12" cy="13" r="1.5"/>
          </svg>
        </div>
        
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1 sm:gap-2 flex-wrap">
            <span className="text-base sm:text-lg">{getStatusConfig(task.status).emoji}</span>
            <h3 className={`text-white font-medium text-sm sm:text-base ${task.status === 'done' ? 'line-through' : ''}`}>
              {task.title}
            </h3>
            {/* Mobile: info button to open detail modal */}
            {(task.description || task.images?.length) && onShowDetails && (
              <button
                onClick={() => onShowDetails(task)}
                onPointerDown={(e) => e.stopPropagation()}
                className="sm:hidden text-gray-400 hover:text-blue-400 p-1 touch-auto"
                title={locale === 'en' ? 'View details' : locale === 'de' ? 'Details anzeigen' : 'Voir les détails'}
              >
                ℹ️
              </button>
            )}
            <span className={`hidden sm:inline text-xs px-2 py-0.5 rounded ${
              task.source === 'agent' ? 'bg-purple-500/20 text-purple-300' : 'bg-gray-600 text-gray-300'
            }`}>
              {task.source === 'agent' ? '🤖 Agent' : '👤 User'}
            </span>
            {(task.project || task.channelKey) && (
              <span className="hidden sm:inline text-xs px-2 py-0.5 rounded bg-blue-500/20 text-blue-300">
                {task.project ? `${task.project.icon || '📁'} ${task.project.name}` : `📁 ${channels.find(c => c.key === task.channelKey)?.name || task.channelKey}`}
              </span>
            )}
            {task.agent && (
              <span className="hidden sm:inline text-xs px-2 py-0.5 rounded bg-green-500/20 text-green-300">
                {task.agent.icon || '🤖'} {task.agent.name}
              </span>
            )}
            {task.eta && task.status !== 'done' && (
              <span className="hidden sm:inline text-xs px-2 py-0.5 rounded bg-yellow-500/20 text-yellow-300">
                ⏱️ {task.eta}
              </span>
            )}
          </div>
          {/* Desktop: always show description */}
          {task.description && (
            <p className="hidden sm:block text-gray-400 text-sm mt-1 ml-7 line-clamp-2">{task.description}</p>
          )}
          {/* Files - desktop only (mobile shows in modal) */}
          {task.images && task.images.length > 0 && (
            <div className="hidden sm:flex flex-wrap gap-2 mt-2 ml-7">
              {task.images.map((url, index) => {
                const isImage = /\.(jpg|jpeg|png|gif|webp|heic|heif)$/i.test(url);
                const filename = url.split('/').pop()?.split('-').pop() || 'file';
                return (
                  <a key={index} href={url} target="_blank" rel="noopener noreferrer">
                    {isImage ? (
                      <img 
                        src={url} 
                        alt={`Image ${index + 1}`}
                        className="w-20 h-20 object-cover rounded-lg border border-gray-600 hover:border-blue-500 transition-colors cursor-pointer"
                      />
                    ) : (
                      <div className="w-20 h-20 bg-gray-700 rounded-lg border border-gray-600 hover:border-blue-500 transition-colors cursor-pointer flex flex-col items-center justify-center p-1">
                        <span className="text-3xl">{getFileIcon(url)}</span>
                        <span className="text-[10px] text-gray-400 truncate w-full text-center mt-1">{filename}</span>
                      </div>
                    )}
                  </a>
                );
              })}
            </div>
          )}
          {/* Desktop: always show date */}
          <div className="hidden sm:block text-xs text-gray-500 mt-2 ml-7">
            {formatDate(task.createdAt)}
            {task.completedAt && (
              <span className="ml-2">
                → {locale === 'en' ? 'Completed' : locale === 'de' ? 'Erledigt' : 'Terminé'} {formatDate(task.completedAt)}
              </span>
            )}
          </div>
        </div>
        {isSignedIn && (
          <div className="flex items-center gap-1 sm:gap-2 flex-shrink-0" onPointerDown={(e) => e.stopPropagation()}>
            {task.status !== 'done' && (
              <select
                value={task.status}
                onChange={(e) => onUpdateStatus(task.id, e.target.value)}
                className="bg-gray-700 text-white text-xs sm:text-sm rounded px-1 sm:px-2 py-1 border border-gray-600 touch-auto cursor-pointer max-w-20 sm:max-w-none"
              >
                <option value="pipeline">{getStatusLabel('pipeline')}</option>
                <option value="todo">{getStatusLabel('todo')}</option>
                <option value="in_progress">{getStatusLabel('in_progress')}</option>
                <option value="testing">{getStatusLabel('testing')}</option>
                <option value="done">{getStatusLabel('done')}</option>
              </select>
            )}
            <button
              onClick={() => onEdit(task)}
              className="p-1 sm:p-1.5 text-gray-400 hover:text-blue-400 hover:bg-gray-700 rounded transition-colors touch-auto text-sm"
              title={locale === 'en' ? 'Edit' : locale === 'de' ? 'Bearbeiten' : 'Modifier'}
            >
              ✏️
            </button>
            <button
              onClick={() => {
                if (confirm(locale === 'en' ? 'Delete this task?' : locale === 'de' ? 'Diese Aufgabe löschen?' : 'Supprimer cette tâche ?')) {
                  onDelete(task.id);
                }
              }}
              className="p-1 sm:p-1.5 text-gray-400 hover:text-red-400 hover:bg-gray-700 rounded transition-colors touch-auto text-sm"
              title={locale === 'en' ? 'Delete' : locale === 'de' ? 'Löschen' : 'Supprimer'}
            >
              🗑️
            </button>
          </div>
        )}
      </div>
      
      {/* Comments Section - stop drag propagation */}
      <div className="mt-2 sm:mt-3 pt-2 sm:pt-3 border-t border-gray-700" onPointerDown={(e) => e.stopPropagation()}>
        <button
          onClick={handleToggleComments}
          className="text-xs sm:text-sm text-gray-400 hover:text-white flex items-center gap-1 touch-auto cursor-pointer"
        >
          💬 {showComments 
            ? (locale === 'en' ? 'Hide comments' : locale === 'de' ? 'Kommentare ausblenden' : 'Masquer les commentaires')
            : (locale === 'en' ? `Comments${comments.length > 0 ? ` (${comments.length})` : ''}` : locale === 'de' ? `Kommentare${comments.length > 0 ? ` (${comments.length})` : ''}` : `Commentaires${comments.length > 0 ? ` (${comments.length})` : ''}`)}
        </button>
        
        {showComments && (
          <div className="mt-3 space-y-3">
            {loadingComments ? (
              <p className="text-sm text-gray-500">
                {locale === 'en' ? 'Loading...' : locale === 'de' ? 'Laden...' : 'Chargement...'}
              </p>
            ) : comments.length === 0 ? (
              <p className="text-sm text-gray-500">
                {locale === 'en' ? 'No comments yet' : locale === 'de' ? 'Noch keine Kommentare' : 'Aucun commentaire'}
              </p>
            ) : (
              comments.map((comment) => (
                <div key={comment.id} className="bg-gray-700/50 rounded-lg p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs px-2 py-0.5 rounded bg-gray-600 text-gray-300">
                      {comment.author === 'agent' ? '🤖 Agent' : '👤 User'}
                    </span>
                    <span className="text-xs text-gray-500">
                      {new Date(comment.createdAt).toLocaleDateString(locale === 'de' ? 'de-DE' : locale === 'en' ? 'en-US' : 'fr-FR', {
                        day: 'numeric',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                    </span>
                  </div>
                  <p className="text-sm text-gray-300 whitespace-pre-wrap">{comment.content}</p>
                  {comment.images && comment.images.length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-2">
                      {comment.images.map((url, i) => (
                        <a key={i} href={url} target="_blank" rel="noopener noreferrer">
                          <img src={url} alt="" className="w-16 h-16 object-cover rounded border border-gray-600 hover:border-blue-500" />
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              ))
            )}
            
            {/* Add comment form */}
            {isSignedIn && (
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newComment}
                  onChange={(e) => setNewComment(e.target.value)}
                  onKeyDown={(e) => {
                    e.stopPropagation(); // Prevent DnD from capturing keyboard events
                    if (e.key === 'Enter') handleAddComment();
                  }}
                  placeholder={locale === 'en' ? 'Add a comment...' : locale === 'de' ? 'Kommentar hinzufügen...' : 'Ajouter un commentaire...'}
                  className="flex-1 px-3 py-2 bg-gray-700 text-white text-sm rounded-lg border border-gray-600 focus:border-blue-500 focus:outline-none"
                />
                <button
                  onClick={handleAddComment}
                  disabled={!newComment.trim() || submittingComment}
                  className="px-3 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 text-white text-sm rounded-lg transition-colors"
                >
                  {submittingComment ? '...' : '↩'}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function RoadmapPage() {
  const { t, locale } = useTranslation();
  const { isSignedIn, userId, isLoaded, getToken } = useSafeAuth();
  const [authTokenReady, setAuthTokenReady] = useState(false);
  const [authProbeTimedOut, setAuthProbeTimedOut] = useState(false);
  const authReady = isLoaded || authTokenReady || authProbeTimedOut;
  const hasAuthenticatedAccess = isSignedIn || Boolean(userId) || authTokenReady;
  const searchParams = useSearchParams();
  const isDemo = authReady && (searchParams.get('demo') === 'true' || !hasAuthenticatedAccess);
  // Load from cache immediately (SWR pattern)
  const [tasks, setTasks] = useState<Task[]>(() => {
    if (typeof window === 'undefined') return [];
    const cached = getCachedData<Task[]>('roadmap_tasks', userId || undefined);
    return cached || [];
  });
  const [isLoading, setIsLoading] = useState(() => {
    if (typeof window === 'undefined') return true;
    const cached = getCachedData<Task[]>('roadmap_tasks', userId || undefined);
    return !cached; // Not loading if we have cache
  });
  const [filter, setFilter] = useState<'pipeline' | 'todo' | 'in_progress' | 'testing' | 'done'>('todo');
  const [projectFilter, setProjectFilter] = useState<string>('all'); // 'all' or projectId
  const [projects, setProjects] = useState<{ id: string; name: string; icon?: string }[]>([]);
  const [agents, setAgents] = useState<{ id: string; name: string; icon?: string; projectId?: string }[]>([]);
  const [channels, setChannels] = useState<{ key: string; name: string }[]>([]); // kept for legacy display
  const [showAddModal, setShowAddModal] = useState(false);
  const [newTask, setNewTask] = useState({ title: '', description: '', images: [] as string[], channelKey: '', projectId: '', agentId: '' });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [isSavingOrder, setIsSavingOrder] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [editForm, setEditForm] = useState({ title: '', description: '', images: [] as string[], channelKey: '', projectId: '', agentId: '' });
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [, forceUpdate] = useState(0); // Force re-render for time display
  const [selectedTasks, setSelectedTasks] = useState<Set<string>>(new Set());
  const [isDeleting, setIsDeleting] = useState(false);
  const [detailTask, setDetailTask] = useState<Task | null>(null); // Mobile: task detail modal
  const [activeTab, setActiveTab] = useState<'tasks' | 'routines'>('tasks');
  
  // Notifications for "À tester" status changes
  const { sendNotification, permission, isSupported } = useNotifications();
  const previousTestingIdsRef = useRef<Set<string>>(new Set());
  const isInitialLoadRef = useRef(true);

  const getAuthHeaders = useCallback(async (baseHeaders: Record<string, string> = {}) => {
    const token = await getToken();
    if (token) {
      return { ...baseHeaders, Authorization: `Bearer ${token}` };
    }
    return baseHeaders;
  }, [getToken]);

  useEffect(() => {
    if (isLoaded) {
      setAuthTokenReady(false);
      setAuthProbeTimedOut(false);
      return;
    }

    let cancelled = false;
    const startedAt = Date.now();

    const probeToken = async () => {
      try {
        const token = await getToken();
        if (cancelled) return;

        if (token) {
          setAuthTokenReady(true);
          setAuthProbeTimedOut(false);
          return;
        }

        if (Date.now() - startedAt >= ROADMAP_AUTH_PROBE_TIMEOUT_MS) {
          setAuthProbeTimedOut(true);
        }
      } catch (error) {
        if (!cancelled && Date.now() - startedAt >= ROADMAP_AUTH_PROBE_TIMEOUT_MS) {
          setAuthProbeTimedOut(true);
        }
        console.warn('[Roadmap] Deferred auth token probe failed:', error);
      }
    };

    void probeToken();
    const intervalId = window.setInterval(() => {
      void probeToken();
    }, ROADMAP_AUTH_PROBE_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [getToken, isLoaded]);

  // DnD sensors - including TouchSensor for iOS
  // Note: KeyboardSensor removed because it captures Space key and breaks input fields
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // 8px movement before drag starts
      },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 200, // 200ms hold before drag starts on touch
        tolerance: 8,
      },
    })
  );

  // Fetch tasks function (reusable for refresh button)
  const fetchTasks = useCallback(async (showRefreshing = false, force = false) => {
    // Demo mode: use local demo tasks
    if (isDemo) {
      setTasks(getDemoTasks(locale));
      setIsLoading(false);
      setLastUpdated(new Date());
      return;
    }
    
    // Skip polling if currently saving order (unless forced)
    if (isSavingOrder && !force && !showRefreshing) return;
    
    if (showRefreshing) setIsRefreshing(true);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch('/api/roadmap', { headers });
      if (res.ok) {
        const data = await res.json();
        const newTasks: Task[] = data.tasks;
        
        // Check for new "testing" tasks and notify
        if (!isInitialLoadRef.current && isSupported && permission === 'granted') {
          const newTestingTasks = newTasks.filter(
            (t: Task) => t.status === 'testing' && !previousTestingIdsRef.current.has(t.id)
          );
          
          // Send notification for each new testing task
          for (const task of newTestingTasks) {
            sendNotification(
              '🧪 Nouvelle tâche à tester',
              task.title,
              '/roadmap'
            );
          }
        }
        
        // Update tracking set
        previousTestingIdsRef.current = new Set(
          newTasks.filter((t: Task) => t.status === 'testing').map((t: Task) => t.id)
        );
        isInitialLoadRef.current = false;
        
        setTasks(newTasks);
        setLastUpdated(new Date());
        // Save to cache for instant load next time
        setCachedData('roadmap_tasks', newTasks, userId || undefined);
      }
    } catch (e) {
      console.error('Failed to fetch tasks:', e);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [getAuthHeaders, isDemo, locale, isSupported, permission, sendNotification, isSavingOrder, userId]);

  // Fetch tasks with polling - wait for auth to be loaded first
  useEffect(() => {
    // Don't fetch until auth state is known
    if (!authReady) return;
    
    // Initial fetch
    fetchTasks();
    
    // Poll every 10 seconds for live updates
    const pollInterval = setInterval(() => fetchTasks(false), 10000);
    
    // Update time display every second
    const timeInterval = setInterval(() => forceUpdate(n => n + 1), 1000);
    
    return () => {
      clearInterval(pollInterval);
      clearInterval(timeInterval);
    };
  }, [authReady, fetchTasks]);

  // Fetch projects + agents for filter & forms
  useEffect(() => {
    // Always try to load agents - let API handle authentication
    // Skip only in pure demo mode (explicit demo param)
    if (searchParams.get('demo') === 'true') return;
    
    getAuthHeaders()
      .then((headers) => fetch('/api/projects', { headers }))
      .then(res => res.json())
      .then(data => {
        const list = data.projects || data;
        if (Array.isArray(list)) {
          setProjects(list.map((p: any) => ({ id: p.id, name: p.name, icon: p.icon })));
          // Extract agents from projects as fallback
          const projectAgents: { id: string; name: string; icon?: string; projectId?: string }[] = [];
          for (const p of list) {
            if (Array.isArray(p.agents)) {
              for (const a of p.agents) {
                if (!projectAgents.find(x => x.id === a.id)) {
                  projectAgents.push({ id: a.id, name: a.name, icon: a.icon, projectId: p.id });
                }
              }
            }
          }
          if (projectAgents.length > 0) {
            setAgents(prev => prev.length > 0 ? prev : projectAgents);
          }
        }
      })
      .catch(err => console.error('Failed to fetch projects:', err));
    // Fetch agents
    getAuthHeaders()
      .then((headers) => fetch('/api/agents?scope=adopted', { headers }))
      .then(res => {
        if (!res.ok) {
          console.warn('[Roadmap] agents API returned', res.status, '— falling back to projects.agents');
          return null;
        }
        return res.json();
      })
      .then(data => {
        if (!data) return;
        const list = data.agents || data;
        if (Array.isArray(list)) {
          setAgents(list.map((a: any) => ({ id: a.id, name: a.name, icon: a.icon, projectId: a.projectId })));
        }
      })
      .catch(err => console.error('Failed to fetch agents:', err));
    // Keep channels for legacy tasks display
    getAuthHeaders()
      .then((headers) => fetch('/api/channels', { headers }))
      .then(res => res.json())
      .then(data => {
        if (data.channels) {
          setChannels(data.channels.map((ch: any) => ({ key: ch.key, name: ch.name })));
        }
      })
      .catch(err => console.error('Failed to fetch channels:', err));
  }, [getAuthHeaders, searchParams, userId]);

  // Normalize status (a_tester → testing for filtering)
  const normalizeStatus = (status: string) => status === 'a_tester' ? 'testing' : status;
  
  // Filter tasks (by status AND project)
  const filteredTasks = tasks.filter(t => {
    const matchesStatus = normalizeStatus(t.status) === filter;
    const matchesProject = projectFilter === 'all' || (projectFilter === '__none__' ? !t.projectId : (t.projectId === projectFilter || (!t.projectId && t.channelKey === projectFilter)));
    return matchesStatus && matchesProject;
  });

  // Update task status
  const updateStatus = async (taskId: string, newStatus: string) => {
    // Optimistic update - update UI immediately
    const previousTasks = tasks;
    setTasks(prev => prev.map(t => t.id === taskId 
      ? {
          ...t,
          status: newStatus,
          completedAt: newStatus === 'done' ? new Date().toISOString() : undefined,
        }
      : t
    ));
    
    // Block polling for 3 seconds to prevent flickering
    setIsSavingOrder(true);
    
    try {
      const headers = await getAuthHeaders({ 'Content-Type': 'application/json' });
      const res = await fetch('/api/roadmap', {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ id: taskId, status: newStatus }),
      });
      if (!res.ok) {
        setTasks(previousTasks);
      }
      // No fetchTasks here — optimistic update is enough
      // Next poll cycle (10s) will sync with server
    } catch (e) {
      console.error('Failed to update task:', e);
      setTasks(previousTasks);
    } finally {
      // Keep polling blocked for 2s extra to let server propagate
      setTimeout(() => setIsSavingOrder(false), 2000);
    }
  };

  // Handle drag end - reorder tasks
  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    const { active, over } = event;
    
    if (!over || active.id === over.id) return;

    const oldIndex = filteredTasks.findIndex(t => t.id === active.id);
    const newIndex = filteredTasks.findIndex(t => t.id === over.id);
    
    if (oldIndex === -1 || newIndex === -1) return;

    // Optimistically update UI
    const reorderedFiltered = arrayMove(filteredTasks, oldIndex, newIndex);
    
    // Calculate new priorities properly:
    // Find max priority among tasks NOT in current filter
    // Then assign priorities to reordered tasks starting from max+count
    const filteredIds = new Set(filteredTasks.map(t => t.id));
    const nonFilteredTasks = tasks.filter(t => !filteredIds.has(t.id));
    const maxNonFilteredPriority = nonFilteredTasks.length > 0 
      ? Math.max(...nonFilteredTasks.map(t => t.priority))
      : 0;
    
    // Assign priorities: first item gets highest priority
    const updates = reorderedFiltered.map((task, index) => ({
      id: task.id,
      priority: maxNonFilteredPriority + reorderedFiltered.length - index,
    }));

    // Update local state
    setTasks(prev => {
      const newTasks = [...prev];
      for (const update of updates) {
        const idx = newTasks.findIndex(t => t.id === update.id);
        if (idx !== -1) {
          newTasks[idx] = { ...newTasks[idx], priority: update.priority };
        }
      }
      // Re-sort by priority only - l'ordre affiché fait foi
      return newTasks.sort((a, b) => b.priority - a.priority);
    });

    // Save to DB - disable polling during save to prevent overwriting
    setIsSavingOrder(true);
    try {
      const reorderHeaders = await getAuthHeaders({ 'Content-Type': 'application/json' });
      await fetch('/api/roadmap/reorder', {
        method: 'POST',
        headers: reorderHeaders,
        body: JSON.stringify({ updates }),
      });
      // Refresh with confirmed server data
      await fetchTasks(false, true);
    } catch (e) {
      console.error('Failed to save order:', e);
      // On error, refetch to restore correct state
      fetchTasks(false);
    } finally {
      setIsSavingOrder(false);
    }
  }, [filteredTasks, tasks, fetchTasks]);

  // Delete task
  const deleteTask = async (taskId: string) => {
    try {
      const deleteHeaders = await getAuthHeaders();
      const res = await fetch(`/api/roadmap/${taskId}`, {
        method: 'DELETE',
        headers: deleteHeaders,
      });
      if (res.ok) {
        setTasks(prev => prev.filter(t => t.id !== taskId));
        setSelectedTasks(prev => {
          const next = new Set(prev);
          next.delete(taskId);
          return next;
        });
      }
    } catch (e) {
      console.error('Failed to delete task:', e);
    }
  };

  // Toggle task selection
  const toggleTaskSelection = (taskId: string) => {
    setSelectedTasks(prev => {
      const next = new Set(prev);
      if (next.has(taskId)) {
        next.delete(taskId);
      } else {
        next.add(taskId);
      }
      return next;
    });
  };

  // Select all filtered tasks
  const selectAllFiltered = () => {
    const filteredIds = filteredTasks.map(t => t.id);
    const allSelected = filteredIds.every(id => selectedTasks.has(id));
    if (allSelected) {
      // Deselect all
      setSelectedTasks(prev => {
        const next = new Set(prev);
        filteredIds.forEach(id => next.delete(id));
        return next;
      });
    } else {
      // Select all
      setSelectedTasks(prev => new Set([...prev, ...filteredIds]));
    }
  };

  // Delete selected tasks
  const deleteSelectedTasks = async () => {
    if (selectedTasks.size === 0) return;
    
    const confirmMsg = locale === 'en' 
      ? `Delete ${selectedTasks.size} selected tasks?`
      : locale === 'de'
      ? `${selectedTasks.size} ausgewählte Aufgaben löschen?`
      : `Supprimer ${selectedTasks.size} tâches sélectionnées ?`;
    
    if (!confirm(confirmMsg)) return;
    
    setIsDeleting(true);
    try {
      const deleteHeaders = await getAuthHeaders({ 'Content-Type': 'application/json' });
      
      // Delete all selected tasks
      const taskIds = Array.from(selectedTasks);
      await Promise.all(taskIds.map(taskId => 
        fetch(`/api/roadmap/${taskId}`, {
          method: 'DELETE',
          headers: deleteHeaders,
        })
      ));
      
      setTasks(prev => prev.filter(t => !selectedTasks.has(t.id)));
      setSelectedTasks(new Set());
    } catch (e) {
      console.error('Failed to delete tasks:', e);
    } finally {
      setIsDeleting(false);
    }
  };

  // Clear selection when filter changes
  useEffect(() => {
    setSelectedTasks(new Set());
  }, [filter]);

  // Edit task
  const handleEditTask = async () => {
    if (!editingTask || !editForm.title.trim()) return;
    
    setIsSubmitting(true);
    try {
      const editHeaders = await getAuthHeaders({ 'Content-Type': 'application/json' });
      const res = await fetch(`/api/roadmap/${editingTask.id}`, {
        method: 'PATCH',
        headers: editHeaders,
        body: JSON.stringify({
          title: editForm.title,
          description: editForm.description || null,
          images: editForm.images.length > 0 ? editForm.images : null,
          channelKey: editForm.channelKey || null,
          projectId: editForm.projectId || null,
          agentId: editForm.agentId || null,
        }),
      });
      if (res.ok) {
        const updatedTask = await res.json();
        setTasks(prev => prev.map(t => t.id === editingTask.id ? updatedTask : t));
        setEditingTask(null);
        setEditForm({ title: '', description: '', images: [], channelKey: '', projectId: '', agentId: '' });
      }
    } catch (e) {
      console.error('Failed to edit task:', e);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Open edit modal
  const openEditModal = (task: Task) => {
    setEditingTask(task);
    setEditForm({ title: task.title, description: task.description || '', images: task.images || [], channelKey: task.channelKey || '', projectId: task.projectId || '', agentId: task.agentId || '' });
  };

  // Handle image upload for task
  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    
    setIsUploadingImage(true);
    const uploadedUrls: string[] = [];
    
    try {
      for (const file of Array.from(files)) {
        const formData = new FormData();
        formData.append('file', file);
        
        const res = await fetch('/api/upload', {
          method: 'POST',
          body: formData,
        });
        
        if (res.ok) {
          const data = await res.json();
          uploadedUrls.push(data.url);
        }
      }
      
      setNewTask(prev => ({
        ...prev,
        images: [...prev.images, ...uploadedUrls]
      }));
    } catch (error) {
      console.error('Failed to upload image:', error);
    } finally {
      setIsUploadingImage(false);
      e.target.value = ''; // Reset input
    }
  };

  // Remove image from task
  const removeImage = (index: number) => {
    setNewTask(prev => ({
      ...prev,
      images: prev.images.filter((_, i) => i !== index)
    }));
  };

  // Handle image upload for edit form
  const handleEditImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    
    setIsUploadingImage(true);
    const uploadedUrls: string[] = [];
    
    try {
      for (const file of Array.from(files)) {
        const formData = new FormData();
        formData.append('file', file);
        
        const res = await fetch('/api/upload', {
          method: 'POST',
          body: formData,
        });
        
        if (res.ok) {
          const data = await res.json();
          uploadedUrls.push(data.url);
        }
      }
      
      setEditForm(prev => ({
        ...prev,
        images: [...prev.images, ...uploadedUrls]
      }));
    } catch (error) {
      console.error('Failed to upload image:', error);
    } finally {
      setIsUploadingImage(false);
      e.target.value = ''; // Reset input
    }
  };

  // Remove image from edit form
  const removeEditImage = (index: number) => {
    setEditForm(prev => ({
      ...prev,
      images: prev.images.filter((_, i) => i !== index)
    }));
  };

  // Add new task
  const handleAddTask = async () => {
    if (!newTask.title.trim()) return;
    if (!newTask.projectId) {
      alert(locale === 'en' ? 'Please select a project' : locale === 'de' ? 'Bitte wähle ein Projekt' : 'Veuillez sélectionner un projet');
      return;
    }
    
    setIsSubmitting(true);
    try {
      const addHeaders = await getAuthHeaders({ 'Content-Type': 'application/json' });
      const res = await fetch('/api/roadmap', {
        method: 'POST',
        headers: addHeaders,
        body: JSON.stringify({
          title: newTask.title,
          description: newTask.description || undefined,
          images: newTask.images.length > 0 ? newTask.images : undefined,
          source: 'user',
          status: 'pipeline', // Nouvelles tâches vont dans Pipeline par défaut
          channelKey: newTask.channelKey || undefined,
          projectId: newTask.projectId || undefined,
          agentId: newTask.agentId || undefined,
        }),
      });
      if (res.ok) {
        const { task } = await res.json();
        setTasks(prev => [task, ...prev]);
        setNewTask({ title: '', description: '', images: [], channelKey: '', projectId: '', agentId: '' });
        setShowAddModal(false);
      } else {
        const errorData = await res.json().catch(() => ({}));
        console.error('Failed to add task:', res.status, errorData);
        alert(`Erreur: ${errorData.error || 'Impossible de créer la tâche. Êtes-vous connecté?'}`);
      }
    } catch (e) {
      console.error('Failed to add task:', e);
      alert('Erreur réseau. Veuillez réessayer.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Get status label based on locale
  const getStatusLabel = (status: string) => {
    const config = getStatusConfig(status);
    if (locale === 'en') return config.labelEn;
    if (locale === 'de') return config.labelDe;
    return config.label;
  };

  // Format date
  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString(locale === 'en' ? 'en-US' : locale === 'de' ? 'de-DE' : 'fr-FR', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  };

  // Stats (normalize a_tester → testing) — filtered by selected project
  const projectTasks = projectFilter === 'all' 
    ? tasks 
    : projectFilter === '__none__'
    ? tasks.filter(t => !t.projectId)
    : tasks.filter(t => t.projectId === projectFilter || (!t.projectId && t.channelKey === projectFilter));
  const stats = {
    total: projectTasks.length,
    pipeline: projectTasks.filter(t => normalizeStatus(t.status) === 'pipeline').length,
    todo: projectTasks.filter(t => normalizeStatus(t.status) === 'todo').length,
    in_progress: projectTasks.filter(t => normalizeStatus(t.status) === 'in_progress').length,
    testing: projectTasks.filter(t => normalizeStatus(t.status) === 'testing').length,
    done: projectTasks.filter(t => normalizeStatus(t.status) === 'done').length,
  };

  // Show loading state while auth is being determined
  if (!authReady) {
    return (
      <AppLayout>
        <div className="bg-gray-900 min-h-screen flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
            <p className="text-gray-400">{t('common.loading')}</p>
          </div>
        </div>
        <BottomNav />
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="bg-gray-900 py-8 px-4 pb-24 md:pb-8">
        <div className="max-w-4xl mx-auto">
          {isDemo && <DemoBanner />}

          {/* Header */}
          <div className="flex items-center justify-between mb-8">
            <div>
              <h1 className="text-3xl font-bold text-white flex items-center gap-2">
                {locale === 'en' ? 'Roadmap' : locale === 'de' ? 'Roadmap' : 'Roadmap'}
                {isSavingOrder && (
                  <span className="text-sm font-normal text-gray-400 animate-pulse">
                    {locale === 'en' ? 'Saving...' : locale === 'de' ? 'Speichern...' : 'Sauvegarde...'}
                  </span>
                )}
              </h1>
              <p className="text-gray-400 mt-1 flex items-center gap-3">
                <span>
                  {locale === 'en' 
                    ? `${stats.done}/${stats.total} tasks completed`
                    : locale === 'de'
                    ? `${stats.done}/${stats.total} Aufgaben erledigt`
                    : `${stats.done}/${stats.total} tâches terminées`}
                </span>
                <span className="text-gray-500 text-sm flex items-center gap-1">
                  •
                  <button 
                    onClick={() => fetchTasks(true)}
                    className="hover:text-white transition-colors flex items-center gap-1"
                    disabled={isRefreshing}
                  >
                    <span className={isRefreshing ? 'animate-spin' : ''}>🔄</span>
                    {lastUpdated && (
                      <span className="text-xs">
                        {Math.floor((Date.now() - lastUpdated.getTime()) / 1000) < 5 
                          ? 'à jour' 
                          : `il y a ${Math.floor((Date.now() - lastUpdated.getTime()) / 1000)}s`}
                      </span>
                    )}
                  </button>
                </span>
              </p>
            </div>
            {isSignedIn && (
              <button
                onClick={() => setShowAddModal(true)}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors flex items-center gap-2"
              >
                <span className="text-xl">+</span>
                {locale === 'en' ? 'Suggest' : locale === 'de' ? 'Vorschlagen' : 'Proposer'}
              </button>
            )}
          </div>

          {/* Tabs: Tâches / Routines */}
          <div className="flex gap-1 mb-6 bg-gray-800 rounded-lg p-1">
            <button
              onClick={() => setActiveTab('tasks')}
              className={`flex-1 px-4 py-2.5 text-sm font-medium rounded-md transition-colors ${
                activeTab === 'tasks'
                  ? 'bg-gray-700 text-white'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              📋 {locale === 'en' ? 'Tasks' : locale === 'de' ? 'Aufgaben' : 'Tâches'}
            </button>
            <button
              onClick={() => setActiveTab('routines')}
              className={`flex-1 px-4 py-2.5 text-sm font-medium rounded-md transition-colors ${
                activeTab === 'routines'
                  ? 'bg-gray-700 text-white'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              🔄 Routines
            </button>
          </div>

          {activeTab === 'routines' && (
            <RoutinesTab
              userId={userId}
              availableAgents={agents.map((agent) => ({
                id: agent.id,
                name: agent.name,
                icon: agent.icon,
              }))}
              availableProjects={projects}
            />
          )}

          <div className={activeTab !== 'tasks' ? 'hidden' : ''}>
          {/* Stats - Removed sticky on mobile (was causing iOS scroll issues) */}
          <div className="bg-gray-900 pb-4">
            <div className="grid grid-cols-5 gap-2 md:gap-3">
              {(['pipeline', 'todo', 'in_progress', 'testing', 'done'] as const).map((status) => (
                <button
                  key={status}
                  onClick={() => setFilter(status)}
                  className={`p-2 md:p-4 rounded-lg transition-all ${
                    filter === status 
                      ? 'bg-gray-700 ring-2 ring-blue-500' 
                      : 'bg-gray-800 hover:bg-gray-750'
                  }`}
                >
                  <div className="text-lg md:text-2xl mb-0.5 md:mb-1">
                    {getStatusConfig(status).emoji}
                  </div>
                  <div className="text-white font-medium text-xs md:text-base truncate">
                    {getStatusLabel(status)}
                  </div>
                  <div className="text-lg md:text-2xl font-bold text-white">
                    {stats[status]}
                  </div>
                </button>
              ))}
            </div>

            {/* Progress bar */}
            <div className="mt-3 md:mt-4">
              <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-green-500 transition-all duration-500"
                  style={{ width: `${stats.total > 0 ? (stats.done / stats.total) * 100 : 0}%` }}
                />
              </div>
            </div>

            {/* Project filter */}
            {projects.length > 0 && (
              <div className="mt-3 flex items-center gap-2">
                <span className="text-gray-400 text-sm">📁 {locale === 'en' ? 'Project:' : locale === 'de' ? 'Projekt:' : 'Projet :'}</span>
                <select
                  value={projectFilter}
                  onChange={(e) => setProjectFilter(e.target.value)}
                  className="bg-gray-800 text-white text-sm rounded-lg px-3 py-1.5 border border-gray-700 focus:border-blue-500 focus:outline-none"
                >
                  <option value="all">{locale === 'en' ? 'All projects' : locale === 'de' ? 'Alle Projekte' : 'Tous les projets'}</option>
                  {projects.map(p => (
                    <option key={p.id} value={p.id}>{p.icon || '📁'} {p.name}</option>
                  ))}
                  <option value="__none__">{locale === 'en' ? '📂 Default (no project)' : locale === 'de' ? '📂 Standard (kein Projekt)' : '📂 Default (sans projet)'}</option>
                </select>
              </div>
            )}
          </div>

          {/* Selection bar & Drag hint */}
          {isSignedIn && filteredTasks.length > 0 && (
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-4">
                {/* Select all checkbox */}
                <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-400 hover:text-white">
                  <input
                    type="checkbox"
                    checked={filteredTasks.length > 0 && filteredTasks.every(t => selectedTasks.has(t.id))}
                    onChange={selectAllFiltered}
                    className="w-4 h-4 rounded border-gray-600 bg-gray-700 text-blue-500 focus:ring-blue-500 cursor-pointer"
                  />
                  {locale === 'en' ? 'Select all' : locale === 'de' ? 'Alle auswählen' : 'Tout sélectionner'}
                </label>
                
                {/* Delete selected button */}
                {selectedTasks.size > 0 && (
                  <button
                    onClick={deleteSelectedTasks}
                    disabled={isDeleting}
                    className="px-3 py-1 bg-red-600 hover:bg-red-700 disabled:bg-gray-600 text-white text-sm rounded-lg transition-colors flex items-center gap-1"
                  >
                    {isDeleting ? (
                      <>
                        <span className="animate-spin">⏳</span>
                        {locale === 'en' ? 'Deleting...' : locale === 'de' ? 'Löschen...' : 'Suppression...'}
                      </>
                    ) : (
                      <>
                        🗑️ {locale === 'en' 
                          ? `Delete (${selectedTasks.size})`
                          : locale === 'de'
                          ? `Löschen (${selectedTasks.size})`
                          : `Supprimer (${selectedTasks.size})`}
                      </>
                    )}
                  </button>
                )}
              </div>
              
              {/* Drag hint */}
              {filteredTasks.length > 1 && (
                <p className="text-xs text-gray-500 flex items-center gap-2">
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                    <circle cx="4" cy="3" r="1.5"/>
                    <circle cx="12" cy="3" r="1.5"/>
                    <circle cx="4" cy="8" r="1.5"/>
                    <circle cx="12" cy="8" r="1.5"/>
                    <circle cx="4" cy="13" r="1.5"/>
                    <circle cx="12" cy="13" r="1.5"/>
                  </svg>
                  {locale === 'en' 
                    ? 'Drag to reorder'
                    : locale === 'de'
                    ? 'Ziehen zum Neuordnen'
                    : 'Glisser pour réordonner'}
                </p>
              )}
            </div>
          )}

          {/* Task list with DnD */}
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={filteredTasks.map(t => t.id)}
              strategy={verticalListSortingStrategy}
            >
              <div className="space-y-3">
                {isLoading ? (
                  <div className="text-center py-12">
                    <div className="animate-spin w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full mx-auto" />
                  </div>
                ) : filteredTasks.length === 0 ? (
                  <div className="text-center py-12 text-gray-400">
                    {locale === 'en' 
                      ? 'No tasks yet'
                      : locale === 'de'
                      ? 'Noch keine Aufgaben'
                      : 'Aucune tâche pour le moment'}
                  </div>
                ) : (
                  filteredTasks.map((task) => (
                    <SortableTaskItem
                      key={task.id}
                      task={task}
                      isSignedIn={isSignedIn || false}
                      locale={locale}
                      userId={userId}
                      getAuthHeaders={getAuthHeaders}
                      channels={channels}
                      onUpdateStatus={updateStatus}
                      onEdit={openEditModal}
                      onDelete={deleteTask}
                      getStatusLabel={getStatusLabel}
                      formatDate={formatDate}
                      isSelected={selectedTasks.has(task.id)}
                      onToggleSelect={toggleTaskSelection}
                      onShowDetails={setDetailTask}
                    />
                  ))
                )}
              </div>
            </SortableContext>
          </DndContext>
        </div>

        {/* Task Detail Modal (Mobile) */}
        {detailTask && (
          <div 
            className="fixed inset-0 bg-black/70 flex items-end sm:items-center justify-center z-50"
            onClick={() => setDetailTask(null)}
          >
            <div 
              className="bg-gray-800 rounded-t-2xl sm:rounded-lg p-5 w-full sm:max-w-lg max-h-[85vh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <span className="text-xl">{getStatusConfig(detailTask.status).emoji}</span>
                  <h2 className="text-lg font-bold text-white">
                    {detailTask.title}
                  </h2>
                </div>
                <button 
                  onClick={() => setDetailTask(null)}
                  className="text-gray-400 hover:text-white p-1 ml-2"
                >
                  ✕
                </button>
              </div>

              {/* Status badge */}
              <div className="flex items-center gap-2 mb-4">
                <span className={`text-xs px-2 py-1 rounded ${
                  getStatusConfig(detailTask.status).color
                }`}>
                  {getStatusLabel(detailTask.status as keyof typeof STATUS_CONFIG)}
                </span>
                <span className={`text-xs px-2 py-1 rounded ${
                  detailTask.source === 'agent' ? 'bg-purple-500/20 text-purple-300' : 'bg-gray-600 text-gray-300'
                }`}>
                  {detailTask.source === 'agent' ? '🤖 Agent' : '👤 User'}
                </span>
              </div>

              {/* Description */}
              {detailTask.description && (
                <div className="mb-4">
                  <h3 className="text-sm text-gray-400 mb-2">
                    {locale === 'en' ? 'Description' : locale === 'de' ? 'Beschreibung' : 'Description'}
                  </h3>
                  <p className="text-gray-300 text-sm whitespace-pre-wrap">
                    {detailTask.description}
                  </p>
                </div>
              )}

              {/* Attachments */}
              {detailTask.images && detailTask.images.length > 0 && (
                <div className="mb-4">
                  <h3 className="text-sm text-gray-400 mb-2">
                    {locale === 'en' ? 'Attachments' : locale === 'de' ? 'Anhänge' : 'Pièces jointes'}
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {detailTask.images.map((url, index) => {
                      const isImage = /\.(jpg|jpeg|png|gif|webp|heic|heif)$/i.test(url);
                      const filename = url.split('/').pop()?.split('-').pop() || 'file';
                      return (
                        <a key={index} href={url} target="_blank" rel="noopener noreferrer">
                          {isImage ? (
                            <img 
                              src={url} 
                              alt={`Image ${index + 1}`}
                              className="w-24 h-24 object-cover rounded-lg border border-gray-600 hover:border-blue-500 transition-colors cursor-pointer"
                            />
                          ) : (
                            <div className="w-24 h-24 bg-gray-700 rounded-lg border border-gray-600 hover:border-blue-500 transition-colors cursor-pointer flex flex-col items-center justify-center p-2">
                              <span className="text-4xl">{getFileIcon(url)}</span>
                              <span className="text-xs text-gray-400 truncate w-full text-center mt-2">{filename}</span>
                            </div>
                          )}
                        </a>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Dates */}
              <div className="text-xs text-gray-500 pt-4 border-t border-gray-700">
                <div>{locale === 'en' ? 'Created' : locale === 'de' ? 'Erstellt' : 'Créé le'}: {formatDate(detailTask.createdAt)}</div>
                {detailTask.completedAt && (
                  <div className="mt-1">
                    {locale === 'en' ? 'Completed' : locale === 'de' ? 'Erledigt' : 'Terminé le'}: {formatDate(detailTask.completedAt)}
                  </div>
                )}
              </div>

              {/* Close button */}
              <button
                onClick={() => setDetailTask(null)}
                className="w-full mt-4 px-4 py-3 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
              >
                {locale === 'en' ? 'Close' : locale === 'de' ? 'Schließen' : 'Fermer'}
              </button>
            </div>
          </div>
        )}

        {/* Add Task Modal */}
        {showAddModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-gray-800 rounded-lg p-6 w-full max-w-md">
              <h2 className="text-xl font-bold text-white mb-4">
                {locale === 'en' ? 'Suggest a feature' : locale === 'de' ? 'Feature vorschlagen' : 'Proposer une fonctionnalité'}
              </h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm text-gray-400 mb-1">
                    {locale === 'en' ? 'Title' : locale === 'de' ? 'Titel' : 'Titre'} *
                  </label>
                  <input
                    type="text"
                    value={newTask.title}
                    onChange={(e) => setNewTask(prev => ({ ...prev, title: e.target.value }))}
                    placeholder={locale === 'en' ? 'What do you want to add?' : locale === 'de' ? 'Was möchten Sie hinzufügen?' : 'Que voulez-vous ajouter ?'}
                    className="w-full px-3 py-2 bg-gray-700 text-white rounded-lg border border-gray-600 focus:border-blue-500 focus:outline-none"
                    autoFocus
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-1">
                    {locale === 'en' ? 'Description (optional)' : locale === 'de' ? 'Beschreibung (optional)' : 'Description (optionnel)'}
                  </label>
                  <textarea
                    value={newTask.description}
                    onChange={(e) => setNewTask(prev => ({ ...prev, description: e.target.value }))}
                    placeholder={locale === 'en' ? 'Additional details...' : locale === 'de' ? 'Weitere Details...' : 'Détails supplémentaires...'}
                    className="w-full px-3 py-2 bg-gray-700 text-white rounded-lg border border-gray-600 focus:border-blue-500 focus:outline-none resize-none"
                    rows={3}
                  />
                </div>

                {/* Project selector */}
                <div>
                  <label className="block text-sm text-gray-400 mb-1">
                    📁 {locale === 'en' ? 'Project *' : locale === 'de' ? 'Projekt *' : 'Projet *'}
                  </label>
                  {projects.length > 0 ? (
                    <select
                      value={newTask.projectId}
                      onChange={(e) => setNewTask(prev => ({ ...prev, projectId: e.target.value, agentId: '' }))}
                      className="w-full px-3 py-2 bg-gray-700 text-white rounded-lg border border-gray-600 focus:border-blue-500 focus:outline-none"
                      required
                    >
                      <option value="">{locale === 'en' ? 'Select a project' : locale === 'de' ? 'Projekt wählen' : 'Choisir un projet'}</option>
                      {projects.map(p => (
                        <option key={p.id} value={p.id}>{p.icon || '📁'} {p.name}</option>
                      ))}
                    </select>
                  ) : (
                    <div className="w-full px-3 py-2 bg-gray-700/50 border border-gray-600 rounded-lg">
                      <p className="text-gray-400 text-sm mb-2">
                        {locale === 'en' ? 'No projects found. Create one first:' : locale === 'de' ? 'Keine Projekte gefunden. Erstelle zuerst eines:' : 'Aucun projet trouvé. Créez-en un d\'abord :'}
                      </p>
                      <button
                        type="button"
                        onClick={() => window.location.href = '/projects'}
                        className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded text-sm"
                      >
                        📁 {locale === 'en' ? 'Create Project' : locale === 'de' ? 'Projekt erstellen' : 'Créer un projet'}
                      </button>
                    </div>
                  )}
                </div>

                {/* Agent selector (filtered by selected project) */}
                {agents.length > 0 && (
                  <div>
                    <label className="block text-sm text-gray-400 mb-1">
                      🤖 {locale === 'en' ? 'Agent (optional)' : locale === 'de' ? 'Agent (optional)' : 'Agent (optionnel)'}
                    </label>
                    <select
                      value={newTask.agentId}
                      onChange={(e) => setNewTask(prev => ({ ...prev, agentId: e.target.value }))}
                      className="w-full px-3 py-2 bg-gray-700 text-white rounded-lg border border-gray-600 focus:border-blue-500 focus:outline-none"
                    >
                      <option value="">{locale === 'en' ? 'No agent' : locale === 'de' ? 'Kein Agent' : 'Aucun agent'}</option>
                      {agents
                        .filter(a => !newTask.projectId || a.projectId === newTask.projectId)
                        .map(a => (
                          <option key={a.id} value={a.id}>{a.icon || '🤖'} {a.name}</option>
                        ))}
                    </select>
                  </div>
                )}
                
                {/* File Upload Section */}
                <div>
                  <label className="block text-sm text-gray-400 mb-1">
                    {locale === 'en' ? 'Attachments (optional)' : locale === 'de' ? 'Anhänge (optional)' : 'Pièces jointes (optionnel)'}
                  </label>
                  <div className="flex flex-wrap gap-2 mb-2">
                    {newTask.images.map((url, index) => {
                      const isImage = /\.(jpg|jpeg|png|gif|webp|heic|heif)$/i.test(url);
                      const filename = url.split('/').pop() || 'file';
                      return (
                        <div key={index} className="relative group">
                          {isImage ? (
                            <img 
                              src={url} 
                              alt={`Image ${index + 1}`}
                              className="w-16 h-16 object-cover rounded-lg border border-gray-600"
                            />
                          ) : (
                            <div className="w-16 h-16 bg-gray-700 rounded-lg border border-gray-600 flex flex-col items-center justify-center p-1">
                              <span className="text-2xl">{getFileIcon(url)}</span>
                              <span className="text-[8px] text-gray-400 truncate w-full text-center">{filename.split('-').pop()}</span>
                            </div>
                          )}
                          <button
                            onClick={() => removeImage(index)}
                            className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 hover:bg-red-600 text-white rounded-full text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            ✕
                          </button>
                        </div>
                      );
                    })}
                  </div>
                  <label className="cursor-pointer inline-flex items-center gap-2 px-3 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm text-gray-300 transition-colors">
                    <input
                      type="file"
                      accept="image/*,.pdf,.txt,.doc,.docx,.xls,.xlsx,.csv,.rtf,.md"
                      multiple
                      onChange={handleImageUpload}
                      className="hidden"
                      disabled={isUploadingImage}
                    />
                    {isUploadingImage ? (
                      <span>⏳ {locale === 'en' ? 'Uploading...' : locale === 'de' ? 'Hochladen...' : 'Upload...'}</span>
                    ) : (
                      <span>📎 {locale === 'en' ? 'Add files' : locale === 'de' ? 'Dateien hinzufügen' : 'Ajouter des fichiers'}</span>
                    )}
                  </label>
                </div>
              </div>
              <div className="flex justify-end gap-3 mt-6">
                <button
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 text-gray-400 hover:text-white transition-colors"
                >
                  {locale === 'en' ? 'Cancel' : locale === 'de' ? 'Abbrechen' : 'Annuler'}
                </button>
                <button
                  onClick={handleAddTask}
                  disabled={!newTask.title.trim() || isSubmitting}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors min-w-[100px] flex items-center justify-center gap-2"
                >
                  {isSubmitting 
                    ? (<><span className="animate-spin">⏳</span> {locale === 'en' ? 'Adding...' : locale === 'de' ? 'Hinzufügen...' : 'Ajout...'}</>) 
                    : (locale === 'en' ? 'Add' : locale === 'de' ? 'Hinzufügen' : 'Ajouter')}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Edit Task Modal */}
        {editingTask && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-gray-800 rounded-lg p-6 w-full max-w-md">
              <h2 className="text-xl font-bold text-white mb-4">
                {locale === 'en' ? 'Edit task' : locale === 'de' ? 'Aufgabe bearbeiten' : 'Modifier la tâche'}
              </h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm text-gray-400 mb-1">
                    {locale === 'en' ? 'Title' : locale === 'de' ? 'Titel' : 'Titre'} *
                  </label>
                  <input
                    type="text"
                    value={editForm.title}
                    onChange={(e) => setEditForm(prev => ({ ...prev, title: e.target.value }))}
                    className="w-full px-3 py-2 bg-gray-700 text-white rounded-lg border border-gray-600 focus:border-blue-500 focus:outline-none"
                    autoFocus
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-1">
                    {locale === 'en' ? 'Description (optional)' : locale === 'de' ? 'Beschreibung (optional)' : 'Description (optionnel)'}
                  </label>
                  <textarea
                    value={editForm.description}
                    onChange={(e) => setEditForm(prev => ({ ...prev, description: e.target.value }))}
                    className="w-full px-3 py-2 bg-gray-700 text-white rounded-lg border border-gray-600 focus:border-blue-500 focus:outline-none resize-none"
                    rows={3}
                  />
                </div>

                {/* Project selector for Edit */}
                {projects.length > 0 && (
                  <div>
                    <label className="block text-sm text-gray-400 mb-1">
                      📁 {locale === 'en' ? 'Project' : locale === 'de' ? 'Projekt' : 'Projet'}
                    </label>
                    <select
                      value={editForm.projectId}
                      onChange={(e) => setEditForm(prev => ({ ...prev, projectId: e.target.value, agentId: '' }))}
                      className="w-full px-3 py-2 bg-gray-700 text-white rounded-lg border border-gray-600 focus:border-blue-500 focus:outline-none"
                    >
                      <option value="">{locale === 'en' ? 'No project' : locale === 'de' ? 'Kein Projekt' : 'Aucun projet'}</option>
                      {projects.map(p => (
                        <option key={p.id} value={p.id}>{p.icon || '📁'} {p.name}</option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Agent selector for Edit */}
                {agents.length > 0 && (
                  <div>
                    <label className="block text-sm text-gray-400 mb-1">
                      🤖 {locale === 'en' ? 'Agent' : locale === 'de' ? 'Agent' : 'Agent'}
                    </label>
                    <select
                      value={editForm.agentId}
                      onChange={(e) => setEditForm(prev => ({ ...prev, agentId: e.target.value }))}
                      className="w-full px-3 py-2 bg-gray-700 text-white rounded-lg border border-gray-600 focus:border-blue-500 focus:outline-none"
                    >
                      <option value="">{locale === 'en' ? 'No agent' : locale === 'de' ? 'Kein Agent' : 'Aucun agent'}</option>
                      {agents
                        .filter(a => !editForm.projectId || a.projectId === editForm.projectId)
                        .map(a => (
                          <option key={a.id} value={a.id}>{a.icon || '🤖'} {a.name}</option>
                        ))}
                    </select>
                  </div>
                )}
                
                {/* File Upload Section for Edit */}
                <div>
                  <label className="block text-sm text-gray-400 mb-1">
                    {locale === 'en' ? 'Attachments (optional)' : locale === 'de' ? 'Anhänge (optional)' : 'Pièces jointes (optionnel)'}
                  </label>
                  <div className="flex flex-wrap gap-2 mb-2">
                    {editForm.images.map((url, index) => {
                      const isImage = /\.(jpg|jpeg|png|gif|webp|heic|heif)$/i.test(url);
                      const filename = url.split('/').pop() || 'file';
                      return (
                        <div key={index} className="relative group">
                          {isImage ? (
                            <img 
                              src={url} 
                              alt={`Image ${index + 1}`}
                              className="w-16 h-16 object-cover rounded-lg border border-gray-600"
                            />
                          ) : (
                            <div className="w-16 h-16 bg-gray-700 rounded-lg border border-gray-600 flex flex-col items-center justify-center p-1">
                              <span className="text-2xl">{getFileIcon(url)}</span>
                              <span className="text-[8px] text-gray-400 truncate w-full text-center">{filename.split('-').pop()}</span>
                            </div>
                          )}
                          <button
                            onClick={() => removeEditImage(index)}
                            className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 hover:bg-red-600 text-white rounded-full text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            ✕
                          </button>
                        </div>
                      );
                    })}
                  </div>
                  <label className="cursor-pointer inline-flex items-center gap-2 px-3 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm text-gray-300 transition-colors">
                    <input
                      type="file"
                      accept="image/*,.pdf,.txt,.doc,.docx,.xls,.xlsx,.csv,.rtf,.md"
                      multiple
                      onChange={handleEditImageUpload}
                      className="hidden"
                      disabled={isUploadingImage}
                    />
                    {isUploadingImage ? (
                      <span>⏳ {locale === 'en' ? 'Uploading...' : locale === 'de' ? 'Hochladen...' : 'Upload...'}</span>
                    ) : (
                      <span>📎 {locale === 'en' ? 'Add files' : locale === 'de' ? 'Dateien hinzufügen' : 'Ajouter des fichiers'}</span>
                    )}
                  </label>
                </div>
              </div>
              <div className="flex justify-end gap-3 mt-6">
                <button
                  onClick={() => {
                    setEditingTask(null);
                    setEditForm({ title: '', description: '', images: [], channelKey: '', projectId: '', agentId: '' });
                  }}
                  className="px-4 py-2 text-gray-400 hover:text-white transition-colors"
                >
                  {locale === 'en' ? 'Cancel' : locale === 'de' ? 'Abbrechen' : 'Annuler'}
                </button>
                <button
                  onClick={handleEditTask}
                  disabled={!editForm.title.trim() || isSubmitting}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors min-w-[120px] flex items-center justify-center gap-2"
                >
                  {isSubmitting 
                    ? (<><span className="animate-spin">⏳</span> {locale === 'en' ? 'Saving...' : locale === 'de' ? 'Speichern...' : 'Enregistrement...'}</>) 
                    : (locale === 'en' ? 'Save' : locale === 'de' ? 'Speichern' : 'Enregistrer')}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
      
      </div>
      {/* FAB - Create task */}
      {isSignedIn && !showAddModal && (
        <button
          onClick={() => setShowAddModal(true)}
          className="fixed bottom-20 right-4 md:bottom-8 md:right-8 z-30 w-14 h-14 bg-blue-600 hover:bg-blue-500 text-white rounded-full shadow-xl flex items-center justify-center text-2xl transition-all hover:scale-110 active:scale-95"
          title={locale === 'en' ? 'New task' : locale === 'de' ? 'Neue Aufgabe' : 'Nouvelle tâche'}
        >
          +
        </button>
      )}

      {/* Bottom Navigation - Mobile only */}
      <BottomNav />
    </AppLayout>
  );
}
