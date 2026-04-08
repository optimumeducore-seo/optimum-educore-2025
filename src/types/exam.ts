// src/types/exam.ts

export type ExamRange = {
  big: string;
  small: string;
  pages: string;
};

export type ExamTaskDef = {
  key: string;
  label: string;
  target: number;
};

export type ExamSubjectDef = {
  key: string;
  name: string;
  ranges: ExamRange[];
  tasks: ExamTaskDef[];
};

export type ExamDoc = {
  id: string;
  school: string;
  grade: string;
  title: string;
  start: string;
  end: string;
  memo?: string;
  subjects: ExamSubjectDef[];
};

export type ProgressBySubject = {
  taskDone: Record<string, number>;
  memo?: string;
};

export type StudentExamProgress = {
  studentId: string;
  examId: string;
  goals: Record<string, number>;
  progress: Record<string, ProgressBySubject>;
};