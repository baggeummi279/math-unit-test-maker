import { IncomingMessage, ServerResponse } from 'http';
import type { GradeLevel } from '../src/types';

interface CheckTestRequest extends IncomingMessage {
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
async function getRequestBody(req: CheckTestRequest): Promise<Record<string, unknown>> {
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

export default async function handler(req: CheckTestRequest, res: ServerResponse) {
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

    const body = (await getRequestBody(req));
    const { gradeLevel, unitName, concepts } = body as { gradeLevel: GradeLevel; unitName: string; concepts: string };

    const gradeMap: Record<string, string> = {
      elementary: '초등학교',
      middle: '중학교',
      high: '고등학교'
    };

    const systemPrompt = `당신은 수학교육 전문가이자 평가 설계 위원입니다.
학생이 정식 단원평가를 치르기 전에, 해당 단원의 핵심적인 취약점을 진단하기 위한 "3~5문항의 체크테스트"를 설계해야 합니다.

출제 조건:
1. 학년: ${gradeMap[gradeLevel] || '초등학교'} 과정에 부합하는 문제
2. 단원: ${unitName || '종합 단원'}
3. 세부 개념: ${concepts || '해당 단원 핵심 개념'}

문항 설계 규칙:
1. 문항 텍스트, 보기, 정답, 세부 개념명 등 모든 출력 항목은 반드시 표준 한국어만을 사용하여 작성하십시오. 영어 단어나 영어 수학 용어의 사용을 엄격히 금지합니다.
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
3. 체크테스트는 반드시 객관식 5지선다(선택지 5개)로만 출제해야 합니다. 단답형, 서술형, 빈칸형 문항은 절대로 출제하지 마십시오.
4. 문항 수는 반드시 3~5개 사이로 생성하세요.
5. **[중요] 수식 작성 및 렌더링 규칙**:
   - **LaTeX 문법, 백슬래시(\), 수식 감싸기용 기호($)를 절대로 사용하지 마십시오. \\frac 형식 또한 엄격히 금지합니다.** 화면에 \\frac, $, {, } 과 같은 수식 원문이 보이면 실패입니다.
   - 모든 분수는 반드시 슬래시(/)를 사용한 일반 텍스트 형태로만 작성하십시오. (예: 3/8, 2/5)
   - 모든 대분수는 반드시 자연수와 진분수 사이에 하나의 공백(띄어쓰기)을 둔 일반 텍스트 형태로만 작성하십시오. (예: 2 1/4, 3 1/2)
   - 거듭제곱은 x^2 형태로 작성하십시오. 루트는 한글 '루트 x' 또는 '제곱근 x' 형태로 풀어서 작성하십시오.
   - 화면에서는 앱 내부에서 일반 텍스트 형태(3/8, 2 1/4 등)를 자동으로 감지하여 미려한 세로 분수 형태의 UI 컴포넌트로 렌더링하므로, AI는 **순수한 일반 텍스트 형태**로만 전달해야 합니다.
6. 수학적 정확성을 엄격히 유지하십시오. 대분수 변환 등 모든 계산에서 분자를 분모로 나눈 몫과 나머지를 정확히 계산해야 하며, 정답과 보기의 계산 결과가 한 치의 오차도 없이 완벽히 일치해야 합니다. (예: 가분수 9/4는 몫 2, 나머지 1에 의해 정확하게 2 1/4로 대분수 변환되어야 하며, 절대 2 1/3이 될 수 없습니다.)
7. 각 문항은 다음 속성을 충실히 포함해야 합니다:
   - number: 1부터 시작하는 순차적인 정수
   - concept: 이 문항이 테스트하는 세부 수학 개념 (예: "대분수와 대분수의 덧셈", "최대공약수 구하기")
   - question: 문제 내용 (수식은 LaTeX나 $ 없이 일반 텍스트 분수/대분수 표기법 적용)
   - choices: 반드시 ①, ②, ③, ④, ⑤ 기호로 시작하는 정확히 5개의 선택지 텍스트를 채우십시오. 선택지 내의 수식 역시 LaTeX나 $ 없이 일반 텍스트 분수/대분수 표기법을 사용하십시오. (예: ["① 2 1/5", "② 2 2/5", "③ 2 3/5", "④ 2 4/5", "⑤ 3"])
   - answer: 5개 선택지(choices) 중 하나와 기호 및 내용이 완전히 동일한 정답 텍스트를 채우십시오. (예: choices에 "② 2 2/5"가 있다면, answer도 반드시 "② 2 2/5"여야 함. 단순 "②" 또는 다른 포맷은 피하십시오.)
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
          { role: 'system', content: 'You are a professional mathematics test creator. Output must comply exactly with the JSON schema provided.' },
          { role: 'user', content: systemPrompt }
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'check_test_generation',
            strict: true,
            schema: {
              type: 'object',
              properties: {
                title: { type: 'string' },
                questions: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      number: { type: 'integer' },
                      concept: { type: 'string' },
                      question: { type: 'string' },
                      choices: { type: 'array', items: { type: 'string' } },
                      answer: { type: 'string' }
                    },
                    required: ['number', 'concept', 'question', 'choices', 'answer'],
                    additionalProperties: false
                  }
                }
              },
              required: ['title', 'questions'],
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
