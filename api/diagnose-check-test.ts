import { IncomingMessage, ServerResponse } from 'http';
import type { GradeLevel } from '../src/types';

interface DiagnoseRequest extends IncomingMessage {
  body?: Record<string, unknown>;
}

interface OpenAIResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

// Helper to parse POST body stream in Node.js (handles stream buffers from Vite Connect)
async function getRequestBody(req: DiagnoseRequest): Promise<Record<string, unknown>> {
  if (req.body) {
    return req.body;
  }
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk: string | Buffer) => { body += chunk; });
    req.on('end', () => {
      try {
        resolve(JSON.parse(body) as Record<string, unknown>);
      } catch {
        resolve({});
      }
    });
    req.on('error', (err: Error) => { reject(err); });
  });
}

export default async function handler(req: DiagnoseRequest, res: ServerResponse) {
  // CORS Headers support
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.statusCode = 200;
    res.end();
    return;
  }

  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: 'Method Not Allowed. POST만 지원합니다.' }));
    return;
  }

  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({
        error: 'OPENAI_API_KEY가 설정되지 않았습니다. 루트 디렉토리에 .env.local 파일을 생성하고 OPENAI_API_KEY="여러분의_API_키"를 기입해 주세요.'
      }));
      return;
    }

    const body = await getRequestBody(req);
    const { gradeLevel, unitName, concepts, questions, studentAnswers } = body as {
      gradeLevel: GradeLevel;
      unitName: string;
      concepts: string;
      questions: Array<{ number: number; concept: string; question: string; choices: string[]; answer: string }>;
      studentAnswers: Record<number, string>;
    };

    const gradeMap: Record<string, string> = {
      elementary: '초등학교',
      middle: '중학교',
      high: '고등학교'
    };

    const formattedQuestions = questions.map(q => {
      const studentAns = studentAnswers[q.number] || '(제출 안 함)';
      return `[문항 ${q.number}]
- 테스트 개념: ${q.concept}
- 문제: ${q.question}
- 보기: ${q.choices.length > 0 ? q.choices.join(', ') : '없음(단답형)'}
- 모범 답안: ${q.answer}
- 학생이 작성한 답안: ${studentAns}`;
    }).join('\n\n');

    const systemPrompt = `당신은 대한민국 교육과정에 정통한 수학과 평가 전문가이자 오개념 진단 AI입니다.
학생이 제출한 체크테스트 답안 정보를 바탕으로 정밀 채점을 진행하고, 학생의 부족한 개념과 예상 오개념을 진단하십시오.
또한, 이를 기반으로 학생의 학습 취약점을 철저하게 보완할 수 있는 "맞춤형 단원평가 출제 조건"을 추천해 주세요.

[체크테스트 및 학생 답안 정보]
학년 수준: ${gradeMap[gradeLevel] || '초등학교'}
평가 단원: ${unitName}
원래 세부 개념: ${concepts}

[문항별 학생 응답 데이터]
${formattedQuestions}

[중요 지시 사항 및 규칙]
1. 모든 진단 결과 항목(weakConcepts, expectedMisconceptions, reasonForReinforcement, recommendedSettings의 concepts, purpose, 그리고 questionsAnalysis 내 텍스트들 등)은 반드시 표준 한국어만을 사용하여 작성하십시오. 영어 단어나 영어 수학 용어의 사용을 엄격히 금지합니다.
2. 모든 수학 용어는 반드시 정식 한국어 명칭으로 기술하십시오. 다음은 필수 매핑 번역 예시입니다:
   - improper fraction -> 가분수
   - mixed number -> 대분수
   - proper fraction -> 진분수
   - numerator -> 분자
   - denominator -> 분모
   - equivalent fraction -> 동치분수
   - simplify -> 약분
   - common denominator -> 공통분모 또는 통분
   - slope -> 기울기
   - y-intercept -> y절편
   - equation -> 방정식
   - expression -> 식
   - graph -> 그래프
3. **[중요] 수식 작성 및 렌더링 규칙**:
   - **LaTeX 문법, 백슬래시(\), 수식 감싸기용 기호($)를 절대로 사용하지 마십시오. \\frac 형식 또한 엄격히 금지합니다.** 화면에 \\frac, $, {, } 과 같은 수식 원문이 보이면 실패입니다.
   - 모든 분수는 반드시 슬래시(/)를 사용한 일반 텍스트 형태로만 작성하십시오. (예: 3/8, 2/5)
   - 모든 대분수는 반드시 자연수와 진분수 사이에 하나의 공백(띄어쓰기)을 둔 일반 텍스트 형태로만 작성하십시오. (예: 2 1/4, 3 1/2)
   - 거듭제곱은 x^2 형태로 작성하십시오. 루트는 한글 '루트 x' 또는 '제곱근 x' 형태로 풀어서 작성하십시오.
   - 화면에서는 앱 내부에서 일반 텍스트 형태(3/8, 2 1/4 등)를 자동으로 감지하여 미려한 세로 분수 형태의 UI 컴포넌트로 렌더링하므로, AI는 **순수한 일반 텍스트 형태**로만 전달해야 합니다.
4. 수학적 정확성을 엄격히 검증하여 채점하십시오. 대분수 변환 문제 등 모든 수학적 몫과 나머지가 정확히 계산되었는지 대조하십시오. (예: 9/4는 몫 2, 나머지 1에 의해 정확하게 2 1/4로 대분수 변환되어야 하며, 절대 2 1/3이 될 수 없습니다.)
5. 정밀 채점: 학생이 제출한 답안(예: '①', '②' 등)과 문제의 모범 답안(예: '① 1/5' 등)을 신중하게 비교하십시오. 학생이 제출한 답안 기호(①, ②, ③, ④, ⑤)가 모범 답안의 제일 앞 기호와 일치하면 정답(isCorrect = true)으로 처리하십시오.
6. 맞힌 문항 수(correctCount)를 산출해 주세요.
7. 부족한 개념(weakConcepts): 학생이 오답을 기재한 문항의 수학 개념 또는 성취도 저조가 예상되는 보완 개념들을 나열해 주세요.
8. 예상 오개념(expectedMisconceptions): 학생이 왜 오답을 골랐는지 인지적 관점(예: 분모를 그냥 더했다든가, 약수를 계산하지 않았다든가 등)에서 명확하게 기술하되, LaTeX나 $는 일절 사용하지 말고 평문 분수/대분수로 적어주세요.
9. 보충이 필요한 이유(reasonForReinforcement): 왜 이 학생이 추가적인 단원평가와 보충 피드백을 통해 훈련해야 하는지 1~2문장으로 설득력 있게 설명해 주세요.
10. 문항별 정밀 채점 분석(questionsAnalysis): 각 문항에 대하여 채점 결과를 상세히 배열에 담으십시오.
   - number: 문항 번호 (정수)
   - isCorrect: 해당 문항 채점 결과 (true/false)
   - correctAnswer: 모범 정답 텍스트 전체 (예: "① 1 1/5")
   - studentAnswer: 학생이 기입한 기호 텍스트 (예: "①" 또는 "②")
   - concept: 해당 문항이 테스트하는 세부 수학 개념
   - misconception: 오답 시 구체적인 인지 오류 분석 (맞은 경우 "개념을 올바르게 이해하고 적용함" 등으로 작성하고, 오답인 경우 원인이 되는 구체적인 오개념 작성. LaTeX나 $는 일절 사용하지 말고 평문 분수/대분수로 작성)
11. 추천 출제 조건(recommendedSettings) 설계:
   - gradeLevel: '${gradeLevel}' 그대로 유지하세요.
   - unitName: '${unitName}' 그대로 유지하세요.
   - concepts: 학생이 부족한 핵심 세부 개념을 위주로 3~4개의 세부 수학 개념 목록을 기재하세요. (쉼표로 구분하여 문자열 하나로 병합)
   - standard: 부족한 수학 세부 개념과 밀접하게 연동되는 교육과정 성취기준 코드 및 성취기준 내용 1개를 찾아서 추천 텍스트로 작성하세요. (예: [4수01-16] 분모가 같은 분수의 덧셈과 뺄셈의 계산 원리를 이해하고 그 계산을 할 수 있다.)
   - questionCount: '5' 또는 '10' 중에서 적절히 추천해 주세요. (기본 5)
   - difficulty: 쉬움(easy), 보통(medium), 어려움(hard)의 합이 반드시 정확히 100이어야 합니다.
     - 예: 체크테스트를 많이 틀렸다면 쉬움 50%, 보통 40%, 어려움 10% 등 하위 보완형으로 추천.
     - 다 맞았거나 거의 맞았다면 쉬움 10%, 보통 50%, 어려움 40% 등 심화형으로 추천.
   - questionTypeRatio: 객관식(choice), 단답형(short), 서술형(essay)의 합이 반드시 정확히 100이어야 합니다.
     - 오개념 교정 및 개념 다지기가 시급한 학생은 객관식 50%, 단답형 30%, 서술형 20% 등으로 추천.
     - 응용 단계인 학생은 서술형 비율을 높여 추천 (예: 객관식 30%, 단답형 40%, 서술형 30%).
   - purpose: 추천하는 평가 목적을 1문장의 설득력 있는 문장으로 작성해 주세요. (예: "취약 개념인 대분수의 덧셈과 받아올림 극복을 위한 맞춤형 형성평가", "소인수분해의 개념 정밀 진단 및 소수와 합성어 분별 강화 평가")
`;

    const openAiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'You are a professional mathematics diagnostic expert. Output must comply exactly with the JSON schema provided.' },
          { role: 'user', content: systemPrompt }
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'check_test_diagnosis',
            strict: true,
            schema: {
              type: 'object',
              properties: {
                correctCount: { type: 'integer' },
                weakConcepts: { type: 'array', items: { type: 'string' } },
                expectedMisconceptions: { type: 'string' },
                reasonForReinforcement: { type: 'string' },
                questionsAnalysis: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      number: { type: 'integer' },
                      isCorrect: { type: 'boolean' },
                      correctAnswer: { type: 'string' },
                      studentAnswer: { type: 'string' },
                      concept: { type: 'string' },
                      misconception: { type: 'string' }
                    },
                    required: ['number', 'isCorrect', 'correctAnswer', 'studentAnswer', 'concept', 'misconception'],
                    additionalProperties: false
                  }
                },
                recommendedSettings: {
                  type: 'object',
                  properties: {
                    gradeLevel: { type: 'string', enum: ['elementary', 'middle', 'high'] },
                    unitName: { type: 'string' },
                    concepts: { type: 'string' },
                    standard: { type: 'string' },
                    questionCount: { type: 'integer', enum: [5, 10] },
                    difficulty: {
                      type: 'object',
                      properties: {
                        easy: { type: 'integer' },
                        medium: { type: 'integer' },
                        hard: { type: 'integer' }
                      },
                      required: ['easy', 'medium', 'hard'],
                      additionalProperties: false
                    },
                    questionTypeRatio: {
                      type: 'object',
                      properties: {
                        choice: { type: 'integer' },
                        short: { type: 'integer' },
                        essay: { type: 'integer' }
                      },
                      required: ['choice', 'short', 'essay'],
                      additionalProperties: false
                    },
                    purpose: { type: 'string' }
                  },
                  required: ['gradeLevel', 'unitName', 'concepts', 'standard', 'questionCount', 'difficulty', 'questionTypeRatio', 'purpose'],
                  additionalProperties: false
                }
              },
              required: ['correctCount', 'weakConcepts', 'expectedMisconceptions', 'reasonForReinforcement', 'questionsAnalysis', 'recommendedSettings'],
              additionalProperties: false
            }
          }
        }
      })
    });

    if (!openAiResponse.ok) {
      const errText = await openAiResponse.text();
      res.statusCode = openAiResponse.status;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: `OpenAI API 호출 실패: ${errText}` }));
      return;
    }

    const openAiData = (await openAiResponse.json()) as OpenAIResponse;
    const gptContent = openAiData.choices?.[0]?.message?.content;

    if (!gptContent) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: 'OpenAI로부터 빈 응답이 돌아왔습니다.' }));
      return;
    }

    let parsedResult;
    try {
      parsedResult = JSON.parse(gptContent) as Record<string, unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: `JSON 파싱 실패: GPT 응답을 파싱할 수 없습니다. (${message})` }));
      return;
    }

    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(parsedResult));

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: `서버 오작동: ${message}` }));
  }
}
