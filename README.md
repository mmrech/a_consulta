<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Clinical Extractor

[![Playwright Tests](https://github.com/YOUR_USERNAME/clinical-extractor/actions/workflows/playwright-tests.yml/badge.svg)](https://github.com/YOUR_USERNAME/clinical-extractor/actions/workflows/playwright-tests.yml)
[![TypeScript Check](https://github.com/YOUR_USERNAME/clinical-extractor/actions/workflows/typescript.yml/badge.svg)](https://github.com/YOUR_USERNAME/clinical-extractor/actions/workflows/typescript.yml)
[![Production Build](https://github.com/YOUR_USERNAME/clinical-extractor/actions/workflows/build.yml/badge.svg)](https://github.com/YOUR_USERNAME/clinical-extractor/actions/workflows/build.yml)

A web-based clinical data extraction platform for systematic review of medical research papers, with a focus on neurosurgical literature.

## Features

- **PDF Processing**: Upload and render medical research PDFs with interactive text layers
- **Multi-Agent AI Pipeline**: 6 specialized medical research agents (Study Design Expert, Patient Data Specialist, Surgical Expert, Outcomes Analyst, Neuroimaging Specialist, Table Extractor)
- **Manual & AI Extraction**: Extract data through mouse selection or AI-powered analysis
- **Citation Provenance**: Complete coordinate-level tracking for reproducible research
- **Multiple Export Formats**: JSON, CSV, Excel, HTML audit reports, Google Sheets integration
- **Error Recovery**: Automatic crash detection and session recovery

View your app in AI Studio: https://ai.studio/apps/drive/1DFFjaDptqv2f27UHIzLdxSc0rrZszk0G

## Quick Start

### Prerequisites

- **Node.js** (v16 or higher)
- **Gemini API Key** - Get your free key at [https://ai.google.dev/](https://ai.google.dev/)

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/matheus-rech/la_consulta.git
   cd la_consulta
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure environment variables**
   ```bash
   cp .env.example .env.local
   ```
   
   Edit `.env.local` and add your Gemini API key:
   ```
   VITE_GEMINI_API_KEY=your_api_key_here
   ```

4. **Run the development server**
   ```bash
   npm run dev
   ```

5. **Open your browser**
   
   Navigate to the URL shown in the terminal (typically `http://localhost:5173`)

## Usage

1. **Upload a PDF**: Click "Choose PDF File" and select a medical research paper
2. **Extract Data**: Use manual selection (click and drag) or AI-powered extraction
3. **Fill Form**: Navigate through the 8-step extraction wizard
4. **Export**: Download as JSON, CSV, Excel, or submit to Google Sheets

## Architecture

The application consists of 6 major components:

1. **Application Initialization** (`src/main.ts`) - Dependency injection and orchestration
2. **PDF Pipeline** (`src/pdf/`) - PDF.js-based rendering and text extraction
3. **AI Service** (`src/services/AIService.ts`) - 7 Gemini AI functions with retry logic
4. **Multi-Agent System** (`src/services/AgentOrchestrator.ts`) - Specialized medical agents
5. **Data Management** (`src/data/ExtractionTracker.ts`) - Audit trails and persistence
6. **Error Handling** (`src/utils/errorBoundary.ts`) - Crash recovery system

## Development

### Build for Production

```bash
npm run build
```

### Run Tests

**Unit Tests:**
```bash
npm test          # Run all unit tests
npm run test:watch     # Run tests in watch mode
npm run test:coverage  # Generate coverage report
```

**E2E Tests (Playwright):**
```bash
npm run test:e2e         # Run all E2E tests (headless)
npm run test:e2e:headed  # Run with visible browser (debugging)
npm run test:e2e:debug   # Step-through debugging mode
```

**⚠️ Important:** E2E AI tests (tests 23-35) require a valid `GEMINI_API_KEY` in `.env.local`:
- Without the API key: **77/96 tests pass** (80.2% - all infrastructure tests)
- With the API key: **96/96 tests pass** (100% - including AI integration tests)

See [TESTING_GUIDE.md](TESTING_GUIDE.md) for comprehensive testing documentation.

### Lint Code

```bash
npm run lint
```

## Documentation

- [Improvement Strategy](docs/Clinical_Extractor_Improvement_Strategy.md) - Comprehensive roadmap for production readiness
- [Multi-Agent Pipeline](MULTI_AGENT_PIPELINE_COMPLETE.md) - AI agent architecture
- [AI Service Architecture](AI_SERVICE_ARCHITECTURE.md) - Gemini API integration details

## Contributing

1. Create a feature branch: `git checkout -b feature/your-feature`
2. Make your changes and commit: `git commit -m "Add feature"`
3. Push to the branch: `git push origin feature/your-feature`
4. Open a Pull Request

## License

Apache-2.0

## Support

For issues and questions, please open a GitHub issue.
