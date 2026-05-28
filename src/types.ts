export type GradeLevel = 'elementary' | 'middle' | 'high';

export type QuestionType = 'choice' | 'short' | 'essay';

export type DifficultyLevel = 'easy' | 'medium' | 'hard';

export interface RatioValues {
  easy: number;
  medium: number;
  hard: number;
}

export interface TypeRatioValues {
  choice: number;
  short: number;
  essay: number;
}

export interface ExamFormInputs {
  gradeLevel: GradeLevel;
  unitName: string;
  concepts: string;
  standard: string;
  questionCount: 5 | 10;
  difficulty: RatioValues;
  questionTypeRatio: TypeRatioValues;
  purpose: string;
}

export interface MathQuestion {
  id: number;
  number: number;
  type: QuestionType;
  difficulty: DifficultyLevel;
  question: string;
  options?: string[]; // Used for multiple-choice (객관식)
  answer: string;
  solution: string;
  expectedMisconception: string;
}

export interface ExamDraft {
  title: string;
  objective: string;
  gradeText: string;
  unitName: string;
  purpose: string;
  questions: MathQuestion[];
  teacherMemo: string;
}

export interface CheckTestQuestion {
  number: number;
  concept: string;
  question: string;
  choices: string[];
  answer: string;
}

export interface CheckTestDraft {
  title: string;
  questions: CheckTestQuestion[];
}

export interface QuestionAnalysis {
  number: number;
  isCorrect: boolean;
  correctAnswer: string;
  studentAnswer: string;
  concept: string;
  misconception: string;
}

export interface DiagnosisResult {
  correctCount: number;
  weakConcepts: string[];
  expectedMisconceptions: string;
  reasonForReinforcement: string;
  questionsAnalysis: QuestionAnalysis[];
  recommendedSettings: ExamFormInputs;
}


