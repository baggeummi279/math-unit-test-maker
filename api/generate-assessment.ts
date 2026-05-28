import { IncomingMessage, ServerResponse } from 'http';
import type { ExamFormInputs } from '../src/types';

interface AssessmentRequest extends IncomingMessage {
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
async function getRequestBody(req: AssessmentRequest): Promise<Record<string, unknown>> {
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

export default async function handler(req: AssessmentRequest, res: ServerResponse) {
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

    const body = (await getRequestBody(req)) as unknown as ExamFormInputs;
    const { gradeLevel, unitName, concepts, standard, questionCount, difficulty, questionTypeRatio, purpose } = body;

    const gradeMap: Record<string, string> = {
      elementary: '초등학교',
      middle: '중학교',
      high: '고등학교'
    };

    const systemPrompt = `당신은 수학 교육과정 평가원 소속의 수학교육 전문가이자 출제 위원입니다.
수학교사와 예비교사가 요청한 학년, 단원, 세부 개념, 성취기준, 평가 목적에 완전히 부합하는 최상의 단원평가 문항 세트를 설계해야 합니다.

출제 조건:
1. 학년: ${gradeMap[gradeLevel] || '초등학교'} 과정에 완벽히 정렬된 문항 출제
2. 단원: ${unitName || '종합 단원'}
3. 세부 개념: ${concepts || '해당 단원 핵심 개념'}
4. 성취기준: ${standard || '기본 교육과정 성취기준'}
5. 문항 수: ${questionCount || 5}개
6. 난이도 비율: 쉬움 ${difficulty?.easy || 30}%, 보통 ${difficulty?.medium || 40}%, 어려움 ${difficulty?.hard || 30}% (이에 맞춰 문항 난이도를 분배)
7. 문항 유형 비율: 객관식 ${questionTypeRatio?.choice || 40}%, 단답형 ${questionTypeRatio?.short || 40}%, 서술형 ${questionTypeRatio?.essay || 20}% (이에 맞춰 문항 형태를 분배)
8. 평가 목적: ${purpose || '형성평가 및 오개념 진정성 파악'}

문항 설계 규칙:
1. 문항 텍스트, 보기, 정답, 해설, 예상 오개념 분석 등 모든 출력 항목은 반드시 표준 한국어만을 사용하여 작성하십시오. 영어 단어나 영어 수학 용어의 사용을 엄격히 금지합니다.
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
3. 문항 텍스트는 표준 한국어로 명확하고 친절한 교수학습용 톤앤매너를 유지하세요.
   - **[해설(solution) 작성 시 수학교육적 문장 규칙]**:
     - 학생 대상 해설이므로 모든 문장은 짧고 명확하게 작성하며 계산 과정이 자연스럽게 이어지도록 하십시오.
     - "~로 변환합니다"라는 표현을 과도하게 사용하지 마십시오.
     - 약분 상황에서는 “A는 B로 약분합니다” 형식을 사용하십시오. (예: “4/6은 약분해서 2/3으로 변환합니다” (X) → “4/6은 2/3으로 약분합니다” (O))
     - 통분 또는 동치분수 설명에서는 “A는 B와 같습니다” 또는 “A는 분모를 n으로 맞추면 B와 같습니다” 형식을 사용하십시오. (예: “1/2은 같은 분모로 변환하면 3/6입니다” (X) → “1/2은 분모를 6으로 맞추면 3/6과 같습니다” (O))
     - “같은 분모로 변환하면”이라는 표현은 피하고, “분모를 n으로 맞추면” 또는 “동치분수로 나타내면”을 사용하십시오.
4. **[중요] 수식 작성 및 렌더링 규칙**:
   - **LaTeX 문법, 백슬래시(\), 수식 감싸기용 기호($)를 절대로 사용하지 마십시오. \\frac 형식 또한 엄격히 금지합니다.** 화면에 \\frac, $, {, } 과 같은 수식 원문이 보이면 실패입니다.
   - 모든 분수는 반드시 슬래시(/)를 사용한 일반 텍스트 형태로만 작성하십시오. (예: 3/8, 2/5)
   - 모든 대분수는 반드시 자연수와 진분수 사이에 하나의 공백(띄어쓰기)을 둔 일반 텍스트 형태로만 작성하십시오. (예: 2 1/4, 3 1/2)
    - 거듭제곱은 가능하면 2², x²처럼 위첨자 형태로 작성하십시오. 곱셈은 * 대신 × 를 사용하십시오. 루트는 한글 '루트 x' 또는 '제곱근 x' 형태로 풀어서 작성하십시오.
   - 화면에서는 앱 내부에서 일반 텍스트 형태(3/8, 2 1/4 등)를 자동으로 감지하여 미려한 세로 분수 형태의 UI 컴포넌트로 렌더링하므로, AI는 **순수한 일반 텍스트 형태**로만 전달해야 합니다.
5. 수학적 정확성을 엄격히 유지하십시오. 대분수 변환 등 모든 계산에서 분자를 분모로 나눈 몫과 나머지를 정확히 계산해야 하며, 정답과 해설의 계산 결과가 한 치의 오차도 없이 완벽히 일치해야 합니다. (예: 9/4는 절대 2 1/3이 아니며, 정확히 몫 2, 나머지 1에 의해 2 1/4로 계산되어야 합니다.) 해설에는 몫, 나머지, 대분수 변환 과정이 명확하고 정확하게 드러나야 합니다.
6. 각 문항은 다음 속성을 충실히 포함해야 합니다:
   - question: 지문 및 문제 (수식은 LaTeX나 $ 없이 일반 텍스트 분수/대분수 표기법 적용)
   - choices: 객관식(선다형)일 경우 5개 보기를 ①, ②, ③, ④, ⑤ 기호로 시작하는 텍스트로 채우되, 수식은 일반 텍스트 분수/대분수 표기법을 사용하십시오. 단답형 및 서술형의 경우 빈 배열 []로 채우세요. (예: ["① 2 1/5", "② 2 2/5", "③ 2 3/5", "④ 2 4/5", "⑤ 3"])
   - answer: 명확한 정답 (예: '② 2 1/5', '3', 'x = 10')
   - solution: 상세하고 학문적으로 친절한 단계별 풀이 및 해설 (몫과 나머지 계산 및 대분수 변환 과정을 상세히 기술하되 LaTeX나 $ 사용 절대 금지)
   - misconception: 이 문제를 해결할 때 학생들이 저지르기 쉬운 구체적인 인지적 오류(오개념)에 대한 분석 및 교사의 처방 가이드 (LaTeX나 $ 사용 절대 금지)
7. teacherNotes에는 평가 전체에 대한 교육학적 출제 의도, 난이도 분포 평가, 후속 처방 제안 등 교사를 위한 정밀한 피드백 코멘트를 1~3문장 이내의 배열 형태로 작성하세요.`;

    const openAiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'You are a professional mathematics test creator. Output must comply exactly with the JSON schema provided.' },
          { role: 'user', content: systemPrompt }
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'assessment_generation',
            strict: true,
            schema: {
              type: 'object',
              properties: {
                title: { type: 'string' },
                goals: { type: 'array', items: { type: 'string' } },
                questions: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      number: { type: 'integer' },
                      difficulty: { type: 'string', enum: ['쉬움', '보통', '어려움'] },
                      type: { type: 'string', enum: ['객관식', '단답형', '서술형'] },
                      concept: { type: 'string' },
                      question: { type: 'string' },
                      choices: { type: 'array', items: { type: 'string' } },
                      answer: { type: 'string' },
                      solution: { type: 'string' },
                      misconception: { type: 'string' }
                    },
                    required: ['number', 'difficulty', 'type', 'concept', 'question', 'choices', 'answer', 'solution', 'misconception'],
                    additionalProperties: false
                  }
                },
                teacherNotes: { type: 'array', items: { type: 'string' } }
              },
              required: ['title', 'goals', 'questions', 'teacherNotes'],
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
