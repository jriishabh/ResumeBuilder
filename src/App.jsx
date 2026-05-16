import { useMemo, useState } from 'react'
import './App.css'

function App() {
  const [jobDescription, setJobDescription] = useState('')
  const [resumeText, setResumeText] = useState('')
  const [resumeFile, setResumeFile] = useState(null)

  const [sessionId, setSessionId] = useState('')
  const [analysis, setAnalysis] = useState(null)
  const [answers, setAnswers] = useState({})

  const [result, setResult] = useState(null)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)
  const [error, setError] = useState('')

  const questionCount = analysis?.targetedQuestions?.length ?? 0

  const completion = useMemo(() => {
    if (!analysis?.targetedQuestions?.length) {
      return 0
    }

    const total = analysis.targetedQuestions.length
    const done = analysis.targetedQuestions.filter((question) => {
      const value = answers[question.id]
      return typeof value === 'string' && value.trim().length > 0
    }).length

    return Math.round((done / total) * 100)
  }, [analysis, answers])

  function resetFlow() {
    setSessionId('')
    setAnalysis(null)
    setAnswers({})
    setResult(null)
    setError('')
  }

  async function handleAnalyze(event) {
    event.preventDefault()
    setError('')
    setResult(null)

    if (!jobDescription.trim()) {
      setError('Please provide the job description.')
      return
    }

    if (!resumeText.trim() && !resumeFile) {
      setError('Please paste your resume text or upload a resume file.')
      return
    }

    try {
      setIsAnalyzing(true)
      const formData = new FormData()
      formData.append('jobDescription', jobDescription)
      formData.append('resumeText', resumeText)

      if (resumeFile) {
        formData.append('resumeFile', resumeFile)
      }

      const response = await fetch('/api/analyze', {
        method: 'POST',
        body: formData,
      })

      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || 'Failed to analyze job and resume.')
      }

      setSessionId(data.sessionId)
      setAnalysis(data.analysis)
      setAnswers({})
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unexpected error.')
    } finally {
      setIsAnalyzing(false)
    }
  }

  async function handleGenerate() {
    setError('')

    if (!sessionId || !analysis?.targetedQuestions?.length) {
      setError('Please run analysis first.')
      return
    }

    const unanswered = analysis.targetedQuestions.find((question) => {
      return !answers[question.id] || !answers[question.id].trim()
    })

    if (unanswered) {
      setError('Please answer all targeted questions before generating.')
      return
    }

    try {
      setIsGenerating(true)
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sessionId,
          answers,
        }),
      })

      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || 'Failed to generate resume output.')
      }

      setResult(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unexpected error.')
    } finally {
      setIsGenerating(false)
    }
  }

  async function copyText(value) {
    try {
      await navigator.clipboard.writeText(value)
    } catch {
      setError('Could not copy to clipboard in this browser context.')
    }
  }

  return (
    <main className="page">
      <header className="hero">
        <p className="eyebrow">Resume Strategist</p>
        <h1>Job-Targeted Resume Builder (LaTeX)</h1>
        <p className="lead">
          The system extracts JD signals, compares your resume evidence, asks only 3-5 high-impact
          questions, then returns a truthful resume plan plus full compilable LaTeX.
        </p>
        <p className="policy">
          Truthfulness rule: the AI can optimize phrasing but cannot invent titles, companies,
          degrees, dates, or achievements.
        </p>
      </header>

      <section className="panel">
        <h2>1) Input: JD + Resume</h2>
        <form onSubmit={handleAnalyze} className="stack">
          <label>
            Job Description
            <textarea
              value={jobDescription}
              onChange={(event) => {
                setJobDescription(event.target.value)
                if (analysis) {
                  resetFlow()
                }
              }}
              rows={10}
              placeholder="Paste full job description..."
              required
            />
          </label>

          <label>
            Resume Text (optional if uploading file)
            <textarea
              value={resumeText}
              onChange={(event) => {
                setResumeText(event.target.value)
                if (analysis) {
                  resetFlow()
                }
              }}
              rows={10}
              placeholder="Paste your current resume text here..."
            />
          </label>

          <label className="file-input">
            Resume File (PDF / TXT / MD)
            <input
              type="file"
              accept=".pdf,.txt,.md,text/plain,application/pdf"
              onChange={(event) => {
                const file = event.target.files?.[0] ?? null
                setResumeFile(file)
                if (analysis) {
                  resetFlow()
                }
              }}
            />
          </label>

          <div className="actions">
            <button type="submit" disabled={isAnalyzing}>
              {isAnalyzing ? 'Analyzing...' : 'Analyze and Ask Targeted Questions'}
            </button>
          </div>
        </form>
      </section>

      {analysis && (
        <section className="panel">
          <h2>2) Strategy Questions ({questionCount})</h2>
          <p className="muted">
            Completion: {completion}%. These questions are intentionally minimal and high-impact.
          </p>

          <div className="grid two">
            <article className="card">
              <h3>Extracted JD Signals</h3>
              <pre>{JSON.stringify(analysis.jdSignals, null, 2)}</pre>
            </article>
            <article className="card">
              <h3>Resume Gaps</h3>
              <pre>{JSON.stringify(analysis.keyGaps, null, 2)}</pre>
            </article>
          </div>

          <div className="qa-list">
            {analysis.targetedQuestions.map((question) => (
              <label key={question.id} className="qa-item">
                <strong>{question.question}</strong>
                <span className="muted">Why this matters: {question.why}</span>
                <textarea
                  value={answers[question.id] || ''}
                  onChange={(event) => {
                    setAnswers((current) => ({
                      ...current,
                      [question.id]: event.target.value,
                    }))
                  }}
                  rows={4}
                  placeholder="Answer with concrete facts, outcomes, tools, and metrics when possible."
                />
              </label>
            ))}
          </div>

          <div className="actions">
            <button type="button" onClick={handleGenerate} disabled={isGenerating}>
              {isGenerating ? 'Generating...' : 'Generate Resume Plan + LaTeX'}
            </button>
          </div>
        </section>
      )}

      {result && (
        <section className="panel">
          <h2>3) Output</h2>
          <div className="grid two">
            <article className="card">
              <div className="row">
                <h3>Structured Resume Plan (JSON)</h3>
                <button
                  type="button"
                  className="ghost"
                  onClick={() => copyText(JSON.stringify(result.resumePlan, null, 2))}
                >
                  Copy JSON
                </button>
              </div>
              <pre>{JSON.stringify(result.resumePlan, null, 2)}</pre>
            </article>

            <article className="card">
              <div className="row">
                <h3>Generated LaTeX</h3>
                <button type="button" className="ghost" onClick={() => copyText(result.latex)}>
                  Copy LaTeX
                </button>
              </div>
              <pre>{result.latex}</pre>
            </article>
          </div>
        </section>
      )}

      {error && <p className="error">{error}</p>}
    </main>
  )
}

export default App
