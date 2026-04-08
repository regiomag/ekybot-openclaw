'use client';

// Roadmap page - task management with drag & drop
import { useState, useEffect } from 'react';
import { useAuth } from '@clerk/nextjs';
import { AppLayout } from '@/components/AppLayout';
import { useTranslation } from '@/i18n/context';
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  closestCorners,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

interface Task {
  id: string;
  title: string;
  description?: string;
  status: 'todo' | 'in_progress' | 'done';
  priority: number;
  source: 'user' | 'agent';
  createdAt: string;
  completedAt?: string;
}

const STATUS_CONFIG = {
  todo: { emoji: '📋', label: 'À faire', labelEn: 'Todo', labelDe: 'Zu erledigen', color: 'bg-gray-600', dropColor: 'bg-gray-700' },
  in_progress: { emoji: '🔄', label: 'En cours', labelEn: 'In Progress', labelDe: 'In Arbeit', color: 'bg-blue-600', dropColor: 'bg-blue-900' },
  done: { emoji: '✅', label: 'Terminé', labelEn: 'Done', labelDe: 'Erledigt', color: 'bg-green-600', dropColor: 'bg-green-900' },
};

// Sortable Task Card Component
function SortableTaskCard({ 
  task, 
  locale, 
  formatDate, 
  getStatusLabel,
  isSignedIn,
  onDelete,
}: { 
  task: Task; 
  locale: string;
  formatDate: (d: string) => string;
  getStatusLabel: (s: keyof typeof STATUS_CONFIG) => string;
  isSignedIn: boolean;
  onDelete: (id: string) => void;
}) {
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
      className={`p-4 rounded-lg bg-gray-800 border-l-4 ${
        task.status === 'done' 
          ? 'border-green-500 opacity-75' 
          : task.status === 'in_progress'
          ? 'border-blue-500'
          : 'border-gray-600'
      } ${isDragging ? 'shadow-2xl ring-2 ring-blue-500' : ''}`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            {/* Drag handle */}
            <button
              {...attributes}
              {...listeners}
              className="cursor-grab active:cursor-grabbing text-gray-500 hover:text-gray-300 touch-none"
              title="Glisser pour déplacer"
            >
              ⋮⋮
            </button>
            <span className="text-lg">{STATUS_CONFIG[task.status].emoji}</span>
            <h3 className={`text-white font-medium ${task.status === 'done' ? 'line-through' : ''}`}>
              {task.title}
            </h3>
            <span className={`text-xs px-2 py-0.5 rounded ${
              task.source === 'agent' ? 'bg-purple-500/20 text-purple-300' : 'bg-gray-600 text-gray-300'
            }`}>
              {task.source === 'agent' ? '🤖 Agent' : '👤 User'}
            </span>
          </div>
          {task.description && (
            <p className="text-gray-400 text-sm mt-1 ml-10">{task.description}</p>
          )}
          <div className="text-xs text-gray-500 mt-2 ml-10">
            {formatDate(task.createdAt)}
            {task.completedAt && (
              <span className="ml-2">
                → {locale === 'en' ? 'Completed' : locale === 'de' ? 'Erledigt' : 'Terminé'} {formatDate(task.completedAt)}
              </span>
            )}
          </div>
        </div>
        {isSignedIn && (
          <button
            onClick={() => onDelete(task.id)}
            className="text-gray-500 hover:text-red-400 transition-colors"
            title="Supprimer"
          >
            🗑️
          </button>
        )}
      </div>
    </div>
  );
}

// Status Column Component
function StatusColumn({
  status,
  tasks,
  locale,
  formatDate,
  getStatusLabel,
  isSignedIn,
  onDelete,
  isOver,
}: {
  status: 'todo' | 'in_progress' | 'done';
  tasks: Task[];
  locale: string;
  formatDate: (d: string) => string;
  getStatusLabel: (s: keyof typeof STATUS_CONFIG) => string;
  isSignedIn: boolean;
  onDelete: (id: string) => void;
  isOver: boolean;
}) {
  const config = STATUS_CONFIG[status];
  
  return (
    <div 
      className={`flex-1 min-w-[300px] rounded-lg p-4 transition-colors ${
        isOver ? config.dropColor : 'bg-gray-800/50'
      }`}
    >
      <div className="flex items-center gap-2 mb-4 pb-2 border-b border-gray-700">
        <span className="text-xl">{config.emoji}</span>
        <h2 className="text-white font-semibold">{getStatusLabel(status)}</h2>
        <span className="text-gray-400 text-sm">({tasks.length})</span>
      </div>
      <SortableContext items={tasks.map(t => t.id)} strategy={verticalListSortingStrategy}>
        <div className="space-y-3 min-h-[100px]">
          {tasks.length === 0 ? (
            <div className="text-center py-8 text-gray-500 border-2 border-dashed border-gray-700 rounded-lg">
              {locale === 'en' ? 'Drop tasks here' : locale === 'de' ? 'Aufgaben hier ablegen' : 'Déposer les tâches ici'}
            </div>
          ) : (
            tasks.map((task) => (
              <SortableTaskCard
                key={task.id}
                task={task}
                locale={locale}
                formatDate={formatDate}
                getStatusLabel={getStatusLabel}
                isSignedIn={isSignedIn}
                onDelete={onDelete}
              />
            ))
          )}
        </div>
      </SortableContext>
    </div>
  );
}

export default function RoadmapPage() {
  const { t, locale } = useTranslation();
  const { isSignedIn } = useAuth();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newTask, setNewTask] = useState({ title: '', description: '' });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [overStatus, setOverStatus] = useState<string | null>(null);

  // Sensors for drag & drop
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 250,
        tolerance: 5,
      },
    })
  );

  // Fetch tasks
  useEffect(() => {
    const fetchTasks = async () => {
      try {
        const res = await fetch('/api/roadmap');
        if (res.ok) {
          const data = await res.json();
          setTasks(data.tasks);
        }
      } catch (e) {
        console.error('Failed to fetch tasks:', e);
      } finally {
        setIsLoading(false);
      }
    };
    fetchTasks();
  }, []);

  // Group tasks by status
  const tasksByStatus = {
    todo: tasks.filter(t => t.status === 'todo'),
    in_progress: tasks.filter(t => t.status === 'in_progress'),
    done: tasks.filter(t => t.status === 'done'),
  };

  // Get status label based on locale
  const getStatusLabel = (status: keyof typeof STATUS_CONFIG) => {
    const config = STATUS_CONFIG[status];
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

  // Update task status
  const updateStatus = async (taskId: string, newStatus: string) => {
    // Optimistic update
    setTasks(prev => prev.map(t => 
      t.id === taskId 
        ? { ...t, status: newStatus as Task['status'], completedAt: newStatus === 'done' ? new Date().toISOString() : undefined } 
        : t
    ));

    try {
      const res = await fetch('/api/roadmap', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: taskId, status: newStatus }),
      });
      if (!res.ok) {
        // Revert on error
        const tasks = await fetch('/api/roadmap').then(r => r.json());
        setTasks(tasks.tasks);
      }
    } catch (e) {
      console.error('Failed to update task:', e);
    }
  };

  // Delete task
  const deleteTask = async (taskId: string) => {
    if (!confirm(locale === 'en' ? 'Delete this task?' : locale === 'de' ? 'Diese Aufgabe löschen?' : 'Supprimer cette tâche ?')) {
      return;
    }

    // Optimistic delete
    setTasks(prev => prev.filter(t => t.id !== taskId));

    try {
      await fetch(`/api/roadmap?id=${taskId}`, { method: 'DELETE' });
    } catch (e) {
      console.error('Failed to delete task:', e);
    }
  };

  // Add new task
  const handleAddTask = async () => {
    if (!newTask.title.trim()) return;
    
    setIsSubmitting(true);
    try {
      const res = await fetch('/api/roadmap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: newTask.title,
          description: newTask.description || undefined,
          source: 'user',
        }),
      });
      if (res.ok) {
        const { task } = await res.json();
        setTasks(prev => [task, ...prev]);
        setNewTask({ title: '', description: '' });
        setShowAddModal(false);
      }
    } catch (e) {
      console.error('Failed to add task:', e);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Drag handlers
  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  };

  const handleDragOver = (event: any) => {
    const { over } = event;
    if (over) {
      // Determine which column we're over
      const overTask = tasks.find(t => t.id === over.id);
      if (overTask) {
        setOverStatus(overTask.status);
      }
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);
    setOverStatus(null);

    if (!over) return;

    const activeTask = tasks.find(t => t.id === active.id);
    const overTask = tasks.find(t => t.id === over.id);

    if (!activeTask) return;

    // If dropped on a task, use that task's status
    if (overTask && activeTask.status !== overTask.status) {
      updateStatus(activeTask.id, overTask.status);
    }
  };

  // Stats
  const stats = {
    total: tasks.length,
    todo: tasksByStatus.todo.length,
    in_progress: tasksByStatus.in_progress.length,
    done: tasksByStatus.done.length,
  };

  const activeTask = activeId ? tasks.find(t => t.id === activeId) : null;

  return (
    <AppLayout>
      <div className="min-h-screen bg-gray-900 py-8 px-4">
        <div className="max-w-7xl mx-auto">
          {/* Header */}
          <div className="flex items-center justify-between mb-8">
            <div>
              <h1 className="text-3xl font-bold text-white">
                {locale === 'en' ? 'Roadmap' : locale === 'de' ? 'Roadmap' : 'Roadmap'}
              </h1>
              <p className="text-gray-400 mt-1">
                {locale === 'en' 
                  ? `${stats.done}/${stats.total} tasks completed • Drag to change status`
                  : locale === 'de'
                  ? `${stats.done}/${stats.total} Aufgaben erledigt • Ziehen zum Ändern`
                  : `${stats.done}/${stats.total} tâches terminées • Glisser pour changer le statut`}
              </p>
            </div>
            {isSignedIn && (
              <button
                onClick={() => setShowAddModal(true)}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors flex items-center gap-2"
              >
                <span className="text-xl">+</span>
                {locale === 'en' ? 'Add Task' : locale === 'de' ? 'Aufgabe hinzufügen' : 'Ajouter'}
              </button>
            )}
          </div>

          {/* Progress bar */}
          <div className="mb-8">
            <div className="h-3 bg-gray-800 rounded-full overflow-hidden flex">
              <div 
                className="h-full bg-green-500 transition-all duration-500"
                style={{ width: `${stats.total > 0 ? (stats.done / stats.total) * 100 : 0}%` }}
              />
              <div 
                className="h-full bg-blue-500 transition-all duration-500"
                style={{ width: `${stats.total > 0 ? (stats.in_progress / stats.total) * 100 : 0}%` }}
              />
            </div>
            <div className="flex justify-between text-xs text-gray-500 mt-1">
              <span>✅ {stats.done} done</span>
              <span>🔄 {stats.in_progress} in progress</span>
              <span>📋 {stats.todo} todo</span>
            </div>
          </div>

          {/* Kanban Board */}
          {isLoading ? (
            <div className="text-center py-12">
              <div className="animate-spin w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full mx-auto" />
            </div>
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCorners}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDragEnd={handleDragEnd}
            >
              <div className="flex gap-4 overflow-x-auto pb-4">
                {(['todo', 'in_progress', 'done'] as const).map((status) => (
                  <StatusColumn
                    key={status}
                    status={status}
                    tasks={tasksByStatus[status]}
                    locale={locale}
                    formatDate={formatDate}
                    getStatusLabel={getStatusLabel}
                    isSignedIn={isSignedIn ?? false}
                    onDelete={deleteTask}
                    isOver={overStatus === status}
                  />
                ))}
              </div>
              <DragOverlay>
                {activeTask ? (
                  <div className="p-4 rounded-lg bg-gray-800 border-l-4 border-blue-500 shadow-2xl opacity-90">
                    <div className="flex items-center gap-2">
                      <span className="text-lg">{STATUS_CONFIG[activeTask.status].emoji}</span>
                      <h3 className="text-white font-medium">{activeTask.title}</h3>
                    </div>
                  </div>
                ) : null}
              </DragOverlay>
            </DndContext>
          )}
        </div>

        {/* Add Task Modal */}
        {showAddModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-gray-800 rounded-lg p-6 w-full max-w-md">
              <h2 className="text-xl font-bold text-white mb-4">
                {locale === 'en' ? 'Add a task' : locale === 'de' ? 'Aufgabe hinzufügen' : 'Ajouter une tâche'}
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
                    placeholder={locale === 'en' ? 'What needs to be done?' : locale === 'de' ? 'Was muss gemacht werden?' : 'Que faut-il faire ?'}
                    className="w-full px-3 py-2 bg-gray-700 text-white rounded-lg border border-gray-600 focus:border-blue-500 focus:outline-none"
                    autoFocus
                    onKeyDown={(e) => e.key === 'Enter' && handleAddTask()}
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
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors"
                >
                  {isSubmitting 
                    ? '...' 
                    : (locale === 'en' ? 'Add' : locale === 'de' ? 'Hinzufügen' : 'Ajouter')}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
