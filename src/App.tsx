import { useState, useEffect } from 'react';
import type { ExamDraft, GradeLevel, RatioValues, TypeRatioValues, CheckTestDraft, DiagnosisResult } from './types';

// Fail-safe helper to translate English math terminology into standard Korean
function translateMathTerms(text: string | undefined): string {
  if (!text) return '';
  let translated = text;
  
  const termsMap: Record<string, string> = {
    'improper fraction': '가분수',
    'mixed number': '대분수',
    'proper fraction': '진분수',
    'equivalent fraction': '동치분수',
    'common denominator': '공통분모',
    'numerator': '분자',
    'denominator': '분모',
    'simplify': '약분',
    'slope': '기울기',
    'y-intercept': 'y절편',
    'equation': '방정식',
    'expression': '식',
    'graph': '그래프'
  };

  Object.entries(termsMap).forEach(([eng, kor]) => {
    const regex = new RegExp(eng, 'gi');
    translated = translated.replace(regex, kor);
  });

  return translated;
}

// Convert fractions and LaTeX notations securely into structured tokens (___FRAC_N_D___ / ___MIXED_W_N_D___)
function preprocessFractionTokens(text: string): string {
  // 0. Recover JS form feed (\f) escape character from backslash-f conversion failure
  let processed = text.replace(/\f/g, '\\f');

  // 1. Temporary protection maps for Dates, URLs, and File Paths to avoid slash (/) confusion
  const placeholders: { [key: string]: string } = {};
  let placeholderCounter = 0;

  const urlRegex = /https?:\/\/[^\s]+/g;
  const pathRegex = /[a-zA-Z]:[\\/][\w.\\/-]+/g;
  const dateRegex = /\b\d{4}[-\/\.]\d{1,2}[-\/\.]\d{1,2}\b/g;

  const protect = (regex: RegExp, prefix: string) => {
    processed = processed.replace(regex, (match) => {
      const key = `___${prefix}_${placeholderCounter++}___`;
      placeholders[key] = match;
      return key;
    });
  };

  protect(urlRegex, 'URL');
  protect(pathRegex, 'PATH');
  protect(dateRegex, 'DATE');

  // Clean all LaTeX wrappers ($ and \(\)) first since we are not using KaTeX
  processed = processed.replace(/\$/g, '');
  processed = processed.replace(/\\\(|\\\)/g, '');

  // 2. Convert Mixed Fractions first (preventing standalone fraction interference!)
  // 2a. mixed LaTeX: 2\frac{1}{4} or 2 \frac{1}{4}
  processed = processed.replace(/(\d+)\s*\\frac\{(\d+)\}\{(\d+)\}/g, (_, w, n, d) => `___MIXED_${w}_${n}_${d}___`);
  // 2b. mixed LaTeX (no brackets): 2\frac14 or 2 \frac14
  processed = processed.replace(/(\d+)\s*\\frac(\d)(\d)/g, (_, w, n, d) => `___MIXED_${w}_${n}_${d}___`);
  // 2c. mixed LaTeX (half bracket): 2\frac{1}4
  processed = processed.replace(/(\d+)\s*\\frac\{(\d+)\}(\d)/g, (_, w, n, d) => `___MIXED_${w}_${n}_${d}___`);
  // 2d. mixed LaTeX (half bracket 2): 2\frac1{4}
  processed = processed.replace(/(\d+)\s*\\frac(\d)\{(\d+)\}/g, (_, w, n, d) => `___MIXED_${w}_${n}_${d}___`);
  // 2e. mixed plain: 2 1/4
  processed = processed.replace(/(?<!\d)(\d+)\s+(\d+)\/(\d+)(?!\d)/g, (_, w, n, d) => `___MIXED_${w}_${n}_${d}___`);

  // 3. Convert Standalone fractions
  // 3a. standalone LaTeX: \frac{3}{8}
  processed = processed.replace(/\\frac\{(\d+)\}\{(\d+)\}/g, (_, n, d) => `___FRAC_${n}_${d}___`);
  // 3b. standalone LaTeX (no brackets): \frac38
  processed = processed.replace(/\\frac(\d)(\d)/g, (_, n, d) => `___FRAC_${n}_${d}___`);
  // 3c. standalone LaTeX (half bracket): \frac{3}8
  processed = processed.replace(/\\frac\{(\d+)\}(\d)/g, (_, n, d) => `___FRAC_${n}_${d}___`);
  // 3d. standalone LaTeX (half bracket 2): \frac3{8}
  processed = processed.replace(/\\frac(\d)\{(\d+)\}/g, (_, n, d) => `___FRAC_${n}_${d}___`);
  // 3e. standalone plain: 3/8
  processed = processed.replace(/(?<!\d)(\d+)\/(\d+)(?!\d)/g, (_, n, d) => `___FRAC_${n}_${d}___`);

  // 4. Strip any residual curly brackets or latex fractions leftover
  processed = processed.replace(/\\frac/g, '');
  processed = processed.replace(/\\sqrt\{([^{}]+)\}/g, '루트 $1');
  processed = processed.replace(/\\sqrt/g, '루트');
  processed = processed.replace(/[{}]/g, '');

  // 5. Restore protected regions
  Object.entries(placeholders).forEach(([key, val]) => {
    processed = processed.split(key).join(val);
  });

  return processed;
}

// Custom UI Component to render clean textbook-style vertical fractions
function Fraction({ numerator, denominator }: { numerator: string; denominator: string }) {
  return (
    <span className="math-fraction-container">
      <span className="math-fraction-numerator">{numerator}</span>
      <span className="math-fraction-line"></span>
      <span className="math-fraction-denominator">{denominator}</span>
    </span>
  );
}

// Custom UI Component to render clean mixed fractions (whole number next to fraction)
function MixedFraction({ whole, numerator, denominator }: { whole: string; numerator: string; denominator: string }) {
  return (
    <span className="math-mixed-fraction">
      <span className="math-whole-number">{whole}</span>
      <Fraction numerator={numerator} denominator={denominator} />
    </span>
  );
}

interface MathTextProps {
  text: string | undefined;
}

function MathText({ text }: MathTextProps) {
  if (!text) return null;

  // 1. Translate terms
  const translatedText = translateMathTerms(text);

  // 2. Fix literal newline characters
  let cleanedText = translatedText.replace(/\\n/g, '\n');

  // 3. Unify fractions into secure tokens
  cleanedText = preprocessFractionTokens(cleanedText);

  // 4. Split and render 교차 (cross-render) tokens next to standard text
  const regex = /(___FRAC_\d+_\d+___|___MIXED_\d+_\d+_\d+___)/g;
  const parts = cleanedText.split(regex);

  return (
    <>
      {parts.map((part, index) => {
        if (part.startsWith('___FRAC_') && part.endsWith('___')) {
          const match = part.match(/___FRAC_(\d+)_(\d+)___/);
          if (match) {
            return <Fraction key={index} numerator={match[1]} denominator={match[2]} />;
          }
          return part;
        } else if (part.startsWith('___MIXED_') && part.endsWith('___')) {
          const match = part.match(/___MIXED_(\d+)_(\d+)_(\d+)___/);
          if (match) {
            return <MixedFraction key={index} whole={match[1]} numerator={match[2]} denominator={match[3]} />;
          }
          return part;
        } else {
          // Plain text with line breaks supported
          const lines = part.split('\n');
          return (
            <span key={index}>
              {lines.map((line, idx) => (
                <span key={idx}>
                  {line}
                  {idx < lines.length - 1 && <br />}
                </span>
              ))}
            </span>
          );
        }
      })}
    </>
  );
}

// Helper to remove any duplicate numbering prefix (e.g. ①, ②, 1., 1), A., a. etc.) from GPT generated choices
function cleanOptionText(text: string | undefined): string {
  if (!text) return '';
  let cleaned = text.trim();
  // Regex matches common numbering patterns (e.g. ①~⑤, ①번, 1~5., 1~5), A~E., a~e., A~E), a~e)) followed by whitespace
  const prefixRegex = /^([①-⑤]번?|[1-5]\.[ \t]*|[1-5]\)[ \t]*|[A-Ea-e]\.[ \t]*|[A-Ea-e]\)[ \t]*|[①-⑤])\s*/;
  
  // Iteratively remove prefix in case of multiple nested numbering (e.g. '② ② 1')
  while (prefixRegex.test(cleaned)) {
    cleaned = cleaned.replace(prefixRegex, '');
  }
  return cleaned;
}


function App() {
  // --- Active Tab State ('direct' = 수동 출제, 'diagnosis' = 체크테스트 진단) ---
  const [activeTab, setActiveTab] = useState<'direct' | 'diagnosis'>('direct');
  const [showAppliedBanner, setShowAppliedBanner] = useState(false);

  // --- Form States (Default to Elementary Fractional Arithmetic) ---
  const [gradeLevel, setGradeLevel] = useState<GradeLevel>('elementary');
  const [unitName, setUnitName] = useState('분수의 덧셈과 뺄셈');
  const [concepts, setConcepts] = useState('동분모 분수의 덧셈, 대분수 변환, 받아올림');
  const [standard, setStandard] = useState('[4수01-16] 분모가 같은 분수의 덧셈과 뺄셈의 계산 원리를 이해하고 그 계산을 할 수 있다.');
  const [questionCount, setQuestionCount] = useState<5 | 10>(5);
  
  // Difficulty ratios (easy, medium, hard) - default 30% / 40% / 30%
  const [difficulty, setDifficulty] = useState<RatioValues>({
    easy: 30,
    medium: 40,
    hard: 30
  });

  // Question Type ratios (choice, short, essay) - default 40% / 40% / 20%
  const [questionTypeRatio, setQuestionTypeRatio] = useState<TypeRatioValues>({
    choice: 40,
    short: 40,
    essay: 20
  });

  const [purpose, setPurpose] = useState('형성평가 및 기초 개념 확인');

  // --- Checking Test Mode States ---
  const [diagGradeLevel, setDiagGradeLevel] = useState<GradeLevel>('elementary');
  const [diagUnitName, setDiagUnitName] = useState('분수의 덧셈과 뺄셈');
  const [diagConcepts, setDiagConcepts] = useState('동분모 분수의 덧셈, 대분수 변환, 받아올림');
  
  const [checkTest, setCheckTest] = useState<CheckTestDraft | null>(null);
  const [isGeneratingCheckTest, setIsGeneratingCheckTest] = useState(false);
  const [studentAnswers, setStudentAnswers] = useState<Record<number, string>>({});
  const [isDiagnosing, setIsDiagnosing] = useState(false);
  const [diagnosisResult, setDiagnosisResult] = useState<DiagnosisResult | null>(null);

  // --- UI/UX States ---
  const [isGenerating, setIsGenerating] = useState(false);
  const [loadingStep, setLoadingStep] = useState(0);
  const [generatedExam, setGeneratedExam] = useState<ExamDraft | null>(null);
  const [viewMode, setViewMode] = useState<'student' | 'teacher'>('teacher');
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState('');

  // Student specific inputs inside the worksheet (interactive for mock feel!)
  const [studentGrade, setStudentGrade] = useState('');
  const [studentNum, setStudentNum] = useState('');
  const [studentName, setStudentName] = useState('');

  // --- Validation ---
  const difficultySum = difficulty.easy + difficulty.medium + difficulty.hard;
  const typeSum = questionTypeRatio.choice + questionTypeRatio.short + questionTypeRatio.essay;
  
  const isDifficultyValid = difficultySum === 100;
  const isTypeValid = typeSum === 100;
  const canGenerate = isDifficultyValid && isTypeValid && !isGenerating;

  // Auto-fill templates when GradeLevel changes synchronously in the event handler to avoid cascading renders
  const handleGradeChange = (level: GradeLevel) => {
    setGradeLevel(level);
    if (level === 'elementary') {
      setUnitName('분수의 덧셈과 뺄셈');
      setConcepts('동분모 분수의 덧셈, 대분수 변환, 받아올림');
      setStandard('[4수01-16] 분모가 같은 분수의 덧셈과 뺄셈의 계산 원리를 이해하고 그 계산을 할 수 있다.');
      setPurpose('형성평가 및 기초 개념 확인');
    } else if (level === 'middle') {
      setUnitName('소인수분해');
      setConcepts('소인수, 약수의 개수, 최대공약수, 서로소');
      setStandard('[9수01-01] 소인수분해의 뜻을 알고, 자연수를 소인수분해할 수 있다.');
      setPurpose('학기 초 진단평가 및 오개념 진정성 파악');
    } else {
      setUnitName('다항식의 연산과 나머지정리');
      setConcepts('다항식의 전개, 곱셈 공식의 변형, 나머지 정리 증명, 3차식 나눗셈');
      setStandard('[10수01-02] 나머지정리의 의미를 이해하고, 이를 활용하여 문제를 해결할 수 있다.');
      setPurpose('중간고사 대비 심화 성취평가');
    }
  };

  // Auto-fill templates for Checking Test grade changes
  const handleDiagGradeChange = (level: GradeLevel) => {
    setDiagGradeLevel(level);
    if (level === 'elementary') {
      setDiagUnitName('분수의 덧셈과 뺄셈');
      setDiagConcepts('동분모 분수의 덧셈, 대분수 변환, 받아올림');
    } else if (level === 'middle') {
      setDiagUnitName('소인수분해');
      setDiagConcepts('소인수, 약수의 개수, 최대공약수, 서로소');
    } else {
      setDiagUnitName('다항식의 연산과 나머지정리');
      setDiagConcepts('다항식의 전개, 곱셈 공식의 변형, 나머지 정리 증명, 3차식 나눗셈');
    }
  };

  // Handle auto-balancing ratios
  const handleAutoBalanceDifficulty = () => {
    setDifficulty({ easy: 30, medium: 40, hard: 30 });
  };

  const handleAutoBalanceTypes = () => {
    setQuestionTypeRatio({ choice: 40, short: 40, essay: 20 });
  };

interface GPTQuestion {
  number: number;
  difficulty: '쉬움' | '보통' | '어려움';
  type: '객관식' | '단답형' | '서술형';
  concept: string;
  question: string;
  choices: string[];
  answer: string;
  solution: string;
  misconception: string;
}

interface GPTResponse {
  title: string;
  goals: string[];
  questions: GPTQuestion[];
  teacherNotes: string[];
  error?: string;
}

  // --- Simulated & Live Generation Logic ---
  const handleGenerate = async () => {
    if (!canGenerate) return;
    
    setIsGenerating(true);
    setLoadingStep(0);

    const steps = [
      '교육과정 성취기준 및 단원 핵심요소 분석 중...',
      '교수평가 오개념 빅데이터 대조 및 문제설계 중...',
      '난이도/유형 비율 기반 맞춤 수학 문항 생성 중...',
      '교사용 정답표, 상세 해설 및 지도안 설계 작성 중...'
    ];

    // Start progress simulation
    let currentStep = 0;
    const interval = setInterval(() => {
      if (currentStep < steps.length - 1) {
        currentStep++;
        setLoadingStep(currentStep);
      }
    }, 600);

    const gradeMap: Record<GradeLevel, string> = {
      elementary: '초등학교',
      middle: '중학교',
      high: '고등학교'
    };

    try {
      const response = await fetch('/api/generate-assessment', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          gradeLevel,
          unitName,
          concepts,
          standard,
          questionCount,
          difficulty,
          questionTypeRatio,
          purpose
        })
      });

      const responseText = await response.text();
      let responseData: GPTResponse;
      try {
        responseData = JSON.parse(responseText) as GPTResponse;
      } catch (err) {
        const parseMessage = err instanceof Error ? err.message : String(err);
        throw new Error(`서버 응답이 올바른 JSON 형식이 아닙니다. (파싱 실패: ${parseMessage})`, { cause: err });
      }

      if (!response.ok || responseData.error) {
        throw new Error(responseData.error || `서버 오류 (상태 코드: ${response.status})`);
      }

      // Complete simulated loader transition
      clearInterval(interval);
      setLoadingStep(steps.length - 1);
      await new Promise(r => setTimeout(r, 450)); // smooth transition

      const mappedQuestions = responseData.questions.map((q: GPTQuestion, idx: number) => ({
        id: idx + 1,
        number: q.number || (idx + 1),
        type: (q.type === '객관식' ? 'choice' : q.type === '단답형' ? 'short' : 'essay') as 'choice' | 'short' | 'essay',
        difficulty: (q.difficulty === '쉬움' ? 'easy' : q.difficulty === '보통' ? 'medium' : 'hard') as 'easy' | 'medium' | 'hard',
        question: q.question,
        options: q.choices && q.choices.length > 0 ? q.choices : undefined,
        answer: q.answer,
        solution: q.solution,
        expectedMisconception: q.misconception
      }));

      const mappedExam: ExamDraft = {
        title: responseData.title || `${gradeMap[gradeLevel]} 수학 [${unitName}] 단원평가`,
        objective: responseData.goals ? responseData.goals.join('\n') : '',
        gradeText: gradeMap[gradeLevel],
        unitName: unitName || '수학 단원',
        purpose: purpose || '형성평가 및 오개념 확인',
        questions: mappedQuestions,
        teacherMemo: responseData.teacherNotes ? responseData.teacherNotes.join('\n') : ''
      };

      setGeneratedExam(mappedExam);
      setIsGenerating(false);
      triggerToast('✨ OpenAI GPT 기반 맞춤 단원평가가 생성되었습니다!');

    } catch (err) {
      clearInterval(interval);
      setIsGenerating(false);
      console.error(err);
      const errorMessage = err instanceof Error ? err.message : String(err);
      alert(`⚠️ 단원평가 생성에 실패했습니다.\n\n사유: ${errorMessage}`);
    }
  };

  // --- Checking Test Logic ---
  const handleGenerateCheckTest = async () => {
    setIsGeneratingCheckTest(true);
    setCheckTest(null);
    setDiagnosisResult(null);
    setStudentAnswers({});

    try {
      const response = await fetch('/api/generate-check-test', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          gradeLevel: diagGradeLevel,
          unitName: diagUnitName,
          concepts: diagConcepts
        })
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(errText || '체크테스트 생성에 실패했습니다.');
      }

      const data = await response.json();
      setCheckTest(data);
      triggerToast('✨ AI 사전 체크테스트가 성공적으로 생성되었습니다!');
    } catch (err) {
      console.error(err);
      alert(`⚠️ 체크테스트 생성 실패: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsGeneratingCheckTest(false);
    }
  };

  const handleDiagnoseCheckTest = async () => {
    if (!checkTest) return;

    // Validation check: ensure ALL checktest questions are answered
    if (!isAllCheckQuestionsAnswered()) {
      alert('모든 문항의 답을 선택해 주세요.');
      return;
    }

    setIsDiagnosing(true);
    setDiagnosisResult(null);

    try {
      const response = await fetch('/api/diagnose-check-test', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          gradeLevel: diagGradeLevel,
          unitName: diagUnitName,
          concepts: diagConcepts,
          questions: checkTest.questions,
          studentAnswers
        })
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(errText || '학습 진단에 실패했습니다.');
      }

      const data = await response.json();
      setDiagnosisResult(data);
      triggerToast('📝 AI 정밀 채점 및 부족 개념 진단서가 발급되었습니다!');
    } catch (err) {
      console.error(err);
      alert(`⚠️ 오개념 진단 실패: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsDiagnosing(false);
    }
  };

  const handleApplyDiagnosis = () => {
    if (!diagnosisResult) return;

    const { recommendedSettings } = diagnosisResult;

    // Apply suggested settings to the main assessment inputs
    setGradeLevel(recommendedSettings.gradeLevel);
    setUnitName(recommendedSettings.unitName);
    setConcepts(recommendedSettings.concepts);
    setStandard(recommendedSettings.standard);
    setQuestionCount(recommendedSettings.questionCount);
    setDifficulty(recommendedSettings.difficulty);
    setQuestionTypeRatio(recommendedSettings.questionTypeRatio);
    setPurpose(recommendedSettings.purpose);

    // Turn back to manual setup tab and show notice banner
    setActiveTab('direct');
    setShowAppliedBanner(true);
    triggerToast('✅ 진단 결과가 출제 조건에 완전히 반영되었습니다!');
  };

  const isAllCheckQuestionsAnswered = () => {
    if (!checkTest) return false;
    return checkTest.questions.every(q => {
      const ans = studentAnswers[q.number];
      return ans !== undefined && ans.trim().length > 0;
    });
  };

  // --- Toast Trigger ---
  const triggerToast = (msg: string) => {
    setToastMessage(msg);
    setShowToast(true);
  };

  useEffect(() => {
    if (showToast) {
      const timer = setTimeout(() => setShowToast(false), 3000);
      return () => clearTimeout(timer);
    }
  }, [showToast]);

  // --- Copy to Clipboard Formatting ---
  const handleCopyText = () => {
    if (!generatedExam) return;

    let text = `=========================================\n`;
    text += `   수학 단원평가 초안 - [${generatedExam.title}]\n`;
    text += `=========================================\n\n`;
    text += `■ 학년/대상: ${generatedExam.gradeText}\n`;
    text += `■ 평가 단원: ${generatedExam.unitName}\n`;
    text += `■ 평가 목적: ${generatedExam.purpose}\n`;
    text += `■ 평가 목표: ${generatedExam.objective}\n\n`;

    if (viewMode === 'student') {
      text += `-----------------------------------------\n`;
      text += `              [ 학 생 용  문 제 지 ]\n`;
      text += `-----------------------------------------\n`;
      text += ` 학년: ______  반: ______  번호: ______  이름: ______\n\n`;

      generatedExam.questions.forEach((q) => {
        text += `${q.number}번. [${q.type === 'choice' ? '객관식' : q.type === 'short' ? '단답형' : '서술형'}] (난이도: ${q.difficulty === 'easy' ? '쉬움' : q.difficulty === 'medium' ? '보통' : '어려움'})\n`;
        text += `질문: ${q.question}\n`;
        if (q.options && q.options.length > 0) {
          q.options.forEach((opt, idx) => {
            text += `  ${idx + 1}) ${opt}\n`;
          });
        }
        text += `\n[답안 기재란]: _____________________________________\n\n`;
      });
    } else {
      text += `-----------------------------------------\n`;
      text += `              [ 교 사 용  정 답 지 ]\n`;
      text += `-----------------------------------------\n\n`;

      generatedExam.questions.forEach((q) => {
        text += `${q.number}번. [${q.type === 'choice' ? '객관식' : q.type === 'short' ? '단답형' : '서술형'}] (난이도: ${q.difficulty === 'easy' ? '쉬움' : q.difficulty === 'medium' ? '보통' : '어려움'})\n`;
        text += `질문: ${q.question}\n`;
        if (q.options && q.options.length > 0) {
          q.options.forEach((opt, idx) => {
            text += `  ${idx + 1}) ${opt}\n`;
          });
        }
        text += `▶ [정답]: ${q.answer}\n`;
        text += `▶ [해설]:\n${q.solution}\n`;
        text += `▶ [예상 오개념 분석]:\n${q.expectedMisconception}\n`;
        text += `-----------------------------------------\n\n`;
      });

      text += `-----------------------------------------\n`;
      text += `            [ 문항별 정답 요약표 ]\n`;
      text += `-----------------------------------------\n`;
      text += `문항번호 |  문항유형  |  난이도  |  정답\n`;
      generatedExam.questions.forEach((q) => {
        const typeKo = q.type === 'choice' ? '객관식' : q.type === 'short' ? '단답형' : '서술형';
        const diffKo = q.difficulty === 'easy' ? '쉬움' : q.difficulty === 'medium' ? '보통' : '어려움';
        text += `  ${String(q.number).padEnd(6)} |  ${typeKo.padEnd(6)} |  ${diffKo.padEnd(5)} |  ${q.answer}\n`;
      });
      text += `\n`;
      text += `-----------------------------------------\n`;
      text += `            [ 교사용 종합 검토 메모 ]\n`;
      text += `-----------------------------------------\n`;
      text += generatedExam.teacherMemo + `\n`;
    }

    navigator.clipboard.writeText(text)
      .then(() => {
        triggerToast('📋 시험지가 클립보드에 복사되었습니다! (외부 문서에 붙여넣기 하세요)');
      })
      .catch(() => {
        triggerToast('❌ 복사에 실패했습니다. 수동으로 복사해주세요.');
      });
  };

  // --- Print Handler ---
  const handlePrint = () => {
    window.print();
  };

  const stepsText = [
    '교육과정 성취기준 및 단원 핵심요소 분석 중...',
    '교수평가 오개념 빅데이터 대조 및 문제설계 중...',
    '난이도/유형 비율 기반 맞춤 수학 문항 생성 중...',
    '교사용 정답표, 상세 해설 및 지도안 설계 작성 중...'
  ];

  const diagGradeMap: Record<GradeLevel, string> = {
    elementary: '초등학교',
    middle: '중학교',
    high: '고등학교'
  };

  return (
    <>
      {/* Header */}
      <header className="app-header">
        <div className="app-logo">
          <div className="app-logo-icon">f(x)</div>
          <h1 className="app-logo-text">수학 단원평가 제작소</h1>
        </div>
        <p className="app-description">
          수학 교육과정 성취기준과 오개념 빅데이터에 근거하여, 교사 및 예비교사를 위한 최적의 수학 단원평가 문항과 교수학습 처방 해설지를 맞춤 설계해 드립니다.
        </p>
      </header>

      {/* Mode Switcher Tabs */}
      <div className="mode-tabs-container">
        <div className="mode-tabs">
          <button
            type="button"
            className={`mode-tab-btn ${activeTab === 'direct' ? 'active' : ''}`}
            onClick={() => setActiveTab('direct')}
          >
            ⚙️ 직접 조건 설정
          </button>
          <button
            type="button"
            className={`mode-tab-btn ${activeTab === 'diagnosis' ? 'active' : ''}`}
            onClick={() => setActiveTab('diagnosis')}
          >
            🔍 체크테스트로 진단
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      {activeTab === 'direct' ? (
        <main className="app-container">
          
          {/* Left Side: Input Panel */}
          <section className="panel">
            <div className="form-title-bar">
              <span style={{ fontSize: '1.2rem' }}>⚙️</span> 단원평가 출제 조건 설정
            </div>
            
            <div className="form-body">

              {/* Automatic Configuration Transfer Notice Banner */}
              {showAppliedBanner && (
                <div className="notice-banner">
                  <span>✨ 체크테스트 결과가 출제 조건에 반영되었습니다. 필요하면 수정한 뒤 단원평가를 생성하세요.</span>
                  <button
                    type="button"
                    className="notice-banner-close"
                    onClick={() => setShowAppliedBanner(false)}
                  >
                    ×
                  </button>
                </div>
              )}
              
              {/* Academic Grade select */}
              <div className="form-group">
                <label className="form-label">
                  학교급 선택 <span className="form-label-help">* 필수 선택</span>
                </label>
                <div className="grade-pills">
                  <button
                    type="button"
                    className={`grade-pill-btn ${gradeLevel === 'elementary' ? 'active' : ''}`}
                    onClick={() => handleGradeChange('elementary')}
                  >
                    🏫 초등학교
                  </button>
                  <button
                    type="button"
                    className={`grade-pill-btn ${gradeLevel === 'middle' ? 'active' : ''}`}
                    onClick={() => handleGradeChange('middle')}
                  >
                    🏢 중학교
                  </button>
                  <button
                    type="button"
                    className={`grade-pill-btn ${gradeLevel === 'high' ? 'active' : ''}`}
                    onClick={() => handleGradeChange('high')}
                  >
                    🏛️ 고등학교
                  </button>
                </div>
              </div>

              {/* Target Unit Name */}
              <div className="form-group">
                <label className="form-label" htmlFor="unit-input">
                  평가 단원 입력
                </label>
                <input
                  id="unit-input"
                  type="text"
                  className="input-text"
                  placeholder="예: 분수의 덧셈과 뺄셈, 일차방정식"
                  value={unitName}
                  onChange={(e) => setUnitName(e.target.value)}
                />
              </div>

              {/* Target Core Concepts */}
              <div className="form-group">
                <label className="form-label" htmlFor="concepts-input">
                  세부 수학 개념
                </label>
                <input
                  id="concepts-input"
                  type="text"
                  className="input-text"
                  placeholder="핵심 평가 속성을 쉼표로 나열하세요"
                  value={concepts}
                  onChange={(e) => setConcepts(e.target.value)}
                />
              </div>

              {/* Achievement Standards */}
              <div className="form-group">
                <label className="form-label" htmlFor="standard-input">
                  교육과정 성취기준
                </label>
                <textarea
                  id="standard-input"
                  className="input-textarea"
                  placeholder="평가 준거가 될 초/중/고 교육과정 성취기준 코드를 기입하세요"
                  value={standard}
                  onChange={(e) => setStandard(e.target.value)}
                />
              </div>

              {/* Number of Questions Selection */}
              <div className="form-group">
                <label className="form-label">문항 수 선택</label>
                <div className="grade-pills">
                  <button
                    type="button"
                    className={`grade-pill-btn ${questionCount === 5 ? 'active' : ''}`}
                    onClick={() => setQuestionCount(5)}
                  >
                    5문항 출제
                  </button>
                  <button
                    type="button"
                    className={`grade-pill-btn ${questionCount === 10 ? 'active' : ''}`}
                    onClick={() => setQuestionCount(10)}
                  >
                    10문항 출제
                  </button>
                  <div style={{ visibility: 'hidden' }}></div>
                </div>
              </div>

              {/* Difficulty Ratio inputs with validation indicators */}
              <div className="form-group">
                <div className="form-label">
                  <span>난이도 구성비 (쉬움 / 보통 / 어려움)</span>
                  <button
                    type="button"
                    className="btn-utility"
                    style={{ padding: '0.15rem 0.5rem', fontSize: '0.75rem', borderRadius: '4px' }}
                    onClick={handleAutoBalanceDifficulty}
                  >
                    균등분배
                  </button>
                </div>

                <div className="ratio-sliders-container">
                  <div className="ratio-slider-row">
                    <div className="ratio-slider-label">
                      <span>🟢 쉬움 (하)</span>
                      <span className="ratio-badge">{difficulty.easy}%</span>
                    </div>
                    <div className="slider-input-wrapper">
                      <input
                        type="range"
                        min="0"
                        max="100"
                        step="5"
                        className="input-range"
                        value={difficulty.easy}
                        onChange={(e) => setDifficulty({ ...difficulty, easy: parseInt(e.target.value) })}
                      />
                    </div>
                  </div>

                  <div className="ratio-slider-row">
                    <div className="ratio-slider-label">
                      <span>🔵 보통 (중)</span>
                      <span className="ratio-badge">{difficulty.medium}%</span>
                    </div>
                    <div className="slider-input-wrapper">
                      <input
                        type="range"
                        min="0"
                        max="100"
                        step="5"
                        className="input-range"
                        value={difficulty.medium}
                        onChange={(e) => setDifficulty({ ...difficulty, medium: parseInt(e.target.value) })}
                      />
                    </div>
                  </div>

                  <div className="ratio-slider-row">
                    <div className="ratio-slider-label">
                      <span>🔴 어려움 (상)</span>
                      <span className="ratio-badge">{difficulty.hard}%</span>
                    </div>
                    <div className="slider-input-wrapper">
                      <input
                        type="range"
                        min="0"
                        max="100"
                        step="5"
                        className="input-range"
                        value={difficulty.hard}
                        onChange={(e) => setDifficulty({ ...difficulty, hard: parseInt(e.target.value) })}
                      />
                    </div>
                  </div>

                  {/* Stacking progress indicator bar */}
                  <div className="ratio-visual-bar">
                    <div className="ratio-segment easy" style={{ width: `${difficulty.easy}%` }}></div>
                    <div className="ratio-segment medium" style={{ width: `${difficulty.medium}%` }}></div>
                    <div className="ratio-segment hard" style={{ width: `${difficulty.hard}%` }}></div>
                  </div>

                  {isDifficultyValid ? (
                    <div className="validation-success-box">
                      <span>✅ 난이도 비율 총합 검증 통과 (100%)</span>
                    </div>
                  ) : (
                    <div className="validation-warning-box">
                      <span>⚠️ 비율 합산 불일치 (현재: {difficultySum}%, 목표: 100%)</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Question Type Ratio inputs with validation */}
              <div className="form-group">
                <div className="form-label">
                  <span>문항 유형 구성비 (객관식 / 단답형 / 서술형)</span>
                  <button
                    type="button"
                    className="btn-utility"
                    style={{ padding: '0.15rem 0.5rem', fontSize: '0.75rem', borderRadius: '4px' }}
                    onClick={handleAutoBalanceTypes}
                  >
                    균등분배
                  </button>
                </div>

                <div className="ratio-sliders-container">
                  <div className="ratio-slider-row">
                    <div className="ratio-slider-label">
                      <span>📊 객관식 (선다형)</span>
                      <span className="ratio-badge">{questionTypeRatio.choice}%</span>
                    </div>
                    <div className="slider-input-wrapper">
                      <input
                        type="range"
                        min="0"
                        max="100"
                        step="5"
                        className="input-range"
                        value={questionTypeRatio.choice}
                        onChange={(e) => setQuestionTypeRatio({ ...questionTypeRatio, choice: parseInt(e.target.value) })}
                      />
                    </div>
                  </div>

                  <div className="ratio-slider-row">
                    <div className="ratio-slider-label">
                      <span>✏️ 단답형</span>
                      <span className="ratio-badge">{questionTypeRatio.short}%</span>
                    </div>
                    <div className="slider-input-wrapper">
                      <input
                        type="range"
                        min="0"
                        max="100"
                        step="5"
                        className="input-range"
                        value={questionTypeRatio.short}
                        onChange={(e) => setQuestionTypeRatio({ ...questionTypeRatio, short: parseInt(e.target.value) })}
                      />
                    </div>
                  </div>

                  <div className="ratio-slider-row">
                    <div className="ratio-slider-label">
                      <span>📝 서술형 (Descriptive)</span>
                      <span className="ratio-badge">{questionTypeRatio.essay}%</span>
                    </div>
                    <div className="slider-input-wrapper">
                      <input
                        type="range"
                        min="0"
                        max="100"
                        step="5"
                        className="input-range"
                        value={questionTypeRatio.essay}
                        onChange={(e) => setQuestionTypeRatio({ ...questionTypeRatio, essay: parseInt(e.target.value) })}
                      />
                    </div>
                  </div>

                  {/* Stacking progress indicator bar */}
                  <div className="ratio-visual-bar">
                    <div className="ratio-segment choice" style={{ width: `${questionTypeRatio.choice}%` }}></div>
                    <div className="ratio-segment short" style={{ width: `${questionTypeRatio.short}%` }}></div>
                    <div className="ratio-segment essay" style={{ width: `${questionTypeRatio.essay}%` }}></div>
                  </div>

                  {isTypeValid ? (
                    <div className="validation-success-box">
                      <span>✅ 문항 유형 비율 총합 검증 통과 (100%)</span>
                    </div>
                  ) : (
                    <div className="validation-warning-box">
                      <span>⚠️ 비율 합산 불일치 (현재: {typeSum}%, 목표: 100%)</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Assessment Purpose */}
              <div className="form-group">
                <label className="form-label" htmlFor="purpose-input">
                  평가 목적 설정
                </label>
                <input
                  id="purpose-input"
                  type="text"
                  className="input-text"
                  placeholder="예: 단원 형성평가, 총괄평가 대비"
                  value={purpose}
                  onChange={(e) => setPurpose(e.target.value)}
                />
              </div>

              {/* Floating glowing trigger button */}
              <button
                type="button"
                className="btn-generate"
                disabled={!canGenerate}
                onClick={handleGenerate}
              >
                {isGenerating ? (
                  <>⏳ 단원평가 제작 중...</>
                ) : (
                  <>📝 단원평가 생성하기</>
                )}
              </button>
              
            </div>
          </section>

          {/* Right Side: Preview Panel */}
          <section className="panel" style={{ minHeight: '500px', display: 'flex', flexDirection: 'column' }}>
            
            {/* Header containing Mode Switch Toggles and Utility Buttons */}
            <div className="result-header">
              {generatedExam ? (
                <>
                  <div className="toggle-segment-control">
                    <button
                      type="button"
                      className={`toggle-segment-btn ${viewMode === 'student' ? 'active' : ''}`}
                      onClick={() => setViewMode('student')}
                    >
                      🎓 학생용 문제지 보기
                    </button>
                    <button
                      type="button"
                      className={`toggle-segment-btn ${viewMode === 'teacher' ? 'active' : ''}`}
                      onClick={() => setViewMode('teacher')}
                    >
                      💼 교사용 해설지 보기
                    </button>
                  </div>

                  <div className="utility-actions">
                    <button
                      type="button"
                      className="btn-utility"
                      onClick={handleCopyText}
                    >
                      📋 클립보드 복사
                    </button>
                    <button
                      type="button"
                      className="btn-utility primary"
                      onClick={handlePrint}
                    >
                      🖨️ 시험지 인쇄 (PDF)
                    </button>
                  </div>
                </>
              ) : (
                <div style={{ fontWeight: 600, color: 'var(--text-muted)' }}>🔍 출제 결과 미리보기</div>
              )}
            </div>

            {/* Body displaying Loading State, Empty State, or generated paper worksheet */}
            <div className="exam-worksheet-wrapper" style={{ flex: 1, backgroundColor: 'var(--bg-app)' }}>
              
              {isGenerating && (
                <div className="loading-overlay">
                  <div className="math-ripple-loader">
                    <div></div>
                    <div></div>
                  </div>
                  <div className="loader-status-text">
                    {stepsText[loadingStep]}
                  </div>
                  <div className="loader-sub-text">
                    학습자 오개념을 배제하는 단원 핵심 문제를 선별 중입니다.
                  </div>
                </div>
              )}

              {!isGenerating && !generatedExam && (
                <div className="empty-state">
                  <div className="empty-state-icon">
                    ∑
                  </div>
                  <h3 className="empty-state-title">평가지가 아직 작성되지 않았습니다.</h3>
                  <p className="empty-state-desc">
                    왼쪽 조건 설정 패널에서 학교급, 평가 단원, 비율 조합을 설정하고 <strong style={{ color: 'var(--primary)' }}>“단원평가 생성하기”</strong> 단추를 클릭하면 고품질 시험지가 여기에 생성됩니다.
                  </p>
                </div>
              )}

              {!isGenerating && generatedExam && (
                <article className={`exam-worksheet ${viewMode === 'student' ? 'student-view' : 'teacher-view'}`}>
                  
                  {/* Meta Paper Title */}
                  <div className="exam-meta-header">
                    <h2 className="exam-main-title">{generatedExam.title}</h2>
                    
                    {/* Name columns grid */}
                    <div className="student-info-grid">
                      <div className="student-info-cell label">과목</div>
                      <div className="student-info-cell">
                        <span style={{ fontWeight: 500 }}>수학</span>
                      </div>
                      <div className="student-info-cell label">학년/반</div>
                      <div className="student-info-cell">
                        <input
                          type="text"
                          placeholder="___학년 ___반"
                          className="student-info-input"
                          value={studentGrade}
                          onChange={(e) => setStudentGrade(e.target.value)}
                        />
                      </div>
                      <div className="student-info-cell label">번호</div>
                      <div className="student-info-cell">
                        <input
                          type="text"
                          placeholder="___번"
                          className="student-info-input"
                          value={studentNum}
                          onChange={(e) => setStudentNum(e.target.value)}
                        />
                      </div>
                      <div className="student-info-cell label">성명</div>
                      <div className="student-info-cell">
                        <input
                          type="text"
                          placeholder="이름"
                          className="student-info-input"
                          value={studentName}
                          onChange={(e) => setStudentName(e.target.value)}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Educational Goal / Purpose card */}
                  <div className="objective-card">
                    <div className="objective-title">🎯 평가 목표 및 의도</div>
                    <p className="objective-text">
                      <MathText text={generatedExam.objective} />
                    </p>
                  </div>

                  {/* Questions Sequence list */}
                  <div className="questions-list">
                    {generatedExam.questions.map((q) => {
                      const typeKo = q.type === 'choice' ? '객관식' : q.type === 'short' ? '단답형' : '서술형';
                      const diffKo = q.difficulty === 'easy' ? '하' : q.difficulty === 'medium' ? '중' : '상';

                      return (
                        <div key={q.id} className="question-item">
                          
                          {/* Question Text row */}
                          <div className="question-text-row">
                            <span className="question-number">{q.number}.</span>
                            <div className="question-body-content">
                              <MathText text={q.question} /> 
                              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginLeft: '0.5rem' }}>
                                [{typeKo} | 난이도 {diffKo}]
                              </span>
                            </div>
                          </div>

                          {/* Multiple Choice List grid */}
                          {q.options && q.options.length > 0 && (
                            <div className={`options-grid columns-${q.options.length === 5 ? '5' : '2'}`}>
                              {q.options.map((option, idx) => (
                                <div key={idx} className="option-item">
                                  <span style={{ fontWeight: 600, marginRight: '0.2rem' }}>{['①', '②', '③', '④', '⑤'][idx]}</span>
                                  <span><MathText text={cleanOptionText(option)} /></span>
                                </div>
                              ))}
                            </div>
                          )}

                          {/* Answer line space (Visible only on Student View) */}
                          {viewMode === 'student' && (
                            <div className="student-answer-space">
                              ✍️ 정답 또는 풀이 기재란: __________________________________________________
                            </div>
                          )}

                          {/* Teacher Solution view (Visible only in Teacher View) */}
                          {viewMode === 'teacher' && (
                            <div className="teacher-solution-card">
                              <div className="solution-header answer">
                                <span>🔑 올바른 모범 정답</span>
                              </div>
                              <div className="solution-body" style={{ fontWeight: 700, color: 'var(--color-easy)' }}>
                                <MathText text={q.answer} />
                              </div>

                              <div className="solution-header solution">
                                <span>💡 풀이 과정 및 해설</span>
                              </div>
                              <div className="solution-body">
                                <MathText text={q.solution} />
                              </div>

                              <div className="solution-header misconception">
                                <span>⚠️ 학생 예상 오개념 분석 & 피드백 방향</span>
                              </div>
                              <div className="solution-body" style={{ backgroundColor: 'var(--color-misconception-bg)', color: 'var(--color-misconception)', borderTop: '1px dashed var(--color-misconception-border)' }}>
                                <MathText text={q.expectedMisconception} />
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Teacher-only Assessment Summary & Pedagogy Guidelines */}
                  {viewMode === 'teacher' && (
                    <>
                      <div className="teacher-answer-grid-card">
                        <h3 className="teacher-grid-title">📊 문항별 정답 신속 확인표</h3>
                        <table className="answer-table">
                          <thead>
                            <tr>
                              <th>번호</th>
                              <th>문항 유형</th>
                              <th>난이도</th>
                              <th>정답</th>
                            </tr>
                          </thead>
                          <tbody>
                            {generatedExam.questions.map((q) => (
                              <tr key={q.id}>
                                <td><strong>{q.number}</strong></td>
                                <td>{q.type === 'choice' ? '객관식' : q.type === 'short' ? '단답형' : '서술형'}</td>
                                <td>
                                  <span style={{
                                    color: q.difficulty === 'easy' ? 'var(--color-easy)' : q.difficulty === 'medium' ? 'var(--color-medium)' : 'var(--color-hard)',
                                    fontWeight: 600
                                  }}>
                                    {q.difficulty === 'easy' ? '쉬움' : q.difficulty === 'medium' ? '보통' : '어려움'}
                                  </span>
                                </td>
                                <td className="correct"><MathText text={q.answer} /></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>

                      <div className="teacher-memo-card">
                        <h4 className="teacher-memo-title">🧠 교육학 전문가의 평가 설계 리뷰</h4>
                        <p className="teacher-memo-text">
                          <MathText text={generatedExam.teacherMemo} />
                        </p>
                      </div>
                    </>
                  )}
                  
                </article>
              )}
              
            </div>
          </section>
          
        </main>
      ) : (
        /* Diagnosis Tab Content */
        <main className="app-container">
          
          {/* Left Side: CheckTest Criteria Input Panel */}
          <section className="panel">
            <div className="form-title-bar">
              <span style={{ fontSize: '1.2rem' }}>🧪</span> 체크테스트 진단 대상 설정
            </div>
            
            <div className="form-body">
              {/* Diag Grade select */}
              <div className="form-group">
                <label className="form-label">
                  학교급 선택 <span className="form-label-help">* 필수 선택</span>
                </label>
                <div className="grade-pills">
                  <button
                    type="button"
                    className={`grade-pill-btn ${diagGradeLevel === 'elementary' ? 'active' : ''}`}
                    onClick={() => handleDiagGradeChange('elementary')}
                  >
                    🏫 초등학교
                  </button>
                  <button
                    type="button"
                    className={`grade-pill-btn ${diagGradeLevel === 'middle' ? 'active' : ''}`}
                    onClick={() => handleDiagGradeChange('middle')}
                  >
                    🏢 중학교
                  </button>
                  <button
                    type="button"
                    className={`grade-pill-btn ${diagGradeLevel === 'high' ? 'active' : ''}`}
                    onClick={() => handleDiagGradeChange('high')}
                  >
                    🏛️ 고등학교
                  </button>
                </div>
              </div>

              {/* Diag Unit Name */}
              <div className="form-group">
                <label className="form-label" htmlFor="diag-unit-input">
                  평가 단원 입력
                </label>
                <input
                  id="diag-unit-input"
                  type="text"
                  className="input-text"
                  placeholder="예: 분수의 덧셈과 뺄셈, 일차방정식"
                  value={diagUnitName}
                  onChange={(e) => setDiagUnitName(e.target.value)}
                />
              </div>

              {/* Diag Core Concepts */}
              <div className="form-group">
                <label className="form-label" htmlFor="diag-concepts-input">
                  세부 수학 개념
                </label>
                <input
                  id="diag-concepts-input"
                  type="text"
                  className="input-text"
                  placeholder="세부 개념을 쉼표로 나열하세요"
                  value={diagConcepts}
                  onChange={(e) => setDiagConcepts(e.target.value)}
                />
              </div>

              <button
                type="button"
                className="btn-generate"
                disabled={isGeneratingCheckTest || !diagUnitName.trim()}
                onClick={handleGenerateCheckTest}
              >
                {isGeneratingCheckTest ? (
                  <>⏳ 체크테스트 생성 중...</>
                ) : (
                  <>📝 체크테스트 생성하기</>
                )}
              </button>
            </div>
          </section>

          {/* Right Side: Chatbot Panel & Interactive Questions Sheet */}
          <section className="panel" style={{ minHeight: '500px', display: 'flex', flexDirection: 'column' }}>
            <div className="result-header">
              <div style={{ fontWeight: 600, color: 'var(--text-muted)' }}>🤖 AI 학습 진단 & 처방 챗봇</div>
            </div>

            <div className="exam-worksheet-wrapper" style={{ flex: 1, backgroundColor: 'var(--bg-app)', padding: 0 }}>
              <div className="chat-container">
                <div className="chat-messages">
                  
                  {/* Assistant Intro Message */}
                  <div className="chat-bubble-row assistant">
                    <div className="chat-avatar-icon">AI</div>
                    <div className="chat-bubble">
                      안녕하세요! 수학 오개념 진단 AI 챗봇입니다. ✏️
                      <br /><br />
                      학생이 단원평가를 시작하기 전에, 먼저 <strong>3~5문항의 사전 체크테스트</strong>를 해결하면 오개념과 미흡한 지점을 정밀 분석하여 적절한 출제 조건의 단원평가 구성을 추천해 드립니다.
                      <br /><br />
                      체크테스트는 <strong>100% 객관식 5지선다 버튼 클릭</strong> 형태로 출제됩니다.
                      <br /><br />
                      사전 체크테스트를 시작하려면 <strong>왼쪽 조건 패널을 채우신 뒤 [체크테스트 생성하기]</strong> 버튼을 클릭해 주세요!
                    </div>
                  </div>

                  {/* Loading checktest state */}
                  {isGeneratingCheckTest && (
                    <div className="chat-bubble-row assistant">
                      <div className="chat-avatar-icon">AI</div>
                      <div className="chat-bubble" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <span className="loader-status-text" style={{ fontSize: '0.9rem' }}>
                          AI가 {diagGradeMap[diagGradeLevel]} [{diagUnitName}] 관련 진단 체크테스트 문제를 맞춤 출제 중입니다...
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Checktest Questions Sheet */}
                  {checkTest && (
                    <div className="chat-bubble-row assistant">
                      <div className="chat-avatar-icon">AI</div>
                      <div className="chat-bubble" style={{ width: '90%' }}>
                        <strong>✨ AI 사전 체크테스트가 구성되었습니다!</strong>
                        <br />
                        아래 문제를 꼼꼼히 확인하고 학생이 직접 정답을 기재하거나 선택하도록 해 주세요.
                        
                        <div className="checktest-sheet" style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                          {checkTest.questions.map(q => {
                            // Enforce choices mapping to always have exactly 5 elements visually
                            const fallbackChoices = q.choices && q.choices.length > 0 ? q.choices : [
                              "① 보기 1", "② 보기 2", "③ 보기 3", "④ 보기 4", "⑤ 보기 5"
                            ];
                            return (
                              <div key={q.number} className="checktest-question-card">
                                <div className="checktest-question-title">Q{q.number}. {q.concept}</div>
                                <div style={{ whiteSpace: 'pre-wrap', marginBottom: '0.5rem' }}><MathText text={q.question} /></div>
                                
                                {/* 100% Multiple Choice 5 buttons layout */}
                                <div className="checktest-choices">
                                  {fallbackChoices.map((choiceText, index) => {
                                    const optionChar = ['①', '②', '③', '④', '⑤'][index] || `${index + 1}`;
                                    const isSelected = studentAnswers[q.number] === optionChar;
                                    return (
                                      <button
                                        key={index}
                                        type="button"
                                        className={`checktest-choice-btn ${isSelected ? 'selected' : ''}`}
                                        onClick={() => setStudentAnswers({ ...studentAnswers, [q.number]: optionChar })}
                                      >
                                        <strong>{optionChar}</strong> <MathText text={cleanOptionText(choiceText)} />
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Diagnosing States Loader */}
                  {isDiagnosing && (
                    <div className="chat-bubble-row assistant">
                      <div className="chat-avatar-icon">AI</div>
                      <div className="chat-bubble">
                        <span className="loader-status-text" style={{ fontSize: '0.9rem' }}>
                          학생이 작성한 답안을 채점하고 오개념 진단을 심층 수행하고 있습니다. 잠시만 기다려 주세요...
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Diagnosis Result Sheet Card display */}
                  {diagnosisResult && (
                    <div className="chat-bubble-row assistant">
                      <div className="chat-avatar-icon">AI</div>
                      <div className="chat-bubble" style={{ width: '90%' }}>
                        <strong>📊 정밀 진단 및 수학적 오개념 분석 보고서</strong>
                        <br />
                        체크테스트 채점 결과를 바탕으로 AI가 추출한 맞춤 학습 처방 내용입니다.
                        
                        <div className="diagnosis-container" style={{ marginTop: '1.25rem' }}>
                          <div className="diagnosis-card">
                            <div className="diagnosis-header">
                              <span className="diagnosis-title">📋 취약 개념 분석서</span>
                              <span className="diagnosis-score-badge">
                                맞힌 개수: {diagnosisResult.correctCount} / {checkTest?.questions.length || 0}
                              </span>
                            </div>

                            <div className="diagnosis-section">
                              <div className="diagnosis-section-title">🔴 보완이 시급한 취약 세부 개념</div>
                              <div className="diagnosis-concepts-list">
                                {diagnosisResult.weakConcepts.length > 0 ? (
                                  diagnosisResult.weakConcepts.map((concept, idx) => (
                                    <span key={idx} className="diagnosis-concept-tag">{concept}</span>
                                  ))
                                ) : (
                                  <span className="diagnosis-concept-tag" style={{ backgroundColor: 'var(--color-easy-bg)', color: 'var(--color-easy)', borderColor: 'var(--color-easy-border)' }}>취약 개념 없음(완벽 이해)</span>
                                )}
                              </div>
                            </div>

                            <div className="diagnosis-section">
                              <div className="diagnosis-section-title">🧠 학생의 예상 인지 오류 (오개념)</div>
                              <p className="diagnosis-text"><MathText text={diagnosisResult.expectedMisconceptions} /></p>
                            </div>

                            <div className="diagnosis-section">
                              <div className="diagnosis-section-title">📌 추가 학습 보충이 필요한 이유</div>
                              <p className="diagnosis-text"><MathText text={diagnosisResult.reasonForReinforcement} /></p>
                            </div>

                            {/* --- New Section: Detailed Scored Review Per Question --- */}
                            <div className="diagnosis-section" style={{ marginTop: '1.5rem', borderTop: '1px dashed var(--border)', paddingTop: '1.5rem' }}>
                              <div className="diagnosis-section-title">📝 문항별 정밀 채점 리뷰</div>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '0.75rem' }}>
                                {diagnosisResult.questionsAnalysis && diagnosisResult.questionsAnalysis.map((qa) => (
                                  <div key={qa.number} style={{
                                    backgroundColor: 'var(--bg-input)',
                                    border: '1px solid var(--border)',
                                    borderRadius: 'var(--radius-sm)',
                                    padding: '1rem',
                                    position: 'relative'
                                  }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                                      <strong style={{ color: 'var(--primary)' }}>Q{qa.number}. {qa.concept}</strong>
                                      <span style={{
                                        backgroundColor: qa.isCorrect ? 'var(--color-easy-bg)' : 'var(--color-hard-bg)',
                                        border: `1px solid ${qa.isCorrect ? 'var(--color-easy-border)' : 'var(--color-hard-border)'}`,
                                        color: qa.isCorrect ? 'var(--color-easy)' : 'var(--color-hard)',
                                        padding: '0.2rem 0.6rem',
                                        borderRadius: '12px',
                                        fontSize: '0.75rem',
                                        fontWeight: 700
                                      }}>
                                        {qa.isCorrect ? '🟢 맞힘' : '❌ 틀림'}
                                      </span>
                                    </div>
                                    <table style={{ width: '100%', fontSize: '0.85rem', borderCollapse: 'collapse' }}>
                                      <tbody>
                                        <tr>
                                          <td style={{ width: '35%', padding: '0.25rem 0', color: 'var(--text-muted)', fontWeight: 600 }}>학생 선택 답</td>
                                          <td style={{ padding: '0.25rem 0', fontWeight: 700, color: qa.isCorrect ? 'var(--color-easy)' : 'var(--color-hard)' }}>{qa.studentAnswer}</td>
                                        </tr>
                                        <tr>
                                          <td style={{ padding: '0.25rem 0', color: 'var(--text-muted)', fontWeight: 600 }}>모범 정답</td>
                                          <td style={{ padding: '0.25rem 0', fontWeight: 700 }}>{cleanOptionText(qa.correctAnswer)}</td>
                                        </tr>
                                        <tr>
                                          <td style={{ padding: '0.25rem 0', color: 'var(--text-muted)', fontWeight: 600, verticalAlign: 'top' }}>예상 오개념 분석</td>
                                          <td style={{ padding: '0.25rem 0', color: 'var(--text-secondary)', lineHeight: 1.4 }}><MathText text={qa.misconception} /></td>
                                        </tr>
                                      </tbody>
                                    </table>
                                  </div>
                                ))}
                              </div>
                            </div>

                            <div className="diagnosis-section" style={{ marginTop: '1.5rem', borderTop: '1px dashed var(--border)', paddingTop: '1.5rem' }}>
                              <div className="diagnosis-section-title">💡 AI 추천 단원평가 출제 조건</div>
                              <table className="diagnosis-recommendation-table">
                                <tbody>
                                  <tr>
                                    <td className="label">학교급 / 단원</td>
                                    <td>{diagGradeMap[diagnosisResult.recommendedSettings.gradeLevel]} / {diagnosisResult.recommendedSettings.unitName}</td>
                                  </tr>
                                  <tr>
                                    <td className="label">집중 출제 개념</td>
                                    <td>{diagnosisResult.recommendedSettings.concepts}</td>
                                  </tr>
                                  <tr>
                                    <td className="label">성취기준 적용</td>
                                    <td>{diagnosisResult.recommendedSettings.standard}</td>
                                  </tr>
                                  <tr>
                                    <td className="label">문항 수 및 평가목적</td>
                                    <td>{diagnosisResult.recommendedSettings.questionCount}문항 / {diagnosisResult.recommendedSettings.purpose}</td>
                                  </tr>
                                  <tr>
                                    <td className="label">난이도 비율</td>
                                    <td>쉬움 {diagnosisResult.recommendedSettings.difficulty.easy}% / 보통 {diagnosisResult.recommendedSettings.difficulty.medium}% / 어려움 {diagnosisResult.recommendedSettings.difficulty.hard}%</td>
                                  </tr>
                                  <tr>
                                    <td className="label">문항 유형 비율</td>
                                    <td>객관식 {diagnosisResult.recommendedSettings.questionTypeRatio.choice}% / 단답형 {diagnosisResult.recommendedSettings.questionTypeRatio.short}% / 서술형 {diagnosisResult.recommendedSettings.questionTypeRatio.essay}%</td>
                                  </tr>
                                </tbody>
                              </table>
                            </div>

                            {/* Glow-pulse Auto Transfer Button */}
                            <button
                              type="button"
                              className="btn-apply-diagnosis"
                              onClick={handleApplyDiagnosis}
                            >
                              ⚡ 진단 결과로 출제 조건 적용하기
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                </div>

                {/* Submitting student answers */}
                {checkTest && !diagnosisResult && (
                  <div className="chat-submit-area">
                    <button
                      type="button"
                      className="btn-chat-submit"
                      disabled={isDiagnosing}
                      onClick={handleDiagnoseCheckTest}
                    >
                      {isDiagnosing ? '⏳ 학생 답안 분석 및 진단 중...' : '📝 답안 제출 및 진단하기'}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </section>

        </main>
      )}

      {/* Floating Clipboard Copy Success Notification Alert */}
      {showToast && (
        <div className="toast">
          <span>{toastMessage}</span>
        </div>
      )}
    </>
  );
}

export default App;
