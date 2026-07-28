# AEO & LLM Citation Graph Simulator
# ====================================
# Quick Setup Script (PowerShell)
# Run: .\setup.ps1

Write-Host "=" * 60 -ForegroundColor Cyan
Write-Host "  AEO & LLM Citation Graph Simulator - Setup" -ForegroundColor Cyan
Write-Host "=" * 60 -ForegroundColor Cyan

# Check Node.js
Write-Host "`n[1/5] Checking Node.js..." -ForegroundColor Yellow
try {
    $nodeVersion = node --version
    Write-Host "  Node.js $nodeVersion found" -ForegroundColor Green
} catch {
    Write-Host "  ERROR: Node.js not found. Install from https://nodejs.org" -ForegroundColor Red
    exit 1
}

# Check Python
Write-Host "`n[2/5] Checking Python..." -ForegroundColor Yellow
try {
    $pythonVersion = python --version 2>&1
    Write-Host "  $pythonVersion found" -ForegroundColor Green
} catch {
    Write-Host "  ERROR: Python not found. Install from https://python.org" -ForegroundColor Red
    exit 1
}

# Install Node.js dependencies
Write-Host "`n[3/5] Installing Node.js dependencies..." -ForegroundColor Yellow
npm install
if ($LASTEXITCODE -ne 0) {
    Write-Host "  ERROR: npm install failed" -ForegroundColor Red
    exit 1
}
Write-Host "  Node.js dependencies installed" -ForegroundColor Green

# Install Playwright browsers
Write-Host "`n[4/5] Installing Playwright browsers..." -ForegroundColor Yellow
npx playwright install chromium --with-deps 2>$null
Write-Host "  Playwright browsers installed" -ForegroundColor Green

# Install Python dependencies
Write-Host "`n[5/5] Installing Python dependencies..." -ForegroundColor Yellow
pip install -r requirements.txt
if ($LASTEXITCODE -ne 0) {
    Write-Host "  WARNING: Some Python packages may have failed" -ForegroundColor Yellow
}

# Download spaCy model
Write-Host "  Downloading spaCy English model..." -ForegroundColor Yellow
python -m spacy download en_core_web_sm 2>$null
Write-Host "  Python dependencies installed" -ForegroundColor Green

# Create .env if not exists
if (-not (Test-Path ".env")) {
    Write-Host "`n  Creating .env from template..." -ForegroundColor Yellow
    Copy-Item ".env.example" ".env"
    Write-Host "  Please edit .env with your API keys" -ForegroundColor Yellow
}

Write-Host "`n" + "=" * 60 -ForegroundColor Cyan
Write-Host "  Setup Complete!" -ForegroundColor Green
Write-Host "=" * 60 -ForegroundColor Cyan
Write-Host "`nNext steps:"
Write-Host "  1. Edit .env with your API keys"
Write-Host "  2. Run: npm start"
Write-Host "  3. Then: python src/python-engine/main.py"
Write-Host "  4. Open: data/output/analysis_*/dashboard/aeo_dashboard.html"
Write-Host ""
