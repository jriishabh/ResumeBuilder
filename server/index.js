import 'dotenv/config'
import cors from 'cors'
import express from 'express'
import multer from 'multer'
import { PDFParse } from 'pdf-parse'
import { randomUUID } from 'node:crypto'

const app = express()
const port = process.env.PORT || 8787
const geminiApiKey = process.env.GEMINI_API_KEY
const geminiModel = process.env.GEMINI_MODEL || 'gemini-2.0-flash'

const sessions = new Map()

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
})

app.use(cors())
app.use(express.json({ limit: '2mb' }))

function normalizeWhitespace(value) {
  return value.replace(/\s+/g, ' ').trim()
}

function stripCodeFences(value) {
  return value
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()
}

function parseJsonFromModel(text) {
  const cleaned = stripCodeFences(text)
  return JSON.parse(cleaned)
}

function getGeminiText(data) {
  const first = data?.candidates?.[0]?.content?.parts?.[0]?.text
  if (!first || typeof first !== 'string') {
    throw new Error('Gemini returned no text output.')
  }
  return first
}

async function callGemini(prompt) {
  if (!geminiApiKey) {
    throw new Error('Missing GEMINI_API_KEY in environment variables.')
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-goog-api-key': geminiApiKey,
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [{ text: prompt }],
          },
        ],
        generationConfig: {
          temperature: 0.2,
          responseMimeType: 'application/json',
        },
      }),
    },
  )

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Gemini API failed (${response.status}): ${errorText}`)
  }

  const data = await response.json()
  return getGeminiText(data)
}

function buildAnalysisPrompt({ jobDescription, resumeText }) {
  return `You are an elite resume strategist.\n\nGoal:\n1) Extract structured signals from the Job Description (JD).\n2) Compare with resume evidence.\n3) Ask ONLY 3-5 highly targeted missing-proof questions.\n\nHard rules:\n- Never invent facts, titles, companies, dates, degrees, or achievements.\n- You may optimize phrasing only for facts explicitly present in inputs.\n- Questions must be specific and answerable in 1-2 lines.\n- Prefer high-impact gaps first.\n\nReturn strict JSON with this schema only:\n{\n  "jdSignals": {\n    "roleTitle": "",\n    "seniority": "",\n    "mustHaveSkills": [""],\n    "niceToHaveSkills": [""],\n    "domainKeywords": [""],\n    "responsibilities": [""],\n    "atsKeywords": [""]\n  },\n  "resumeEvidence": [\n    {\n      "skill": "",\n      "status": "strong|partial|missing",\n      "evidence": ""\n    }\n  ],\n  "keyGaps": [\n    {\n      "gap": "",\n      "whyItMatters": ""\n    }\n  ],\n  "targetedQuestions": [\n    {\n      "id": "q1",\n      "question": "",\n      "why": ""\n    }\n  ]\n}\n\nConstraints:\n- targetedQuestions length must be between 3 and 5.\n- Keep arrays concise and high-signal.\n\nJob Description:\n${jobDescription}\n\nResume Source:\n${resumeText}`
}

function buildFinalPrompt({ jobDescription, resumeText, analysis, answers }) {
  return `You are an elite resume strategist and LaTeX resume writer.\n\nGoal:\nProduce a resume plan and a full working single-file LaTeX resume optimized for the JD.\n\nHard rules:\n- NEVER invent facts (titles, companies, dates, degrees, certifications, metrics, projects, achievements).\n- Use only information from resume text plus user answers.\n- If evidence for a JD requirement is missing, do not fabricate. Instead, de-emphasize or use neutral wording.\n- Keep content truthful and ATS-friendly.\n\nOutput strict JSON only:\n{\n  "resumePlan": {\n    "targetRole": "",\n    "headline": "",\n    "summary": [""],\n    "priorityKeywordsUsed": [""],\n    "sectionStrategy": [\n      {"section": "", "reason": ""}\n    ],\n    "bulletUpgradeNotes": [""],\n    "missingButImportant": [""]\n  },\n  "latex": "FULL LATEX STRING"\n}\n\nLaTeX requirements:\n- Must compile with pdflatex.\n- Provide a complete document with preamble and \\begin{document}/\\end{document}.\n- Use modern, clean formatting and clear sections (Summary, Skills, Experience, Projects, Education, Certifications as available).\n- Keep it to one page where feasible.\n- Escape LaTeX special characters.\n\nJob Description:\n${jobDescription}\n\nResume Source:\n${resumeText}\n\nAnalysis JSON:\n${JSON.stringify(analysis)}\n\nUser Answers:\n${JSON.stringify(answers)}`
}

async function extractResumeText(req) {
  const textFromBody = typeof req.body.resumeText === 'string' ? req.body.resumeText : ''
  const normalizedBodyText = normalizeWhitespace(textFromBody)

  if (!req.file) {
    return normalizedBodyText
  }

  const file = req.file
  let fileText

  if (file.mimetype === 'application/pdf') {
    const parser = new PDFParse({ data: file.buffer })
    const parsed = await parser.getText()
    fileText = parsed.text || ''
    await parser.destroy()
  } else if (
    file.mimetype === 'text/plain' ||
    file.mimetype === 'application/msword' ||
    file.originalname.endsWith('.txt') ||
    file.originalname.endsWith('.md')
  ) {
    fileText = file.buffer.toString('utf8')
  } else {
    throw new Error('Unsupported resume file type. Use PDF, TXT, or MD.')
  }

  const combined = [normalizedBodyText, normalizeWhitespace(fileText || '')]
    .filter(Boolean)
    .join(' ')

  return combined
}

app.post('/api/analyze', upload.single('resumeFile'), async (req, res) => {
  try {
    const jobDescription = typeof req.body.jobDescription === 'string' ? req.body.jobDescription.trim() : ''

    if (!jobDescription) {
      return res.status(400).json({ error: 'Job description is required.' })
    }

    const resumeText = await extractResumeText(req)
    if (!resumeText) {
      return res.status(400).json({ error: 'Resume text or resume file is required.' })
    }

    const analysisPrompt = buildAnalysisPrompt({ jobDescription, resumeText })
    const raw = await callGemini(analysisPrompt)
    const analysis = parseJsonFromModel(raw)

    const questions = Array.isArray(analysis?.targetedQuestions)
      ? analysis.targetedQuestions.slice(0, 5)
      : []

    if (questions.length < 3) {
      return res.status(502).json({
        error: 'Model response did not include enough targeted questions. Please retry.',
      })
    }

    const sessionId = randomUUID()
    sessions.set(sessionId, {
      jobDescription,
      resumeText,
      analysis: {
        ...analysis,
        targetedQuestions: questions,
      },
      createdAt: Date.now(),
    })

    return res.json({
      sessionId,
      analysis: {
        ...analysis,
        targetedQuestions: questions,
      },
    })
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Unexpected server error.',
    })
  }
})

app.post('/api/generate', async (req, res) => {
  try {
    const sessionId = typeof req.body.sessionId === 'string' ? req.body.sessionId : ''
    const answers = typeof req.body.answers === 'object' && req.body.answers !== null ? req.body.answers : {}

    if (!sessionId || !sessions.has(sessionId)) {
      return res.status(400).json({ error: 'Invalid or expired session.' })
    }

    const session = sessions.get(sessionId)
    const prompt = buildFinalPrompt({
      jobDescription: session.jobDescription,
      resumeText: session.resumeText,
      analysis: session.analysis,
      answers,
    })

    const raw = await callGemini(prompt)
    const generated = parseJsonFromModel(raw)

    if (!generated?.latex || !generated?.resumePlan) {
      return res.status(502).json({ error: 'Model output missing required fields.' })
    }

    return res.json(generated)
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Unexpected server error.',
    })
  }
})

app.get('/api/health', (_req, res) => {
  res.json({ ok: true })
})

app.listen(port, () => {
  console.log(`Resume Strategist API running on http://localhost:${port}`)
})
