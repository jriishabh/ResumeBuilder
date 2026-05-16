# Resume Strategist (JD -> Questions -> JSON Plan + LaTeX)

This app helps users build a truthful, job-targeted resume in LaTeX.

Flow:
1. User provides job description + resume text/file.
2. Backend asks Gemini to extract structured JD signals and compare against resume evidence.
3. System asks only 3-5 targeted follow-up questions.
4. Backend generates:
	 - Structured JSON resume plan
	 - Full, compilable LaTeX resume code

Truthfulness guardrail:
- The prompt explicitly forbids inventing titles, companies, dates, degrees, or achievements.
- Model is allowed to optimize wording only for facts provided by the user.

## Tech Stack

- Frontend: React + Vite
- Backend: Express
- AI: Google Gemini API
- Uploads: Multer (+ PDF parsing)

## Setup

1. Create your env file:
	 - Copy `.env.example` to `.env`
	 - Fill in `GEMINI_API_KEY`

2. Install dependencies:

```bash
npm install
```

3. Run frontend + backend together:

```bash
npm run dev
```

4. Open the app:

- http://localhost:5173

## Scripts

- `npm run dev` -> runs backend and frontend concurrently
- `npm run dev:server` -> backend only (port 8787 by default)
- `npm run dev:client` -> frontend only
- `npm run build` -> frontend production build
- `npm run lint` -> lint frontend files

## API Endpoints

- `POST /api/analyze`
	- multipart/form-data:
		- `jobDescription` (required)
		- `resumeText` (optional if file provided)
		- `resumeFile` (optional: PDF/TXT/MD)
	- returns `sessionId` + structured analysis + targeted questions

- `POST /api/generate`
	- JSON body:
		- `sessionId`
		- `answers` (map of question id -> user answer)
	- returns:
		- `resumePlan` (structured JSON)
		- `latex` (full LaTeX source)

## Security Note

If an API key was ever shared publicly, rotate/revoke it and use a fresh key in `.env`.
