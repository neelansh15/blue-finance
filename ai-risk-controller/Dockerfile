FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 RISK_DB_PATH=/service/data/risk.sqlite3
WORKDIR /service
COPY requirements.lock ./requirements.lock
RUN pip install --no-cache-dir -r requirements.lock \
    && useradd --uid 10001 --create-home risk \
    && mkdir -p /service/data \
    && chown risk:risk /service/data
COPY --chown=risk:risk app ./app
COPY --chown=risk:risk scripts ./scripts
USER risk
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=3)"
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
