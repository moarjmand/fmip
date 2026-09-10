# The model service (D-009). Built from the repository root so the context
# matches the other images:  docker build -f apps/model/Dockerfile .
FROM python:3.12-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /app

# Dependencies from the manifest alone, so editing source does not invalidate
# the install layer. The package itself is installed in the next stage.
FROM base AS deps
COPY apps/model/pyproject.toml ./
RUN --mount=type=cache,target=/root/.cache/pip \
    python - <<'PY'
import tomllib, subprocess, sys
deps = tomllib.load(open("pyproject.toml", "rb"))["project"]["dependencies"]
subprocess.check_call([sys.executable, "-m", "pip", "install", *deps])
PY

FROM deps AS runtime
COPY apps/model/fmip_model ./fmip_model
COPY apps/model/pyproject.toml ./
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --no-deps .
# Run as a non-root user.
RUN useradd --system --uid 10001 model
USER model
EXPOSE 8000
HEALTHCHECK --interval=10s --timeout=5s --start-period=15s --retries=6 \
  CMD ["python", "-c", "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=4).status == 200 else 1)"]
CMD ["python", "-m", "fmip_model.service"]
