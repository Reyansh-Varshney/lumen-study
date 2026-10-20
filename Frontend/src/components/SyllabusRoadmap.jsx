import React, { useState, useEffect } from 'react';
import { Sparkles, Map, CheckCircle2, ArrowRight, BookOpen, ChevronDown, ChevronRight, Plus, Layers } from 'lucide-react';
import api from '../api/axios';
import { toast } from 'react-hot-toast';

const countModule = (module) => {
  const topics = module?.topics || [];
  return {
    total: topics.length,
    completed: topics.filter((t) => t.is_completed).length,
  };
};

const countSubject = (subject) =>
  (subject?.modules || []).reduce(
    (acc, module) => {
      const counts = countModule(module);
      acc.total += counts.total;
      acc.completed += counts.completed;
      return acc;
    },
    { total: 0, completed: 0 }
  );

export default function SyllabusRoadmap({ onTriggerOnboarding }) {
  const [syllabus, setSyllabus] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [expandedSubjects, setExpandedSubjects] = useState(() => new Set());
  const [newSubject, setNewSubject] = useState('');
  const [isAddingSubject, setIsAddingSubject] = useState(false);

  const fetchRoadmap = async () => {
    try {
      const res = await api.get('/syllabus/my-roadmap');
      const data = res.data && res.data.data ? res.data.data : null;
      setSyllabus(data);
      if (data && Array.isArray(data.subjects)) {
        setExpandedSubjects(new Set(data.subjects.map((s) => s.subject_name)));
      }
    } catch (error) {
      console.error("Failed to fetch roadmap:", error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchRoadmap();
  }, []);

  const toggleSubject = (subjectName) => {
    setExpandedSubjects((prev) => {
      const next = new Set(prev);
      if (next.has(subjectName)) next.delete(subjectName);
      else next.add(subjectName);
      return next;
    });
  };

  // Optimistic local update of a single topic inside the nested hierarchy.
  const applyTopicState = (subjectName, moduleName, topicName, isCompleted) => {
    setSyllabus((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        subjects: (prev.subjects || []).map((subject) => {
          if (subject.subject_name !== subjectName) return subject;
          return {
            ...subject,
            modules: (subject.modules || []).map((module) => {
              if (module.module_name !== moduleName) return module;
              return {
                ...module,
                topics: (module.topics || []).map((topic) =>
                  topic.topic_name === topicName
                    ? {
                        ...topic,
                        is_completed: isCompleted,
                        completed_at: isCompleted ? new Date().toISOString() : null,
                      }
                    : topic
                ),
              };
            }),
          };
        }),
      };
    });
  };

  const handleTopicToggle = async (subjectName, moduleName, topicName, isCompleted) => {
    const nextValue = !isCompleted;
    const snapshot = syllabus;

    applyTopicState(subjectName, moduleName, topicName, nextValue);

    try {
      await api.patch('/syllabus/topic', {
        subject_name: subjectName,
        module_name: moduleName,
        topic_name: topicName,
        is_completed: nextValue,
      });
      toast.success(
        nextValue ? `${topicName} marked as complete.` : `${topicName} moved back to your list.`
      );
    } catch {
      setSyllabus(snapshot);
      toast.error("Failed to update progress. Try again.");
    }
  };

  const handleAddSubject = async (e) => {
    e.preventDefault();
    const subjectName = newSubject.trim();
    if (!subjectName || isAddingSubject) return;

    setIsAddingSubject(true);
    try {
      const res = await api.post('/syllabus/subjects', { subject_name: subjectName });
      const created = res.data?.subject || { subject_name: subjectName, modules: [] };

      setSyllabus((prev) => {
        const base = prev || { title: 'Course Tracker', subjects: [] };
        const subjects = [...(base.subjects || [])];
        if (!subjects.some((s) => s.subject_name === created.subject_name)) {
          subjects.push(created);
        }
        return { ...base, subjects };
      });

      setExpandedSubjects((prev) => new Set([...prev, created.subject_name]));
      setNewSubject('');
      toast.success(`${created.subject_name} added to your tracker.`);
    } catch (error) {
      console.error("Failed to add subject:", error);
      toast.error("Could not add that subject. Try again.");
    } finally {
      setIsAddingSubject(false);
    }
  };

  if (isLoading) {
    return (
      <div className="bg-surface-container-high rounded-xl p-6 flex flex-col items-center justify-center animate-pulse min-h-[300px]">
        <Map className="w-8 h-8 text-primary/50 mb-3" />
        <p className="text-on-surface-variant font-medium">Loading your course tracker...</p>
      </div>
    );
  }

  const subjects = syllabus?.subjects || [];
  const hasContent = subjects.length > 0;

  const addSubjectForm = (
    <form onSubmit={handleAddSubject} className="flex items-center gap-2 w-full">
      <div className="relative flex-1 min-w-0">
        <BookOpen className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
        <input
          type="text"
          value={newSubject}
          onChange={(e) => setNewSubject(e.target.value)}
          placeholder="Add a subject (e.g. Organic Chemistry)"
          className="w-full bg-slate-800/60 border border-slate-700 rounded-lg pl-9 pr-3 py-2 text-sm text-slate-100 placeholder-slate-500 outline-none focus:border-sky-500/60 focus:ring-1 focus:ring-sky-500/30 transition-all"
        />
      </div>
      <button
        type="submit"
        disabled={!newSubject.trim() || isAddingSubject}
        className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-sky-500/15 border border-sky-500/40 text-sky-300 text-xs font-bold uppercase tracking-wider hover:bg-sky-500/25 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <Plus className="w-4 h-4" /> Add Subject
      </button>
    </form>
  );

  // Empty State
  if (!syllabus || !hasContent) {
    return (
      <div className="bg-surface-container-high rounded-xl p-8 flex flex-col items-center justify-center min-h-[300px] border border-dashed border-primary/30 h-full">
        <Sparkles className="w-12 h-12 text-primary mb-4" />
        <h3 className="font-headline text-xl font-bold mb-2">No Course Tracker Yet</h3>
        <p className="text-sm text-on-surface-variant text-center max-w-sm mb-6">
          Import a course outline or add your subjects to build a personalised tracker.
        </p>
        <button
          onClick={onTriggerOnboarding}
          className="bg-primary text-on-primary font-bold py-3 px-6 rounded-xl flex items-center gap-2 hover:bg-primary/90 transition-colors shadow-lg shadow-primary/20"
        >
          Set Up My Tracker <ArrowRight className="w-4 h-4" />
        </button>
        <div className="mt-6 w-full max-w-sm">{addSubjectForm}</div>
      </div>
    );
  }

  const overall = subjects.reduce(
    (acc, subject) => {
      const counts = countSubject(subject);
      acc.total += counts.total;
      acc.completed += counts.completed;
      return acc;
    },
    { total: 0, completed: 0 }
  );

  // Render Course Tracker Timeline
  return (
    <div className="bg-slate-900 p-6 rounded-xl border border-slate-700 shadow-xl flex flex-col max-h-[500px] h-full">
      <div className="flex justify-between items-center gap-3 mb-4">
        <h3 className="font-headline text-lg font-bold flex items-center gap-2 text-white min-w-0">
          <Map className="w-5 h-5 text-sky-400 shrink-0" />
          <span className="truncate">{syllabus.title || 'Course Tracker'}</span>
        </h3>
        <span className="text-xs font-bold bg-sky-900/50 text-sky-300 px-3 py-1 rounded-full border border-sky-500/30 shrink-0">
          {overall.completed} / {overall.total} topics
        </span>
      </div>

      <div className="mb-5">{addSubjectForm}</div>

      <div className="flex-1 overflow-y-auto pr-2 relative scrollbar-thin scrollbar-thumb-slate-700 hover:scrollbar-thumb-slate-600">
        <div className="space-y-4 relative z-0 pb-4">
          {subjects.map((subject) => {
            const subjectCounts = countSubject(subject);
            const isExpanded = expandedSubjects.has(subject.subject_name);
            const modules = subject.modules || [];

            return (
              <div key={subject.subject_name} className="bg-slate-800/40 border border-slate-700/70 rounded-xl overflow-hidden">
                <button
                  onClick={() => toggleSubject(subject.subject_name)}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-800/70 transition-colors text-left"
                >
                  {isExpanded ? (
                    <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
                  ) : (
                    <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
                  )}
                  <BookOpen className="w-4 h-4 text-sky-400 shrink-0" />
                  <span className="text-sm font-semibold text-slate-100 flex-1 truncate">
                    {subject.subject_name}
                  </span>
                  <span className="text-[10px] font-bold bg-sky-900/50 text-sky-300 px-2.5 py-1 rounded-full border border-sky-500/30 shrink-0">
                    {subjectCounts.completed} / {subjectCounts.total} topics
                  </span>
                </button>

                {isExpanded && (
                  <div className="px-4 pb-4 pt-1 ml-4 border-l border-slate-700/70 space-y-4">
                    {modules.length === 0 ? (
                      <p className="text-xs text-slate-500 italic py-2">No modules added yet.</p>
                    ) : (
                      modules.map((module) => {
                        const moduleCounts = countModule(module);
                        return (
                          <div key={module.module_name}>
                            <div className="flex items-center gap-2 mb-2">
                              <Layers className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                              <span className="text-xs font-bold uppercase tracking-wider text-slate-400 truncate">
                                {module.module_name}
                              </span>
                              <span className="text-[10px] text-slate-500 shrink-0">
                                {moduleCounts.completed}/{moduleCounts.total}
                              </span>
                            </div>

                            <div className="space-y-0.5">
                              {(module.topics || []).map((topic) => (
                                <button
                                  key={topic.topic_name}
                                  onClick={() =>
                                    handleTopicToggle(
                                      subject.subject_name,
                                      module.module_name,
                                      topic.topic_name,
                                      topic.is_completed
                                    )
                                  }
                                  className="w-full flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-slate-800/70 transition-colors group text-left"
                                >
                                  {topic.is_completed ? (
                                    <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
                                  ) : (
                                    <span className="w-5 h-5 rounded-full border-2 border-sky-500 bg-slate-900 flex items-center justify-center shrink-0 group-hover:border-sky-400 group-hover:shadow-[0_0_10px_rgba(56,189,248,0.5)] transition-all" />
                                  )}
                                  <span
                                    className={`text-sm tracking-wide flex-1 truncate ${
                                      topic.is_completed
                                        ? 'text-slate-400 line-through'
                                        : 'text-slate-100 font-semibold'
                                    }`}
                                  >
                                    {topic.topic_name}
                                  </span>
                                  {topic.completed_at && (
                                    <span className="text-[10px] text-slate-500 font-semibold shrink-0">
                                      {new Date(topic.completed_at).toLocaleDateString()}
                                    </span>
                                  )}
                                </button>
                              ))}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
