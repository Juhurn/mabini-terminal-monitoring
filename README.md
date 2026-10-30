# Mabini Terminal Monitoring System

Standalone SEAOIL Mabini Terminal operations monitoring application.

## Stack
- React + Vite
- Nunito typography
- Recharts for dashboard analytics
- GitHub Pages deployment (static frontend)

## Local development
```bash
npm install
npm run dev
```

## Production build
```bash
npm run build
```

## Important data/security notes
The current dashboard uses illustrative/sample values only. Do not commit credentials, API keys, service-account files, or confidential operational records.
The Google Sheets integration must be implemented through an authenticated server-side/API layer. A public frontend must never contain Google credentials or expose confidential sheet data.
