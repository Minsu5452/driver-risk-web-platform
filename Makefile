.PHONY: dev-ai dev-frontend dev-backend install-ai install-frontend

# AI Engine (port 8000)
dev-ai:
	@lsof -ti:8000 | xargs kill 2>/dev/null || true
	cd ai-engine && uv run uvicorn src.main:app --reload --port 8000

# Frontend (port 3000) — 포트 해제는 package.json dev 스크립트에서 처리
dev-frontend:
	cd frontend && npm run dev

# Backend (port 8080)
dev-backend:
	@lsof -ti:8080 | xargs kill 2>/dev/null || true
	cd backend && mvn spring-boot:run

# 의존성 설치
install-ai:
	cd ai-engine && uv sync

install-frontend:
	cd frontend && npm install
