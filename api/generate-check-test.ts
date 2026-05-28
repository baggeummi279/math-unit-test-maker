import type { VercelRequest, VercelResponse } from '@vercel/node';

type GradeLevel = 'elementary' | 'middle' | 'high';

interface OpenAIResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

declare const process: {
  env: {
    OPENAI_API_KEY?: string;
    [key: string]: string | undefined;
  };
};

// Helper to parse POST body stream in Node.js (handles stream buffers from Vite Connect)
async function getRequestBody(req: any): Promise<Record<string, unknown>> {
  if (req.body) {
    return req.body as Record<string, unknown>;
  }
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk: any) => { body += chunk; });
    req.on('end', () => {
      try {
        resolve(JSON.parse(body) as Record<string, unknown>);
      } catch {
        resolve({});
      }
    });
    req.on('error', (err: any) => { reject(err); });
  });
}

export default async function handler(req: any, res: any) {
  const _req = req as VercelRequest;
  const _res = res as VercelResponse;
  if (!_req || !_res) return;
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
1. 문항 텍스트, 보기, 정답, 세부 개념명 등 모든 출력 항목은 반드시 표준 한국어만을 사용하여 작성하십시오. 영어 단어, 프랑스어 등 외국어 단어, 또는 이를 음차한 외래어의 사용을 엄격히 금지합니다.
2. 모든 수학 용어는 반드시 정식 한국어 명칭으로 기술하십시오. 다음은 필수 번역 및 매핑 규칙입니다:
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
   - 특히 아래 단어들은 절대 그대로 음차하거나 노출하지 말고, 반드시 지정된 자연스러운 한국어 수학교육 용어로 대체하여 사용하십시오:
     * étude / study -> (음차 절대 금지) 풀이 또는 계산
     * process -> 과정 (예: 계산 과정, 풀이 과정)
     * procedure -> 절차 또는 풀이 과정
     * step -> 단계
     * concept -> 개념
     * error -> 오류
     * feedback -> 피드백 또는 보완 방향
     * étude process / étude procedure -> 풀이 과정 또는 계산 과정
     * 주어진 근 (나머지정리/나눗셈/분수 맥락에서 사용 절대 금지) -> 문맥에 맞게 '주어진 수', '나누어지는 수', '나누는 수', '몫', '나머지' 등의 올바른 나눗셈/분수 용어를 사용하십시오.
   - 단원 맥락에 맞지 않는 뜬금없는 수학 용어(예: 나눗셈이나 분수 문제에서 "주어진 근" 등)의 사용을 철저히 금지하고, 해당 개념과 맥락에 정확히 부합하는 정식 용어만을 사용하십시오.
3. 체크테스트는 반드시 객관식 5지선다(선택지 5개)로만 출제해야 합니다. 단답형, 서술형, 빈칸형 문항은 절대로 출제하지 마십시오.
   - **[해설 및 문장 작성 시 수학교육적 문장 규칙]**:
      - 모든 문항, 선택지 및 설명은 교과서 답지나 공식 해설지와 같이 단정하고 객관적인 해설체로 작성하십시오.
      - 학생에게 직접 말을 건네는 과도하게 친근한 대화체나 챗봇 말투(“~해요”, “~돼요”, “~하면 돼요”, “~볼게요”, “~입니다!” 등)는 절대로 사용하지 마십시오.
      - 반드시 객관적 서술형 표현(“~입니다”, “~합니다”, “~이므로”, “~따라서”, “~와 같습니다”, “~로 나타낼 수 있습니다”)을 사용하십시오.
      - 풀이 과정은 [근거 → 계산 → 결론]의 논리적 순서에 따라 짧고 명확한 문장으로 작성하십시오.
      - “변환됩니다”, “변환합니다”라는 기계적인 표현은 가급적 사용하지 마십시오.
      - 대분수, 가분수, 동치분수 등을 설명할 때는 반드시 아래의 자연스러운 표현 규칙을 준수하여 작성하십시오.
        * "A는 B로 변환됩니다." 대신 "A는 B입니다." 또는 "A는 B로 나타낼 수 있습니다." (예: "따라서 11/3는 3 2/3입니다." 또는 "따라서 11/3는 3 2/3로 나타낼 수 있습니다.")
        * "A는 B로 변환할 수 있습니다." 대신 "A는 B로 나타낼 수 있습니다." (예: "가분수 11/3는 대분수 3 2/3로 나타낼 수 있습니다.")
        * "A를 B로 변환합니다." 대신 "A를 B로 나타냅니다." (예: "가분수 11/3를 대분수 3 2/3로 나타냅니다.")
        * "A는 B와 같습니다." 표현도 자연스럽게 사용할 수 있습니다.
      - 구체적인 상황별 금지/권장 예시:
        * [기본 문체]
          - 나쁜 예: "5/6에서 1/6을 빼면 됩니다. 분모가 같으니 분자끼리 빼기만 하면 돼요. 그래서 5-1은 4가 되어 4/6이 됩니다. 그리고 이것은 약분하면 2/3으로도 나타낼 수 있습니다." (X)
          - 좋은 예: "5/6와 1/6은 분모가 같으므로 분자끼리 뺍니다. 5-1=4이므로 계산 결과는 4/6입니다. 4/6은 2/3으로 약분할 수 있습니다." (O)
          - 나쁜 예: "분모를 같게 만들면 쉽게 계산할 수 있어요." (X)
          - 좋은 예: "분모가 다른 분수는 통분한 뒤 계산합니다." (O)
        * [통분 및 동치분수 설명]
          - 나쁜 예: "1/2은 같은 분모로 변환하면 3/6입니다." (X)
          - 좋은 예: "1/2은 분모를 6으로 맞추면 3/6과 같습니다." (O)
          - “같은 분모로 변환하면”이라는 표현은 절대 피하고, “분모를 n으로 맞추면” 또는 “동치분수로 나타내면”을 사용하십시오.
4. 문항 수는 반드시 3~5개 사이로 생성하세요.
5. **[중요] 수식 작성 및 렌더링 규칙**:
   - **LaTeX 문법, 백슬래시(\), 수식 감싸기용 기호($)를 절대로 사용하지 마십시오. \\frac 형식 또한 엄격히 금지합니다.** 화면에 \\frac, $, {, } 과 같은 수식 원문이 보이면 실패입니다.
   - 모든 분수는 반드시 슬래시(/)를 사용한 일반 텍스트 형태로만 작성하십시오. (예: 3/8, 2/5)
   - 모든 대분수는 반드시 자연수와 진분수 사이에 하나의 공백(띄어쓰기)을 둔 일반 텍스트 형태로만 작성하십시오. (예: 2 1/4, 3 1/2)
   - 거듭제곱은 가능하면 2², x²처럼 위첨자 형태로 작성하십시오. 곱셈은 * 대신 × 를 사용하십시오. 루트는 한글 '루트 x' 또는 '제곱근 x' 형태로 풀어서 작성하십시오.
   - 화면에서는 앱 내부에서 일반 텍스트 형태(3/8, 2 1/4 등)를 자동으로 감지하여 미려한 세로 분수 형태의 UI 컴포넌트로 렌더링하므로, AI는 **순수한 일반 텍스트 형태**로만 전달해야 합니다.
6. 수학적 정확성을 엄격히 유지하십시오. 대분수로 나타내는 과정 등 모든 계산에서 분자를 분모로 나눈 몫과 나머지를 정확히 계산해야 하며, 정답과 보기의 계산 결과가 한 치의 오차도 없이 완벽히 일치해야 합니다. (예: 가분수 9/4는 몫 2, 나머지 1에 의해 정확하게 2 1/4로 대분수로 나타내야 하며, 절대 2 1/3이 될 수 없습니다.)
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
