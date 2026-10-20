import React, { useState } from 'react';
import api from '../api/axios';
import { Sparkles, Upload, Loader2, Calendar, Target, GraduationCap, Layers, X } from 'lucide-react';
import { toast } from 'react-hot-toast';

const STUDY_LEVELS = [
  'Middle School',
  'High School',
  'Diploma',
  'Undergraduate',
  'Postgraduate',
  'Self-directed',
];

export default function OnboardingModal({ onComplete }) {
  const [gradeLevel, setGradeLevel] = useState('Undergraduate');
  const [academicGoal, setAcademicGoal] = useState('');
  const [subjects, setSubjects] = useState([]);
  const [subjectInput, setSubjectInput] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [file, setFile] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  const addSubject = () => {
    const value = subjectInput.trim();
    if (!value) return;
    setSubjects((prev) => {
      const alreadyAdded = prev.some(
        (subject) => subject.toLowerCase() === value.toLowerCase()
      );
      return alreadyAdded ? prev : [...prev, value];
    });
    setSubjectInput('');
  };

  const removeSubject = (name) => {
    setSubjects((prev) => prev.filter((subject) => subject !== name));
  };

  const handleSubjectKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addSubject();
    }
  };

  const saveProfile = async (activeSubjects) => {
    const payload = {
      grade_level: gradeLevel,
      academic_goal: academicGoal.trim() || null,
      active_subjects: activeSubjects,
    };
    if (targetDate) {
      payload.target_date = targetDate;
    }
    await api.patch('/auth/profile', payload);
  };

  const createTrackerSubjects = async (names) => {
    await Promise.all(
      names.map((name) =>
        api.post('/syllabus/subjects', { subject_name: name }).catch(() => null)
      )
    );
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      let importedSubjects = [];

      if (file) {
        const form = new FormData();
        form.append('file', file);
        form.append('title', 'My Course');

        try {
          const res = await api.post('/syllabus/upload', form, {
            headers: {
              'Content-Type': 'multipart/form-data',
            },
          });
          const parsed = (res && res.data && res.data.data && res.data.data.subjects) || [];
          importedSubjects = parsed
            .map((item) => item && item.subject_name)
            .filter(Boolean);
        } catch (uploadError) {
          const status = uploadError && uploadError.response && uploadError.response.status;
          if (status !== 400 && status !== 422) {
            throw uploadError;
          }
          // The document could not be structured automatically — keep the learner's
          // own details instead of losing the whole onboarding flow.
          toast('We could not structure that document, so we saved your details instead.');
        }
      }

      const allSubjects = [...new Set([...importedSubjects, ...subjects])];
      await saveProfile(allSubjects);

      const toCreate = subjects.filter((name) => !importedSubjects.includes(name));
      await createTrackerSubjects(toCreate);

      toast.success('Your course tracker is ready!');
      onComplete();
    } catch (error) {
      console.error('Could not build the tracker', error);
      toast.error('Something went wrong while building your tracker. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-lg p-8 relative overflow-hidden shadow-2xl max-h-[90vh] overflow-y-auto">
        {/* Glow effect */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-64 h-64 bg-primary/20 rounded-full blur-[80px] -z-10"></div>

        {/* Close Button */}
        <button
          onClick={onComplete}
          className="absolute top-4 right-4 text-slate-500 hover:text-white transition-colors"
        >
          <span className="material-symbols-outlined">close</span>
        </button>

        <div className="flex items-center gap-3 justify-center mb-2">
          <Sparkles className="text-secondary w-6 h-6" />
          <h2 className="text-2xl font-bold text-white font-headline">Configure Your AI Companion</h2>
        </div>
        <p className="text-slate-400 text-center mb-8 text-sm">Tell us what you're studying and we'll build your personalised course tracker.</p>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2 flex items-center gap-2">
                <GraduationCap className="w-4 h-4 text-primary" /> Current Level
              </label>
              <select
                value={gradeLevel}
                onChange={(e) => setGradeLevel(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 text-white rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all appearance-none"
              >
                {STUDY_LEVELS.map((level) => (
                  <option key={level} value={level}>{level}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2 flex items-center gap-2">
                <Layers className="w-4 h-4 text-primary" /> Subjects &amp; Topics
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={subjectInput}
                  onChange={(e) => setSubjectInput(e.target.value)}
                  onKeyDown={handleSubjectKeyDown}
                  className="flex-1 bg-slate-800 border border-slate-700 text-white rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all placeholder:text-slate-500"
                  placeholder="e.g. Thermodynamics"
                />
                <button
                  type="button"
                  onClick={addSubject}
                  className="px-4 py-3 rounded-xl bg-slate-800 border border-slate-700 text-white text-sm font-bold hover:border-primary/50 hover:text-primary transition-all"
                >
                  Add
                </button>
              </div>
              <p className="text-xs text-slate-500 mt-2">Add anything you're studying — e.g. Biology, French, Financial Accounting</p>
              {subjects.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-3">
                  {subjects.map((subject) => (
                    <span
                      key={subject}
                      className="inline-flex items-center gap-1.5 bg-primary/10 text-primary border border-primary/30 rounded-full px-3 py-1 text-xs font-bold"
                    >
                      {subject}
                      <button
                        type="button"
                        onClick={() => removeSubject(subject)}
                        aria-label={`Remove ${subject}`}
                        className="hover:text-error transition-colors"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2 flex items-center gap-2">
                <Target className="w-4 h-4 text-primary" /> Study Goal
              </label>
              <input
                type="text"
                value={academicGoal}
                onChange={(e) => setAcademicGoal(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 text-white rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all placeholder:text-slate-500"
                placeholder="e.g. Build a solid foundation in organic chemistry"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2 flex items-center gap-2">
                <Calendar className="w-4 h-4 text-primary" /> Target Date (optional)
              </label>
              <input
                type="date"
                value={targetDate}
                onChange={(e) => setTargetDate(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 text-white rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all css-date-input"
              />
              <p className="text-xs text-slate-500 mt-2">A soft milestone to pace your study plan</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2 flex items-center gap-2">
                <Upload className="w-4 h-4 text-primary" /> Course Outline or Notes (PDF)
              </label>
              <div className="relative border-2 border-dashed border-slate-700 hover:border-primary/50 rounded-xl bg-slate-800/50 transition-colors cursor-pointer group">
                <input
                  type="file"
                  accept=".pdf"
                  onChange={(e) => setFile(e.target.files[0])}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                />
                <div className="p-8 text-center pointer-events-none">
                  <Upload className="w-8 h-8 text-slate-500 mx-auto mb-3 group-hover:text-primary transition-colors" />
                  {file ? (
                    <div className="text-sm font-semibold text-primary">{file.name}</div>
                  ) : (
                    <>
                      <div className="text-sm font-medium text-slate-300">Click to upload or drag and drop</div>
                      <div className="text-xs text-slate-500 mt-1">PDF file only</div>
                    </>
                  )}
                </div>
              </div>
              <p className="text-xs text-slate-500 mt-2">Optional — import a syllabus, notes or a textbook chapter to auto-build your tracker</p>
            </div>
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full bg-gradient-to-r from-primary to-secondary hover:from-primary/90 hover:to-secondary/90 text-white font-bold py-4 rounded-xl shadow-[0_0_20px_rgba(var(--primary),0.3)] transition-all flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed group relative overflow-hidden"
          >
            {isLoading ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Building your tracker...
              </>
            ) : (
              <>
                Build My Course Tracker
                <Sparkles className="w-4 h-4 group-hover:animate-pulse" />
              </>
            )}
            {/* Shimmer effect */}
            {!isLoading && <div className="absolute inset-0 -translate-x-full bg-white/20 skew-x-12 group-hover:animate-shimmer" />}
          </button>
        </form>
      </div>
    </div>
  );
}
