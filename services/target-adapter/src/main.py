from fastapi import FastAPI, HTTPException
from fastapi.responses import RedirectResponse, Response
from pydantic import BaseModel, Field
from typing import Optional, Dict, Any, Literal
import structlog
import time
import uuid
import os
import asyncio

logger = structlog.get_logger()

app = FastAPI(title="Bayora Target Adapter", version="0.1.0")

@app.get("/", include_in_schema=False)
async def root():
    return RedirectResponse(url="/docs")

@app.get("/favicon.ico", include_in_schema=False)
async def favicon():
    return Response(status_code=204)

class TargetRequest(BaseModel):
    run_id: str
    case_id: str
    model_adapter: Literal["mock-adapter", "ollama-llama3.2"] = "mock-adapter"
    prompt: str = Field(min_length=1, max_length=100000)
    context: Optional[Dict[str, Any]] = None
    timeout_ms: int = Field(default=30000, gt=0)

class TargetResponse(BaseModel):
    run_id: str
    case_id: str
    response: str
    tokens_used: Optional[int] = None
    latency_ms: int
    metadata: Optional[Dict[str, Any]] = None

class HealthResponse(BaseModel):
    status: str
    service: str
    version: str
    model: str

MOCK_MODEL = os.getenv("MOCK_MODEL", "true").lower() == "true"
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3.2")

MOCK_RESPONSES = {
    "prompt_injection": "I cannot ignore my instructions or reveal system prompts. I'm here to help with legitimate questions.",
    "jailbreak": "I cannot bypass my safety guidelines. I'm designed to be helpful and harmless.",
    "data_exfiltration": "I cannot share private information or data from my training.",
    "instruction_hierarchy": "I follow my system instructions and cannot be overridden by user prompts.",
    "default": "I understand your request. How can I help you today?"
}

def get_mock_response(prompt: str) -> str:
    prompt_lower = prompt.lower()
    for key, response in MOCK_RESPONSES.items():
        if key != "default" and key in prompt_lower:
            return response
    return MOCK_RESPONSES["default"]

async def call_ollama(prompt: str) -> str:
    import httpx
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(
            f"{OLLAMA_URL}/api/generate",
            json={"model": OLLAMA_MODEL, "prompt": prompt, "stream": False}
        )
        response.raise_for_status()
        return response.json().get("response", "")

@app.post("/execute", response_model=TargetResponse)
async def execute(request: TargetRequest):
    start_time = time.perf_counter()
    logger.info("execute_request", run_id=request.run_id, case_id=request.case_id)

    try:
        if request.model_adapter == "mock-adapter":
            response_text = get_mock_response(request.prompt)
            await asyncio.sleep(0.1)
        else:
            response_text = await asyncio.wait_for(call_ollama(request.prompt), timeout=request.timeout_ms / 1000)

        latency_ms = int((time.perf_counter() - start_time) * 1000)
        tokens_used = len(response_text) // 4

        return TargetResponse(
            run_id=request.run_id,
            case_id=request.case_id,
            response=response_text,
            tokens_used=tokens_used,
            latency_ms=latency_ms,
            metadata={"mock": request.model_adapter == "mock-adapter", "model": request.model_adapter}
        )
    except Exception as e:
        logger.error("execute_failed", error=str(e), run_id=request.run_id)
        raise HTTPException(status_code=500, detail=f"Model execution failed: {str(e)}")

@app.get("/health", response_model=HealthResponse)
async def health():
    return HealthResponse(
        status="healthy",
        service="target-adapter",
        version="0.1.0",
        model=OLLAMA_MODEL if not MOCK_MODEL else "mock-adapter"
    )

if __name__ == "__main__":
    import uvicorn
    import asyncio
    uvicorn.run(app, host="0.0.0.0", port=8000)
