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
1. 문항 텍스트는 표준 한국어로 명확하고 친절한 교수학습용 톤앤매너를 유지하세요.
2. 수식 표기 시 LaTeX($ 기호)를 절대 사용하지 말고, 유니코드 특수 문자(×, ÷, ≤, ≥, ≠, ⇒, ², ³, ⁴, ⁵, ⁶, ⁷, ⁸, ⁹, ˣ, ʸ, ᵃ, ᵇ, ᶜ 등)를 직접 사용하여 자연스럽게 텍스트 분모/분자 형태로 작성해 주세요. (예: '2/7', '2³ × 3² × 5ˣ', 'x + y = 4')
3. 각 문항은 다음 속성을 충실히 포함해야 합니다:
   - question: 지문 및 문제 (세로 분수는 standard inline 문자형태인 A/B 로 표기)
   - choices: 객관식(선다형)일 경우 5개 보기를 ①, ②, ③, ④, ⑤ 기호로 시작하는 텍스트로 채우고, 단답형 및 서술형의 경우 빈 배열 []로 채우세요.
   - answer: 명확한 정답 (예: '② 5/7', '3', 'x = 10')
   - solution: 상세하고 학문적으로 친절한 단계별 풀이 및 해설
   - misconception: 이 문제를 해결할 때 학생들이 저지르기 쉬운 구체적인 인지적 오류(오개념)에 대한 분석 및 교사의 처방 가이드
4. teacherNotes에는 평가 전체에 대한 교육학적 출제 의도, 난이도 분포 평가, 후속 처방 제안 등 교사를 위한 정밀한 피드백 코멘트를 1~3문장 이내의 배열 형태로 작성하세요.`;

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
