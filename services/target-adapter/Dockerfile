FROM python:3.11-slim AS base

WORKDIR /app

FROM base AS deps
COPY pyproject.toml ./
RUN pip install --no-cache-dir -e ".[dev]"

FROM base AS builder
COPY --from=deps /usr/local/lib/python3.11 /usr/local/lib/python3.11
COPY src ./src
RUN python -m compileall src

FROM base AS runner
ENV PYTHONUNBUFFERED=1
ENV MOCK_MODEL=true
COPY --from=builder /usr/local/lib/python3.11 /usr/local/lib/python3.11
COPY --from=builder /app/src ./src

EXPOSE 8000
CMD ["python", "-m", "uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8000"]